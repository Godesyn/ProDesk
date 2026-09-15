import { Palette } from 'lucide-react';
import { useQuery } from '@tanstack/react-query';
import { useCurrentUser } from '@shared/auth/auth-context';
import { useActiveContext } from '@shared/hooks/use-active-context';
import { useTRPC } from '@shared/lib/trpc';
import { BackendStatus } from './BackendStatus';

/**
 * Placeholder Home for the Design scaffold. Design is user-level, so it fans
 * across ALL the user's accessible brands rather than pinning one. Confirms the
 * trpc.design.* backend router resolves; replace with the real Design experience
 * as that router grows.
 */
export function Home() {
  const { data: user } = useCurrentUser();
  const { brands } = useActiveContext();
  const trpc = useTRPC();
  const overview = useQuery(trpc.design.overview.queryOptions());

  return (
    <div className="mx-auto max-w-3xl px-8 py-12">
      <div className="mb-8 flex items-center gap-3">
        <div className="grid h-10 w-10 place-items-center rounded-lg bg-accent/10 text-accent">
          <Palette className="h-5 w-5" />
        </div>
        <div>
          <h1 className="text-2xl font-semibold text-ink-100">
            Welcome{user?.firstName ? `, ${user.firstName}` : ''}
          </h1>
          <p className="text-sm text-ink-40">Design · Prodesk</p>
        </div>
      </div>

      <div className="rounded-xl border border-ink-8 bg-surface p-6">
        <p className="text-sm text-ink-60">
          This is your Design workspace. It’s user-level — you work across all
          your brands here. The product experience will be built on top.
        </p>

        <p className="mt-6 mb-2 text-xs font-medium uppercase tracking-wide text-ink-40">
          Your brands
        </p>
        {brands.length === 0 ? (
          <p className="text-sm text-ink-60">No brands yet.</p>
        ) : (
          <ul className="flex flex-col gap-2">
            {brands.map((b) => (
              <li
                key={b.id}
                className="flex items-center gap-3 rounded-lg border border-ink-8 px-4 py-3 text-sm text-ink-100"
              >
                <span className="grid h-7 w-7 place-items-center rounded bg-accent/10 text-xs font-semibold text-accent">
                  {b.businessName?.[0]?.toUpperCase() ?? '?'}
                </span>
                {b.businessName}
              </li>
            ))}
          </ul>
        )}

        <div className="mt-5 border-t border-ink-8 pt-4">
          <BackendStatus
            namespace="trpc.design"
            status={overview.status}
            ok={overview.data?.ok}
          />
        </div>
      </div>
    </div>
  );
}
