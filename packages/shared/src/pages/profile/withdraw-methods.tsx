import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CreditCard, Landmark, Wallet, Info, AlertTriangle } from 'lucide-react';
import { toast } from 'sonner';
import { toastError } from '../../lib/errors';
import { useTRPC } from '../../lib/trpc';
import { reserveNewTab } from '../../lib/redirect';
import { Button } from '../../components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '../../components/ui/card';
import { Input } from '../../components/ui/input';
import { Label } from '../../components/ui/label';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '../../components/ui/dialog';

export type Method = 'stripe' | 'paypal' | 'wire';

export interface WiseAccountOption {
  id: number;
  accountHolderName: string;
  currency: string;
  country: string;
  bankName: string;
  accountNumber: string;
  routingNumber: string;
  swiftCode: string;
}

interface PayoutUser {
  email: string;
  firstName?: string | null;
  lastName?: string | null;
  stripeAccountId?: string | null;
  bankAccountLinked: boolean;
  activePayoutMethod?: string | null;
  payoutMethods?: Record<string, unknown> | null;
}

export const NAMES: Record<Method, string> = {
  stripe: 'Stripe',
  paypal: 'PayPal',
  wire: 'Wire transfer',
};

export function maskTail(v: string, tail = 4) {
  if (!v) return '';
  return v.length <= tail ? v : `••••${v.slice(-tail)}`;
}

export function MethodCard({
  icon,
  name,
  description,
  active,
  details,
  actions,
  warning,
}: {
  icon: React.ReactNode;
  name: string;
  description: string;
  active: boolean;
  details?: string;
  actions: React.ReactNode;
  warning?: string;
}) {
  return (
    <div
      className={`overflow-hidden rounded-[var(--radius-md)] border ${active ? 'border-l-4 border-accent' : 'border-[color:var(--color-border-default)]'}`}
    >
      {/* On mobile: icon + name(+ACTIVE badge) + actions stay on row 1; the
          description / details / warning drop below, full-width (max-md:order-last
          + w-full). On desktop the text block keeps its flex-1 middle column. */}
      <div className="flex flex-wrap items-center gap-4 p-4 md:p-5">
        <span
          className={`grid h-12 w-12 place-items-center rounded-[var(--radius-md)] ${active ? 'bg-accent/15 text-accent' : 'bg-inset text-ink-60'}`}
        >
          {icon}
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="font-semibold text-ink-100">{name}</span>
            {active && (
              <span className="rounded-[4px] border border-ink-100 bg-accent/15 px-1.5 py-0.5 font-mono text-[10px] font-bold uppercase tracking-wide text-ink-100">
                Active
              </span>
            )}
          </div>
          {/* Desktop only — on mobile this same content renders in the full-width row below. */}
          <div className="max-md:hidden">
            <div className="text-sm text-ink-60">{description}</div>
            {active && details && (
              <div className="mt-2 font-mono text-xs text-ink-80">
                {details}
              </div>
            )}
            {warning && (
              <div className="mt-1 flex items-center gap-1 text-xs text-warn">
                <AlertTriangle className="h-3.5 w-3.5" /> {warning}
              </div>
            )}
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">{actions}</div>
        {/* Mobile-only full-width text row. */}
        <div className="w-full md:hidden max-md:order-last">
          <div className="text-sm text-ink-60">{description}</div>
          {active && details && (
            <div className="mt-2 font-mono text-xs text-ink-80">{details}</div>
          )}
          {warning && (
            <div className="mt-1 flex items-center gap-1 text-xs text-warn">
              <AlertTriangle className="h-3.5 w-3.5" /> {warning}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

/**
 * Payout method management: info banner, one card per method (Stripe / PayPal /
 * Wire), ACTIVE badge, masked details, switch/disconnect with confirm, and
 * per-method connect flows. Exactly one method is active at a time and receives
 * the beneficiary's payouts.
 */
export function WithdrawMethodsPanel({
  user,
  meKey,
}: {
  user: PayoutUser;
  meKey: unknown;
}) {
  const trpc = useTRPC();
  const qc = useQueryClient();
  const pm = (user.payoutMethods ?? {}) as Record<
    string,
    Record<string, string> | undefined
  >;

  const hasStripe = !!user.stripeAccountId && user.bankAccountLinked;
  const hasStripeAccount = !!user.stripeAccountId;
  const hasPaypal = !!pm.paypal?.email;
  const hasWire = !!pm.wire?.bankName && !!pm.wire?.accountNumber;
  const hasAny = hasStripe || hasPaypal || hasWire;

  // Effective active method (prefer explicit, else first connected).
  let active: Method | null = (user.activePayoutMethod as Method) ?? null;
  if (!active && hasAny) active = hasStripe ? 'stripe' : hasPaypal ? 'paypal' : 'wire';
  if (active === 'stripe' && !hasStripe) active = null;
  if (active === 'paypal' && !hasPaypal) active = null;
  if (active === 'wire' && !hasWire) active = null;

  const invalidate = () => qc.invalidateQueries({ queryKey: meKey as never });

  const stripeStatus = useQuery({
    ...trpc.users.stripeAccountStatus.queryOptions(),
    enabled: hasStripeAccount,
  });
  const createStripeLink = useMutation(
    trpc.users.createStripeConnectLink.mutationOptions(),
  );
  const linkWise = useMutation({
    ...trpc.users.linkWiseRecipient.mutationOptions(),
    onSuccess: () => {
      toast.success('Bank account linked');
      invalidate();
    },
    onError: (e) => toastError(e),
  });
  const setActive = useMutation({
    ...trpc.users.setActivePayoutMethod.mutationOptions(),
    onSuccess: invalidate,
    onError: (e) => toastError(e),
  });
  const removeMethod = useMutation({
    ...trpc.users.removePayoutMethod.mutationOptions(),
    onSuccess: () => {
      toast.success('Disconnected');
      invalidate();
    },
    onError: (e) => toastError(e),
  });
  const savePaypal = useMutation({
    ...trpc.users.savePayoutMethodDetails.mutationOptions(),
    onError: (e) => toastError(e),
  });

  const [wireOpen, setWireOpen] = useState(false);
  const [paypalOpen, setPaypalOpen] = useState(false);
  const [confirm, setConfirm] = useState<{
    title: string;
    body: string;
    danger: boolean;
    action: () => void;
  } | null>(null);

  // Wise OAuth: connect → pick from the user's existing Wise recipient accounts.
  const getWiseUrl = useMutation(trpc.users.getWiseAuthUrl.mutationOptions());
  const exchangeWise = useMutation(
    trpc.users.exchangeWiseCode.mutationOptions(),
  );
  const [wiseAccounts, setWiseAccounts] = useState<WiseAccountOption[]>([]);
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get('wise_callback') === 'true' && params.get('code')) {
      const code = params.get('code')!;
      const url = new URL(window.location.href);
      ['wise_callback', 'code', 'state'].forEach((k) =>
        url.searchParams.delete(k),
      );
      window.history.replaceState({}, '', url.toString());
      exchangeWise
        .mutateAsync({ code })
        .then((res) => {
          if (res.accounts?.length)
            setWiseAccounts(res.accounts as WiseAccountOption[]);
          else
            toast.message(
              'No Wise recipient accounts found (or Wise OAuth not configured).',
            );
        })
        .catch((e) => toast.error((e as Error).message));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function connectWise() {
    const tab = reserveNewTab(); // reserved against the click; OAuth opens in a new tab
    try {
      const res = await getWiseUrl.mutateAsync(undefined);
      if (res.url) tab.go(res.url);
      else {
        tab.cancel();
        toast.message('Wise OAuth is not configured in this environment.');
      }
    } catch (e) {
      tab.cancel();
      toast.error((e as Error).message);
    }
  }

  async function startConnect(method: Method) {
    if (method === 'stripe') {
      const tab = reserveNewTab(); // reserved against the click; onboarding opens in a new tab
      try {
        const res = await createStripeLink.mutateAsync({ country: 'AU' });
        if (res.url) tab.go(res.url);
        else {
          tab.cancel();
          toast.message('Stripe Connect is not available in this environment.');
        }
      } catch (e) {
        tab.cancel();
        toast.error((e as Error).message);
      }
    } else if (method === 'paypal') {
      setPaypalOpen(true);
    } else {
      setWireOpen(true);
    }
  }

  function disconnect(method: Method) {
    if (method === 'stripe') removeMethod.mutate({ method: 'stripe' });
    else removeMethod.mutate({ method });
  }

  function confirmDisconnect(method: Method) {
    setConfirm({
      title: `Disconnect ${NAMES[method]}?`,
      body: `You won't be able to receive payouts until you connect another method. You can reconnect ${NAMES[method]} any time.`,
      danger: true,
      action: () => disconnect(method),
    });
  }

  function confirmSwitch(from: Method, to: Method) {
    setConfirm({
      title: `Switch to ${NAMES[to]}?`,
      body: `Your current ${NAMES[from]} account will be disconnected and we'll guide you through linking ${NAMES[to]}. Future payouts will go to the new method.`,
      danger: false,
      action: async () => {
        disconnect(from);
        await startConnect(to);
      },
    });
  }

  function actionsFor(method: Method) {
    const busy =
      setActive.isPending ||
      removeMethod.isPending ||
      createStripeLink.isPending ||
      savePaypal.isPending;
    if (method === 'stripe') {
      if (hasStripeAccount) {
        return (
          <>
            <Button
              variant="outline"
              disabled={busy}
              onClick={() => confirmDisconnect('stripe')}
            >
              Disconnect
            </Button>
            <Button disabled={busy} onClick={() => startConnect('stripe')}>
              Update
            </Button>
          </>
        );
      }
      return (
        <Button disabled={busy} onClick={() => startConnect('stripe')}>
          Connect
        </Button>
      );
    }
    if (active === method) {
      // Wire is editable in place: "Update" reopens the form pre-filled from the
      // stored record (WireDialog receives initial={pm.wire}) and re-links on save.
      return (
        <>
          <Button
            variant="outline"
            disabled={busy}
            onClick={() => confirmDisconnect(method)}
          >
            Disconnect
          </Button>
          <Button disabled={busy} onClick={() => startConnect(method)}>
            Update
          </Button>
        </>
      );
    }
    if (hasAny && active) {
      return (
        <>
          <Button
            disabled={busy}
            onClick={() => confirmSwitch(active!, method)}
          >
            Switch to {NAMES[method]}
          </Button>
          <Button
            variant="outline"
            disabled={busy}
            onClick={() => confirmDisconnect(active!)}
          >
            Disconnect
          </Button>
        </>
      );
    }
    return (
      <Button disabled={busy} onClick={() => startConnect(method)}>
        Connect
      </Button>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Payout Settings</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <div className="flex items-start gap-3 rounded-[var(--radius-md)] border border-[color:var(--color-border-hairline)] bg-inset px-4 py-3 text-sm text-ink-60">
          <Info className="mt-0.5 h-4 w-4 shrink-0" />
          <p>
            <span className="font-semibold text-ink-100">
              One active method at a time.{' '}
            </span>
            Connecting a new provider moves your payouts to it and automatically
            disconnects the current one — we'll always confirm before anything
            changes.
          </p>
        </div>

        <MethodCard
          icon={<CreditCard className="h-5 w-5" />}
          name="Stripe"
          description="Card payments & instant bank payouts · 135+ currencies"
          active={active === 'stripe'}
          details={
            hasStripeAccount
              ? `acct ${maskTail(user.stripeAccountId ?? '')} / Stripe Connect`
              : undefined
          }
          warning={
            hasStripeAccount &&
            !user.bankAccountLinked &&
            stripeStatus.data &&
            !stripeStatus.data.payoutsEnabled
              ? 'Incomplete setup.'
              : undefined
          }
          actions={actionsFor('stripe')}
        />

        <MethodCard
          icon={<Wallet className="h-5 w-5" />}
          name="PayPal"
          description="Payouts to your PayPal balance · most countries"
          active={active === 'paypal'}
          details={hasPaypal ? pm.paypal?.email : undefined}
          actions={actionsFor('paypal')}
        />

        <MethodCard
          icon={<Landmark className="h-5 w-5" />}
          name="Wire transfer"
          description="Direct to your bank account · 5–6 business days"
          active={active === 'wire'}
          details={
            hasWire
              ? `${pm.wire?.bankName ?? ''} / acct ${maskTail(pm.wire?.accountNumber ?? '')}`
              : undefined
          }
          actions={actionsFor('wire')}
        />
      </CardContent>

      {/* Wise OAuth recipient picker — shown after a successful connect callback. */}
      <Dialog
        open={wiseAccounts.length > 0}
        onOpenChange={(o) => !o && setWiseAccounts([])}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Choose a Wise account</DialogTitle>
            <DialogDescription>
              Select the bank account that should receive your payouts.
            </DialogDescription>
          </DialogHeader>
          <div className="flex flex-col gap-2">
            {wiseAccounts.map((acc) => (
              <button
                key={acc.id}
                className="rounded-[var(--radius-sm)] border border-[color:var(--color-border-default)] p-3 text-left text-sm hover:bg-inset"
                disabled={linkWise.isPending}
                onClick={async () => {
                  await linkWise.mutateAsync({
                    accountHolderName: acc.accountHolderName,
                    currency: acc.currency || 'AUD',
                    bankName: acc.bankName,
                    accountNumber: acc.accountNumber,
                    routingNumber: acc.routingNumber,
                    swiftCode: acc.swiftCode,
                    country: acc.country,
                  });
                  setWiseAccounts([]);
                }}
              >
                <div className="font-medium text-ink-100">
                  {acc.bankName || acc.accountHolderName || 'Bank account'}
                </div>
                <div className="text-ink-60">
                  {acc.accountHolderName} · {acc.currency} · acct{' '}
                  {maskTail(acc.accountNumber)}
                </div>
              </button>
            ))}
          </div>
        </DialogContent>
      </Dialog>

      <WireDialog
        open={wireOpen}
        onOpenChange={setWireOpen}
        initial={pm.wire}
        defaultHolder={
          [user.firstName, user.lastName].filter(Boolean).join(' ') ||
          user.email
        }
        onWiseConnect={connectWise}
        onSave={async (details) => {
          await linkWise.mutateAsync({
            accountHolderName: details.accountHolderName,
            currency: null,
            bankName: details.bankName,
            accountNumber: details.accountNumber,
            routingNumber: details.routingNumber,
            swiftCode: details.swiftCode,
            country: details.country,
            accountType: details.accountType,
            address: details.address,
          });
          setWireOpen(false);
        }}
        saving={linkWise.isPending}
      />

      <PaypalDialog
        open={paypalOpen}
        onOpenChange={setPaypalOpen}
        initialEmail={pm.paypal?.email}
        onSave={async (email) => {
          await savePaypal.mutateAsync({ method: 'paypal', details: { email } });
          await setActive.mutateAsync({ method: 'paypal' });
          toast.success('PayPal connected');
          setPaypalOpen(false);
        }}
        saving={savePaypal.isPending}
      />

      <Dialog open={!!confirm} onOpenChange={(v) => !v && setConfirm(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{confirm?.title}</DialogTitle>
            <DialogDescription>{confirm?.body}</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setConfirm(null)}>
              Cancel
            </Button>
            <Button
              variant={confirm?.danger ? 'danger' : 'accent'}
              onClick={() => {
                confirm?.action();
                setConfirm(null);
              }}
            >
              {confirm?.danger ? 'Disconnect' : 'Continue'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}

/**
 * PayPal connect dialog — PayPal payouts are sent to the recipient's account
 * email (see dispatch.ts → payViaPaypal), so this collects just that. The email
 * is merged into `payoutMethods.paypal.email` by the caller.
 */
export function PaypalDialog({
  open,
  onOpenChange,
  initialEmail,
  onSave,
  saving,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  initialEmail?: string;
  onSave: (email: string) => void;
  saving: boolean;
}) {
  const [email, setEmail] = useState(initialEmail ?? '');
  useEffect(() => {
    if (open) setEmail(initialEmail ?? '');
  }, [open, initialEmail]);

  function submit() {
    const v = email.trim();
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(v))
      return toast.error('Enter a valid PayPal email address');
    onSave(v);
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>
            {initialEmail ? 'Update PayPal' : 'Link PayPal'}
          </DialogTitle>
          <DialogDescription>
            Payouts are sent to the email address on your PayPal account.
          </DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-1.5">
          <Label>PayPal email</Label>
          <Input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="you@example.com"
          />
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button variant="accent" disabled={saving} onClick={submit}>
            {saving ? 'Saving…' : 'Save'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export interface WireDetails {
  accountHolderName: string;
  bankName: string;
  accountNumber: string;
  routingNumber: string | null;
  swiftCode: string | null;
  country: string;
  currency: string | null;
  accountType?: string | null;
  address?: {
    firstLine?: string;
    city?: string;
    state?: string;
    postCode?: string;
    country?: string;
  } | null;
}

const SWIFT_RE = /^[A-Z]{6}[A-Z0-9]{2}([A-Z0-9]{3})?$/;

const COUNTRIES = [
  { code: 'AF', name: 'Afghanistan (AF)' },
  { code: 'AL', name: 'Albania (AL)' },
  { code: 'DZ', name: 'Algeria (DZ)' },
  { code: 'AD', name: 'Andorra (AD)' },
  { code: 'AO', name: 'Angola (AO)' },
  { code: 'AG', name: 'Antigua and Barbuda (AG)' },
  { code: 'AR', name: 'Argentina (AR)' },
  { code: 'AM', name: 'Armenia (AM)' },
  { code: 'AU', name: 'Australia (AU)' },
  { code: 'AT', name: 'Austria (AT)' },
  { code: 'AZ', name: 'Azerbaijan (AZ)' },
  { code: 'BS', name: 'Bahamas (BS)' },
  { code: 'BH', name: 'Bahrain (BH)' },
  { code: 'BD', name: 'Bangladesh (BD)' },
  { code: 'BB', name: 'Barbados (BB)' },
  { code: 'BY', name: 'Belarus (BY)' },
  { code: 'BE', name: 'Belgium (BE)' },
  { code: 'BZ', name: 'Belize (BZ)' },
  { code: 'BJ', name: 'Benin (BJ)' },
  { code: 'BT', name: 'Bhutan (BT)' },
  { code: 'BO', name: 'Bolivia (BO)' },
  { code: 'BA', name: 'Bosnia and Herzegovina (BA)' },
  { code: 'BW', name: 'Botswana (BW)' },
  { code: 'BR', name: 'Brazil (BR)' },
  { code: 'BN', name: 'Brunei Darussalam (BN)' },
  { code: 'BG', name: 'Bulgaria (BG)' },
  { code: 'BF', name: 'Burkina Faso (BF)' },
  { code: 'BI', name: 'Burundi (BI)' },
  { code: 'KH', name: 'Cambodia (KH)' },
  { code: 'CM', name: 'Cameroon (CM)' },
  { code: 'CA', name: 'Canada (CA)' },
  { code: 'CV', name: 'Cape Verde (CV)' },
  { code: 'CF', name: 'Central African Republic (CF)' },
  { code: 'TD', name: 'Chad (TD)' },
  { code: 'CL', name: 'Chile (CL)' },
  { code: 'CN', name: 'China (CN)' },
  { code: 'CO', name: 'Colombia (CO)' },
  { code: 'KM', name: 'Comoros (KM)' },
  { code: 'CG', name: 'Congo (CG)' },
  { code: 'CD', name: 'Congo (Democratic Republic) (CD)' },
  { code: 'CR', name: 'Costa Rica (CR)' },
  { code: 'CI', name: "Côte d'Ivoire (CI)" },
  { code: 'HR', name: 'Croatia (HR)' },
  { code: 'CU', name: 'Cuba (CU)' },
  { code: 'CY', name: 'Cyprus (CY)' },
  { code: 'CZ', name: 'Czech Republic (CZ)' },
  { code: 'DK', name: 'Denmark (DK)' },
  { code: 'DJ', name: 'Djibouti (DJ)' },
  { code: 'DM', name: 'Dominica (DM)' },
  { code: 'DO', name: 'Dominican Republic (DO)' },
  { code: 'EC', name: 'Ecuador (EC)' },
  { code: 'EG', name: 'Egypt (EG)' },
  { code: 'SV', name: 'El Salvador (SV)' },
  { code: 'GQ', name: 'Equatorial Guinea (GQ)' },
  { code: 'ER', name: 'Eritrea (ER)' },
  { code: 'EE', name: 'Estonia (EE)' },
  { code: 'SZ', name: 'Eswatini (SZ)' },
  { code: 'ET', name: 'Ethiopia (ET)' },
  { code: 'FJ', name: 'Fiji (FJ)' },
  { code: 'FI', name: 'Finland (FI)' },
  { code: 'FR', name: 'France (FR)' },
  { code: 'GA', name: 'Gabon (GA)' },
  { code: 'GM', name: 'Gambia (GM)' },
  { code: 'GE', name: 'Georgia (GE)' },
  { code: 'DE', name: 'Germany (DE)' },
  { code: 'GH', name: 'Ghana (GH)' },
  { code: 'GR', name: 'Greece (GR)' },
  { code: 'GD', name: 'Grenada (GD)' },
  { code: 'GT', name: 'Guatemala (GT)' },
  { code: 'GN', name: 'Guinea (GN)' },
  { code: 'GW', name: 'Guinea-Bissau (GW)' },
  { code: 'GY', name: 'Guyana (GY)' },
  { code: 'HT', name: 'Haiti (HT)' },
  { code: 'HN', name: 'Honduras (HN)' },
  { code: 'HK', name: 'Hong Kong (HK)' },
  { code: 'HU', name: 'Hungary (HU)' },
  { code: 'IS', name: 'Iceland (IS)' },
  { code: 'IN', name: 'India (IN)' },
  { code: 'ID', name: 'Indonesia (ID)' },
  { code: 'IR', name: 'Iran (IR)' },
  { code: 'IQ', name: 'Iraq (IQ)' },
  { code: 'IE', name: 'Ireland (IE)' },
  { code: 'IL', name: 'Israel (IL)' },
  { code: 'IT', name: 'Italy (IT)' },
  { code: 'JM', name: 'Jamaica (JM)' },
  { code: 'JP', name: 'Japan (JP)' },
  { code: 'JO', name: 'Jordan (JO)' },
  { code: 'KZ', name: 'Kazakhstan (KZ)' },
  { code: 'KE', name: 'Kenya (KE)' },
  { code: 'KI', name: 'Kiribati (KI)' },
  { code: 'KP', name: 'North Korea (KP)' },
  { code: 'KR', name: 'South Korea (KR)' },
  { code: 'KW', name: 'Kuwait (KW)' },
  { code: 'KG', name: 'Kyrgyzstan (KG)' },
  { code: 'LA', name: 'Laos (LA)' },
  { code: 'LV', name: 'Latvia (LV)' },
  { code: 'LB', name: 'Lebanon (LB)' },
  { code: 'LS', name: 'Lesotho (LS)' },
  { code: 'LR', name: 'Liberia (LR)' },
  { code: 'LY', name: 'Libya (LY)' },
  { code: 'LI', name: 'Liechtenstein (LI)' },
  { code: 'LT', name: 'Lithuania (LT)' },
  { code: 'LU', name: 'Luxembourg (LU)' },
  { code: 'MO', name: 'Macao (MO)' },
  { code: 'MG', name: 'Madagascar (MG)' },
  { code: 'MW', name: 'Malawi (MW)' },
  { code: 'MY', name: 'Malaysia (MY)' },
  { code: 'MV', name: 'Maldives (MV)' },
  { code: 'ML', name: 'Mali (ML)' },
  { code: 'MT', name: 'Malta (MT)' },
  { code: 'MH', name: 'Marshall Islands (MH)' },
  { code: 'MR', name: 'Mauritania (MR)' },
  { code: 'MU', name: 'Mauritius (MU)' },
  { code: 'MX', name: 'Mexico (MX)' },
  { code: 'FM', name: 'Micronesia (FM)' },
  { code: 'MD', name: 'Moldova (MD)' },
  { code: 'MC', name: 'Monaco (MC)' },
  { code: 'MN', name: 'Mongolia (MN)' },
  { code: 'ME', name: 'Montenegro (ME)' },
  { code: 'MA', name: 'Morocco (MA)' },
  { code: 'MZ', name: 'Mozambique (MZ)' },
  { code: 'MM', name: 'Myanmar (MM)' },
  { code: 'NA', name: 'Namibia (NA)' },
  { code: 'NR', name: 'Nauru (NR)' },
  { code: 'NP', name: 'Nepal (NP)' },
  { code: 'NL', name: 'Netherlands (NL)' },
  { code: 'NZ', name: 'New Zealand (NZ)' },
  { code: 'NI', name: 'Nicaragua (NI)' },
  { code: 'NE', name: 'Niger (NE)' },
  { code: 'NG', name: 'Nigeria (NG)' },
  { code: 'NO', name: 'Norway (NO)' },
  { code: 'OM', name: 'Oman (OM)' },
  { code: 'PK', name: 'Pakistan (PK)' },
  { code: 'PW', name: 'Palau (PW)' },
  { code: 'PA', name: 'Panama (PA)' },
  { code: 'PG', name: 'Papua New Guinea (PG)' },
  { code: 'PY', name: 'Paraguay (PY)' },
  { code: 'PE', name: 'Peru (PE)' },
  { code: 'PH', name: 'Philippines (PH)' },
  { code: 'PL', name: 'Poland (PL)' },
  { code: 'PT', name: 'Portugal (PT)' },
  { code: 'QA', name: 'Qatar (QA)' },
  { code: 'RO', name: 'Romania (RO)' },
  { code: 'RU', name: 'Russia (RU)' },
  { code: 'RW', name: 'Rwanda (RW)' },
  { code: 'KN', name: 'Saint Kitts and Nevis (KN)' },
  { code: 'LC', name: 'Saint Lucia (LC)' },
  { code: 'VC', name: 'Saint Vincent and the Grenadines (VC)' },
  { code: 'WS', name: 'Samoa (WS)' },
  { code: 'SM', name: 'San Marino (SM)' },
  { code: 'ST', name: 'Sao Tome and Principe (ST)' },
  { code: 'SA', name: 'Saudi Arabia (SA)' },
  { code: 'SN', name: 'Senegal (SN)' },
  { code: 'RS', name: 'Serbia (RS)' },
  { code: 'SC', name: 'Seychelles (SC)' },
  { code: 'SL', name: 'Sierra Leone (SL)' },
  { code: 'SG', name: 'Singapore (SG)' },
  { code: 'SK', name: 'Slovakia (SK)' },
  { code: 'SI', name: 'Slovenia (SI)' },
  { code: 'SB', name: 'Solomon Islands (SB)' },
  { code: 'SO', name: 'Somalia (SO)' },
  { code: 'ZA', name: 'South Africa (ZA)' },
  { code: 'SS', name: 'South Sudan (SS)' },
  { code: 'ES', name: 'Spain (ES)' },
  { code: 'LK', name: 'Sri Lanka (LK)' },
  { code: 'SD', name: 'Sudan (SD)' },
  { code: 'SR', name: 'Suriname (SR)' },
  { code: 'SE', name: 'Sweden (SE)' },
  { code: 'CH', name: 'Switzerland (CH)' },
  { code: 'SY', name: 'Syria (SY)' },
  { code: 'TW', name: 'Taiwan (TW)' },
  { code: 'TJ', name: 'Tajikistan (TJ)' },
  { code: 'TZ', name: 'Tanzania (TZ)' },
  { code: 'TH', name: 'Thailand (TH)' },
  { code: 'TL', name: 'Timor-Leste (TL)' },
  { code: 'TG', name: 'Togo (TG)' },
  { code: 'TO', name: 'Tonga (TO)' },
  { code: 'TT', name: 'Trinidad and Tobago (TT)' },
  { code: 'TN', name: 'Tunisia (TN)' },
  { code: 'TR', name: 'Turkey (TR)' },
  { code: 'TM', name: 'Turkmenistan (TM)' },
  { code: 'TV', name: 'Tuvalu (TV)' },
  { code: 'UG', name: 'Uganda (UG)' },
  { code: 'UA', name: 'Ukraine (UA)' },
  { code: 'AE', name: 'United Arab Emirates (AE)' },
  { code: 'GB', name: 'United Kingdom (GB)' },
  { code: 'US', name: 'United States (US)' },
  { code: 'UY', name: 'Uruguay (UY)' },
  { code: 'UZ', name: 'Uzbekistan (UZ)' },
  { code: 'VU', name: 'Vanuatu (VU)' },
  { code: 'VE', name: 'Venezuela (VE)' },
  { code: 'VN', name: 'Vietnam (VN)' },
  { code: 'YE', name: 'Yemen (YE)' },
  { code: 'ZM', name: 'Zambia (ZM)' },
  { code: 'ZW', name: 'Zimbabwe (ZW)' },
];

const COUNTRY_BANKS: Record<string, string[]> = {
  AU: ['Commonwealth Bank', 'ANZ', 'Westpac', 'NAB', 'Macquarie Bank'],
  US: ['Chase', 'Bank of America', 'Wells Fargo', 'Citibank', 'Capital One'],
  GB: ['HSBC', 'Barclays', 'Lloyds Bank', 'NatWest', 'Santander'],
  NZ: ['ANZ NZ', 'ASB', 'Westpac NZ', 'BNZ', 'Kiwibank'],
  CA: ['RBC', 'TD Bank', 'Scotiabank', 'BMO', 'CIBC'],
  SG: ['DBS', 'OCBC', 'UOB'],
};

export function WireDialog({
  open,
  onOpenChange,
  initial,
  defaultHolder,
  onSave,
  saving,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  initial?: any;
  defaultHolder: string;
  onSave: (d: WireDetails) => void;
  onWiseConnect?: () => void;
  saving: boolean;
}) {
  const [d, setD] = useState<
    Omit<WireDetails, 'country' | 'currency' | 'bankName'>
  >({
    accountHolderName: initial?.accountHolderName ?? defaultHolder,
    accountNumber: initial?.accountNumber ?? '',
    routingNumber: initial?.routingNumber ?? '',
    swiftCode: initial?.swiftCode ?? '',
  });

  const [selectedCountry, setSelectedCountry] = useState(
    initial?.country ?? 'AU',
  );
  const selectedCurrency = null;

  const hasMajorBanks = selectedCountry in COUNTRY_BANKS;
  const majorBanks = COUNTRY_BANKS[selectedCountry] || [];
  const isInitialBankInMajor =
    initial?.bankName && majorBanks.includes(initial.bankName);

  const [bankSelection, setBankSelection] = useState(
    initial?.bankName
      ? isInitialBankInMajor
        ? initial.bankName
        : 'Other'
      : hasMajorBanks
        ? majorBanks[0]
        : 'Other',
  );

  const [customBankName, setCustomBankName] = useState(
    initial?.bankName ? (isInitialBankInMajor ? '' : initial.bankName) : '',
  );

  const [selectedAccountType, setSelectedAccountType] = useState(
    initial?.accountType ?? 'CHECKING',
  );
  const [addressLine1, setAddressLine1] = useState(
    initial?.address?.firstLine ?? '',
  );
  const [addressCity, setAddressCity] = useState(initial?.address?.city ?? '');
  const [addressState, setAddressState] = useState(
    initial?.address?.state ?? '',
  );
  const [addressPostCode, setAddressPostCode] = useState(
    initial?.address?.postCode ?? '',
  );
  const [selectedAddressCountry, setSelectedAddressCountry] = useState(
    initial?.address?.country ?? initial?.country ?? 'US',
  );

  useEffect(() => {
    if (open) {
      setD({
        accountHolderName: initial?.accountHolderName ?? defaultHolder,
        accountNumber: initial?.accountNumber ?? '',
        routingNumber: initial?.routingNumber ?? '',
        swiftCode: initial?.swiftCode ?? '',
      });
      setSelectedCountry(initial?.country ?? 'AU');
      const nextBanks = COUNTRY_BANKS[initial?.country ?? 'AU'] || [];
      const isInMajor =
        initial?.bankName && nextBanks.includes(initial.bankName);
      setBankSelection(
        initial?.bankName
          ? isInMajor
            ? initial.bankName
            : 'Other'
          : nextBanks.length > 0
            ? nextBanks[0]
            : 'Other',
      );
      setCustomBankName(
        initial?.bankName ? (isInMajor ? '' : initial.bankName) : '',
      );
      setSelectedAccountType(initial?.accountType ?? 'CHECKING');
      setAddressLine1(initial?.address?.firstLine ?? '');
      setAddressCity(initial?.address?.city ?? '');
      setAddressState(initial?.address?.state ?? '');
      setAddressPostCode(initial?.address?.postCode ?? '');
      setSelectedAddressCountry(
        initial?.address?.country ?? initial?.country ?? 'US',
      );
    }
  }, [open, initial, defaultHolder]);

  const set =
    (k: keyof Omit<WireDetails, 'country' | 'currency' | 'bankName'>) =>
    (e: React.ChangeEvent<HTMLInputElement>) =>
      setD({ ...d, [k]: e.target.value });

  const handleCountryChange = (countryCode: string) => {
    setSelectedCountry(countryCode);

    const nextBanks = COUNTRY_BANKS[countryCode] || [];
    if (nextBanks.length > 0) {
      setBankSelection(nextBanks[0]);
      setCustomBankName('');
    } else {
      setBankSelection('Other');
      setCustomBankName('');
    }
  };

  function validate(): string | null {
    if (d.accountHolderName.trim().length < 2)
      return 'Account holder name is too short';

    const resolvedBankName =
      bankSelection === 'Other' ? customBankName.trim() : bankSelection;
    const hasSwift = (d.swiftCode || '').trim().length > 0;
    const hasRouting = (d.routingNumber || '').trim().length > 0;

    if (!hasSwift && resolvedBankName.length < 2) {
      return 'Bank name is too short or required';
    }

    const acct = d.accountNumber.trim();
    if (acct.length < 4 || acct.length > 34)
      return 'Account number / IBAN must be 4–34 characters';
    if (!/^[A-Za-z0-9 \-]+$/.test(acct))
      return 'Account number: only letters, numbers, spaces or dashes';

    if (hasSwift && !SWIFT_RE.test((d.swiftCode || '').trim().toUpperCase())) {
      return 'Invalid SWIFT / BIC code format';
    }

    // Australian payouts go through Wise's domestic `australian` account type,
    // which strictly requires a BSB. Wise offers no SWIFT-only type for AUD, so a
    // SWIFT code can't substitute — require the BSB here rather than letting the
    // server's recipient creation fail with an opaque "BSB code" error.
    if (selectedCountry === 'AU') {
      const bsb = (d.routingNumber || '').replace(/[\s-]/g, '');
      if (!bsb) return 'BSB is required for Australian bank accounts';
      if (!/^\d{6}$/.test(bsb)) return 'BSB must be 6 digits (e.g. 062-000)';
    }

    // US payouts must use Wise's domestic ACH (`aba`) type, which requires a
    // 9-digit routing number. Wise rejects SWIFT for accounts inside the US, so
    // a SWIFT code can't substitute — require the routing number here rather
    // than letting Wise fail with an opaque "send via ACH/Wire" error.
    if (selectedCountry === 'US') {
      const aba = (d.routingNumber || '').replace(/[\s-]/g, '');
      if (!aba) return 'Routing number (ABA) is required for US bank accounts';
      if (!/^\d{9}$/.test(aba))
        return 'US routing number must be 9 digits';
    }

    // Canadian payouts go through Wise's domestic `canadian` type, which derives
    // the institution + transit numbers from a 9-digit routing code. Wise rejects
    // SWIFT for CAD-domestic accounts, so the routing number can't be skipped.
    if (selectedCountry === 'CA') {
      const routing = (d.routingNumber || '').replace(/[\s-]/g, '');
      if (!routing)
        return 'Routing number is required for Canadian bank accounts';
      if (!/^\d{8,9}$/.test(routing))
        return 'Canadian routing number must be the 8–9 digit institution + transit code';
    }

    if (!hasSwift && !hasRouting) {
      return 'Either SWIFT Code or Routing Number / BSB / Sort Code is required';
    }

    const isAddressRequired =
      ['US', 'CA'].includes(selectedCountry) || hasSwift;
    if (isAddressRequired) {
      if (!addressLine1.trim()) return 'Address Line 1 is required';
      if (!addressCity.trim()) return 'City is required';
      if (!addressPostCode.trim()) return 'Post Code is required';
      // Wise requires `address.state` on the address types it asks for (ACH/wire
      // and many SWIFT destinations), so require it whenever we collect an
      // address rather than only for US/CA — otherwise Wise rejects with
      // "address.state: Please enter a state".
      const st = addressState.trim();
      if (!st) return 'State / Province is required';
      // For US/CA, Wise validates `address.state` against a fixed list of
      // 2-letter codes (e.g. CA, NY, ON) — a full name like "California" fails.
      if (['US', 'CA'].includes(selectedAddressCountry) && !/^[A-Za-z]{2}$/.test(st))
        return 'Use the 2-letter state/province code (e.g. CA, NY, ON)';
    }

    return null;
  }

  function submit() {
    const err = validate();
    if (err) return toast.error(err);

    const resolvedBankName =
      bankSelection === 'Other' ? customBankName.trim() : bankSelection;
    const hasAddress =
      ['US', 'CA'].includes(selectedCountry) ||
      (d.swiftCode || '').trim().length > 0;

    onSave({
      accountHolderName: d.accountHolderName.trim(),
      bankName: resolvedBankName || 'Wise Recipient Bank',
      accountNumber: d.accountNumber.trim(),
      routingNumber: (d.routingNumber || '').trim() || null,
      swiftCode: (d.swiftCode || '').trim().toUpperCase() || null,
      country: selectedCountry,
      currency: selectedCurrency,
      accountType: ['US', 'CA'].includes(selectedCountry)
        ? selectedAccountType
        : null,
      address: hasAddress
        ? {
            firstLine: addressLine1.trim(),
            city: addressCity.trim(),
            // US/CA states are sent as the canonical 2-letter code Wise expects.
            state: ['US', 'CA'].includes(selectedAddressCountry)
              ? addressState.trim().toUpperCase()
              : addressState.trim(),
            postCode: addressPostCode.trim(),
            country: selectedAddressCountry,
          }
        : null,
    });
  }

  const dropdownClass =
    'flex h-10 w-full rounded-[var(--radius-sm)] border border-[color:var(--color-border-default)] bg-card px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--color-accent-ring)] disabled:cursor-not-allowed disabled:opacity-50';

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>
            {initial ? 'Update Bank Wire Transfer' : 'Link Bank Wire Transfer'}
          </DialogTitle>
          <DialogDescription>
            Provide complete international wire details for payouts.
          </DialogDescription>
        </DialogHeader>
        {/* "Already on Wise? Import your account." — Wise OAuth import flow disabled.
        {onWiseConnect && (
          <div className="mb-1 flex items-center justify-between gap-3 rounded-[var(--radius-sm)] border border-[color:var(--color-border-hairline)] bg-inset px-3 py-2 text-sm">
            <span className="text-ink-60">Already on Wise? Import your account.</span>
            <Button variant="outline" size="sm" type="button" onClick={onWiseConnect}>Connect with Wise</Button>
          </div>
        )}
        */}
        <div className="flex max-h-[60vh] flex-col gap-3 overflow-y-auto">
          <div className="flex flex-col gap-1.5">
            <Label>Account Holder Name</Label>
            <Input
              value={d.accountHolderName}
              onChange={set('accountHolderName')}
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <Label>Country</Label>
            <select
              value={selectedCountry}
              onChange={(e) => handleCountryChange(e.target.value)}
              className={dropdownClass}
            >
              {COUNTRIES.map((c) => (
                <option key={c.code} value={c.code}>
                  {c.name}
                </option>
              ))}
            </select>
          </div>

          <div className="flex flex-col gap-1.5">
            <Label>
              Bank Name{' '}
              {(d.swiftCode || '').trim().length > 0 && (
                <span className="text-xs text-ink-40">
                  (Optional if SWIFT is provided)
                </span>
              )}
            </Label>
            {hasMajorBanks ? (
              <div className="flex flex-col gap-2">
                <select
                  value={bankSelection}
                  onChange={(e) => setBankSelection(e.target.value)}
                  className={dropdownClass}
                >
                  {majorBanks.map((b) => (
                    <option key={b} value={b}>
                      {b}
                    </option>
                  ))}
                  <option value="Other">Other / Custom Bank...</option>
                </select>
                {bankSelection === 'Other' && (
                  <Input
                    placeholder="Enter custom bank name"
                    value={customBankName}
                    onChange={(e) => setCustomBankName(e.target.value)}
                  />
                )}
              </div>
            ) : (
              <Input
                placeholder="Enter bank name"
                value={customBankName}
                onChange={(e) => setCustomBankName(e.target.value)}
              />
            )}
          </div>

          <div className="flex flex-col gap-1.5">
            <Label>Account Number / IBAN</Label>
            <Input value={d.accountNumber} onChange={set('accountNumber')} />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label>
              Routing Number / BSB / Sort Code{' '}
              <span className="text-xs text-ink-40">
                {selectedCountry === 'AU'
                  ? '(Required — 6-digit BSB)'
                  : selectedCountry === 'US'
                    ? '(Required — 9-digit ABA routing number)'
                    : '(Optional if SWIFT is provided)'}
              </span>
            </Label>
            <Input
              value={d.routingNumber || ''}
              onChange={set('routingNumber')}
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label>
              SWIFT / BIC Code{' '}
              <span className="text-xs text-ink-40">
                (Optional if Routing is provided)
              </span>
            </Label>
            <Input value={d.swiftCode || ''} onChange={set('swiftCode')} />
          </div>

          {['US', 'CA'].includes(selectedCountry) && (
            <div className="flex flex-col gap-1.5">
              <Label>Account Type</Label>
              <select
                value={selectedAccountType}
                onChange={(e) => setSelectedAccountType(e.target.value)}
                className={dropdownClass}
              >
                <option value="CHECKING">Checking</option>
                <option value="SAVINGS">Savings</option>
              </select>
            </div>
          )}

          {(['US', 'CA'].includes(selectedCountry) ||
            (d.swiftCode || '').trim().length > 0) && (
            <div className="mt-3 flex flex-col gap-3 border-t border-[color:var(--color-border-hairline)] pt-3">
              <h4 className="text-sm font-semibold text-ink-100">
                Recipient Residential Address
              </h4>

              <div className="flex flex-col gap-1.5">
                <Label>Address Line 1 *</Label>
                <Input
                  placeholder="Street address (no P.O. boxes)"
                  value={addressLine1}
                  onChange={(e) => setAddressLine1(e.target.value)}
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div className="flex flex-col gap-1.5">
                  <Label>City *</Label>
                  <Input
                    placeholder="City"
                    value={addressCity}
                    onChange={(e) => setAddressCity(e.target.value)}
                  />
                </div>
                <div className="flex flex-col gap-1.5">
                  <Label>State / Province *</Label>
                  <Input
                    placeholder={
                      ['US', 'CA'].includes(selectedAddressCountry)
                        ? '2-letter code (e.g. CA, NY, ON)'
                        : 'State/Province'
                    }
                    value={addressState}
                    onChange={(e) => setAddressState(e.target.value)}
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div className="flex flex-col gap-1.5">
                  <Label>Post Code / ZIP *</Label>
                  <Input
                    placeholder="Post code"
                    value={addressPostCode}
                    onChange={(e) => setAddressPostCode(e.target.value)}
                  />
                </div>
                <div className="flex flex-col gap-1.5">
                  <Label>Country *</Label>
                  <select
                    value={selectedAddressCountry}
                    onChange={(e) => setSelectedAddressCountry(e.target.value)}
                    className={dropdownClass}
                  >
                    {COUNTRIES.map((c) => (
                      <option key={c.code} value={c.code}>
                        {c.name}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
            </div>
          )}
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button variant="accent" disabled={saving} onClick={submit}>
            {saving ? 'Saving…' : 'Save Details'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
