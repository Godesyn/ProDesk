import { Messenger } from '../components/Messenger';

/**
 * `/` — the inbox with no conversation selected.
 *
 * Both this and the thread route render the same `<Messenger>`, so the list keeps
 * its scroll position and its realtime subscription as you move between
 * conversations rather than being torn down on every navigation.
 */
export function Inbox() {
  return <Messenger threadId={null} />;
}
