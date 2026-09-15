/**
 * Lightweight browser-console ring buffer.
 *
 * Installed once at app boot (see `@shared/lib/trpc`, which every frontend
 * imports early). It wraps `console.{log,info,warn,error,debug}` and listens for
 * uncaught `error` / `unhandledrejection` events, keeping only the most recent
 * `MAX_ENTRIES` so memory stays bounded. The original console methods still run
 * untouched — we only *observe*. The captured tail is attached to a support
 * ticket at creation (see `collectSupportDiagnostics`) so admins can see what the
 * customer's browser was logging when they hit "New ticket".
 *
 * Deliberately dependency-free and defensive: any failure while formatting an
 * argument must never break the real console call.
 */

export type CapturedConsoleEntry = {
  level: string;
  message: string;
  at: string;
};

const MAX_ENTRIES = 100;
/** Truncate any single captured message so one giant object can't bloat the buffer. */
const MAX_MESSAGE_LEN = 2000;

const buffer: CapturedConsoleEntry[] = [];
let installed = false;

/** Safely stringify a single console argument without throwing. */
function formatArg(arg: unknown): string {
  if (typeof arg === 'string') return arg;
  if (arg instanceof Error) return `${arg.name}: ${arg.message}`;
  if (arg === null) return 'null';
  if (arg === undefined) return 'undefined';
  try {
    return JSON.stringify(arg);
  } catch {
    try {
      return String(arg);
    } catch {
      return '[unserializable]';
    }
  }
}

function push(level: string, args: unknown[]) {
  let message = args.map(formatArg).join(' ');
  if (message.length > MAX_MESSAGE_LEN) {
    message = `${message.slice(0, MAX_MESSAGE_LEN)}… [truncated]`;
  }
  buffer.push({ level, message, at: new Date().toISOString() });
  if (buffer.length > MAX_ENTRIES) buffer.shift();
}

/**
 * Begin capturing console output + uncaught errors. Idempotent and a no-op
 * outside the browser (SSR / tests). Call as early as possible so logs that
 * precede opening the Support screen are still captured.
 */
export function installConsoleCapture(): void {
  if (installed || typeof window === 'undefined') return;
  installed = true;

  const levels = ['log', 'info', 'warn', 'error', 'debug'] as const;
  for (const level of levels) {
    const original = console[level] as (...args: unknown[]) => void;
    if (typeof original !== 'function') continue;
    console[level] = ((...args: unknown[]) => {
      try {
        push(level, args);
      } catch {
        /* never let capture break logging */
      }
      original.apply(console, args);
    }) as typeof console.log;
  }

  window.addEventListener('error', (e) => {
    push('exception', [e.message, e.filename ? `(${e.filename}:${e.lineno}:${e.colno})` : '']);
  });
  window.addEventListener('unhandledrejection', (e) => {
    push('rejection', [(e.reason as Error)?.message ?? e.reason]);
  });
}

/** A snapshot copy of the most-recent captured console entries. */
export function getCapturedConsoleLog(): CapturedConsoleEntry[] {
  return buffer.slice();
}
