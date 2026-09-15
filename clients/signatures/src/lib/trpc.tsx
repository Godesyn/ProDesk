/**
 * Local tRPC React client for the Signatures (SIGKITT) frontend.
 *
 * The ported Manus pages call tRPC with the classic `trpc.x.y.useQuery()` hook
 * style (from `@trpc/react-query`), so this frontend stands up its OWN
 * createTRPCReact client rather than the shared `@shared/lib/trpc` tanstack
 * proxy. It talks to the SAME Prodesk API with the SAME Supabase-bearer auth as
 * every other frontend (identical links to `@shared/lib/trpc`'s makeTrpcClient),
 * and shares the shared QueryClient so cache/invalidation stay consistent. All
 * calls are namespaced under `trpc.signatures.*` (see routers/signatures.ts).
 */
import { useState, type ReactNode } from 'react';
import { createTRPCReact } from '@trpc/react-query';
import { httpBatchLink } from '@trpc/client';
import superjson from 'superjson';
import type { AppRouter } from '@server/trpc/router';
import { supabase } from '@shared/lib/supabase';
import { PRODESK_CLIENT } from '@shared/lib/client-id';
import { API_URL } from '@shared/lib/env';
import { queryClient } from '@shared/lib/queryClient';

export const trpc = createTRPCReact<AppRouter>();

function makeClient() {
  return trpc.createClient({
    links: [
      httpBatchLink({
        url: `${API_URL}/trpc`,
        transformer: superjson,
        async headers() {
          const { data } = await supabase.auth.getSession();
          const token = data.session?.access_token;
          const headers: Record<string, string> = {
            'x-client-origin':
              typeof window !== 'undefined' ? window.location.origin : '',
            'x-prodesk-client': PRODESK_CLIENT,
          };
          if (token) headers.Authorization = `Bearer ${token}`;
          return headers;
        },
      }),
    ],
  });
}

/**
 * Provides the signatures tRPC client. Mount INSIDE the shared `Providers`
 * (main.tsx) — it reuses the shared QueryClient, so a QueryClientProvider is
 * already above it.
 */
export function SignaturesTrpcProvider({ children }: { children: ReactNode }) {
  const [client] = useState(() => makeClient());
  return (
    <trpc.Provider client={client} queryClient={queryClient}>
      {children}
    </trpc.Provider>
  );
}
