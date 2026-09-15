import { useRoute } from 'wouter';
import { Messenger } from '../components/Messenger';

/**
 * `/t/:threadId` — the same shell as `/`, with a conversation open.
 *
 * On desktop that means both panes; below 900px the list gives way to the room
 * and Back returns to it. `<Messenger>` owns that decision so the router does not
 * have to branch twice for one media query.
 */
export function Thread() {
  const [, params] = useRoute('/t/:threadId');
  return <Messenger threadId={params?.threadId ?? null} />;
}
