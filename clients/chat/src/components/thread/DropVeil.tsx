import { Upload } from 'lucide-react';
import { Spec } from '../primitives';

/**
 * The drop target, which is THE WHOLE CONVERSATION.
 *
 * Not the composer, and not a strip above it. When you drag a file at a chat
 * window you are aiming at the conversation — you are thinking "into here", not
 * "into that input" — and a target the size of a text field means most drops
 * miss and land on the page behind, which in a browser means navigating away
 * from the app to render the file. So the entire room arms, header to composer.
 *
 * `pointer-events: none` is load-bearing: this sits over the element that owns
 * the drag listeners, and a veil that swallowed pointer events would fire
 * `dragleave` on the room the instant it appeared, hiding itself, which fires
 * `dragenter` again — a flicker loop rather than a drop target.
 *
 * Pigment, and this is the one non-presence use of it in the app. The doctrine
 * (index.css) is that colour means SOMEONE IS HERE, with one standing exception
 * already: the send control goes pigment the moment it holds something to send.
 * This is that same exception — a control that is armed and waiting for the
 * release — rather than a new meaning for the colour.
 */
export function DropVeil({ active }: { active: boolean }) {
  if (!active) return null;
  return (
    <div
      className="pointer-events-none absolute inset-0 z-40 flex items-center justify-center p-3"
      style={{ background: 'var(--room-scrim)', backdropFilter: 'blur(2px)' }}
      aria-hidden="true"
    >
      <div
        className="flex h-full w-full flex-col items-center justify-center gap-3 rounded-[var(--radius-lg)]"
        style={{
          border: '2px dashed var(--live)',
          background: 'var(--live-soft)',
        }}
      >
        <span
          className="grid h-12 w-12 place-items-center rounded-full"
          style={{ background: 'var(--live)', color: '#fff' }}
        >
          <Upload className="h-5 w-5" />
        </span>
        <span className="text-[15px] font-semibold" style={{ color: 'var(--voice)' }}>
          Drop to send
        </span>
        {/* The promise this app now makes about attachments, said once, where
            someone is about to rely on it. */}
        <Spec>Any file · sent at full quality</Spec>
      </div>
    </div>
  );
}
