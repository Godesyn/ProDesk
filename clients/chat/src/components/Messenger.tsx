import { lazy, Suspense, useEffect, useState } from 'react';
import { useLocation } from 'wouter';
import { EmptyState, LiveButton, Spec } from './primitives';
import { InboxPane } from './inbox/InboxPane';
import { Room } from './thread/Room';
import { useChatMe } from '../app/ChatProvider';
import { readSearch } from '../app/routes';

const NewChatDialog = lazy(() =>
  import('./inbox/NewChatDialog').then((m) => ({ default: m.NewChatDialog })),
);
const MediaViewer = lazy(() =>
  import('./media/MediaViewer').then((m) => ({ default: m.MediaViewer })),
);

/**
 * The two-pane shell, shared by `/` and `/t/:threadId`.
 *
 * Both routes render THIS, so the list is never unmounted and remounted as you
 * move between conversations — which is what keeps its scroll position, its
 * section collapse state and its realtime subscription intact.
 *
 * Below 900px the two panes become two screens: `/` is the list, `/t/:id` is the
 * room, and Back returns to the list. The router does not branch twice for that;
 * this component decides from one media query.
 */
export function Messenger({
  threadId,
  view = 'inbox',
}: {
  threadId: string | null;
  /** 'archived' points the list pane at the archive instead of the inbox. */
  view?: 'inbox' | 'archived';
}) {
  const { isMobile } = useChatMe();
  const [, navigate] = useLocation();
  const [newOpen, setNewOpen] = useState(false);
  const [mediaMessageId, setMediaMessageId] = useState<string | null>(null);

  const showList = !isMobile || !threadId;
  const showRoom = !isMobile || !!threadId;

  // The media viewer lives in the URL (`?v=<messageId>`) so the browser Back
  // button CLOSES it instead of leaving the conversation — the single most
  // reported bug class in every web messenger.
  useEffect(() => {
    const sync = () => setMediaMessageId(readSearch().get('v'));
    sync();
    window.addEventListener('popstate', sync);
    return () => window.removeEventListener('popstate', sync);
  }, [threadId]);

  // ⌘K / Ctrl-K anywhere in the messenger, and ⌘⇧N for a new conversation.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const meta = e.metaKey || e.ctrlKey;
      if (!meta) return;
      if (e.key.toLowerCase() === 'k') {
        e.preventDefault();
        navigate('/search');
      }
      if (e.shiftKey && e.key.toLowerCase() === 'n') {
        e.preventDefault();
        setNewOpen(true);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [navigate]);

  return (
    <div className="flex min-h-0 flex-1">
      {showList && (
        <InboxPane activeId={threadId} onNew={() => setNewOpen(true)} view={view} />
      )}

      {showRoom &&
        (threadId ? (
          <Room key={threadId} threadId={threadId} />
        ) : (
          <div className="hidden min-h-0 flex-1 place-items-center md:grid">
            {view === 'archived' ? (
              <EmptyState line="Archived conversations are filed and silent. Open one to bring it back." />
            ) : (
              <EmptyState
                line="Pick a conversation, or start one."
                action={<LiveButton onClick={() => setNewOpen(true)}>New conversation</LiveButton>}
              />
            )}
          </div>
        ))}

      <Suspense fallback={null}>
        {newOpen && <NewChatDialog open onClose={() => setNewOpen(false)} />}
        {mediaMessageId && threadId && (
          <MediaViewer
            threadId={threadId}
            messageId={mediaMessageId}
            onClose={() => {
              // Back, not a replace: the viewer was pushed onto history when it
              // opened, so unwinding it is what keeps the button honest.
              window.history.back();
              setMediaMessageId(null);
            }}
          />
        )}
      </Suspense>
    </div>
  );
}

/** Shown while a lazy screen loads. */
export function PaneLoading() {
  return (
    <div className="grid min-h-0 flex-1 place-items-center">
      <Spec>Loading…</Spec>
    </div>
  );
}
