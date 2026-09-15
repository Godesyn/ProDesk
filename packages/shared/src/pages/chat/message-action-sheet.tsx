import { useEffect } from 'react';
import { Copy, CornerUpLeft, Download, SmilePlus } from 'lucide-react';
import { toast } from 'sonner';
import { createPortal } from 'react-dom';
import { cn } from '../../lib/utils';
import { downloadFile } from '../../lib/download';
import { QUICK } from './emoji';

/**
 * WHAT YOU CAN DO TO A MESSAGE, ON A PHONE.
 *
 * React, reply and copy all live in a toolbar that appears on `group-hover`, and
 * a touch device has no hover — so on a phone or a tablet none of them was
 * reachable at all. The panel ships inside the dashboard and the floating dock,
 * both of which are used on tablets, so this was not a small gap.
 *
 * Press and hold a message (or right-click it) and this comes up from the bottom
 * edge. A sheet rather than a popover anchored to the bubble, because the bubble
 * may be at the top of the screen and the thumb is always at the bottom.
 *
 * The messenger's twin is `clients/chat/src/components/thread/MessageActions.tsx`
 * — same gesture and the same shared `useLongPress`, different palette and a
 * longer action list (the messenger has forward, edit and delete; the panel does
 * not).
 */
export function MessageActionSheet({
  content,
  fileUrl,
  fileName,
  canReact,
  canReply,
  onReact,
  onOpenPicker,
  onReply,
  onClose,
}: {
  content: string | null;
  fileUrl: string | null;
  fileName: string | null;
  canReact: boolean;
  canReply: boolean;
  onReact: (emoji: string) => void;
  onOpenPicker: () => void;
  onReply: () => void;
  onClose: () => void;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const act = (fn: () => void) => () => {
    onClose();
    fn();
  };

  if (typeof document === 'undefined') return null;
  return createPortal(
    // Portalled to the body: the panel is often a 380px dock with its own
    // overflow, and a sheet rendered inside it would be clipped to the dock
    // rather than sitting over the app.
    <div
      className="fixed inset-0 z-[80] flex items-end justify-center bg-ink-100/40"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
      role="dialog"
      aria-modal="true"
      aria-label="Message actions"
    >
      <div
        className={cn(
          'w-full max-w-[480px] rounded-t-[var(--radius-lg)] border border-[color:var(--color-border-default)] bg-card shadow-3',
          'sm:mb-4 sm:rounded-[var(--radius-lg)]',
          'animate-[reveal_var(--duration-standard)_var(--ease-click)]',
        )}
        style={{ paddingBottom: 'calc(0.5rem + env(safe-area-inset-bottom, 0px))' }}
      >
        {/* The grabber. It does nothing — the scrim closes the sheet — but its
            absence is what makes a panel sliding up from the bottom edge read as
            stuck rather than dismissible. */}
        <span className="mx-auto my-2 block h-1 w-9 rounded-full bg-ink-40/40" />

        {canReact && (
          <div className="flex items-center justify-between gap-1 px-3 pb-3 pt-1">
            {QUICK.slice(0, 5).map((emoji) => (
              <button
                key={emoji}
                type="button"
                onClick={act(() => onReact(emoji))}
                aria-label={`React ${emoji}`}
                className="grid h-11 w-11 place-items-center rounded-full text-[24px] hover:bg-inset"
              >
                {emoji}
              </button>
            ))}
            <button
              type="button"
              onClick={act(onOpenPicker)}
              aria-label="More reactions"
              className="grid h-11 w-11 place-items-center rounded-full bg-inset text-ink-60"
            >
              <SmilePlus className="h-5 w-5" />
            </button>
          </div>
        )}

        <div className="border-t border-[color:var(--color-border-hairline)]">
          {canReply && <Row Icon={CornerUpLeft} label="Reply" onClick={act(onReply)} />}
          {content && (
            <Row
              Icon={Copy}
              label="Copy text"
              onClick={act(() => {
                void navigator.clipboard?.writeText(content);
                toast.success('Copied.');
              })}
            />
          )}
          {fileUrl && (
            <Row
              Icon={Download}
              label={`Save ${fileName ?? 'attachment'}`}
              onClick={act(() => void downloadFile(fileUrl, fileName))}
            />
          )}
        </div>

        <button
          type="button"
          onClick={onClose}
          className="w-full border-t border-[color:var(--color-border-hairline)] py-3.5 text-[15px] font-semibold text-ink-60 hover:bg-inset"
        >
          Cancel
        </button>
      </div>
    </div>,
    document.body,
  );
}

function Row({
  Icon,
  label,
  onClick,
}: {
  Icon: typeof Copy;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      // 52px, not 44: this is a list of one-tap destinations reached with a
      // thumb, where the minimum is the floor and not the target.
      className="flex h-[52px] w-full items-center gap-3.5 px-5 text-left text-ink-100 hover:bg-inset"
    >
      <Icon className="h-[18px] w-[18px] shrink-0" />
      <span className="text-[15px]">{label}</span>
    </button>
  );
}
