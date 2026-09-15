import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
} from 'react';
import { FileText, Film, Loader2, Paperclip, SendHorizonal, SmilePlus, X } from 'lucide-react';
import { toast } from 'sonner';
import { Spec } from '../primitives';
import { GRID } from '../../lib/emoji';
import { usePointerFine } from '../../lib/a11y';
import { readDraft, setDraft, clearDraft } from '../../stores/drafts';
import { fileSize } from '../../lib/format';
import {
  MAX_ATTACHMENT_BYTES,
  nameForPaste,
  releaseAttachment,
  toAttachment,
  uploadAttachment,
  type Attachment,
} from '../../lib/upload';

/**
 * The composer.
 *
 * The single most-used control in the product, so it gets the most care. Four of
 * the behaviours below are the ones that separate a messenger people live in from
 * one they tolerate:
 *
 *  - The IME guard. Without all three checks, every CJK and Vietnamese user sends
 *    half a word every time they press Enter to commit a candidate. This is the
 *    most common serious bug in web chat apps and it is invisible to anyone
 *    testing in English.
 *  - Enter-to-send only on a precise pointer. Mobile keyboards have no Shift, so
 *    on touch Enter must insert a newline and the button must send.
 *  - Drafts that survive a browser restart, held in a module store so a keystroke
 *    re-renders the textarea and nothing else.
 *  - `↑` on an empty composer edits your last message. Free to build, and heavily
 *    used the moment someone discovers it.
 */

type Props = {
  threadId: string;
  placeholder: string;
  disabled?: boolean;
  sending: boolean;
  replyTo: { id: string; senderName: string | null; content: string | null } | null;
  editing: { id: string; content: string } | null;
  onCancelReply: () => void;
  onCancelEdit: () => void;
  onSend: (input: { content: string; attachments: Attachment[] }) => Promise<void> | void;
  onSaveEdit: (content: string) => Promise<void> | void;
  onTyping: () => void;
  /** `↑` on an empty composer — hand back the message to edit, if there is one. */
  onEditLast: () => void;
};

/**
 * What the room can ask of the composer from the outside.
 *
 * Exists for one reason: the drop target is the WHOLE conversation, not the
 * input. Files dropped anywhere in the room have to land in this tray, and the
 * alternative — lifting the attachment queue up into Room — would drag the
 * upload lifecycle, the object URLs and the draft with it, for a feature that
 * needs one verb.
 */
export type ComposerHandle = {
  addFiles: (files: FileList | File[] | null) => void;
  focus: () => void;
};

export const Composer = forwardRef<ComposerHandle, Props>(function Composer(
  {
    threadId,
    placeholder,
    disabled,
    sending,
    replyTo,
    editing,
    onCancelReply,
    onCancelEdit,
    onSend,
    onSaveEdit,
    onTyping,
    onEditLast,
  },
  ref,
) {
  const textarea = useRef<HTMLTextAreaElement>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const composing = useRef(false);
  const pointerFine = usePointerFine();

  const [value, setValue] = useState(() => readDraft(threadId));
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [emojiOpen, setEmojiOpen] = useState(false);

  // Switching threads swaps the draft. The textarea is keyed on threadId by the
  // parent, so this only has to reload the value.
  useEffect(() => {
    setValue(readDraft(threadId));
    setAttachments((prev) => {
      prev.forEach(releaseAttachment);
      return [];
    });
  }, [threadId]);

  useEffect(() => {
    if (editing) {
      setValue(editing.content);
      textarea.current?.focus();
    }
  }, [editing]);

  // Choosing Reply is a commitment to type — so put the cursor where the typing
  // goes. Without this you press Reply, the quote bar appears, and you still have
  // to click into the field before you can say anything.
  useEffect(() => {
    if (replyTo) textarea.current?.focus();
  }, [replyTo?.id]);

  // Autosize on a ResizeObserver rather than per keystroke — measuring on every
  // character is a layout thrash the user can feel on a long message.
  useEffect(() => {
    const el = textarea.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${el.scrollHeight}px`;
  }, [value]);

  /**
   * ATTACHMENTS UPLOAD THE MOMENT THEY ARE ATTACHED, not when you press send.
   *
   * This is what the tray below has always drawn — "Compressing…", "Uploading
   * 47%", "Ready" — and nothing was ever starting it, so every attachment sat at
   * `queued` for ever. Two things followed, and they are the two symptoms:
   * `canSend` needs one `done` attachment to send without any text, so a photo
   * on its own could never be sent; and `submit` only forwards the `done` ones,
   * so attaching a photo, typing a caption and pressing send delivered the
   * caption and silently dropped the photo.
   *
   * Uploading on attach is also what every messenger does, and for a reason: the
   * upload overlaps the time you spend typing the caption, so send is instant
   * instead of being however long the file takes.
   */
  const patchAttachment = (id: string, next: Partial<Attachment>) => {
    // By id, never by index: the tray can be edited while a file is in flight,
    // and a thread switch drops the lot. A patch that finds nothing is correct.
    setAttachments((prev) => prev.map((a) => (a.id === id ? { ...a, ...next } : a)));
  };

  // `sending` is deliberately NOT a condition. Blocking the composer until the
  // previous message is confirmed makes a slow connection feel broken and drops
  // the second message of a two-message thought; the send is optimistic on the
  // other side, so there is nothing to wait for.
  //
  // An upload in flight IS a condition, and only because the room falls back to
  // uploading anything that arrives without a url — sending mid-upload would
  // start a second upload of the same file rather than waiting for this one.
  const uploading = attachments.some((a) => a.phase === 'queued' || a.phase === 'uploading');
  const canSend =
    !disabled &&
    !uploading &&
    (value.trim().length > 0 || attachments.some((a) => a.phase === 'done'));

  const update = (next: string) => {
    setValue(next);
    if (!editing) setDraft(threadId, next);
    if (next) onTyping();
  };

  /**
   * THE FIELD EMPTIES FIRST, then the message goes.
   *
   * This used to `await onSend(...)` before clearing, so the text you had just
   * pressed Enter on sat in the box for the length of an upload and a round trip.
   * That reads as a dropped keystroke, and the reflex is to press Enter again.
   * Everything below the composer is optimistic, so there is nothing to wait for
   * — capture the value, clear, and dispatch.
   */
  const submit = () => {
    if (editing) {
      const trimmed = value.trim();
      if (!trimmed) return;
      setValue('');
      void onSaveEdit(trimmed);
      return;
    }
    if (!canSend) return;
    const content = value.trim();
    // Everything that did not FAIL, rather than only what is `done`: a filter on
    // `done` is what used to drop attachments on the floor, and the room already
    // uploads anything that reaches it without a url. Failures stay behind
    // deliberately — they were reported when they happened, and sending them as
    // empty bubbles would be worse than not sending them.
    const ready = attachments.filter((a) => a.phase !== 'failed');
    setValue('');
    clearDraft(threadId);
    attachments.forEach(releaseAttachment);
    setAttachments([]);
    void onSend({ content, attachments: ready });
  };

  const addFiles = (files: FileList | File[] | null) => {
    if (!files) return;
    const list = Array.from(files);
    const accepted: Attachment[] = [];
    for (const raw of list) {
      const file = nameForPaste(raw);
      if (file.size > MAX_ATTACHMENT_BYTES) {
        toast.error(`${file.name} is too large to send.`);
        continue;
      }
      accepted.push(toAttachment(file));
    }
    if (!accepted.length) return;
    setAttachments((prev) => [...prev, ...accepted]);
    for (const attachment of accepted) {
      void uploadAttachment(threadId, attachment, (patch) =>
        patchAttachment(attachment.id, patch),
      ).catch((e: unknown) => {
        patchAttachment(attachment.id, {
          phase: 'failed',
          error: e instanceof Error ? e.message : 'Upload failed',
        });
        toast.error(`${attachment.file.name} didn't upload.`);
      });
    }
  };

  useImperativeHandle(
    ref,
    () => ({
      addFiles,
      focus: () => textarea.current?.focus(),
    }),
    // `addFiles` is redefined every render (it closes over threadId), so the
    // handle is rebuilt every render too. That is correct and free: the room
    // only ever reads it inside an event handler.
  );

  return (
    // The bottom padding clears the home indicator on a phone. Without the
    // safe-area inset the send button sits under the gesture bar on every
    // notched iPhone, which is where the thumb already is.
    <div
      className="shrink-0 px-3 pt-2 sm:px-4"
      style={{
        background: 'var(--room)',
        paddingBottom: 'calc(0.75rem + env(safe-area-inset-bottom, 0px))',
      }}
    >
      {replyTo && !editing && (
        <div className="cx-quote mb-2 flex items-center gap-3 px-3 py-2">
          <span className="min-w-0 flex-1">
            <Spec>Replying to {replyTo.senderName ?? 'someone'}</Spec>
            <span className="mt-0.5 block truncate text-[13px]" style={{ color: 'var(--voice-2)' }}>
              {replyTo.content ?? 'Attachment'}
            </span>
          </span>
          <button type="button" onClick={onCancelReply} aria-label="Cancel reply" className="press">
            <X className="h-4 w-4" style={{ color: 'var(--voice-3)' }} />
          </button>
        </div>
      )}

      {editing && (
        <div className="mb-2 flex items-center gap-3 px-1">
          <Spec style={{ color: 'var(--live)' }}>Editing</Spec>
          <button
            type="button"
            onClick={() => {
              onCancelEdit();
              setValue(readDraft(threadId));
            }}
            className="press text-[12px]"
            style={{ color: 'var(--voice-3)' }}
          >
            Cancel
          </button>
        </div>
      )}

      {attachments.length > 0 && (
        <AttachmentTray
          attachments={attachments}
          onRemove={(id) =>
            setAttachments((prev) => {
              const target = prev.find((a) => a.id === id);
              if (target) releaseAttachment(target);
              return prev.filter((a) => a.id !== id);
            })
          }
        />
      )}

      <div className="cx-composer flex items-end gap-1 px-2 py-1.5">
        <button
          type="button"
          onClick={() => fileInput.current?.click()}
          disabled={disabled}
          aria-label="Attach a file"
          className="press mb-1 grid h-9 w-9 shrink-0 place-items-center rounded-full"
          style={{ color: 'var(--voice-2)' }}
        >
          <Paperclip className="h-[18px] w-[18px]" />
        </button>
        <input
          ref={fileInput}
          type="file"
          multiple
          className="hidden"
          onChange={(e) => {
            addFiles(e.target.files);
            e.currentTarget.value = '';
          }}
        />

        <textarea
          ref={textarea}
          rows={1}
          value={value}
          disabled={disabled}
          placeholder={placeholder}
          onChange={(e) => update(e.target.value)}
          onPaste={(e) => {
            const files = Array.from(e.clipboardData?.files ?? []);
            if (files.length) {
              e.preventDefault();
              addFiles(files);
            }
          }}
          onCompositionStart={() => {
            composing.current = true;
          }}
          onCompositionEnd={() => {
            composing.current = false;
          }}
          onKeyDown={(e) => {
            if (e.key === 'ArrowUp' && value === '' && !editing) {
              e.preventDefault();
              onEditLast();
              return;
            }
            if (e.key === 'Escape' && editing) {
              e.preventDefault();
              onCancelEdit();
              setValue(readDraft(threadId));
              return;
            }
            if (e.key !== 'Enter' || e.shiftKey) return;
            // THE IME GUARD. All three signals, because none is sufficient alone:
            // Safari does not fire compositionend before keydown, and keyCode 229
            // is the only reliable tell on Android. Miss any one and a CJK user
            // sends a half-finished word every time they commit a candidate.
            if (composing.current || e.nativeEvent.isComposing || e.keyCode === 229) return;
            // On touch, Enter inserts a newline and the button sends — a phone
            // keyboard has no Shift to hold.
            if (!pointerFine) return;
            e.preventDefault();
            submit();
          }}
          className="cx-textarea min-h-[36px] flex-1 py-2"
        />

        <div className="relative mb-1 flex shrink-0 items-center gap-1">
          <button
            type="button"
            onClick={() => setEmojiOpen((v) => !v)}
            aria-label="Emoji"
            className="press grid h-9 w-9 place-items-center rounded-full"
            style={{ color: 'var(--voice-2)' }}
          >
            <SmilePlus className="h-[18px] w-[18px]" />
          </button>
          {emojiOpen && (
            <EmojiGrid
              onPick={(emoji) => {
                update(value + emoji);
                setEmojiOpen(false);
                textarea.current?.focus();
              }}
              onClose={() => setEmojiOpen(false)}
            />
          )}

          {/* The pigment doctrine doing real work: ink and inert while there is
              nothing to send, pigment the instant there is. */}
          <button
            type="button"
            onClick={submit}
            disabled={!canSend && !editing}
            aria-label={editing ? 'Save edit' : 'Send'}
            className="press grid h-9 w-9 place-items-center rounded-full transition-colors"
            style={{
              background: canSend || editing ? 'var(--live)' : 'var(--room-3)',
              color: canSend || editing ? '#fff' : 'var(--voice-3)',
            }}
          >
            {sending ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <SendHorizonal className="h-4 w-4" />
            )}
          </button>
        </div>
      </div>
    </div>
  );
});

/**
 * The queue of things about to be sent.
 *
 * A horizontal strip of tiles rather than a list of rows: attaching five photos
 * is normal and five stacked rows push the composer up off the bottom of a
 * phone. Images and videos show themselves — the preview is the identity of the
 * thing, and a filename is not — and only a document falls back to its name.
 *
 * The progress is drawn as a fill rising through the tile rather than a bar
 * beside it. Originals are now sent whole (see lib/upload.ts), so a photo off a
 * phone is a real upload with a real duration, and the tile filling up reads at
 * a glance from across a room where "63%" does not.
 */
function AttachmentTray({
  attachments,
  onRemove,
}: {
  attachments: Attachment[];
  onRemove: (id: string) => void;
}) {
  return (
    <div className="cx-scroll mb-2 flex gap-2 overflow-x-auto pb-1">
      {attachments.map((a) => {
        const failed = a.phase === 'failed';
        const pending = a.phase === 'queued' || a.phase === 'uploading';
        return (
          <div
            key={a.id}
            className="cx-card relative shrink-0 overflow-hidden"
            style={{ width: 92, height: 92, borderColor: failed ? 'var(--danger)' : undefined }}
          >
            {a.kind === 'image' && a.previewUrl ? (
              <img src={a.previewUrl} alt="" className="h-full w-full object-cover" />
            ) : a.kind === 'video' && a.previewUrl ? (
              // Muted + preload=metadata paints the first frame without ever
              // playing. `playsInline` keeps iOS from hijacking it fullscreen.
              <video
                src={a.previewUrl}
                muted
                playsInline
                preload="metadata"
                className="h-full w-full object-cover"
              />
            ) : (
              <span className="flex h-full w-full flex-col items-center justify-center gap-1.5 px-2">
                {a.kind === 'video' ? (
                  <Film className="h-5 w-5" style={{ color: 'var(--voice-3)' }} />
                ) : (
                  <FileText className="h-5 w-5" style={{ color: 'var(--voice-3)' }} />
                )}
                <span
                  className="w-full truncate text-center text-[10px]"
                  style={{ color: 'var(--voice-2)' }}
                >
                  {a.file.name}
                </span>
              </span>
            )}

            {/* The unsent portion, as a scrim that drains downward. */}
            {pending && (
              <span
                className="absolute inset-x-0 top-0 transition-[height] duration-200"
                style={{
                  height: `${100 - a.percent}%`,
                  background: 'var(--room-scrim)',
                }}
              />
            )}

            <span
              className="absolute inset-x-0 bottom-0 px-1.5 pb-1 pt-3"
              style={{ background: 'linear-gradient(transparent, rgba(0,0,0,0.65))' }}
            >
              <Spec style={{ color: failed ? 'var(--danger)' : '#fff' }}>
                {failed
                  ? 'Failed'
                  : a.phase === 'uploading'
                    ? `${a.percent}%`
                    : a.phase === 'done'
                      ? fileSize(a.file.size) || 'Ready'
                      : 'Queued'}
              </Spec>
            </span>

            <button
              type="button"
              onClick={() => onRemove(a.id)}
              aria-label={`Remove ${a.file.name}`}
              className="press absolute right-1 top-1 grid h-6 w-6 place-items-center rounded-full"
              style={{ background: 'rgba(0,0,0,0.55)', color: '#fff' }}
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
        );
      })}
    </div>
  );
}

function EmojiGrid({
  onPick,
  onClose,
}: {
  onPick: (emoji: string) => void;
  onClose: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [onClose]);

  return (
    <div
      ref={ref}
      // Absolutely positioned and NOT portalled — the shared popover convention
      // here, and the reason this never trips the nested-overlay guard when the
      // composer sits inside a sheet.
      className="cx-pop absolute bottom-11 right-0 z-30 w-[268px] rounded-[var(--radius-md)] p-2"
      style={{ background: 'var(--room-2)', border: '1px solid var(--wire-2)' }}
    >
      <div className="grid grid-cols-8 gap-0.5">
        {GRID.map((emoji) => (
          <button
            key={emoji}
            type="button"
            onClick={() => onPick(emoji)}
            className="press grid h-8 w-8 place-items-center rounded-[var(--radius-sm)] text-[17px]"
          >
            {emoji}
          </button>
        ))}
      </div>
    </div>
  );
}
