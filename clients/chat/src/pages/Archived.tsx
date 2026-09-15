import { useRoute } from 'wouter';
import { Messenger } from '../components/Messenger';

/**
 * `/archived` and `/archived/t/:threadId` — the conversations you filed away.
 *
 * `setArchived` had existed since the messenger shipped and nothing rendered
 * `filter: 'archived'`, so archiving a thread made it disappear with no way back
 * short of the other person writing again. This is that way back.
 *
 * IT HAS ITS OWN THREAD ROUTE, and that is the whole reason this file has two
 * components. Opening an archived conversation at `/t/:id` would leave
 * `/archived`, which drops the rail's Archived tab back to Inbox and swaps the
 * list pane out from under you — you lose the archive the moment you use it.
 * Staying under `/archived/*` keeps the tab lit and the list in place, exactly
 * like opening a conversation from the inbox does.
 *
 * Everything else is reused: the same rows, the same menu (with Archive reading
 * Unarchive), the same search field, the same room. An archived conversation is
 * not a different kind of conversation, it is a quiet one.
 */
export function Archived() {
  const [, params] = useRoute('/archived/t/:threadId');
  return <Messenger threadId={params?.threadId ?? null} view="archived" />;
}
