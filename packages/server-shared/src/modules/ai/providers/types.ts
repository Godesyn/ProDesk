/**
 * Provider-neutral LLM layer. Everything above this line (chat.ts, memory.ts,
 * compaction.ts, the one-shot helpers) speaks these neutral shapes; each concrete
 * provider (anthropic.ts, gemini.ts) translates neutral → its native SDK types at
 * its own boundary. Adding a new provider = one file implementing `LlmProvider`
 * plus a family entry in registry.ts — no call-site edits.
 */

/**
 * The provider families the app can run against. Extend as providers are added.
 */
export type ProviderFamily = 'anthropic' | 'gemini';

// ── Neutral content blocks ────────────────────────────────────────────────────
// A superset of what any one provider needs. Providers translate the blocks they
// support and must tolerate the rest (e.g. render an unsupported block as text).

export interface TextBlock {
  type: 'text';
  text: string;
}
export interface ImageBlock {
  type: 'image';
  mediaType: string;
  /** base64-encoded bytes. Inlined (not a URL) because not every provider can
   *  fetch an arbitrary URL — Anthropic sends a base64 source, Gemini inlineData. */
  dataBase64: string;
}
export interface DocumentBlock {
  type: 'document';
  name: string;
  mediaType: string;
  /** base64-encoded bytes (already fetched + size-checked by buildAttachmentBlocks). */
  dataBase64: string;
}
/** An assistant tool call. */
export interface ToolUseBlock {
  type: 'tool_use';
  id: string;
  name: string;
  input: Record<string, unknown>;
}
/** The result of running a tool, fed back on the next user turn. */
export interface ToolResultBlock {
  type: 'tool_result';
  toolUseId: string;
  /** The tool's name. Anthropic keys results by id, but Gemini correlates a
   *  functionResponse to its call by NAME — so carry both. */
  toolName?: string;
  /** JSON-stringified tool output the model reads. */
  content: string;
  isError?: boolean;
}

/**
 * Provider-native content the shared layer must carry back verbatim but never
 * needs to understand — e.g. Anthropic's server_tool_use / web_search_result
 * blocks, which the API needs replayed to resume a paused turn. The producing
 * provider round-trips its own `native` payload; other providers ignore it.
 */
export interface OpaqueBlock {
  type: 'opaque';
  native: unknown;
}

export type NeutralBlock =
  | TextBlock
  | ImageBlock
  | DocumentBlock
  | ToolUseBlock
  | ToolResultBlock
  | OpaqueBlock;

/**
 * One conversation message. `content` is either a plain string (the common case
 * for replayed history) or an array of neutral blocks (current turn, attachments,
 * assistant tool calls, tool results).
 */
export interface NeutralMessage {
  role: 'user' | 'assistant';
  content: string | NeutralBlock[];
}

/** Provider-neutral tool definition (same shape the tool registry already emits). */
export interface NeutralToolDef {
  name: string;
  description: string;
  input_schema: {
    type: 'object';
    properties: Record<string, unknown>;
    required?: string[];
    additionalProperties?: boolean;
  };
  /**
   * Anthropic tool-search deferral hint. Providers without a hosted tool-search
   * ignore this and send every tool each turn (see LlmCaps.deferredTools).
   */
  defer_loading?: boolean;
}

// ── Request / response ─────────────────────────────────────────────────────────

export interface CompleteRequest {
  /** Concrete provider model id (resolved from the family by the caller). */
  modelId: string;
  maxTokens: number;
  /** System prompt. A string, or ordered segments the provider may cache/join
   *  independently (Anthropic → one cached block each; Gemini → joined into one
   *  systemInstruction). Segments let a volatile tail (e.g. the skills section)
   *  invalidate a prefix cache without disturbing the stable head. */
  system?: string | string[];
  messages: NeutralMessage[];
  tools?: NeutralToolDef[];
  /** Force the model to answer with text only (no tool calls) this round. */
  toolChoiceNone?: boolean;
  /** Offer the provider's hosted web search this round (skill-gated by the caller). */
  webSearch?: boolean;
  signal?: AbortSignal;
}

/**
 * Token/usage counts normalised across providers, BEFORE pricing. Each provider
 * maps its native usage object onto this; the shared layer (pricing.ts) turns it
 * into a costed ComputedUsage. Keeping providers cost-agnostic means they depend
 * on nothing but this file.
 */
export interface NormalizedUsage {
  /** Fresh (uncached) input tokens. */
  inputTokens: number;
  outputTokens: number;
  /** Input tokens served from cache (Anthropic cache read / Gemini cachedContent). */
  cacheReadTokens: number;
  /** Input tokens written to cache (Anthropic cache creation; 0 for providers with
   *  no explicit cache-write charge, e.g. Gemini implicit caching). */
  cacheWriteTokens: number;
  /** Hosted web-search calls made this round (billed per request on top of tokens). */
  webSearchRequests: number;
}

/** Why a round stopped. Normalised across providers. */
export type StopReason =
  | 'end' // model finished its answer
  | 'tool_use' // model wants tools run
  | 'pause' // hosted server-tool loop paused; resend to resume (Anthropic)
  | 'refusal' // model declined
  | 'max_tokens'; // hit the output cap

export interface LlmResult {
  /**
   * Assistant content as neutral blocks (text + tool_use), to be pushed back into
   * the conversation verbatim so the next round has the model's own tool calls.
   */
  assistantContent: NeutralBlock[];
  /** Concatenated visible text of this round (for persisting the chat bubble). */
  text: string;
  /** Tool calls the model made this round (empty unless stopReason==='tool_use'). */
  toolUses: ToolUseBlock[];
  stopReason: StopReason;
  /** Normalised (un-priced) token usage; the caller prices it via pricing.ts. */
  usage: NormalizedUsage;
}

/** A live streaming round. `onText` fires per delta; `final()` resolves once done. */
export interface LlmStream {
  onText(cb: (delta: string) => void): void;
  final(): Promise<LlmResult>;
}

/** Static capabilities of a provider — lets the shared code branch without `instanceof`. */
export interface LlmCaps {
  /** Ephemeral prompt caching via applyMessageCache (Anthropic). */
  promptCache: boolean;
  /** Hosted tool-search / deferred tool loading (Anthropic). When false, callers
   *  send the full tool list every turn and `defer_loading` is ignored. */
  deferredTools: boolean;
  /** Hosted web search available (Anthropic web_search / Gemini google_search). */
  webSearch: boolean;
}

/**
 * A concrete LLM backend. One instance per family, constructed lazily by the
 * registry once its API key is present.
 */
export interface LlmProvider {
  readonly family: ProviderFamily;
  readonly caps: LlmCaps;
  /** Streaming multi-round chat (the main assistant loop). */
  stream(req: CompleteRequest): LlmStream;
  /** One-shot completion (compaction, continuations, regenerate, proposals, …). */
  complete(req: CompleteRequest): Promise<LlmResult>;
}
