import { Globe } from 'lucide-react';
import { useQuery } from '@tanstack/react-query';
import { useCurrentUser } from '@shared/auth/auth-context';
import { useTRPC } from '@shared/lib/trpc';
import { useWebsitesContext } from '../app/use-context';
import { BackendStatus } from './BackendStatus';

/**
 * Placeholder Home for the Websites scaffold. Confirms the shell, auth, brand
 * context AND the trpc.websites.* backend router all resolve; replace with the
 * real Websites experience as that router grows.
 */
export function Home() {
  const { data: user } = useCurrentUser();
  const { activeBrand } = useWebsitesContext();
  const trpc = useTRPC();
  const overview = useQuery({
    ...trpc.websites.overview.queryOptions({ brandId: activeBrand?.id ?? '' }),
    enabled: !!activeBrand?.id,
  });

  return (
    <div className="mx-auto max-w-3xl px-8 py-12">
      <div className="mb-8 flex items-center gap-3">
        <div className="grid h-10 w-10 place-items-center rounded-lg bg-accent/10 text-accent">
          <Globe className="h-5 w-5" />
        </div>
        <div>
          <h1 className="text-2xl font-semibold text-ink-100">
            {activeBrand?.businessName ?? 'Websites'}
          </h1>
          <p className="text-sm text-ink-40">Websites · Prodesk</p>
        </div>
      </div>

      <div className="rounded-xl border border-ink-8 bg-surface p-6">
        <p className="text-sm text-ink-60">
          This is the Websites workspace for your brand. Switch brands from the
          sidebar. The product experience will be built here.
        </p>
        <dl className="mt-5 grid grid-cols-2 gap-x-6 gap-y-3 text-sm">
          <div>
            <dt className="text-ink-40">Signed in as</dt>
            <dd className="text-ink-100">{user?.email ?? '—'}</dd>
          </div>
          <div>
            <dt className="text-ink-40">Brand</dt>
            <dd className="text-ink-100">{activeBrand?.businessName ?? '—'}</dd>
          </div>
        </dl>
        <div className="mt-5 border-t border-ink-8 pt-4">
          <BackendStatus
            namespace="trpc.websites"
            status={overview.status}
            ok={overview.data?.ok}
          />
        </div>
      </div>
    </div>
  );
}
