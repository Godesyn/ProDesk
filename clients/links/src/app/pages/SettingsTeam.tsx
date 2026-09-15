/* Settings → Team. Brand staff are ONE team shared across every Prodesk frontend,
 * so this tab lists ALL the brand's teammates — including people invited from
 * another tool (Reviews, Payments, …) who don't yet have Links access. For each
 * teammate you can grant/revoke this tool's access and switch their role (URL
 * Editor / URL Viewer) without leaving the app; other brand permissions stay
 * managed in Prodesk. Inviting a brand-new teammate here seeds them with Links
 * access. Listing/managing requires `staffManagement` (owners always qualify),
 * so the whole tab is gated on `canManage`. Mirrors clients/reviews' Team; see
 * docs/permissions.md "Cross-frontend team". */
import { useMemo, useState } from 'react';
import { useQuery, useMutation } from '@tanstack/react-query';
import { useTRPC } from '@shared/lib/trpc';
import { Icon, Seg, Modal, SkeletonTable } from '../components';
import { useToast } from '../toast';
import { useLinksInvalidate } from '../use-invalidate';

type UrlRole = 'editor' | 'viewer';

/** A staff member's URL role from their permission list (null = no URL access). */
function urlRole(perms: readonly string[]): UrlRole | null {
  if (perms.includes('links')) return 'editor';
  if (perms.includes('linksViewer')) return 'viewer';
  return null;
}
/** Set/replace the URL permission, preserving any non-URL permissions they hold. */
function withUrlRole(perms: readonly string[], role: UrlRole): string[] {
  return [...withoutUrl(perms), role === 'editor' ? 'links' : 'linksViewer'];
}
/** Strip the URL permissions, keeping everything else (revokes Links access only). */
function withoutUrl(perms: readonly string[]): string[] {
  return perms.filter((p) => p !== 'links' && p !== 'linksViewer');
}

const EMAIL_RE = /.+@.+\..+/;

export function SettingsTeam({
  brandId,
  canManage,
}: {
  brandId: string;
  canManage: boolean;
}) {
  const trpc = useTRPC();
  const toast = useToast();
  const [inviting, setInviting] = useState(false);
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<UrlRole>('editor');
  // Two-step removal in ONE dialog: `managing` opens it; `confirmRemove` swaps
  // its contents from the "Remove access / Remove team member" choice to the
  // whole-suite confirmation. Stored minimally so it survives re-renders.
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

  // Show EVERY current teammate (not just those with URL access), so a manager can
  // see who was added from another tool and grant them Links access here. Removed
  // rows are soft-deleted (status→'removed') but keep their permissions array, so
  // exclude them explicitly.
  const members = useMemo(
    () => (list.data?.items ?? []).filter((m) => m.status !== 'removed'),
    [list.data],
  );

  const { afterTeamChange: invalidate } = useLinksInvalidate();

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

  if (!canManage) {
    return (
      <div className="aempty">
        <div className="serif">Team is managed by owners.</div>
        <p>
          You need the Team Management permission to invite or manage URL staff.
        </p>
      </div>
    );
  }

  return (
    <div>
      <div className="row-between" style={{ marginBottom: 14 }}>
        <p className="mutetext" style={{ margin: 0, fontSize: 13 }}>
          Grant Links access to anyone here — editors create links and switch
          them on, viewers can see links and the numbers but can&rsquo;t change
          anything.
        </p>
        <button
          className="abtn abtn-primary abtn-sm"
          onClick={() => setInviting(true)}
        >
          <Icon name="plus" size={14} />
          Invite
        </button>
      </div>

      {list.isLoading ? (
        <SkeletonTable rows={3} />
      ) : members.length === 0 ? (
        <div className="aempty">
          <div className="serif">No teammates yet.</div>
          <p>Invite someone to share the links workspace.</p>
        </div>
      ) : (
        <table className="atable">
          <thead>
            <tr>
              <th>Name</th>
              <th>Email</th>
              <th>Links access</th>
              <th>Status</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {members.map((m) => {
              const r = urlRole(m.permissions);
              const name =
                m.displayName ||
                [m.firstName, m.lastName].filter(Boolean).join(' ');
              return (
                <tr key={m.id} style={{ cursor: 'default' }}>
                  <td style={{ fontWeight: 600 }}>
                    {name || <span className="mutetext">Invited</span>}
                  </td>
                  <td className="tdest" style={{ maxWidth: 'none' }}>
                    {m.email}
                  </td>
                  <td>
                    {r ? (
                      <select
                        className="ainput"
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
                            withUrlRole(
                              m.permissions,
                              e.target.value as UrlRole,
                            ),
                          )
                        }
                      >
                        <option value="editor">URL Editor</option>
                        <option value="viewer">URL Viewer</option>
                      </select>
                    ) : (
                      <button
                        className="abtn abtn-ghost abtn-sm"
                        disabled={updatePermissions.isPending}
                        onClick={() =>
                          setPermissions(
                            m.id,
                            withUrlRole(m.permissions, 'editor'),
                          )
                        }
                      >
                        <Icon name="plus" size={13} />
                        Grant access
                      </button>
                    )}
                  </td>
                  <td>
                    <span className="mutetext" style={{ fontSize: 12.5 }}>
                      {m.status === 'active' ? 'Active' : 'Invite sent'}
                    </span>
                  </td>
                  <td style={{ textAlign: 'right' }}>
                    {r ? (
                      <button
                        className="abtn abtn-quiet abtn-sm"
                        style={{ color: 'var(--danger)' }}
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
                        className="abtn abtn-quiet abtn-sm"
                        style={{ color: 'var(--danger)' }}
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
      )}

      {managing &&
        (confirmRemove ? (
          <Modal title="Remove team member?" onClose={closeManage}>
            <p className="mutetext" style={{ marginTop: 0 }}>
              {managing.email} will be removed from this brand — you’ll be
              removing their access to all of the Prodesk suite, not just Links.
            </p>
            <div
              style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}
            >
              <button className="abtn abtn-quiet" onClick={closeManage}>
                Cancel
              </button>
              <button
                className="abtn abtn-primary"
                style={{
                  background: 'var(--danger)',
                  borderColor: 'var(--danger)',
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
            <p className="mutetext" style={{ marginTop: 0 }}>
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
                  border: '1px solid var(--border-1)',
                  borderRadius: 8,
                  background: 'transparent',
                  cursor: 'pointer',
                }}
                onClick={() => {
                  setPermissions(managing.id, withoutUrl(managing.permissions));
                  closeManage();
                }}
              >
                <span style={{ fontWeight: 600 }}>Remove Links access</span>
                <span className="mutetext" style={{ fontSize: 12 }}>
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
                  border: '1px solid var(--danger)',
                  borderRadius: 8,
                  background: 'transparent',
                  cursor: 'pointer',
                }}
                onClick={() => setConfirmRemove(true)}
              >
                <span style={{ fontWeight: 600, color: 'var(--danger)' }}>
                  Remove team member
                </span>
                <span className="mutetext" style={{ fontSize: 12 }}>
                  Removes them from the whole Prodesk suite
                </span>
              </button>
            </div>
          </Modal>
        ))}

      {inviting && (
        <Modal title="Invite to Links & QR" onClose={() => setInviting(false)}>
          <p className="mutetext" style={{ marginTop: 0 }}>
            They&rsquo;ll get an email to join this brand&rsquo;s links
            workspace.
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
              className="ainput"
              placeholder="name@business.com.au"
              value={email}
              autoFocus
              onChange={(e) => setEmail(e.target.value)}
            />
            <Seg
              value={role}
              options={[
                { value: 'editor', label: 'URL Editor' },
                { value: 'viewer', label: 'URL Viewer' },
              ]}
              onChange={setRole}
            />
          </div>
          <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
            <button
              className="abtn abtn-quiet"
              onClick={() => setInviting(false)}
            >
              Cancel
            </button>
            <button
              className="abtn abtn-primary"
              disabled={!EMAIL_RE.test(email) || invite.isPending}
              onClick={() =>
                invite.mutate({
                  orgType: 'brand',
                  orgId: brandId,
                  email: email.trim(),
                  permissions: [
                    role === 'editor' ? 'links' : 'linksViewer',
                  ] as never,
                })
              }
            >
              {invite.isPending ? 'Sending…' : 'Send invite'}
            </button>
          </div>
        </Modal>
      )}
    </div>
  );
}
