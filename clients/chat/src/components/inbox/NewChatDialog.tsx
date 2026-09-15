import { useState } from 'react';
import { X } from 'lucide-react';
import { GhostButton, Spec } from '../primitives';
import { PersonFinder } from './PersonFinder';

/**
 * The modal chrome around `PersonFinder`.
 *
 * Everything that decides whether an address is findable lives in PersonFinder,
 * because the inbox list renders the same control inline when a search matches no
 * conversation. This file is the dialog and nothing else: a scrim, a titled
 * header, and a Cancel button handed to the finder as its secondary action so the
 * two buttons sit on one row instead of in two different components' footers.
 */
export function NewChatDialog({
  open,
  onClose,
  initialEmail = '',
}: {
  open: boolean;
  onClose: () => void;
  initialEmail?: string;
}) {
  // Chip count lives here only to title the dialog ("New conversation" becomes
  // "New group" at two people). The finder owns the chips themselves.
  const [isGroup, setIsGroup] = useState(false);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center px-4 pt-[12vh]"
      style={{ background: 'var(--room-scrim)' }}
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
      role="dialog"
      aria-modal="true"
      aria-label="New conversation"
    >
      <div
        className="cx-pop w-full max-w-md overflow-hidden rounded-[var(--radius-md)]"
        style={{ background: 'var(--room-2)', border: '1px solid var(--wire-2)' }}
        onKeyDown={(e) => {
          if (e.key === 'Escape') onClose();
        }}
      >
        <header
          className="flex items-center justify-between px-5 py-4"
          style={{ borderBottom: '1px solid var(--wire)' }}
        >
          <Spec>{isGroup ? 'New group' : 'New conversation'}</Spec>
          <button type="button" onClick={onClose} aria-label="Close" className="press">
            <X className="h-4 w-4" style={{ color: 'var(--voice-3)' }} />
          </button>
        </header>

        <div className="px-5 pb-5 pt-5">
          <PersonFinder
            initialEmail={initialEmail}
            onStarted={onClose}
            onIsGroupChange={setIsGroup}
            secondaryAction={<GhostButton onClick={onClose}>Cancel</GhostButton>}
          />
        </div>
      </div>
    </div>
  );
}
