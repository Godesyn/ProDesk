/* Prodesk — Team & people (brand staff), wired to the live staff.* tRPC API.
   In a brand-only world this single screen backs both the People power-tool and
   the account "Team" item. Real staff are email + status + a permissions array
   (no seats / display-only), so the screen reflects that model. */

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useTRPC } from '@shared/lib/trpc';
import {
  PERMISSION_GROUPS,
  permissionLabel,
  togglePermission,
} from '@shared/pages/agency/constants';
import type { RouterOutputs, RouterInputs } from '@server/trpc/router';
import { Button, pushToast } from './ui';
import { initials } from './live';
import {
  FndHeader,
  FndToolbar,
  FndFilter,
  FndStatus,
  FndEmpty,
  FndDrawer,
  FndField,
  FndSection,
  FndInput,
  FndModal,
} from './fnd-shared';
import type { Brand, SuiteApp } from './data';

type StaffRow = RouterOutputs['staff']['list']['items'][number];
type StaffPerm =
  RouterInputs['staff']['updatePermissions']['permissions'][number];

function staffName(p: StaffRow): string {
  const full = [p.firstName, p.lastName].filter(Boolean).join(' ').trim();
  return full || p.email;
}
function accessSummary(perms: string[]): string {
  if (!perms || perms.length === 0) return 'No access yet';
  if (perms.length <= 2) return perms.map(permissionLabel).join(', ');
  return `${permissionLabel(perms[0])} + ${perms.length - 1} more`;
}
function fmtDate(d: Date | string | null): string {
  if (!d) return '–';
  try {
    return new Date(d).toLocaleDateString('en-AU', {
      day: 'numeric',
      month: 'short',
    });
  } catch {
    return '–';
  }
}

/* ---- permission picker (toggle chips) ----
   Every brand permission the Prodesk staff editor exposes, grouped by the
   frontend it unlocks. Rendered straight from the shared PERMISSION_GROUPS.brand
   catalog (a subset of the server enum they ship with), so this stays in lockstep
   with Prodesk, picks up new tools automatically, and never collapses to a near-
   empty list while a network query is loading. */
function PermPicker({
  value,
  onChange,
}: {
  value: string[];
  onChange: (v: string[]) => void;
}) {
  const groups = PERMISSION_GROUPS.brand;
  const toggle = (perm: string) =>
    onChange([...togglePermission(new Set(value), perm)]);
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      {groups.map((g) => (
        <div key={g.title}>
          <span
            className="eyebrow"
            style={{ display: 'block', fontSize: 10, marginBottom: 8 }}
          >
            {g.title}
          </span>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 7 }}>
            {g.keys.map((p) => {
              const on = value.includes(p);
              return (
                <button
                  key={p}
                  type="button"
                  onClick={() => toggle(p)}
                  className="pd-tag"
                  aria-pressed={on}
                  style={{
                    background: on ? 'var(--ink)' : 'var(--white)',
                    color: on ? 'var(--paper)' : 'var(--ink-2)',
                    borderColor: on ? 'var(--ink)' : 'var(--rule-2)',
                  }}
                >
                  {permissionLabel(p)}
                </button>
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
}

export function PeopleTool({ app, brand }: { app: SuiteApp; brand: Brand }) {
  const trpc = useTRPC();
  const qc = useQueryClient();
  const orgId = brand.id;

  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState('All');
  const [openId, setOpenId] = useState<string | null>(null);
  const [inviting, setInviting] = useState(false);

  const status =
    filter === 'Active'
      ? 'active'
      : filter === 'Pending'
        ? 'pending'
        : undefined;
  const listQ = useQuery(
    trpc.staff.list.queryOptions({
      orgType: 'brand',
      orgId,
      limit: 100,
      offset: 0,
      ...(search ? { search } : {}),
      ...(status ? { status } : {}),
    }),
  );
  const rows = listQ.data?.items ?? [];
  const activeCount = rows.filter((r) => r.status === 'active').length;
  const open = rows.find((r) => r.id === openId) || null;

  const refresh = () => {
    qc.invalidateQueries({ queryKey: trpc.staff.list.queryKey() });
    qc.invalidateQueries({ queryKey: trpc.brands.dashboardStats.queryKey() });
  };

  const inviteM = useMutation({
    ...trpc.staff.invite.mutationOptions(),
    onSuccess: () => {
      refresh();
      setInviting(false);
      pushToast('Invitation sent.', 'success');
    },
    onError: (e) => pushToast(e.message, 'error'),
  });
  const removeM = useMutation({
    ...trpc.staff.remove.mutationOptions(),
    onSuccess: () => {
      refresh();
      setOpenId(null);
      pushToast('Member removed.', 'info');
    },
    onError: (e) => pushToast(e.message, 'error'),
  });
  const resendM = useMutation({
    ...trpc.staff.resend.mutationOptions(),
    onSuccess: () => pushToast('Invite re-sent.', 'success'),
    onError: (e) => pushToast(e.message, 'error'),
  });
  const permsM = useMutation({
    ...trpc.staff.updatePermissions.mutationOptions(),
    onSuccess: () => {
      refresh();
      pushToast('Access updated.', 'success');
    },
    onError: (e) => pushToast(e.message, 'error'),
  });

  return (
    <div>
      <FndHeader
        app={{
          icon: app.icon || 'team',
          name: app.name,
          tag: 'Everyone with access to this brand',
        }}
        brand={brand}
        pill="Source of truth"
        count={activeCount}
        countLabel="active"
        primaryLabel="Invite"
        onPrimary={() => setInviting(true)}
      />

      <FndToolbar
        search={search}
        setSearch={setSearch}
        placeholder="Search by email"
      >
        <FndFilter
          options={['All', 'Active', 'Pending']}
          value={filter}
          onChange={setFilter}
        />
      </FndToolbar>

      <div className="pd-fnd-table">
        <div className="pd-team-row pd-fnd-head">
          <span></span>
          <span>Name</span>
          <span className="pd-hide-sm">Access</span>
          <span className="pd-hide-sm">Joined</span>
          <span>Status</span>
        </div>
        {listQ.isLoading && (
          <div
            style={{
              padding: '40px 0',
              textAlign: 'center',
              color: 'var(--ink-3)',
              fontSize: 14,
            }}
          >
            Loading…
          </div>
        )}
        {!listQ.isLoading && rows.length === 0 && (
          <FndEmpty
            line={
              search
                ? `No one matches "${search}".`
                : 'No one here yet. Invite your first teammate.'
            }
            cta="Invite"
            onCta={() => setInviting(true)}
          />
        )}
        {rows.map((p) => (
          <button
            key={p.id}
            type="button"
            className="pd-team-row pd-fnd-row"
            onClick={() => setOpenId(p.id)}
          >
            <span
              style={{
                width: 36,
                height: 36,
                borderRadius: '50%',
                background:
                  p.status === 'active' ? 'var(--ink)' : 'var(--ink-3)',
                color: 'var(--paper)',
                display: 'inline-flex',
                alignItems: 'center',
                justifyContent: 'center',
                fontWeight: 700,
                fontSize: 12,
                overflow: 'hidden',
              }}
            >
              {p.profileUrl ? (
                <img
                  src={p.profileUrl}
                  alt=""
                  style={{ width: '100%', height: '100%', objectFit: 'cover' }}
                />
              ) : (
                initials(staffName(p))
              )}
            </span>
            <span style={{ minWidth: 0 }}>
              <span
                style={{
                  display: 'block',
                  fontSize: 14,
                  fontWeight: 500,
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                }}
              >
                {staffName(p)}
              </span>
              <span
                style={{
                  display: 'block',
                  fontSize: 12,
                  color: 'var(--ink-3)',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                }}
              >
                {p.email}
              </span>
            </span>
            <span
              className="pd-hide-sm"
              style={{
                fontSize: 13,
                color: 'var(--ink-2)',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
              }}
            >
              {accessSummary(p.permissions)}
            </span>
            <span
              className="pd-hide-sm mono"
              style={{ fontSize: 11.5, color: 'var(--ink-3)' }}
            >
              {p.status === 'active' ? fmtDate(p.acceptedAt) : 'Invited'}
            </span>
            <span>
              <FndStatus
                label={p.status === 'active' ? 'Active' : 'Pending'}
                dim={p.status !== 'active'}
              />
            </span>
          </button>
        ))}
      </div>

      {open && (
        <StaffDrawer
          key={open.id}
          p={open}
          onClose={() => setOpenId(null)}
          onSave={(perms) =>
            permsM.mutate({ id: open.id, permissions: perms as StaffPerm[] })
          }
          onResend={() => resendM.mutate({ id: open.id })}
          onRemove={() => removeM.mutate({ id: open.id })}
          saving={permsM.isPending}
        />
      )}

      {inviting && (
        <InviteMember
          saving={inviteM.isPending}
          onClose={() => setInviting(false)}
          onInvite={(email, permissions) =>
            inviteM.mutate({
              orgType: 'brand',
              orgId,
              email,
              permissions: permissions as StaffPerm[],
            })
          }
        />
      )}
    </div>
  );
}

function StaffDrawer({
  p,
  onClose,
  onSave,
  onResend,
  onRemove,
  saving,
}: {
  p: StaffRow;
  onClose: () => void;
  onSave: (perms: string[]) => void;
  onResend: () => void;
  onRemove: () => void;
  saving: boolean;
}) {
  const [edit, setEdit] = useState(false);
  const [perms, setPerms] = useState<string[]>(p.permissions ?? []);
  return (
    <FndDrawer
      title={staffName(p)}
      eyebrow={p.status === 'active' ? 'Active member' : 'Invitation pending'}
      onClose={onClose}
      footer={
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          {p.status !== 'active' && (
            <Button variant="secondary" size="sm" onClick={onResend}>
              Resend invite
            </Button>
          )}
          <button
            type="button"
            className="pd-textlink"
            style={{ fontSize: 12.5, color: 'var(--color-danger)' }}
            onClick={onRemove}
          >
            Remove
          </button>
          <span style={{ flex: 1 }} />
          {edit ? (
            <>
              <Button
                variant="secondary"
                size="sm"
                onClick={() => {
                  setPerms(p.permissions ?? []);
                  setEdit(false);
                }}
              >
                Cancel
              </Button>
              <Button
                variant="primary"
                size="sm"
                disabled={saving}
                onClick={() => {
                  onSave(perms);
                  setEdit(false);
                }}
              >
                Save
              </Button>
            </>
          ) : (
            <Button variant="primary" size="sm" onClick={() => setEdit(true)}>
              Edit access
            </Button>
          )}
        </div>
      }
    >
      <FndSection title="Profile">
        <FndField label="Email" value={p.email} />
        <FndField
          label="Status"
          value={
            p.status === 'active'
              ? 'Active — can log in'
              : 'Invited — not yet accepted'
          }
        />
        <FndField
          label="Joined"
          value={
            p.status === 'active'
              ? fmtDate(p.acceptedAt)
              : `Invited ${fmtDate(p.invitedAt)}`
          }
        />
      </FndSection>
      <FndSection title="Access">
        {edit ? (
          <PermPicker value={perms} onChange={setPerms} />
        ) : (p.permissions ?? []).length === 0 ? (
          <p style={{ margin: 0, fontSize: 13, color: 'var(--ink-3)' }}>
            No access granted yet.
          </p>
        ) : (
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 7 }}>
            {(p.permissions ?? []).map((perm) => (
              <span key={perm} className="pd-kind-pill">
                {permissionLabel(perm)}
              </span>
            ))}
          </div>
        )}
      </FndSection>
    </FndDrawer>
  );
}

function InviteMember({
  onClose,
  onInvite,
  saving,
}: {
  onClose: () => void;
  onInvite: (email: string, perms: string[]) => void;
  saving: boolean;
}) {
  const [email, setEmail] = useState('');
  const [perms, setPerms] = useState<string[]>(['brandDashboard']);
  const valid = /\S+@\S+\.\S+/.test(email.trim());
  return (
    <FndModal
      title="Invite a teammate"
      eyebrow="They get a login and the access you choose"
      onClose={onClose}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button
            variant="primary"
            disabled={!valid || saving}
            onClick={() => valid && onInvite(email.trim(), perms)}
          >
            Send invite
          </Button>
        </>
      }
    >
      <FndInput
        label="Email"
        value={email}
        onChange={setEmail}
        type="email"
        sub="The invitation is sent here."
      />
      <div style={{ marginTop: 4 }}>
        <PermPicker value={perms} onChange={setPerms} />
      </div>
    </FndModal>
  );
}
