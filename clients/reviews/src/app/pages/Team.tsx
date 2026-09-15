/* Verdiict — Team. Brand staff are ONE team shared across every Prodesk frontend,
 * so this page lists ALL the brand's teammates — including people invited from
 * another tool (Links, Payments, …) who don't yet have Reviews access. For each
 * teammate you can grant/revoke this tool's access and switch their role (Reviews
 * Editor / Reviews Viewer) without leaving the app; other brand permissions stay
 * managed in Prodesk. Inviting a brand-new teammate here seeds them with Reviews
 * access. Listing/managing requires `staffManagement` (owners always qualify), so
 * the whole page is gated on it. Mirrors clients/links' SettingsTeam; see
 * docs/permissions.md "Cross-frontend team". */
import { useMemo, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useCurrentUser } from '@shared/auth/auth-context';
import { useTRPC } from '@shared/lib/trpc';
import { Plus } from 'lucide-react';
import { Modal, Seg, SkeletonRows, EmptyState } from '../components';
import type { PageProps } from '../lib';
import { useToast } from '../toast';

type ReviewsRole = 'editor' | 'viewer';

/** A staff member's reviews role from their permission list (null = no access). */
function reviewsRole(perms: readonly string[]): ReviewsRole | null {
  if (perms.includes('reviews')) return 'editor';
  if (perms.includes('reviewsViewer')) return 'viewer';
  return null;
}
/** Set/replace the reviews permission, preserving any non-reviews permissions. */
function withReviewsRole(
  perms: readonly string[],
  role: ReviewsRole,
): string[] {
  return [
    ...withoutReviews(perms),
    role === 'editor' ? 'reviews' : 'reviewsViewer',
  ];
}
/** Strip the reviews permissions, keeping everything else (revokes access only). */
function withoutReviews(perms: readonly string[]): string[] {
  return perms.filter((p) => p !== 'reviews' && p !== 'reviewsViewer');
}

const EMAIL_RE = /.+@.+\..+/;

export function Team({ brandId }: PageProps) {
  const trpc = useTRPC();
  const qc = useQueryClient();
  const toast = useToast();
  const { data: user } = useCurrentUser();

  const isOwner = user?.role === 'brandOwner';
  const canManage =
    isOwner || (user?.permissions ?? []).includes('staffManagement');

  const [inviting, setInviting] = useState(false);
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<ReviewsRole>('editor');
  // Two-step removal in ONE dialog: `managing` opens it; `confirmRemove` swaps
  // its contents from the "Remove access / Remove team member" choice to the
  // whole-suite confirmation.
  const [managing, setManaging] = useState<{
    id: string;
    email: string;
    permissions: readonly string[];
  } | null>(null);
  const [confirmRemove, setConfirmRemove] = useState(false);
  const closeManage = () => {
    setManaging(null);
    setConfirmRemove(false);
  };

  const list = useQuery({
    ...trpc.staff.list.queryOptions({
      orgType: 'brand',
      orgId: brandId,
      limit: 100,
      offset: 0,
    }),
    enabled: canManage,
  });

  // Show EVERY current teammate (not just those with reviews access), so a manager
  // can see who was added from another tool and grant them Reviews access here.
  // Removed rows are soft-deleted (status→'removed') but keep their permissions
  // array, so exclude them explicitly.
  const members = useMemo(
    () => (list.data?.items ?? []).filter((m) => m.status !== 'removed'),
    [list.data],
  );

  const invalidate = () =>
    qc.invalidateQueries({ queryKey: trpc.staff.list.queryKey() });

  const invite = useMutation({
    ...trpc.staff.invite.mutationOptions(),
    onSuccess: () => {
      invalidate();
      toast('Invite sent to ' + email.trim());
      setInviting(false);
      setEmail('');
      setRole('editor');
    },
    onError: (e) => toast('Error: ' + e.message),
  });
  const updatePermissions = useMutation({
    ...trpc.staff.updatePermissions.mutationOptions(),
    onSuccess: () => invalidate(),
    onError: (e) => toast('Error: ' + e.message),
  });
  const remove = useMutation({
    ...trpc.staff.remove.mutationOptions(),
    onSuccess: () => {
      invalidate();
      toast('Removed.');
    },
    onError: (e) => toast('Error: ' + e.message),
  });

  const setPermissions = (id: string, permissions: string[]) =>
    updatePermissions.mutate({ id, permissions: permissions as never });

  return (
    <>
      <div className="vpagehead">
        <div>
          <h1>Team</h1>
          <p>Share your reviews workspace with teammates.</p>
        </div>
        {canManage ? (
          <button
            className="vbtn vbtn-primary"
            onClick={() => setInviting(true)}
          >
            <Plus size={15} />
            Invite
          </button>
        ) : null}
      </div>

      {!canManage ? (
        <div className="vempty">
          <span className="serif">Team is managed by owners.</span>
          <p>
            You need the Team Management permission to invite or manage
            teammates.
          </p>
        </div>
      ) : list.isLoading ? (
        <div className="vcard">
          <SkeletonRows rows={3} />
        </div>
      ) : members.length === 0 ? (
        <EmptyState
          title="No teammates yet."
          body="Invite someone to share the reviews workspace."
          cta="Invite teammate"
          onCta={() => setInviting(true)}
        />
      ) : (
        <div className="vcard" style={{ padding: 0 }}>
          <table className="vtable">
            <thead>
              <tr>
                <th>Name</th>
                <th>Email</th>
                <th>Reviews access</th>
                <th>Status</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {members.map((m) => {
                const r = reviewsRole(m.permissions);
                const name = [m.firstName, m.lastName]
                  .filter(Boolean)
                  .join(' ');
                return (
                  <tr key={m.id} style={{ cursor: 'default' }}>
                    <td style={{ fontWeight: 600 }}>
                      {name || <span className="vmuted">Invited</span>}
                    </td>
                    <td className="vmuted">{m.email}</td>
                    <td>
                      {r ? (
                        <select
                          className="vinput"
                          style={{
                            width: 'auto',
                            padding: '4px 8px',
                            fontSize: 12.5,
                          }}
                          value={r}
                          disabled={updatePermissions.isPending}
                          onChange={(e) =>
                            setPermissions(
                              m.id,
                              withReviewsRole(
                                m.permissions,
                                e.target.value as ReviewsRole,
                              ),
                            )
                          }
                        >
                          <option value="editor">Reviews Editor</option>
                          <option value="viewer">Reviews Viewer</option>
                        </select>
                      ) : (
                        <button
                          className="vbtn vbtn-quiet vbtn-sm"
                          disabled={updatePermissions.isPending}
                          onClick={() =>
                            setPermissions(
                              m.id,
                              withReviewsRole(m.permissions, 'editor'),
                            )
                          }
                        >
                          <Plus size={13} />
                          Grant access
                        </button>
                      )}
                    </td>
                    <td>
                      <span className="vmuted" style={{ fontSize: 12.5 }}>
                        {m.status === 'active' ? 'Active' : 'Invite sent'}
                      </span>
                    </td>
                    <td style={{ textAlign: 'right' }}>
                      {r ? (
                        <button
                          className="vbtn vbtn-quiet vbtn-sm"
                          style={{ color: 'var(--v-danger)' }}
                          disabled={updatePermissions.isPending}
                          onClick={() =>
                            setManaging({
                              id: m.id,
                              email: m.email,
                              permissions: m.permissions,
                            })
                          }
                        >
                          Remove access
                        </button>
                      ) : (
                        <button
                          className="vbtn vbtn-quiet vbtn-sm"
                          style={{ color: 'var(--v-danger)' }}
                          disabled={remove.isPending}
                          onClick={() => {
                            setManaging({
                              id: m.id,
                              email: m.email,
                              permissions: m.permissions,
                            });
                            setConfirmRemove(true);
                          }}
                        >
                          Remove
                        </button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {managing &&
        (confirmRemove ? (
          <Modal title="Remove team member?" onClose={closeManage}>
            <p className="vmuted" style={{ marginTop: 0 }}>
              {managing.email} will be removed from this brand — you’ll be
              removing their access to all of the Prodesk suite, not just
              Reviews.
            </p>
            <div
              style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}
            >
              <button className="vbtn vbtn-quiet" onClick={closeManage}>
                Cancel
              </button>
              <button
                className="vbtn vbtn-primary"
                style={{
                  background: 'var(--v-danger)',
                  borderColor: 'var(--v-danger)',
                }}
                disabled={remove.isPending}
                onClick={() => {
                  remove.mutate({ id: managing.id });
                  closeManage();
                }}
              >
                Remove team member
              </button>
            </div>
          </Modal>
        ) : (
          <Modal title="Remove access" onClose={closeManage}>
            <p className="vmuted" style={{ marginTop: 0 }}>
              {managing.email} — choose what to remove.
            </p>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              <button
                type="button"
                disabled={updatePermissions.isPending}
                style={{
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 2,
                  textAlign: 'left',
                  padding: '10px 14px',
                  border: '1px solid var(--v-border, rgba(0,0,0,0.12))',
                  borderRadius: 8,
                  background: 'transparent',
                  cursor: 'pointer',
                }}
                onClick={() => {
                  setPermissions(
                    managing.id,
                    withoutReviews(managing.permissions),
                  );
                  closeManage();
                }}
              >
                <span style={{ fontWeight: 600 }}>Remove Reviews access</span>
                <span className="vmuted" style={{ fontSize: 12 }}>
                  Stays on the team — loses this app only
                </span>
              </button>
              <button
                type="button"
                disabled={remove.isPending}
                style={{
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 2,
                  textAlign: 'left',
                  padding: '10px 14px',
                  border: '1px solid var(--v-danger)',
                  borderRadius: 8,
                  background: 'transparent',
                  cursor: 'pointer',
                }}
                onClick={() => setConfirmRemove(true)}
              >
                <span style={{ fontWeight: 600, color: 'var(--v-danger)' }}>
                  Remove team member
                </span>
                <span className="vmuted" style={{ fontSize: 12 }}>
                  Removes them from the whole Prodesk suite
                </span>
              </button>
            </div>
          </Modal>
        ))}

      {inviting && (
        <Modal title="Invite to Reviews" onClose={() => setInviting(false)}>
          <p className="vmuted" style={{ marginTop: 0 }}>
            They&rsquo;ll get an email to join this brand&rsquo;s reviews
            workspace. Editors manage locations and reviews; viewers can look
            but not change anything.
          </p>
          <div
            style={{
              display: 'flex',
              flexDirection: 'column',
              gap: 12,
              marginBottom: 18,
            }}
          >
            <input
              className="vinput"
              placeholder="name@business.com.au"
              value={email}
              autoFocus
              onChange={(e) => setEmail(e.target.value)}
            />
            <Seg
              value={role}
              options={[
                { value: 'editor', label: 'Reviews Editor' },
                { value: 'viewer', label: 'Reviews Viewer' },
              ]}
              onChange={setRole}
            />
          </div>
          <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
            <button
              className="vbtn vbtn-quiet"
              onClick={() => setInviting(false)}
            >
              Cancel
            </button>
            <button
              className="vbtn vbtn-primary"
              disabled={!EMAIL_RE.test(email) || invite.isPending}
              onClick={() =>
                invite.mutate({
                  orgType: 'brand',
                  orgId: brandId,
                  email: email.trim(),
                  permissions: [
                    role === 'editor' ? 'reviews' : 'reviewsViewer',
                  ] as never,
                })
              }
            >
              {invite.isPending ? 'Sending…' : 'Send invite'}
            </button>
          </div>
        </Modal>
      )}
    </>
  );
}
