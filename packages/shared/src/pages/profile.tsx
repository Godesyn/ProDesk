import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useLocation } from 'wouter';
import { toast } from 'sonner';
import { toastError } from '../lib/errors';
import { UserCog, ArrowLeft, LifeBuoy } from 'lucide-react';
import { useTRPC } from '../lib/trpc';
import { useCurrentUser } from '../auth/auth-context';
import { Button } from '../components/ui/button';
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '../components/ui/card';
import { Input } from '../components/ui/input';
import { Label } from '../components/ui/label';
import { ProfileHero } from './profile/profile-hero';
import { SecurityCard } from './profile/security-card';
import { WithdrawMethodsPanel } from './profile/withdraw-methods';
import { CalendarCard } from './profile/calendar-card';
import { AffiliateCard } from './profile/affiliate-card';
import { EmailPreferencesCard } from './profile/email-preferences-card';

export function ProfilePage({ agencyOnlyPayout = false }: { agencyOnlyPayout?: boolean } = {}) {
  const trpc = useTRPC();
  const qc = useQueryClient();
  const [, navigate] = useLocation();
  const { data: user } = useCurrentUser();
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');

  useEffect(() => {
    setFirstName(user?.firstName ?? '');
    setLastName(user?.lastName ?? '');
  }, [user]);

  const meKey = trpc.auth.me.queryKey();
  const updateProfile = useMutation({
    ...trpc.users.updateProfile.mutationOptions(),
    onSuccess: () => { toast.success('Profile saved'); qc.invalidateQueries({ queryKey: meKey }); },
    onError: (e) => toastError(e),
  });

  // The profile screen is entirely USER-scoped, so what it shows must depend on
  // the identities the user actually HAS — not on whichever context the selector
  // happens to have active (user.role flips with the context selector). We derive
  // capabilities from auth.contextOptions, which enumerates every owner/staff/
  // contractor identity the user holds, independent of the selected context.
  const contextOptions = useQuery(trpc.auth.contextOptions.queryOptions());

  if (!user) return null;

  const options = contextOptions.data ?? [];
  // An agency identity (owner or staff) anywhere — drives calendar + payout.
  const hasAgencyRole = options.some((o) => o.type === 'agency' && !o.isDisabled);
  const hasContractorRole = options.some((o) => o.type === 'contractor') || !!user.hasContractorProfile;
  const hasBrandRole = options.some((o) => o.type === 'brand');
  // Pure brand users never receive personal payouts (agency/owner/sales money
  // lands on the agency account); everyone else (contractor/agency/affiliate)
  // may, so the personal payout panel is hidden only for brand-only users.
  const isBrandOnly = hasBrandRole && !hasAgencyRole && !hasContractorRole && !user.isSuperAdmin;
  // Default: hidden only for brand-only users (contractors/affiliates still receive
  // personal payouts). When `agencyOnlyPayout` is set (the brand-only dashboard),
  // restrict the payout panel to users who hold an agency identity (owner or staff).
  const showPayout = agencyOnlyPayout ? hasAgencyRole : !isBrandOnly;

  const nameDirty =
    firstName.trim() !== (user.firstName ?? '') || lastName.trim() !== (user.lastName ?? '');

  return (
    <div className="mx-auto max-w-3xl px-4 pb-16">
      <div className="flex flex-col gap-6 pt-2">
        <header>
          <button
            type="button"
            onClick={() => window.history.back()}
            aria-label="Back"
            className="press mb-3 -ml-1 inline-flex text-ink-60 transition-colors hover:text-ink-100 md:mb-5"
          >
            <ArrowLeft className="h-7 w-7" />
          </button>
          <div className="text-eyebrow mb-1 text-accent md:mb-2">Your account</div>
          <h1 className="text-section-title text-ink-100">
            Account <span className="text-serif-italic text-accent">settings</span>
          </h1>
          {/* Long descriptive paragraph: hidden on mobile to reclaim vertical space. */}
          <p className="mt-2 max-w-xl text-sm leading-relaxed text-ink-60 max-md:hidden">
            Manage your personal details, security, and preferences. Each section saves on its own.
          </p>
        </header>

        <ProfileHero user={user} meKey={meKey} />

        <Card>
          <CardHeader>
            <CardTitle>Personal Information</CardTitle>
            <CardDescription>Your name as it appears across Prodesk.</CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div className="flex flex-col gap-1.5"><Label htmlFor="fn">First name</Label><Input id="fn" value={firstName} onChange={(e) => setFirstName(e.target.value)} /></div>
              <div className="flex flex-col gap-1.5"><Label htmlFor="ln">Last name</Label><Input id="ln" value={lastName} onChange={(e) => setLastName(e.target.value)} /></div>
            </div>
            <div className="flex flex-col gap-1.5">
              <Label>Email</Label>
              <Input value={user.email} disabled />
              <span className="text-xs text-ink-40">Email cannot be changed.</span>
            </div>
          </CardContent>
          <CardFooter className="justify-end gap-3 border-t border-[color:var(--color-border-hairline)] pt-6">
            {nameDirty && !updateProfile.isPending && (
              <button
                type="button"
                onClick={() => { setFirstName(user.firstName ?? ''); setLastName(user.lastName ?? ''); }}
                className="press text-sm font-medium text-ink-60 transition-colors hover:text-ink-100"
              >
                Discard
              </button>
            )}
            <Button
              variant="accent"
              disabled={!nameDirty || updateProfile.isPending}
              onClick={() => updateProfile.mutate({ firstName: firstName.trim(), lastName: lastName.trim() })}
            >
              {updateProfile.isPending ? 'Saving…' : 'Save changes'}
            </Button>
          </CardFooter>
        </Card>

        <SecurityCard email={user.email} />

        <EmailPreferencesCard />

        {/* Support — the single, guaranteed-everywhere entry point into the
            shared ticketing system (this page is mounted by every frontend). */}
        <Card>
          <CardHeader><CardTitle>Help &amp; Support</CardTitle></CardHeader>
          <CardContent>
            <div className="flex flex-wrap items-center justify-between gap-4">
              <div className="flex min-w-0 items-center gap-3">
                <span className="grid h-10 w-10 shrink-0 place-items-center rounded-[var(--radius-md)] bg-inset text-ink-60"><LifeBuoy className="h-5 w-5" /></span>
                <div className="min-w-0">
                  <div className="text-sm font-medium text-ink-100">Support tickets</div>
                  <div className="text-sm text-ink-60 max-md:hidden">Contact our team, and view or reply to your existing tickets.</div>
                </div>
              </div>
              <Button variant="outline" className="shrink-0" onClick={() => navigate('/support')}>Open support</Button>
              <div className="text-sm text-ink-60 max-md:order-last max-md:w-full md:hidden">Contact our team, and view or reply to your existing tickets.</div>
            </div>
          </CardContent>
        </Card>

        {/* Payout settings (personal account): see `showPayout` above. */}
        {showPayout && <WithdrawMethodsPanel user={user} meKey={meKey} />}

        {/* Contractor: edit freelancer profile entry. */}
        {hasContractorRole && (
          <Card>
            <CardHeader><CardTitle>Contractor Settings</CardTitle></CardHeader>
            <CardContent>
              {/* On mobile the description drops to its own full-width row beneath
                  icon+title and the action (max-md:order-last + w-full); on desktop
                  it sits nested under the title as before. */}
              <div className="flex flex-wrap items-center justify-between gap-4">
                <div className="flex min-w-0 items-center gap-3">
                  <span className="grid h-10 w-10 shrink-0 place-items-center rounded-[var(--radius-md)] bg-inset text-ink-60"><UserCog className="h-5 w-5" /></span>
                  <div className="min-w-0">
                    <div className="text-sm font-medium text-ink-100">Freelancer Profile</div>
                    <div className="text-sm text-ink-60 max-md:hidden">Manage your public freelancer profile and rates.</div>
                  </div>
                </div>
                {/* TODO(by ai): point at the create-contractor editor route once the marketplace domain registers it (Flutter: /create-contractor). */}
                <Button variant="outline" className="shrink-0" onClick={() => navigate('/contractor-dashboard')}>Edit Profile</Button>
                <div className="text-sm text-ink-60 max-md:order-last max-md:w-full md:hidden">Manage your public freelancer profile and rates.</div>
              </div>
            </CardContent>
          </Card>
        )}

        {/* Integrations: shown whenever the user holds an agency identity
            (owner or staff) anywhere — independent of the selected context. */}
        {hasAgencyRole && <CalendarCard linked={user.googleCalendarLinked} meKey={meKey} />}

        <AffiliateCard userId={user.id} referredByAgencyId={user.referredByAgencyId} />
      </div>
    </div>
  );
}
