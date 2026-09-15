import type { DB } from '../../../db/index.js';

/** SDK-agnostic tool definition (cast to the Anthropic tool union at the call site). */
export interface ToolDef {
  name: string;
  description: string;
  input_schema: {
    type: 'object';
    properties: Record<string, unknown>;
    required?: string[];
    additionalProperties?: boolean;
  };
  /**
   * Anthropic tool search: when true, this tool's schema stays OUT of the
   * model's context until it discovers the tool via the tool-search tool
   * (chat.ts adds that tool to every request). The full definition is still
   * sent on every request — the API needs it server-side to run the search and
   * expand results. Keep the highest-frequency tools non-deferred.
   */
  defer_loading?: boolean;
}

/** A write action the model proposed; surfaced to the client for confirmation. */
export interface PendingAction {
  // `agency_message` / `proposal_reply` / `marketplace_inquiry` surface a DRAFT
  // the user copies/sends manually. `agency_connection` / `create_task` /
  // `update_profile` are confirm-then-EXECUTE: the client performs the write (via
  // tRPC) when the user confirms the card. Nothing is written server-side from
  // the AI turn itself.
  kind:
    | 'agency_message'
    | 'proposal_reply'
    | 'marketplace_inquiry'
    | 'agency_connection'
    | 'create_task'
    | 'update_profile'
    | 'invite_staff_member'
    | 'set_brand_policy'
    | 'send_review_request'
    | 'create_short_link'
    | 'toggle_short_link'
    | 'create_service'
    | 'update_directory_listing'
    | 'create_review_location'
    | 'update_review_location'
    | 'update_review_platform'
    | 'update_review_win_tags'
    | 'create_link_campaign'
    | 'update_link_campaign'
    | 'add_campaign_window'
    | 'remove_campaign_window'
    | 'update_short_link'
    | 'update_qr_style'
    | 'save_embed_style'
    | 'save_embed_collection'
    | 'add_signature_members'
    | 'update_signature_member'
    | 'update_signature_settings'
    | 'create_signature_campaign'
    | 'create_support_ticket'
    | 'create_brand'
    // ── Chat, the messenger (tools/messenger.ts) ─────────────────────────
    // These act as the PERSON, not the brand, and every one is executed
    // client-side on confirm through the ordinary chat procedures — see that
    // module's header for why nothing here may write server-side.
    | 'send_chat_message'
    | 'create_chat_group'
    | 'update_chat_members'
    | 'rename_chat_group'
    | 'invite_to_chat'
    | 'answer_chat_request'
    | 'update_chat_conversation'
    | 'ask_user'
    // Requests the user's browser location (permission-gated). Like ask_user it
    // writes nothing — the shared coords/place come back as the card's edits.
    | 'request_user_location';
  toolUseId: string;
  payload: Record<string, unknown>;
}

/**
 * Billing context attached to a PAID confirm action's payload so the confirm
 * card can disclose the money impact and the card that will be charged BEFORE
 * the user commits. Rendered verbatim by the card UI — keep `summary` short,
 * factual, and in dollars.
 */
export interface ActionBilling {
  /** One-line human summary of the money impact of confirming this action. */
  summary: string;
  /** Recurring monthly amount (in dollars) this action ADDS, when known. */
  monthlyDelta: number | null;
  currency: string;
  /** The owner's saved card the charge will go to (null = no card on file). */
  cardBrand: string | null;
  cardLast4: string | null;
  /** True when the owner has no active subscription for this feature yet, so
   *  confirming will also start one (charging the card on file, or opening
   *  Stripe Checkout when there is none). */
  requiresCheckout: boolean;
}

/**
 * Per-turn context shared by every tool module. Built once per AI turn by
 * buildTools (tools/index.ts), hard-bound to a single brandId — every read is
 * scoped to that brand, so the model can never reach another brand's data.
 */
export interface ToolModuleCtx {
  db: DB;
  brandId: string;
  /**
   * The PERSON who sent this turn.
   *
   * Almost every tool is brand-scoped and ignores this. The messenger tools
   * cannot be: a DM belongs to a person, not to a brand, so their reads are
   * scoped to this id and nothing else. Null only in the degenerate case where a
   * turn is run without a user, in which case those tools decline rather than
   * widening their scope.
   */
  userId: string | null;
  /** The AI thread this turn belongs to — scopes the AI-owned plan (ai_plan_items). */
  threadId: string;
  /** Confirm-action cards recorded this turn; the client renders + settles them. */
  pendingActions: PendingAction[];
  /** Mutable per-turn flags read by chat.ts after the turn. */
  flags: { settlementFollowup: boolean };
  /** Lazily-resolved derived shadow agency id for the brand (null = none). */
  getShadowAgencyId: () => Promise<string | null>;
}

/**
 * One tool: the model-facing definition colocated with its implementation.
 * `run` returns a JSON-serialisable value that becomes the tool_result the
 * model reads — read tools return data, action tools return
 * { status: 'awaiting_confirmation', ... } after recording a PendingAction.
 */
export interface ToolEntry {
  def: ToolDef;
  run: (input: Record<string, unknown>, toolUseId: string) => Promise<unknown>;
}
