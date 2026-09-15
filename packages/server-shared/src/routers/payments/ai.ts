/**
 * Payments (EziQuotes) AI router — proposal drafting, scoring, win/loss
 * analysis, pricing benchmarks, upsell recommendations and block copy, ported
 * from the export's server/routers/ai.ts. The Manus Forge invokeLLM calls
 * (OpenAI-style json_schema response_format) are replaced with the platform's
 * Anthropic client (modules/ai/client.ts, non-streaming messages.create on
 * SONNET); each procedure's prompt construction, JSON parsing (parseJSON with
 * per-procedure fallbacks) and output shape are preserved exactly.
 */
import { TRPCError } from '@trpc/server';
import { eq } from 'drizzle-orm';
import { z } from 'zod';
import { proposals } from '../../db/schema.js';
import { isAiEnabled } from '../../modules/ai/client.js';
import { completeOnce } from '../../modules/ai/provider-config.js';
import type { AiUsageSource } from '../../modules/ai/usage.js';
import { requirePaymentWrite } from '../../modules/payments/access.js';
import { getPaymentAccount, listAddons, listProducts } from '../../modules/payments/db.js';
import type { Context } from '../../trpc/context.js';
import { protectedProcedure, router } from '../../trpc/trpc.js';

// -- Helpers --------------------------------------------------------------------
function parseJSON<T>(text: string, fallback: T): T {
  try {
    const match = text.match(/\{[\s\S]*\}|\[[\s\S]*\]/);
    if (match) return JSON.parse(match[0]) as T;
    return JSON.parse(text) as T;
  } catch {
    return fallback;
  }
}

/**
 * Non-streaming completion on SONNET, returning the concatenated text blocks.
 * Records Anthropic spend against the calling brand/user (best-effort).
 */
async function complete(
  ctx: Context,
  opts: { system: string; user: string; source: AiUsageSource; brandId?: string | null },
): Promise<string> {
  if (!isAiEnabled()) {
    throw new TRPCError({
      code: 'PRECONDITION_FAILED',
      message: 'AI is not configured on this server.',
    });
  }
  return completeOnce({
    db: ctx.db,
    source: opts.source,
    system: opts.system,
    prompt: opts.user,
    maxTokens: 2048,
    brandId: opts.brandId ?? null,
    userId: ctx.user?.id ?? null,
    client: ctx.client ?? null,
  });
}

/** Load a proposal row and assert write access via its brand. */
async function loadProposal(ctx: Context, proposalId: string) {
  const [proposal] = await ctx.db
    .select()
    .from(proposals)
    .where(eq(proposals.id, proposalId))
    .limit(1);
  if (!proposal) throw new TRPCError({ code: 'NOT_FOUND' });
  await requirePaymentWrite(ctx, proposal.brandId!);
  return { ...proposal, brandId: proposal.brandId! };
}

export const aiRouter = router({
  // -- 1. Proposal Writer -----------------------------------------------------
  draftProposal: protectedProcedure
    .input(
      z.object({
        brandId: z.string().uuid(),
        description: z.string().min(10).max(2000),
        clientName: z.string().optional(),
        budget: z.number().optional(),
        industry: z.string().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      await requirePaymentWrite(ctx, input.brandId);
      const account = await getPaymentAccount(input.brandId);
      const businessName = account?.businessName ?? 'your business';
      const products = await listProducts(input.brandId);

      const productList = products.slice(0, 20).map((p) =>
        `- ${p.name}: $${Math.round((p.basePriceCents ?? 0) / 100)} (${p.category ?? 'service'})`,
      ).join('\n');

      const content = await complete(ctx, {
        source: 'proposal_draft',
        brandId: input.brandId,
        system: `You are a proposal writing assistant for ${businessName}. Generate professional proposal line items based on the job description. Return ONLY valid JSON.`,
        user: `Job description: ${input.description}
${input.clientName ? `Client: ${input.clientName}` : ''}
${input.budget ? `Budget: $${input.budget}` : ''}
${input.industry ? `Industry: ${input.industry}` : ''}

Available products/services from catalog:
${productList || 'No catalog items — create generic items'}

Generate 3–8 line items for this proposal. Return JSON:
{
  "title": "Proposal title (max 60 chars)",
  "items": [
    { "name": "Item name", "qty": 1, "price": 1200, "category": "category name" }
  ],
  "notes": "Brief 2-sentence intro copy for the proposal",
  "paymentModel": "one-off" | "subscription" | "payment-plan",
  "totalEstimate": 5000
}`,
      });

      const draft = parseJSON(content, {
        title: 'New Proposal',
        items: [],
        notes: '',
        paymentModel: 'one-off',
        totalEstimate: 0,
      });
      return draft;
    }),

  // -- 2. Proposal Scoring ----------------------------------------------------
  scoreProposal: protectedProcedure
    .input(z.object({ proposalId: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const proposal = await loadProposal(ctx, input.proposalId);

      const lineItems = (proposal as any).structure?.lineItems ?? [];
      const itemCount = lineItems.filter((l: any) => l.type !== 'break').length;
      const totalCents = lineItems.reduce((s: number, l: any) =>
        l.type !== 'break' ? s + (l.unitPriceCents ?? 0) * (l.quantity ?? 1) : s, 0);
      const totalDollars = Math.round(totalCents / 100);

      const content = await complete(ctx, {
        source: 'proposal_score',
        brandId: proposal.brandId,
        system: 'You are a proposal quality analyst. Score proposals and give actionable feedback. Return ONLY valid JSON.',
        user: `Proposal to score:
Title: ${proposal.title}
Line items (${itemCount}): ${lineItems.filter((l: any) => l.type !== 'break').map((l: any) => l.name).join(', ')}
Total value: $${totalDollars}
Status: ${proposal.status}

Score this proposal on:
1. Completeness (are there enough items? is the scope clear?)
2. Price anchoring (is the pricing clear and justified?)
3. Clarity (is the title and item naming professional?)
4. Conversion likelihood (based on structure and value)

Return JSON:
{
  "overallScore": 78,
  "grade": "B+",
  "scores": {
    "completeness": 80,
    "priceAnchoring": 75,
    "clarity": 85,
    "conversionLikelihood": 72
  },
  "strengths": ["strength 1", "strength 2"],
  "improvements": ["improvement 1", "improvement 2", "improvement 3"],
  "verdict": "One sentence verdict on this proposal"
}`,
      });

      return parseJSON(content, {
        overallScore: 70,
        grade: 'C',
        scores: { completeness: 70, priceAnchoring: 70, clarity: 70, conversionLikelihood: 70 },
        strengths: [],
        improvements: ['Add more detail to line items'],
        verdict: 'Proposal needs more detail.',
      });
    }),

  // -- 3. Win/Loss Analysis ---------------------------------------------------
  winLossAnalysis: protectedProcedure
    .input(
      z.object({
        proposalId: z.string().uuid(),
        outcome: z.enum(['won', 'lost', 'expired']),
        declineReason: z.string().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const proposal = await loadProposal(ctx, input.proposalId);

      const lineItems = (proposal as any).structure?.lineItems ?? [];
      const totalCents = lineItems.reduce((s: number, l: any) =>
        l.type !== 'break' ? s + (l.unitPriceCents ?? 0) * (l.quantity ?? 1) : s, 0);

      const content = await complete(ctx, {
        source: 'proposal_win_loss',
        brandId: proposal.brandId,
        system: 'You are a sales analyst. Analyse proposal outcomes and provide actionable insights. Return ONLY valid JSON.',
        user: `Proposal outcome analysis:
Title: ${proposal.title}
Outcome: ${input.outcome}
${input.declineReason ? `Decline reason: ${input.declineReason}` : ''}
Total value: $${Math.round(totalCents / 100)}
Items: ${lineItems.filter((l: any) => l.type !== 'break').map((l: any) => l.name).join(', ')}

Provide a brief win/loss analysis with:
1. Key factor that drove this outcome
2. What to do differently next time
3. Pattern to watch for

Return JSON:
{
  "keyFactor": "The main reason for this outcome",
  "recommendation": "What to do differently next time",
  "pattern": "Pattern to watch for in future proposals",
  "tags": ["tag1", "tag2"],
  "sentiment": "positive" | "neutral" | "negative"
}`,
      });

      return parseJSON(content, {
        keyFactor: 'Outcome recorded',
        recommendation: 'Review proposal structure',
        pattern: 'Monitor similar proposals',
        tags: [input.outcome],
        sentiment: input.outcome === 'won' ? 'positive' : 'negative',
      });
    }),

  // -- 5. Competitor Price Benchmarking ----------------------------------------
  benchmarkPricing: protectedProcedure
    .input(
      z.object({
        brandId: z.string().uuid(),
        category: z.string(),
        items: z.array(
          z.object({
            name: z.string(),
            priceCents: z.number(),
          }),
        ),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      await requirePaymentWrite(ctx, input.brandId);
      const account = await getPaymentAccount(input.brandId);
      if (!account) throw new TRPCError({ code: 'NOT_FOUND' });

      const itemList = input.items.map((i) => `- ${i.name}: $${Math.round(i.priceCents / 100)}`).join('\n');

      const content = await complete(ctx, {
        source: 'pricing_benchmark',
        brandId: input.brandId,
        system: 'You are a pricing strategy consultant. Provide competitive pricing benchmarks and recommendations based on market knowledge. Return ONLY valid JSON.',
        user: `Pricing benchmark request for category: ${input.category}\n\nItems to benchmark:\n${itemList}\n\nFor each item, provide a market position and insight. Also provide an overall summary and recommendations.\n\nReturn JSON:\n{\n  "overallPosition": "below_market" | "at_market" | "above_market",\n  "summary": "2-sentence overall summary",\n  "items": [\n    {\n      "name": "item name",\n      "position": "below_market" | "at_market" | "above_market",\n      "insight": "1-sentence insight",\n      "suggestedRange": "$X - $Y"\n    }\n  ],\n  "recommendations": ["recommendation 1", "recommendation 2"]\n}`,
      });

      return parseJSON(content, {
        overallPosition: 'at_market',
        summary: 'Your pricing appears to be in line with market rates.',
        items: input.items.map((i) => ({ name: i.name, position: 'at_market', insight: 'Pricing appears competitive.', suggestedRange: `$${Math.round(i.priceCents * 0.8 / 100)} - $${Math.round(i.priceCents * 1.2 / 100)}` })),
        recommendations: ['Consider reviewing your pricing annually to stay competitive.'],
      });
    }),

  // -- 4. Upsell Recommendations ----------------------------------------------
  upsellRecommendations: protectedProcedure
    .input(
      z.object({
        brandId: z.string().uuid(),
        selectedProductIds: z.array(z.string().uuid()),
        totalCents: z.number(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      await requirePaymentWrite(ctx, input.brandId);
      const account = await getPaymentAccount(input.brandId);
      if (!account) throw new TRPCError({ code: 'NOT_FOUND' });

      const allProducts = await listProducts(input.brandId);
      const allAddons = await listAddons(input.brandId);

      const selectedProducts = allProducts
        .filter((p) => input.selectedProductIds.includes(p.id))
        .map((p) => p.name);

      const otherProducts = allProducts
        .filter((p) => !input.selectedProductIds.includes(p.id))
        .slice(0, 15)
        .map((p) => `${p.name} ($${Math.round((p.basePriceCents ?? 0) / 100)})`);

      const addonList = allAddons
        .slice(0, 10)
        .map((a) => `${a.name} ($${Math.round((a.priceCents ?? 0) / 100)})`);

      const content = await complete(ctx, {
        source: 'upsell_recommendations',
        brandId: input.brandId,
        system: 'You are a sales advisor. Suggest relevant upsells and add-ons based on selected products. Return ONLY valid JSON.',
        user: `Current proposal:
Selected products: ${selectedProducts.join(', ') || 'None yet'}
Proposal total: $${Math.round(input.totalCents / 100)}

Available products to upsell:
${otherProducts.join('\n') || 'None'}

Available add-ons:
${addonList.join('\n') || 'None'}

Suggest 2–4 relevant upsells. Return JSON:
{
  "recommendations": [
    {
      "name": "Product name",
      "reason": "Why this pairs well (max 15 words)",
      "estimatedValue": 500,
      "type": "product" | "addon"
    }
  ],
  "upsellPotential": "low" | "medium" | "high",
  "totalUpsellEstimate": 1500
}`,
      });

      return parseJSON(content, {
        recommendations: [],
        upsellPotential: 'low',
        totalUpsellEstimate: 0,
      });
    }),

  // -- 6. Block Copy Suggestions -------------------------------------------------------
  suggestBlockCopy: protectedProcedure
    .input(
      z.object({
        brandId: z.string().uuid(),
        blockType: z.string(),
        currentContent: z.string().optional(),
        proposalContext: z
          .object({
            title: z.string().optional(),
            clientName: z.string().optional(),
            businessName: z.string().optional(),
            industry: z.string().optional(),
          })
          .optional(),
        tone: z.enum(['professional', 'friendly', 'bold', 'luxury']).default('professional'),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      await requirePaymentWrite(ctx, input.brandId);
      const account = await getPaymentAccount(input.brandId);
      const businessName = input.proposalContext?.businessName ?? account?.businessName ?? 'your business';
      const clientName = input.proposalContext?.clientName ?? 'the client';
      const toneGuide = {
        professional: 'Clear, confident, and results-focused. No fluff.',
        friendly: "Warm, conversational, and approachable. Use 'we' and 'you'.",
        bold: 'Punchy, direct, and impactful. Short sentences. Strong verbs.',
        luxury: 'Refined, elegant, and premium. Understated confidence.',
      }[input.tone];
      const content = await complete(ctx, {
        source: 'block_copy',
        brandId: input.brandId,
        system: `You are a world-class proposal copywriter for ${businessName}. Write compelling copy for a proposal block. Tone: ${toneGuide}. Client: ${clientName}. Keep it concise and conversion-focused. Return ONLY valid JSON of the form {"suggestions": [{"label": "...", "headline": "...", "body": "..."}]}.`,
        user: `Block type: ${input.blockType}\nCurrent content: ${input.currentContent ?? '(empty)'}\nGenerate 3 alternative copy suggestions for this block.`,
      });
      return parseJSON(content, { suggestions: [] as Array<{ label: string; headline: string; body: string }> });
    }),
});
