import { QueryClient, QueryCache, MutationCache } from '@tanstack/react-query';
import { supabase } from './supabase';

/** True for a tRPC/HTTP error that means "your session is no longer valid". */
function isUnauthorized(err: unknown): boolean {
  const e = err as { data?: { code?: string; httpStatus?: number } } | null;
  return e?.data?.code === 'UNAUTHORIZED' || e?.data?.httpStatus === 401;
}

// A 401 from any query or mutation means the token is dead (expired / revoked).
// Sign out so the Supabase session clears → onAuthStateChange fires → the app
// re-renders into the unauthenticated Switch and lands on /login, instead of
// leaving the user stranded on a loading screen waiting for a query that can
// never succeed.
function signOutOnUnauthorized(err: unknown) {
  if (isUnauthorized(err)) void supabase.auth.signOut();
}

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      // Refetch stale queries when the tab regains focus — the catch-up net under
      // realtime. postgres_changes has no replay, so anything that changed while
      // the tab was hidden/asleep (socket throttled or dropped) would otherwise
      // stay stale until a remount. staleTime bounds the cost: only queries older
      // than 30s refetch, and only ones actively on screen.
      refetchOnWindowFocus: true,
      // Keep the previous single retry for transient failures, but never retry
      // a 401 — there's no point, and it only delays the redirect to login.
      retry: (count, err) => !isUnauthorized(err) && count < 1,
    },
  },
  queryCache: new QueryCache({ onError: signOutOnUnauthorized }),
  mutationCache: new MutationCache({ onError: signOutOnUnauthorized }),
});
