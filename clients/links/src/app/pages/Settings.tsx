/* Settings — General (business name, default QR design, sign out) + Team
 * (URL staff). Ports the Manus Adeyy SET1/SET3/SET2 screens onto the shared
 * central-DB APIs (brands.update, shortLinks.defaultQrConfig, staff.*). */
import { useEffect, useState } from 'react';
import { useQuery, useMutation } from '@tanstack/react-query';
import { signOut, useCurrentUser } from '@shared/auth/auth-context';
import { useLinksContext } from '../use-context';
import { useTRPC } from '@shared/lib/trpc';
import { Seg, QrPreview, type QrConfig } from '../components';
import { REDIRECTOR_BASE_NO_PROTOCOL } from '../lib';
import { useToast } from '../toast';
import { useLinksInvalidate } from '../use-invalidate';
import { useConfirm } from '../confirm';
import { SettingsTeam } from './SettingsTeam';
import type { PageProps } from '../types';

type Tab = 'general' | 'team';

/** Debounce a fast-changing value so we don't fire an availability query per keystroke. */
function useDebounced<T>(value: T, ms: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setDebounced(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return debounced;
}

export function Settings({ brandId }: PageProps) {
  const { data: user } = useCurrentUser();
  const [tab, setTab] = useState<Tab>('general');

  const isOwner = user?.role === 'brandOwner';
  const canManageStaff =
    isOwner || (user?.permissions ?? []).includes('staffManagement');

  // The Team tab is only for staff managers (owner / staffManagement). Viewers and
  // other non-managers don't see it. Guard the active tab too, so it can't get
  // stuck on 'team' for someone who can't manage.
  const activeTab: Tab = tab === 'team' && !canManageStaff ? 'general' : tab;

  return (
    <div>
      <div className="apage-head">
        <h1>Settings</h1>
      </div>

      <div className="settabs">
        <button
          className={activeTab === 'general' ? 'sel' : ''}
          onClick={() => setTab('general')}
        >
          General
        </button>
        {canManageStaff && (
          <button
            className={activeTab === 'team' ? 'sel' : ''}
            onClick={() => setTab('team')}
          >
            Team
          </button>
        )}
      </div>

      {activeTab === 'general' ? (
        <SettingsGeneral brandId={brandId} isOwner={isOwner} />
      ) : (
        <SettingsTeam brandId={brandId} canManage={canManageStaff} />
      )}
    </div>
  );
}

function SettingsGeneral({
  brandId,
  isOwner,
}: {
  brandId: string;
  isOwner: boolean;
}) {
  const trpc = useTRPC();
  const { afterBrandChange } = useLinksInvalidate();
  const toast = useToast();
  const confirm = useConfirm();
  const { data: user } = useCurrentUser();
  const { activeBrand } = useLinksContext();

  const handleSignOut = async () => {
    if (await confirm({
      title: 'Sign out?',
      description: 'You’ll need to log in again to get back in.',
      confirmLabel: 'Sign out',
      destructive: true,
    })) void signOut();
  };

  const [name, setName] = useState(activeBrand?.businessName ?? '');
  useEffect(() => {
    setName(activeBrand?.businessName ?? '');
  }, [activeBrand?.businessName]);

  // Business name is unique across the shared brand+agency namespace. Check
  // availability live as it's typed and block save on a collision, so a
  // duplicate is caught before the request — excludeBrandId keeps this brand's
  // own current name from reading as taken, and we only check once it changes.
  const trimmedName = name.trim();
  const nameChanged = trimmedName.toLowerCase() !== (activeBrand?.businessName ?? '').trim().toLowerCase();
  const debouncedName = useDebounced(trimmedName, 400);
  const nameCheck = useQuery({
    ...trpc.brands.checkBusinessName.queryOptions({ businessName: debouncedName, excludeBrandId: brandId }),
    enabled: nameChanged && debouncedName.length > 1,
  });
  const showNameStatus = nameChanged && debouncedName.length > 1;
  const nameTaken = nameChanged && !!nameCheck.data && !nameCheck.data.available;

  const updateBrand = useMutation({
    ...trpc.brands.update.mutationOptions(),
    onSuccess: () => {
      afterBrandChange();
      toast('Business name updated.');
    },
    onError: (e) => {
      toast('Error: ' + e.message);
      // The save was rejected (e.g. a name collision) — revert the input to the
      // saved name so it never keeps an unsaved value.
      setName(activeBrand?.businessName ?? '');
    },
  });

  function saveName() {
    const next = name.trim();
    if (!next || next === activeBrand?.businessName) return;
    // Don't fire a save we know the server will reject; the inline error already
    // tells the user why. (Revert so a blur doesn't leave the bad value showing.)
    if (nameTaken || (showNameStatus && nameCheck.isFetching)) {
      setName(activeBrand?.businessName ?? '');
      return;
    }
    updateBrand.mutate({ brandId, businessName: next });
  }

  // ── Default QR design ──────────────────────────────────────────────────
  const { data: defaultQr } = useQuery(
    trpc.shortLinks.defaultQrConfig.queryOptions({ brandId }),
  );
  const [qr, setQr] = useState<QrConfig>({});
  useEffect(() => {
    if (defaultQr) setQr(defaultQr);
  }, [defaultQr]);

  const saveQr = useMutation({
    ...trpc.shortLinks.setDefaultQrConfig.mutationOptions(),
    onSuccess: () => {
      afterBrandChange();
      toast('Default QR design saved.');
    },
    onError: (e) => toast('Error: ' + e.message),
  });
  function setQrField<K extends keyof QrConfig>(k: K, v: QrConfig[K]) {
    const next = { ...qr, [k]: v };
    setQr(next);
    saveQr.mutate({ brandId, qrConfig: next });
  }

  return (
    <div className="detail-grid">
      <div className="dcard">
        <div className="db" style={{ paddingTop: 18, display: 'flex', flexDirection: 'column', gap: 18, maxWidth: 460 }}>
          <div className="afield">
            <label>Business name</label>
            {isOwner ? (
              <input
                className="ainput"
                value={name}
                onChange={(e) => setName(e.target.value)}
                onBlur={saveName}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') saveName();
                }}
                aria-invalid={nameTaken || undefined}
              />
            ) : (
              <div className="mutetext">{activeBrand?.businessName ?? '—'}</div>
            )}
            {updateBrand.isPending ? (
              <span className="hint">Saving…</span>
            ) : nameTaken ? (
              <span className="hint" style={{ color: 'var(--color-danger)' }}>
                {nameCheck.data?.reason ?? 'This business name is already taken.'}
              </span>
            ) : showNameStatus && nameCheck.isFetching ? (
              <span className="hint">Checking availability…</span>
            ) : null}
          </div>

          <div className="afield">
            <label>Short-link domain</label>
            <div className="slug" style={{ fontWeight: 700 }}>
              {REDIRECTOR_BASE_NO_PROTOCOL}
            </div>
            <span className="hint">Every short link resolves under this domain.</span>
          </div>

          <hr className="divider" style={{ margin: 0 }} />

          <div>
            <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 4 }}>
              Account
            </div>
            <p className="mutetext" style={{ fontSize: 12.5, margin: '0 0 10px' }}>
              Signed in as {user?.email ?? '—'}.
            </p>
            <button className="abtn abtn-ghost abtn-sm" onClick={() => void handleSignOut()}>
              Sign out
            </button>
          </div>
        </div>
      </div>

      <div className="dcard">
        <div className="dh">
          <h2>Default QR design</h2>
          <span className="meta">New links start here</span>
        </div>
        <div className="db" style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          <QrPreview
            slug="your-link"
            config={qr}
            size={200}
            style={{ border: '1px solid var(--border-1)', borderRadius: 6, overflow: 'hidden', alignSelf: 'flex-start' }}
          />
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            <Seg
              value={qr.dotStyle ?? 'square'}
              options={[
                { value: 'square', label: 'Square' },
                { value: 'rounded', label: 'Rounded' },
                { value: 'dots', label: 'Dots' },
              ]}
              onChange={(v) => setQrField('dotStyle', v as QrConfig['dotStyle'])}
            />
            <Seg
              value={qr.cornerStyle ?? 'square'}
              options={[
                { value: 'square', label: 'Square eyes' },
                { value: 'extra-rounded', label: 'Rounded eyes' },
              ]}
              onChange={(v) => setQrField('cornerStyle', v as QrConfig['cornerStyle'])}
            />
          </div>
        </div>
      </div>
    </div>
  );
}
