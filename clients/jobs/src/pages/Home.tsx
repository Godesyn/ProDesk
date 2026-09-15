import { Briefcase } from 'lucide-react';
import { useQuery } from '@tanstack/react-query';
import { useCurrentUser } from '@shared/auth/auth-context';
import { useActiveContext } from '@shared/hooks/use-active-context';
import { useTRPC } from '@shared/lib/trpc';
import { BackendStatus } from './BackendStatus';

/**
 * Placeholder Home for the Jobs scaffold. Confirms the shell, auth, active
 * context AND the trpc.jobs.* backend router all resolve; replace with the real
 * Jobs experience as that router grows.
 */
export function Home() {
  const { data: user } = useCurrentUser();
  const { workspace, role, activeAgency, activeBrand } = useActiveContext();
  const trpc = useTRPC();
  const overview = useQuery(trpc.jobs.overview.queryOptions());
  const contextName =
    activeAgency?.businessName ?? activeBrand?.businessName ?? null;

  return (
    <div className="mx-auto max-w-3xl px-8 py-12">
      <div className="mb-8 flex items-center gap-3">
        <div className="grid h-10 w-10 place-items-center rounded-lg bg-accent/10 text-accent">
          <Briefcase className="h-5 w-5" />
        </div>
        <div>
          <h1 className="text-2xl font-semibold text-ink-100">
            Welcome{user?.firstName ? `, ${user.firstName}` : ''}
          </h1>
          <p className="text-sm text-ink-40">Jobs · Prodesk</p>
        </div>
      </div>

      <div className="rounded-xl border border-ink-8 bg-surface p-6">
        <p className="text-sm text-ink-60">
          This is the Jobs workspace. It’s a multi-role app — use the context
          switcher in the sidebar to change the identity you’re acting as. The
          product experience will be built here.
        </p>
        <dl className="mt-5 grid grid-cols-2 gap-x-6 gap-y-3 text-sm">
          <div>
            <dt className="text-ink-40">Signed in as</dt>
            <dd className="text-ink-100">{user?.email ?? '—'}</dd>
          </div>
          <div>
            <dt className="text-ink-40">Role</dt>
            <dd className="text-ink-100">{role ?? 'none'}</dd>
          </div>
          <div>
            <dt className="text-ink-40">Workspace</dt>
            <dd className="text-ink-100">{workspace ?? '—'}</dd>
          </div>
          <div>
            <dt className="text-ink-40">Context</dt>
            <dd className="text-ink-100">{contextName ?? '—'}</dd>
          </div>
        </dl>
        <div className="mt-5 border-t border-ink-8 pt-4">
          <BackendStatus
            namespace="trpc.jobs"
            status={overview.status}
            ok={overview.data?.ok}
          />
        </div>
      </div>
    </div>
  );
}
