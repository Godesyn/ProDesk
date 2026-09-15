import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CreditCard, Landmark, Wallet, Info } from 'lucide-react';
import { toast } from 'sonner';
import { toastError } from '../../lib/errors';
import { useTRPC } from '../../lib/trpc';
import { useActiveContext } from '../../hooks/use-active-context';
import { reserveNewTab } from '../../lib/redirect';
import { PageHeader } from '../../components/layout/page-header';
import { Card, CardContent, CardHeader, CardTitle } from '../../components/ui/card';
import { Button } from '../../components/ui/button';
import { Skeleton } from '../../components/ui/skeleton';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '../../components/ui/dialog';
import {
  MethodCard, WireDialog, PaypalDialog, maskTail, NAMES,
  type Method, type WiseAccountOption,
} from '../profile/withdraw-methods';

/**
 * Agency bank account / payout method management — ports agency_bank_account_screen.dart,
 * which reuses WithdrawMethodsPanel scoped to the agency. The agency's account
 * receives agency/owner/sales commissions and is DISTINCT from a member's personal
 * account (which receives contractor/staff/affiliate commissions), so both
 * providers (Stripe / Wire) are connected here against the agency row —
 * never the user's profile.
 */
export function AgencyBankAccountPage() {
  const trpc = useTRPC();
  const qc = useQueryClient();
  const { agencyId } = useActiveContext();
  const agencyKey = trpc.agencies.byId.queryKey({ id: agencyId! });
  const agency = useQuery({ ...trpc.agencies.byId.queryOptions({ id: agencyId! }), enabled: !!agencyId });

  const invalidate = () => qc.invalidateQueries({ queryKey: agencyKey });

  const a = agency.data;
  const pm = (a?.payoutMethods ?? {}) as Record<string, Record<string, string> | undefined>;
  const hasStripe = !!a?.stripeAccountId && a.bankAccountLinked;
  const hasStripeAccount = !!a?.stripeAccountId;
  const hasPaypal = !!pm.paypal?.email;
  const hasWire = !!pm.wire?.bankName && !!pm.wire?.accountNumber;
  const hasAny = hasStripe || hasPaypal || hasWire;

  let active: Method | null = (a?.activePayoutMethod as Method | null) ?? null;
  if (!active && hasAny) active = hasStripe ? 'stripe' : hasPaypal ? 'paypal' : 'wire';
  if (active === 'stripe' && !hasStripe) active = null;
  if (active === 'paypal' && !hasPaypal) active = null;
  if (active === 'wire' && !hasWire) active = null;

  const stripeStatus = useQuery({ ...trpc.agencies.stripeAccountStatus.queryOptions({ agencyId: agencyId! }), enabled: !!agencyId && hasStripeAccount });
  const createStripeLink = useMutation({ ...trpc.agencies.createStripeConnectLink.mutationOptions(), onError: (e) => toastError(e) });
  const linkWise = useMutation({ ...trpc.agencies.linkWiseRecipient.mutationOptions(), onSuccess: () => { toast.success('Bank account linked'); invalidate(); }, onError: (e) => toastError(e) });
  const setActive = useMutation({ ...trpc.agencies.setActivePayoutMethod.mutationOptions(), onSuccess: invalidate, onError: (e) => toastError(e) });
  const removeMethod = useMutation({ ...trpc.agencies.removePayoutMethod.mutationOptions(), onSuccess: () => { toast.success('Disconnected'); invalidate(); }, onError: (e) => toastError(e) });
  const savePaypal = useMutation({ ...trpc.agencies.savePayoutMethodDetails.mutationOptions(), onError: (e) => toastError(e) });

  // Wise OAuth is stateless, so the agency reuses the users-router endpoints and
  // only redirects/links back into the agency context.
  const getWiseUrl = useMutation(trpc.users.getWiseAuthUrl.mutationOptions());
  const exchangeWise = useMutation(trpc.users.exchangeWiseCode.mutationOptions());

  const [wireOpen, setWireOpen] = useState(false);
  const [paypalOpen, setPaypalOpen] = useState(false);
  const [wiseAccounts, setWiseAccounts] = useState<WiseAccountOption[]>([]);
  const [confirm, setConfirm] = useState<{ title: string; body: string; danger: boolean; action: () => void } | null>(null);

  const wiseRedirect = `${window.location.origin}/agency-bank-account?wise_callback=true`;

  // Wise OAuth callback → pick from the agency's existing Wise recipient accounts.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get('wise_callback') === 'true' && params.get('code')) {
      const code = params.get('code')!;
      const url = new URL(window.location.href);
      ['wise_callback', 'code', 'state'].forEach((k) => url.searchParams.delete(k));
      window.history.replaceState({}, '', url.toString());
      exchangeWise
        .mutateAsync({ code, redirectUri: wiseRedirect })
        .then((res) => {
          if (res.accounts?.length) setWiseAccounts(res.accounts as WiseAccountOption[]);
          else toast.message('No Wise recipient accounts found (or Wise OAuth not configured).');
        })
        .catch((e) => toast.error((e as Error).message));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (!agencyId) return <PageHeader title="Bank account" description="Select an agency first." />;
  if (agency.isLoading || !a) {
    return (
      <div>
        <PageHeader title="Bank account" description="Where your agency receives payouts." />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  async function connectWise() {
    const tab = reserveNewTab(); // reserved against the click; OAuth opens in a new tab
    try {
      const res = await getWiseUrl.mutateAsync({ redirectUri: wiseRedirect });
      if (res.url) tab.go(res.url);
      else { tab.cancel(); toast.message('Wise OAuth is not configured in this environment.'); }
    } catch (e) {
      tab.cancel();
      toast.error((e as Error).message);
    }
  }

  async function startConnect(method: Method) {
    if (method === 'stripe') {
      const tab = reserveNewTab(); // reserved against the click; onboarding opens in a new tab
      try {
        const res = await createStripeLink.mutateAsync({ agencyId: agencyId!, country: 'AU' });
        if (res.url) tab.go(res.url);
        else { tab.cancel(); toast.message('Stripe Connect is not available in this environment.'); }
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
    removeMethod.mutate({ agencyId: agencyId!, method });
  }

  function confirmDisconnect(method: Method) {
    setConfirm({
      title: `Disconnect ${NAMES[method]}?`,
      body: `Your agency won't be able to receive payouts until you connect another method. You can reconnect ${NAMES[method]} any time.`,
      danger: true,
      action: () => disconnect(method),
    });
  }

  function confirmSwitch(from: Method, to: Method) {
    setConfirm({
      title: `Switch to ${NAMES[to]}?`,
      body: `Your current ${NAMES[from]} account will be disconnected and we'll guide you through linking ${NAMES[to]}. Future agency payouts will go to the new method.`,
      danger: false,
      action: async () => {
        disconnect(from);
        await startConnect(to);
      },
    });
  }

  function actionsFor(method: Method) {
    const busy = setActive.isPending || removeMethod.isPending || createStripeLink.isPending || savePaypal.isPending;
    if (method === 'stripe') {
      if (hasStripeAccount) {
        return (
          <>
            <Button variant="outline" disabled={busy} onClick={() => confirmDisconnect('stripe')}>Disconnect</Button>
            <Button disabled={busy} onClick={() => startConnect('stripe')}>Update</Button>
          </>
        );
      }
      return <Button disabled={busy} onClick={() => startConnect('stripe')}>Connect</Button>;
    }
    if (active === method) {
      // Wire is editable in place: "Update" reopens the form pre-filled from the
      // stored record (WireDialog receives initial={pm.wire}) and re-links on save.
      return (
        <>
          <Button variant="outline" disabled={busy} onClick={() => confirmDisconnect(method)}>Disconnect</Button>
          <Button disabled={busy} onClick={() => startConnect(method)}>Update</Button>
        </>
      );
    }
    if (hasAny && active) {
      return (
        <>
          <Button disabled={busy} onClick={() => confirmSwitch(active!, method)}>Switch to {NAMES[method]}</Button>
          <Button variant="outline" disabled={busy} onClick={() => confirmDisconnect(active!)}>Disconnect</Button>
        </>
      );
    }
    return <Button disabled={busy} onClick={() => startConnect(method)}>Connect</Button>;
  }

  const defaultHolder = a.businessName;

  return (
    <div>
      <PageHeader title="Bank account" description="Where your agency receives payouts." />
      <Card>
        <CardHeader><CardTitle>Payout methods</CardTitle></CardHeader>
        <CardContent className="flex flex-col gap-4">
          <div className="flex items-start gap-3 rounded-[var(--radius-md)] border border-[color:var(--color-border-hairline)] bg-inset px-4 py-3 text-sm text-ink-60">
            <Info className="mt-0.5 h-4 w-4 shrink-0" />
            <p><span className="font-semibold text-ink-100">One active method at a time. </span>Connecting a new provider moves your agency payouts to it and disconnects the current one — we'll always confirm first.</p>
          </div>

          <MethodCard
            icon={<CreditCard className="h-5 w-5" />}
            name="Stripe"
            description="Instant bank payouts · 135+ currencies"
            active={active === 'stripe'}
            details={hasStripeAccount ? `acct ${maskTail(a.stripeAccountId ?? '')} / Stripe Connect` : undefined}
            warning={hasStripeAccount && !a.bankAccountLinked && stripeStatus.data && !stripeStatus.data.payoutsEnabled ? 'Incomplete setup.' : undefined}
            actions={actionsFor('stripe')}
          />

          <MethodCard
            icon={<Wallet className="h-5 w-5" />}
            name="PayPal"
            description="Payouts to your agency's PayPal balance"
            active={active === 'paypal'}
            details={hasPaypal ? pm.paypal?.email : undefined}
            actions={actionsFor('paypal')}
          />

          <MethodCard
            icon={<Landmark className="h-5 w-5" />}
            name="Wire transfer"
            description="Direct to your bank account"
            active={active === 'wire'}
            details={hasWire ? `${pm.wire?.bankName ?? ''} / acct ${maskTail(pm.wire?.accountNumber ?? '')}` : undefined}
            actions={actionsFor('wire')}
          />
        </CardContent>

        {/* Wise OAuth recipient picker — shown after a successful connect callback. */}
        <Dialog open={wiseAccounts.length > 0} onOpenChange={(o) => !o && setWiseAccounts([])}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Choose a Wise account</DialogTitle>
              <DialogDescription>Select the bank account that should receive your agency payouts.</DialogDescription>
            </DialogHeader>
            <div className="flex flex-col gap-2">
              {wiseAccounts.map((acc) => (
                <button
                  key={acc.id}
                  className="rounded-[var(--radius-sm)] border border-[color:var(--color-border-default)] p-3 text-left text-sm hover:bg-inset"
                  disabled={linkWise.isPending}
                  onClick={async () => {
                    await linkWise.mutateAsync({
                      agencyId: agencyId!,
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
                  <div className="font-medium text-ink-100">{acc.bankName || acc.accountHolderName || 'Bank account'}</div>
                  <div className="text-ink-60">{acc.accountHolderName} · {acc.currency} · acct {maskTail(acc.accountNumber)}</div>
                </button>
              ))}
            </div>
          </DialogContent>
        </Dialog>

        <WireDialog
          open={wireOpen}
          onOpenChange={setWireOpen}
          initial={pm.wire}
          defaultHolder={defaultHolder}
          onWiseConnect={connectWise}
          onSave={async (details) => {
            await linkWise.mutateAsync({
              agencyId: agencyId!,
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
            await savePaypal.mutateAsync({ agencyId: agencyId!, method: 'paypal', details: { email } });
            await setActive.mutateAsync({ agencyId: agencyId!, method: 'paypal' });
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
              <Button variant="ghost" onClick={() => setConfirm(null)}>Cancel</Button>
              <Button variant={confirm?.danger ? 'danger' : 'accent'} onClick={() => { confirm?.action(); setConfirm(null); }}>
                {confirm?.danger ? 'Disconnect' : 'Continue'}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </Card>
    </div>
  );
}
