/**
 * NATIVE Account screen for Logo Studio.
 *
 * Every Prodesk frontend ships its OWN account UI so it reads as another room in
 * the same building rather than a bounce into the main app (the shared
 * `@shared/pages/profile` page is styled for Prodesk and looks foreign inside the
 * atelier skin). What is shared is the DATA layer only — `users.updateProfile`,
 * `users.changePassword`, the storage upload helper, and the tool-agnostic Stripe
 * card procedures.
 *
 * Scope is deliberately narrow: only what a Logo Studio user can act on here —
 * their photo + name, their password/security, and Logo Studio billing. Payouts,
 * affiliate, calendar and the other Prodesk-wide panels stay in the main app.
 */
import { useEffect, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Camera,
  CheckCircle2,
  CreditCard,
  Download,
  ExternalLink,
  KeyRound,
  Loader2,
  LogOut,
  MailCheck,
  ShieldCheck,
  X,
} from 'lucide-react';
import { toast } from 'sonner';
import { signOut, useCurrentUser } from '@shared/auth/auth-context';
import { supabase } from '@shared/lib/supabase';
import { useTRPC } from '@shared/lib/trpc';
import { STRIPE_PUBLISHABLE_KEY } from '@shared/lib/env';
import { StorageBucket } from '@shared/lib/storage-buckets';
import { uploadFile } from '@shared/lib/storage';
import { initialsOf } from '@shared/lib/utils';
import { toastError } from '@shared/lib/errors';
import { useConfirm } from '@shared/components/ui/confirm-dialog';
import { StripeCardSetup } from '@shared/components/billing/stripe-card-setup';
import {
  Eyebrow,
  PageHeader,
  Panel,
  PigmentButton,
  InkButton,
} from '../components/primitives';
import { useLogoContext } from '../app/use-context';

type Tab = 'profile' | 'security' | 'billing';

const TABS: { id: Tab; label: string }[] = [
  { id: 'profile', label: 'Profile' },
  { id: 'security', label: 'Security' },
  { id: 'billing', label: 'Billing' },
];

const FIELD =
  'h-12 w-full rounded-[var(--radius-md)] border border-[var(--hair-2)] bg-[var(--card)] px-4 text-base text-[var(--ink)] outline-none focus:border-[var(--pigment)] disabled:text-[var(--ink-3)]';

function money(amount: number, currency = 'AUD') {
  try {
    return new Intl.NumberFormat(undefined, {
      style: 'currency',
      currency,
      maximumFractionDigits: amount % 1 === 0 ? 0 : 2,
    }).format(amount);
  } catch {
    return `${currency} ${amount}`;
  }
}

function fmtDate(d: string | Date | null | undefined) {
  if (!d) return '—';
  return new Date(d).toLocaleDateString(undefined, {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });
}

/* ── Small studio-skinned pieces ───────────────────────────────────────── */

function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <label className="block">
      <span className="spec mb-2 block">{label}</span>
      {children}
      {hint && (
        <span className="mt-1.5 block text-xs text-[var(--ink-3)]">{hint}</span>
      )}
    </label>
  );
}

/** Icon + title + description on the left, one action on the right. */
function Row({
  icon: Icon,
  title,
  description,
  action,
}: {
  icon: typeof KeyRound;
  title: string;
  description: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-4">
      <div className="flex min-w-0 items-center gap-3">
        <span className="grid h-10 w-10 shrink-0 place-items-center rounded-[var(--radius-md)] border border-[var(--hair-2)] bg-[var(--stage)] text-[var(--ink-2)]">
          <Icon className="h-5 w-5" />
        </span>
        <div className="min-w-0">
          <p className="text-sm font-semibold text-[var(--ink)]">{title}</p>
          <p className="text-xs text-[var(--ink-3)]">{description}</p>
        </div>
      </div>
      {action}
    </div>
  );
}

/** Hand-rolled sheet matching the command palette (no shared shadcn chrome). */
function Sheet({
  title,
  onClose,
  children,
}: {
  title: string;
  onClose: () => void;
  children: React.ReactNode;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      window.removeEventListener('keydown', onKey);
      document.body.style.overflow = prev;
    };
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center px-4 pt-[10vh] sm:pt-[14vh]"
      role="dialog"
      aria-modal="true"
      aria-label={title}
    >
      <button
        className="absolute inset-0 cursor-default bg-[rgba(14,14,12,0.45)]"
        onClick={onClose}
        aria-label={`Close ${title}`}
        tabIndex={-1}
      />
      <div className="pop relative w-full max-w-[440px] overflow-hidden rounded-[var(--radius-lg)] border border-[var(--hair-2)] bg-[var(--card)] shadow-[var(--shadow-3)]">
        <div className="flex items-center justify-between border-b border-[var(--hair)] px-5 py-4">
          <h2 className="text-sm font-semibold text-[var(--ink)]">{title}</h2>
          <button
            onClick={onClose}
            className="press grid h-8 w-8 place-items-center rounded-full text-[var(--ink-3)] transition hover:bg-[var(--stage-2)] hover:text-[var(--ink)]"
            aria-label="Close"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="p-5">{children}</div>
      </div>
    </div>
  );
}

/* ── Screen ────────────────────────────────────────────────────────────── */

export function Account() {
  const [tab, setTab] = useState<Tab>('profile');
  const { data: user } = useCurrentUser();

  if (!user) {
    return (
      <div className="grid h-[60vh] place-items-center">
        <Loader2 className="h-7 w-7 animate-spin text-[var(--ink-3)]" />
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-[880px] px-4 pb-24 pt-8 sm:px-6 lg:px-8 lg:pt-10">
      <PageHeader
        eyebrow="Account"
        title={
          <>
            Your{' '}
            <span className="quill" style={{ color: 'var(--pigment)' }}>
              account
            </span>
            .
          </>
        }
        lede="Your photo and name, how you sign in, and what Logo Studio bills you. Everything else about your Prodesk workspace lives in the main app."
      />

      {/* Section switch */}
      <div className="mt-8 flex flex-wrap gap-2">
        {TABS.map((t) => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            data-active={tab === t.id}
            className="press rounded-[var(--radius-pill)] border px-4 py-2 text-sm font-semibold transition data-[active=false]:border-[var(--hair-2)] data-[active=false]:text-[var(--ink-2)] data-[active=false]:hover:bg-[var(--stage-2)] data-[active=true]:border-transparent data-[active=true]:text-white"
            style={tab === t.id ? { background: 'var(--pigment)' } : undefined}
          >
            {t.label}
          </button>
        ))}
      </div>

      <div className="mt-6 flex flex-col gap-5">
        {tab === 'profile' && <ProfileSection user={user} />}
        {tab === 'security' && (
          <SecuritySection
            email={user.email}
            verified={!!user.isEmailVerified}
          />
        )}
        {tab === 'billing' && <BillingSection />}
      </div>
    </div>
  );
}

/* ── Profile: photo + name ─────────────────────────────────────────────── */

interface AccountUser {
  id: string;
  email: string;
  firstName?: string | null;
  lastName?: string | null;
  profileUrl?: string | null;
  isEmailVerified?: boolean | null;
}

function ProfileSection({ user }: { user: AccountUser }) {
  const trpc = useTRPC();
  const qc = useQueryClient();
  const fileRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [firstName, setFirstName] = useState(user.firstName ?? '');
  const [lastName, setLastName] = useState(user.lastName ?? '');

  useEffect(() => {
    setFirstName(user.firstName ?? '');
    setLastName(user.lastName ?? '');
  }, [user.firstName, user.lastName]);

  const meKey = trpc.auth.me.queryKey();
  const updateProfile = useMutation({
    ...trpc.users.updateProfile.mutationOptions(),
    onSuccess: () => void qc.invalidateQueries({ queryKey: meKey }),
    onError: (e) => toastError(e),
  });

  const displayName =
    [user.firstName, user.lastName].filter(Boolean).join(' ') || user.email;
  const dirty =
    firstName.trim() !== (user.firstName ?? '') ||
    lastName.trim() !== (user.lastName ?? '');

  async function onPick(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    try {
      const publicUrl = await uploadFile(
        StorageBucket.Uploads,
        `profiles/${user.id}`,
        file,
      );
      await updateProfile.mutateAsync({ profileUrl: publicUrl });
      toast.success('Profile photo updated');
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  }

  return (
    <>
      {/* Photo — the one place a face appears in an achromatic studio. */}
      <Panel>
        <Eyebrow>Profile photo</Eyebrow>
        <div className="mt-4 flex flex-wrap items-center gap-6">
          <div className="relative shrink-0">
            <div className="grid h-24 w-24 place-items-center overflow-hidden rounded-full border border-[var(--hair-2)] bg-[var(--stage-2)]">
              {user.profileUrl ? (
                <img
                  src={user.profileUrl}
                  alt=""
                  className="h-full w-full object-cover"
                />
              ) : (
                <span className="text-2xl font-semibold text-[var(--ink-2)]">
                  {initialsOf(displayName)}
                </span>
              )}
            </div>
            <button
              type="button"
              onClick={() => fileRef.current?.click()}
              disabled={uploading}
              title="Change photo"
              aria-label="Change photo"
              className="press absolute bottom-0 right-0 grid h-9 w-9 place-items-center rounded-full border-2 border-[var(--card)] text-white disabled:opacity-60"
              style={{ background: 'var(--pigment)' }}
            >
              {uploading ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Camera className="h-4 w-4" />
              )}
            </button>
            <input
              ref={fileRef}
              type="file"
              accept="image/*"
              className="hidden"
              onChange={(e) => void onPick(e)}
            />
          </div>
          <div className="min-w-0">
            <p className="text-lg font-semibold text-[var(--ink)]">
              {displayName}
            </p>
            <p className="text-sm text-[var(--ink-3)]">{user.email}</p>
            <p className="spec mt-3" style={{ fontSize: 10 }}>
              JPG or PNG · square works best
            </p>
          </div>
        </div>
      </Panel>

      {/* Name */}
      <Panel>
        <Eyebrow>Your details</Eyebrow>
        <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Field label="First name">
            <input
              className={FIELD}
              value={firstName}
              onChange={(e) => setFirstName(e.target.value)}
            />
          </Field>
          <Field label="Last name">
            <input
              className={FIELD}
              value={lastName}
              onChange={(e) => setLastName(e.target.value)}
            />
          </Field>
        </div>
        <div className="mt-4">
          <Field
            label="Email"
            hint="Your sign-in address can't be changed here."
          >
            <input className={FIELD} value={user.email} disabled />
          </Field>
        </div>
        <div className="mt-6 flex items-center justify-end gap-3 border-t border-[var(--hair)] pt-5">
          {dirty && !updateProfile.isPending && (
            <button
              type="button"
              onClick={() => {
                setFirstName(user.firstName ?? '');
                setLastName(user.lastName ?? '');
              }}
              className="press text-sm font-medium text-[var(--ink-3)] transition hover:text-[var(--ink)]"
            >
              Discard
            </button>
          )}
          <PigmentButton
            onClick={() => {
              if (!dirty || updateProfile.isPending) return;
              updateProfile.mutate(
                { firstName: firstName.trim(), lastName: lastName.trim() },
                { onSuccess: () => toast.success('Profile saved') },
              );
            }}
            className={
              !dirty || updateProfile.isPending
                ? 'pointer-events-none opacity-50'
                : ''
            }
          >
            {updateProfile.isPending ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : null}
            Save changes
          </PigmentButton>
        </div>
      </Panel>
    </>
  );
}

/* ── Security: password, verification, sign out ────────────────────────── */

function SecuritySection({
  email,
  verified,
}: {
  email: string;
  verified: boolean;
}) {
  const confirm = useConfirm();
  const [open, setOpen] = useState(false);

  // Sign-out is deliberately NOT run from inside an open menu/sheet — a mounted
  // Radix overlay can leave `pointer-events: none` on <body> after navigation.
  const handleSignOut = async () => {
    if (
      await confirm({
        title: 'Sign out?',
        description: 'You’ll need to log in again to get back into the studio.',
        confirmLabel: 'Sign out',
        destructive: true,
      })
    )
      void signOut();
  };

  return (
    <>
      <Panel>
        <Eyebrow>Sign-in &amp; security</Eyebrow>
        <div className="mt-4 flex flex-col gap-5">
          <Row
            icon={KeyRound}
            title="Password"
            description="Change the password you use to sign in."
            action={<InkButton onClick={() => setOpen(true)}>Update</InkButton>}
          />
          <div className="border-t border-[var(--hair)]" />
          <Row
            icon={verified ? MailCheck : ShieldCheck}
            title="Email verification"
            description={
              verified
                ? `${email} is verified.`
                : `${email} is not verified yet.`
            }
            action={
              verified ? (
                <span className="inline-flex items-center gap-1.5 rounded-[var(--radius-pill)] border border-[var(--hair-2)] px-3 py-1 text-xs font-medium text-[var(--ink-2)]">
                  <CheckCircle2
                    className="h-3.5 w-3.5"
                    style={{ color: 'var(--pigment)' }}
                  />
                  Verified
                </span>
              ) : (
                <span className="spec" style={{ fontSize: 10 }}>
                  Check your inbox
                </span>
              )
            }
          />
          <div className="border-t border-[var(--hair)]" />
          <Row
            icon={LogOut}
            title="Sign out"
            description="End this session on this device."
            action={
              <InkButton onClick={() => void handleSignOut()}>
                Sign out
              </InkButton>
            }
          />
        </div>
      </Panel>

      {open && (
        <ChangePasswordSheet email={email} onClose={() => setOpen(false)} />
      )}
    </>
  );
}

/**
 * Reauthenticate-then-update, the same flow as the shared security card: the
 * current password is verified with a fresh Supabase sign-in before the new one
 * is set server-side.
 */
function ChangePasswordSheet({
  email,
  onClose,
}: {
  email: string;
  onClose: () => void;
}) {
  const trpc = useTRPC();
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [confirmPw, setConfirmPw] = useState('');
  const [busy, setBusy] = useState(false);
  const changePassword = useMutation(
    trpc.users.changePassword.mutationOptions(),
  );

  const submit = async () => {
    if (next.length < 8)
      return toast.error('New password must be at least 8 characters');
    if (next !== confirmPw) return toast.error('Passwords do not match');
    setBusy(true);
    try {
      const { error } = await supabase.auth.signInWithPassword({
        email,
        password: current,
      });
      if (error) throw new Error('Current password is incorrect');
      await changePassword.mutateAsync({ newPassword: next });
      toast.success('Password updated');
      onClose();
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Sheet title="Change password" onClose={onClose}>
      <div className="flex flex-col gap-4">
        <Field label="Current password">
          <input
            className={FIELD}
            type="password"
            value={current}
            onChange={(e) => setCurrent(e.target.value)}
            autoComplete="current-password"
          />
        </Field>
        <Field label="New password" hint="At least 8 characters.">
          <input
            className={FIELD}
            type="password"
            value={next}
            onChange={(e) => setNext(e.target.value)}
            autoComplete="new-password"
          />
        </Field>
        <Field label="Confirm new password">
          <input
            className={FIELD}
            type="password"
            value={confirmPw}
            onChange={(e) => setConfirmPw(e.target.value)}
            autoComplete="new-password"
          />
        </Field>
        <div className="mt-1 flex justify-end gap-3">
          <InkButton onClick={onClose}>Cancel</InkButton>
          <PigmentButton
            onClick={() => void submit()}
            className={busy ? 'pointer-events-none opacity-60' : ''}
          >
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
            Update password
          </PigmentButton>
        </div>
      </div>
    </Sheet>
  );
}

/* ── Billing: Logo Studio only ─────────────────────────────────────────── */

function BillingSection() {
  const trpc = useTRPC();
  const qc = useQueryClient();
  const confirm = useConfirm();
  const { data: user } = useCurrentUser();
  const { brandId } = useLogoContext();

  // Card + invoices are owner-scoped on the server (`payments` brand access), so
  // only ask for them when the caller can actually manage billing.
  const canManageBilling =
    user?.role === 'brandOwner' ||
    (user?.permissions ?? []).includes('payments');

  const planQuery = useQuery(
    trpc.logo.assets.plan.queryOptions(
      { brandId: brandId! },
      { enabled: !!brandId },
    ),
  );
  const subsQuery = useQuery(
    trpc.featureSubscriptions.myForBrand.queryOptions(
      { brandId: brandId! },
      { enabled: !!brandId },
    ),
  );
  const cardQuery = useQuery(
    trpc.shortLinks.paymentMethod.queryOptions(
      { brandId: brandId! },
      { enabled: !!brandId && canManageBilling },
    ),
  );
  const invoicesQuery = useQuery(
    trpc.logo.billing.invoices.queryOptions(
      { brandId: brandId! },
      { enabled: !!brandId && canManageBilling },
    ),
  );

  const plan = planQuery.data;
  const product = plan?.product ?? null;
  const free = plan?.entitlement.free ?? true;
  const subs = (subsQuery.data?.subscriptions ?? []).filter((s) =>
    s.featureKeys.includes('logo_builder'),
  );
  const sub = subs.find((s) => s.active) ?? subs[0];
  const invoices = invoicesQuery.data ?? [];

  const invalidate = () => {
    void qc.invalidateQueries({
      queryKey: trpc.featureSubscriptions.myForBrand.queryKey(),
    });
    void qc.invalidateQueries({ queryKey: trpc.logo.assets.plan.queryKey() });
  };

  const checkout = useMutation(
    trpc.featureSubscriptions.checkout.mutationOptions(),
  );
  const cancel = useMutation({
    ...trpc.featureSubscriptions.cancel.mutationOptions(),
    onSuccess: () => {
      invalidate();
      toast.success('Your subscription will end at the period close.');
    },
    onError: (e) => toast.error(e.message),
  });
  const resume = useMutation({
    ...trpc.featureSubscriptions.resume.mutationOptions(),
    onSuccess: () => {
      invalidate();
      toast.success('Subscription resumed.');
    },
    onError: (e) => toast.error(e.message),
  });

  /** Shared checkout: charges a card on file (no url) or opens Stripe Checkout. */
  const subscribe = () => {
    if (!brandId || !product) return;
    const here = window.location.href;
    checkout.mutate(
      { brandId, priceId: product.priceId, successUrl: here, cancelUrl: here },
      {
        onSuccess: (res) => {
          if (res.url) {
            window.location.assign(res.url);
            return;
          }
          invalidate();
          toast.success('Logo Studio unlocked — your downloads are ready.');
        },
        onError: (e) => toast.error(e.message),
      },
    );
  };

  // ── Card on file (Stripe Elements via SetupIntent) ──────────────────────
  const [setupSecret, setSetupSecret] = useState<string | null>(null);
  const createSetupIntent = useMutation(
    trpc.shortLinks.createSetupIntent.mutationOptions(),
  );
  const setDefaultPm = useMutation(
    trpc.shortLinks.setDefaultPaymentMethod.mutationOptions(),
  );

  async function openCardForm() {
    if (!STRIPE_PUBLISHABLE_KEY) {
      toast.error('Card payments aren’t configured (missing Stripe key).');
      return;
    }
    try {
      const res = await createSetupIntent.mutateAsync({ brandId: brandId! });
      if (res.clientSecret) setSetupSecret(res.clientSecret);
      else toast.error('Card payments are not available right now.');
    } catch (e) {
      toast.error(
        e instanceof Error ? e.message : 'Could not start card setup.',
      );
    }
  }

  async function onCardSaved(paymentMethodId: string) {
    try {
      await setDefaultPm.mutateAsync({ brandId: brandId!, paymentMethodId });
      void qc.invalidateQueries({
        queryKey: trpc.shortLinks.paymentMethod.queryKey(),
      });
      setSetupSecret(null);
      toast.success('Card saved.');
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not save card.');
    }
  }

  if (planQuery.isLoading || subsQuery.isLoading) {
    return (
      <Panel>
        <div className="grid h-32 place-items-center">
          <Loader2 className="h-5 w-5 animate-spin text-[var(--ink-3)]" />
        </div>
      </Panel>
    );
  }

  const card = cardQuery.data;

  return (
    <>
      {/* Plan */}
      <Panel>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <Eyebrow>Your plan</Eyebrow>
          <span className="spec" style={{ fontSize: 10 }}>
            Billed through Prodesk · Stripe
          </span>
        </div>

        {sub ? (
          <>
            <div className="mt-5 grid grid-cols-1 gap-5 sm:grid-cols-3">
              <div>
                <div className="text-kpi tnum text-[var(--ink)]">
                  {money(sub.totalAmount, sub.currency ?? 'AUD')}
                </div>
                <div className="spec mt-1">per {sub.interval ?? 'month'}</div>
              </div>
              <div>
                <div className="text-kpi tnum text-[var(--ink)]">
                  {fmtDate(sub.currentPeriodEnd)}
                </div>
                <div className="spec mt-1">
                  {sub.cancelAtPeriodEnd ? 'Access ends' : 'Next invoice'}
                </div>
              </div>
              <div>
                <div
                  className="text-kpi tnum capitalize"
                  style={{ color: 'var(--pigment)' }}
                >
                  {sub.status}
                </div>
                <div className="spec mt-1">
                  {sub.productName ?? 'Logo Studio'}
                </div>
              </div>
            </div>
            {canManageBilling ? (
              <div className="mt-6 border-t border-[var(--hair)] pt-5">
                {sub.cancelAtPeriodEnd ? (
                  <PigmentButton
                    onClick={() => resume.mutate({ subscriptionId: sub.id })}
                  >
                    {resume.isPending ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : null}
                    Resume subscription
                  </PigmentButton>
                ) : (
                  <InkButton
                    onClick={() => {
                      void (async () => {
                        if (
                          await confirm({
                            title: 'Cancel subscription?',
                            description:
                              'It ends at the close of this billing period. Everything you have designed stays saved, and marks you already downloaded remain yours.',
                            confirmLabel: 'Cancel subscription',
                            cancelLabel: 'Keep it',
                            destructive: true,
                          })
                        )
                          cancel.mutate({ subscriptionId: sub.id });
                      })();
                    }}
                  >
                    {cancel.isPending ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : null}
                    Cancel subscription
                  </InkButton>
                )}
              </div>
            ) : (
              <p className="mt-5 text-xs text-[var(--ink-3)]">
                Billing is managed by the brand owner.
              </p>
            )}
          </>
        ) : (
          <div className="mt-4">
            <p className="text-lg font-semibold text-[var(--ink)]">
              {free ? 'Designing is free.' : 'No active subscription.'}
            </p>
            <p className="mt-1.5 max-w-xl text-sm text-[var(--ink-2)]">
              {free
                ? 'Every concept, edit and brand system is open while Logo Studio is in beta — downloads included, with full commercial rights on whatever you export.'
                : product
                  ? `${money(product.amount, product.currency)}/${product.interval} unlocks every download — vectors, rasters, favicons and the full asset kit.`
                  : 'You can design freely; downloading is what a plan unlocks once pricing is published.'}
            </p>
            {product && canManageBilling && (
              <PigmentButton className="mt-5" onClick={subscribe}>
                {checkout.isPending ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : null}
                {product.cardButtonLabel ||
                  `Subscribe — ${money(product.amount, product.currency)}`}
              </PigmentButton>
            )}
          </div>
        )}
      </Panel>

      {/* Card on file */}
      {canManageBilling && (
        <Panel>
          <Eyebrow>Card on file</Eyebrow>
          <div className="mt-4">
            {card ? (
              <Row
                icon={CreditCard}
                title={`${card.brand.toUpperCase()} ···· ${card.last4}`}
                description={`Expires ${String(card.expMonth).padStart(2, '0')}/${String(card.expYear).slice(-2)}`}
                action={
                  <InkButton onClick={() => void openCardForm()}>
                    {createSetupIntent.isPending ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : null}
                    Update card
                  </InkButton>
                }
              />
            ) : (
              <Row
                icon={CreditCard}
                title="No card saved"
                description="Add one so downloads and renewals go through without interruption."
                action={
                  <PigmentButton onClick={() => void openCardForm()}>
                    {createSetupIntent.isPending ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : null}
                    Add card
                  </PigmentButton>
                }
              />
            )}
          </div>
        </Panel>
      )}

      {/* Invoices — Logo Studio charges only */}
      {canManageBilling && (
        <Panel>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <Eyebrow>Invoices</Eyebrow>
            <span className="spec" style={{ fontSize: 10 }}>
              Logo Studio only
            </span>
          </div>
          {invoicesQuery.isLoading ? (
            <div className="grid h-20 place-items-center">
              <Loader2 className="h-4 w-4 animate-spin text-[var(--ink-3)]" />
            </div>
          ) : invoices.length === 0 ? (
            <p className="mt-4 text-sm text-[var(--ink-3)]">
              Nothing billed yet. Invoices appear here once a Logo Studio
              subscription starts.
            </p>
          ) : (
            <div className="mt-4 overflow-x-auto">
              <table className="w-full min-w-[420px] text-sm">
                <thead>
                  <tr className="border-b border-[var(--hair-2)] text-left">
                    <th className="spec pb-2 font-normal">Invoice</th>
                    <th className="spec pb-2 font-normal">Date</th>
                    <th className="spec pb-2 text-right font-normal">Amount</th>
                    <th className="spec pb-2 font-normal">Status</th>
                    <th className="pb-2" />
                  </tr>
                </thead>
                <tbody>
                  {invoices.map((inv) => (
                    <tr
                      key={inv.id}
                      className="border-b border-[var(--hair)] last:border-0"
                    >
                      <td className="py-2.5 font-mono text-xs text-[var(--ink-2)]">
                        {inv.number}
                      </td>
                      <td className="py-2.5 text-[var(--ink-2)]">
                        {fmtDate(inv.periodStart ?? inv.created)}
                      </td>
                      <td className="tnum py-2.5 text-right text-[var(--ink)]">
                        {money(inv.amount, inv.currency)}
                      </td>
                      <td className="py-2.5 capitalize text-[var(--ink-2)]">
                        {inv.status === 'paid' ? 'Paid' : inv.status}
                      </td>
                      <td className="py-2.5 text-right">
                        {inv.pdfUrl ? (
                          <a
                            href={inv.pdfUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            aria-label="Download invoice"
                            className="inline-flex text-[var(--ink-3)] transition hover:text-[var(--ink)]"
                          >
                            <Download className="h-4 w-4" />
                          </a>
                        ) : inv.hostedUrl ? (
                          <a
                            href={inv.hostedUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            aria-label="View invoice"
                            className="inline-flex text-[var(--ink-3)] transition hover:text-[var(--ink)]"
                          >
                            <ExternalLink className="h-4 w-4" />
                          </a>
                        ) : null}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Panel>
      )}

      {setupSecret && STRIPE_PUBLISHABLE_KEY && (
        <Sheet title="Card details" onClose={() => setSetupSecret(null)}>
          <StripeCardSetup
            publishableKey={STRIPE_PUBLISHABLE_KEY}
            clientSecret={setupSecret}
            submitClassName="press inline-flex h-11 w-full items-center justify-center gap-2 rounded-[var(--radius-pill)] bg-[var(--pigment)] px-6 text-sm font-semibold text-white"
            submitLabel="Save card"
            onSaved={onCardSaved}
            onError={(m) => toast.error(m)}
          />
        </Sheet>
      )}
    </>
  );
}
