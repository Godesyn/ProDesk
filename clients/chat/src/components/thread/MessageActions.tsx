import { useEffect } from 'react';
import {
  Copy,
  CornerUpLeft,
  CornerUpRight,
  Download,
  Pencil,
  SmilePlus,
  Trash2,
} from 'lucide-react';
import { toast } from 'sonner';
import { QUICK } from '../../lib/emoji';
import { downloadFile } from '@shared/lib/download';
import type { RowMessage } from './MessageRow';

/**
 * WHAT YOU CAN DO TO A MESSAGE, ON A PHONE.
 *
 * Every one of these actions already existed — react, reply, forward, copy,
 * edit, delete — and on a touch device NONE of them was reachable. They live in
 * a toolbar that appears on hover, and a phone has no hover: the whole set was
 * desktop-only by accident. That is not a missing polish item, it is half the
 * product being invisible to most of the people using it.
 *
 * So: press and hold a message (or right-click one, which is the same gesture
 * with a mouse) and this comes up from the bottom edge. A bottom sheet rather
 * than a popover anchored to the bubble, because the bubble may be at the top of
 * the screen and the thumb is always at the bottom — and because a sheet can be
 * dismissed by the same downward flick that dismisses one everywhere else on the
 * device.
 *
 * The reactions sit in a row across the top, at full tap size, because reacting
 * is the single most common thing anyone does to a message and it should cost
 * one press-and-release rather than a press, a read, and a choice.
 */
export function MessageActionSheet({
  message,
  mine,
  canEdit,
  onReact,
  onOpenPicker,
  onReply,
  onForward,
  onEdit,
  onDelete,
  onClose,
}: {
  message: RowMessage;
  mine: boolean;
  canEdit: boolean;
  onReact: (emoji: string) => void;
  onOpenPicker: () => void;
  onReply: () => void;
  onForward: () => void;
  onEdit: () => void;
  onDelete: () => void;
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

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center"
      style={{ background: 'var(--room-scrim)' }}
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
      role="dialog"
      aria-modal="true"
      aria-label="Message actions"
    >
      <div
        className="cx-pop w-full max-w-[480px] rounded-t-[var(--radius-lg)] sm:mb-4 sm:rounded-[var(--radius-lg)]"
        style={{
          border: '1px solid var(--wire-2)',
          paddingBottom: 'calc(0.5rem + env(safe-area-inset-bottom, 0px))',
        }}
      >
        {/* The grabber. It does not do anything — the scrim behind it is what
            closes the sheet — but its absence is what makes a panel that slides
            up from the bottom edge read as stuck rather than dismissible. */}
        <span className="mx-auto my-2 block h-1 w-9 rounded-full" style={{ background: 'var(--wire-2)' }} />

        <div className="flex items-center justify-between gap-1 px-3 pb-3 pt-1">
          {QUICK.slice(0, 5).map((emoji) => (
            <button
              key={emoji}
              type="button"
              onClick={act(() => onReact(emoji))}
              aria-label={`React ${emoji}`}
              className="press grid h-11 w-11 place-items-center rounded-full text-[24px]"
            >
              {emoji}
            </button>
          ))}
          <button
            type="button"
            onClick={act(onOpenPicker)}
            aria-label="More reactions"
            className="press grid h-11 w-11 place-items-center rounded-full"
            style={{ background: 'var(--room-3)', color: 'var(--voice-2)' }}
          >
            <SmilePlus className="h-5 w-5" />
          </button>
        </div>

        <div style={{ borderTop: '1px solid var(--wire)' }}>
          <Row Icon={CornerUpLeft} label="Reply" onClick={act(onReply)} />
          <Row Icon={CornerUpRight} label="Forward" onClick={act(onForward)} />
          {message.content && (
            <Row
              Icon={Copy}
              label="Copy text"
              onClick={act(() => {
                void navigator.clipboard?.writeText(message.content ?? '');
                toast.success('Copied.');
              })}
            />
          )}
          {message.fileUrl && (
            <Row
              Icon={Download}
              label={`Save ${message.fileName ?? 'attachment'}`}
              onClick={act(() => void downloadFile(message.fileUrl ?? '', message.fileName))}
            />
          )}
          {mine && canEdit && message.type === 'text' && (
            <Row Icon={Pencil} label="Edit" onClick={act(onEdit)} />
          )}
          {mine && <Row Icon={Trash2} label="Delete" danger onClick={act(onDelete)} />}
        </div>

        <button
          type="button"
          onClick={onClose}
          className="press w-full py-3.5 text-[15px] font-semibold"
          style={{ borderTop: '1px solid var(--wire)', color: 'var(--voice-2)' }}
        >
          Cancel
        </button>
      </div>
    </div>
  );
}

function Row({
  Icon,
  label,
  danger,
  onClick,
}: {
  Icon: typeof Copy;
  label: string;
  danger?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      // 52px, not 44: this is a list of one-tap destinations reached with a
      // thumb at the bottom of a phone, where the minimum is the floor and not
      // the target.
      className="press flex h-[52px] w-full items-center gap-3.5 px-5 text-left"
      style={{ color: danger ? 'var(--danger)' : 'var(--voice)' }}
    >
      <Icon className="h-[18px] w-[18px] shrink-0" />
      <span className="text-[15px]">{label}</span>
    </button>
  );
}
