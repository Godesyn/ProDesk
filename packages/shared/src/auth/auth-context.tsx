import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import type { Session } from '@supabase/supabase-js';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '../lib/supabase';
import { useTRPC } from '../lib/trpc';
import { detectReferral } from '../lib/subdomain';
import { captureBetaCode, clearBetaCode } from '../beta/beta-code';

interface AuthState {
  session: Session | null;
  loading: boolean;
}

const AuthContext = createContext<AuthState>({ session: null, loading: true });

export function AuthProvider({ children }: { children: ReactNode }) {
  const trpc = useTRPC();
  const qc = useQueryClient();
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);
  const ensuredFor = useRef<string | null>(null);
  const lastUserId = useRef<string | null>(null);
  const ensureUser = useMutation(trpc.auth.ensureUser.mutationOptions());

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      // Authorize the Realtime socket with the user's JWT before anything
      // subscribes. The app-wide channel (GlobalRealtime) joins the instant the
      // shell mounts; if the socket is still on the anon publishable key at that
      // moment, every RLS-gated postgres_changes event (projects, deliverables,
      // notes, …) is silently dropped for the whole session — so the board/detail
      // only refresh on remount ("updates when I return"). Setting it here, and on
      // every auth change below, keeps the socket's token in lockstep with the
      // session so realtime stays live. Chat appeared to work only because its
      // per-thread channels are created later, after the token had landed.
      supabase.realtime.setAuth(data.session?.access_token ?? null);
      setSession(data.session);
      setLoading(false);
    });
    const { data: sub } = supabase.auth.onAuthStateChange((_event, s) => {
      // Keep the Realtime socket's token synced through login, account switch,
      // token refresh, and logout so RLS-gated changes keep flowing.
      supabase.realtime.setAuth(s?.access_token ?? null);
      setSession(s);
      // tRPC query keys are static (not scoped by user id), so the React Query
      // cache holds the PREVIOUS user's rows across a logout/login: the context
      // selector, agency/brand lists, dashboards, etc. would all flash the old
      // user's data until each query happened to refetch. Wipe the WHOLE cache
      // whenever the identity changes (logout -> null, or switch to a different
      // account) so nothing from the prior session can ever be shown.
      const nextId = s?.user.id ?? null;
      if (nextId !== lastUserId.current) {
        lastUserId.current = nextId;
        qc.clear();
      }
    });
    return () => sub.subscription.unsubscribe();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Provision the app `users` row on first authenticated load. Idempotent on the
  // server, so this safely covers the email-confirmation flow where no session
  // (and thus no provisioning) existed at sign-up time. Guarded per user id so
  // it fires once per session, not on every auth state change.
  useEffect(() => {
    const userId = session?.user.id;
    if (!userId || ensuredFor.current === userId) return;
    ensuredFor.current = userId;
    // Capture the referring agency from the signup URL on first provisioning
    // (subdomain / ?ref=) so non-agency users inherit that agency's theme, plus
    // any `?beta=<code>` stashed on the way in — provisioning is where the beta
    // cohort is stamped, and it's the one point BOTH email/password and Google
    // signups pass through.
    const betaCode = captureBetaCode();
    ensureUser.mutateAsync({ ...detectReferral(), betaCode: betaCode ?? undefined }).then(
      () => {
        // Consumed (granted or refused) — don't let it leak into a later signup
        // from the same browser.
        if (betaCode) clearBetaCode();
        qc.invalidateQueries({ queryKey: trpc.auth.me.queryKey() });
      },
      () => { ensuredFor.current = null; }, // allow retry on a later load if it failed
    );
  }, [session?.user.id]);

  return <AuthContext.Provider value={{ session, loading }}>{children}</AuthContext.Provider>;
}

export function useSession() {
  return useContext(AuthContext);
}

/** The current app user (tRPC auth.me), gated on an active Supabase session. */
export function useCurrentUser() {
  const { session, loading } = useSession();
  const trpc = useTRPC();
  const query = useQuery({
    ...trpc.auth.me.queryOptions(),
    enabled: !loading && !!session,
  });
  return { ...query, sessionLoading: loading, isAuthenticated: !!session };
}

export async function signOut() {
  await supabase.auth.signOut();
}
