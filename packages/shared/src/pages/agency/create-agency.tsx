import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useLocation } from 'wouter';
import { toast } from 'sonner';
import { toastError } from '../../lib/errors';
import { useTRPC } from '../../lib/trpc';
import { useCurrentUser } from '../../auth/auth-context';
import { Card } from '../../components/ui/card';
import { Button } from '../../components/ui/button';
import { OnboardingHeader } from '../../components/layout/onboarding-header';
import { AgencyProfileForm, emptyAgencyDraft, profilePayload, hasInvalidUrl, type AgencyProfileDraft } from './agency-profile-form';

/**
 * Create agency wizard — ports create_agency_screen.dart + createAgency. On
 * success the user is promoted to agencyOwner and an approval task is filed for
 * super-admins (handled server-side); Stripe onboarding is launched from the
 * bank-account screen post-create.
 */
export function CreateAgencyPage() {
  const trpc = useTRPC();
  const qc = useQueryClient();
  const [, navigate] = useLocation();
  const { data: user } = useCurrentUser();
  const [draft, setDraft] = useState<AgencyProfileDraft>(emptyAgencyDraft());

  const create = useMutation({
    ...trpc.agencies.create.mutationOptions(),
    onSuccess: () => {
      toast.success('Agency created — pending verification');
      qc.invalidateQueries();
      navigate('/agency-dashboard');
    },
    onError: (e) => toastError(e),
  });

  return (
    <div className="mx-auto max-w-[760px] px-5 py-10 animate-reveal">
      <OnboardingHeader
        eyebrow="Agency profile"
        title="Set up your"
        titleAccent="agency"
        description="Tell clients what you do and how you work. You can refine everything later — a super-admin reviews new agencies before they go live."
        backTo={user?.role ? undefined : '/role-selection'}
        backLabel="Choose a different role"
      />
      <Card className="p-6 sm:p-8 shadow-2">
        <AgencyProfileForm value={draft} onChange={setDraft} />
        <div className="mt-8 flex justify-end border-t border-[color:var(--color-border-hairline)] pt-6">
          <Button variant="accent" size="lg" disabled={!draft.businessName || hasInvalidUrl(draft) || create.isPending} onClick={() => create.mutate(profilePayload(draft))}>
            {create.isPending ? 'Creating…' : 'Create agency'}
          </Button>
        </div>
      </Card>
    </div>
  );
}
