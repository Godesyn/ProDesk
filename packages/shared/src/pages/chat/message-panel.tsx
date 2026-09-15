import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Virtuoso, type VirtuosoHandle } from 'react-virtuoso';
import { useStickToBottom } from './stick-to-bottom';
import {
  Paperclip,
  Send,
  Users,
  FileText,
  Check,
  CheckCheck,
  Folder,
  CalendarClock,
  X,
  ArrowLeft,
  ChevronDown,
  Loader2,
  AlertCircle,
  RotateCcw,
  Trash2,
  Square,
  ThumbsUp,
  ThumbsDown,
  RefreshCw,
  Sparkles,
  Copy,
  Link2,
  ListPlus,
  Pencil,
  Mail,
  Power,
  Package,
  ExternalLink,
  Globe,
  MapPin,
  QrCode,
  Palette,
  LayoutGrid,
  Star,
  Tag,
  UserPlus,
  UserMinus,
  CreditCard,
  Megaphone,
  LifeBuoy,
  Building2,
  HelpCircle,
  SmilePlus,
  CornerUpLeft,
  MoreHorizontal,
  BellOff,
  ChevronLeft,
} from 'lucide-react';
import { useTRPC } from '../../lib/trpc';
import { useCurrentUser } from '../../auth/auth-context';
import { StorageBucket } from '../../lib/storage-buckets';
import { uploadFile, type UploadProgress } from '../../lib/storage';
import { UploadProgressBar } from '../../components/upload-progress';
import { useFileViewer } from '../../components/file-viewer/file-viewer-provider';
import { cn, initialsOf } from '../../lib/utils';
import { useIsMobile } from '../../hooks/use-is-mobile';
import { Button } from '../../components/ui/button';
import { Skeleton } from '../../components/ui/skeleton';
import { Avatar, AvatarFallback, AvatarImage } from '../../components/ui/avatar';
import { EmptyState } from '../../components/layout/empty-state';
import { MessageSquare } from 'lucide-react';
import { MembersDialog, type ThreadMember } from './members-dialog';
import { AttachmentBlock } from './attachment-block';
import { MessageActionSheet } from './message-action-sheet';
import { LinkCard, MessageText } from './link-card';
import { firstLink } from './links';
import { useLongPress } from '../../hooks/use-long-press';
import { anchorOf, placeBeside } from '../../lib/popover-anchor';
import {
  projectStatusColor,
  projectStatusLabel,
  roleColorClass,
  shouldShowTimeDivider,
  timeDividerLabel,
  type ChatIdentity,
} from './chat-types';
import { usePendingMessages, type PendingMessage } from './pending-messages';
import { QUICK, GRID, summarise, type ReactionSummary } from './emoji';
import { MUTE_FOREVER, MUTE_OPTIONS, muteLabel } from './mute';
import { Markdown } from '../../components/markdown';
import { PlacesAddressInput, type PlacePick } from '../../components/ui/places-address-input';
import { EditableCardFields, validateFields, type FieldSpec, type FieldType } from './editable-card-fields';
import { streamAiChat, type AiAttachment, type AiActionBilling, type AiPendingAction } from '../../lib/ai-stream';
import {
  useAiThread,
  patchAiThread,
  appendAiDelta,
  getAiAbort,
  setAiAbort,
} from './ai-chat-store';
import { joinThreadChannel, sendThreadBroadcast } from './chat-channel';
import { createCoalescer, createInvalidator } from '../../lib/coalesce';
import { toast } from 'sonner';
import { toastError } from '../../lib/errors';
import { checkoutReturnUrls } from '../../lib/url';
import { useLocation } from 'wouter';
import { GrowthUpsellCard } from '../../components/feature-subscriptions/growth-upsell-card';
import { AiThinkingVerb, AiThinkingHint } from '../../components/chat/ai-thinking-verb';
import { useCrossAppOpen } from '../../auth/use-cross-app';
import { PRODESK_ORIGINS } from '../../lib/origins';

/** Extensions blocked on the AI thread (the model can't take video/audio). */
const AI_BLOCKED_EXTS = new Set([
  'mp4', 'mov', 'avi', 'mkv', 'webm', 'm4v', '3gp',
  'mp3', 'wav', 'm4a', 'aac', 'ogg', 'flac', 'oga', 'opus', 'wma',
]);
const AI_ACCEPT = 'image/*,application/pdf,.txt,.md,.csv,.json,.tsv,.xml,.yaml,.yml,.log,.doc,.docx';

function aiAttachmentKind(name: string): AiAttachment['kind'] {
  const ext = name.split('.').pop()?.toLowerCase() ?? '';
  if (['jpg', 'jpeg', 'png', 'gif', 'webp'].includes(ext)) return 'image';
  if (['txt', 'md', 'csv', 'tsv', 'json', 'xml', 'yaml', 'yml', 'log'].includes(ext)) return 'text';
  return 'document';
}

const AI_SUGGESTIONS = [
  'Help me set things up',
  'Help me find services',
  'How should i upskill my business',
  'Help me grow my business',
];

/**
 * The persisted state of one confirm card: null = still awaiting the user;
 * 'confirmed' = the write ran (show done + View); 'rejected' = the user dismissed
 * it (show a muted dismissed state). Derived from the message's actionOutcomes.
 */
export type ActionOutcome = 'confirmed' | 'rejected' | null;

/**
 * The persisted outcome of one card on a message. Prefers the per-action
 * actionOutcomes map; falls back to the legacy resolvedActionIds set (whose
 * entries predate outcome tracking) as 'rejected' so old dismissed cards stay
 * dismissed rather than re-opening.
 */
function actionOutcomeOf(m: MessageItem, toolUseId: string): ActionOutcome {
  const o = m.actionOutcomes?.[toolUseId];
  if (o === 'confirmed' || o === 'rejected') return o;
  if (m.resolvedActionIds?.includes(toolUseId)) return 'rejected';
  return null;
}

/**
 * The resolved footer of a confirm card. Confirmed → a done label plus a "View"
 * button that opens the relevant screen in whichever frontend owns the feature
 * (via the cross-app auth hand-off). Rejected → a muted "Dismissed" marker.
 */
function ResolvedBadge({ action, outcome, doneLabel }: { action: AiPendingAction; outcome: 'confirmed' | 'rejected'; doneLabel: string }) {
  const openCrossApp = useCrossAppOpen();
  if (outcome === 'rejected') {
    return (
      <span className="flex items-center gap-1 text-xs font-medium text-ink-40">
        <X className="h-3.5 w-3.5" /> Dismissed
      </span>
    );
  }
  const target = getViewTarget(action);
  return (
    <>
      <span className="flex items-center gap-1 text-xs font-medium text-accent">
        <Check className="h-3.5 w-3.5" /> {doneLabel}
      </span>
      {target && (
        <Button variant="ghost" size="sm" onClick={() => void openCrossApp(target.host, target.path, { newWindow: true })}>
          <ExternalLink className="mr-1 h-3.5 w-3.5" /> View
        </Button>
      )}
    </>
  );
}

/**
 * A confirm-gated action the AI proposed. The bot never acts on its own. Two shapes:
 *  - DRAFT kinds (agency_message / proposal_reply / marketplace_inquiry): surface
 *    text the user copies and sends manually (no server write, so no "confirmed"
 *    state — only Copy + Dismiss).
 *  - EXECUTE kinds (agency_connection / create_task / update_profile / …): a confirm
 *    button performs the write via tRPC when the user clicks it.
 *
 * `outcome` is the card's persisted state; cards render inline under their AI
 * message and stay put as the conversation continues.
 */
/**
 * A structured question form the AI surfaced via `ask_user`: labelled, validated
 * inputs the user fills in. Unlike every other card it performs NO write — the
 * user's answers are simply recorded as the card outcome and fed back to the
 * assistant next turn so it can continue. Submit is blocked while any field is
 * invalid; required fields must be answered.
 */
function AiAskUserCard({
  action,
  onReject,
  outcome,
  onConfirmed,
  savedEdits,
}: {
  action: AiPendingAction;
  onReject: () => void;
  outcome: ActionOutcome;
  onConfirmed: (edits?: Record<string, unknown>) => void;
  savedEdits?: Record<string, unknown>;
}) {
  const specs = (Array.isArray(action.payload.fields) ? action.payload.fields : []) as FieldSpec[];
  const prompt = action.payload.prompt ? String(action.payload.prompt) : '';
  // Seed from the persisted answers when the card was already submitted (so a
  // reload/remount still shows what the user answered), else blank inputs.
  const [values, setValues] = useState<Record<string, unknown>>(() =>
    Object.fromEntries(specs.map((s) => [s.key, savedEdits?.[s.key] ?? ''])),
  );
  const errors = validateFields(specs, values);
  const hasErrors = Object.keys(errors).length > 0;
  const done = outcome === 'confirmed';
  const rejected = outcome === 'rejected';
  const submit = () => onConfirmed(Object.fromEntries(specs.map((s) => [s.key, values[s.key]])));
  // Once settled, show the recorded answers (prefer the persisted edits).
  const shown = outcome && savedEdits ? { ...values, ...savedEdits } : values;

  return (
    <div className={cn('rounded-[var(--radius-md)] border border-[color:var(--color-border-default)] bg-card p-3', rejected && 'opacity-60')}>
      <div className="mb-1.5 flex items-center gap-2 text-xs font-semibold text-ink-100">
        <HelpCircle className="h-3.5 w-3.5 text-accent" /> {prompt || 'A few quick questions'}
        <span className="ml-auto rounded-full bg-inset px-2 py-0.5 text-[10px] font-medium text-ink-40">
          {done ? 'Answered' : rejected ? 'Dismissed' : 'Your answer'}
        </span>
      </div>
      <div className="rounded-[var(--radius-sm)] bg-inset px-2.5 py-2 text-sm text-ink-100">
        <EditableCardFields
          specs={specs}
          values={shown}
          errors={outcome ? {} : errors}
          onChange={(k, v) => setValues((s) => ({ ...s, [k]: v }))}
          disabled={!!outcome}
        />
      </div>
      <div className="mt-2 flex items-center justify-end gap-2">
        {outcome ? (
          <ResolvedBadge action={action} outcome={outcome} doneLabel="Answered" />
        ) : (
          <>
            <Button variant="ghost" size="sm" onClick={onReject}>
              Dismiss
            </Button>
            <Button variant="accent" size="sm" onClick={submit} disabled={hasErrors}>
              <Check className="mr-1 h-3.5 w-3.5" /> Submit answers
            </Button>
          </>
        )}
      </div>
    </div>
  );
}

/**
 * Reverse-geocode approximate coordinates to a place name using BigDataCloud's
 * free, keyless client endpoint (built for exactly this — browser geolocation →
 * city, no API key, CORS-enabled). Best-effort: on any failure we return {} and
 * the card falls back to sharing raw coordinates, which the assistant can still use.
 */
async function reverseGeocode(lat: number, lon: number): Promise<{ city?: string; region?: string; country?: string }> {
  try {
    const res = await fetch(
      `https://api.bigdatacloud.net/data/reverse-geocode-client?latitude=${lat}&longitude=${lon}&localityLanguage=en`,
    );
    if (!res.ok) return {};
    const j = (await res.json()) as { city?: string; locality?: string; principalSubdivision?: string; countryName?: string };
    return {
      city: (j.city || j.locality || '').trim() || undefined,
      region: (j.principalSubdivision || '').trim() || undefined,
      country: (j.countryName || '').trim() || undefined,
    };
  } catch {
    return {};
  }
}

/**
 * The AI asked to use the user's location (via `request_user_location`, unlocked
 * by the Location skill). Like the ask_user form it performs NO write — the
 * resolved locale is recorded as the card's edits and fed back to the assistant
 * next turn. Two ways to answer:
 *   • "Share my location" → the browser prompts for permission and we resolve the
 *     approximate position (+ a place name, best-effort via reverseGeocode).
 *   • Manual search → a Google Places lookup (the shared `places` router) so a
 *     user who blocks/declines the browser prompt can still pick their city or
 *     address. Revealed automatically when the browser prompt fails, or via the
 *     "enter it manually" link. Degrades to plain typed text when Places has no
 *     server key (the picked/typed address is sent without coordinates).
 * Dismissing records a plain rejection.
 */
function AiLocationCard({
  action,
  onReject,
  outcome,
  onConfirmed,
  savedEdits,
}: {
  action: AiPendingAction;
  onReject: () => void;
  outcome: ActionOutcome;
  onConfirmed: (edits?: Record<string, unknown>) => void;
  savedEdits?: Record<string, unknown>;
}) {
  const [mode, setMode] = useState<'share' | 'search'>('share');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [picked, setPicked] = useState<PlacePick | null>(null);
  const done = outcome === 'confirmed';
  const rejected = outcome === 'rejected';
  const shared = savedEdits ?? {};
  // A searched location carries a formatted `address`; a browser share carries
  // a resolved city/region/country. Prefer whichever is present.
  const place = shared.address
    ? String(shared.address)
    : [shared.city, shared.region, shared.country].filter(Boolean).join(', ');

  const share = () => {
    if (busy) return;
    if (typeof navigator === 'undefined' || !navigator.geolocation) {
      setError("Your browser can't share location — search for it instead.");
      setMode('search');
      return;
    }
    setBusy(true);
    setError(null);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const { latitude, longitude, accuracy } = pos.coords;
        void reverseGeocode(latitude, longitude).then((geo) => {
          setBusy(false);
          onConfirmed({
            latitude: Number(latitude.toFixed(5)),
            longitude: Number(longitude.toFixed(5)),
            accuracy: accuracy != null ? Math.round(accuracy) : null,
            ...geo,
          });
        });
      },
      (err) => {
        setBusy(false);
        setMode('search');
        setError(
          err.code === err.PERMISSION_DENIED
            ? 'Location permission was blocked — search for your city or address instead.'
            : "Couldn't get your location — search for your city or address instead.",
        );
      },
      { enableHighAccuracy: false, timeout: 15_000, maximumAge: 300_000 },
    );
  };

  // Confirm the manually-searched location. Uses the picked place's coordinates
  // when available, else sends just the typed/picked address (Places disabled).
  const useSearched = () => {
    const address = (picked?.address || query).trim();
    if (!address) return;
    onConfirmed({
      address,
      ...(picked?.lat != null ? { latitude: Number(picked.lat.toFixed(5)) } : {}),
      ...(picked?.lng != null ? { longitude: Number(picked.lng.toFixed(5)) } : {}),
    });
  };

  return (
    <div className={cn('rounded-[var(--radius-md)] border border-[color:var(--color-border-default)] bg-card p-3', rejected && 'opacity-60')}>
      <div className="mb-1.5 flex items-center gap-2 text-xs font-semibold text-ink-100">
        <MapPin className="h-3.5 w-3.5 text-accent" /> Share your location
        <span className="ml-auto rounded-full bg-inset px-2 py-0.5 text-[10px] font-medium text-ink-40">
          {done ? 'Shared' : rejected ? 'Dismissed' : 'Optional'}
        </span>
      </div>
      <div className="rounded-[var(--radius-sm)] bg-inset px-2.5 py-2 text-sm text-ink-100">
        {done ? (
          place ? `Location shared: ${place}.` : 'Location shared.'
        ) : rejected ? (
          'You dismissed this request.'
        ) : mode === 'search' ? (
          <div className="space-y-1.5">
            <div className="text-xs text-ink-60">Search for your city or address so I can tailor local insights.</div>
            <PlacesAddressInput
              value={query}
              onChange={(v) => {
                setQuery(v);
                setPicked(null);
              }}
              onPick={(p) => {
                setQuery(p.address);
                setPicked(p);
              }}
              placeholder="Search your city or address…"
              autoFocus
            />
          </div>
        ) : (
          <>
            Allow your browser to share your approximate location so I can tailor local insights to where you are — or{' '}
            <button type="button" className="font-medium text-accent hover:underline" onClick={() => setMode('search')}>
              enter it manually
            </button>
            . You can dismiss this instead.
          </>
        )}
        {error && <div className="mt-1 text-xs text-danger">{error}</div>}
      </div>
      <div className="mt-2 flex items-center justify-end gap-2">
        {outcome ? (
          <ResolvedBadge action={action} outcome={outcome} doneLabel="Shared" />
        ) : mode === 'search' ? (
          <>
            <Button variant="ghost" size="sm" onClick={onReject}>
              Dismiss
            </Button>
            <Button variant="accent" size="sm" onClick={useSearched} disabled={!picked && !query.trim()}>
              <Check className="mr-1 h-3.5 w-3.5" /> Use this location
            </Button>
          </>
        ) : (
          <>
            <Button variant="ghost" size="sm" onClick={onReject} disabled={busy}>
              Dismiss
            </Button>
            <Button variant="accent" size="sm" onClick={share} disabled={busy}>
              {busy ? <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" /> : <MapPin className="mr-1 h-3.5 w-3.5" />}
              Share my location
            </Button>
          </>
        )}
      </div>
    </div>
  );
}

/** Max "Regenerate" presses per card before the UI points at the strategist. */
const MAX_CARD_REGENERATIONS = 5;

/**
 * Per-card regenerate context, threaded from the message render site: which
 * message + card this is, the persisted generation history (drives the gen
 * chips), and a callback to mirror a fresh list into the query cache.
 */
interface RegenContext {
  messageId: string;
  toolUseId: string;
  generations: Record<string, unknown>[];
  persist: (generations: Record<string, unknown>[]) => void;
}

/**
 * "Regenerate" control for an action card — a REJECTION signal, not a polish.
 * Always sends the card's ORIGINAL payload (`base`) to a fresh, separate AI
 * conversation (trpc.chat.regenerateCard), so every press reimagines from A
 * (A→B, A→C, …) rather than drifting off the last take. The server diverges the
 * new take from all prior generations, appends it to the persisted history, and
 * returns the full list; we drop the new take into the card via `onApply` and
 * mirror the list into the cache via `regen.persist`. Renders nothing without a
 * threadId (optimistic rows) or once the 5-press cap is hit (the RegenerationBar
 * shows the strategist hint instead).
 */
function RegenerateCardButton({
  threadId,
  kind,
  base,
  onApply,
  regen,
}: {
  threadId?: string;
  kind: AiPendingAction['kind'];
  base: Record<string, unknown>;
  onApply: (improved: Record<string, unknown>) => void;
  regen: RegenContext;
}) {
  const trpc = useTRPC();
  const mut = useMutation(trpc.chat.regenerateCard.mutationOptions());
  if (!threadId) return null;
  if (regen.generations.length >= MAX_CARD_REGENERATIONS) return null;
  const run = () => {
    if (mut.isPending) return;
    mut.mutate(
      { threadId, messageId: regen.messageId, toolUseId: regen.toolUseId, kind, payload: base },
      {
        onSuccess: (res) => {
          onApply((res.payload ?? {}) as Record<string, unknown>);
          regen.persist((res.generations ?? []) as Record<string, unknown>[]);
          toast.success('Reimagined — review the new take before confirming.');
        },
        onError: (e) => toastError(e),
      },
    );
  };
  return (
    <button
      type="button"
      onClick={run}
      disabled={mut.isPending}
      title="Harsh reject — throw this out and have AI reimagine it from scratch, on-brand"
      aria-label="Regenerate content"
      className="flex items-center gap-1 rounded-[var(--radius-sm)] px-1.5 py-0.5 text-[10px] font-medium text-ink-40 hover:bg-inset hover:text-ink-100 disabled:opacity-50"
    >
      {mut.isPending ? <Loader2 className="h-3 w-3 animate-spin" /> : <Sparkles className="h-3 w-3" />}
      Regenerate
    </button>
  );
}

/**
 * Chips under a card header for jumping between the original draft and each
 * reimagined generation. Clicking one fills the card's editable fields with that
 * version via `onApply`. Once the regenerate cap is reached, shows a hint to take
 * the conversation to the strategist instead of spinning on the model. Renders
 * nothing until there's at least one generation.
 */
function RegenerationBar({
  base,
  onApply,
  generations,
}: {
  base: Record<string, unknown>;
  onApply: (values: Record<string, unknown>) => void;
  generations: Record<string, unknown>[];
}) {
  if (generations.length === 0) return null;
  const atLimit = generations.length >= MAX_CARD_REGENERATIONS;
  const chip = 'rounded-full bg-inset px-2 py-0.5 text-[10px] font-medium text-ink-60 hover:bg-card hover:text-ink-100';
  return (
    <div className="mb-1.5 flex flex-wrap items-center gap-1">
      <span className="text-[10px] font-medium text-ink-40">Versions</span>
      <button type="button" onClick={() => onApply(base)} className={chip} title="Load the original draft">
        Original
      </button>
      {generations.map((g, i) => (
        <button key={i} type="button" onClick={() => onApply(g)} className={chip} title={`Load generation ${i + 1}`}>
          Gen {i + 1}
        </button>
      ))}
      {atLimit && (
        <span className="ml-1 text-[10px] font-medium text-danger">
          Please try communicating with the strategist about concerns.
        </span>
      )}
    </div>
  );
}

function AiActionCard({ action, onReject, brandId, outcome, onConfirmed, savedEdits, threadId, regen }: { action: AiPendingAction; onReject: () => void; brandId?: string; outcome: ActionOutcome; onConfirmed: (edits?: Record<string, unknown>) => void; savedEdits?: Record<string, unknown>; threadId?: string; regen: RegenContext }) {
  if (action.kind === 'ask_user') {
    return <AiAskUserCard action={action} onReject={onReject} outcome={outcome} onConfirmed={onConfirmed} savedEdits={savedEdits} />;
  }
  if (action.kind === 'request_user_location') {
    return <AiLocationCard action={action} onReject={onReject} outcome={outcome} onConfirmed={onConfirmed} savedEdits={savedEdits} />;
  }
  if (
    action.kind === 'agency_connection' || action.kind === 'create_task' || action.kind === 'update_profile' ||
    action.kind === 'send_review_request' || action.kind === 'create_short_link' || action.kind === 'toggle_short_link' ||
    action.kind === 'create_service'
  ) {
    return <AiExecuteCard action={action} onReject={onReject} brandId={brandId} outcome={outcome} onConfirmed={onConfirmed} threadId={threadId} regen={regen} />;
  }
  if (
    action.kind === 'update_directory_listing' || action.kind === 'create_review_location' ||
    action.kind === 'update_review_location' || action.kind === 'update_review_platform' ||
    action.kind === 'update_review_win_tags' || action.kind === 'invite_staff_member' ||
    action.kind === 'create_link_campaign' || action.kind === 'update_link_campaign' ||
    action.kind === 'add_campaign_window' || action.kind === 'remove_campaign_window' ||
    action.kind === 'set_brand_policy' ||
    action.kind === 'update_short_link' || action.kind === 'update_qr_style' ||
    action.kind === 'save_embed_style' || action.kind === 'save_embed_collection' ||
    action.kind === 'add_signature_members' || action.kind === 'update_signature_member' ||
    action.kind === 'update_signature_settings' || action.kind === 'create_signature_campaign' ||
    action.kind === 'create_support_ticket' || action.kind === 'create_brand' ||
    action.kind === 'send_chat_message' || action.kind === 'create_chat_group' ||
    action.kind === 'update_chat_members' || action.kind === 'rename_chat_group' ||
    action.kind === 'invite_to_chat' || action.kind === 'answer_chat_request' ||
    action.kind === 'update_chat_conversation'
  ) {
    return <AiGenericExecuteCard action={action} onReject={onReject} brandId={brandId} outcome={outcome} onConfirmed={onConfirmed} threadId={threadId} regen={regen} />;
  }
  return <AiDraftCard action={action} onReject={onReject} outcome={outcome} threadId={threadId} regen={regen} />;
}

/**
 * DRAFT-only card (agency_message / proposal_reply / marketplace_inquiry): shows
 * text the user copies and sends manually — no server write, so Copy + Dismiss
 * only, plus a top "Regenerate" to sharpen the draft on-brand. Kept as its own
 * component so the drafted message can live in editable state (which the
 * Regenerate button updates in place).
 */
function AiDraftCard({ action, onReject, outcome, threadId, regen }: { action: AiPendingAction; onReject: () => void; outcome: ActionOutcome; threadId?: string; regen: RegenContext }) {
  const [message, setMessage] = useState(() => String(action.payload.message ?? ''));
  // The original draft (base A) — stable across regenerate presses.
  const base = action.payload as Record<string, unknown>;
  const applyRegen = (v: Record<string, unknown>) => setMessage(String(v.message ?? message));
  const title =
    action.kind === 'agency_message'
      ? `Draft message to ${String(action.payload.agencyName ?? 'agency')}`
      : action.kind === 'marketplace_inquiry'
        ? `Draft inquiry about "${String(action.payload.serviceName ?? 'service')}"`
        : `Draft reply for "${String(action.payload.title ?? 'proposal')}"`;
  const rejected = outcome === 'rejected';
  return (
    <div className={cn('rounded-[var(--radius-md)] border border-[color:var(--color-border-default)] bg-card p-3', rejected && 'opacity-60')}>
      <div className="mb-1.5 flex items-center gap-2 text-xs font-semibold text-ink-100">
        <Sparkles className="h-3.5 w-3.5 text-accent" /> {title}
        <div className="ml-auto flex items-center gap-1.5">
          {!rejected && (
            <RegenerateCardButton threadId={threadId} kind={action.kind} base={base} onApply={applyRegen} regen={regen} />
          )}
          <span className="rounded-full bg-inset px-2 py-0.5 text-[10px] font-medium text-ink-40">{rejected ? 'Dismissed' : 'Review & send'}</span>
        </div>
      </div>
      {!rejected && <RegenerationBar base={base} onApply={applyRegen} generations={regen.generations} />}
      <div className="whitespace-pre-wrap rounded-[var(--radius-sm)] bg-inset px-2.5 py-2 text-sm text-ink-100">{message}</div>
      <div className="mt-2 flex items-center justify-end gap-2">
        {rejected ? (
          <span className="flex items-center gap-1 text-xs font-medium text-ink-40">
            <X className="h-3.5 w-3.5" /> Dismissed
          </span>
        ) : (
          <>
            <Button variant="ghost" size="sm" onClick={onReject}>
              Dismiss
            </Button>
            <Button
              variant="accent"
              size="sm"
              onClick={() => {
                navigator.clipboard?.writeText(message);
                toast.success('Draft copied — paste it where you need it.');
              }}
            >
              <Copy className="mr-1 h-3.5 w-3.5" /> Copy draft
            </Button>
          </>
        )}
      </div>
    </div>
  );
}

/**
 * Confirm-then-execute card: the write only happens when the user clicks confirm.
 * On success the card flips to a "done" state without disturbing sibling cards
 * (so a connect + reminder-task pair can each be confirmed independently).
 */

/**
 * Returns the target frontend host + path for a completed action so the "View"
 * button can navigate the user to the right place. Returns null for draft-only
 * kinds that don't create a viewable entity.
 */
function getViewTarget(action: AiPendingAction): { host: string | undefined; path: string } | null {
  const p = action.payload;
  const str = (k: string) => (p[k] != null ? String(p[k]) : '');
  switch (action.kind) {
    case 'create_task':       return { host: PRODESK_ORIGINS.app, path: '/tasks' };
    case 'agency_connection': return { host: PRODESK_ORIGINS.app, path: '/agencies' };
    case 'update_profile':    return { host: PRODESK_ORIGINS.dashboard, path: '/app/info-hub' };
    case 'send_review_request': return { host: PRODESK_ORIGINS.reviews, path: '/requests' };
    case 'create_service':    return { host: PRODESK_ORIGINS.app, path: '/catalog' };
    case 'invite_staff_member':      return { host: PRODESK_ORIGINS.app, path: '/staff' };
    case 'set_brand_policy':         return { host: PRODESK_ORIGINS.dashboard, path: '/app/info-hub' };
    case 'update_directory_listing': return { host: PRODESK_ORIGINS.reviews, path: '/directory-profile' };
    // A brand-new campaign has no id until confirm, so land on the list; edits to
    // an existing one deep-link to that campaign.
    case 'create_link_campaign':     return { host: PRODESK_ORIGINS.links, path: '/campaigns' };
    case 'update_link_campaign':
    case 'add_campaign_window':
    case 'remove_campaign_window':
      return {
        host: PRODESK_ORIGINS.links,
        path: str('campaignId') ? `/campaigns/${str('campaignId')}` : '/campaigns',
      };
    // A brand-new link/location isn't individually addressable yet → land on its list.
    case 'create_short_link':        return { host: PRODESK_ORIGINS.links, path: '/' };
    case 'create_review_location':   return { host: PRODESK_ORIGINS.reviews, path: '/' };
    // Edits to an existing record → deep-link straight to that record.
    case 'toggle_short_link':
    case 'update_short_link':
      return { host: PRODESK_ORIGINS.links, path: str('linkId') ? `/l/${str('linkId')}` : '/' };
    case 'update_qr_style':
      // Per-link QR opens the link; the brand-wide default QR lives on Settings.
      return p.scope === 'link' && str('linkId')
        ? { host: PRODESK_ORIGINS.links, path: `/l/${str('linkId')}` }
        : { host: PRODESK_ORIGINS.links, path: '/settings' };
    case 'update_review_location':
    case 'update_review_platform':
    case 'update_review_win_tags':
      return { host: PRODESK_ORIGINS.reviews, path: str('locationId') ? `/l/${str('locationId')}` : '/' };
    case 'save_embed_style':
      // /embed/:locationId is the per-location embed theme designer.
      return { host: PRODESK_ORIGINS.reviews, path: str('locationId') ? `/embed/${str('locationId')}` : '/embed' };
    case 'save_embed_collection':
      // Editing an existing collection has an id; creating one doesn't yet.
      return p.mode === 'update' && str('collectionId')
        ? { host: PRODESK_ORIGINS.reviews, path: `/collections/${str('collectionId')}` }
        : { host: PRODESK_ORIGINS.reviews, path: '/embed' };
    // Signatures entities live on the members (/brands) and campaigns screens.
    case 'add_signature_members':
    case 'update_signature_member':
    case 'update_signature_settings':
      return { host: PRODESK_ORIGINS.signatures, path: '/brands' };
    case 'create_signature_campaign':
      return { host: PRODESK_ORIGINS.signatures, path: '/campaigns' };
    // The chat lives in the dashboard client, whose Support screen owns tickets.
    case 'create_support_ticket':
      return { host: PRODESK_ORIGINS.dashboard, path: '/support' };
    // A new brand is reached by switching workspaces — land on the dashboard.
    case 'create_brand':
      return { host: PRODESK_ORIGINS.dashboard, path: '/' };
    // Chat. Deep-link to the conversation the action touched wherever there is
    // one — "View" after sending a message means "show me it in the thread", not
    // "open my inbox". A brand-new group has no id until confirm, and an invite
    // has no conversation at all, so both land on the inbox.
    case 'send_chat_message':
    case 'update_chat_members':
    case 'rename_chat_group':
    case 'answer_chat_request':
    case 'update_chat_conversation':
      return {
        host: PRODESK_ORIGINS.chat,
        path: str('threadId') ? `/t/${str('threadId')}` : '/',
      };
    case 'create_chat_group':
    case 'invite_to_chat':
      return { host: PRODESK_ORIGINS.chat, path: '/' };
    default:                  return null;
  }
}

/**
 * The billing-disclosure block on a PAID confirm card: what confirming will
 * charge and the card it goes to (from the action payload's `billing`, computed
 * live server-side when the tool ran). Renders nothing for free actions.
 */
export function ActionBillingNote({ billing }: { billing: AiActionBilling | null | undefined }) {
  if (!billing?.summary) return null;
  return (
    <div className="mt-1.5 flex items-start gap-1.5 rounded-[var(--radius-sm)] border border-[color:var(--color-border-default)] bg-inset px-2.5 py-2 text-xs text-ink-100">
      <CreditCard className="mt-0.5 h-3.5 w-3.5 shrink-0 text-accent" />
      <div>
        <div>{billing.summary}</div>
        {billing.cardLast4 ? (
          <div className="mt-0.5 text-[11px] text-ink-60">
            Card: {String(billing.cardBrand ?? 'card').toUpperCase()} •••• {billing.cardLast4}
          </div>
        ) : billing.requiresCheckout ? (
          <div className="mt-0.5 text-[11px] text-ink-60">No card on file — Stripe Checkout will open to collect payment.</div>
        ) : null}
      </div>
    </div>
  );
}

/** The `billing` payload of a paid action, when the server attached one. */
export function billingOf(p: Record<string, unknown>): AiActionBilling | null {
  const b = p.billing;
  if (!b || typeof b !== 'object') return null;
  return b as AiActionBilling;
}

/** A Company Info location as stored on brands.locations. */
interface BrandLocation {
  id: string;
  label: string;
  address: string;
  placeId?: string;
  lat?: number;
  lng?: number;
  hours?: string;
  phone?: string;
}

function newLocationId(): string {
  try {
    return crypto.randomUUID();
  } catch {
    return `loc-${Date.now()}-${Math.round(Math.random() * 1e9)}`;
  }
}

/** Human-readable labels for the brand fields update_profile may change. */
const BRAND_FIELD_LABELS: Record<string, string> = {
  businessName: 'Business name',
  legalName: 'Legal name',
  email: 'Contact email',
  contactName: 'Contact name',
  website: 'Website',
  phone: 'Phone',
  address: 'Address',
  abn: 'ABN',
  industry: 'Industry',
  yearFounded: 'Year founded',
  targetAudience: 'Target audience',
  competitors: 'Competitors',
  usp: 'Unique selling proposition',
  brandValues: 'Brand values',
  toneOfVoice: 'Tone of voice',
  keyMessaging: 'Key messaging',
  colors: 'Brand colours',
  typography: 'Typography',
};

function AiExecuteCard({ action, onReject, brandId, outcome, onConfirmed, threadId, regen }: { action: AiPendingAction; onReject: () => void; brandId?: string; outcome: ActionOutcome; onConfirmed: (edits?: Record<string, unknown>) => void; threadId?: string; regen: RegenContext }) {
  const trpc = useTRPC();
  const qc = useQueryClient();
  // onConfirmed records the 'confirmed' outcome on the message (optimistically in
  // the shared query cache + persisted server-side), so a confirmed card stays
  // done across docked-rail ↔ full-screen remounts and after a reload.
  // Editable copy of the payload for the simple kinds (task/service/review
  // request/short link). run() reads `values.*` so edits flow straight through.
  // update_profile keeps its own state (profileVals + addr) below.
  const [values, setValues] = useState<Record<string, unknown>>(() => ({
    ...(action.payload as Record<string, unknown>),
  }));
  const editsRef = useRef<Record<string, unknown> | undefined>(undefined);
  // `finish` reports the user's final values so a later AI turn sees what was
  // applied. update_profile passes them explicitly; other kinds use editsRef.
  const finish = (explicit?: Record<string, unknown>) => onConfirmed(explicit ?? editsRef.current);
  const connect = useMutation(trpc.connections.requestAgencyConnection.mutationOptions());
  const createTask = useMutation(trpc.tasks.create.mutationOptions());
  const updateBrand = useMutation(trpc.brands.update.mutationOptions());
  const sendReviewReq = useMutation(trpc.reviews.reviewRequests.send.mutationOptions());
  const createLink = useMutation(trpc.shortLinks.create.mutationOptions());
  const toggleLink = useMutation(trpc.shortLinks.toggleActive.mutationOptions());
  const createService = useMutation(trpc.services.create.mutationOptions());
  const featureCheckout = useMutation(trpc.featureSubscriptions.checkout.mutationOptions());
  const pending = connect.isPending || createTask.isPending || updateBrand.isPending || sendReviewReq.isPending || createLink.isPending || toggleLink.isPending || createService.isPending || featureCheckout.isPending;

  const isConnect = action.kind === 'agency_connection';
  const isUpdate = action.kind === 'update_profile';
  const isReviewRequest = action.kind === 'send_review_request';
  const isCreateLink = action.kind === 'create_short_link';
  const isToggleLink = action.kind === 'toggle_short_link';
  const isCreateService = action.kind === 'create_service';
  const isCreateTask = action.kind === 'create_task';
  const agencyName = String(action.payload.agencyName ?? 'agency');
  const taskTitle = String(values.title ?? '');
  const taskDesc = values.description ? String(values.description) : '';
  const assigneeName = action.payload.assigneeName ? String(action.payload.assigneeName) : '';
  // update_profile carries a { changes } map of fieldName -> new value, plus an
  // optional `requestFields` list of keys the AI wants the USER to fill in on the
  // card as blank, validated inputs (facts it couldn't infer) — a form instead of
  // chat-prose questions.
  const changes = (action.payload.changes ?? {}) as Record<string, string | string[]>;
  const changeEntries = Object.entries(changes);
  const requestFields = Array.isArray(action.payload.requestFields)
    ? (action.payload.requestFields as unknown[]).map((f) => String(f))
    : [];

  // update_profile: the registered address is editable in-card via Google Places,
  // and on confirm the chosen address is also filed as a Company Info location.
  // Shown when the AI proposed an address OR asked the user to supply one.
  const hasAddressChange =
    isUpdate &&
    (Object.prototype.hasOwnProperty.call(changes, 'address') || requestFields.includes('address'));
  const [addr, setAddr] = useState<PlacePick>({
    address: String((changes as Record<string, unknown>).address ?? ''),
  });
  // Current brand locations, to merge/dedupe the chosen address into on confirm.
  const brandLocationsQ = useQuery({
    ...trpc.brands.byId.queryOptions({ id: brandId ?? '' }),
    enabled: hasAddressChange && !!brandId,
  });
  // Scalar keys the user fills in (address handled separately via Places, and list
  // fields like colours/typography stay read-only): the AI's proposed scalar
  // changes seeded with their value, plus each requested key seeded empty.
  const requestScalarKeys = requestFields.filter((f) => f !== 'address');
  const [profileVals, setProfileVals] = useState<Record<string, unknown>>(() => ({
    ...Object.fromEntries(requestScalarKeys.map((f) => [f, ''])),
    ...Object.fromEntries(
      changeEntries.filter(([f, v]) => !Array.isArray(v) && f !== 'address').map(([f, v]) => [f, v]),
    ),
  }));

  // Per-kind copy + icon so the header/button/done states stay in sync.
  const Icon = isConnect ? Link2 : isUpdate ? Pencil : isReviewRequest ? Mail : isCreateLink ? Link2 : isToggleLink ? Power : isCreateService ? Package : ListPlus;
  const heading = isConnect ? `Connect with ${agencyName}`
    : isUpdate ? 'Update brand profile'
    : isReviewRequest ? `Send review request to ${String(action.payload.customerName ?? 'customer')}` 
    : isCreateLink ? `Create short link: ${String(action.payload.nickname ?? 'link')}`
    : isToggleLink ? `${action.payload.isActive ? 'Activate' : 'Deactivate'} link: ${String(action.payload.nickname ?? action.payload.slug ?? 'link')}`
    : isCreateService ? `Create service: ${String(action.payload.name ?? 'service')}`
    : 'Create task';
  const cta = isConnect ? 'Connect'
    : isUpdate ? 'Update profile'
    : isReviewRequest ? 'Send request'
    : isCreateLink ? 'Create link'
    : isToggleLink ? (action.payload.isActive ? 'Activate' : 'Deactivate')
    : isCreateService ? 'Create service'
    : 'Create task';
  const doneLabel = isConnect ? 'Connected'
    : isUpdate ? 'Profile updated'
    : isReviewRequest ? 'Request sent'
    : isCreateLink ? 'Link created'
    : isToggleLink ? (action.payload.isActive ? 'Activated' : 'Deactivated')
    : isCreateService ? 'Service created'
    : 'Task created';
  // Connecting and updating both write against a specific brand → brandId required.
  const needsBrand = isConnect || isUpdate || isReviewRequest || isCreateLink || isToggleLink || isCreateService;

  // Regenerate is only meaningful for kinds with prose to sharpen (not the
  // pure connect / on-off toggle cards). update_profile improves its `changes`
  // map; the rest improve their editable `values`.
  const canRegenerate = isUpdate || isReviewRequest || isCreateLink || isCreateService || isCreateTask;
  const getRegenPayload = (): Record<string, unknown> => {
    if (!isUpdate) return values;
    const eff: Record<string, unknown> = { ...changes };
    for (const [k, v] of Object.entries(profileVals)) eff[k] = v;
    if (hasAddressChange) eff.address = addr.address;
    return { changes: eff };
  };
  const applyRegen = (improved: Record<string, unknown>) => {
    if (!isUpdate) {
      setValues((v) => ({ ...v, ...improved }));
      return;
    }
    const ch = (improved.changes ?? {}) as Record<string, unknown>;
    setProfileVals((s) => {
      const next = { ...s };
      for (const k of Object.keys(next)) if (typeof ch[k] === 'string') next[k] = ch[k];
      return next;
    });
  };
  // The ORIGINAL card content (base A), captured once before any edits, so every
  // regenerate press reimagines from the same origin (A→B, A→C, …). `??=` only
  // calls getRegenPayload() the first time, when state is still pristine.
  const regenBaseRef = useRef<Record<string, unknown> | null>(null);
  regenBaseRef.current ??= getRegenPayload();
  const regenBase = regenBaseRef.current;

  const run = () => {
    if (needsBrand && !brandId) {
      toast.error('Could not determine which brand this applies to.');
      return;
    }
    if (isConnect) {
      connect.mutate(
        { brandId: brandId!, agencyId: String(action.payload.agencyId ?? '') },
        {
          onSuccess: () => {
            finish();
            qc.invalidateQueries({ queryKey: trpc.connections.brandPendingRequests.queryKey() });
            qc.invalidateQueries({ queryKey: trpc.connections.brandAgenciesWithStats.queryKey() });
            qc.invalidateQueries({ queryKey: trpc.brands.dashboardStats.queryKey() });
            toast.success(`Connected with ${agencyName}.`);
          },
          onError: (e) => toastError(e),
        },
      );
    } else if (isUpdate) {
      // Apply the (possibly Places-edited) address, and file it as a Company Info
      // location if it isn't already one. locations REPLACES the whole array, so we
      // send existing + new (deduped on the normalized address).
      // Edited scalar fields override the proposed changes; list fields (colours/
      // typography) stay as proposed; address comes from the Places field below.
      // A requested field the user left blank is NOT written, so we never clear an
      // existing value just because the AI asked for it and the user had nothing.
      const nextChanges: Record<string, string | string[]> = { ...changes };
      for (const [k, v] of Object.entries(profileVals as Record<string, string>)) {
        const requestedOnly = requestScalarKeys.includes(k) && !proposedScalarKeys.has(k);
        if (requestedOnly && !String(v ?? '').trim()) continue;
        nextChanges[k] = v;
      }
      let locationsPatch: BrandLocation[] | undefined;
      if (hasAddressChange) {
        const finalAddress = addr.address.trim();
        // Only write the address if the user actually supplied/kept one, or the AI
        // proposed a specific value (blanking is then an intentional edit). A blank
        // address that was merely REQUESTED is skipped so we don't clear locations.
        const addressProposed = Object.prototype.hasOwnProperty.call(changes, 'address');
        if (finalAddress || addressProposed) nextChanges.address = finalAddress;
        if (finalAddress) {
          const norm = (s: string) => s.trim().toLowerCase();
          // Backfill id/label/address on any legacy rows so they satisfy the input schema.
          const existing: BrandLocation[] = ((brandLocationsQ.data?.locations ?? []) as BrandLocation[]).map(
            (l) => ({ ...l, id: l.id || newLocationId(), label: (l.label ?? '').trim(), address: (l.address ?? '').trim() }),
          );
          if (!existing.some((l) => norm(l.address) === norm(finalAddress))) {
            locationsPatch = [
              ...existing,
              {
                id: newLocationId(),
                label: finalAddress.split(',')[0]?.trim() || 'Registered address',
                address: finalAddress,
                ...(addr.placeId ? { placeId: addr.placeId } : {}),
                ...(addr.lat != null ? { lat: addr.lat } : {}),
                ...(addr.lng != null ? { lng: addr.lng } : {}),
              },
            ];
          }
        }
      }
      updateBrand.mutate(
        { brandId: brandId!, ...nextChanges, ...(locationsPatch ? { locations: locationsPatch } : {}) },
        {
          onSuccess: () => {
            // Report the final applied values (incl. any Places-edited address) so a
            // later AI turn sees what was actually saved, not just what it proposed.
            finish(nextChanges);
            // Refetch the brand-backed views so the change shows immediately on
            // the originating client, without waiting on realtime/staleness.
            qc.invalidateQueries({ queryKey: trpc.brands.byId.queryKey() });
            qc.invalidateQueries({ queryKey: trpc.brands.mine.queryKey() });
            qc.invalidateQueries({ queryKey: trpc.brands.dashboardStats.queryKey() });
            toast.success(
              locationsPatch ? 'Brand profile updated and address added to your locations.' : 'Brand profile updated.',
            );
          },
          onError: (e) => toastError(e),
        },
      );
    } else if (isReviewRequest) {
      sendReviewReq.mutate(
        {
          locationId: String(values.locationId ?? ''),
          customerName: String(values.customerName ?? ''),
          customerEmail: String(values.customerEmail ?? ''),
          customMessage: values.customMessage ? String(values.customMessage) : undefined,
        },
        {
          onSuccess: () => {
            finish();
            qc.invalidateQueries({ queryKey: trpc.reviews.reviewRequests.listForBrand.queryKey() });
            toast.success(`Review request sent to ${String(values.customerEmail)}.`);
          },
          onError: (e) => toastError(e),
        },
      );
    } else if (isCreateLink) {
      // Use AI-proposed slug if provided, otherwise auto-generate 6 random chars.
      let slug = String(values.slug ?? '').trim().toLowerCase().replace(/[^a-z0-9-]/g, '');
      if (!slug) {
        const chars = 'abcdefghjkmnpqrstuvwxyz23456789';
        slug = '';
        for (let i = 0; i < 6; i++) slug += chars[Math.floor(Math.random() * chars.length)];
      }
      createLink.mutate(
        {
          brandId: brandId!,
          slug,
          destinationUrl: String(values.destinationUrl ?? ''),
          nickname: String(values.nickname ?? ''),
        },
        {
          onSuccess: () => {
            finish();
            qc.invalidateQueries({ queryKey: trpc.shortLinks.list.queryKey() });
            qc.invalidateQueries({ queryKey: trpc.shortLinks.analytics.queryKey() });
            toast.success('Short link created (inactive). Activate it from the Links dashboard.');
          },
          onError: (e) => toastError(e),
        },
      );
    } else if (isToggleLink) {
      const enabling = action.payload.isActive === true;
      const doToggle = () =>
        toggleLink.mutate(
          {
            id: String(action.payload.linkId ?? ''),
            isActive: enabling,
          },
          {
            onSuccess: () => {
              finish();
              qc.invalidateQueries({ queryKey: trpc.shortLinks.list.queryKey() });
              qc.invalidateQueries({ queryKey: trpc.shortLinks.analytics.queryKey() });
              toast.success(`Link ${enabling ? 'activated' : 'deactivated'}.`);
            },
            onError: (e) => toastError(e),
          },
        );
      const billing = billingOf(action.payload);
      // Enabling without an active Links subscription: subscribe first (charges
      // the card on file with no redirect; the subscription's pendingEnableLinkId
      // flips the link active server-side). Only when there is no usable card
      // does hosted Checkout open in a new tab.
      if (enabling && billing?.requiresCheckout && action.payload.priceId) {
        featureCheckout.mutate(
          {
            brandId: brandId!,
            priceId: String(action.payload.priceId),
            pendingEnableLinkId: String(action.payload.linkId ?? ''),
            ...checkoutReturnUrls(),
          },
          {
            onSuccess: (res) => {
              if (res.status === 'active') {
                // Card on file charged; pendingEnableLinkId flipped the link
                // active server-side.
                finish();
                qc.invalidateQueries({ queryKey: trpc.shortLinks.list.queryKey() });
                qc.invalidateQueries({ queryKey: trpc.shortLinks.analytics.queryKey() });
                toast.success('Subscription started and link activated.');
              } else if (res.status === 'already_active' || res.status === 'activated_dev') {
                // Subscribed (or the no-Stripe dev fallback, which doesn't flip
                // the pending link) — toggle explicitly.
                doToggle();
              } else if (res.url) {
                window.open(res.url, '_blank', 'noopener');
                toast.info('Complete the subscription in the opened tab, then confirm again.');
              }
            },
            onError: (e) => toastError(e),
          },
        );
      } else {
        doToggle();
      }
    } else if (isCreateService) {
      // Number fields come back from the inputs as strings; coerce (blank → undefined).
      const toNum = (v: unknown) => {
        if (v === '' || v == null) return undefined;
        const n = Number(v);
        return Number.isFinite(n) ? n : undefined;
      };
      createService.mutate(
        {
          agencyId: String(values.agencyId ?? ''),
          name: String(values.name ?? ''),
          description: String(values.description ?? ''),
          type: (values.type as any) ?? 'oneOffService',
          price: toNum(values.price),
          recurringFee: toNum(values.recurringFee),
          stage: values.stage ? String(values.stage) : undefined,
        },
        {
          onSuccess: () => {
            finish();
            qc.invalidateQueries({ queryKey: trpc.services.list.queryKey() });
            toast.success('Service created.');
          },
          onError: (e) => toastError(e),
        },
      );
    } else {
      createTask.mutate(
        {
          title: taskTitle,
          description: taskDesc || undefined,
          assigneeId: values.assigneeId ? String(values.assigneeId) : undefined,
          organizationId: brandId,
        },
        {
          onSuccess: () => {
            finish();
            qc.invalidateQueries({ queryKey: trpc.tasks.list.queryKey() });
            qc.invalidateQueries({ queryKey: trpc.tasks.counts.queryKey() });
            toast.success('Task created.');
          },
          onError: (e) => toastError(e),
        },
      );
    }
  };

  // --- Editable field specs for each kind ---
  const PROFILE_FIELD_TYPES: Record<string, FieldType> = {
    email: 'email',
    website: 'url',
    yearFounded: 'year',
    phone: 'tel',
    targetAudience: 'textarea',
    usp: 'textarea',
    brandValues: 'textarea',
    keyMessaging: 'textarea',
    toneOfVoice: 'textarea',
    competitors: 'textarea',
  };
  // update_profile: editable scalar fields (address handled via Places; list
  // fields rendered read-only below). The AI's proposed scalar changes first, then
  // any requested keys it didn't already propose — rendered blank for the user to
  // fill. Requested fields are optional (fill what you have); format is validated.
  const proposedScalarKeys = new Set(
    changeEntries.filter(([f, v]) => !Array.isArray(v) && f !== 'address').map(([f]) => f),
  );
  const profileSpecs: FieldSpec[] = [
    ...[...proposedScalarKeys].map((f) => ({ key: f, label: BRAND_FIELD_LABELS[f] ?? f, type: PROFILE_FIELD_TYPES[f] })),
    ...requestScalarKeys
      .filter((f) => !proposedScalarKeys.has(f))
      .map((f) => ({ key: f, label: BRAND_FIELD_LABELS[f] ?? f, type: PROFILE_FIELD_TYPES[f], hint: 'Optional — fill in if you have it.' })),
  ];
  const profileArrayEntries = changeEntries.filter(([, v]) => Array.isArray(v)) as [string, string[]][];

  let primarySpecs: FieldSpec[] = [];
  if (isReviewRequest) {
    primarySpecs = [
      { key: 'customerName', label: 'Customer name', required: true },
      { key: 'customerEmail', label: 'Customer email', type: 'email', required: true },
      { key: 'customMessage', label: 'Message', type: 'textarea' },
    ];
  } else if (isCreateLink) {
    primarySpecs = [
      { key: 'nickname', label: 'Nickname', required: true },
      { key: 'slug', label: 'Slug' },
      { key: 'destinationUrl', label: 'Destination URL', type: 'url', required: true },
    ];
  } else if (isCreateService) {
    primarySpecs = [
      { key: 'name', label: 'Service name', required: true },
      { key: 'description', label: 'Description', type: 'textarea' },
      { key: 'price', label: 'Price (AUD)', type: 'number', min: 0 },
      { key: 'recurringFee', label: 'Recurring fee (AUD)', type: 'number', min: 0 },
      { key: 'stage', label: 'Stage' },
    ];
  } else if (isCreateTask) {
    primarySpecs = [
      { key: 'title', label: 'Task title', required: true },
      { key: 'description', label: 'Description', type: 'textarea' },
    ];
  }
  // Only show fields the model proposed (or required ones).
  const shownPrimary = primarySpecs.filter(
    (s) => s.required || Object.prototype.hasOwnProperty.call(action.payload as Record<string, unknown>, s.key),
  );
  const primaryErrors = validateFields(shownPrimary, values);
  const profileErrors = validateFields(profileSpecs, profileVals);
  const hasCardErrors = isUpdate
    ? Object.keys(profileErrors).length > 0
    : Object.keys(primaryErrors).length > 0;
  // Snapshot the edited values so finish() reports them (update_profile passes its
  // own explicitly).
  editsRef.current = shownPrimary.length
    ? Object.fromEntries(shownPrimary.map((s) => [s.key, values[s.key]]))
    : undefined;

  return (
    <div className={cn('rounded-[var(--radius-md)] border border-[color:var(--color-border-default)] bg-card p-3', outcome === 'rejected' && 'opacity-60')}>
      <div className="mb-1.5 flex items-center gap-2 text-xs font-semibold text-ink-100">
        <Icon className="h-3.5 w-3.5 text-accent" /> {heading}
        <div className="ml-auto flex items-center gap-1.5">
          {!outcome && canRegenerate && (
            <RegenerateCardButton threadId={threadId} kind={action.kind} base={regenBase} onApply={applyRegen} regen={regen} />
          )}
          <span className="rounded-full bg-inset px-2 py-0.5 text-[10px] font-medium text-ink-40">
            {outcome === 'confirmed' ? 'Done' : outcome === 'rejected' ? 'Dismissed' : 'Confirm'}
          </span>
        </div>
      </div>
      {!outcome && canRegenerate && (
        <RegenerationBar base={regenBase} onApply={applyRegen} generations={regen.generations} />
      )}
      {isConnect ? (
        <div className="rounded-[var(--radius-sm)] bg-inset px-2.5 py-2 text-sm text-ink-100">
          Connect this brand with <span className="font-medium">{agencyName}</span>. This takes effect immediately.
        </div>
      ) : isUpdate ? (
        <div className="rounded-[var(--radius-sm)] bg-inset px-2.5 py-2 text-sm text-ink-100">
          {profileSpecs.length === 0 && !hasAddressChange && profileArrayEntries.length === 0 ? (
            <span className="text-ink-60">No changes proposed.</span>
          ) : (
            <div className="space-y-2">
              <EditableCardFields
                specs={profileSpecs}
                values={profileVals}
                errors={profileErrors}
                onChange={(k, v) => setProfileVals((s) => ({ ...s, [k]: v }))}
                disabled={!!outcome}
              />
              {hasAddressChange && (
                <div>
                  <label className="mb-0.5 block text-[11px] font-medium text-ink-40">Registered address</label>
                  {outcome ? (
                    <div className="whitespace-pre-wrap text-ink-100">
                      {addr.address || <span className="text-ink-40">— cleared —</span>}
                    </div>
                  ) : (
                    <>
                      <PlacesAddressInput
                        value={addr.address}
                        onChange={(a) => setAddr({ address: a })}
                        onPick={(pick) => setAddr(pick)}
                        placeholder="Search your registered address…"
                      />
                      <div className="mt-1 text-[11px] text-ink-40">Also added to your Company Info locations.</div>
                    </>
                  )}
                </div>
              )}
              {profileArrayEntries.map(([field, value]) => (
                <div key={field}>
                  <div className="text-[11px] font-medium text-ink-40">{BRAND_FIELD_LABELS[field] ?? field}</div>
                  <div className="whitespace-pre-wrap text-ink-100">
                    {value.length ? value.join(', ') : <span className="text-ink-40">— cleared —</span>}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      ) : isReviewRequest ? (
        <div className="rounded-[var(--radius-sm)] bg-inset px-2.5 py-2 text-sm text-ink-100">
          <div className="mb-2">
            <div className="text-[11px] font-medium text-ink-40">Location</div>
            <div className="text-ink-100">{String(action.payload.locationName ?? '')}</div>
          </div>
          <EditableCardFields
            specs={shownPrimary}
            values={values}
            errors={primaryErrors}
            onChange={(k, v) => setValues((s) => ({ ...s, [k]: v }))}
            disabled={!!outcome}
          />
        </div>
      ) : isCreateLink ? (
        <div className="rounded-[var(--radius-sm)] bg-inset px-2.5 py-2 text-sm text-ink-100">
          <EditableCardFields
            specs={shownPrimary}
            values={values}
            errors={primaryErrors}
            onChange={(k, v) => setValues((s) => ({ ...s, [k]: v }))}
            disabled={!!outcome}
          />
          <div className="mt-1.5 text-[11px] text-ink-40">The link will be created as inactive. Activate it from the Links dashboard.</div>
        </div>
      ) : isToggleLink ? (
        <div>
          <div className="rounded-[var(--radius-sm)] bg-inset px-2.5 py-2 text-sm text-ink-100">
            {action.payload.isActive ? 'Activate' : 'Deactivate'} the link <span className="font-medium">{String(action.payload.nickname ?? action.payload.slug ?? '')}</span>.
          </div>
          <ActionBillingNote billing={billingOf(action.payload)} />
        </div>
      ) : isCreateService ? (
        <div className="rounded-[var(--radius-sm)] bg-inset px-2.5 py-2 text-sm text-ink-100">
          <EditableCardFields
            specs={shownPrimary}
            values={values}
            errors={primaryErrors}
            onChange={(k, v) => setValues((s) => ({ ...s, [k]: v }))}
            disabled={!!outcome}
          />
          <div className="mt-1 text-[11px] text-ink-40">
            Type: {String(action.payload.displayType ?? action.payload.type ?? 'One off Service')}
          </div>
        </div>
      ) : (
        <div className="rounded-[var(--radius-sm)] bg-inset px-2.5 py-2 text-sm text-ink-100">
          <EditableCardFields
            specs={shownPrimary}
            values={values}
            errors={primaryErrors}
            onChange={(k, v) => setValues((s) => ({ ...s, [k]: v }))}
            disabled={!!outcome}
          />
          {assigneeName && <div className="mt-1 text-[11px] text-ink-40">Assigned to {assigneeName}</div>}
        </div>
      )}
      <div className="mt-2 flex items-center justify-end gap-2">
        {outcome ? (
          <ResolvedBadge action={action} outcome={outcome} doneLabel={doneLabel} />
        ) : (
          <>
            <Button variant="ghost" size="sm" onClick={onReject} disabled={pending}>
              Dismiss
            </Button>
            <Button
              variant="accent"
              size="sm"
              onClick={run}
              disabled={pending || (needsBrand && !brandId) || (isUpdate && changeEntries.length === 0 && requestFields.length === 0) || hasCardErrors}
            >
              {pending ? <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" /> : <Icon className="mr-1 h-3.5 w-3.5" />}
              {cta}
            </Button>
          </>
        )}
      </div>
    </div>
  );
}

/**
 * Data-driven confirm-then-execute card for the reviews/links/QR/embed action
 * kinds. Each kind resolves to a { Icon, heading, cta, doneLabel, needsBrand,
 * rows, run } spec — the write only happens when the user clicks confirm, and
 * on success the card flips to "done" like AiExecuteCard. Kept separate from
 * AiExecuteCard so the two sets of kinds stay independently maintainable.
 */
/**
 * Turn a raw field key into a display label if it slipped through as a camelCase
 * identifier (no spaces, e.g. "fullName", "primaryColor"). Labels that already
 * contain a space are assumed human-readable and returned untouched.
 */
function humanizeLabel(label: string): string {
  if (/\s/.test(label) || !label) return label;
  const spaced = label
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/[_-]+/g, ' ')
    .trim();
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

function AiGenericExecuteCard({ action, onReject, brandId, outcome, onConfirmed, threadId, regen }: { action: AiPendingAction; onReject: () => void; brandId?: string; outcome: ActionOutcome; onConfirmed: (edits?: Record<string, unknown>) => void; threadId?: string; regen: RegenContext }) {
  const trpc = useTRPC();
  const qc = useQueryClient();
  // Editable copy of the payload. run() bodies read `p` (aliased to this state),
  // so editing a field flows through to the mutation with no per-kind rewiring.
  const [values, setValues] = useState<Record<string, unknown>>(() => ({
    ...(action.payload as Record<string, unknown>),
  }));
  // The final edited field values, kept current each render so finish() (called
  // from a mutation's onSuccess, after the click) reports what was actually applied.
  const editsRef = useRef<Record<string, unknown> | undefined>(undefined);
  const finish = () => onConfirmed(editsRef.current);

  const updateDirectory = useMutation(trpc.reviews.directory.updateProfile.mutationOptions());
  const createLocation = useMutation(trpc.reviews.locations.create.mutationOptions());
  const updateLocation = useMutation(trpc.reviews.locations.update.mutationOptions());
  const updatePlatform = useMutation(trpc.reviews.locations.updatePlatform.mutationOptions());
  const updateWinTags = useMutation(trpc.reviews.locations.updateTags.mutationOptions());
  const updateLink = useMutation(trpc.shortLinks.update.mutationOptions());
  const createCampaign = useMutation(trpc.linkCampaigns.create.mutationOptions());
  const updateCampaign = useMutation(trpc.linkCampaigns.update.mutationOptions());
  const addCampaignWindow = useMutation(trpc.linkCampaigns.addWindow.mutationOptions());
  const removeCampaignWindow = useMutation(trpc.linkCampaigns.removeWindow.mutationOptions());
  const setDefaultQr = useMutation(trpc.shortLinks.setDefaultQrConfig.mutationOptions());
  const saveEmbed = useMutation(trpc.reviews.embed.save.mutationOptions());
  const createCollection = useMutation(trpc.reviews.collections.create.mutationOptions());
  const updateCollection = useMutation(trpc.reviews.collections.update.mutationOptions());
  const inviteStaff = useMutation(trpc.staff.invite.mutationOptions());
  const updateBrand = useMutation(trpc.brands.update.mutationOptions());
  const bulkAddSigMembers = useMutation(trpc.signatures.members.bulkCreate.mutationOptions());
  const updateSigMember = useMutation(trpc.signatures.members.update.mutationOptions());
  const updateSigSettings = useMutation(trpc.signatures.brands.update.mutationOptions());
  const createSigCampaign = useMutation(trpc.signatures.campaigns.create.mutationOptions());
  const createTicket = useMutation(trpc.support.create.mutationOptions());
  const createBrand = useMutation(trpc.brands.create.mutationOptions());
  const featureCheckout = useMutation(trpc.featureSubscriptions.checkout.mutationOptions());
  // Chat. Every one of these runs AS THE SIGNED-IN PERSON — the assistant writes
  // nothing to the messenger server-side, so this is the only place any of it
  // happens. See server-shared modules/ai/tools/messenger.ts.
  const chatSend = useMutation(trpc.chat.send.mutationOptions());
  const chatCreateGroup = useMutation(trpc.chat.createGroup.mutationOptions());
  const chatAddMembers = useMutation(trpc.chat.addMembers.mutationOptions());
  const chatRemoveMember = useMutation(trpc.chat.removeMember.mutationOptions());
  const chatRename = useMutation(trpc.chat.renameThread.mutationOptions());
  const chatDiscover = useMutation(trpc.chat.discoverByEmail.mutationOptions());
  const chatInvite = useMutation(trpc.chat.inviteByEmail.mutationOptions());
  const chatAccept = useMutation(trpc.chat.acceptRequest.mutationOptions());
  const chatDecline = useMutation(trpc.chat.declineRequest.mutationOptions());
  const chatArchive = useMutation(trpc.chat.setArchived.mutationOptions());
  const chatMute = useMutation(trpc.chat.setMuted.mutationOptions());
  const chatPin = useMutation(trpc.chat.setPinned.mutationOptions());
  const chatLeave = useMutation(trpc.chat.leaveThread.mutationOptions());
  const chatMutations = [chatSend, chatCreateGroup, chatAddMembers, chatRemoveMember, chatRename, chatDiscover, chatInvite, chatAccept, chatDecline, chatArchive, chatMute, chatPin, chatLeave];
  const pending = [updateDirectory, createLocation, updateLocation, updatePlatform, updateWinTags, updateLink, setDefaultQr, saveEmbed, createCollection, updateCollection, createCampaign, updateCampaign, addCampaignWindow, removeCampaignWindow, inviteStaff, updateBrand, bulkAddSigMembers, updateSigMember, updateSigSettings, createSigCampaign, createTicket, createBrand, featureCheckout, ...chatMutations].some((m) => m.isPending);

  /**
   * Refresh every chat surface after a write — inbox, lists, badges, requests.
   *
   * `pathFilter()`, NEVER `queryKey()`. `trpc.x.y.queryKey()` builds
   * `[['x','y'], { type: 'query' }]`, and React Query matches filters by partial
   * deep equality — so that key does NOT match an INFINITE query, whose key
   * carries `{ type: 'infinite' }`. The inbox and the transcript are both
   * infinite, so a `queryKey()` invalidation silently matches nothing and the
   * screen never updates until a remount. Same warning as the chat client's
   * use-invalidate.ts, which earned it.
   */
  const refreshChat = () => {
    for (const filter of [
      trpc.chat.inbox.pathFilter(),
      trpc.chat.threads.pathFilter(),
      trpc.chat.threadMeta.pathFilter(),
      trpc.chat.totalUnread.pathFilter(),
      trpc.chat.requestCount.pathFilter(),
      trpc.chat.listRequests.pathFilter(),
    ]) {
      void qc.invalidateQueries(filter);
    }
  };

  /**
   * Turn the email addresses on a chat card into user ids.
   *
   * THE LOOKUP HAPPENS HERE, ON CONFIRM, and never in the assistant's tool. Whether
   * an address has a Prodesk account is the one question the directory exists to
   * answer carefully — three rate-limit budgets and a single indistinguishable
   * negative result, so it cannot be used to walk the user table. Letting the model
   * ask it in bulk would be exactly that walk. Doing it here means it is the user's
   * own deliberate act, through the same door as the rest of the UI.
   *
   * Serial, not parallel, for the same reason: this is a rate-limited endpoint, and
   * firing eight lookups at once is how a legitimate group ends up half-created.
   */
  const resolveChatEmails = async (emails: string[]) => {
    const userIds: string[] = [];
    const missing: string[] = [];
    for (const email of emails) {
      try {
        const found = await chatDiscover.mutateAsync({ email });
        if (found.found) userIds.push(found.user.id);
        else missing.push(email);
      } catch {
        missing.push(email);
      }
    }
    return { userIds, missing };
  };

  /** Invite the addresses that had no account, and say what happened. */
  const inviteChatMissing = async (missing: string[]) => {
    if (!missing.length) return;
    for (const email of missing) {
      await chatInvite.mutateAsync({ email }).catch(() => {});
    }
    toast.info(
      missing.length === 1
        ? `${missing[0]} has no Prodesk account yet — an invitation is on its way.`
        : `${missing.length} addresses had no Prodesk account yet — invitations are on their way.`,
    );
  };

  const p = values;
  const changes = (p.changes ?? {}) as Record<string, string>;
  // The server sends human-readable labels; humanizeLabel is a defensive fallback
  // so a raw camelCase key (from a tool that forgot to label its changes) never
  // leaks into the card UI as "fullName" / "primaryColor".
  const changeRows = Object.entries(changes).map(([label, value]) => ({ label: humanizeLabel(label), value: String(value) }));
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- payload values are validated server-side; cast to satisfy the specific mutation input types.
  const anyP = p as any;

  interface CardSpec { Icon: typeof Globe; heading: string; cta: string; doneLabel: string; needsBrand: boolean; rows: Array<{ label: string; value: string }>; fields?: FieldSpec[]; run: () => void; }

  const spec: CardSpec = (() => {
    switch (action.kind) {
      case 'update_directory_listing':
        return {
          Icon: Globe, heading: 'Update directory listing', cta: 'Update listing', doneLabel: 'Listing updated', needsBrand: true, rows: changeRows,
          fields: [
            { key: 'websiteUrl', label: 'Website', type: 'url' },
            { key: 'description', label: 'Description', type: 'textarea' },
            { key: 'city', label: 'City' },
          ],
          run: () => updateDirectory.mutate(
            {
              brandId: brandId!,
              directoryOptIn: typeof p.directoryOptIn === 'boolean' ? p.directoryOptIn : undefined,
              websiteUrl: p.websiteUrl !== undefined ? (p.websiteUrl as string | null) : undefined,
              description: p.description !== undefined ? (p.description as string | null) : undefined,
              city: p.city !== undefined ? (p.city as string | null) : undefined,
            },
            { onSuccess: () => { finish(); qc.invalidateQueries({ queryKey: trpc.reviews.directory.myProfile.queryKey() }); toast.success('Directory listing updated.'); }, onError: (e) => toastError(e) },
          ),
        };
      case 'create_review_location':
        return {
          Icon: MapPin, heading: `Create review location: ${String(p.name ?? '')}`, cta: 'Create location', doneLabel: 'Location created', needsBrand: true,
          rows: [{ label: 'Name', value: String(p.name ?? '') }, { label: 'Industry', value: String(p.industry ?? '') }],
          fields: [
            { key: 'name', label: 'Name', required: true },
            { key: 'industry', label: 'Industry', required: true },
          ],
          run: () => createLocation.mutate(
            { brandId: brandId!, name: String(p.name ?? ''), industry: String(p.industry ?? '') },
            { onSuccess: () => { finish(); qc.invalidateQueries({ queryKey: trpc.reviews.locations.list.queryKey() }); toast.success('Review location created.'); }, onError: (e) => toastError(e) },
          ),
        };
      case 'update_review_location':
        return {
          Icon: MapPin, heading: `Update location: ${String(p.locationName ?? 'location')}`, cta: 'Update location', doneLabel: 'Location updated', needsBrand: false, rows: changeRows,
          fields: [
            { key: 'name', label: 'Name' },
            { key: 'badReviewEmail', label: 'Feedback email', type: 'email' },
            { key: 'redirectUrl', label: 'Redirect URL', type: 'url' },
            { key: 'logoUrl', label: 'Logo URL', type: 'url' },
          ],
          run: () => updateLocation.mutate(
            {
              id: String(p.locationId ?? ''),
              name: p.name !== undefined ? String(p.name) : undefined,
              badReviewEmail: p.badReviewEmail !== undefined ? (p.badReviewEmail as string | null) : undefined,
              redirectUrl: p.redirectUrl !== undefined ? (p.redirectUrl as string | null) : undefined,
              logoUrl: p.logoUrl !== undefined ? (p.logoUrl as string | null) : undefined,
            },
            { onSuccess: () => { finish(); qc.invalidateQueries({ queryKey: trpc.reviews.locations.list.queryKey() }); qc.invalidateQueries({ queryKey: trpc.reviews.locations.get.queryKey() }); toast.success('Review location updated.'); }, onError: (e) => toastError(e) },
          ),
        };
      case 'update_review_platform':
        return {
          Icon: Star, heading: `Set ${String(p.platform ?? '')} link`, cta: p.url ? 'Set link' : 'Remove link', doneLabel: 'Platform updated', needsBrand: false,
          rows: [
            { label: 'Location', value: String(p.locationName ?? '') },
            { label: 'Platform', value: String(p.platform ?? '') },
            { label: 'URL', value: String(p.url ?? '') || '— removed —' },
          ],
          fields: [{ key: 'url', label: `${String(p.platform ?? 'Platform')} URL`, type: 'url' }],
          run: () => updatePlatform.mutate(
            { locationId: String(p.locationId ?? ''), platform: anyP.platform, url: String(p.url ?? '') },
            { onSuccess: () => { finish(); qc.invalidateQueries({ queryKey: trpc.reviews.locations.get.queryKey() }); toast.success('Platform link updated.'); }, onError: (e) => toastError(e) },
          ),
        };
      case 'update_short_link':
        return {
          Icon: Pencil, heading: `Edit link: ${String(p.slug ?? 'link')}`, cta: 'Save changes', doneLabel: 'Link updated', needsBrand: false, rows: changeRows,
          fields: [
            { key: 'destinationUrl', label: 'Destination URL', type: 'url' },
            { key: 'nickname', label: 'Nickname' },
          ],
          run: () => updateLink.mutate(
            {
              id: String(p.linkId ?? ''),
              destinationUrl: p.destinationUrl !== undefined ? String(p.destinationUrl) : undefined,
              nickname: p.nickname !== undefined ? String(p.nickname) : undefined,
            },
            { onSuccess: () => { finish(); qc.invalidateQueries({ queryKey: trpc.shortLinks.list.queryKey() }); toast.success('Short link updated.'); }, onError: (e) => toastError(e) },
          ),
        };
      case 'update_qr_style': {
        const isDefault = p.scope === 'default';
        return {
          Icon: QrCode,
          heading: isDefault ? 'Set default QR style' : `Restyle QR: ${String(p.linkNickname ?? 'link')}`,
          cta: 'Apply QR style', doneLabel: 'QR style updated', needsBrand: isDefault, rows: changeRows,
          run: () => {
            if (isDefault) {
              setDefaultQr.mutate(
                { brandId: brandId!, qrConfig: anyP.qrConfig },
                { onSuccess: () => { finish(); qc.invalidateQueries({ queryKey: trpc.shortLinks.defaultQrConfig.queryKey() }); toast.success('Default QR style updated.'); }, onError: (e) => toastError(e) },
              );
            } else {
              updateLink.mutate(
                { id: String(p.linkId ?? ''), qrConfig: anyP.qrConfig },
                { onSuccess: () => { finish(); qc.invalidateQueries({ queryKey: trpc.shortLinks.list.queryKey() }); toast.success('QR style updated.'); }, onError: (e) => toastError(e) },
              );
            }
          },
        };
      }
      case 'save_embed_style':
        return {
          Icon: Palette, heading: `Restyle embed: ${String(p.locationName ?? 'location')}`, cta: 'Apply style', doneLabel: 'Embed updated', needsBrand: false, rows: changeRows,
          run: () => saveEmbed.mutate(
            { locationId: String(p.locationId ?? ''), theme: anyP.theme },
            { onSuccess: () => { finish(); qc.invalidateQueries({ queryKey: trpc.reviews.embed.getForLocation.queryKey() }); toast.success('Embed widget restyled.'); }, onError: (e) => toastError(e) },
          ),
        };
      case 'save_embed_collection': {
        const isCreate = p.mode === 'create';
        const locationNames = Array.isArray(p.locationNames) ? (p.locationNames as string[]).join(', ') : '';
        return {
          Icon: LayoutGrid,
          heading: isCreate ? `Create collection: ${String(p.name ?? '')}` : `Update collection: ${String(p.collectionName ?? 'collection')}`,
          cta: isCreate ? 'Create collection' : 'Update collection',
          doneLabel: isCreate ? 'Collection created' : 'Collection updated',
          needsBrand: true,
          rows: isCreate ? [{ label: 'Name', value: String(p.name ?? '') }, { label: 'Locations', value: locationNames }] : changeRows,
          run: () => {
            if (isCreate) {
              createCollection.mutate(
                { brandId: brandId!, name: String(p.name ?? ''), locationIds: anyP.locationIds },
                { onSuccess: () => { finish(); qc.invalidateQueries({ queryKey: trpc.reviews.collections.list.queryKey() }); toast.success('Embed collection created.'); }, onError: (e) => toastError(e) },
              );
            } else {
              updateCollection.mutate(
                {
                  brandId: brandId!,
                  id: String(p.collectionId ?? ''),
                  name: p.name !== undefined ? String(p.name) : undefined,
                  locationIds: p.locationIds !== undefined ? anyP.locationIds : undefined,
                  theme: p.theme !== undefined ? anyP.theme : undefined,
                },
                { onSuccess: () => { finish(); qc.invalidateQueries({ queryKey: trpc.reviews.collections.list.queryKey() }); toast.success('Embed collection updated.'); }, onError: (e) => toastError(e) },
              );
            }
          },
        };
      }
      case 'update_review_win_tags':
        return {
          Icon: Tag, heading: `Update win-tags: ${String(p.locationName ?? 'location')}`, cta: 'Save win-tags', doneLabel: 'Win-tags updated', needsBrand: false, rows: changeRows,
          run: () => updateWinTags.mutate(
            { locationId: String(p.locationId ?? ''), tags: anyP.tags },
            { onSuccess: () => { finish(); qc.invalidateQueries({ queryKey: trpc.reviews.locations.get.queryKey() }); toast.success('Win-tags updated.'); }, onError: (e) => toastError(e) },
          ),
        };
      /* ── Link campaigns (scheduled short links) ─────────────────────────── */
      case 'create_link_campaign':
        return {
          Icon: CalendarClock,
          heading: `Create campaign: ${String(p.nickname ?? '')}`,
          cta: 'Create campaign',
          doneLabel: 'Campaign created',
          needsBrand: true,
          rows: changeRows,
          fields: [{ key: 'nickname', label: 'Label', required: true }],
          run: () =>
            createCampaign.mutate(
              {
                brandId: brandId!,
                slug: String(p.slug ?? ''),
                nickname: String(p.nickname ?? ''),
                // Exactly one fallback mode reaches here (the tool validates it).
                ...(p.fallbackUrl
                  ? { fallbackUrl: String(p.fallbackUrl) }
                  : { fallbackText: String(p.fallbackText ?? '') }),
                windows: anyP.windows ?? [],
              },
              {
                onSuccess: () => {
                  finish();
                  qc.invalidateQueries({ queryKey: trpc.linkCampaigns.list.queryKey() });
                  toast.success('Campaign created — switch it on when you’re ready.');
                },
                onError: (e) => toastError(e),
              },
            ),
        };
      case 'update_link_campaign':
        return {
          Icon: CalendarClock,
          heading: `Edit campaign: ${String(p.slug ?? 'campaign')}`,
          cta: 'Save changes',
          doneLabel: 'Campaign updated',
          needsBrand: false,
          rows: changeRows,
          run: () =>
            updateCampaign.mutate(
              {
                id: String(p.campaignId ?? ''),
                nickname: p.nickname !== undefined ? String(p.nickname) : undefined,
                ...(p.fallbackUrl !== undefined
                  ? { fallbackUrl: String(p.fallbackUrl) }
                  : {}),
                ...(p.fallbackText !== undefined
                  ? { fallbackText: String(p.fallbackText) }
                  : {}),
              },
              {
                onSuccess: () => {
                  finish();
                  qc.invalidateQueries({ queryKey: trpc.linkCampaigns.list.queryKey() });
                  qc.invalidateQueries({ queryKey: trpc.linkCampaigns.byId.queryKey() });
                  toast.success('Campaign updated.');
                },
                onError: (e) => toastError(e),
              },
            ),
        };
      case 'add_campaign_window':
        return {
          Icon: CalendarClock,
          heading: `Schedule window: ${String(p.slug ?? 'campaign')}`,
          cta: 'Add window',
          doneLabel: 'Window scheduled',
          needsBrand: false,
          rows: changeRows,
          run: () =>
            addCampaignWindow.mutate(
              {
                campaignId: String(p.campaignId ?? ''),
                label: p.label !== undefined ? String(p.label) : undefined,
                destinationUrl: String(p.destinationUrl ?? ''),
                startsAt: new Date(String(p.startsAt ?? '')),
                endsAt: new Date(String(p.endsAt ?? '')),
              },
              {
                onSuccess: () => {
                  finish();
                  qc.invalidateQueries({ queryKey: trpc.linkCampaigns.list.queryKey() });
                  qc.invalidateQueries({ queryKey: trpc.linkCampaigns.byId.queryKey() });
                  toast.success('Window scheduled.');
                },
                onError: (e) => toastError(e),
              },
            ),
        };
      case 'remove_campaign_window':
        return {
          Icon: CalendarClock,
          heading: `Remove window: ${String(p.slug ?? 'campaign')}`,
          cta: 'Remove window',
          doneLabel: 'Window removed',
          needsBrand: false,
          rows: changeRows,
          run: () =>
            removeCampaignWindow.mutate(
              { windowId: String(p.windowId ?? '') },
              {
                onSuccess: () => {
                  finish();
                  qc.invalidateQueries({ queryKey: trpc.linkCampaigns.list.queryKey() });
                  qc.invalidateQueries({ queryKey: trpc.linkCampaigns.byId.queryKey() });
                  toast.success('Window removed.');
                },
                onError: (e) => toastError(e),
              },
            ),
        };
      /* ── Chat ─────────────────────────────────────────────────────────
         The message text and the group name are EDITABLE fields, deliberately:
         these go out under the user's own name with nothing marking them as
         drafted, so the last word has to be theirs. `needsBrand` is false for
         all of them — a conversation belongs to the person, not the brand. */
      case 'send_chat_message':
        return {
          Icon: Send, heading: `Send to ${String(p.threadName ?? 'conversation')}`, cta: 'Send message', doneLabel: 'Message sent', needsBrand: false,
          rows: [],
          fields: [{ key: 'message', label: 'Message', type: 'textarea', rows: 4, required: true }],
          run: () => chatSend.mutate(
            { threadId: String(p.threadId ?? ''), content: String(p.message ?? '').trim(), type: 'text' },
            {
              onSuccess: () => {
                finish();
                refreshChat();
                void qc.invalidateQueries(trpc.chat.messages.pathFilter());
                toast.success('Message sent.');
              },
              onError: (e) => toastError(e),
            },
          ),
        };
      case 'create_chat_group': {
        const members = (Array.isArray(p.members) ? p.members : []) as Array<{ userId: string; name: string }>;
        const emails = (Array.isArray(p.emails) ? p.emails : []) as string[];
        return {
          Icon: Users, heading: String(p.name ?? '').trim() ? `New group: ${String(p.name)}` : 'New group', cta: 'Create group', doneLabel: 'Group created', needsBrand: false,
          rows: [
            { label: 'People', value: [...members.map((m) => m.name), ...emails].join(', ') || '—' },
          ],
          fields: [{ key: 'name', label: 'Group name' }],
          run: () => {
            void (async () => {
              const { userIds, missing } = await resolveChatEmails(emails);
              const memberIds = [...new Set([...members.map((m) => m.userId), ...userIds])];
              if (!memberIds.length) {
                // Nobody resolved. Still invite the strangers — that IS the
                // useful half of what was asked — but do not pretend a group
                // was made.
                await inviteChatMissing(missing);
                toast.error('Nobody with a Prodesk account to add yet, so no group was created.');
                return;
              }
              chatCreateGroup.mutate(
                { name: String(p.name ?? '').trim() || undefined, memberIds },
                {
                  onSuccess: async () => {
                    finish();
                    refreshChat();
                    toast.success('Group created.');
                    await inviteChatMissing(missing);
                  },
                  onError: (e) => toastError(e),
                },
              );
            })();
          },
        };
      }
      case 'update_chat_members': {
        const members = (Array.isArray(p.members) ? p.members : []) as Array<{ userId: string; name: string }>;
        const emails = (Array.isArray(p.emails) ? p.emails : []) as string[];
        const removing = p.mode === 'remove';
        const threadId = String(p.threadId ?? '');
        return {
          Icon: removing ? UserMinus : UserPlus,
          heading: `${removing ? 'Remove from' : 'Add to'} ${String(p.threadName ?? 'group')}`,
          cta: removing ? 'Remove' : 'Add to group',
          doneLabel: removing ? 'Removed' : 'Added',
          needsBrand: false,
          rows: [{ label: 'People', value: [...members.map((m) => m.name), ...emails].join(', ') || '—' }],
          run: () => {
            void (async () => {
              if (removing) {
                // One at a time: `removeMember` takes a single user, and doing
                // them in sequence means a failure on the third does not leave
                // the caller guessing which two went through.
                for (const m of members) {
                  await chatRemoveMember.mutateAsync({ threadId, userId: m.userId }).catch((e) => toastError(e));
                }
                finish();
                refreshChat();
                void qc.invalidateQueries(trpc.chat.members.pathFilter());
                toast.success(members.length === 1 ? `${members[0].name} removed.` : `${members.length} people removed.`);
                return;
              }
              const { userIds, missing } = await resolveChatEmails(emails);
              const ids = [...new Set([...members.map((m) => m.userId), ...userIds])];
              if (!ids.length) {
                await inviteChatMissing(missing);
                toast.error('Nobody with a Prodesk account to add yet.');
                return;
              }
              chatAddMembers.mutate(
                { threadId, userIds: ids },
                {
                  onSuccess: async () => {
                    finish();
                    refreshChat();
                    void qc.invalidateQueries(trpc.chat.members.pathFilter());
                    toast.success(ids.length === 1 ? 'Added to the group.' : `${ids.length} people added.`);
                    await inviteChatMissing(missing);
                  },
                  onError: (e) => toastError(e),
                },
              );
            })();
          },
        };
      }
      case 'rename_chat_group':
        return {
          Icon: Pencil, heading: `Rename “${String(p.currentName ?? 'group')}”`, cta: 'Rename group', doneLabel: 'Group renamed', needsBrand: false,
          rows: [{ label: 'Currently', value: String(p.currentName ?? '—') }],
          fields: [{ key: 'name', label: 'New name', required: true }],
          run: () => chatRename.mutate(
            { threadId: String(p.threadId ?? ''), name: String(p.name ?? '').trim() },
            {
              onSuccess: () => {
                finish();
                refreshChat();
                void qc.invalidateQueries(trpc.chat.threadMeta.pathFilter());
                toast.success('Group renamed.');
              },
              onError: (e) => toastError(e),
            },
          ),
        };
      case 'invite_to_chat':
        return {
          Icon: Mail, heading: `Invite ${String(p.email ?? '')} to Chat`, cta: 'Send invitation', doneLabel: 'Invitation sent', needsBrand: false,
          rows: [],
          fields: [{ key: 'email', label: 'Email', type: 'email', required: true }],
          run: () => chatInvite.mutate(
            { email: String(p.email ?? '').trim().toLowerCase() },
            {
              onSuccess: () => {
                finish();
                // Deliberately the same wording whether or not that address
                // already had an account — the invite procedure will not say
                // which, and neither should this.
                toast.success(`Invitation sent to ${String(p.email ?? '')}.`);
              },
              onError: (e) => toastError(e),
            },
          ),
        };
      case 'answer_chat_request': {
        const declining = p.decision === 'decline';
        const blocking = declining && p.block === true;
        return {
          Icon: declining ? X : Check,
          heading: `${declining ? 'Decline' : 'Accept'} the request from ${String(p.fromName ?? 'someone')}`,
          cta: declining ? (blocking ? 'Decline and block' : 'Decline') : 'Accept',
          doneLabel: declining ? 'Declined' : 'Accepted',
          needsBrand: false,
          rows: blocking ? [{ label: 'Also', value: 'Block them from messaging again' }] : [],
          run: () => {
            const threadId = String(p.threadId ?? '');
            const onSuccess = () => {
              finish();
              refreshChat();
              toast.success(declining ? 'Request declined.' : 'Request accepted.');
            };
            if (declining) chatDecline.mutate({ threadId, block: blocking }, { onSuccess, onError: (e) => toastError(e) });
            else chatAccept.mutate({ threadId }, { onSuccess, onError: (e) => toastError(e) });
          },
        };
      }
      case 'update_chat_conversation': {
        const act = String(p.action ?? '');
        const threadId = String(p.threadId ?? '');
        const name = String(p.threadName ?? 'conversation');
        const mutedHours = typeof p.mutedHours === 'number' ? p.mutedHours : null;
        const labels: Record<string, { heading: string; cta: string; done: string }> = {
          archive: { heading: `Archive “${name}”`, cta: 'Archive', done: 'Archived' },
          unarchive: { heading: `Unarchive “${name}”`, cta: 'Unarchive', done: 'Unarchived' },
          mute: { heading: `Mute “${name}”`, cta: 'Mute', done: 'Muted' },
          unmute: { heading: `Unmute “${name}”`, cta: 'Unmute', done: 'Unmuted' },
          pin: { heading: `Pin “${name}”`, cta: 'Pin to top', done: 'Pinned' },
          unpin: { heading: `Unpin “${name}”`, cta: 'Unpin', done: 'Unpinned' },
          leave: { heading: `Leave “${name}”`, cta: 'Leave group', done: 'Left the group' },
        };
        const label = labels[act] ?? { heading: name, cta: 'Apply', done: 'Done' };
        return {
          Icon: MessageSquare, heading: label.heading, cta: label.cta, doneLabel: label.done, needsBrand: false,
          rows:
            act === 'mute'
              ? [{ label: 'For', value: mutedHours ? `${mutedHours} hour${mutedHours === 1 ? '' : 's'}` : 'Until you turn it back on' }]
              : act === 'leave'
                ? [{ label: 'Note', value: 'You won’t be able to rejoin yourself.' }]
                : [],
          run: () => {
            const onSuccess = () => {
              finish();
              refreshChat();
              toast.success(label.done + '.');
            };
            const onError = (e: unknown) => toastError(e);
            switch (act) {
              case 'archive':
              case 'unarchive':
                return chatArchive.mutate({ threadId, archived: act === 'archive' }, { onSuccess, onError });
              case 'mute':
                return chatMute.mutate(
                  {
                    threadId,
                    // The procedure takes an INSTANT, not a duration, so
                    // "until I turn it back on" is the shared MUTE_FOREVER
                    // sentinel — the same one the mute menu sends, so the UI
                    // renders it as indefinite rather than as a date in 2124.
                    // (`null` here would mean UNmute.)
                    until: mutedHours
                      ? new Date(Date.now() + mutedHours * 3_600_000)
                      : new Date(MUTE_FOREVER),
                  },
                  { onSuccess, onError },
                );
              case 'unmute':
                return chatMute.mutate({ threadId, until: null }, { onSuccess, onError });
              case 'pin':
              case 'unpin':
                return chatPin.mutate({ threadId, pinned: act === 'pin' }, { onSuccess, onError });
              case 'leave':
                return chatLeave.mutate({ threadId }, { onSuccess, onError });
              default:
                return toast.error('That change isn’t something this card can apply.');
            }
          },
        };
      }
      case 'invite_staff_member':
        return {
          Icon: UserPlus, heading: `Invite team member: ${String(p.email ?? '')}`, cta: 'Send invite', doneLabel: 'Invite sent', needsBrand: true, rows: changeRows,
          fields: [{ key: 'email', label: 'Email', type: 'email', required: true }],
          run: () => inviteStaff.mutate(
            { orgType: 'brand', orgId: brandId!, email: String(p.email ?? ''), permissions: anyP.permissions ?? [] },
            { onSuccess: () => { finish(); qc.invalidateQueries({ queryKey: trpc.staff.list.queryKey() }); toast.success(`Invitation sent to ${String(p.email ?? '')}.`); }, onError: (e) => toastError(e) },
          ),
        };
      case 'set_brand_policy':
        return {
          Icon: FileText, heading: p.mode === 'edit' ? `Update policy: ${String(p.policyTitle ?? '')}` : `Add policy: ${String(p.policyTitle ?? '')}`, cta: p.mode === 'edit' ? 'Update policy' : 'Add policy', doneLabel: p.mode === 'edit' ? 'Policy updated' : 'Policy added', needsBrand: true, rows: changeRows,
          fields: [
            { key: 'title', label: 'Policy title', required: true },
            { key: 'body', label: 'Policy text', type: 'textarea', rows: 6, required: true },
          ],
          // Apply the (possibly edited) title/body onto the target policy — the one
          // matching policyId when editing, else the just-appended last entry.
          run: () => {
            const list = (Array.isArray(anyP.policies) ? anyP.policies : []) as Array<{ id: string; title: string; body: string }>;
            const title = String(p.title ?? '').trim();
            const body = String(p.body ?? '').trim();
            const next = p.policyId
              ? list.map((pol) => (pol.id === p.policyId ? { ...pol, title, body } : pol))
              : list.map((pol, i) => (i === list.length - 1 ? { ...pol, title, body } : pol));
            updateBrand.mutate(
              { brandId: brandId!, policies: next },
              { onSuccess: () => { finish(); qc.invalidateQueries({ queryKey: trpc.brands.byId.queryKey() }); qc.invalidateQueries({ queryKey: trpc.brands.mine.queryKey() }); toast.success('Brand policy saved.'); }, onError: (e) => toastError(e) },
            );
          },
        };
      case 'add_signature_members': {
        const members = (Array.isArray(p.members) ? p.members : []) as Array<Record<string, any> & { fullName: string }>;
        const onCreated = (n: number) => {
          finish();
          qc.invalidateQueries({ queryKey: trpc.signatures.members.list.queryKey() });
          qc.invalidateQueries({ queryKey: trpc.signatures.brands.get.queryKey() });
          qc.invalidateQueries({ queryKey: trpc.signatures.entitlement.queryKey() });
          toast.success(`${n} signature member${n === 1 ? '' : 's'} added.`);
        };
        // `allowSubscribe` guards the retry: subscribe at most once, then re-run
        // the bulk add — a second needs_subscription means something is off, so
        // surface it instead of looping.
        const runBulk = (allowSubscribe: boolean) =>
          bulkAddSigMembers.mutate(
            { brandId: brandId!, members },
            {
              onSuccess: (res) => {
                if (res.status === 'created') {
                  onCreated(res.createdCount);
                } else if (res.status === 'needs_subscription') {
                  if (!allowSubscribe || !res.priceId) {
                    toast.error('A Signatures subscription is required — subscribe from the Signatures Billing page, then confirm again.');
                    return;
                  }
                  featureCheckout.mutate(
                    { brandId: brandId!, priceId: res.priceId, ...checkoutReturnUrls() },
                    {
                      onSuccess: (co) => {
                        if (co.status === 'active' || co.status === 'already_active' || co.status === 'activated_dev') {
                          runBulk(false);
                        } else if (co.url) {
                          window.open(co.url, '_blank', 'noopener');
                          toast.info('Complete the subscription in the opened tab, then confirm again.');
                        }
                      },
                      onError: (e) => toastError(e),
                    },
                  );
                }
              },
              onError: (e) => toastError(e),
            },
          );
        return {
          Icon: UserPlus,
          heading: `Add ${members.length} signature member${members.length === 1 ? '' : 's'}`,
          cta: members.length === 1 ? 'Add member' : `Add ${members.length} members`,
          doneLabel: 'Members added',
          needsBrand: true,
          rows: members.map((m, i) => ({
            label: `${i + 1}. ${m.fullName ?? 'Member'}`,
            value: [m.jobTitle, m.email].filter(Boolean).join(' · ') || '—',
          })),
          run: () => runBulk(true),
        };
      }
      case 'update_signature_member':
        return {
          Icon: Pencil, heading: `Edit signature member: ${String(p.memberName ?? 'member')}`, cta: 'Save changes', doneLabel: 'Member updated', needsBrand: false, rows: changeRows,
          fields: [
            { key: 'fullName', label: 'Full name', required: true },
            { key: 'jobTitle', label: 'Job title' },
            { key: 'department', label: 'Department' },
            { key: 'email', label: 'Email', type: 'email' },
            { key: 'phone', label: 'Phone', type: 'tel' },
            { key: 'mobile', label: 'Mobile', type: 'tel' },
            { key: 'linkedin', label: 'LinkedIn', type: 'url' },
            { key: 'twitter', label: 'X / Twitter', type: 'url' },
            { key: 'instagram', label: 'Instagram', type: 'url' },
            { key: 'facebook', label: 'Facebook', type: 'url' },
            { key: 'youtube', label: 'YouTube', type: 'url' },
            { key: 'tiktok', label: 'TikTok', type: 'url' },
            { key: 'websiteLink', label: 'Website', type: 'url' },
          ],
          // Rebuild `data` from the proposed keys, reading the (possibly edited)
          // top-level values so the user's edits flow through to the mutation.
          run: () => updateSigMember.mutate(
            { id: String(p.memberId ?? ''), data: Object.fromEntries(Object.keys((anyP.data ?? {}) as Record<string, unknown>).map((k) => [k, String(p[k] ?? '')])) },
            { onSuccess: () => { finish(); qc.invalidateQueries({ queryKey: trpc.signatures.members.list.queryKey() }); toast.success('Signature member updated.'); }, onError: (e) => toastError(e) },
          ),
        };
      case 'update_signature_settings':
        return {
          Icon: Palette, heading: 'Update signature design', cta: 'Apply settings', doneLabel: 'Settings updated', needsBrand: true, rows: changeRows,
          run: () => updateSigSettings.mutate(
            { brandId: brandId!, data: anyP.data ?? {} },
            { onSuccess: () => { finish(); qc.invalidateQueries({ queryKey: trpc.signatures.brands.get.queryKey() }); qc.invalidateQueries({ queryKey: trpc.signatures.brands.list.queryKey() }); toast.success('Signature settings updated.'); }, onError: (e) => toastError(e) },
          ),
        };
      case 'create_signature_campaign':
        return {
          Icon: Megaphone, heading: `Create signature campaign: ${String(p.name ?? '')}`, cta: 'Create campaign', doneLabel: 'Campaign created', needsBrand: false, rows: changeRows,
          fields: [
            { key: 'name', label: 'Campaign name', required: true },
            { key: 'linkUrl', label: 'Click-through URL', type: 'url' },
            { key: 'startsAt', label: 'Starts', type: 'date', future: true },
            { key: 'endsAt', label: 'Ends', type: 'date', future: true },
          ],
          run: () => createSigCampaign.mutate(
            {
              signatureBrandId: String(p.signatureBrandId ?? ''),
              name: String(p.name ?? ''),
              linkUrl: p.linkUrl !== undefined ? String(p.linkUrl) : undefined,
              startsAt: p.startsAt ? new Date(String(p.startsAt)) : undefined,
              endsAt: p.endsAt ? new Date(String(p.endsAt)) : undefined,
              memberId: p.memberId ? String(p.memberId) : undefined,
              rotationMode: anyP.rotationMode,
            },
            { onSuccess: () => { finish(); qc.invalidateQueries({ queryKey: trpc.signatures.campaigns.list.queryKey() }); toast.success('Signature campaign created. Upload its banner image in the Signatures app.'); }, onError: (e) => toastError(e) },
          ),
        };
      case 'create_support_ticket':
        return {
          Icon: LifeBuoy, heading: `Support ticket: ${String(p.subject ?? '')}`, cta: 'Submit ticket', doneLabel: 'Ticket submitted', needsBrand: false,
          rows: [
            { label: 'Subject', value: String(p.subject ?? '') },
            { label: 'Category', value: String(p.category ?? 'general') },
            { label: 'Priority', value: String(p.priority ?? 'medium') },
            { label: 'Message', value: String(p.body ?? '') },
          ],
          fields: [
            { key: 'subject', label: 'Subject', required: true },
            { key: 'body', label: 'Message', type: 'textarea', rows: 4, required: true },
          ],
          run: () => createTicket.mutate(
            {
              subject: String(p.subject ?? ''),
              body: String(p.body ?? ''),
              category: anyP.category ?? 'general',
              priority: anyP.priority ?? 'medium',
              writtenByAi: true,
            },
            { onSuccess: () => { finish(); qc.invalidateQueries({ queryKey: trpc.support.list.queryKey() }); toast.success('Support ticket submitted — replies land on the Support page.'); }, onError: (e) => toastError(e) },
          ),
        };
      case 'create_brand':
        return {
          Icon: Building2, heading: `Create brand: ${String(p.businessName ?? '')}`, cta: 'Create brand', doneLabel: 'Brand created', needsBrand: false, rows: changeRows,
          fields: [
            { key: 'businessName', label: 'Business name', required: true },
            { key: 'email', label: 'Email', type: 'email' },
            { key: 'website', label: 'Website', type: 'url' },
            { key: 'phone', label: 'Phone', type: 'tel' },
          ],
          run: () => createBrand.mutate(
            {
              businessName: String(p.businessName ?? ''),
              email: p.email ? String(p.email) : undefined,
              website: p.website ? String(p.website) : undefined,
              phone: p.phone ? String(p.phone) : undefined,
            },
            { onSuccess: () => { finish(); qc.invalidateQueries({ queryKey: trpc.brands.mine.queryKey() }); toast.success('Brand created — switch to it from the workspace selector.'); }, onError: (e) => toastError(e) },
          ),
        };
      default:
        return { Icon: Sparkles, heading: 'Confirm action', cta: 'Confirm', doneLabel: 'Done', needsBrand: false, rows: changeRows, run: () => {} };
    }
  })();

  // Only render editable inputs for the fields the model actually proposed on this
  // card (present in the original payload) — not every possible field for the kind.
  const shownFields = (spec.fields ?? []).filter((f) =>
    Object.prototype.hasOwnProperty.call(action.payload as Record<string, unknown>, f.key),
  );
  const fieldErrors = validateFields(shownFields, values);
  const hasFieldErrors = Object.keys(fieldErrors).length > 0;
  // Keep the edited-values snapshot current so finish() reports what was applied.
  editsRef.current = shownFields.length
    ? Object.fromEntries(shownFields.map((f) => [f.key, values[f.key]]))
    : undefined;
  const nothingToDo = shownFields.length === 0 && spec.rows.length === 0;

  const run = () => {
    if (spec.needsBrand && !brandId) {
      toast.error('Could not determine which brand this applies to.');
      return;
    }
    spec.run();
  };
  const { Icon } = spec;
  const applyRegen = (v: Record<string, unknown>) => setValues((s) => ({ ...s, ...v }));
  // The ORIGINAL card content (base A), captured once before any edits, so every
  // regenerate press reimagines from the same origin (A→B, A→C, …).
  const regenBaseRef = useRef<Record<string, unknown> | null>(null);
  regenBaseRef.current ??= values;
  const regenBase = regenBaseRef.current;

  return (
    <div className={cn('rounded-[var(--radius-md)] border border-[color:var(--color-border-default)] bg-card p-3', outcome === 'rejected' && 'opacity-60')}>
      <div className="mb-1.5 flex items-center gap-2 text-xs font-semibold text-ink-100">
        <Icon className="h-3.5 w-3.5 text-accent" /> {spec.heading}
        <div className="ml-auto flex items-center gap-1.5">
          {!outcome && !nothingToDo && (
            <RegenerateCardButton threadId={threadId} kind={action.kind} base={regenBase} onApply={applyRegen} regen={regen} />
          )}
          <span className="rounded-full bg-inset px-2 py-0.5 text-[10px] font-medium text-ink-40">
            {outcome === 'confirmed' ? 'Done' : outcome === 'rejected' ? 'Dismissed' : 'Confirm'}
          </span>
        </div>
      </div>
      {!outcome && !nothingToDo && (
        <RegenerationBar base={regenBase} onApply={applyRegen} generations={regen.generations} />
      )}
      <div className="rounded-[var(--radius-sm)] bg-inset px-2.5 py-2 text-sm text-ink-100">
        {outcome ? (
          // Once resolved, show the (possibly edited) final values read-only.
          shownFields.length ? (
            <dl className="space-y-1.5">
              {shownFields.map((f) => (
                <div key={f.key}>
                  <dt className="text-[11px] font-medium text-ink-40">{f.label}</dt>
                  <dd className="whitespace-pre-wrap break-all text-ink-100">
                    {String(values[f.key] ?? '') || <span className="text-ink-40">— cleared —</span>}
                  </dd>
                </div>
              ))}
            </dl>
          ) : spec.rows.length === 0 ? (
            <span className="text-ink-60">No changes proposed.</span>
          ) : (
            <dl className="space-y-1.5">
              {spec.rows.map((row) => (
                <div key={row.label}>
                  <dt className="text-[11px] font-medium text-ink-40">{row.label}</dt>
                  <dd className="whitespace-pre-wrap break-all text-ink-100">{row.value || <span className="text-ink-40">— cleared —</span>}</dd>
                </div>
              ))}
            </dl>
          )
        ) : shownFields.length ? (
          <EditableCardFields
            specs={shownFields}
            values={values}
            errors={fieldErrors}
            onChange={(key, value) => setValues((v) => ({ ...v, [key]: value }))}
          />
        ) : spec.rows.length === 0 ? (
          <span className="text-ink-60">No changes proposed.</span>
        ) : (
          <dl className="space-y-1.5">
            {spec.rows.map((row) => (
              <div key={row.label}>
                <dt className="text-[11px] font-medium text-ink-40">{row.label}</dt>
                <dd className="whitespace-pre-wrap break-all text-ink-100">{row.value || <span className="text-ink-40">— cleared —</span>}</dd>
              </div>
            ))}
          </dl>
        )}
      </div>
      <ActionBillingNote billing={billingOf(p)} />
      <div className="mt-2 flex items-center justify-end gap-2">
        {outcome ? (
          <ResolvedBadge action={action} outcome={outcome} doneLabel={spec.doneLabel} />
        ) : (
          <>
            <Button variant="ghost" size="sm" onClick={onReject} disabled={pending}>
              Dismiss
            </Button>
            <Button
              variant="accent"
              size="sm"
              onClick={run}
              disabled={pending || (spec.needsBrand && !brandId) || nothingToDo || hasFieldErrors}
            >
              {pending ? <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" /> : <Icon className="mr-1 h-3.5 w-3.5" />}
              {spec.cta}
            </Button>
          </>
        )}
      </div>
    </div>
  );
}

interface MessageItem {
  id: string;
  threadId: string;
  senderId: string | null;
  senderName: string | null;
  senderAvatar: string | null;
  senderRole: string | null;
  senderBusinessName: string | null;
  isAi: boolean;
  aiRating: 1 | -1 | null;
  // Who cast the thumbs vote + whether a super-admin resolved the feedback. Not
  // used by the chat UI, but present on the server row so the type must carry
  // them (super-admin Strategy Feedback reads both).
  aiRatedBy: string | null;
  aiFeedbackResolvedAt: Date | null;
  content: string | null;
  type: 'system' | 'text' | 'image' | 'video' | 'document';
  fileUrl: string | null;
  fileName: string | null;
  fileSize: number | null;
  thumbnailUrl: string | null;
  projectId: string | null;
  project: { id: string; title: string | null; status: string | null } | null;
  replyToId: string | null;
  // Set when the message arrived via the consumer messenger's Forward. Mirrored
  // here for the same reason as the soft edit/delete columns below — the server
  // row carries it, so the inferred page type does too.
  isForwarded: boolean;
  // Soft edit / soft delete, added for the consumer messenger
  // (clients/chat). This workspace panel does not offer either action, but the
  // server row carries the columns, so `MessageItem` must too — the
  // `chat.messages` page type is inferred from the row and a missing field here
  // fails every frontend's build. A tombstone is still worth rendering if one
  // ever arrives: a chat_thread this panel shows could be edited from elsewhere.
  editedAt: Date | null;
  deletedAt: Date | null;
  deletedBy: string | null;
  timestamp: string;
  // Confirm-action cards persisted on an AI turn's final message, the legacy
  // resolved-ids set, and the per-action outcome map (toolUseId → confirmed/
  // rejected). Present on history-fetched rows; realtime INSERT rows predate the
  // action write, so they arrive null and hydrate on the next fetch (the turn's
  // own `onDone` patches them onto the cache row immediately for the sender).
  pendingActions: AiPendingAction[] | null;
  resolvedActionIds: string[] | null;
  actionOutcomes: Record<string, 'confirmed' | 'rejected'> | null;
  // Per-card final edited values, and the model's opt-in to be re-invoked once
  // every card on this message settles (server-side signals; not read by the UI).
  actionEdits: Record<string, Record<string, unknown>> | null;
  // Per-card "Regenerate" history, keyed by toolUseId → ordered list of reimagined
  // payloads (gen1, gen2, …). Drives the gen chips; persisted so they survive a
  // reload and are shared across the team. Capped at 5 per card.
  actionRegenerations: Record<string, Record<string, unknown>[]> | null;
  awaitSettlementFollowup: boolean;
  settlementFollowupFiredAt: Date | null;
}

/** One page of the keyset-paginated `chat.messages` infinite query. */
interface MessagesPage {
  items: MessageItem[];
  nextCursor: { timestamp: string; id: string } | null;
}

/** Parse a realtime jsonb/array column: Supabase usually delivers it already
 *  decoded (object/array), but tolerate a JSON string too. Returns null on
 *  absence or parse failure so a bad value never throws mid-render. */
function jsonCol<T>(v: unknown): T | null {
  if (v == null) return null;
  if (typeof v === 'string') {
    try {
      return JSON.parse(v) as T;
    } catch {
      return null;
    }
  }
  return v as T;
}

/** Map a raw `chat_messages` realtime row (snake_case) to a `MessageItem`. */
function mapRealtimeRow(r: Record<string, unknown>): MessageItem {
  const s = (k: string) => (r[k] == null ? null : String(r[k]));
  // The Drizzle field is `timestamp` but the underlying column is `created_at`,
  // so realtime rows carry it as snake_case. Normalize to a real ISO string and
  // fall back to "now" so a missing/odd value never renders as Invalid Date.
  const rawTs = r.created_at ?? r.timestamp;
  const parsed = rawTs != null ? new Date(String(rawTs)) : null;
  const ts = parsed && !Number.isNaN(parsed.getTime()) ? parsed.toISOString() : new Date().toISOString();
  return {
    id: String(r.id),
    threadId: String(r.thread_id),
    senderId: r.sender_id ? String(r.sender_id) : null,
    senderName: s('sender_name'),
    senderAvatar: s('sender_avatar'),
    senderRole: s('sender_role'),
    senderBusinessName: s('sender_business_name'),
    isAi: Boolean(r.is_ai),
    aiRating: r.ai_rating == null ? null : ((Number(r.ai_rating) === 1 ? 1 : -1) as 1 | -1),
    aiRatedBy: s('ai_rated_by'),
    aiFeedbackResolvedAt: r.ai_feedback_resolved_at ? new Date(String(r.ai_feedback_resolved_at)) : null,
    content: s('content'),
    type: (r.type as MessageItem['type']) ?? 'text',
    fileUrl: s('file_url'),
    fileName: s('file_name'),
    fileSize: r.file_size == null ? null : Number(r.file_size),
    thumbnailUrl: s('thumbnail_url'),
    projectId: s('project_id'),
    replyToId: s('reply_to_id'),
    isForwarded: Boolean(r.is_forwarded),
    editedAt: r.edited_at ? new Date(String(r.edited_at)) : null,
    deletedAt: r.deleted_at ? new Date(String(r.deleted_at)) : null,
    deletedBy: s('deleted_by'),
    timestamp: ts,
    // Project cards are hydrated on the next full fetch; null is fine meanwhile.
    project: null,
    // Pending-action cards + their outcomes are written after the turn completes
    // (a later UPDATE). On an INSERT echo these columns are still null; on an
    // UPDATE echo they carry the real values — parse them either way.
    pendingActions: jsonCol<AiPendingAction[]>(r.pending_actions),
    resolvedActionIds: jsonCol<string[]>(r.resolved_action_ids),
    actionOutcomes: jsonCol<Record<string, 'confirmed' | 'rejected'>>(r.action_outcomes),
    actionEdits: jsonCol<Record<string, Record<string, unknown>>>(r.action_edits),
    actionRegenerations: jsonCol<Record<string, Record<string, unknown>[]>>(r.action_regenerations),
    awaitSettlementFollowup: Boolean(r.await_settlement_followup),
    settlementFollowupFiredAt: r.settlement_followup_fired_at ? new Date(String(r.settlement_followup_fired_at)) : null,
  };
}

const CHAT_BUCKET = StorageBucket.Chat;
/** Virtuoso needs a large base index so prepending older pages can decrement it. */
const VIRTUOSO_START_INDEX = 1_000_000;
/** Messages fetched per page (keyset pagination). */
const PAGE_SIZE = 30;
/** Throttle window for outgoing typing broadcasts (chat_repository typing TTL). */
const TYPING_THROTTLE_MS = 1500;
/** A peer is considered "still typing" until this long after their last event. */
const TYPING_EXPIRY_MS = 4000;
/**
 * Burst absorption (see @shared/lib/coalesce, and the long note on the realtime
 * effect below).
 *
 * Cache writes are batched tightly — short enough to be indistinguishable from
 * instant, long enough that a burst collapses into a few React commits instead
 * of one per socket frame. Refetches are batched far more lazily, because they
 * are network calls whose result is a badge or a preview line: half a second
 * behind a burst is invisible, thirty requests ahead of it is an outage.
 */
const WRITE_COALESCE_MS = 40;
const WRITE_COALESCE_MAX_MS = 200;
const REFETCH_COALESCE_MS = 400;
const REFETCH_COALESCE_MAX_MS = 2_000;
/**
 * Mark-read debounce. Every mark-read is a mutation plus a broadcast that makes
 * every other member refetch, so firing one per arriving message is quadratic in
 * a busy group. The ceiling keeps a continuously busy thread reporting itself
 * read on a schedule rather than only once the room goes quiet.
 */
const MARK_READ_DEBOUNCE_MS = 500;
const MARK_READ_MAX_WAIT_MS = 2_500;
/** One frozen empty array, so a message with no reactions keeps a stable prop. */
const EMPTY_REACTIONS: ReactionSummary[] = [];

function fileTypeFromName(name: string): 'image' | 'video' | 'document' {
  const ext = name.split('.').pop()?.toLowerCase() ?? '';
  if (['jpg', 'jpeg', 'png', 'gif', 'webp'].includes(ext)) return 'image';
  if (['mp4', 'mov', 'avi', 'mkv', 'webm'].includes(ext)) return 'video';
  return 'document';
}

/** Time + read-receipt ticks below a message (chat_message_bubble.dart:110-140). */
function MessageMeta({ ts, mine, readByOthers }: { ts: string; mine: boolean; readByOthers: boolean }) {
  return (
    <span className="mt-0.5 flex items-center gap-1 text-[10px] text-ink-30">
      {new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
      {mine && (readByOthers ? <CheckCheck className="h-3 w-3 text-accent" /> : <Check className="h-3 w-3" />)}
    </span>
  );
}

/** Centered date/time separator between message groups (chat_time_divider.dart). */
function TimeDivider({ ts }: { ts: string }) {
  return (
    <div className="my-3 flex items-center gap-2 px-2">
      <span className="h-px flex-1 bg-[color:var(--color-border-hairline)]" />
      <span className="rounded-[10px] bg-inset px-2.5 py-1 text-[10px] font-bold text-ink-100">{timeDividerLabel(ts)}</span>
      <span className="h-px flex-1 bg-[color:var(--color-border-hairline)]" />
    </div>
  );
}

/**
 * Sender name + role + entity line above the first message in a group.
 * Ports `MessageSenderHeader`: "Name • Role at Entity" with role/entity coloring.
 */
function SenderHeader({ m, member }: { m: MessageItem; member?: ThreadMember }) {
  const name = member?.name ?? m.senderName ?? 'Unknown';
  const role = member?.role ?? m.senderRole ?? '';
  const entity = member?.entity ?? m.senderBusinessName ?? '';
  const roleColor = roleColorClass(member?.memberRole);
  if (!role && !entity) {
    return <div className="mb-0.5 text-[11px] font-bold text-ink-100">{name}</div>;
  }
  return (
    <div className="mb-0.5 flex items-baseline gap-1 text-[10px]">
      <span className="text-[11px] font-bold text-ink-100">{name}</span>
      <span className="text-ink-40">•</span>
      <span className={cn('font-medium', roleColor)}>{role}</span>
      {entity && (
        <>
          <span className="text-ink-40">at</span>
          <span className="truncate font-medium text-ink-100">{entity}</span>
        </>
      )}
    </div>
  );
}

function ProjectCard({ project, projectId, onOpen }: { project: MessageItem['project']; projectId: string; onOpen: (id: string) => void }) {
  return (
    <button
      onClick={() => onOpen(projectId)}
      className="mt-1 flex w-full items-center gap-2 rounded-[var(--radius-sm)] border border-[color:var(--color-border-default)] bg-card px-3 py-2 text-left hover:bg-inset"
    >
      <Folder className="h-4 w-4 shrink-0 text-accent" />
      <span className="min-w-0 flex-1">
        <span className="block truncate text-xs font-medium text-ink-100">{project?.title ?? 'Project'}</span>
        {project?.status && (
          <span className="flex items-center gap-1.5 text-[10px] text-ink-40">
            <span className="inline-block h-1.5 w-1.5 shrink-0 rounded-full" style={{ backgroundColor: projectStatusColor(project.status) }} />
            {projectStatusLabel(project.status)}
          </span>
        )}
      </span>
    </button>
  );
}

/* ─────────────────────────────────────────────────────────────────────────────
 * Reactions, quoted replies and copy.
 *
 * These three shipped in the consumer messenger (clients/chat) first and were
 * missing here, which meant the same person had two different vocabularies
 * depending on which Prodesk surface a conversation happened to live on — you
 * could 👍 a contractor in the messenger and not in the workspace thread about
 * the actual job. The server side was already shared (`chat.reactions`,
 * `chat.toggleReaction`, `chat_messages.reply_to_id`); only the UI was missing.
 * ────────────────────────────────────────────────────────────────────────── */

/**
 * The hover toolbar on a message: react, reply, copy.
 *
 * Absolutely positioned so nothing in the transcript moves when it appears — a
 * message that shifts under the cursor is how you click the wrong thing. It sits
 * just ABOVE the bubble on the side the bubble is aligned to, so it stays next
 * to the message it acts on (anchoring it to the opposite edge leaves it
 * stranded across the pane from a short message) and never covers the words.
 */
function MessageActions({
  mine,
  canReact,
  canReply,
  content,
  onReact,
  onOpenPicker,
  onReply,
}: {
  mine: boolean;
  canReact: boolean;
  canReply: boolean;
  content: string | null;
  onReact: (emoji: string) => void;
  onOpenPicker: (anchor: { x: number; y: number }) => void;
  onReply: () => void;
}) {
  return (
    <div
      className={cn(
        // -top-1, not -top-3, and the bubble column carries `pt-3` to match: the
        // toolbar has to stay INSIDE the element whose :hover reveals it. Hanging
        // it above that box means moving the pointer onto it ends the hover, the
        // toolbar vanishes under the cursor, and the click never lands.
        'absolute -top-1 z-10 hidden items-center gap-0.5 rounded-full border border-[color:var(--color-border-default)] bg-card px-1 py-0.5 shadow-[var(--shadow-md,0_4px_12px_rgba(0,0,0,0.12))] group-hover/msg:flex',
        mine ? 'right-0' : 'left-0',
      )}
    >
      {/* Most-used first: reacting is the commonest gesture in any modern
          messenger, so it gets the leftmost slots and a live row. */}
      {canReact &&
        QUICK.slice(0, 3).map((emoji) => (
          <button
            key={emoji}
            type="button"
            onClick={() => onReact(emoji)}
            aria-label={`React ${emoji}`}
            className="grid h-6 w-6 place-items-center rounded-full text-[14px] hover:bg-inset"
          >
            {emoji}
          </button>
        ))}
      {canReact && (
        <ActionIcon label="More reactions" onClick={(e) => onOpenPicker(anchorOf(e.currentTarget))}>
          <SmilePlus className="h-3.5 w-3.5" />
        </ActionIcon>
      )}
      {canReply && (
        <ActionIcon label="Reply" onClick={onReply}>
          <CornerUpLeft className="h-3.5 w-3.5" />
        </ActionIcon>
      )}
      {content && (
        <ActionIcon
          label="Copy"
          onClick={() => {
            void navigator.clipboard?.writeText(content).then(
              () => toast.success('Copied'),
              () => toast.error('Couldn’t copy that'),
            );
          }}
        >
          <Copy className="h-3.5 w-3.5" />
        </ActionIcon>
      )}
    </div>
  );
}

function ActionIcon({
  label,
  onClick,
  children,
}: {
  label: string;
  // Takes the event, so a caller that opens a popover can anchor it to this
  // button rather than centring it over the conversation.
  onClick: (e: React.MouseEvent<HTMLButtonElement>) => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      onClick={onClick}
      className="grid h-6 w-6 place-items-center rounded-full text-ink-40 hover:bg-inset hover:text-ink-100"
    >
      {children}
    </button>
  );
}

/** The chips under a message. Clicking one adds or removes your own reaction. */
function ReactionChips({
  reactions,
  mine,
  onReact,
}: {
  reactions: ReactionSummary[];
  mine: boolean;
  onReact: (emoji: string) => void;
}) {
  if (reactions.length === 0) return null;
  return (
    <div className={cn('mt-1 flex flex-wrap gap-1', mine ? 'justify-end' : 'justify-start')}>
      {reactions.map((r) => (
        <button
          key={r.emoji}
          type="button"
          onClick={() => onReact(r.emoji)}
          aria-label={`${r.emoji} ${r.count}`}
          aria-pressed={r.mine}
          className={cn(
            'flex items-center gap-1 rounded-full border px-1.5 py-0.5 text-[11px] font-semibold tabular-nums transition-colors',
            r.mine
              ? 'border-accent bg-accent/10 text-accent'
              : 'border-[color:var(--color-border-default)] bg-card text-ink-60 hover:bg-inset',
          )}
        >
          <span className="text-[12px]">{r.emoji}</span>
          {r.count}
        </button>
      ))}
    </div>
  );
}

/**
 * The quoted message above a reply. Clicking it jumps to the original — the
 * "where did this come from" question is the only reason to render a quote at
 * all, and a quote you cannot follow answers half of it.
 */
function QuotedReply({
  quoted,
  mine,
  onJump,
}: {
  quoted: { senderName: string | null; content: string | null; type: string } | null;
  mine: boolean;
  onJump: () => void;
}) {
  const line = quoted
    ? (quoted.content ?? (quoted.type === 'system' ? 'Notice' : 'Attachment'))
    : null;
  return (
    <button
      type="button"
      onClick={onJump}
      disabled={!quoted}
      className={cn(
        'mb-1 block w-full max-w-full rounded-[var(--radius-sm)] border-l-2 px-2 py-1 text-left disabled:cursor-default',
        mine ? 'border-paper/40 bg-paper/10' : 'border-accent/60 bg-card',
      )}
    >
      <span className={cn('block text-[10px] font-bold', mine ? 'text-paper/80' : 'text-ink-60')}>
        {quoted?.senderName ?? 'Message'}
      </span>
      <span className={cn('block truncate text-[11px]', mine ? 'text-paper/70' : 'text-ink-40')}>
        {/* The original may be older than the loaded window — say so rather than
            rendering an empty quote that looks like a bug. */}
        {line ?? 'Scroll up to load the original'}
      </span>
    </button>
  );
}

/** The full reaction grid, opened from a message's ＋ control. */
/**
 * The full reaction grid.
 *
 * IT DOES NOT BLACK OUT THE CONVERSATION. It used to be a centred modal behind a
 * `bg-black/40` scrim — the whole thread dimmed and covered so you could pick a
 * 👍. That is the weight of a destructive confirmation applied to the lightest
 * gesture in the product, and it hid the very message you were reacting to, so
 * the one thing you needed to see while choosing was the one thing taken away.
 *
 * It is a popover now: transparent backdrop (present only to catch the click
 * that dismisses it), floated next to the control that opened it, clamped into
 * the viewport after measuring so it never hangs off an edge. `aria-modal` is
 * gone with the scrim — nothing behind it is inert any more, and claiming
 * otherwise would mislead a screen reader.
 */
function ReactionPicker({
  anchor,
  onPick,
  onClose,
}: {
  /** Viewport point to float beside — the trigger's top-centre. */
  anchor: { x: number; y: number } | null;
  onPick: (emoji: string) => void;
  onClose: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);

  // Measure, then place. Estimating the grid's size and hoping is how a popover
  // ends up half off the bottom of a laptop screen for the person whose message
  // happens to be near the fold.
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el || !anchor) return;
    const { width, height } = el.getBoundingClientRect();
    setPos(placeBeside(anchor, { width, height }));
  }, [anchor]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-50"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
      role="dialog"
      aria-label="Pick a reaction"
    >
      <div
        ref={ref}
        className="absolute w-[300px] max-w-[calc(100vw-1rem)] rounded-[var(--radius-md)] border border-[color:var(--color-border-default)] bg-card p-3 shadow-[var(--shadow-lg,0_10px_30px_rgba(0,0,0,0.2))]"
        style={
          // Centred until measured (and when there is no anchor, e.g. opened
          // from the action sheet), then floated. `visibility` rather than a
          // conditional render, so the measure pass has something to measure.
          pos
            ? { left: pos.left, top: pos.top }
            : anchor
              ? { left: 0, top: 0, visibility: 'hidden' }
              : { left: '50%', top: '50%', transform: 'translate(-50%, -50%)' }
        }
      >
        <div className="grid grid-cols-8 gap-0.5">
          {GRID.map((emoji) => (
            <button
              key={emoji}
              type="button"
              onClick={() => onPick(emoji)}
              className="grid h-8 w-8 place-items-center rounded-[var(--radius-sm)] text-[17px] hover:bg-inset"
            >
              {emoji}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}


/**
 * The header's ⋯ menu. Today it holds exactly one thing — mute — which is enough
 * to justify it: an org thread you are a member of by virtue of a contract is
 * precisely the kind of thread you cannot leave and may badly need to silence.
 *
 * The duration list is `@shared/pages/chat/mute`, the same one the messenger
 * offers, so "For a week" means the same thing in both products.
 */
function ThreadMenu({
  isMuted,
  mutedUntil,
  onMute,
}: {
  isMuted: boolean;
  mutedUntil: Date | string | null;
  onMute: (until: Date | null) => void;
}) {
  const [open, setOpen] = useState(false);
  const [showDurations, setShowDurations] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  useEffect(() => {
    if (!open) setShowDurations(false);
  }, [open]);

  const pick = (until: Date | null) => {
    setOpen(false);
    onMute(until);
  };

  return (
    <div className="relative flex-shrink-0" ref={ref}>
      <button
        type="button"
        aria-label="Conversation options"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        className="rounded-[var(--radius-sm)] p-1 text-ink-40 hover:bg-inset hover:text-ink-100"
      >
        <MoreHorizontal className="h-4 w-4" />
      </button>
      {open && (
        // Absolutely positioned, not portalled — the shared popover convention,
        // which keeps it clear of the pointer-events trap a portalled menu inside
        // a modal host falls into.
        <div
          className="absolute right-0 top-8 z-30 w-56 overflow-hidden rounded-[var(--radius-md)] border border-[color:var(--color-border-default)] bg-card py-1 shadow-[var(--shadow-lg,0_10px_30px_rgba(0,0,0,0.2))]"
          role="menu"
        >
          {isMuted ? (
            <MenuRow onClick={() => pick(null)} label="Unmute" hint={muteLabel(mutedUntil)} />
          ) : showDurations ? (
            <>
              <button
                type="button"
                onClick={() => setShowDurations(false)}
                className="flex w-full items-center gap-1.5 px-3 py-2 text-left text-[11px] text-ink-40 hover:bg-inset"
              >
                <ChevronLeft className="h-3.5 w-3.5" /> Mute
              </button>
              <span className="my-1 block h-px bg-[color:var(--color-border-hairline)]" />
              {MUTE_OPTIONS.map((o) => (
                <MenuRow key={o.key} label={o.label} onClick={() => pick(o.until())} />
              ))}
            </>
          ) : (
            <MenuRow
              label="Mute"
              icon={<BellOff className="h-3.5 w-3.5" />}
              onClick={() => setShowDurations(true)}
            />
          )}
        </div>
      )}
    </div>
  );
}

function MenuRow({
  label,
  hint,
  icon,
  onClick,
}: {
  label: string;
  hint?: string;
  icon?: ReactNode;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      role="menuitem"
      onClick={onClick}
      className="flex w-full items-center gap-2 px-3.5 py-2 text-left text-xs text-ink-100 hover:bg-inset"
    >
      {icon}
      <span className="min-w-0 flex-1 truncate">{label}</span>
      {hint && <span className="shrink-0 text-[10px] text-ink-40">{hint}</span>}
    </button>
  );
}

function MessageBubble({
  m,
  mine,
  showHeader,
  showMeta,
  readByOthers,
  member,
  onOpenProject,
  quoted,
  reactions,
  canReact,
  canReply,
  onReact,
  onOpenPicker,
  onReply,
  onJumpToQuoted,
  onMediaLoad,
  onLongPress,
}: {
  m: MessageItem;
  mine: boolean;
  showHeader: boolean;
  /** Render the time/tick line — only on the newest bubble of a grouped run. */
  showMeta: boolean;
  readByOthers: boolean;
  member?: ThreadMember;
  onOpenProject: (id: string) => void;
  /** The message this one replies to, when it's inside the loaded window. */
  quoted: { senderName: string | null; content: string | null; type: string } | null;
  reactions: ReactionSummary[];
  canReact: boolean;
  canReply: boolean;
  onReact: (emoji: string) => void;
  /** Receives the trigger's viewport anchor so the grid floats beside it. */
  onOpenPicker: (anchor: { x: number; y: number }) => void;
  onReply: () => void;
  onJumpToQuoted: () => void;
  /**
   * An attachment or a link card in this row settled at its real size.
   *
   * The growth a virtualiser cannot see: Virtuoso reports total-height changes,
   * but by the time an image inside an already-measured row decodes, that report
   * has been and gone. Wired to the sticky transcript's `repin` — it is why
   * sending a photo now lands at the end instead of one bubble above it. Must be
   * identity-stable.
   */
  onMediaLoad: () => void;
  /** Press and hold / right-click — the touch route to the message actions. */
  onLongPress: () => void;
}) {
  const { openFile } = useFileViewer();
  const longPress = useLongPress(onLongPress);
  // Only the FIRST link gets a card.
  const firstUrl = !m.deletedAt && m.content && !m.isAi ? firstLink(m.content) : null;
  if (m.type === 'system') {
    return (
      <div className="my-2 flex justify-center">
        <span className="rounded-full bg-inset px-3 py-1 text-center text-[11px] text-ink-40">{m.content}</span>
      </div>
    );
  }

  const deleted = !!m.deletedAt;

  return (
    // `group/msg` (a NAMED group, not a bare one): the row above already uses an
    // unnamed group for the avatar, and an unnamed nested group would make the
    // toolbar appear whenever the pointer was anywhere in the row.
    <div className={cn('group/msg relative flex flex-col pt-3', mine ? 'items-end' : 'items-start')}>
      <div
        className={cn(
          'text-sm',
          // AI messages render as plain text — no avatar (stripped in the row),
          // no bubble background. Everyone else gets a content-hugging bubble
          // capped at 72% of the available width (full width under 200px).
          m.isAi
            ? 'w-full text-ink-100'
            : cn(
                'w-fit max-w-full @min-[300px]:max-w-[72%] rounded-[var(--radius-md)] px-3 py-2',
                mine ? 'bg-ink-100 text-paper' : 'bg-inset text-ink-100',
              ),
        )}
        // iOS answers a long press on text with its own selection callout,
        // which would race the action sheet. Suppressing it is the trade every
        // native messenger makes, and the sheet carries a Copy action.
        style={{ WebkitTouchCallout: 'none' }}
        {...(deleted || m.isAi ? {} : longPress.handlers)}
        onClickCapture={(e) => {
          // The click the browser sends when the finger lifts after a hold —
          // without this, holding a photo opens the sheet AND the file viewer.
          if (longPress.suppressClick()) {
            e.preventDefault();
            e.stopPropagation();
          }
        }}
      >
        {!mine && showHeader && <SenderHeader m={m} member={member} />}

        {m.replyToId && !deleted && (
          <QuotedReply quoted={quoted} mine={mine && !m.isAi} onJump={onJumpToQuoted} />
        )}

        {m.fileUrl && (
          <AttachmentBlock
            type={m.type}
            url={m.fileUrl}
            name={m.fileName}
            thumbnailUrl={m.thumbnailUrl}
            size={m.fileSize}
            mine={mine && !m.isAi}
            onOpen={() =>
              openFile({
                url: m.fileUrl!,
                title: m.fileName ?? (m.type === 'image' ? 'image' : 'Document'),
                fileType: m.type === 'image' ? 'image' : m.type === 'video' ? 'video' : undefined,
              })
            }
            onMediaLoad={onMediaLoad}
          />
        )}

        {deleted ? (
          <div className={cn('italic', mine ? 'text-paper/70' : 'text-ink-40')}>Message deleted</div>
        ) : (
          m.content &&
          (m.isAi ? (
            // The assistant's replies are markdown, which already renders its
            // own links — running the plain-text linkifier over them too would
            // double up.
            <Markdown>{m.content}</Markdown>
          ) : (
            <div className="whitespace-pre-wrap break-words">
              <MessageText text={m.content} mine={mine} />
            </div>
          ))
        )}
        {/* The unfurled card for the first link, under the words rather than in
            place of them — the sentence is still what was said, and the card is
            what it points at. Only the first: a message with five links wants to
            stay a message. */}
        {!m.fileUrl && !m.isAi && firstUrl && (
          <LinkCard url={firstUrl} mine={mine} onLoad={onMediaLoad} />
        )}
        {m.projectId && <ProjectCard project={m.project} projectId={m.projectId} onOpen={onOpenProject} />}
      </div>

      {!deleted && (canReact || canReply || m.content) && (
        <MessageActions
          mine={mine && !m.isAi}
          canReact={canReact}
          canReply={canReply}
          content={m.content}
          onReact={onReact}
          onOpenPicker={onOpenPicker}
          onReply={onReply}
        />
      )}

      <ReactionChips reactions={reactions} mine={mine && !m.isAi} onReact={onReact} />
      {showMeta && <MessageMeta ts={m.timestamp} mine={mine} readByOthers={readByOthers} />}
    </div>
  );
}

/**
 * An optimistic outgoing bubble. While `sending` it mirrors a normal "mine"
 * bubble but swaps the read-tick for a faded circular spinner. On `failed` it
 * turns into a red card (white text) whose error icon toggles inline
 * Retry/Delete actions — all handled locally, no refetch.
 */
function PendingBubble({
  p,
  actionsOpen,
  onToggleActions,
  onRetry,
  onDelete,
}: {
  p: PendingMessage;
  actionsOpen: boolean;
  onToggleActions: () => void;
  onRetry: () => void;
  onDelete: () => void;
}) {
  const failed = p.status === 'failed';
  return (
    <div className="flex flex-col items-end">
      <div className={cn('w-fit max-w-full @min-[300px]:max-w-[72%] rounded-[var(--radius-md)] px-3 py-2 text-sm', failed ? 'bg-danger text-white' : 'bg-ink-100 text-paper opacity-70')}>
        {p.type !== 'text' && p.fileName && (
          <div className={cn('mb-1 flex items-center gap-2 rounded-[var(--radius-sm)] px-2 py-1.5', failed ? 'bg-white/15' : 'bg-paper/10')}>
            <FileText className="h-4 w-4 shrink-0" />
            <span className="min-w-0 truncate text-xs font-medium">{p.fileName}</span>
          </div>
        )}
        {p.content && <div className="whitespace-pre-wrap break-words">{p.content}</div>}
        {p.projectId && (
          <div className={cn('mt-1 flex items-center gap-2 rounded-[var(--radius-sm)] px-2 py-1.5 text-xs', failed ? 'bg-white/15' : 'bg-paper/10')}>
            <Folder className="h-4 w-4 shrink-0" /> Project attached
          </div>
        )}

        {failed && actionsOpen && (
          <div className="mt-1.5 flex items-center gap-2 border-t border-white/25 pt-1.5">
            <span className="flex-1 truncate text-[11px] text-white/80">{p.error ?? 'Failed to send'}</span>
            <button onClick={onRetry} className="flex items-center gap-1 rounded-[var(--radius-sm)] bg-white/20 px-2 py-1 text-[11px] font-medium hover:bg-white/30">
              <RotateCcw className="h-3 w-3" /> Retry
            </button>
            <button onClick={onDelete} className="flex items-center gap-1 rounded-[var(--radius-sm)] bg-white/20 px-2 py-1 text-[11px] font-medium hover:bg-white/30">
              <Trash2 className="h-3 w-3" /> Delete
            </button>
          </div>
        )}
      </div>
      <span className="mt-0.5 flex items-center gap-1 text-[10px] text-ink-30">
        {new Date(p.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
        {failed ? (
          <button onClick={onToggleActions} aria-label="Send failed — show options" className="text-danger hover:text-danger/80">
            <AlertCircle className="h-3.5 w-3.5" />
          </button>
        ) : (
          <Loader2 className="h-3 w-3 animate-spin text-ink-30/60" />
        )}
      </span>
    </div>
  );
}

/** Animated "is typing…" dots footer (chat_message_list.dart:119-160). */
function TypingIndicator({ names }: { names: string[] }) {
  if (names.length === 0) return null;
  const label = names.length === 1 ? `${names[0]} is typing` : `${names.length} people are typing`;
  return (
    <div className="flex items-center gap-2 px-5 pb-2 text-xs text-ink-40">
      <span className="flex items-center gap-0.5">
        <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-ink-40 [animation-delay:-0.3s]" />
        <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-ink-40 [animation-delay:-0.15s]" />
        <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-ink-40" />
      </span>
      {label}
    </div>
  );
}

/**
 * Right-hand message panel: header (with members + optional mobile back),
 * message stream (time dividers, grouped sender headers w/ role+entity, system
 * notices, attachments, project cards, read receipts), a typing indicator, and
 * the composer (attach + multiline + Enter-to-send). Ports `ChatMessagePanel`
 * and all its sub-widgets.
 */
export function MessagePanel({
  threadId,
  threadName,
  isAiThread = false,
  meId,
  identity,
  attachedProjectId,
  onClearAttachedProject,
  onOpenProject,
  onRead,
  onBack,
  hideSubscribeGate = false,
  hideHeader = false,
  headerRight,
  surface,
  registerAiSend,
}: {
  threadId: string;
  threadName: string;
  /** True for the brand's AI assistant thread — switches the composer to the
   *  streamed `/api/ai/chat` flow, renders Markdown, and gates attachments. */
  isAiThread?: boolean;
  /** Host surface the panel is embedded in (e.g. 'strategy'). Forwarded to the AI
   *  stream so the server can gate surface-specific extras like continuations. */
  surface?: string;
  meId?: string;
  identity: ChatIdentity | null;
  attachedProjectId?: string | null;
  onClearAttachedProject?: () => void;
  onOpenProject: (id: string) => void;
  onRead: () => void;
  /** When provided, renders a back arrow in the header (mobile single-pane). */
  onBack?: () => void;
  /** Suppress the in-thread "Generate my strategy" upsell card when the host
   *  surrounds the panel with its own subscribe UI (the composer still locks). */
  hideSubscribeGate?: boolean;
  /** Hide the panel's own header (thread name + member count) when the host
   *  already supplies one — e.g. the suite chat dock's titled rail header. */
  hideHeader?: boolean;
  /** Optional content rendered at the right end of the panel's own header row
   *  (aligned with the thread name) — e.g. the Growth strategy plan pill. */
  headerRight?: ReactNode;
  /** AI threads only: receive an imperative "send this prompt" function so a host
   *  (e.g. the Strategy starter-chip / continuation bar) can dispatch a prompt
   *  through the SAME streamed flow as the composer. Called with the fn on mount
   *  and null on unmount. */
  registerAiSend?: (send: ((text: string) => void) | null) => void;
}) {
  const trpc = useTRPC();
  const qc = useQueryClient();
  const { data: me } = useCurrentUser();
  const isMobile = useIsMobile();
  const [, navigate] = useLocation();
  // Feature Subscription gate for the brand AI assistant. When the brand owner
  // isn't subscribed to Growth Strategy, the composer is locked and an upsell
  // card is shown in the thread.
  const aiAccess = useQuery({
    ...trpc.featureSubscriptions.aiAccess.queryOptions({ threadId }),
    enabled: isAiThread,
  });
  const aiLocked = isAiThread && !!aiAccess.data && !aiAccess.data.entitled;
  const [text, setText] = useState('');
  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState<UploadProgress | null>(null);
  const [membersOpen, setMembersOpen] = useState(false);
  const [typingNames, setTypingNames] = useState<string[]>([]);
  /** The message the composer is currently answering. */
  const [replyTo, setReplyTo] = useState<MessageItem | null>(null);
  /**
   * Which message the full reaction grid was opened for, and WHERE to float it.
   * The point comes from the control that opened it, so the grid appears beside
   * the message instead of covering the conversation — see ReactionPicker.
   */
  const [pickerFor, setPickerFor] = useState<{ id: string; anchor: { x: number; y: number } | null } | null>(null);
  /**
   * The message whose action sheet is open — the touch route to react / reply /
   * copy / save, which are otherwise hover-only. Held here rather than per row
   * so there is one sheet in the tree: a virtualised list recycles rows, and a
   * sheet owned by a row would be torn out from under the finger.
   */
  const [actionsFor, setActionsFor] = useState<MessageItem | null>(null);
  /** Briefly outlined after a jump — the "found it" confirmation. */
  const [flashId, setFlashId] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const lastTypingSentRef = useRef(0);
  const virtuosoRef = useRef<VirtuosoHandle>(null);
  // The Virtuoso scroller element, captured via its scrollerRef prop. It is what
  // the sticky-bottom hook listens to and what a pin writes to.
  const scrollerElRef = useRef<HTMLElement | null>(null);
  // Set when the local user sends a message: forces a scroll to the newest row
  // on the next render, regardless of the current scroll position — sending
  // always jumps you to the bottom, like every chat app.
  const wantBottomRef = useRef(false);

  /**
   * Scroll to the TRUE end: past the last item, past the footer (the typing
   * indicator, the streaming AI preview and the bottom padding all live there,
   * so `scrollToIndex('LAST')` on its own stops short of it).
   */
  const scrollToBottom = useCallback((behavior: 'smooth' | 'auto' = 'auto') => {
    const v = virtuosoRef.current;
    if (!v) return;
    const el = scrollerElRef.current;
    // Instant pins jump the scroller first, synchronously, so no intermediate
    // position is ever painted. A smooth pin is the reader watching an
    // animation, and clobbering scrollTop would cancel it.
    if (el && behavior === 'auto') el.scrollTop = el.scrollHeight;
    v.scrollToIndex({ index: 'LAST', align: 'end', behavior });
    requestAnimationFrame(() => v.scrollTo({ top: 1e9, behavior }));
  }, []);

  /**
   * BEING AT THE BOTTOM IS INTENT, NOT A MEASUREMENT — see stick-to-bottom.ts,
   * which this panel and the standalone Chat app now share.
   *
   * What used to be here: a 120px at-bottom flag from Virtuoso for the jump
   * button, a stricter 16px re-check for re-anchoring, and a 1200ms "settle
   * window" so that content rendering after a programmatic scroll kept pulling
   * the view back down. All three were attempts to answer "did the reader scroll
   * away, or did the content grow underneath them?" from arithmetic taken after
   * the fact — which cannot be answered that way. Anything that grew taller than
   * the threshold (an action card resolving, a read receipt, markdown reflowing,
   * the composer gaining a reply banner) silently un-pinned a transcript nobody
   * had scrolled, stranding the reader mid-message with a jump-to-latest button
   * offering to take them where they already were.
   */
  const pinNow = useCallback(() => {
    // The scroller alone: when the view is stuck the last row is already
    // rendered, so re-asking the virtualiser to scroll to it just re-indexes the
    // list — which is what made streaming replies jitter.
    const el = scrollerElRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  }, []);
  const stick = useStickToBottom({ scroller: scrollerElRef, resetKey: threadId, pin: pinNow });
  // Tracks whether we've fired the one-shot initial scroll-to-bottom for the
  // current thread. Reset on thread switch so each new thread opens at the end.
  const didInitialScrollRef = useRef(false);
  // Set when a message lands while the user is scrolled up reading history, so
  // the jump button can flag there's something new below. Cleared on return.
  const [hasNewBelow, setHasNewBelow] = useState(false);
  // Virtuoso anchors the list by a virtual index; prepending older pages shifts
  // this down by the number of rows added so the viewport doesn't jump.
  const [firstItemIndex, setFirstItemIndex] = useState(VIRTUOSO_START_INDEX);
  const typingTimersRef = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());

  // Keyset-paginated history: each page is newest-first; older pages are fetched
  // on scroll-to-top. No growing-window refetch, no count() — O(page) per load.
  const infiniteOpts = trpc.chat.messages.infiniteQueryOptions(
    { threadId, limit: PAGE_SIZE },
    { getNextPageParam: (last) => last.nextCursor ?? undefined },
  );
  const msgKey = infiniteOpts.queryKey;
  const q = useInfiniteQuery(infiniteOpts);
  // pages[0] = newest 30, pages[1] = next-older 30… each page is newest-first.
  // Concatenate then reverse once for chronological (oldest-first) display.
  const messages = useMemo(() => {
    const pages = (q.data?.pages ?? []) as MessagesPage[];
    return pages.flatMap((p) => p.items).reverse();
  }, [q.data]);
  const hasMore = q.hasNextPage;

  const membersQ = useQuery(trpc.chat.members.queryOptions({ threadId }));
  const members = (membersQ.data ?? []) as ThreadMember[];
  const memberById = useMemo(() => {
    const map = new Map<string, ThreadMember>();
    for (const m of members) map.set(m.userId, m);
    return map;
  }, [members]);

  const readStateQ = useQuery(trpc.chat.readState.queryOptions({ threadId }));
  // The double-tick means "read by EVERYONE else", so use the OLDEST (min)
  // last-read pointer across all other members — a member who never read counts
  // as 0, holding the tick single until the whole group has caught up. (min, not
  // max: max would flip to double as soon as a single member read it.)
  const otherReadTimes = (readStateQ.data ?? []).map((r) => (r.lastReadAt ? new Date(r.lastReadAt).getTime() : 0));
  const allOthersLastReadAt = otherReadTimes.length ? Math.min(...otherReadTimes) : 0;

  // Reactions for the whole thread in one query, summarised per message. Small
  // enough that a single fetch beats per-message state, and the thread channel's
  // `onReaction` ping refetches it whenever anyone anywhere toggles one.
  const reactionsKey = trpc.chat.reactions.queryKey({ threadId });
  const reactionsQ = useQuery(trpc.chat.reactions.queryOptions({ threadId }));
  const reactionsByMessage = useMemo(
    () => summarise(reactionsQ.data ?? [], meId),
    [reactionsQ.data, meId],
  );

  // Mute state. Skipped on the AI thread — silencing an assistant that only ever
  // speaks when spoken to is an option with nothing behind it.
  const threadMetaKey = trpc.chat.threadMeta.queryKey({ threadId });
  const threadMetaQ = useQuery({
    ...trpc.chat.threadMeta.queryOptions({ threadId }),
    enabled: !isAiThread,
  });

  const send = useMutation(trpc.chat.send.mutationOptions());
  const markRead = useMutation(trpc.chat.markRead.mutationOptions());

  // Options passed INTO mutationOptions({…}), not spread around it: the tRPC
  // proxy types its own onSuccess against an `undefined` onMutate result, so
  // spreading and then adding onMutate fails to typecheck on every one of these.
  const toggleReaction = useMutation(
    trpc.chat.toggleReaction.mutationOptions({
      // Optimistic, because a reaction is the one gesture people fire in bursts —
      // a chip that appears 300ms later gets clicked twice and cancels itself.
      onMutate: async ({ messageId, emoji }) => {
        const previous = qc.getQueryData(reactionsKey);
        qc.setQueryData(reactionsKey, (old) => {
          const rows = old ?? [];
          if (!meId) return rows;
          const has = rows.some((r) => r.messageId === messageId && r.emoji === emoji && r.userId === meId);
          return has
            ? rows.filter((r) => !(r.messageId === messageId && r.emoji === emoji && r.userId === meId))
            : [...rows, { messageId, emoji, userId: meId }];
        });
        return { previous };
      },
      onError: (e, _vars, ctx) => {
        qc.setQueryData(reactionsKey, ctx?.previous);
        toastError(e);
      },
      onSettled: () => void qc.invalidateQueries({ queryKey: reactionsKey }),
    }),
  );

  const setMuted = useMutation(
    trpc.chat.setMuted.mutationOptions({
      onMutate: async ({ until }) => {
        const previous = qc.getQueryData(threadMetaKey);
        qc.setQueryData(threadMetaKey, (old) =>
          old ? { ...old, isMuted: !!until, mutedUntil: until ?? null } : old,
        );
        return { previous };
      },
      onError: (e, _vars, ctx) => {
        qc.setQueryData(threadMetaKey, ctx?.previous);
        toastError(e);
      },
      onSuccess: (_res, { until }) => toast.success(until ? 'Muted' : 'Unmuted'),
      onSettled: () => void qc.invalidateQueries({ queryKey: threadMetaKey }),
    }),
  );
  const rateAi = useMutation(trpc.chat.rateAiMessage.mutationOptions());
  // Persist that a confirm card's action(s) were acted on (confirmed/dismissed) so
  // the card doesn't reappear from history after a reload.
  const resolveAiActionsMut = useMutation(trpc.chat.resolveAiActions.mutationOptions());
  // Subscribe gate → Stripe Checkout. "Generate my strategy" starts checkout for
  // the brand and redirects straight to the hosted Stripe page (no interstitial).
  const startCheckout = useMutation({
    ...trpc.featureSubscriptions.checkout.mutationOptions(),
    onSuccess: (res) => {
      if (res.url) {
        window.location.href = res.url;
        return;
      }
      // No Stripe configured (dev) or already entitled — entitlement is live now.
      void aiAccess.refetch();
      toast.success(res.status === 'already_active' ? 'You already have this subscription' : 'Subscribed!');
    },
    onError: (e) => toastError(e),
  });

  // Optimistic outgoing messages (sending/failed), persisted per-thread.
  const { pending, add, update, remove } = usePendingMessages(threadId);
  const [openActionsId, setOpenActionsId] = useState<string | null>(null);

  // ── AI assistant thread state ──────────────────────────────────────────────
  // Held in a per-thread store (not local state) so the live streaming reply
  // survives switching between the docked rail and the full Growth strategy screen
  // — both mount this panel for the same thread. Confirm-action cards are NOT held
  // here: each renders inline under its own AI message, from that message's
  // pendingActions + actionOutcomes in the (remount-surviving, persisted) query
  // cache. See ai-chat-store.ts.
  const aiState = useAiThread(threadId);
  const streaming = aiState.streaming;
  const streamingText = aiState.streamingText;

  // Splice a single message into the newest page of the infinite cache, deduped
  // by id. Used for both our own sends and incoming realtime rows — neither
  // triggers a refetch of the (potentially large) loaded window.
  const appendMessage = useCallback(
    (m: MessageItem) => {
      qc.setQueryData(msgKey, (old) => {
        if (!old?.pages?.length) return old;
        if (old.pages.some((pg) => pg.items.some((it) => it.id === m.id))) return old;
        const pages = old.pages.slice();
        pages[0] = { ...pages[0], items: [m, ...pages[0].items] }; // pages are newest-first
        return { ...old, pages };
      });
    },
    [qc, msgKey],
  );

  /**
   * Splice MANY messages into the newest page in ONE cache write.
   *
   * Socket frames arrive in separate tasks, so React cannot batch across them:
   * without this, a burst of thirty messages is thirty commits of a virtualised
   * transcript that re-groups and re-measures on every one, while the view is
   * also trying to follow the conversation down.
   *
   * Returns only the rows that were genuinely NEW, so the per-message reactions
   * the caller runs afterwards (the AI spinner, the "new below" flag) never fire
   * for the echo of something already loaded — including the echo of our own
   * send, which shares its client-generated id with the optimistic row.
   */
  const appendMessages = useCallback(
    (list: MessageItem[]): MessageItem[] => {
      if (list.length === 0) return [];
      const added: MessageItem[] = [];
      qc.setQueryData(msgKey, (old) => {
        if (!old?.pages?.length) return old;
        const seen = new Set<string>();
        for (const pg of old.pages) for (const it of pg.items) seen.add(it.id);
        const fresh: MessageItem[] = [];
        for (const m of list) {
          if (seen.has(m.id)) continue;
          seen.add(m.id);
          fresh.push(m);
        }
        if (fresh.length === 0) return old;
        added.push(...fresh); // arrival order, for the caller
        const pages = old.pages.slice();
        // Pages are newest-first, so the batch goes in reversed: its newest
        // message has to end up at the head, not its oldest.
        pages[0] = { ...pages[0], items: [...fresh.reverse(), ...pages[0].items] };
        return { ...old, pages };
      });
      return added;
    },
    [qc, msgKey],
  );

  // Patch a single already-loaded message in place (by id) without a refetch.
  const patchMessage = useCallback(
    (id: string, patch: Partial<MessageItem>) => {
      qc.setQueryData(msgKey, (old) => {
        if (!old?.pages?.length) return old;
        return {
          ...old,
          pages: old.pages.map((pg) => ({
            ...pg,
            items: pg.items.map((it) => (it.id === id ? { ...it, ...patch } : it)),
          })),
        };
      });
    },
    [qc, msgKey],
  );

  // Merge a realtime UPDATE echo into an already-loaded message. Cards, outcomes
  // and edits are written after the row's INSERT, so this is how they reach every
  // client that didn't drive the turn (a teammate, another tab, or a headless
  // follow-up). Outcomes/resolved-ids are unioned rather than replaced so a local
  // optimistic settle isn't briefly clobbered by an echo that predates it; cards
  // and edits are coalesced so an unrelated UPDATE (e.g. a rating) that arrives
  // with these still null can never wipe them.
  const mergeMessageUpdate = useCallback(
    (row: Record<string, unknown>) => {
      const incoming = mapRealtimeRow(row);
      qc.setQueryData(msgKey, (old) => {
        if (!old?.pages?.length) return old;
        if (!old.pages.some((pg) => pg.items.some((it) => it.id === incoming.id))) return old;
        return {
          ...old,
          pages: old.pages.map((pg) => ({
            ...pg,
            items: pg.items.map((it) =>
              it.id === incoming.id
                ? {
                    ...it,
                    // Coalesce like the card/edit fields below: a realtime UPDATE that
                    // only touched other columns (e.g. attaching a confirm card) omits the
                    // unchanged, TOASTed `content` from its payload, so it arrives null. An
                    // unguarded overwrite would blank an already-rendered AI bubble while its
                    // card stays visible — the text only returns on refetch. A genuine content
                    // edit always ships a non-null value, so it still applies.
                    content: incoming.content ?? it.content,
                    aiRating: incoming.aiRating,
                    aiRatedBy: incoming.aiRatedBy,
                    aiFeedbackResolvedAt: incoming.aiFeedbackResolvedAt,
                    pendingActions: incoming.pendingActions ?? it.pendingActions,
                    actionEdits: incoming.actionEdits ?? it.actionEdits,
                    actionRegenerations: incoming.actionRegenerations ?? it.actionRegenerations,
                    actionOutcomes: { ...(it.actionOutcomes ?? {}), ...(incoming.actionOutcomes ?? {}) },
                    resolvedActionIds: [
                      ...new Set([...(it.resolvedActionIds ?? []), ...(incoming.resolvedActionIds ?? [])]),
                    ],
                    awaitSettlementFollowup: incoming.awaitSettlementFollowup,
                    settlementFollowupFiredAt: incoming.settlementFollowupFiredAt,
                  }
                : it,
            ),
          })),
        };
      });
    },
    [qc, msgKey],
  );

  // Drop a deleted message from the loaded window.
  const removeMessage = useCallback(
    (id: string) => {
      qc.setQueryData(msgKey, (old) => {
        if (!old?.pages?.length) return old;
        return {
          ...old,
          pages: old.pages.map((pg) => ({ ...pg, items: pg.items.filter((it) => it.id !== id) })),
        };
      });
    },
    [qc, msgKey],
  );

  // Record a confirm card's outcome (confirmed/rejected) on its AI message:
  // optimistically merge it into the message's actionOutcomes in the shared query
  // cache (so the card flips state instantly and stays that way across a
  // dock↔full-screen remount), then persist server-side so it also survives a
  // reload and is shared across the brand team.
  const resolveAction = useCallback(
    (
      messageId: string,
      toolUseId: string,
      outcome: 'confirmed' | 'rejected',
      // Final field values the user confirmed with (post-edit) — persisted so a
      // later AI turn sees what was actually applied vs. what it proposed.
      edits?: Record<string, unknown>,
    ) => {
      qc.setQueryData(msgKey, (old) => {
        if (!old?.pages?.length) return old;
        return {
          ...old,
          pages: old.pages.map((pg) => ({
            ...pg,
            items: pg.items.map((it) =>
              it.id === messageId
                ? {
                    ...it,
                    actionOutcomes: { ...(it.actionOutcomes ?? {}), [toolUseId]: outcome },
                    resolvedActionIds: [...new Set([...(it.resolvedActionIds ?? []), toolUseId])],
                  }
                : it,
            ),
          })),
        };
      });
      // Settling the last card (or answering a form) can trigger a headless
      // follow-up AI turn server-side. That turn isn't streamed to us, so without
      // this the UI would sit idle and the user would assume it's their turn.
      // When the server says a follow-up fired, show the thinking spinner; the
      // server's `ai_done` broadcast clears it when the turn ends (per-round
      // INSERTs must NOT clear it — a multi-round turn keeps running tools
      // between bubbles). A failsafe timeout clears the spinner if the broadcast
      // never arrives (e.g. the channel dropped) so it never spins forever.
      resolveAiActionsMut
        .mutateAsync({
          messageId,
          toolUseIds: [toolUseId],
          outcome,
          ...(edits ? { edits: { [toolUseId]: edits } } : {}),
          // Settling the last card can end the AI's follow-up chain server-side;
          // on the strategy surface that's when the starter-chip continuations
          // regenerate, so the server needs to know where the click came from.
          ...(surface ? { surface } : {}),
        })
        .then((res) => {
          if (!res?.followupFired) return;
          patchAiThread(threadId, { streaming: true, streamingText: '' });
          wantBottomRef.current = true;
          window.setTimeout(() => {
            // Don't disturb a user-initiated stream (those set an abort handle).
            if (!getAiAbort(threadId)) patchAiThread(threadId, { streaming: false });
          }, 120_000);
        })
        .catch(() => {
          /* the optimistic outcome already rendered; mutation errors surface elsewhere */
        });
    },
    [qc, msgKey, resolveAiActionsMut, threadId, surface],
  );

  // Patch a card's "Regenerate" history into the shared query cache so the gen
  // chips update instantly and survive a dock↔full-screen remount. The server
  // already persisted the list (so it also survives a reload); this just mirrors
  // the returned list into the cached message row.
  const persistRegenerations = useCallback(
    (messageId: string, toolUseId: string, generations: Record<string, unknown>[]) => {
      qc.setQueryData(msgKey, (old) => {
        if (!old?.pages?.length) return old;
        return {
          ...old,
          pages: old.pages.map((pg) => ({
            ...pg,
            items: pg.items.map((it) =>
              it.id === messageId
                ? { ...it, actionRegenerations: { ...(it.actionRegenerations ?? {}), [toolUseId]: generations } }
                : it,
            ),
          })),
        };
      });
    },
    [qc, msgKey],
  );

  // Thumbs feedback on an AI reply — server-backed (shared across the brand team,
  // survives reloads). Toggling the active value clears it. Optimistic + rollback.
  const setFeedback = useCallback(
    (messageId: string, current: 1 | -1 | null, value: 1 | -1) => {
      const next = current === value ? null : value;
      patchMessage(messageId, { aiRating: next });
      rateAi.mutate(
        { messageId, rating: next },
        { onError: () => patchMessage(messageId, { aiRating: current }) },
      );
    },
    [patchMessage, rateAi],
  );

  // Fire (or re-fire) a pending message's send request and reconcile its state.
  const dispatchSend = useCallback(
    async (p: PendingMessage) => {
      update(p.id, { status: 'sending', error: undefined });
      try {
        const saved = await send.mutateAsync({
          id: p.id, // share the optimistic id so the confirmed row replaces it cleanly
          threadId: p.threadId,
          content: p.content ?? undefined,
          type: p.type,
          fileUrl: p.fileUrl ?? undefined,
          fileName: p.fileName ?? undefined,
          fileSize: p.fileSize ?? undefined,
          thumbnailUrl: p.thumbnailUrl ?? undefined,
          projectId: p.projectId ?? undefined,
          replyToId: p.replyToId ?? undefined,
          senderRole: p.senderRole,
          senderBusinessName: p.senderBusinessName,
        });
        // Swap the optimistic bubble for the confirmed row (no refetch); the
        // realtime echo is deduped by appendMessage.
        appendMessage({ ...(saved as unknown as MessageItem), timestamp: new Date(saved.timestamp).toISOString(), project: null });
        remove(p.id);
        qc.invalidateQueries({ queryKey: trpc.chat.readState.queryKey({ threadId }) });
        onRead();
      } catch (err) {
        update(p.id, { status: 'failed', error: err instanceof Error ? err.message : 'Failed to send' });
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [send, update, remove, appendMessage, qc, onRead, threadId],
  );

  const retryPending = useCallback(
    (p: PendingMessage) => {
      setOpenActionsId(null);
      void dispatchSend(p);
    },
    [dispatchSend],
  );
  const deletePending = useCallback(
    (id: string) => {
      setOpenActionsId((cur) => (cur === id ? null : cur));
      remove(id);
    },
    [remove],
  );

  /**
   * Mark the thread read — IMMEDIATELY on open, DEBOUNCED afterwards.
   *
   * This used to fire once per arriving message, and each one is a mutation
   * whose success invalidates the read pointers AND broadcasts `read` to every
   * other member — who each then refetch. In a ten-person thread that is
   * quadratic: one burst of thirty messages meant three hundred mark-read
   * mutations and three thousand read-pointer refetches across the room, on top
   * of the writes that caused them. It is the single heaviest thing this panel
   * did under load, and it did it hardest exactly when the server was busiest.
   *
   * Opening a conversation still marks it read on the spot (a fast open→close
   * must not leave it unread), and a `maxWait` ceiling means a thread that is
   * continuously busy still reports itself read on a schedule rather than only
   * once everyone stops talking.
   */
  const newestId = messages[messages.length - 1]?.id;
  const markReadTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const markReadSince = useRef(0);
  const markReadThread = useRef<string | null>(null);
  useEffect(() => {
    const fire = () => {
      markReadTimer.current = null;
      markReadSince.current = 0;
      markRead.mutate(
        { threadId },
        {
          onSuccess: () => {
            onRead();
            // Tell peers I've read so their sent messages double-tick live. Broadcast
            // (not a DB-change subscription) because RLS hides my membership row from
            // their realtime stream. self:false keeps me from echoing to myself.
            sendThreadBroadcast(threadId, 'read', { userId: meId });
          },
        },
      );
    };

    // A different conversation is a deliberate act, not a burst — answer it now.
    if (markReadThread.current !== threadId) {
      markReadThread.current = threadId;
      if (markReadTimer.current) clearTimeout(markReadTimer.current);
      markReadTimer.current = null;
      markReadSince.current = 0;
      fire();
      return;
    }

    const now = Date.now();
    if (!markReadSince.current) markReadSince.current = now;
    const delay = Math.max(
      0,
      Math.min(MARK_READ_DEBOUNCE_MS, markReadSince.current + MARK_READ_MAX_WAIT_MS - now),
    );
    if (markReadTimer.current) clearTimeout(markReadTimer.current);
    markReadTimer.current = setTimeout(fire, delay);
    return () => {
      if (markReadTimer.current) clearTimeout(markReadTimer.current);
      markReadTimer.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [threadId, newestId]);

  // Live updates + typing broadcast over a single per-thread channel, shared and
  // ref-counted (chat-channel.ts) so the dock↔full-screen switch reuses one
  // channel instead of racing a teardown against a same-topic re-subscribe — which
  // throws and blanks the view. New rows arrive via postgres_changes; ephemeral
  // typing pings via broadcast (~4s client-side TTL, mirrors chatTyping's 5s).
  useEffect(() => {
    const timers = typingTimersRef.current;

    /**
     * Every refetch this channel triggers, deduped by query key and held while
     * the tab is hidden.
     *
     * `invalidateQueries` on an ACTIVE query refetches immediately, and a hidden
     * tab still holds its queries mounted — so the un-coalesced version fired a
     * read-pointer refetch per arriving message, per reaction, per peer read, in
     * every open tab whether or not anyone was looking. See @shared/lib/coalesce.
     */
    const refetches = createInvalidator((filter) => void qc.invalidateQueries(filter), {
      wait: REFETCH_COALESCE_MS,
      maxWait: REFETCH_COALESCE_MAX_MS,
      deferWhileHidden: true,
    });
    const readStateFilter = { queryKey: trpc.chat.readState.queryKey({ threadId }) };

    /**
     * Arriving rows, applied to the cache in ONE write per batch. Not deferred
     * while hidden — the transcript must be correct the moment the user looks
     * back at it — just batched, so a burst costs a handful of commits instead
     * of one per message.
     */
    const inserts = createCoalescer<Record<string, unknown>>(
      (rows) => {
        // Only the genuinely new ones come back: the echo of our own send is
        // deduped against the optimistic row it shares an id with.
        const added = appendMessages(rows.map((r) => mapRealtimeRow(r)));
        if (added.length === 0) return;
        // An AI row landed. If WE are mid-stream (abort handle set), this is just
        // the echo of a round we already committed via onMessage — let onDone own
        // the streaming lifecycle so the preview survives between rounds. Otherwise
        // (headless follow-up turn, or a reply driven from another tab/device) drop
        // the live preview but KEEP the thinking spinner: a headless turn commits
        // one bubble per round and may still be running tools between rounds. The
        // server's `ai_done` broadcast (below) ends the spinner, with the
        // failsafe timeout as backstop.
        if (added.some((m) => m.isAi) && !getAiAbort(threadId)) {
          patchAiThread(threadId, { streamingText: '' });
        }
        // If the viewer is at the bottom, follow the new message down; if they've
        // scrolled up to read history, leave them be (the scroll effect ignores
        // the flag when it's false) and flag the jump button that there's a new
        // message below.
        if (stick.isStuck()) wantBottomRef.current = true;
        else setHasNewBelow(true);
        refetches.push(readStateFilter);
      },
      { wait: WRITE_COALESCE_MS, maxWait: WRITE_COALESCE_MAX_MS },
    );

    const unsubscribe = joinThreadChannel(threadId, {
      onInsert: (row) => inserts.push(row),
      // A message row changed after its INSERT — pending-action cards written at
      // the end of a turn, a card settled/edited by a teammate, a thumbs rating,
      // or the follow-up flag. The INSERT echo can't carry these later writes, so
      // merge them into the cached row (this is what makes cards appear live for
      // clients that didn't drive the turn — headless follow-ups, other tabs).
      onUpdate: (row) => mergeMessageUpdate(row),
      // A message was deleted elsewhere — drop it from the loaded window.
      onDelete: (row) => {
        const id = row.id ? String(row.id) : null;
        if (id) removeMessage(id);
      },
      // A peer marked the thread read (broadcast, since RLS hides other members'
      // chat_thread_members rows from realtime). Refetch read pointers so my sent
      // messages flip to the double-tick live, without waiting for my next reply.
      onPeerRead: (userId) => {
        if (userId === meId) return;
        refetches.push(readStateFilter);
      },
      // Somebody reacted (or un-reacted) anywhere in this thread. Data-less by
      // design — the whole thread's reaction set is one small query, and one
      // handler then covers add, remove, and a peer's toggle alike.
      onReaction: () => {
        refetches.push({ queryKey: trpc.chat.reactions.queryKey({ threadId }) });
      },
      // A headless AI turn (settlement follow-up) finished server-side — its
      // bubbles all arrived as INSERTs above, so drop the thinking spinner. No-op
      // for user-initiated streams (abort handle set): onDone owns those.
      onAiDone: () => {
        // The follow-up's confirm cards arrive on their own via the UPDATE echo
        // above (onUpdate → mergeMessageUpdate); this just drops the spinner.
        if (!getAiAbort(threadId)) patchAiThread(threadId, { streaming: false, streamingText: '' });
      },
      // The shared channel re-joined after a drop (sleep/offline/token expiry).
      // Realtime has no replay, so refetch the loaded window + read pointers to
      // pick up whatever landed while the channel was down.
      onResync: () => {
        refetches.push({ queryKey: msgKey });
        refetches.push(readStateFilter);
      },
      onTyping: (userId, name) => {
        if (userId === meId) return;
        const display = name || 'Someone';
        setTypingNames((prev) => (prev.includes(display) ? prev : [...prev, display]));
        const existing = timers.get(userId);
        if (existing) clearTimeout(existing);
        timers.set(
          userId,
          setTimeout(() => {
            timers.delete(userId);
            setTypingNames((prev) => prev.filter((n) => n !== display));
          }, TYPING_EXPIRY_MS),
        );
      },
    });
    return () => {
      for (const t of timers.values()) clearTimeout(t);
      timers.clear();
      setTypingNames([]);
      // Land whatever arrived in the last few milliseconds before letting go —
      // dropping it would leave a hole only a refetch could fill. The refetch
      // queue is simply cancelled: whatever mounts next fetches on mount.
      inserts.flush();
      inserts.cancel();
      refetches.cancel();
      unsubscribe();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [threadId, meId]);

  /**
   * When an older page is prepended, the list grows at the FRONT. Shift
   * Virtuoso's virtual base index down by however many rows were added so the
   * viewport stays put. Two things about how, both of which this got wrong:
   *
   *  - IN THE SAME COMMIT AS THE DATA. `firstItemIndex` only means "these went
   *    on the front" if the new index and the new `data` arrive together. From
   *    an effect they arrived in two commits: Virtuoso first saw thirty extra
   *    rows with the index unchanged — which says they were APPENDED, so every
   *    virtual index now points thirty rows earlier — rendered that, and only
   *    then got the correction. The reader was looking at a message and it was
   *    replaced by one from further back. Hence during render, like the reset.
   *  - MEASURED IN ROWS, by finding the row we were anchored on. Rows are not
   *    messages: pending rows count too, and differencing `messages.length`
   *    under-shifts by however many of those exist. The anchor's new index is,
   *    by definition, exactly how many rows are now above it — and that stays
   *    right when a live message lands at the far end in the same commit.
   */
  // Declared here, applied where `rows` is built (search: PREPEND COMPENSATION).
  const seenRowsRef = useRef<unknown[] | null>(null);
  const frontAnchorRef = useRef<{ key: string; index: number } | null>(null);

  // Reset the virtual base index when switching threads (the new thread opens
  // pinned to the bottom, so the at-bottom flag starts true and any stale
  // scroll-request is cleared).
  //
  // Also re-sync on (re)open: messages may have arrived while the thread was
  // closed, leaving the persisted infinite-query cache stale (realtime only
  // appends while the panel is mounted). Collapse any paged-in history back to
  // the newest page and force a refetch of it — WhatsApp-style: newest messages
  // load first, scroll up for older. q.refetch() ignores staleTime, and the
  // cached page stays visible (no skeleton) while the refetch runs in the
  // background. Trimming to one page keeps it to the newest ~30 and means the
  // refetch hits only page 0, not every previously-loaded page.
  useEffect(() => {
    setFirstItemIndex(VIRTUOSO_START_INDEX);
    seenRowsRef.current = null;
    frontAnchorRef.current = null;
    wantBottomRef.current = false;
    didInitialScrollRef.current = false;
    stick.setStuck(true);
    setHasNewBelow(false);
    qc.setQueryData(msgKey, (old) => {
      if (!old?.pages?.length) return old;
      return { ...old, pages: old.pages.slice(0, 1), pageParams: old.pageParams.slice(0, 1) };
    });
    void q.refetch();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [threadId]);

  const loadOlder = useCallback(() => {
    if (hasMore && !q.isFetchingNextPage) void q.fetchNextPage();
  }, [hasMore, q.isFetchingNextPage, q.fetchNextPage]);

  const broadcastTyping = useCallback(() => {
    const now = Date.now();
    if (now - lastTypingSentRef.current < TYPING_THROTTLE_MS) return;
    lastTypingSentRef.current = now;
    sendThreadBroadcast(threadId, 'typing', {
      userId: meId,
      name: identity?.entityName || [me?.firstName, me?.lastName].filter(Boolean).join(' ') || 'Someone',
    });
  }, [threadId, meId, identity?.entityName, me?.firstName, me?.lastName]);

  // Build a fresh pending message. The id is a real uuid passed to chat.send as
  // the message id, so the optimistic bubble and the confirmed row share it and
  // the renderer can drop the pending the instant its confirmed twin lands.
  const newPending = (fields: Partial<PendingMessage>): PendingMessage => ({
    id: crypto.randomUUID(),
    threadId,
    content: null,
    type: 'text',
    fileUrl: null,
    fileName: null,
    fileSize: null,
    thumbnailUrl: null,
    projectId: null,
    replyToId: null,
    senderRole: identity?.entityRole,
    senderBusinessName: identity?.entityName,
    status: 'sending',
    timestamp: new Date().toISOString(),
    ...fields,
  });

  // Run one AI streaming request (send or regenerate): flip the shared streaming
  // state, wire the SSE handlers, and clear the abort handle when the stream
  // ends. The live preview is replaced by the realtime/`done` row when complete.
  const runAiStream = useCallback(
    async (params: {
      messageId?: string;
      content?: string;
      attachments?: AiAttachment[];
      regenerateMessageId?: string;
    }) => {
      patchAiThread(threadId, { streamingText: '', streaming: true });
      wantBottomRef.current = true;
      const ac = new AbortController();
      setAiAbort(threadId, ac);
      await streamAiChat(
        { threadId, ...params, surface, signal: ac.signal },
        {
          onDelta: (t) => {
            appendAiDelta(threadId, t);
            if (stick.isStuck()) wantBottomRef.current = true;
          },
          // Each round of model text arrives as its own committed bubble. Append it
          // (deduped by id against the realtime echo) and reset the live preview so
          // the next round streams into a fresh bubble.
          onMessage: ({ messageId, content, timestamp }) => {
            appendMessage({
              id: messageId,
              threadId,
              senderId: null,
              senderName: 'AI',
              senderAvatar: null,
              senderRole: 'ai',
              senderBusinessName: null,
              isAi: true,
              aiRating: null,
              aiRatedBy: null,
              aiFeedbackResolvedAt: null,
              content,
              type: 'text',
              fileUrl: null,
              fileName: null,
              fileSize: null,
              thumbnailUrl: null,
              projectId: null,
              project: null,
              replyToId: null,
              isForwarded: false,
              editedAt: null,
              deletedAt: null,
              deletedBy: null,
              timestamp,
              pendingActions: null,
              resolvedActionIds: null,
              actionOutcomes: null,
              actionEdits: null,
              actionRegenerations: null,
              awaitSettlementFollowup: false,
              settlementFollowupFiredAt: null,
            });
            patchAiThread(threadId, { streamingText: '' });
            if (stick.isStuck()) wantBottomRef.current = true;
            else setHasNewBelow(true);
          },
          onDone: ({ messageId, pendingActions }) => {
            // Bubbles were already committed via onMessage. Attach any confirm-action
            // cards onto their AI message in the cache so they render inline under it
            // right away (the realtime INSERT carried them as null); they persist in
            // scrollback as the conversation continues and survive a reload.
            if (pendingActions?.length) patchMessage(messageId, { pendingActions });
            patchAiThread(threadId, { streamingText: '', streaming: false });
            // Only snap to the end if the user is still at the bottom — if they
            // scrolled up to read history mid-stream, don't yank them down; flag
            // the jump button instead. (This path used to scroll unconditionally.)
            if (stick.isStuck()) wantBottomRef.current = true;
            else setHasNewBelow(true);
            onRead();
          },
          onError: (msg) => {
            patchAiThread(threadId, { streamingText: '', streaming: false });
            toast.error(msg);
          },
        },
      );
      setAiAbort(threadId, null);
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [threadId, surface, appendMessage, patchMessage, onRead],
  );

  // Stream a reply from the AI assistant (AI threads only). Persists the user
  // turn + streamed reply server-side.
  const handleAiSend = useCallback(
    async (content: string, attachments: AiAttachment[] = []) => {
      const trimmed = content.trim();
      if ((!trimmed && attachments.length === 0) || streaming) return;
      const msgId = crypto.randomUUID();
      setText('');
      // Optimistic user bubble (shares its id with the server row → realtime dedupes).
      if (trimmed) {
        appendMessage({
          id: msgId,
          threadId,
          senderId: meId ?? null,
          senderName: identity?.entityName ?? ([me?.firstName, me?.lastName].filter(Boolean).join(' ') || null),
          senderAvatar: me?.profileUrl ?? null,
          senderRole: 'brand',
          senderBusinessName: identity?.entityName ?? null,
          isAi: false,
          aiRating: null,
          aiRatedBy: null,
          aiFeedbackResolvedAt: null,
          content: trimmed,
          type: 'text',
          fileUrl: null,
          fileName: null,
          fileSize: null,
          thumbnailUrl: null,
          projectId: null,
          project: null,
          replyToId: null,
          isForwarded: false,
          editedAt: null,
          deletedAt: null,
          deletedBy: null,
          timestamp: new Date().toISOString(),
          pendingActions: null,
          resolvedActionIds: null,
          actionOutcomes: null,
          actionEdits: null,
          actionRegenerations: null,
          awaitSettlementFollowup: false,
          settlementFollowupFiredAt: null,
        });
      }
      await runAiStream({ messageId: msgId, content: trimmed, attachments });
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [threadId, meId, identity?.entityName, me?.firstName, me?.lastName, me?.profileUrl, appendMessage, streaming, runAiStream],
  );

  // Expose the streamed-send to a host (Strategy starter-chip / continuation bar)
  // so a chip click dispatches through the same flow as the composer, rather than
  // a bare chat.send that inserts a user message with no reply.
  useEffect(() => {
    if (!isAiThread || !registerAiSend) return;
    registerAiSend((t: string) => void handleAiSend(t));
    return () => registerAiSend(null);
  }, [isAiThread, registerAiSend, handleAiSend]);

  // Regenerate the newest AI reply. Nothing extra is persisted for the user —
  // the server feeds the model a synthetic instruction that this reply was
  // rejected and a completely different approach is wanted. A thumbs-down on
  // the reply stays recorded, and is passed along to the model.
  const handleAiRegenerate = useCallback(
    async (messageId: string) => {
      if (streaming) return;
      await runAiStream({ regenerateMessageId: messageId });
    },
    [streaming, runAiStream],
  );

  // `/clear` command (AI threads): reset the model's context window server-side
  // and drop a visible divider. The on-screen history stays; only the AI's memory
  // of it is cleared. Extend AI_COMMANDS to add more slash-commands later.
  const clearContext = useMutation(trpc.chat.clearAiContext.mutationOptions());
  const handleClearContext = useCallback(async () => {
    if (streaming || clearContext.isPending) return;
    setText('');
    try {
      const marker = await clearContext.mutateAsync({ threadId });
      appendMessage({ ...(marker as unknown as MessageItem), project: null, pendingActions: null, resolvedActionIds: null, actionOutcomes: null, actionRegenerations: null });
      wantBottomRef.current = true;
      onRead();
    } catch (e) {
      toastError(e);
    }
  }, [streaming, clearContext, threadId, appendMessage, onRead]);

  // `/compact` command (AI threads): summarise the conversation and reset the
  // model's window to the summary — the counterpart to `/clear`, but the gist is
  // kept. It runs an out-of-band model call server-side, so it's not instant; a
  // toast covers the wait, then the divider lands like `/clear`'s does.
  const compactContext = useMutation(trpc.chat.compactAiContext.mutationOptions());
  const handleCompactContext = useCallback(async () => {
    if (streaming || compactContext.isPending) return;
    setText('');
    const toastId = toast.loading('Compacting the conversation…');
    try {
      const marker = await compactContext.mutateAsync({ threadId });
      appendMessage({ ...(marker as unknown as MessageItem), project: null, pendingActions: null, resolvedActionIds: null, actionOutcomes: null, actionRegenerations: null });
      wantBottomRef.current = true;
      onRead();
      toast.success(marker.compacted ? 'Conversation compacted.' : 'Nothing to compact yet.', { id: toastId });
    } catch (e) {
      toast.dismiss(toastId);
      toastError(e);
    }
  }, [streaming, compactContext, threadId, appendMessage, onRead]);

  const handleAiStop = useCallback(() => {
    getAiAbort(threadId)?.abort();
    setAiAbort(threadId, null);
    patchAiThread(threadId, { streaming: false });
    // Keep the partial preview; the persisted (partial) reply arrives via realtime.
  }, [threadId]);

  const doSend = () => {
    const content = text.trim();
    if (isAiThread) {
      // Slash-commands: handled locally instead of sent to the model.
      if (content.toLowerCase() === '/clear') {
        void handleClearContext();
        return;
      }
      if (content.toLowerCase() === '/compact') {
        void handleCompactContext();
        return;
      }
      void handleAiSend(content);
      return;
    }
    if (!content && !attachedProjectId) return;
    // Clear the composer + attachment + reply immediately; the message lives on
    // as an optimistic bubble (its projectId and replyToId are captured on the
    // pending row, so a retry still lands as the same reply).
    setText('');
    onClearAttachedProject?.();
    const p = newPending({
      content: content || null,
      projectId: attachedProjectId ?? null,
      replyToId: replyTo?.id ?? null,
    });
    setReplyTo(null);
    add(p);
    wantBottomRef.current = true; // my own send always scrolls to the bottom
    void dispatchSend(p);
  };

  const onPickFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files ?? []);
    e.target.value = '';
    await sendFiles(files);
  };

  /** Upload and send a set of files, one after another. */
  const sendFiles = async (files: File[]) => {
    // Sequential, not parallel: the panel has ONE upload-progress slot, and a
    // shared ffmpeg/canvas pipeline underneath. Three at once would report the
    // last one's percentage for all three.
    for (const file of files) await sendFile(file);
  };

  const sendFile = async (file: File) => {
    if (!file) return;
    // AI thread: block video + audio (the assistant can't take them).
    if (isAiThread) {
      const ext = file.name.split('.').pop()?.toLowerCase() ?? '';
      if (AI_BLOCKED_EXTS.has(ext) || file.type.startsWith('video/') || file.type.startsWith('audio/')) {
        toast.error("Video and audio files can't be sent to the AI assistant.");
        return;
      }
    }
    setUploading(true);
    setUploadProgress(null);
    try {
      const publicUrl = await uploadFile(CHAT_BUCKET, `${threadId}`, file, {
        // LOSSLESS FOR PEOPLE, COMPRESSED FOR THE MODEL.
        //
        // What someone sends a colleague is evidence — a screenshot they have to
        // read text off, a photo of a document, a design at its export
        // resolution — and the uploader's default (1600px WebP at 0.82, 720p
        // CRF-24 for video) destroys the only copy the recipient will ever see.
        // So a human conversation gets the exact bytes.
        //
        // The AI thread is the one genuine exception and keeps compressing: the
        // image is being READ BY A MODEL that downsamples it on arrival anyway,
        // so the extra megabytes buy nothing and a large original is a request
        // that can fail outright.
        noCompress: !isAiThread,
        onProgress: setUploadProgress,
      });
      if (isAiThread) {
        await handleAiSend(text.trim(), [
          { url: publicUrl, name: file.name, kind: aiAttachmentKind(file.name), mediaType: file.type || undefined },
        ]);
      } else {
        const kind = fileTypeFromName(file.name);
        const p = newPending({
          type: kind,
          fileUrl: publicUrl,
          fileName: file.name,
          fileSize: file.size,
          thumbnailUrl: kind === 'image' ? publicUrl : null,
        });
        add(p);
        wantBottomRef.current = true; // my own send always scrolls to the bottom
        void dispatchSend(p);
      }
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error('chat upload failed', err);
      toast.error(`${file.name} didn't upload.`);
    } finally {
      setUploading(false);
      setUploadProgress(null);
    }
  };

  /* ── Drag and drop ─────────────────────────────────────────────────────── */

  const [dropArmed, setDropArmed] = useState(false);
  const dragDepth = useRef(0);

  /** Is this drag carrying FILES? Dragging text or a link is not a drop. */
  const dragHasFiles = (e: React.DragEvent) =>
    Array.from(e.dataTransfer?.types ?? []).includes('Files');

  const disarmDrop = () => {
    dragDepth.current = 0;
    setDropArmed(false);
  };

  /**
   * Take a drop.
   *
   * Folders are refused by name: a dragged directory arrives in `files` as a
   * zero-byte entry carrying the folder's name, so sending it blind delivers an
   * empty file called "Screenshots".
   */
  const acceptDroppedFiles = async (dt: DataTransfer) => {
    const entries = Array.from(dt.items ?? []).map((item) =>
      typeof item.webkitGetAsEntry === 'function' ? item.webkitGetAsEntry() : null,
    );
    if (entries.some((entry) => entry?.isDirectory)) {
      toast.error('Folders can’t be sent — drop the files inside.');
    }
    // Match by index where the entry list lines up with the file list (it does
    // whenever `items` is supported), so a mixed drop still sends the files.
    const files = Array.from(dt.files ?? []).filter((_f, i) => !entries[i]?.isDirectory);
    if (files.length) await sendFiles(files);
  };

  // Server history (oldest-first) followed by optimistic outgoing bubbles — one
  // flat list for the virtualizer. Pending rows only ever append at the end.
  type RenderRow = { kind: 'msg'; m: MessageItem } | { kind: 'pending'; p: PendingMessage };
  const rows = useMemo<RenderRow[]>(() => {
    // Drop any optimistic bubble whose confirmed twin is already in the list —
    // the pending and the real row share an id, so once the real one lands (via
    // the mutation response OR the realtime echo, whichever is first) the pending
    // vanishes in the same recompute. No window where both show, no flicker.
    const confirmedIds = new Set(messages.map((m) => m.id));
    return [
      ...messages.map((m): RenderRow => ({ kind: 'msg', m })),
      ...pending.filter((p) => !confirmedIds.has(p.id)).map((p): RenderRow => ({ kind: 'pending', p })),
    ];
  }, [messages, pending]);

  /**
   * PREPEND COMPENSATION — see the refs above for why it lives in render.
   *
   * The anchor is the first MESSAGE row, and its new index is by definition how
   * many rows are now above it: the shift to apply. Running during render is
   * what keeps `data` and `firstItemIndex` in the same commit, which is the
   * whole contract — apply it a commit late and Virtuoso reads the prepend as an
   * append and the reader's screen jumps to a different message.
   */
  if (seenRowsRef.current !== rows) {
    seenRowsRef.current = rows;
    const keyOf = (row: RenderRow) => (row.kind === 'msg' ? row.m.id : row.p.id);
    const anchor = frontAnchorRef.current;
    if (anchor) {
      const now = rows.findIndex((r) => keyOf(r) === anchor.key);
      // `now < 0` is the front being trimmed rather than extended — a thread
      // switch or a window reset, both of which reset the base index anyway.
      if (now > 0 && now > anchor.index) setFirstItemIndex((i) => i - (now - anchor.index));
    }
    const at = rows.findIndex((r) => r.kind === 'msg');
    frontAnchorRef.current = at >= 0 ? { key: keyOf(rows[at]), index: at } : null;
  }

  // Where every loaded message sits, by id. Serves the quoted-reply block (what
  // did this answer?) and the jump that follows it (where is that?). Built once
  // per render of the list rather than searched per row, so a 300-message window
  // costs one pass instead of 300 scans.
  const messageIndexById = useMemo(() => {
    const map = new Map<string, { index: number; m: MessageItem }>();
    rows.forEach((row, i) => {
      if (row.kind === 'msg') map.set(row.m.id, { index: i, m: row.m });
    });
    return map;
  }, [rows]);

  /**
   * Scroll to a message and flash it. Without the flash a jump lands you
   * somewhere and leaves you to work out where — the confirmation is the point.
   */
  const jumpToMessage = useCallback(
    (messageId: string) => {
      const hit = messageIndexById.get(messageId);
      if (!hit) {
        // Older than the loaded window. Say so rather than doing nothing, which
        // reads as a broken quote.
        toast.info('That message is further back — scroll up to load it.');
        return;
      }
      virtuosoRef.current?.scrollToIndex({ index: firstItemIndex + hit.index, align: 'center' });
      setFlashId(messageId);
      window.setTimeout(() => setFlashId((cur) => (cur === messageId ? null : cur)), 900);
    },
    [messageIndexById, firstItemIndex],
  );

  // A reply is about the conversation you were in; carrying it into a different
  // one would quote a message the new thread cannot even see.
  useEffect(() => {
    setReplyTo(null);
    setPickerFor(null);
    setFlashId(null);
  }, [threadId]);

  // Only the newest message can be regenerated (and only if it's an AI reply) —
  // older replies already have conversation built on top of them.
  const lastAiMessageId = useMemo(() => {
    const last = messages[messages.length - 1];
    return last?.isAi && last.content ? last.id : null;
  }, [messages]);

  // After our own send appends a row, jump to the bottom. Keyed on rows.length so
  // it fires once the new row is committed; the ref flag ensures incoming
  // messages and older-page prepends (which also grow rows) don't trigger it.
  //
  // Declaring the view stuck is the part that lasts: everything the new row
  // renders afterwards — markdown, an avatar, an image, an action card — re-pins
  // on its own from there, which is what the settle window used to approximate.
  useEffect(() => {
    if (!wantBottomRef.current) return;
    wantBottomRef.current = false;
    stick.setStuck(true);
    const raf = requestAnimationFrame(() => scrollToBottom('auto'));
    return () => cancelAnimationFrame(raf);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows.length, scrollToBottom]);

  // Streaming needs no scroll effect of its own any more. The reply grows inside
  // the Virtuoso Footer — not as a row, so no item callback ever reports it —
  // and the hook watches the scroller's content box, so a stuck view follows
  // every token and a reader who scrolled up to re-read something mid-reply is
  // left exactly where they are. The hand-rolled rAF lerp this replaces had to
  // guess at both.

  // One-shot: the first time rows become non-empty for this thread, jump to the
  // true bottom (align: end). Virtuoso's initialTopMostItemIndex positions the
  // last item at the TOP of the viewport — this corrects it to the bottom.
  // Double-rAF lets Virtuoso finish its initial layout before we scroll; the view
  // opens stuck, so the async render of markdown/avatars/images/cards keeps
  // landing us at the true bottom rather than parked above the last message.
  useEffect(() => {
    if (didInitialScrollRef.current || rows.length === 0) return;
    didInitialScrollRef.current = true;
    const raf1 = requestAnimationFrame(() => {
      const raf2 = requestAnimationFrame(() => scrollToBottom('auto'));
      return () => cancelAnimationFrame(raf2);
    });
    return () => cancelAnimationFrame(raf1);
  }, [rows.length, scrollToBottom]);

  // Count every AI action card across the whole thread and how many are settled
  // (confirmed or dismissed). Drives the auto-scroll below; derived from the
  // persisted outcomes so it's correct regardless of the order cards are settled.
  const actionCardTally = useMemo(() => {
    let total = 0;
    let settled = 0;
    for (const m of messages) {
      if (!m.isAi || !m.pendingActions?.length) continue;
      for (const a of m.pendingActions) {
        total += 1;
        if (actionOutcomeOf(m, a.toolUseId) != null) settled += 1;
      }
    }
    return { total, settled };
  }, [messages]);

  // Once the LAST outstanding action card is settled, scroll to the end so the
  // user sees the latest reply/footer. Fires only on the transition into
  // "all settled" (via allActionsSettledRef), so settling a non-final card — in
  // whatever order — does nothing until the whole set is satisfied. Gated on the
  // initial scroll having run so an already-settled thread doesn't smooth-scroll
  // on open (the one-shot initial effect already lands it at the bottom).
  const allActionsSettledRef = useRef(true);
  useEffect(() => {
    const { total, settled } = actionCardTally;
    const allSettled = total > 0 && settled === total;
    const wasAllSettled = allActionsSettledRef.current;
    allActionsSettledRef.current = allSettled;
    if (!allSettled || wasAllSettled || !didInitialScrollRef.current) return;
    stick.setStuck(true);
    const raf = requestAnimationFrame(() => scrollToBottom('smooth'));
    return () => cancelAnimationFrame(raf);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [actionCardTally, scrollToBottom]);

  // Signature that groups consecutive bubbles for timestamp collapsing: the
  // sender (so a different person breaks the run) and, for my own messages, the
  // sent-vs-seen tick state. Two adjacent rows with the same signature within a
  // minute share one timestamp (shown on the lower/newer one).
  const rowStatusSig = (row: RenderRow): string => {
    if (row.kind === 'pending') return 'me:sent';
    const rm = row.m;
    if (rm.type === 'system') return 'system';
    if (rm.senderId !== meId) return `them:${rm.senderId}`;
    return allOthersLastReadAt >= new Date(rm.timestamp).getTime() ? 'me:seen' : 'me:sent';
  };

  const renderRow = (index: number, row: RenderRow) => {
    const dataIndex = index - firstItemIndex;
    const prev = rows[dataIndex - 1];
    if (row.kind === 'pending') {
      const p = row.p;
      const prevTs = prev ? (prev.kind === 'msg' ? prev.m.timestamp : prev.p.timestamp) : undefined;
      return (
        <div className="px-3">
          {shouldShowTimeDivider(prevTs, p.timestamp) && <TimeDivider ts={p.timestamp} />}
          <div className="flex gap-2 pb-1.5">
            <div className="@container min-w-0 flex-1">
              <PendingBubble
                p={p}
                actionsOpen={openActionsId === p.id}
                onToggleActions={() => setOpenActionsId((cur) => (cur === p.id ? null : p.id))}
                onRetry={() => retryPending(p)}
                onDelete={() => deletePending(p.id)}
              />
            </div>
          </div>
        </div>
      );
    }
    const m = row.m;
    const prevMsg = prev && prev.kind === 'msg' ? prev.m : undefined;
    const mine = m.senderId === meId;
    const showHeader = !prevMsg || prevMsg.senderId !== m.senderId || prevMsg.type === 'system';
    const readByOthers = allOthersLastReadAt >= new Date(m.timestamp).getTime();
    const divider = shouldShowTimeDivider(prevMsg?.timestamp, m.timestamp);
    // Collapse the per-bubble timestamp into runs: show it only on the newest
    // message of a group — i.e. when there's no message below, the next one is
    // >1 min later, or the next one has a different sender/seen status.
    const next = rows[dataIndex + 1];
    const nextTs = next ? (next.kind === 'msg' ? next.m.timestamp : next.p.timestamp) : null;
    const within1Min = nextTs ? new Date(nextTs).getTime() - new Date(m.timestamp).getTime() <= 60_000 : false;
    const showMeta = !next || !within1Min || rowStatusSig(row) !== rowStatusSig(next);
    return (
      <div className="px-3">
        {divider && <TimeDivider ts={m.timestamp} />}
        <div
          className={cn(
            'rounded-[var(--radius-md)] pb-1.5 transition-colors',
            m.type !== 'system' && 'flex gap-2',
            !mine && m.type !== 'system' ? 'items-start' : '',
            // The jump confirmation. A ring rather than a fill, so a long message
            // is outlined instead of repainted under the reader's eyes.
            flashId === m.id && 'bg-accent/10 ring-1 ring-accent',
          )}
        >
          {!mine && !m.isAi && m.type !== 'system' && (
            <Avatar className={cn('h-7 w-7 shrink-0', !showHeader && 'invisible')}>
              {m.senderAvatar && <AvatarImage src={m.senderAvatar} alt="" />}
              <AvatarFallback>{initialsOf(m.senderName)}</AvatarFallback>
            </Avatar>
          )}
          <div className="@container min-w-0 flex-1">
            <MessageBubble
              m={m}
              mine={mine}
              showHeader={showHeader && !m.isAi}
              showMeta={showMeta && !isAiThread && !m.isAi}
              readByOthers={readByOthers}
              member={m.senderId ? memberById.get(m.senderId) : undefined}
              onOpenProject={onOpenProject}
              quoted={m.replyToId ? (messageIndexById.get(m.replyToId)?.m ?? null) : null}
              reactions={reactionsByMessage.get(m.id) ?? EMPTY_REACTIONS}
              // Neither reacting to nor replying to your own AI assistant means
              // anything — it is a two-party conversation with one participant
              // who cannot see a 👍. Copy stays, because copying an answer is the
              // single most common thing anyone does with one.
              canReact={!isAiThread && !m.isAi}
              canReply={!isAiThread && !m.isAi}
              onReact={(emoji) => toggleReaction.mutate({ messageId: m.id, emoji })}
              onOpenPicker={(anchor) => setPickerFor({ id: m.id, anchor })}
              onReply={() => setReplyTo(m)}
              onJumpToQuoted={() => m.replyToId && jumpToMessage(m.replyToId)}
              onMediaLoad={stick.repin}
              onLongPress={() => setActionsFor(m)}
            />
            {m.isAi && m.content && (
              <div className="mt-0.5 flex items-center gap-1">
                <button
                  onClick={() => setFeedback(m.id, m.aiRating, 1)}
                  aria-label="Helpful"
                  className={cn('rounded p-1 hover:bg-inset', m.aiRating === 1 ? 'text-accent' : 'text-ink-30')}
                >
                  <ThumbsUp className="h-3 w-3" />
                </button>
                <button
                  onClick={() => setFeedback(m.id, m.aiRating, -1)}
                  aria-label="Not helpful"
                  className={cn('rounded p-1 hover:bg-inset', m.aiRating === -1 ? 'text-danger' : 'text-ink-30')}
                >
                  <ThumbsDown className="h-3 w-3" />
                </button>
                {m.id === lastAiMessageId && !streaming && (
                  <button
                    onClick={() => void handleAiRegenerate(m.id)}
                    aria-label="Regenerate reply"
                    title="Regenerate — ask for a different answer"
                    className="rounded p-1 text-ink-30 hover:bg-inset"
                  >
                    <RefreshCw className="h-3 w-3" />
                  </button>
                )}
              </div>
            )}
            {/* Confirm-action cards live inline under their own AI message, so they
                stay in scrollback as the conversation continues (rather than a single
                bottom-pinned slot). A turn may propose several — each is confirmed or
                dismissed independently, and its state persists on the message. */}
            {m.isAi && m.pendingActions && m.pendingActions.length > 0 && (
              <div className="mt-2 space-y-2">
                {m.pendingActions.map((a) => (
                  <AiActionCard
                    key={a.toolUseId}
                    action={a}
                    threadId={threadId}
                    outcome={actionOutcomeOf(m, a.toolUseId)}
                    brandId={aiAccess.data?.brandId ?? undefined}
                    savedEdits={m.actionEdits?.[a.toolUseId]}
                    regen={{
                      messageId: m.id,
                      toolUseId: a.toolUseId,
                      generations: m.actionRegenerations?.[a.toolUseId] ?? [],
                      persist: (gens) => persistRegenerations(m.id, a.toolUseId, gens),
                    }}
                    onConfirmed={(edits) => resolveAction(m.id, a.toolUseId, 'confirmed', edits)}
                    onReject={() => resolveAction(m.id, a.toolUseId, 'rejected')}
                  />
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    );
  };

  return (
    <div
      className="relative flex h-full flex-col"
      // THE DROP TARGET IS THE WHOLE PANEL, header to composer — not the attach
      // button. When you drag a file at a chat window you are aiming at the
      // conversation, and a target the size of a control means most drops land
      // on the page behind, which in a browser means navigating away from the
      // app and losing the draft. The veil below is pointer-events:none so these
      // keep firing while it is up.
      onDragEnter={(e) => {
        if (!dragHasFiles(e)) return;
        dragDepth.current += 1;
        setDropArmed(true);
      }}
      onDragOver={(e) => {
        if (!dragHasFiles(e)) return;
        // Without BOTH of these the browser refuses the drop and falls back to
        // opening the file as a page.
        e.preventDefault();
        e.dataTransfer.dropEffect = 'copy';
      }}
      onDragLeave={(e) => {
        if (!dragHasFiles(e)) return;
        // Counted, not a boolean: dragenter/dragleave fire for every descendant
        // the pointer crosses, so a bare flag strobes the veil for the whole
        // drag.
        dragDepth.current -= 1;
        if (dragDepth.current <= 0) disarmDrop();
      }}
      onDrop={(e) => {
        if (!dragHasFiles(e)) return;
        e.preventDefault();
        disarmDrop();
        void acceptDroppedFiles(e.dataTransfer);
      }}
    >
      {dropArmed && (
        <div
          className="pointer-events-none absolute inset-0 z-40 flex items-center justify-center bg-ink-100/30 p-3"
          aria-hidden="true"
        >
          <div className="flex h-full w-full flex-col items-center justify-center gap-2 rounded-[var(--radius-lg)] border-2 border-dashed border-accent bg-card/90">
            <span className="grid h-11 w-11 place-items-center rounded-full bg-accent text-ink-100">
              <Paperclip className="h-5 w-5" />
            </span>
            <span className="text-sm font-semibold text-ink-100">Drop to attach</span>
            <span className="text-[11px] text-ink-40">
              {isAiThread ? 'Images and documents' : 'Any file · sent at full quality'}
            </span>
          </div>
        </div>
      )}

      {/* Header */}
      {!hideHeader && (
        <div className="flex items-center gap-3 border-b border-[color:var(--color-border-hairline)] px-4 py-3">
          {onBack && (
            <button onClick={onBack} aria-label="Back to conversations" className="-ml-1 rounded-[var(--radius-sm)] p-1 text-ink-60 hover:bg-inset hover:text-ink-100">
              <ArrowLeft className="h-5 w-5" />
            </button>
          )}
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-1.5">
              <span className="truncate text-sm font-semibold text-ink-100">{threadName}</span>
              {threadMetaQ.data?.isMuted && (
                <BellOff className="h-3 w-3 shrink-0 text-ink-40" aria-label="Muted" />
              )}
            </div>
            <button onClick={() => setMembersOpen(true)} className="flex items-center gap-1 text-xs text-ink-40 hover:text-ink-100">
              <Users className="h-3 w-3" /> {members.length} member{members.length === 1 ? '' : 's'}
            </button>
          </div>
          {headerRight && <div className="flex-shrink-0">{headerRight}</div>}
          {!isAiThread && (
            <ThreadMenu
              isMuted={!!threadMetaQ.data?.isMuted}
              mutedUntil={threadMetaQ.data?.mutedUntil ?? null}
              onMute={(until) => setMuted.mutate({ threadId, until })}
            />
          )}
        </div>
      )}

      {/* Messages — virtualized so the DOM stays bounded no matter how deep the
          history is. Older pages load on scroll-to-top; live + own messages
          append at the bottom. */}
      <div className="relative min-h-0 flex-1">
        {q.isLoading ? (
          <div className="space-y-1.5 p-5">
            {Array.from({ length: 4 }).map((_, i) => (
              <Skeleton key={i} className="h-12 w-2/3" />
            ))}
          </div>
        ) : rows.length === 0 ? (
          <div className="grid h-full place-items-center">
            <EmptyState icon={MessageSquare} title="No messages yet" description="Say hello to start the conversation." />
          </div>
        ) : (
          <Virtuoso
            key={threadId}
            ref={virtuosoRef}
            scrollerRef={(el) => (scrollerElRef.current = el as HTMLElement | null)}
            className="h-full"
            data={rows}
            firstItemIndex={firstItemIndex}
            initialTopMostItemIndex={{ index: Math.max(0, rows.length - 1), align: 'end' }}
            startReached={loadOlder}
            atTopThreshold={120}
            // No atBottomStateChange / atBottomThreshold: Virtuoso answers "at the
            // bottom?" from a measurement taken after the layout settled, and so
            // cannot separate "they scrolled up" from "the content grew under a
            // pinned viewport". The sticky flag is the single source of truth for
            // the jump button, the follow-the-newest-message rule and re-anchoring
            // alike.
            //
            // A tall last message (the full Growth Strategy, say) keeps growing as
            // its markdown reflows after the initial scroll, which would otherwise
            // leave us parked at the START of that message. This is the item half
            // of following it; the hook's ResizeObserver covers the footer, the
            // viewport and everything the virtualiser doesn't report.
            totalListHeightChanged={stick.onContentHeightChanged}
            itemContent={renderRow}
            computeItemKey={(_index, row) => (row.kind === 'msg' ? row.m.id : row.p.id)}
            components={{
              // ONE FIXED HEIGHT for every state. The header sits above the
              // reader, so each px it changes by shifts the whole transcript
              // under them — and it changed at the worst possible moment:
              // swapping the label for a skeleton as a page starts loading, and
              // collapsing to a spacer once the last page proves there is no more
              // history.
              Header: () => (
                <div className="flex h-9 items-center justify-center">
                  {!hasMore ? null : q.isFetchingNextPage ? (
                    <Skeleton className="h-4 w-24" />
                  ) : (
                    <span className="text-[11px] text-ink-40">Scroll up for older messages</span>
                  )}
                </div>
              ),
              // Typing indicator lives in the footer so it sits within the
              // scroller at the end of the conversation (like a chat), instead
              // of as a fixed bar floating above the composer.
              // Extra bottom space so the newest message clears the composer and
              // isn't visually crowded by the text field when scrolled to the end.
              Footer: () => (
                <>
                  {isAiThread && (streaming || streamingText) && (
                    <div className="px-3 pb-2">
                      {/* Match the committed AI bubble: plain text, no avatar, no background. */}
                      <div className="text-sm text-ink-100">
                        {streamingText ? <Markdown>{streamingText}</Markdown> : <AiThinkingVerb />}
                        {streaming && <span className="ml-0.5 inline-block h-3.5 w-[3px] animate-pulse rounded-sm bg-ink-40 align-middle" />}
                      </div>
                      {/* Rotating tips while the model thinks (before any text streams). */}
                      {streaming && !streamingText && <AiThinkingHint />}
                    </div>
                  )}
                  <TypingIndicator names={typingNames} />
                  <div className="pb-8" />
                </>
              ),
            }}
          />
        )}
        {/* Floating jump-to-latest, like ChatGPT/Claude: appears only when the
            user has scrolled up off the bottom, and flags new messages that
            arrived while they were reading history. Clicking smooth-scrolls to
            the end and clears the flag. */}
        {!stick.stuck && rows.length > 0 && (
          <button
            type="button"
            onClick={() => {
              setHasNewBelow(false);
              // No setStuck(true) here: the smooth scroll's own events re-derive
              // it on arrival, so the button can't flicker back mid-flight.
              scrollToBottom('smooth');
            }}
            aria-label={hasNewBelow ? 'Jump to new messages' : 'Scroll to latest'}
            className="absolute bottom-4 left-1/2 z-10 flex -translate-x-1/2 items-center gap-1.5 rounded-full border border-[color:var(--color-border-default)] bg-card px-3 py-1.5 text-xs font-medium text-ink-100 shadow-[var(--shadow-md,0_4px_12px_rgba(0,0,0,0.15))] transition hover:bg-inset"
          >
            {hasNewBelow && <span className="h-1.5 w-1.5 rounded-full bg-accent" />}
            {hasNewBelow ? 'New messages' : 'Jump to latest'}
            <ChevronDown className="h-3.5 w-3.5" />
          </button>
        )}
      </div>

      {/* What you're answering. Sits directly above the composer — the one place
          it can't be missed — and Escape in the textarea clears it. */}
      {replyTo && (
        <div className="mx-3 mb-1 flex items-start gap-2 rounded-[var(--radius-sm)] border-l-2 border-accent bg-inset px-3 py-2">
          <CornerUpLeft className="mt-0.5 h-3.5 w-3.5 shrink-0 text-accent" />
          <span className="min-w-0 flex-1">
            <span className="block text-[11px] font-bold text-ink-100">
              Replying to {replyTo.senderId === meId ? 'yourself' : (replyTo.senderName ?? 'a message')}
            </span>
            <span className="block truncate text-xs text-ink-40">
              {replyTo.content ?? (replyTo.fileName || 'Attachment')}
            </span>
          </span>
          <button onClick={() => setReplyTo(null)} aria-label="Cancel reply" className="text-ink-40 hover:text-ink-100">
            <X className="h-4 w-4" />
          </button>
        </div>
      )}

      {/* Attached project chip */}
      {attachedProjectId && (
        <div className="mx-3 mb-1 flex items-center gap-2 rounded-[var(--radius-sm)] border border-[color:var(--color-border-default)] bg-card px-3 py-2">
          <Folder className="h-4 w-4 text-accent" />
          <span className="flex-1 text-xs text-ink-100">Project attached</span>
          <button onClick={onClearAttachedProject} className="text-ink-40 hover:text-ink-100">
            <X className="h-4 w-4" />
          </button>
        </div>
      )}

      {/* Compression / upload progress for an in-flight attachment. */}
      {uploading && (
        <div className="border-t border-[color:var(--color-border-hairline)] px-3 pt-2">
          <UploadProgressBar progress={uploadProgress} />
        </div>
      )}

      {/* Suggested prompts — shown on a fresh AI thread (only the welcome notice). */}
      {isAiThread && !aiLocked && !streaming && messages.every((m) => m.type === 'system') && (
        <div className="flex flex-wrap gap-2 px-3 pb-1">
          {AI_SUGGESTIONS.map((s) => (
            <button
              key={s}
              onClick={() => void handleAiSend(s)}
              className="rounded-full border border-[color:var(--color-border-default)] bg-card px-3 py-1.5 text-xs text-ink-100 hover:bg-inset"
            >
              {s}
            </button>
          ))}
        </div>
      )}

      {/* Feature Subscription upsell — shown in-thread when the brand owner isn't
          subscribed to Growth Strategy. "Generate my strategy" → subscribe view.
          Suppressed when the host supplies its own subscribe UI (hideSubscribeGate). */}
      {aiLocked && !hideSubscribeGate && (
        <GrowthUpsellCard
          product={aiAccess.data?.product}
          loading={startCheckout.isPending}
          onSubscribe={() => {
            const brandId = aiAccess.data?.brandId;
            const priceId = aiAccess.data?.product?.priceId;
            if (brandId && priceId) {
              // Redirect straight to Stripe Checkout.
              startCheckout.mutate({ brandId, priceId, ...checkoutReturnUrls() });
              return;
            }
            // No live price wired up — fall back to the subscribe page.
            const slug = aiAccess.data?.product?.slug ?? 'growth-strategy';
            navigate(`/subscribe/${slug}${brandId ? `?brandId=${brandId}` : ''}`);
          }}
        />
      )}

      {/* Composer */}
      <div className="flex items-end gap-2 border-t border-[color:var(--color-border-hairline)] p-3">
        <input ref={fileRef} type="file" accept={isAiThread ? AI_ACCEPT : undefined} className="hidden" onChange={onPickFile} />
        <Button type="button" variant="ghost" size="icon" disabled={uploading || aiLocked} onClick={() => fileRef.current?.click()} aria-label="Attach file">
          <Paperclip className="h-4 w-4" />
        </Button>
        <textarea
          value={text}
          disabled={aiLocked}
          onChange={(e) => {
            setText(e.target.value);
            if (!isAiThread && e.target.value.trim()) broadcastTyping();
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              if (!aiLocked) doSend();
            }
            // Escape drops the reply rather than the draft — the draft is the
            // expensive thing to lose.
            if (e.key === 'Escape' && replyTo) {
              e.preventDefault();
              setReplyTo(null);
            }
          }}
          rows={1}
          placeholder={
            aiLocked
              ? 'Subscribe to use the AI assistant…'
              : isAiThread
                ? 'Ask your AI assistant…'
                : isMobile
                  ? 'Type a message…'
                  : 'Type a message… (Shift+Enter for new line)'
          }
          className="max-h-32 min-h-[2.5rem] flex-1 resize-none rounded-[var(--radius-md)] bg-inset px-3 py-2 text-sm text-ink-100 outline-none placeholder:text-ink-40 disabled:opacity-60"
        />
        {isAiThread && streaming ? (
          <Button type="button" variant="outline" size="icon" onClick={handleAiStop} aria-label="Stop generating">
            <Square className="h-4 w-4" />
          </Button>
        ) : (
          <Button
            type="button"
            variant="accent"
            size="icon"
            disabled={aiLocked || (isAiThread ? !text.trim() : !text.trim() && !attachedProjectId) || uploading}
            onClick={doSend}
            aria-label="Send"
          >
            <Send className="h-4 w-4" />
          </Button>
        )}
      </div>

      {pickerFor && (
        <ReactionPicker
          anchor={pickerFor.anchor}
          onPick={(emoji) => {
            toggleReaction.mutate({ messageId: pickerFor.id, emoji });
            setPickerFor(null);
          }}
          onClose={() => setPickerFor(null)}
        />
      )}

      {actionsFor && (
        <MessageActionSheet
          content={actionsFor.content}
          fileUrl={actionsFor.fileUrl}
          fileName={actionsFor.fileName}
          canReact={!isAiThread && !actionsFor.isAi}
          canReply={!isAiThread && !actionsFor.isAi}
          onReact={(emoji) => toggleReaction.mutate({ messageId: actionsFor.id, emoji })}
          onOpenPicker={() => setPickerFor({ id: actionsFor.id, anchor: null })}
          onReply={() => setReplyTo(actionsFor)}
          onClose={() => setActionsFor(null)}
        />
      )}

      <MembersDialog
        open={membersOpen}
        onOpenChange={setMembersOpen}
        members={members}
        threadId={threadId}
      />
    </div>
  );
}
