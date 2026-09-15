import { createTRPCClient, httpBatchLink } from '@trpc/client';
import { createTRPCContext } from '@trpc/tanstack-react-query';
import superjson from 'superjson';
import type { AppRouter } from '@server/trpc/router';
import { supabase } from './supabase';
import { PRODESK_CLIENT } from './client-id';
import { API_URL } from './env';
import { installConsoleCapture } from './console-capture';

// Start buffering console output at app boot (every frontend imports this
// module early to build its tRPC client), so support-ticket diagnostics can
// include what the browser was logging before the ticket was opened.
installConsoleCapture();

export const apiUrl = API_URL;

export const { TRPCProvider, useTRPC, useTRPCClient } =
  createTRPCContext<AppRouter>();

/** Shared vanilla client for non-React call sites (e.g. storage helpers). */
let _vanilla: ReturnType<typeof makeTrpcClient> | null = null;
export function trpcVanilla() {
  if (!_vanilla) _vanilla = makeTrpcClient();
  return _vanilla;
}

export function makeTrpcClient() {
  return createTRPCClient<AppRouter>({
    links: [
      httpBatchLink({
        url: `${apiUrl}/trpc`,
        transformer: superjson,
        async headers() {
          const { data } = await supabase.auth.getSession();
          const token = data.session?.access_token;
          const headers: Record<string, string> = {
            'x-client-origin': typeof window !== 'undefined' ? window.location.origin : '',
            'x-prodesk-client': PRODESK_CLIENT,
          };
          if (token) headers.Authorization = `Bearer ${token}`;
          return headers;
        },
      }),
    ],
  });
}
