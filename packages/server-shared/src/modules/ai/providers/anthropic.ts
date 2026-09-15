import Anthropic from '@anthropic-ai/sdk';
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
 * Anthropic (Claude) provider. Owns the SDK client and translates the neutral
 * request/response shapes to and from Anthropic's native message/content/tool
 * types. Keeps the two Anthropic-only capabilities the app relies on:
 *   • ephemeral prompt caching (cache_control breakpoints), and
 *   • the hosted tool-search + web-search server tools.
 */

/** Anthropic's server-side tool-search tool. Never deferred; expands deferred tools on demand. */
const TOOL_SEARCH_TOOL = { type: 'tool_search_tool_regex_20251119', name: 'tool_search_tool_regex' } as const;

/** Anthropic's hosted web-search tool. Biased to AU (brands operate there); capped per turn. */
const WEB_SEARCH_TOOL = {
  type: 'web_search_20250305',
  name: 'web_search',
  max_uses: 5,
  user_location: { type: 'approximate', country: 'AU' },
} as const;

let _client: Anthropic | null = null;
function client(): Anthropic {
  if (!env.ANTHROPIC_API_KEY) {
    throw new Error('ANTHROPIC_API_KEY is not configured — the Anthropic provider is unavailable.');
  }
  if (!_client) _client = new Anthropic({ apiKey: env.ANTHROPIC_API_KEY });
  return _client;
}

const EPHEMERAL = { type: 'ephemeral' as const };

/** Translate one neutral block to an Anthropic content block. */
function toNativeBlock(b: NeutralBlock): unknown {
  switch (b.type) {
    case 'text':
      return { type: 'text', text: b.text };
    case 'image':
      return { type: 'image', source: { type: 'base64', media_type: b.mediaType, data: b.dataBase64 } };
    case 'document':
      return {
        type: 'document',
        title: b.name,
        source: { type: 'base64', media_type: b.mediaType, data: b.dataBase64 },
      };
    case 'tool_use':
      return { type: 'tool_use', id: b.id, name: b.name, input: b.input };
    case 'tool_result':
      return {
        type: 'tool_result',
        tool_use_id: b.toolUseId,
        content: b.content,
        ...(b.isError ? { is_error: true } : {}),
      };
    case 'opaque':
      // Round-trip our own previously-emitted native content verbatim.
      return b.native;
  }
}

/** Translate neutral messages → Anthropic message params, applying the cache breakpoint. */
function toNativeMessages(messages: NeutralMessage[]): unknown[] {
  const out = messages.map((m) => {
    const content =
      typeof m.content === 'string' ? m.content : m.content.map(toNativeBlock);
    return { role: m.role, content };
  });
  // Prompt-cache breakpoint on the last block of the last message: the API caches
  // the whole prefix up to it, so the byte-identical history prefix replays from
  // cache (~0.1× input) instead of being reprocessed. Prefixes below the model's
  // minimum simply don't cache (no error).
  const last = out[out.length - 1] as { content: unknown } | undefined;
  if (last) {
    if (typeof last.content === 'string') {
      last.content = [{ type: 'text', text: last.content, cache_control: EPHEMERAL }];
    } else if (Array.isArray(last.content) && last.content.length > 0) {
      const blocks = last.content as Array<Record<string, unknown>>;
      const tail = blocks[blocks.length - 1];
      if (tail && typeof tail === 'object') {
        blocks[blocks.length - 1] = { ...tail, cache_control: EPHEMERAL };
      }
    }
  }
  return out;
}

/** Map an Anthropic response's native content to neutral assistant blocks (round-trippable). */
function toNeutralAssistant(content: unknown[]): NeutralBlock[] {
  return content.map((raw): NeutralBlock => {
    const b = raw as { type: string; text?: string; id?: string; name?: string; input?: unknown };
    if (b.type === 'text') return { type: 'text', text: b.text ?? '' };
    if (b.type === 'tool_use') {
      return { type: 'tool_use', id: b.id ?? '', name: b.name ?? '', input: (b.input as Record<string, unknown>) ?? {} };
    }
    // server_tool_use / web_search_tool_result / anything else: preserve verbatim
    // so a paused turn can be resumed by replaying it.
    return { type: 'opaque', native: raw };
  });
}

function extractText(content: unknown[]): string {
  return content
    .map((raw) => {
      const b = raw as { type: string; text?: string };
      return b.type === 'text' ? b.text ?? '' : '';
    })
    .join('');
}

function extractToolUses(content: unknown[]): ToolUseBlock[] {
  const uses: ToolUseBlock[] = [];
  for (const raw of content) {
    const b = raw as { type: string; id?: string; name?: string; input?: unknown };
    if (b.type === 'tool_use') {
      uses.push({ type: 'tool_use', id: b.id ?? '', name: b.name ?? '', input: (b.input as Record<string, unknown>) ?? {} });
    }
  }
  return uses;
}

function mapStopReason(reason: string | null | undefined): StopReason {
  switch (reason) {
    case 'tool_use':
      return 'tool_use';
    case 'pause_turn':
      return 'pause';
    case 'refusal':
      return 'refusal';
    case 'max_tokens':
      return 'max_tokens';
    default:
      return 'end';
  }
}

function mapUsage(usage: unknown): NormalizedUsage {
  const u = (usage ?? {}) as {
    input_tokens?: number;
    output_tokens?: number;
    cache_read_input_tokens?: number;
    cache_creation_input_tokens?: number;
    server_tool_use?: { web_search_requests?: number } | null;
  };
  return {
    inputTokens: u.input_tokens ?? 0,
    outputTokens: u.output_tokens ?? 0,
    cacheReadTokens: u.cache_read_input_tokens ?? 0,
    cacheWriteTokens: u.cache_creation_input_tokens ?? 0,
    webSearchRequests: u.server_tool_use?.web_search_requests ?? 0,
  };
}

export class AnthropicProvider implements LlmProvider {
  readonly family = 'anthropic' as const;
  readonly caps = { promptCache: true, deferredTools: true, webSearch: true };

  /** Model ids observed to reject the tool-search tool (400) — degrade for the rest of the process. */
  private toolSearchUnsupported = new Set<string>();

  /** Assemble the Anthropic tool array for a request. `withSearch=false` strips the
   *  search tool and the defer_loading flags (the graceful-degradation path). */
  private buildTools(req: CompleteRequest, withSearch: boolean): unknown[] {
    const webSearch = req.webSearch ? [WEB_SEARCH_TOOL] : [];
    const defs = req.tools ?? [];
    if (withSearch) {
      return [TOOL_SEARCH_TOOL, ...webSearch, ...defs];
    }
    return [...webSearch, ...defs.map(({ defer_loading: _d, ...rest }) => rest)];
  }

  /** System → native. Each segment becomes its own text block; cached segments
   *  carry a cache_control breakpoint so a volatile tail doesn't bust the head. */
  private buildSystem(system: string | string[], cached: boolean): unknown {
    const segs = (Array.isArray(system) ? system : [system]).filter(Boolean);
    if (!cached) return segs.join('\n\n');
    return segs.map((text) => ({ type: 'text', text, cache_control: EPHEMERAL }));
  }

  private baseParams(req: CompleteRequest, withSearch: boolean, cachedSystem: boolean): Record<string, unknown> {
    const hasSystem = Array.isArray(req.system) ? req.system.length > 0 : !!req.system;
    return {
      model: req.modelId,
      max_tokens: req.maxTokens,
      ...(hasSystem ? { system: this.buildSystem(req.system as string | string[], cachedSystem) } : {}),
      ...(req.tools?.length || req.webSearch ? { tools: this.buildTools(req, withSearch) } : {}),
      messages: toNativeMessages(req.messages),
      ...(req.toolChoiceNone ? { tool_choice: { type: 'none' } } : {}),
    };
  }

  stream(req: CompleteRequest): LlmStream {
    const textCbs: Array<(d: string) => void> = [];
    let resultPromise: Promise<LlmResult> | null = null;

    const run = async (): Promise<LlmResult> => {
      const opts = req.signal ? { signal: req.signal } : undefined;
      const attempt = (withSearch: boolean) => {
        const params = this.baseParams(req, withSearch, true);
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const s = client().messages.stream(params as any, opts);
        s.on('text', (delta: string) => {
          for (const cb of textCbs) cb(delta);
        });
        return s;
      };

      const useSearch = this.caps.deferredTools && !this.toolSearchUnsupported.has(req.modelId);
      let s = attempt(useSearch);
      let msg: Anthropic.Messages.Message;
      try {
        msg = await s.finalMessage();
      } catch (err) {
        const message = (err as Error)?.message ?? '';
        // Model rejected tool search / deferred loading (validation error → nothing
        // streamed). Remember it and retry once with the full, undeferred tool list.
        if (useSearch && /tool_search|defer_loading|deferred/i.test(message)) {
          console.error(`[ai] tool search rejected on ${req.modelId}; falling back to full tool list`, message);
          this.toolSearchUnsupported.add(req.modelId);
          s = attempt(false);
          msg = await s.finalMessage();
        } else {
          throw err;
        }
      }
      const content = msg.content as unknown[];
      return {
        assistantContent: toNeutralAssistant(content),
        text: extractText(content),
        toolUses: extractToolUses(content),
        stopReason: mapStopReason(msg.stop_reason),
        usage: mapUsage(msg.usage),
      };
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
    const params = this.baseParams(req, this.caps.deferredTools && !this.toolSearchUnsupported.has(req.modelId), false);
    // One-shot text/structured tasks (continuations, regenerate, compaction,
    // proposals, review copy) don't need extended reasoning. Claude's newer models
    // think by default, and thinking tokens count against max_tokens — so with the
    // small budgets these callers pass, the model can spend the entire allowance on
    // an (empty) thinking block and return no visible text (stop_reason max_tokens).
    // Disable it here; the streaming chat loop keeps thinking for tool use.
    params.thinking = { type: 'disabled' };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const res = (await client().messages.create(params as any, req.signal ? { signal: req.signal } : undefined)) as Anthropic.Messages.Message;
    const content = res.content as unknown[];
    return {
      assistantContent: toNeutralAssistant(content),
      text: extractText(content),
      toolUses: extractToolUses(content),
      stopReason: mapStopReason(res.stop_reason),
      usage: mapUsage(res.usage),
    };
  }
}
