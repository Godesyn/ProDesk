/**
 * SignatureCopyButtons — compact icon-button row for copying a signature.
 *
 * Replaces the single "Copy HTML" button with three purpose-built copies:
 *   • Gmail   — rich formatted copy, paste straight into Gmail's signature box
 *   • Outlook — rich formatted copy, paste into Outlook's signature editor
 *   • HTML    — the raw HTML source, as plain text (for devs / manual embeds)
 *
 * Gmail and Outlook share the rich-clipboard path: the generated markup is
 * already email-safe table HTML, so both apps render it identically when the
 * clipboard exposes a `text/html` flavour. Only the guidance (tooltip) differs.
 */

import { useState } from 'react';
import { Check, Code2, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';

/** Copy rich content so pasting yields the rendered signature, not source. */
async function copyRichHtml(html: string): Promise<void> {
  // Preferred: async Clipboard API exposing both HTML and plain-text flavours.
  if (typeof ClipboardItem !== 'undefined' && navigator.clipboard?.write) {
    try {
      await navigator.clipboard.write([
        new ClipboardItem({
          'text/html': new Blob([html], { type: 'text/html' }),
          'text/plain': new Blob([html], { type: 'text/plain' }),
        }),
      ]);
      return;
    } catch {
      /* fall through to the execCommand path */
    }
  }
  // Fallback: select a hidden contentEditable node — preserves rich formatting
  // on browsers without ClipboardItem support.
  const holder = document.createElement('div');
  holder.contentEditable = 'true';
  holder.innerHTML = html;
  holder.style.position = 'fixed';
  holder.style.left = '-9999px';
  holder.style.top = '0';
  document.body.appendChild(holder);
  const range = document.createRange();
  range.selectNodeContents(holder);
  const sel = window.getSelection();
  sel?.removeAllRanges();
  sel?.addRange(range);
  document.execCommand('copy');
  sel?.removeAllRanges();
  document.body.removeChild(holder);
}

/** Copy the raw HTML source as plain text. */
async function copySourceHtml(html: string): Promise<void> {
  try {
    await navigator.clipboard.writeText(html);
  } catch {
    const el = document.createElement('textarea');
    el.value = html;
    el.style.position = 'fixed';
    el.style.left = '-9999px';
    document.body.appendChild(el);
    el.select();
    document.execCommand('copy');
    document.body.removeChild(el);
  }
}

// ── Brand glyphs (inline so they stay theme-independent and self-contained) ──

function GmailIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 48 48" className={className} aria-hidden="true">
      <path fill="#4caf50" d="M45 16.2l-5 2.75-5 4.75L35 40h7a3 3 0 0 0 3-3V16.2z" />
      <path fill="#1e88e5" d="M3 16.2l3.614 1.71L13 23.7V40H6a3 3 0 0 1-3-3V16.2z" />
      <polygon fill="#e53935" points="35,11.2 24,19.45 13,11.2 12,17 13,23.7 24,31.95 35,23.7 36,17" />
      <path fill="#c62828" d="M3 12.298V16.2l10 7.5V11.2L9.876 8.859C6.981 6.689 3 8.757 3 12.298z" />
      <path fill="#fbc02d" d="M45 12.298V16.2l-10 7.5V11.2l3.124-2.341C41.019 6.689 45 8.757 45 12.298z" />
    </svg>
  );
}

function OutlookIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} aria-hidden="true">
      {/* envelope panel */}
      <path fill="#28a8ea" d="M13 7h8.5A1.5 1.5 0 0 1 23 8.5v7A1.5 1.5 0 0 1 21.5 17H13z" />
      <path fill="none" stroke="#fff" strokeWidth="1" strokeLinejoin="round" d="M13.4 8.4 18 11.6l4.6-3.2" />
      {/* blue "O" tile */}
      <rect x="1" y="4.5" width="12.4" height="15" rx="2.4" fill="#0364b8" />
      <ellipse cx="7.2" cy="12" rx="3.2" ry="4" fill="none" stroke="#fff" strokeWidth="2" />
    </svg>
  );
}

interface IconCopyProps {
  icon: React.ReactNode;
  tooltip: string;
  onCopy: () => Promise<void>;
}

function IconCopy({ icon, tooltip, onCopy }: IconCopyProps) {
  const [state, setState] = useState<'idle' | 'loading' | 'done'>('idle');

  const handleClick = async () => {
    if (state === 'loading') return;
    setState('loading');
    try {
      await onCopy();
      setState('done');
      setTimeout(() => setState('idle'), 2000);
    } catch {
      setState('idle');
    }
  };

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          type="button"
          size="icon"
          variant="outline"
          onClick={handleClick}
          disabled={state === 'loading'}
          className={cn('h-8 w-8 transition-transform duration-200', state === 'done' && 'scale-90')}
        >
          {state === 'loading' ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : state === 'done' ? (
            <Check className="h-4 w-4 text-green-600" />
          ) : (
            icon
          )}
        </Button>
      </TooltipTrigger>
      <TooltipContent>{state === 'done' ? 'Copied!' : tooltip}</TooltipContent>
    </Tooltip>
  );
}

export function SignatureCopyButtons({ html }: { html: string }) {
  return (
    <div className="flex items-center gap-1.5">
      <IconCopy
        icon={<GmailIcon className="h-4 w-4" />}
        tooltip="Copy for Gmail — paste into Settings → Signature"
        onCopy={() => copyRichHtml(html)}
      />
      <IconCopy
        icon={<OutlookIcon className="h-4 w-4" />}
        tooltip="Copy for Outlook — paste into the signature editor"
        onCopy={() => copyRichHtml(html)}
      />
      <IconCopy
        icon={<Code2 className="h-4 w-4" />}
        tooltip="Copy HTML source"
        onCopy={() => copySourceHtml(html)}
      />
    </div>
  );
}
