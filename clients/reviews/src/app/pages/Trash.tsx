/* Verdiict — Trash. Soft-deleted locations linger here for a 7-day grace period
 * before permanent removal; restore them while there's time left. */
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useTRPC } from '@shared/lib/trpc';
import { Loader2, RotateCcw } from 'lucide-react';
import { EmptyState, SkeletonRows } from '../components';
import { fmtDate } from '../lib';
import type { PageProps } from '../lib';
import { useToast } from '../toast';

export function Trash(props: PageProps) {
  const { brandId, canEdit } = props;
  const trpc = useTRPC();
  const qc = useQueryClient();
  const toast = useToast();

  const { data: deleted, isLoading, isError } = useQuery(
    trpc.reviews.locations.listDeleted.queryOptions({ brandId }),
  );

  const restore = useMutation({
    ...trpc.reviews.locations.restore.mutationOptions(),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: trpc.reviews.locations.listDeleted.queryKey() });
      qc.invalidateQueries({ queryKey: trpc.reviews.locations.list.queryKey() });
      toast('Location restored.');
    },
    onError: (err) => toast(err.message || "Couldn't restore the location."),
  });

  return (
    <>
      <div className="vpagehead">
        <div>
          <h1>Trash</h1>
          <p>Recently deleted locations, kept for a short grace period.</p>
        </div>
      </div>

      <div className="vbanner accent" style={{ marginBottom: 16 }}>
        Deleted locations are kept for 7 days, then permanently removed. Restore one before its
        grace period runs out.
      </div>

      {isError ? (
        <div className="vcard">
          <span className="vmuted">
            You don't have permission to view deleted locations. Ask a workspace owner or admin.
          </span>
        </div>
      ) : isLoading ? (
        <SkeletonRows />
      ) : !deleted || deleted.length === 0 ? (
        <EmptyState title="Trash is empty" body="Deleted locations will appear here." />
      ) : (
        <table className="vtable">
          <thead>
            <tr>
              <th>Location</th>
              <th>Deleted</th>
              <th>Grace remaining</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {deleted.map((loc) => (
              <tr key={loc.id}>
                <td>
                  <div>{loc.name}</div>
                  <div className="vmuted mono" style={{ fontSize: 12, marginTop: 2 }}>
                    /r/{loc.slug}
                  </div>
                </td>
                <td>{loc.deletedAt ? fmtDate(loc.deletedAt) : '—'}</td>
                <td>
                  {loc.daysRemaining <= 2 ? (
                    <span
                      className="vbadge"
                      style={{
                        background: 'color-mix(in srgb, var(--v-danger) 12%, transparent)',
                        color: 'var(--v-danger)',
                      }}
                    >
                      {loc.daysRemaining} days left
                    </span>
                  ) : (
                    <>{loc.daysRemaining} days left</>
                  )}
                </td>
                <td style={{ textAlign: 'right' }}>
                  {canEdit && (
                    <button
                      className="vbtn vbtn-quiet vbtn-sm"
                      disabled={restore.isPending}
                      onClick={() => restore.mutate({ id: loc.id })}
                    >
                      {restore.isPending && restore.variables?.id === loc.id ? (
                        <>
                          <Loader2 size={14} className="animate-spin" />
                          Restoring…
                        </>
                      ) : (
                        <>
                          <RotateCcw size={14} />
                          Restore
                        </>
                      )}
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </>
  );
}
