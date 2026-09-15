import { toast } from 'sonner';

/**
 * Canonical way to turn any thrown value into a human-readable string.
 *
 * tRPC errors arrive with a clean `.message` (the server `errorFormatter`
 * flattens ZodErrors), so most of the time we just read `.message`. This also
 * unwraps plain Errors / strings / unknowns, and — as a safety net — salvages a
 * readable line if a raw stringified ZodError ever slips through (e.g. an error
 * path that bypasses the server formatter).
 */
export function getErrorMessage(err: unknown, fallback = 'Something went wrong'): string {
  const raw =
    typeof err === 'string'
      ? err
      : err instanceof Error
        ? err.message
        : err && typeof err === 'object' && 'message' in err
          ? String((err as { message: unknown }).message)
          : '';
  return salvage(raw) || fallback;
}

/** If a message is actually stringified JSON (e.g. a raw ZodError), pull the first readable line out. */
function salvage(message: string): string {
  const t = (message ?? '').trim();
  if (!t) return '';
  if (t[0] === '[' || t[0] === '{') {
    try {
      const parsed = JSON.parse(t);
      const first = Array.isArray(parsed) ? parsed[0] : parsed;
      const msg = first?.message;
      return typeof msg === 'string' ? msg : '';
    } catch {
      // Not JSON — fall through and use the message as-is.
    }
  }
  return t;
}

/** Show an error toast with a clean message. Prefer this over reading `.message` off a raw error. */
export function toastError(err: unknown, fallback?: string): void {
  toast.error(getErrorMessage(err, fallback));
}
