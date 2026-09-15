import { toast } from 'sonner';

/**
 * Save an attachment to disk.
 *
 * `<a href={url} download>` does NOT work here and never did. The `download`
 * attribute is ignored for cross-origin URLs, and every attachment lives on the
 * Supabase Storage host rather than ours — so what the app called "Download" was
 * really "open in a new tab", which for a PDF or an image means the browser
 * renders it and the user still has to find their own way to a Save dialog. On a
 * phone that second step frequently doesn't exist at all.
 *
 * So: fetch the bytes, hand the browser a same-origin blob, and let `download`
 * do what it says. Supabase Storage answers with `Access-Control-Allow-Origin:
 * *`, so the fetch is allowed; if it ever isn't, opening the URL is still a
 * better outcome than a dead button, which is what the fallback is for.
 */
export async function downloadFile(url: string, fileName?: string | null): Promise<void> {
  const name = fileName?.trim() || fallbackName(url);
  try {
    const response = await fetch(url, { mode: 'cors', credentials: 'omit' });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const blob = await response.blob();
    const href = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = href;
    anchor.download = name;
    // Must be IN the document for Firefox to honour the click.
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    // One frame, so the download has started before the URL is invalidated.
    setTimeout(() => URL.revokeObjectURL(href), 10_000);
  } catch {
    // A popup blocker can eat this too, hence the toast: a button that appears
    // to do nothing is worse than one that says what it tried.
    const opened = window.open(url, '_blank', 'noopener,noreferrer');
    if (!opened) toast.error('Couldn’t download that file. Try again in a moment.');
  }
}

/** The last path segment, decoded — used when a message carries no file name. */
function fallbackName(url: string): string {
  try {
    const last = new URL(url).pathname.split('/').pop() ?? '';
    // Stored objects are prefixed `<uuid>_<original name>`; show the human half.
    const stripped = decodeURIComponent(last).replace(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}_/i,
      '',
    );
    return stripped || 'attachment';
  } catch {
    return 'attachment';
  }
}
