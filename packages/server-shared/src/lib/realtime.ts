import { env } from './env.js';

/**
 * Best-effort realtime "tasks changed" ping for a set of users.
 *
 * Each task board is keyed by its assignee. A manager viewing a teammate's board
 * (Team pane) subscribes to the teammate's channel `tasks:<userId>`. Browser
 * table-realtime can't deliver a teammate's task rows to a manager — the
 * `tasks_visible` RLS policy (server/sql/rls.sql) scopes rows to
 * assignee/visibleTo — so this broadcast is the Team pane's only liveness
 * signal. It carries NO data (the client refetches via tRPC, auth-enforced), so
 * the public channel leaks nothing; it is purely a "refetch now" trigger.
 *
 * Sent via the Realtime broadcast REST endpoint (no socket opened from the
 * stateless API server) as a single batched request. Never throws: a failed
 * ping must not fail the originating write — the worst case is the Team pane
 * refreshing on the next interaction instead of live (the pre-existing
 * behaviour).
 */
export async function pingTasksChanged(...userIds: Array<string | null | undefined>): Promise<void> {
  const ids = [...new Set(userIds.filter((v): v is string => !!v))];
  if (!ids.length) return;
  try {
    await fetch(`${env.SUPABASE_URL}/realtime/v1/api/broadcast`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        apikey: env.SUPABASE_SECRET_KEY,
        Authorization: `Bearer ${env.SUPABASE_SECRET_KEY}`,
      },
      body: JSON.stringify({
        messages: ids.map((id) => ({ topic: `tasks:${id}`, event: 'changed', payload: {}, private: false })),
      }),
    });
  } catch {
    // Realtime is a convenience layer — swallow.
  }
}

/**
 * Broadcast a data-less event on a thread's realtime topic (`thread:<id>`). The
 * payload carries nothing — clients refetch via auth-enforced tRPC — so the
 * public channel leaks no content. Never throws (realtime is a convenience layer).
 */
async function broadcastThread(threadId: string, event: string): Promise<void> {
  try {
    await fetch(`${env.SUPABASE_URL}/realtime/v1/api/broadcast`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        apikey: env.SUPABASE_SECRET_KEY,
        Authorization: `Bearer ${env.SUPABASE_SECRET_KEY}`,
      },
      body: JSON.stringify({
        messages: [{ topic: `thread:${threadId}`, event, payload: {}, private: false }],
      }),
    });
  } catch {
    // Realtime is a convenience layer — swallow.
  }
}

/**
 * Signal that a headless AI turn on a chat thread has finished. The client shows
 * the "thinking" spinner while a settlement follow-up turn runs; each round of
 * the turn lands as a normal chat_messages INSERT, and a multi-round turn keeps
 * working (running tools) between those inserts — so the inserts themselves
 * must NOT clear the spinner. This broadcast is the explicit end-of-turn that
 * does. Best-effort: the client also has a failsafe timeout.
 */
export async function pingAiTurnDone(threadId: string): Promise<void> {
  await broadcastThread(threadId, 'ai_done');
}

/**
 * Signal that a thread's continuation suggestions changed, so any surface not
 * driving the current SSE stream (e.g. a headless follow-up finished) refetches
 * the persisted `chat_threads.ai_continuations`.
 */
export async function pingContinuations(threadId: string): Promise<void> {
  await broadcastThread(threadId, 'continuations');
}

/**
 * Signal that a thread's AI to-do plan (`ai_plan_items`) changed, so the Strategy
 * To-Do panel refetches live as the assistant writes/updates/clears it.
 */
export async function pingPlanChanged(threadId: string): Promise<void> {
  await broadcastThread(threadId, 'plan_changed');
}

/**
 * Signal that a thread's metadata changed — renamed, new photo, admin granted.
 * None of that is a chat_messages write, so nothing else would tell the other
 * members' open rooms to refetch the header.
 */
export async function pingThreadChanged(threadId: string): Promise<void> {
  await broadcastThread(threadId, 'thread_changed');
}

/** Someone was added to, removed from, or left the thread. */
export async function pingMembersChanged(threadId: string): Promise<void> {
  await broadcastThread(threadId, 'members_changed');
}

/**
 * "Your inbox changed" on `inbox:<userId>` — the consumer messenger's per-user
 * topic.
 *
 * Everything that happens INSIDE a thread already reaches its members through
 * the `thread:<id>` topic and the chat_messages / chat_thread_members
 * postgres_changes subscriptions. What has no carrier is the moment a thread
 * FIRST appears: a stranger creating a DM with you produces rows in tables you
 * are not yet watching for, in a thread you have never subscribed to. This topic
 * is that carrier, and it also covers the Requests badge.
 *
 * Data-less like every other broadcast here — clients refetch through
 * auth-enforced tRPC, so the public channel leaks nothing, not even the fact of
 * who messaged whom.
 *
 * Events: 'thread_new' | 'request_new' | 'threads_changed'.
 */
export async function pingInbox(
  event: 'thread_new' | 'request_new' | 'threads_changed',
  ...userIds: Array<string | null | undefined>
): Promise<void> {
  const ids = [...new Set(userIds.filter((v): v is string => !!v))];
  if (!ids.length) return;
  try {
    await fetch(`${env.SUPABASE_URL}/realtime/v1/api/broadcast`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        apikey: env.SUPABASE_SECRET_KEY,
        Authorization: `Bearer ${env.SUPABASE_SECRET_KEY}`,
      },
      body: JSON.stringify({
        messages: ids.map((id) => ({ topic: `inbox:${id}`, event, payload: {}, private: false })),
      }),
    });
  } catch {
    // Realtime is a convenience layer — swallow.
  }
}

export async function pingProjectsChanged(agencyId: string | null | undefined, brandId: string | null | undefined): Promise<void> {
  const topics: string[] = [];
  if (agencyId) topics.push(`projects:agency:${agencyId}`);
  if (brandId) topics.push(`projects:brand:${brandId}`);
  if (!topics.length) return;
  
  try {
    await fetch(`${env.SUPABASE_URL}/realtime/v1/api/broadcast`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        apikey: env.SUPABASE_SECRET_KEY,
        Authorization: `Bearer ${env.SUPABASE_SECRET_KEY}`,
      },
      body: JSON.stringify({
        messages: topics.map((topic) => ({ topic, event: 'changed', payload: {}, private: false })),
      }),
    });
  } catch {
    // swallow
  }
}
