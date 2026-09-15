import { router } from '../../trpc/trpc.js';
import { threadProcedures } from './threads.js';
import { messageProcedures } from './messages.js';
import { aiProcedures } from './ai.js';
import { adminProcedures } from './admin.js';
import { consumerProcedures } from './consumer.js';
import { directoryProcedures } from './directory.js';

/**
 * Chat domain router, composed from feature modules:
 *  - threads.ts   — identity selection, thread lists, unread badges, navigation
 *  - messages.ts  — message history, sending, members, read state, edit/delete,
 *                   reactions, search
 *  - ai.ts        — AI feedback + confirm-card outcomes (+ settlement follow-up)
 *  - admin.ts     — super-admin Strategy Feedback console
 *  - consumer.ts  — the messenger (chat.prodesk.com): obligation-ordered inbox,
 *                   DM/group lifecycle, message requests
 *  - directory.ts — finding a person by email address, and refusing to
 *
 * Shared plumbing lives in common.ts (membership guard, keyset cursors, enums)
 * and display.ts (thread name / group label / logo resolution — also used by the
 * digest-email worker). Add a new procedure to the module it belongs to; the
 * client surface stays flat (`trpc.chat.*`).
 *
 * The two surfaces coexist rather than merge. Workspace threads are derived from
 * org relationships and are never listed by the messenger; messenger threads are
 * chosen by people and are never listed by the workspace — see
 * modules/chat/thread-types.ts#CONSUMER_THREAD_TYPES for the one paragraph that
 * explains why that separation is load-bearing rather than tidy.
 */
export const chatRouter = router({
  ...threadProcedures,
  ...messageProcedures,
  ...aiProcedures,
  ...adminProcedures,
  ...consumerProcedures,
  ...directoryProcedures,
});
