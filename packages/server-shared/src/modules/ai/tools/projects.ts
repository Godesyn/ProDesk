/**
 * Delivery & money-flow tools: projects, proposals, meetings, invoices, purchases.
 *
 * Each entry colocates the tool's model-facing definition (`def`) with its
 * server-side implementation (`run`). Read tools return data; action tools
 * only record a PendingAction the user must confirm client-side.
 */
import { obj, deriveInvoiceStatus, formatInvoiceNumber } from './helpers.js';
import {
  getBrandProject,
  getBrandProposal,
  getProjectChildren,
  getProposalChildren,
  listBrandInvoices,
  listBrandMeetings,
  listBrandProjects,
  listBrandProposals,
  listBrandPurchases,
  pendingReviewCountsByProject,
  purchaseItemsByPurchase,
} from '../../projects/queries.js';
import type { ToolEntry, ToolModuleCtx } from './types.js';

export function projectTools(ctx: ToolModuleCtx): ToolEntry[] {
  const { db, brandId, pendingActions } = ctx;
  return [
    {
      def: {
        name: 'list_active_projects',
        description: [
          "List THIS brand's active projects (everything except completed ones). Takes no arguments. Capped at 50 rows, newest first.",
          'Returns { count, projects } where projects is an array of:',
          '- id: project UUID.',
          '- title: project title (may be null).',
          '- serviceName: name of the service this project was created from (may be null for internal/custom work).',
          '- status: the workflow stage, one of these EXACT values (ordered earliest→latest): "clientBrief" (Client Brief), "upcoming" (Future Phases), "brief" (Brief), "allocate" (Allocate / assigning the team), "production" (Production — work in progress), "internalApproval" (Internal Approval by the agency), "revision" (Revision), "clientApproval" (Client Approval — awaiting the brand\'s sign-off). "completed" exists but is filtered OUT of this list.',
          '- createdAt: ISO timestamp the project was created.',
          '- pendingReview: INTEGER count of deliverables on this project currently awaiting review (status "pending"). Use it to flag projects that need the brand\'s attention. Call get_project_details for the full deliverable/note/revision history.',
        ].join('\n'),
        input_schema: obj({}),
      },
      run: async () => {
        // Shared query core (also the basis for the dashboard's project views).
        // viewableOnly matches the dashboard — the brand never sees hidden projects.
        const rows = await listBrandProjects(db, brandId, {
          excludeCompleted: true,
          viewableOnly: true,
          limit: 50,
        });
        const pendingByProject = await pendingReviewCountsByProject(db, rows.map((r) => r.id));
        return {
          count: rows.length,
          projects: rows.map((r) => ({
            id: r.id,
            title: r.title,
            status: r.status,
            serviceName: r.serviceName,
            createdAt: r.createdAt,
            pendingReview: pendingByProject.get(r.id) ?? 0,
          })),
        };
      },
    },
    {
      def: {
        name: 'get_project_details',
        description: [
          'Get the full detail of ONE of this brand\'s projects: its core fields plus deliverables, notes, and revision history. Use after list_active_projects when the user asks about a specific project ("where are we at on X", "what\'s awaiting review", "what feedback was given").',
          'Returns { error } if the projectId does not belong to this brand. Otherwise returns an object:',
          '- id, title, description, serviceName, status (same enum as list_active_projects, including "completed"), createdAt, deadline (ISO or null), revisionCount (INTEGER).',
          '- deliverables: array (capped 50, display order) of { id, type ("text"|"document"|"image"), fileName, description, status ("pending"|"approved"|"rejected"), source ("brand"|"agency"|"sales"|null = who provided it), rejectionReason (null unless rejected), uploadedAt }.',
          '- notes: array (capped 50, newest first) of { content, authorName, authorRole ("brand"|"agency"|"sales"|null), createdAt } — shared project notes.',
          '- revisions: array (capped 50, newest first) of { content, authorName, authorRole, createdAt } — revision-request history.',
        ].join('\n'),
        input_schema: obj(
          { projectId: { type: 'string', description: 'The project\'s id (the `id` field from list_active_projects). Must belong to this brand.' } },
          ['projectId'],
        ),
      },
      run: async (input: Record<string, unknown>) => {
        const projectId = String(input.projectId ?? '');
        const p = await getBrandProject(db, brandId, projectId);
        if (!p) return { error: 'That project does not belong to this brand.' };
        const { deliverables, notes, revisions } = await getProjectChildren(db, projectId, { limit: 50 });
        return {
          id: p.id,
          title: p.title,
          description: p.description,
          serviceName: p.serviceName,
          status: p.status,
          createdAt: p.createdAt,
          deadline: p.deadline,
          revisionCount: p.revisionCount,
          deliverables: deliverables.map((d) => ({
            id: d.id,
            type: d.type,
            fileName: d.fileName,
            description: d.description,
            status: d.status,
            source: d.source,
            rejectionReason: d.rejectionReason,
            uploadedAt: d.uploadedAt,
          })),
          notes: notes.map((n) => ({
            content: n.content,
            authorName: n.authorName,
            authorRole: n.authorRole,
            createdAt: n.createdAt,
          })),
          revisions: revisions.map((rv) => ({
            content: rv.content,
            authorName: rv.authorName,
            authorRole: rv.authorRole,
            createdAt: rv.createdAt,
          })),
        };
      },
    },
    {
      def: {
        name: 'list_proposals',
        description: [
          'List proposals this brand has received. Takes no arguments. Capped at 50 rows, newest first.',
          'Returns { count, proposals } where proposals is an array of:',
          '- id: proposal UUID. Pass this as proposalId to draft_proposal_reply.',
          '- title: proposal title (may be null).',
          '- totalAmount: total value as a STRING decimal in AUD dollars (e.g. "2500.00"), defaults to "0.00". NOT cents.',
          '- sentAt: ISO timestamp when the proposal was sent to the brand; null if it was never sent (e.g. still a draft).',
          '- status: one of these EXACT values: "draft" (not yet sent), "sent", "viewed" (brand opened it), "accepted" (the TERMINAL billable state — once accepted/paid it stays "accepted"; there is no later "paid" status), "rejected", "expired", "changeRequested" (brand asked for changes), "internal" (a non-billable proposal that creates projects internally without a client send). Note: "paid" is a deprecated value you will not normally see — treat "accepted" as the success state.',
        ].join('\n'),
        input_schema: obj({}),
      },
      run: async () => {
        // Shared query core; excludeDrafts matches the dashboard — brands never
        // see draft proposals.
        const rows = await listBrandProposals(db, brandId, { excludeDrafts: true, limit: 50 });
        return {
          count: rows.length,
          proposals: rows.map((r) => ({
            id: r.id,
            title: r.title,
            status: r.status,
            totalAmount: r.totalAmount,
            sentAt: r.sentAt,
          })),
        };
      },
    },
    {
      def: {
        name: 'get_proposal_details',
        description: [
          'Get the full detail of ONE proposal this brand received: core fields plus line items, phases, attached documents, and the comment thread. Use after list_proposals when the user wants to understand or respond to a specific proposal.',
          'Returns { error } if the proposalId does not belong to this brand. Otherwise returns an object:',
          '- id, title, description, status (same enum as list_proposals), totalAmount (STRING decimal AUD dollars, NOT cents), paymentTerms, termsAndConditions, clientNotes, changeRequestNote, validityDays (INTEGER or null), sentAt, expiresAt (ISO or null).',
          '- phases: array (display order) of { id, name, startDelayDays } — the staged plan; may be empty.',
          '- items: array (capped 100, display order) of { type ("service"|"heading"|"custom"), description, headingText, amount (STRING AUD dollars), quantity (INTEGER), isRecurring, billingCycle, isOptional, isExcludedByBrand (the brand opted this line out) }. "heading" rows are section labels, not billable lines.',
          '- documents: array of { fileName, fileType, url } — attachments. Share urls only if asked.',
          '- comments: array (capped 50, oldest first) of { authorName, authorRole ("brand"|"agency"|"sales"|null), message, createdAt } — the negotiation thread.',
        ].join('\n'),
        input_schema: obj(
          { proposalId: { type: 'string', description: 'The proposal\'s id (the `id` field from list_proposals). Must be addressed to this brand.' } },
          ['proposalId'],
        ),
      },
      run: async (input: Record<string, unknown>) => {
        const proposalId = String(input.proposalId ?? '');
        const p = await getBrandProposal(db, brandId, proposalId);
        if (!p) return { error: 'That proposal does not belong to this brand.' };
        const { phases, items, documents, comments } = await getProposalChildren(db, proposalId, {
          itemsLimit: 100,
          commentsLimit: 50,
        });
        return {
          id: p.id,
          title: p.title,
          description: p.description,
          status: p.status,
          totalAmount: p.totalAmount,
          paymentTerms: p.paymentTerms,
          termsAndConditions: p.termsAndConditions,
          clientNotes: p.clientNotes,
          changeRequestNote: p.changeRequestNote,
          validityDays: p.validityDays,
          sentAt: p.sentAt,
          expiresAt: p.expiresAt,
          phases: phases.map((ph) => ({ id: ph.id, name: ph.name, startDelayDays: ph.startDelayDays })),
          items: items.map((it) => ({
            type: it.type,
            description: it.description,
            headingText: it.headingText,
            amount: it.amount,
            quantity: it.quantity,
            isRecurring: it.isRecurring,
            billingCycle: it.billingCycle,
            isOptional: it.isOptional,
            isExcludedByBrand: it.isExcludedByBrand,
          })),
          documents: documents.map((d) => ({ fileName: d.fileName, fileType: d.fileType, url: d.url })),
          comments: comments.map((c) => ({
            authorName: c.authorName,
            authorRole: c.authorRole,
            message: c.message,
            createdAt: c.createdAt,
          })),
        };
      },
    },
    {
      def: {
        name: 'draft_proposal_reply',
        description: [
          'Draft a reply / notes for a proposal the brand received. Does NOT send — surfaces a draft for the user to review on the proposal. Use when the user wants help responding to a proposal.',
          'Returns { status: "awaiting_confirmation" } on success — the draft was shown to the user, NOT sent. Never claim it was sent. On failure returns { error } (e.g. the proposalId does not belong to this brand).',
        ].join('\n'),
        input_schema: obj(
          {
            proposalId: { type: 'string', description: 'The proposal\'s id (the `id` field from list_proposals). Must be a proposal addressed to this brand, or the call returns an error.' },
            message: { type: 'string', description: 'The drafted reply / notes, in plain text.' },
          },
          ['proposalId', 'message'],
        ),
      },
      run: async (input: Record<string, unknown>, toolUseId: string) => {
        const proposalId = String(input.proposalId ?? '');
        const message = String(input.message ?? '').trim();
        if (!message) return { error: 'The reply body cannot be empty.' };
        const p = await getBrandProposal(db, brandId, proposalId);
        if (!p) return { error: 'That proposal does not belong to this brand.' };
        pendingActions.push({ kind: 'proposal_reply', toolUseId, payload: { proposalId, title: p.title, message } });
        return { status: 'awaiting_confirmation', note: 'Draft surfaced to the user for review. Do not assume it was sent.' };
      },
    },
    {
      def: {
        name: 'list_meetings',
        description: [
          "List THIS brand's meetings/calls with agencies (past and upcoming). Takes no arguments. Capped at 50 rows, most recent first.",
          'Returns { count, meetings } where meetings is an array of:',
          '- id: meeting UUID.',
          '- serviceName: the service the meeting is about (may be null).',
          '- assigneeName: the agency-side person hosting (may be null).',
          '- status: one of "scheduled", "cancelled", "completed".',
          '- startTime / endTime: ISO timestamps (may be null).',
          '- meetUrl: the video-call link (may be null). Share it only if the user asks.',
        ].join('\n'),
        input_schema: obj({}),
      },
      run: async () => {
        // Shared query core (also backs the brand branch of meetings.list).
        const rows = await listBrandMeetings(db, brandId, { limit: 50 });
        return {
          count: rows.length,
          meetings: rows.map((r) => ({
            id: r.id,
            serviceName: r.serviceName,
            assigneeName: r.assigneeName,
            status: r.status,
            startTime: r.startTime,
            endTime: r.endTime,
            meetUrl: r.meetUrl,
          })),
        };
      },
    },
    {
      def: {
        name: 'list_invoices',
        description: [
          "List invoices billed TO this brand. Takes no arguments. Capped at 50 rows, newest first.",
          'Returns { count, invoices } where invoices is an array of:',
          '- id: invoice UUID.',
          '- number: the human-facing invoice id as a STRING (e.g. "#INV_0042").',
          '- total: total amount as a STRING decimal in AUD dollars (e.g. "1500.00"), NOT cents.',
          '- status: DERIVED status, one of "paid", "unpaid", "processing", "dispatched", "received", "processingByPaypal", "processingByWire", "processingByStripe". A brand charge with no linked payout always reads "paid".',
          '- issuedAt: ISO timestamp the invoice was created.',
        ].join('\n'),
        input_schema: obj({}),
      },
      run: async () => {
        // Shared query core (mirrors the brand branch of invoices.list): LEFT
        // joins so payments-sourced invoices (no purchase) also surface.
        const rows = await listBrandInvoices(db, brandId, { limit: 50 });
        return {
          count: rows.length,
          invoices: rows.map((r) => ({
            id: r.id,
            number: formatInvoiceNumber(r.number),
            total: r.total,
            status: deriveInvoiceStatus(r.payoutStatus),
            issuedAt: r.issuedAt,
          })),
        };
      },
    },
    {
      def: {
        name: 'list_purchases',
        description: [
          "List THIS brand's purchase history (what the brand has actually bought — distinct from proposals, which are offers, and invoices, which are billing). Takes no arguments. Capped at 50 rows, newest first.",
          'Returns { count, purchases } where purchases is an array of:',
          '- id: purchase UUID.',
          '- type: "marketplace" (bought directly) or "proposal" (from an accepted proposal).',
          '- status: one of "pending", "pendingPayment", "paid", "processing", "completed", "failed".',
          '- totalAmount: total as a STRING decimal in AUD dollars, NOT cents.',
          '- items: array of service names included in the purchase (may be empty).',
          '- createdAt / completedAt: ISO timestamps (completedAt may be null).',
        ].join('\n'),
        input_schema: obj({}),
      },
      run: async () => {
        // Shared query core (also backs purchases.list); excludeInternal matches
        // the dashboard — internal/complimentary purchases stay out of order history.
        const rows = await listBrandPurchases(db, brandId, { excludeInternal: true, limit: 50 });
        const itemsByPurchase = await purchaseItemsByPurchase(db, rows.map((r) => r.id));
        return {
          count: rows.length,
          purchases: rows.map((r) => ({
            id: r.id,
            type: r.type,
            status: r.status,
            totalAmount: r.totalAmount,
            createdAt: r.createdAt,
            completedAt: r.completedAt,
            items: (itemsByPurchase.get(r.id) ?? []).map((it) => it.serviceName).filter((n): n is string => !!n),
          })),
        };
      },
    },
  ];
}
