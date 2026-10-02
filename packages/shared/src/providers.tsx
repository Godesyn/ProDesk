import { useState, type ReactNode } from 'react';
import { QueryClientProvider } from '@tanstack/react-query';
import { Toaster } from 'sonner';
import { queryClient } from './lib/queryClient';
import { TRPCProvider, makeTrpcClient } from './lib/trpc';
import { AuthProvider } from './auth/auth-context';
import { AccentThemeProvider } from './theme/accent-theme';
import { ConfirmProvider } from './components/ui/confirm-dialog';
import { FileViewerProvider } from './components/file-viewer/file-viewer-provider';
import { RadixBodyLockGuard } from './components/radix-body-lock-guard';
import { useEmbedEscape } from './lib/embed';

export function Providers({ children }: { children: ReactNode }) {
  const [trpcClient] = useState(() => makeTrpcClient());
  useEmbedEscape();
  return (
    <QueryClientProvider client={queryClient}>
      <TRPCProvider trpcClient={trpcClient} queryClient={queryClient}>
        <AuthProvider>
          <AccentThemeProvider>
            <ConfirmProvider>
              <FileViewerProvider>
                {children}
                <Toaster richColors position="top-right" />
                {/* Mounted here so EVERY frontend gets it, including any created
                    from clients/_template later. Clears a `pointer-events: none`
                    that a Radix layer left on <body> after unmounting before its
                    deferred cleanup ran — the failure that makes the whole page
                    stop responding to clicks. */}
                <RadixBodyLockGuard />
              </FileViewerProvider>
            </ConfirmProvider>
          </AccentThemeProvider>
        </AuthProvider>
      </TRPCProvider>
    </QueryClientProvider>
  );
}
