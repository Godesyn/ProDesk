import { GoogleGenAI, FunctionCallingConfigMode, ThinkingLevel } from '@google/genai';
import type { Content, GenerateContentResponse, Part, Tool, ToolConfig } from '@google/genai';
import { env } from '../../../lib/env.js';
import type {
  CompleteRequest,
  LlmProvider,
  LlmResult,
  LlmStream,
  NeutralBlock,
  NeutralMessage,
  NormalizedUsage,
  StopReason,
  ToolUseBlock,
} from './types.js';

/**
 * Google Gemini provider. Translates the neutral request/response shapes to and
 * from Gemini's `Content`/`Part` model and drives a manual function-calling loop
 * (we never use the SDK's automatic function calling — chat.ts owns the loop).
 *
 * Feature notes vs Anthropic:
 *   • No hosted tool-search / deferred loading — every tool is sent each turn
 *     (caps.deferredTools=false, so chat.ts sends the full list and defer_loading
 *     is ignored).
 *   • Prompt caching is implicit (server-side), so there are no cache breakpoints
 *     to set (caps.promptCache=false); cachedContentTokenCount still shows up in
 *     usage and is priced by pricing.ts.
 *   • Web search maps to Gemini's `googleSearch` grounding tool.
 *   • The full raw model parts (including any thinking `thoughtSignature`s) are
 *     round-tripped verbatim via an opaque block so multi-step reasoning + tool
 *     calls stay coherent across rounds.
 */

/** Extra output-token headroom for one-shot completions. Gemini bills thinking
 *  against maxOutputTokens and Gemini 3 can't fully disable it (only thinkingLevel
 *  'minimal'), so a small budget sized for the visible answer alone gets consumed
 *  by the reasoning trace and truncates the output — this leaves room for both. */
const GEMINI_ONESHOT_THINKING_HEADROOM = 2048;

let _client: GoogleGenAI | null = null;
function client(): GoogleGenAI {
  if (!env.GEMINI_API_KEY) {
    throw new Error('GEMINI_API_KEY is not configured — the Gemini provider is unavailable.');
  }
  if (!_client) _client = new GoogleGenAI({ apiKey: env.GEMINI_API_KEY });
  return _client;
}

/** Gemini's function-param schema rejects a few JSON-Schema keywords; drop them. */
function sanitizeSchema(schema: unknown): unknown {
  if (Array.isArray(schema)) return schema.map(sanitizeSchema);
  if (schema && typeof schema === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(schema as Record<string, unknown>)) {
      if (k === 'additionalProperties' || k === '$schema') continue;
      out[k] = sanitizeSchema(v);
    }
    return out;
  }
  return schema;
}

/** Translate one neutral block to zero-or-more Gemini parts. */
function toParts(b: NeutralBlock): Part[] {
  switch (b.type) {
    case 'text':
      return b.text ? [{ text: b.text }] : [];
    case 'image':
      return [{ inlineData: { mimeType: b.mediaType, data: b.dataBase64 } }];
    case 'document':
      return [{ inlineData: { mimeType: b.mediaType, data: b.dataBase64 } }];
    case 'tool_use':
      return [{ functionCall: { name: b.name, args: b.input } }];
    case 'tool_result': {
      // Gemini matches a functionResponse to its call by NAME. `content` is a
      // JSON string; wrap it so the model reads structured output.
      let parsed: unknown;
      try {
        parsed = JSON.parse(b.content);
      } catch {
        parsed = b.content;
      }
      const response =
        parsed && typeof parsed === 'object' && !Array.isArray(parsed)
          ? (parsed as Record<string, unknown>)
          : { output: parsed };
      return [{ functionResponse: { name: b.toolName ?? 'tool', response } }];
    }
    case 'opaque':
      // Our own previously-emitted model parts (with thoughtSignatures) — replay verbatim.
      return (b.native as Part[]) ?? [];
  }
}

/** Translate neutral messages → Gemini `contents`. */
function toContents(messages: NeutralMessage[]): Content[] {
  return messages.map((m): Content => {
    const role = m.role === 'assistant' ? 'model' : 'user';
    const parts =
      typeof m.content === 'string'
        ? m.content
          ? [{ text: m.content }]
          : []
        : m.content.flatMap(toParts);
    return { role, parts };
  });
}

/** Parse a Gemini model turn's parts into neutral tool-use blocks + visible text. */
function parseModelParts(parts: Part[]): { text: string; toolUses: ToolUseBlock[] } {
  let text = '';
  const toolUses: ToolUseBlock[] = [];
  parts.forEach((p, i) => {
    if (p.thought) return; // reasoning trace — not visible output
    if (typeof p.text === 'string') text += p.text;
    if (p.functionCall?.name) {
      toolUses.push({
        type: 'tool_use',
        // Gemini often omits the call id; synthesize a stable one for chat.ts's
        // dedup/correlation (the functionResponse is matched back by name).
        id: p.functionCall.id ?? `${p.functionCall.name}-${i}`,
        name: p.functionCall.name,
        input: (p.functionCall.args as Record<string, unknown>) ?? {},
      });
    }
  });
  return { text, toolUses };
}

function mapUsage(usage: GenerateContentResponse['usageMetadata'] | undefined): NormalizedUsage {
  const u = usage ?? {};
  const cached = u.cachedContentTokenCount ?? 0;
  const prompt = u.promptTokenCount ?? 0;
  // promptTokenCount includes cached tokens — bill the uncached remainder as input.
  const freshInput = Math.max(0, prompt - cached);
  // Thinking tokens bill as output on Gemini, and are separate from candidates.
  const output = (u.candidatesTokenCount ?? 0) + (u.thoughtsTokenCount ?? 0);
  return {
    inputTokens: freshInput,
    outputTokens: output,
    cacheReadTokens: cached,
    cacheWriteTokens: 0, // implicit caching — no separate write charge
    webSearchRequests: 0, // grounding isn't metered per-request in usageMetadata
  };
}

function mapFinishReason(reason: string | undefined, hasToolUse: boolean): StopReason {
  if (hasToolUse) return 'tool_use';
  switch (reason) {
    case 'MAX_TOKENS':
      return 'max_tokens';
    case 'SAFETY':
    case 'RECITATION':
    case 'BLOCKLIST':
    case 'PROHIBITED_CONTENT':
    case 'SPII':
      return 'refusal';
    default:
      return 'end';
  }
}

export class GeminiProvider implements LlmProvider {
  readonly family = 'gemini' as const;
  readonly caps = { promptCache: false, deferredTools: false, webSearch: true };

  private config(req: CompleteRequest) {
    const tools: Tool[] = [];
    if (req.tools?.length) {
      tools.push({
        functionDeclarations: req.tools.map((t) => ({
          name: t.name,
          description: t.description,
          parametersJsonSchema: sanitizeSchema(t.input_schema),
        })),
      });
    }
    if (req.webSearch) tools.push({ googleSearch: {} });

    // Surface the server-side tool calls/responses (e.g. googleSearch grounding)
    // in the returned Content so our opaque round-trip preserves them across turns
    // — and force text-only when the caller asked for no tools this round.
    const toolConfig: ToolConfig = { includeServerSideToolInvocations: true };
    if (req.toolChoiceNone) {
      toolConfig.functionCallingConfig = { mode: FunctionCallingConfigMode.NONE };
    }

    return {
      maxOutputTokens: req.maxTokens,
      ...(req.system
        ? {
            systemInstruction: Array.isArray(req.system)
              ? req.system.filter(Boolean).join('\n\n')
              : req.system,
          }
        : {}),
      ...(tools.length ? { tools } : {}),
      toolConfig,
      ...(req.signal ? { abortSignal: req.signal } : {}),
    };
  }

  /** Build the neutral LlmResult from an assembled Gemini model turn. */
  private toResult(parts: Part[], finishReason: string | undefined, usage: GenerateContentResponse['usageMetadata'] | undefined): LlmResult {
    const { text, toolUses } = parseModelParts(parts);
    return {
      // Round-trip the raw parts verbatim (preserves thoughtSignatures + calls).
      assistantContent: [{ type: 'opaque', native: parts }],
      text,
      toolUses,
      stopReason: mapFinishReason(finishReason, toolUses.length > 0),
      usage: mapUsage(usage),
    };
  }

  stream(req: CompleteRequest): LlmStream {
    const textCbs: Array<(d: string) => void> = [];
    let resultPromise: Promise<LlmResult> | null = null;

    const run = async (): Promise<LlmResult> => {
      const iterable = await client().models.generateContentStream({
        model: req.modelId,
        contents: toContents(req.messages),
        config: this.config(req),
      });
      const parts: Part[] = [];
      let finishReason: string | undefined;
      let usage: GenerateContentResponse['usageMetadata'] | undefined;
      for await (const chunk of iterable) {
        const chunkParts = chunk.candidates?.[0]?.content?.parts ?? [];
        for (const p of chunkParts) {
          parts.push(p);
          if (typeof p.text === 'string' && p.text && !p.thought) {
            for (const cb of textCbs) cb(p.text);
          }
        }
        if (chunk.candidates?.[0]?.finishReason) finishReason = chunk.candidates[0].finishReason;
        if (chunk.usageMetadata) usage = chunk.usageMetadata;
      }
      return this.toResult(parts, finishReason, usage);
    };

    return {
      onText(cb) {
        textCbs.push(cb);
      },
      final() {
        if (!resultPromise) resultPromise = run();
        return resultPromise;
      },
    };
  }

  async complete(req: CompleteRequest): Promise<LlmResult> {
    const res = await client().models.generateContent({
      model: req.modelId,
      contents: toContents(req.messages),
      config: {
        ...this.config(req),
        // One-shot text/structured tasks (continuations, regenerate, compaction,
        // proposals, review copy) don't need extended reasoning. On Gemini, thinking
        // tokens bill against maxOutputTokens, so with the small budgets these callers
        // pass, the model can spend the whole allowance reasoning and return truncated
        // or empty output. Gemini 3 models reject thinkingBudget (incl. 0) with a 400 —
        // thinkingLevel is the only control — so minimise thinking AND add headroom so
        // the reasoning trace can't starve the actual answer. The streaming chat loop
        // keeps default thinking (it needs it for tool use, with a far larger budget).
        thinkingConfig: { thinkingLevel: ThinkingLevel.MINIMAL },
        maxOutputTokens: req.maxTokens + GEMINI_ONESHOT_THINKING_HEADROOM,
      },
    });
    const parts = res.candidates?.[0]?.content?.parts ?? [];
    return this.toResult(parts, res.candidates?.[0]?.finishReason, res.usageMetadata);
  }
}
