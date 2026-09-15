/* Prodesk Suite — Growth strategy app interior (Command Center UI/UX).
   The brand's AI assistant chat thread (reuses the shared MessagePanel, same flow
   as Prodesk) plus subscription management, strategic starter prompt chips,
   brand record radar, and brand-level Notepad. */

import {
  useEffect,
  useMemo,
  useRef,
  useState,
  useCallback,
  Component,
  type ReactNode,
} from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useTRPC } from '@shared/lib/trpc';
import { useCurrentUser } from '@shared/auth/auth-context';
import { MessagePanel } from '@shared/pages/chat/message-panel';
import { Markdown } from '@shared/components/markdown';
import { joinThreadChannel } from '@shared/pages/chat/chat-channel';
import { useAiThread } from '@shared/pages/chat/ai-chat-store';
import type { ChatIdentity } from '@shared/pages/chat/chat-types';
import {
  Sparkles,
  Zap,
  Target,
  TrendingUp,
  DollarSign,
  Swords,
  PanelLeft,
  PanelLeftClose,
  FileText,
  Bot,
  Undo2,
  Redo2,
  Copy,
  ListTodo,
  BookText,
  CheckCircle2,
  Circle,
  Loader2,
  ChevronRight,
  ArrowLeft,
  Wand2,
  StickyNote,
  Brain,
} from 'lucide-react';
import { Icon } from './icons';
import { BrandMark } from './ui';
import type { Brand } from './data';
import { toast } from 'sonner';

/** The feature key this app gates on (must match feature-keys.ts). */
const AI_FEATURE_KEY = 'ai_growth_strategy';

/** Strategic starter prompts for quick 1-click execution. */
const STARTER_PROMPTS = [
  {
    id: 'roadmap',
    icon: Target,
    label: '90-Day Execution Roadmap',
    prompt:
      'Formulate a 90-day growth and execution roadmap for our brand, broken into monthly milestones and weekly high-impact priorities.',
  },
  {
    id: 'levers',
    icon: TrendingUp,
    label: 'High-Impact Growth Levers',
    prompt:
      'Analyze our current positioning and identify the top 3 high-impact growth levers we should pull to accelerate revenue.',
  },
  {
    id: 'pricing',
    icon: DollarSign,
    label: 'Pricing & Monetization Audit',
    prompt:
      'Perform an audit of our pricing structure and value metrics. How can we optimize pricing tiers to improve LTV and conversion?',
  },
  {
    id: 'positioning',
    icon: Swords,
    label: 'Competitive Moat Matrix',
    prompt:
      'Evaluate our competitive positioning in our market. What are our core differentiators and how can we deepen our brand moat?',
  },
  {
    id: 'acquisition',
    icon: Zap,
    label: 'Acquisition Channels Analysis',
    prompt:
      'What customer acquisition channels (paid, organic, outbound, partnership) are best suited for scaling our brand next?',
  },
];

/** Error boundary component to protect the Strategy workspace from crashing. */
class SafeBoundary extends Component<
  { children: ReactNode; fallback?: ReactNode },
  { hasError: boolean }
> {
  state = { hasError: false };
  static getDerivedStateFromError() {
    return { hasError: true };
  }
  componentDidCatch(err: unknown) {
    // eslint-disable-next-line no-console
    console.error('SafeBoundary caught error:', err);
  }
  render() {
    if (this.state.hasError) {
      return this.props.fallback ?? null;
    }
    return this.props.children;
  }
}

/**
 * Reusable brand-level text editor with debounced server autosave and a local
 * undo/redo stack. Both the Notepad and the Context tab are instances of this —
 * they differ only in labels and which brand field they load/persist, passed in
 * by the parent (so this component calls no tRPC hooks of its own).
 */
function TextPanel({
  title,
  TitleIcon,
  placeholder,
  footerNoun,
  initialContent,
  persist,
}: {
  title: string;
  TitleIcon: React.ComponentType<{ className?: string }>;
  placeholder: string;
  /** Word/char footer noun, e.g. "words". Notepad and Context share it. */
  footerNoun?: string;
  /** Loaded field value (undefined until the query settles). */
  initialContent: string | undefined;
  /** Persist the text; returns a promise so save status can reflect success. */
  persist: (content: string) => Promise<unknown>;
}) {
  const [content, setContent] = useState('');
  const [isLoaded, setIsLoaded] = useState(false);
  const [saveStatus, setSaveStatus] = useState<'saved' | 'saving' | 'unsaved'>(
    'saved',
  );

  // History stack for Undo / Redo with debouncer
  const [history, setHistory] = useState<string[]>(['']);
  const [historyIndex, setHistoryIndex] = useState(0);

  const historyRef = useRef<string[]>(['']);
  const historyIndexRef = useRef<number>(0);
  const historyTimeoutRef = useRef<number | null>(null);
  const pendingTextRef = useRef<string | null>(null);

  // `persist` may change identity per render (mutateAsync); keep it in a ref so
  // the "flush on unmount" effect depends on nothing and runs solely on unmount.
  const persistRef = useRef(persist);
  persistRef.current = persist;

  // Push immediate history snapshot
  const pushHistorySnapshot = useCallback((nextText: string) => {
    if (historyTimeoutRef.current) {
      window.clearTimeout(historyTimeoutRef.current);
      historyTimeoutRef.current = null;
    }
    pendingTextRef.current = null;

    const currentHistory = historyRef.current;
    const currentIndex = historyIndexRef.current;
    const sliced = currentHistory.slice(0, currentIndex + 1);

    if (sliced[sliced.length - 1] === nextText) return;

    const nextStack = [...sliced, nextText];
    if (nextStack.length > 100) nextStack.shift();

    const nextIdx = nextStack.length - 1;

    historyRef.current = nextStack;
    historyIndexRef.current = nextIdx;

    setHistory(nextStack);
    setHistoryIndex(nextIdx);
  }, []);

  // Schedule debounced history snapshot (500ms pause)
  const scheduleHistorySnapshot = useCallback(
    (nextText: string) => {
      pendingTextRef.current = nextText;
      if (historyTimeoutRef.current) {
        window.clearTimeout(historyTimeoutRef.current);
      }
      historyTimeoutRef.current = window.setTimeout(() => {
        pushHistorySnapshot(nextText);
      }, 500);
    },
    [pushHistorySnapshot],
  );

  // Sync initial fetch into local state & history stack
  useEffect(() => {
    if (initialContent !== undefined && !isLoaded) {
      const init = initialContent ?? '';
      setContent(init);
      historyRef.current = [init];
      historyIndexRef.current = 0;
      setHistory([init]);
      setHistoryIndex(0);
      setIsLoaded(true);
      setSaveStatus('saved');
    }
  }, [initialContent, isLoaded]);

  // Debounced autosave engine
  const saveTimeoutRef = useRef<number | null>(null);
  const pendingSaveTextRef = useRef<string | null>(null);

  // Flush any pending save immediately
  const flushSave = useCallback(() => {
    if (saveTimeoutRef.current) {
      window.clearTimeout(saveTimeoutRef.current);
      saveTimeoutRef.current = null;
    }
    if (pendingSaveTextRef.current !== null) {
      const textToSave = pendingSaveTextRef.current;
      pendingSaveTextRef.current = null;
      setSaveStatus('saving');
      persistRef.current(textToSave).then(
        () => setSaveStatus('saved'),
        () => setSaveStatus('unsaved'),
      );
    }
  }, []);

  // Schedule 750ms debounced autosave
  const saveContent = useCallback(
    (newText: string) => {
      pendingSaveTextRef.current = newText;
      if (saveTimeoutRef.current) {
        window.clearTimeout(saveTimeoutRef.current);
      }
      setSaveStatus('unsaved');

      saveTimeoutRef.current = window.setTimeout(() => {
        flushSave();
      }, 750);
    },
    [flushSave],
  );

  // Flush unsaved edits on component unmount or brand change. Depends only on
  // brandId (mutate is read from a ref) so this cleanup runs solely on real
  // unmount / brand switch — not on every render.
  useEffect(() => {
    return () => {
      if (saveTimeoutRef.current) {
        window.clearTimeout(saveTimeoutRef.current);
      }
      if (pendingSaveTextRef.current !== null) {
        void persistRef.current(pendingSaveTextRef.current);
        pendingSaveTextRef.current = null;
      }
    };
  }, []);

  // Handle user text change with debounced history stack
  const handleChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const nextText = e.target.value;
    setContent(nextText);
    saveContent(nextText);

    const lastChar = nextText.slice(-1);
    if (lastChar === ' ' || lastChar === '\n') {
      pushHistorySnapshot(nextText);
    } else {
      scheduleHistorySnapshot(nextText);
    }
  };

  // Undo action
  const handleUndo = () => {
    if (pendingTextRef.current !== null) {
      pushHistorySnapshot(pendingTextRef.current);
    }

    const curIdx = historyIndexRef.current;
    if (curIdx > 0) {
      const prevIdx = curIdx - 1;
      const prevText = historyRef.current[prevIdx];
      historyIndexRef.current = prevIdx;
      setHistoryIndex(prevIdx);
      setContent(prevText);
      saveContent(prevText);
    }
  };

  // Redo action
  const handleRedo = () => {
    const curIdx = historyIndexRef.current;
    const curStack = historyRef.current;
    if (curIdx < curStack.length - 1) {
      const nextIdx = curIdx + 1;
      const nextText = curStack[nextIdx];
      historyIndexRef.current = nextIdx;
      setHistoryIndex(nextIdx);
      setContent(nextText);
      saveContent(nextText);
    }
  };

  // Keyboard shortcut listener for Ctrl+Z / Ctrl+Y
  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    const isMod = e.ctrlKey || e.metaKey;
    if (isMod && e.key.toLowerCase() === 'z') {
      e.preventDefault();
      if (e.shiftKey) {
        handleRedo();
      } else {
        handleUndo();
      }
    } else if (isMod && e.key.toLowerCase() === 'y') {
      e.preventDefault();
      handleRedo();
    }
  };

  // Copy content to clipboard
  const handleCopy = () => {
    void navigator.clipboard.writeText(content);
    toast.success('Notes copied to clipboard');
  };

  // Metric counts
  const charCount = content.length;
  const wordCount = useMemo(() => {
    const trimmed = content.trim();
    return trimmed ? trimmed.split(/\s+/).length : 0;
  }, [content]);

  return (
    <div className="pd-strategy-notepad-card">
      <div className="pd-strategy-notepad-header">
        <div className="pd-strategy-notepad-title">
          <TitleIcon className="h-3.5 w-3.5 text-accent" />
          <span>{title}</span>
        </div>
        <div className="pd-strategy-notepad-actions">
          {/* Save Status Badge */}
          <div className="pd-strategy-notepad-status">
            <span
              className={`h-1.5 w-1.5 rounded-full ${
                saveStatus === 'saved'
                  ? 'bg-emerald-500'
                  : saveStatus === 'saving'
                    ? 'bg-amber-500 animate-pulse'
                    : 'bg-amber-400'
              }`}
            />
            <span className="text-ink-3 capitalize">
              {saveStatus === 'saved'
                ? 'Saved'
                : saveStatus === 'saving'
                  ? 'Saving...'
                  : 'Unsaved'}
            </span>
          </div>

          {/* Undo */}
          <button
            type="button"
            onClick={handleUndo}
            disabled={historyIndex <= 0}
            title="Undo (Ctrl+Z)"
            className="pd-strategy-notepad-btn"
          >
            <Undo2 className="h-3.5 w-3.5" />
          </button>

          {/* Redo */}
          <button
            type="button"
            onClick={handleRedo}
            disabled={historyIndex >= history.length - 1}
            title="Redo (Ctrl+Y)"
            className="pd-strategy-notepad-btn"
          >
            <Redo2 className="h-3.5 w-3.5" />
          </button>

          {/* Copy */}
          <button
            type="button"
            onClick={handleCopy}
            disabled={!content}
            title="Copy Note"
            className="pd-strategy-notepad-btn"
          >
            <Copy className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>

      <textarea
        value={content}
        onChange={handleChange}
        onKeyDown={handleKeyDown}
        onBlur={flushSave}
        placeholder={placeholder}
        className="pd-strategy-notepad-editor"
      />

      <div className="pd-strategy-notepad-footer">
        <span>
          {wordCount} {footerNoun ?? 'words'}
        </span>
        <span>{charCount} characters</span>
      </div>
    </div>
  );
}

/* ── Sidebar panel switcher (VS-Code-style tabs) ──────────────────────────── */

type StrategyPanelId = 'todo' | 'context' | 'notepad' | 'skills';

/** localStorage key seeding the first-paint panel (per browser); the durable,
 *  cross-device source of truth is users.uiPreferences.strategyActivePanel. */
const PANEL_STORAGE_KEY = 'pd:strategy:active-panel';
const PANEL_PREF_KEY = 'strategyActivePanel';
const PANEL_IDS: StrategyPanelId[] = ['todo', 'context', 'notepad', 'skills'];

const isPanelId = (v: unknown): v is StrategyPanelId =>
  typeof v === 'string' && (PANEL_IDS as string[]).includes(v);

const STRATEGY_PANELS: {
  id: StrategyPanelId;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
}[] = [
  { id: 'todo', label: 'Plan', icon: Brain },
  { id: 'context', label: 'Context', icon: BookText },
  { id: 'notepad', label: 'Note', icon: StickyNote },
  { id: 'skills', label: 'Skills', icon: Wand2 },
];

/** Read the localStorage-seeded panel, defaulting to the first tab ('todo'). */
function readStoredPanel(): StrategyPanelId {
  try {
    const v = window.localStorage.getItem(PANEL_STORAGE_KEY);
    if (isPanelId(v)) return v;
  } catch {
    /* localStorage unavailable — fall through to default */
  }
  return 'todo';
}

type PlanItem = {
  id: string;
  title: string;
  description: string;
  status: string;
  position: number;
};

const STATUS_META: Record<
  string,
  {
    Icon: React.ComponentType<{ className?: string }>;
    cls: string;
    label: string;
  }
> = {
  done: { Icon: CheckCircle2, cls: 'text-emerald-500', label: 'Done' },
  in_progress: { Icon: Loader2, cls: 'text-amber-500', label: 'In progress' },
  pending: { Icon: Circle, cls: 'text-ink-3', label: 'Pending' },
};
const statusMeta = (s: string) => STATUS_META[s] ?? STATUS_META.pending;

/** One plan row in the list view: status + title; click to drill into its detail. */
function PlanRow({ item, onOpen }: { item: PlanItem; onOpen: () => void }) {
  const done = item.status === 'done';
  const { Icon: StatusIcon, cls } = statusMeta(item.status);
  return (
    <div className={`pd-strategy-todo-item ${done ? 'done' : ''}`}>
      <button
        type="button"
        className="pd-strategy-todo-item-head"
        onClick={onOpen}
        title="Open details"
      >
        <StatusIcon className={`h-3.5 w-3.5 shrink-0 ${cls}`} />
        <span className="pd-strategy-todo-item-title">{item.title}</span>
        <ChevronRight className="h-3.5 w-3.5 shrink-0 text-ink-3" />
      </button>
    </div>
  );
}

/** The To-Do list view: the assistant's read-only implementation plan. */
function PlanList({
  items,
  loading,
  onOpen,
}: {
  items: PlanItem[];
  loading: boolean;
  onOpen: (id: string) => void;
}) {
  if (!loading && items.length === 0) {
    return (
      <div className="pd-strategy-todo-empty">
        <ListTodo className="h-6 w-6 text-ink-3" />
        <p className="pd-strategy-todo-empty-title">No plan yet</p>
        <p className="pd-strategy-todo-empty-sub">
          When you ask your strategist to tackle a multi-step task, it lays out
          a plan here and ticks off each step as it works.
        </p>
      </div>
    );
  }
  return (
    <div className="pd-strategy-todo-list">
      {items.map((it) => (
        <PlanRow key={it.id} item={it} onOpen={() => onOpen(it.id)} />
      ))}
    </div>
  );
}

/** The To-Do detail view: one item's full markdown, with a back button. Replaces
 *  the list within the panel rather than expanding inline. */
function PlanDetail({ item, onBack }: { item: PlanItem; onBack: () => void }) {
  const { Icon: StatusIcon, cls, label } = statusMeta(item.status);
  const done = item.status === 'done';
  const body = item.description.trim();
  return (
    <div className="pd-strategy-todo-detail">
      <div className="pd-strategy-todo-detail-bar">
        <button
          type="button"
          className="pd-strategy-todo-back"
          onClick={onBack}
          title="Back to plan"
        >
          <ArrowLeft className="h-3.5 w-3.5" />
          <span>Plan</span>
        </button>
        <span className={`pd-strategy-todo-detail-status ${cls}`}>
          <StatusIcon className="h-3.5 w-3.5" />
          <span>{label}</span>
        </span>
      </div>
      <div className="pd-strategy-todo-detail-body">
        <h3 className={`pd-strategy-todo-detail-title ${done ? 'done' : ''}`}>
          {item.title}
        </h3>
        {body ? (
          <div className="pd-strategy-todo-detail-md">
            <Markdown>{body}</Markdown>
          </div>
        ) : (
          <p className="pd-strategy-todo-detail-empty">
            No further detail for this step.
          </p>
        )}
      </div>
    </div>
  );
}

type SkillMeta = {
  id: string;
  name: string;
  description: string;
  enabled: boolean;
};

/** One skill row: a toggle, its name and description. */
function SkillRow({
  skill,
  onToggle,
  busy,
}: {
  skill: SkillMeta;
  onToggle: (enabled: boolean) => void;
  busy: boolean;
}) {
  return (
    <label className={`pd-strategy-skill ${skill.enabled ? 'on' : ''}`}>
      <input
        type="checkbox"
        className="pd-strategy-skill-check"
        checked={skill.enabled}
        disabled={busy}
        onChange={(e) => onToggle(e.target.checked)}
      />
      <span className="pd-strategy-skill-meta">
        <span className="pd-strategy-skill-name">{skill.name}</span>
        <span className="pd-strategy-skill-desc">{skill.description}</span>
      </span>
    </label>
  );
}

/**
 * Model picker: lets the brand choose which AI provider family powers its
 * strategist. Only rendered when the super-admin has left more than one family
 * enabled (showPicker) — with a single option there's nothing to choose, so it
 * stays hidden. Persisted per-brand via brands.setAiProvider (optimistic flip).
 */
function ModelPicker({ brandId }: { brandId: string }) {
  const trpc = useTRPC();
  const qc = useQueryClient();
  const key = trpc.brands.getAiProvider.queryKey({ brandId });
  const q = useQuery(
    trpc.brands.getAiProvider.queryOptions({ brandId }, { enabled: !!brandId }),
  );
  const setProvider = useMutation(
    trpc.brands.setAiProvider.mutationOptions({
      onMutate: async (vars) => {
        await qc.cancelQueries({ queryKey: key });
        const prev = qc.getQueryData(key);
        qc.setQueryData(key, (old) =>
          old ? { ...old, selected: vars.provider as typeof old.selected } : old,
        );
        return { prev };
      },
      onError: (_err, _vars, cxt) => {
        if (cxt?.prev) qc.setQueryData(key, cxt.prev);
        toast.error("Couldn't switch model — please try again.");
      },
      onSettled: () => void qc.invalidateQueries({ queryKey: key }),
    }),
  );

  const data = q.data;
  if (!data || !data.showPicker) return null;

  return (
    <div className="pd-strategy-model">
      <p className="pd-strategy-skills-intro">Which AI model powers your strategist.</p>
      <div className="pd-strategy-model-seg" role="tablist" aria-label="AI model">
        {data.options.map((o) => (
          <button
            key={o.family}
            type="button"
            role="tab"
            aria-selected={data.selected === o.family}
            className={`pd-strategy-model-opt ${data.selected === o.family ? 'on' : ''}`}
            disabled={setProvider.isPending}
            onClick={() => setProvider.mutate({ brandId, provider: o.family })}
          >
            {o.label}
          </button>
        ))}
      </div>
    </div>
  );
}

/**
 * Skills panel: a checklist of the assistant's skills, all on by default. Turning
 * one off drops its playbook from the strategist and withholds any tool it owns
 * (e.g. switching off Competitor Research also removes web search). Persisted
 * per-brand via brands.setSkillEnabled with an optimistic flip.
 */
function SkillsPanel({ brandId }: { brandId: string }) {
  const trpc = useTRPC();
  const qc = useQueryClient();
  const skillsKey = trpc.brands.getSkills.queryKey({ brandId });
  const skillsQ = useQuery(
    trpc.brands.getSkills.queryOptions({ brandId }, { enabled: !!brandId }),
  );

  const setSkill = useMutation(
    trpc.brands.setSkillEnabled.mutationOptions({
      onMutate: async (vars) => {
        await qc.cancelQueries({ queryKey: skillsKey });
        const prev = qc.getQueryData(skillsKey);
        qc.setQueryData(skillsKey, (old) =>
          old
            ? {
                skills: old.skills.map((s) =>
                  s.id === vars.skillId ? { ...s, enabled: vars.enabled } : s,
                ),
              }
            : old,
        );
        return { prev };
      },
      onError: (_err, _vars, cxt) => {
        if (cxt?.prev) qc.setQueryData(skillsKey, cxt.prev);
        toast.error("Couldn't update that skill — please try again.");
      },
      onSettled: () => void qc.invalidateQueries({ queryKey: skillsKey }),
    }),
  );

  const skills = (skillsQ.data?.skills ?? []) as SkillMeta[];

  return (
    <div
      className="pd-strategy-skills-card"
      role="tabpanel"
      aria-label="Skills"
    >
      {skillsQ.isLoading ? (
        <div className="pd-strategy-todo-empty">
          <Loader2 className="h-5 w-5 animate-spin text-ink-3" />
        </div>
      ) : (
        <div className="pd-strategy-skills-list">
          <ModelPicker brandId={brandId} />
          <p className="pd-strategy-skills-intro">
            Choose what your strategist can do.
          </p>
          {skills.map((s) => (
            <SkillRow
              key={s.id}
              skill={s}
              busy={setSkill.isPending}
              onToggle={(enabled) =>
                setSkill.mutate({ brandId, skillId: s.id, enabled })
              }
            />
          ))}
          <p className="pd-strategy-skills-note">
            Beyond these, your strategist has a set of always-on core abilities such as
            reading and acting on other Prodesk's services that keep it useful and can’t be turned off.
          </p>
        </div>
      )}
    </div>
  );
}

/**
 * Sidebar panel container with a horizontal, VS-Code-like tab strip: the AI-owned
 * To-Do plan (live), a standing Context note, the free-form Notepad, and the
 * Skills checklist. The active tab persists to users.uiPreferences (cross-device),
 * seeded from localStorage for instant first paint. Notepad + Context stay mounted
 * while hidden so their edit buffers / undo history survive a switch.
 */
function StrategyPanels({
  brandId,
  threadId,
}: {
  brandId: string;
  threadId: string | null;
}) {
  const trpc = useTRPC();
  const qc = useQueryClient();
  const { data: me } = useCurrentUser();

  const [panel, setPanel] = useState<StrategyPanelId>(readStoredPanel);

  // Adopt the server-saved panel once (cross-device), unless the user has already
  // picked one this session — their live choice must win over a late server value.
  const pickedRef = useRef(false);
  const savedPanel = (
    me?.uiPreferences as Record<string, unknown> | undefined
  )?.[PANEL_PREF_KEY];
  useEffect(() => {
    if (pickedRef.current) return;
    if (isPanelId(savedPanel)) {
      pickedRef.current = true;
      setPanel(savedPanel);
    }
  }, [savedPanel]);

  const saveUiPref = useMutation(
    trpc.users.updateUiPreference.mutationOptions(),
  );
  const selectPanel = (id: StrategyPanelId) => {
    pickedRef.current = true;
    setPanel(id);
    try {
      window.localStorage.setItem(PANEL_STORAGE_KEY, id);
    } catch {
      /* ignore persistence failures (private mode, quota, etc.) */
    }
    saveUiPref.mutate({ key: PANEL_PREF_KEY, value: id });
  };

  // AI-owned plan (read-only), kept live via the thread's plan_changed broadcast.
  const planQ = useQuery(
    trpc.chat.getAiPlan.queryOptions(
      { threadId: threadId ?? '' },
      { enabled: !!threadId },
    ),
  );
  const planItems = (planQ.data?.items ?? []) as PlanItem[];
  const remaining = planItems.filter((i) => i.status !== 'done').length;

  // Drill-in: the panel shows either the plan list or a single item's detail.
  // Selection survives live plan refreshes; if the item disappears (the plan was
  // rewritten), fall back to the list.
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const selected = selectedId
    ? (planItems.find((i) => i.id === selectedId) ?? null)
    : null;
  useEffect(() => {
    if (selectedId && !planItems.some((i) => i.id === selectedId))
      setSelectedId(null);
  }, [selectedId, planItems]);

  useEffect(() => {
    if (!threadId) return;
    const invalidate = () =>
      void qc.invalidateQueries({
        queryKey: trpc.chat.getAiPlan.queryKey({ threadId }),
      });
    return joinThreadChannel(threadId, {
      onPlanChanged: () => {
        invalidate();
        // When the assistant changes the plan, surface it: switch to the Plan
        // tab if the user is on another panel. Transient view only — don't
        // persist to uiPreferences (mark pickedRef so a late server-pref
        // adoption can't revert it this session).
        pickedRef.current = true;
        setPanel('todo');
      },
      onResync: invalidate,
    });
  }, [threadId, qc, trpc]);

  // Notepad + Context: two instances of the same editor, different brand fields.
  const noteQ = useQuery(
    trpc.brands.getNote.queryOptions({ brandId }, { enabled: !!brandId }),
  );
  const noteMut = useMutation(trpc.brands.updateNote.mutationOptions());
  const ctxQ = useQuery(
    trpc.brands.getContext.queryOptions({ brandId }, { enabled: !!brandId }),
  );
  const ctxMut = useMutation(trpc.brands.updateContext.mutationOptions());

  return (
    <div className="pd-strategy-panels">
      <div
        className="pd-strategy-panel-tabs"
        role="tablist"
        aria-label="Strategy sidebar panels"
      >
        {STRATEGY_PANELS.map((p) => {
          const TabIcon = p.icon;
          const active = panel === p.id;
          const badge = p.id === 'todo' && remaining > 0 ? remaining : null;
          return (
            <button
              key={p.id}
              type="button"
              role="tab"
              aria-selected={active}
              onClick={() => selectPanel(p.id)}
              className={`pd-strategy-panel-tab ${active ? 'active' : ''}`}
            >
              <TabIcon className="h-3.5 w-3.5" />
              <span>{p.label}</span>
              {badge !== null && (
                <span className="pd-strategy-tab-badge">{badge}</span>
              )}
            </button>
          );
        })}
      </div>

      {/* To-Do — the assistant's live implementation plan (read-only). Two levels
          within the panel: the plan list, and a single-item detail screen. */}
      {panel === 'todo' && (
        <div
          className="pd-strategy-todo-card"
          role="tabpanel"
          aria-label="Plan"
        >
          {selected ? (
            <PlanDetail item={selected} onBack={() => setSelectedId(null)} />
          ) : (
            <PlanList
              items={planItems}
              loading={planQ.isLoading}
              onOpen={setSelectedId}
            />
          )}
        </div>
      )}

      {/* Context — a standing note the strategist always has (like an identity). */}
      <div
        hidden={panel !== 'context'}
        className="pd-strategy-panel-body"
        role="tabpanel"
        aria-label="Context"
      >
        <SafeBoundary>
          <TextPanel
            key={`context-${brandId}`}
            title="Context"
            TitleIcon={BookText}
            footerNoun="words"
            placeholder="Add AI constraints here..."
            initialContent={ctxQ.data?.context}
            persist={(content) =>
              ctxMut.mutateAsync({ brandId, context: content })
            }
          />
        </SafeBoundary>
      </div>

      {/* Notepad — kept mounted (hidden) so its buffer survives tab switches */}
      <div
        hidden={panel !== 'notepad'}
        className="pd-strategy-panel-body"
        role="tabpanel"
        aria-label="Notepad"
      >
        <SafeBoundary>
          <TextPanel
            key={`notepad-${brandId}`}
            title="Notepad"
            TitleIcon={FileText}
            footerNoun="words"
            placeholder="Add personal notes here..."
            initialContent={noteQ.data?.content}
            persist={(content) => noteMut.mutateAsync({ brandId, content })}
          />
        </SafeBoundary>
      </div>

      {/* Skills — a checklist of what the strategist is allowed to do. */}
      {panel === 'skills' && (
        <SafeBoundary>
          <SkillsPanel brandId={brandId} />
        </SafeBoundary>
      )}
    </div>
  );
}

export function StrategyTool({
  brand,
  onOpenBilling,
}: {
  brand: Brand;
  onOpenBilling: () => void;
}) {
  const trpc = useTRPC();
  const qc = useQueryClient();
  const { data: me } = useCurrentUser();

  // Sidebar toggle state for responsive/customizable view
  const [showSidebar, setShowSidebar] = useState(true);

  // Subscriptions unlocking feature
  const subsQ = useQuery(
    trpc.featureSubscriptions.myForBrand.queryOptions({ brandId: brand.id }),
  );

  const featureSubs = useMemo(
    () =>
      (subsQ.data?.subscriptions ?? []).filter((s) =>
        s.featureKeys?.includes(AI_FEATURE_KEY),
      ),
    [subsQ.data],
  );
  const planSub = useMemo(
    () => featureSubs.find((s) => s.active) ?? featureSubs[0] ?? null,
    [featureSubs],
  );

  // Chat Identity ("Chat as <brand>")
  const identitiesQ = useQuery(trpc.chat.identities.queryOptions());

  const identity = useMemo<ChatIdentity | null>(
    () =>
      (identitiesQ.data ?? []).find(
        (i) => i.type === 'brand' && i.entityId === brand.id,
      ) ?? null,
    [identitiesQ.data, brand.id],
  );

  // Thread id from brand model; ensure for legacy brands
  const [threadId, setThreadId] = useState<string | null>(
    brand.chatbotThreadId ?? null,
  );

  const ensure = useMutation(trpc.brands.ensureAiThread.mutationOptions());

  // Ensure runs even when the brand already points at a thread: it also
  // reconciles thread membership with the brand's current roster, so a member
  // who joined after the thread was created isn't locked out of their assistant.
  useEffect(() => {
    setThreadId(brand.chatbotThreadId ?? null);
    ensure.mutate(
      { brandId: brand.id },
      {
        onSuccess: (r) => {
          if (r.threadId && r.threadId !== brand.chatbotThreadId) {
            setThreadId(r.threadId);
            void qc.invalidateQueries({
              queryKey: trpc.brands.mine.queryKey(),
            });
          }
        },
      },
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [brand.id, brand.chatbotThreadId]);

  // The MessagePanel hands us its streamed-send fn so a chip click goes through
  // the SAME flow as the composer (streamed reply), not a bare chat.send.
  const aiSendRef = useRef<((text: string) => void) | null>(null);
  const registerAiSend = useCallback((fn: ((text: string) => void) | null) => {
    aiSendRef.current = fn;
  }, []);

  // Streaming state (shared store) — disable chips mid-reply.
  const aiState = useAiThread(threadId ?? '');
  const streaming = aiState.streaming;

  const handleTriggerPrompt = (promptText: string) => {
    if (!threadId || streaming) return;
    if (!aiSendRef.current) {
      toast.error('Your strategist is still loading — try again in a moment.');
      return;
    }
    aiSendRef.current(promptText);
  };

  // Continuations — next-prompt suggestions generated out-of-band after each
  // reply (Strategy only). Persisted on the thread; refreshed live via broadcast.
  const continuationsQ = useQuery(
    trpc.chat.getAiContinuations.queryOptions(
      { threadId: threadId ?? '' },
      { enabled: !!threadId },
    ),
  );
  const continuations = continuationsQ.data?.continuations ?? [];

  useEffect(() => {
    if (!threadId) return;
    const invalidate = () =>
      void qc.invalidateQueries({
        queryKey: trpc.chat.getAiContinuations.queryKey({ threadId }),
      });
    return joinThreadChannel(threadId, {
      onContinuations: invalidate,
      onResync: invalidate,
    });
  }, [threadId, qc, trpc]);

  return (
    <SafeBoundary
      fallback={
        <div className="p-8 text-center text-ink-40">
          Loading strategy workspace...
        </div>
      }
    >
      <main
        data-tool="strategy"
        className={`pd-strategy-container ${!showSidebar ? 'collapsed' : ''}`}
      >
        {/* Left column — full-height context & panels sidebar */}
        {showSidebar && (
          <aside className="pd-strategy-sidebar">
            {/* Brand identity — the record the strategist is grounded on */}
            <div className="pd-strategy-card pd-strategy-brand-card">
              <div className="pd-strategy-brand-id">
                <BrandMark mono={brand.mono} logo={brand.logo} size={42} />
                <div className="pd-strategy-brand-id-meta">
                  <span className="pd-strategy-brand-name">{brand.name}</span>
                  <span className="pd-strategy-brand-type">
                    {brand.type}
                    {brand.peer ? ` · vs ${brand.peer}` : ''}
                  </span>
                </div>
              </div>
              <p className="pd-strategy-brand-grounding">
                <Sparkles className="h-3 w-3 shrink-0 text-accent" />
                <span>
                  Grounded on your live brand record — identity, positioning
                  &amp; market context shape every reply.
                </span>
              </p>
            </div>

            {/* Switchable sidebar panels (Plan / Context / Note / Skills) tabs */}
            <SafeBoundary>
              <StrategyPanels brandId={brand.id} threadId={threadId} />
            </SafeBoundary>
          </aside>
        )}

        {/* Right column — hero, starter bar & AI chat stage stacked together. */}
        <div className="pd-strategy-workspace">
          {/* ── Command Center Hero Header ────────────────────────────────────── */}
          <header className="pd-strategy-hero">
            <div className="pd-strategy-hero-left">
              <div className="pd-strategy-hero-icon">
                <Sparkles className="h-5 w-5 text-accent" />
              </div>
              <div className="pd-strategy-hero-meta">
                <div className="pd-strategy-hero-title">
                  <span>Growth Strategy Command Center</span>
                  <span className="pd-strategy-badge-live">
                    <span className="h-1.5 w-1.5 rounded-full bg-emerald-500 animate-pulse" />
                    AI Strategist Active
                  </span>
                </div>
                <div className="pd-strategy-hero-sub">
                  <span>
                    Chatting as <strong>{brand.name}</strong>
                  </span>
                  <span>•</span>
                  <span className="text-ink-3">
                    Powered by your record & market intelligence
                  </span>
                </div>
              </div>
            </div>

            {/* Right Header Actions */}
            <div className="flex items-center gap-3">
              {/* Plan & Billing Button */}
              <button
                type="button"
                onClick={onOpenBilling}
                title="Manage plan & billing"
                className="group inline-flex items-center gap-2.5 rounded-[var(--r-2)] border border-[color:var(--rule-2)] bg-[color:var(--white)] px-3 py-1.5 text-xs transition-colors hover:bg-[color:var(--paper-2)]"
              >
                <div className="text-left min-w-0">
                  <span className="block text-[9.5px] uppercase tracking-wider text-ink-3">
                    {subsQ.isLoading
                      ? 'Plan'
                      : planSub
                        ? 'Your Plan'
                        : 'No Plan Yet'}
                  </span>
                  <span className="flex items-center gap-1.5 font-semibold text-ink max-w-[180px] truncate text-xs">
                    {planSub && (
                      <span
                        className={`h-2 w-2 rounded-full flex-shrink-0 ${
                          planSub.active ? 'bg-emerald-500' : 'bg-ink-3'
                        }`}
                      />
                    )}
                    {subsQ.isLoading
                      ? '—'
                      : planSub
                        ? planSub.productName
                        : 'Choose a plan'}
                  </span>
                </div>
                <Icon
                  name="chevronRight"
                  size={14}
                  style={{ color: 'var(--ink-3)', flexShrink: 0 }}
                />
              </button>

              {/* Toggle Sidebar */}
              <button
                type="button"
                onClick={() => setShowSidebar((v) => !v)}
                title={
                  showSidebar
                    ? 'Collapse context sidebar'
                    : 'Expand context sidebar'
                }
                className="inline-flex h-9 w-9 items-center justify-center rounded-[var(--r-2)] border border-[color:var(--rule-2)] bg-[color:var(--white)] text-ink-2 transition-colors hover:bg-[color:var(--paper-2)] hover:text-ink"
              >
                {showSidebar ? (
                  <PanelLeftClose className="h-4 w-4" />
                ) : (
                  <PanelLeft className="h-4 w-4" />
                )}
              </button>
            </div>
          </header>

          {/* ── Strategic Quick Starter Bar ───────────────────────────────────── */}
          {/* Continuations (next-prompt suggestions from the last reply) take over
            the bar once available; otherwise the static strategy starters show. */}
          <div className="pd-strategy-starter-bar">
            {continuations.length > 0
              ? continuations.map((text, i) => (
                  <button
                    key={`cont-${i}`}
                    type="button"
                    disabled={streaming || !threadId}
                    onClick={() => handleTriggerPrompt(text)}
                    className="pd-strategy-chip"
                    title={text}
                  >
                    <Sparkles className="h-3.5 w-3.5 text-accent" />
                    <span>{text}</span>
                  </button>
                ))
              : STARTER_PROMPTS.map((item) => {
                  const IconComp = item.icon;
                  return (
                    <button
                      key={item.id}
                      type="button"
                      disabled={streaming || !threadId}
                      onClick={() => handleTriggerPrompt(item.prompt)}
                      className="pd-strategy-chip"
                      title={item.prompt}
                    >
                      <IconComp className="h-3.5 w-3.5 text-accent" />
                      <span>{item.label}</span>
                    </button>
                  );
                })}
          </div>

          {/* Main Stage — AI Chat Thread */}
          <div className="pd-strategy-main-stage">
            {threadId ? (
              <MessagePanel
                key={threadId}
                threadId={threadId}
                threadName="Strategist"
                isAiThread
                surface="strategy"
                registerAiSend={registerAiSend}
                meId={me?.id}
                identity={identity}
                hideSubscribeGate
                hideHeader
                onOpenProject={() => {}}
                onRead={() => {}}
              />
            ) : (
              <div className="grid flex-1 place-items-center p-8 text-center text-sm text-ink-40">
                {ensure.isPending ? (
                  <div className="flex items-center gap-2">
                    <Bot className="h-5 w-5 animate-pulse text-accent" />
                    <span>Setting up your AI growth strategist…</span>
                  </div>
                ) : (
                  <span>Your AI strategist is unavailable right now.</span>
                )}
              </div>
            )}
          </div>
        </div>
      </main>
    </SafeBoundary>
  );
}
