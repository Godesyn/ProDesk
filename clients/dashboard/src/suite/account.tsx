/* Prodesk Suite — Account settings (vendor/user level), wired to live tRPC.
   Profile → users.updateProfile · Billing → billing.brandSummary/brandSubscriptions
   · Notifications → users.unsubscribedChannels · Security → users.changePassword.
   (Team lives in the People screen now — see people.tsx.) */

import { useRef, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useTRPC } from '@shared/lib/trpc';
import { useCurrentUser } from '@shared/auth/auth-context';
import { uploadFile } from '@shared/lib/storage';
import { StorageBucket } from '@shared/lib/storage-buckets';
import { Icon } from './icons';
import { Button, pushToast } from './ui';
import { FndHeader, FndInput, FndSwitch } from './fnd-shared';
import {
  FeatureSubscriptionsSection,
  ExploreFeatureSubscriptions,
} from '@shared/components/feature-subscriptions/feature-subscriptions-section';
import { initials } from './live';
import type { Vendor } from './data';

const SETTINGS_TABS = [
  { key: 'profile', label: 'Profile', icon: 'user' },
  { key: 'billing', label: 'Plan & billing', icon: 'billing' },
  { key: 'notifications', label: 'Notifications', icon: 'bell' },
  { key: 'security', label: 'Security', icon: 'shield' },
];

function SetRow({
  title,
  sub,
  children,
}: {
  title: string;
  sub?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="pd-set-row">
      <div style={{ minWidth: 0 }}>
        <div style={{ fontSize: 14, fontWeight: 500, color: 'var(--ink)' }}>
          {title}
        </div>
        {sub && (
          <div
            style={{
              fontSize: 12.5,
              color: 'var(--ink-3)',
              marginTop: 2,
              textWrap: 'pretty',
            }}
          >
            {sub}
          </div>
        )}
      </div>
      <div style={{ flexShrink: 0 }}>{children}</div>
    </div>
  );
}

export function AccountSettings({
  vendor,
  brandId,
  initialTab = 'profile',
}: {
  vendor: Vendor;
  brandId: string;
  initialTab?: string;
}) {
  const [tab, setTab] = useState(initialTab);
  return (
    <main className="pd-page">
      <FndHeader
        app={{
          icon: 'settings',
          name: 'Account settings',
          tag: 'Your account — the same across every brand',
        }}
        brand={{ name: vendor.name }}
        pill="Account · above brands"
      />
      <div className="pd-set-grid">
        <div
          className="pd-set-rail"
          role="tablist"
          aria-label="Settings sections"
        >
          {SETTINGS_TABS.map((t) => (
            <button
              key={t.key}
              type="button"
              role="tab"
              aria-selected={tab === t.key}
              className="pd-set-tab"
              data-on={tab === t.key}
              onClick={() => setTab(t.key)}
            >
              <Icon
                name={t.icon}
                size={18}
                className="pd-set-tab-ic"
                style={{
                  flexShrink: 0,
                  color: tab === t.key ? 'var(--volt)' : 'var(--ink-3)',
                }}
              />
              <span>{t.label}</span>
            </button>
          ))}
        </div>
        <div style={{ minWidth: 0 }}>
          {tab === 'profile' && <ProfileTab vendor={vendor} />}
          {tab === 'billing' && <BillingTab brandId={brandId} />}
          {tab === 'notifications' && <NotificationsTab />}
          {tab === 'security' && <SecurityTab />}
        </div>
      </div>
    </main>
  );
}

function ProfileTab({ vendor }: { vendor: Vendor }) {
  const trpc = useTRPC();
  const qc = useQueryClient();
  const { data: user } = useCurrentUser();
  const [firstName, setFirstName] = useState(user?.firstName ?? '');
  const [lastName, setLastName] = useState(user?.lastName ?? '');
  const fileRef = useRef<HTMLInputElement | null>(null);
  const [uploading, setUploading] = useState(false);
  const save = useMutation({
    ...trpc.users.updateProfile.mutationOptions(),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: trpc.auth.me.queryKey() });
      pushToast('Profile saved.', 'success');
    },
    onError: (e) => pushToast(e.message, 'error'),
  });

  // Profile photo upload — mirrors the prodesk profile-hero flow: pick → upload
  // to storage → users.updateProfile({ profileUrl }) → refresh auth.me so the
  // photo updates here and in the top-bar/account-menu avatars.
  const updatePhoto = useMutation({
    ...trpc.users.updateProfile.mutationOptions(),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: trpc.auth.me.queryKey() });
      pushToast('Profile photo updated.', 'success');
    },
    onError: (e) => pushToast(e.message, 'error'),
  });
  async function onPickPhoto(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (fileRef.current) fileRef.current.value = '';
    if (!file || !user) return;
    setUploading(true);
    try {
      const url = await uploadFile(
        StorageBucket.Uploads,
        `profiles/${user.id}`,
        file,
      );
      await updatePhoto.mutateAsync({ profileUrl: url });
    } catch (err) {
      pushToast(
        `Upload failed: ${err instanceof Error ? err.message : 'unknown error'}`,
        'error',
      );
    } finally {
      setUploading(false);
    }
  }

  const displayName =
    [firstName, lastName].filter(Boolean).join(' ').trim() || vendor.name;
  return (
    <div className="pd-set-card">
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 16,
          marginBottom: 18,
        }}
      >
        <div style={{ position: 'relative', flexShrink: 0 }}>
          <span
            style={{
              width: 56,
              height: 56,
              borderRadius: '50%',
              background: 'var(--ink)',
              color: 'var(--paper)',
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontWeight: 700,
              fontSize: 18,
              overflow: 'hidden',
            }}
          >
            {user?.profileUrl ? (
              <img
                src={user.profileUrl}
                alt=""
                style={{ width: '100%', height: '100%', objectFit: 'cover' }}
              />
            ) : (
              initials(displayName)
            )}
          </span>
          <button
            type="button"
            onClick={() => fileRef.current?.click()}
            disabled={uploading}
            title="Change photo"
            style={{
              position: 'absolute',
              bottom: -2,
              right: -2,
              width: 24,
              height: 24,
              borderRadius: '50%',
              border: '2px solid var(--white)',
              background: 'var(--volt)',
              color: 'var(--ink)',
              cursor: uploading ? 'default' : 'pointer',
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
              opacity: uploading ? 0.6 : 1,
            }}
          >
            <Icon name="image" size={12} />
          </button>
          <input
            ref={fileRef}
            type="file"
            accept="image/*"
            style={{ display: 'none' }}
            onChange={onPickPhoto}
          />
        </div>
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 16, fontWeight: 700 }}>{displayName}</div>
          <div style={{ fontSize: 13, color: 'var(--ink-3)' }}>
            {user?.email}
          </div>
        </div>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
        <FndInput
          label="First name"
          value={firstName}
          onChange={setFirstName}
        />
        <FndInput label="Last name" value={lastName} onChange={setLastName} />
      </div>
      <FndInput
        label="Email"
        value={user?.email ?? ''}
        onChange={() => {}}
        sub="Email is managed by your sign-in and can't be changed here."
      />
      <div
        style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 4 }}
      >
        <Button
          variant="primary"
          size="sm"
          disabled={save.isPending}
          onClick={() => save.mutate({ firstName, lastName })}
        >
          Save changes
        </Button>
      </div>
    </div>
  );
}

// The brand-only dashboard's billing tab manages Prodesk feature subscriptions
// only — active ones (with cancel) plus the catalogue to subscribe to. Marketplace
// services and payment history live in the main Prodesk app, not here.
function BillingTab({ brandId }: { brandId: string }) {
  return (
    <div className="space-y-6">
      <div className="pd-set-card">
        <div className="eyebrow" style={{ marginBottom: 6 }}>
          Application subscriptions
        </div>
        <p style={{ margin: 0, fontSize: 13, color: 'var(--ink-2)' }}>
          Manage the Prodesk applications your brand subscribes to.
        </p>
      </div>
      <FeatureSubscriptionsSection brandId={brandId} />
      <ExploreFeatureSubscriptions brandId={brandId} />
    </div>
  );
}

function NotificationsTab() {
  const trpc = useTRPC();
  const qc = useQueryClient();
  const channelsQ = useQuery(trpc.users.unsubscribedChannels.queryOptions());
  const unsubbed = new Set(channelsQ.data?.channels ?? []);
  const toggle = useMutation({
    ...trpc.users.toggleUnsubscribeChannel.mutationOptions(),
    onSuccess: () =>
      qc.invalidateQueries({
        queryKey: trpc.users.unsubscribedChannels.queryKey(),
      }),
    onError: (e) => pushToast(e.message, 'error'),
  });
  const set = (channel: 'task' | 'chat', on: boolean) =>
    toggle.mutate({ channel, unsubscribe: !on });
  return (
    <div className="pd-set-card">
      <SetRow
        title="Task notifications"
        sub="Assignments, approvals and reminders across your brand"
      >
        <FndSwitch
          checked={!unsubbed.has('task')}
          onChange={(v) => set('task', v)}
          ariaLabel="Task notifications"
        />
      </SetRow>
      <SetRow
        title="Chat notifications"
        sub="Messages from agencies and teammates"
      >
        <FndSwitch
          checked={!unsubbed.has('chat')}
          onChange={(v) => set('chat', v)}
          ariaLabel="Chat notifications"
        />
      </SetRow>
    </div>
  );
}

function SecurityTab() {
  const trpc = useTRPC();
  const [pw, setPw] = useState('');
  const [confirm, setConfirm] = useState('');
  const change = useMutation({
    ...trpc.users.changePassword.mutationOptions(),
    onSuccess: () => {
      setPw('');
      setConfirm('');
      pushToast('Password changed.', 'success');
    },
    onError: (e) => pushToast(e.message, 'error'),
  });
  const valid = pw.length >= 8 && pw === confirm;
  return (
    <div className="pd-set-card">
      <div className="eyebrow" style={{ marginBottom: 12 }}>
        Change password
      </div>
      <FndInput
        label="New password"
        value={pw}
        onChange={setPw}
        type="password"
        sub="At least 8 characters."
      />
      <FndInput
        label="Confirm new password"
        value={confirm}
        onChange={setConfirm}
        type="password"
      />
      <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
        <Button
          variant="primary"
          size="sm"
          disabled={!valid || change.isPending}
          onClick={() => change.mutate({ newPassword: pw })}
        >
          Update password
        </Button>
      </div>
    </div>
  );
}
