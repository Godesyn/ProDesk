import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { toastError } from '../../lib/errors';
import { useTRPC } from '../../lib/trpc';
import { useActiveContext } from '../../hooks/use-active-context';
import { PageHeader } from '../../components/layout/page-header';
import { Card } from '../../components/ui/card';
import { Button } from '../../components/ui/button';
import { Skeleton } from '../../components/ui/skeleton';
import { Avatar, AvatarFallback, AvatarImage } from '../../components/ui/avatar';
import { initialsOf } from '../../lib/utils';
import { UploadButton } from '../../components/upload-button';
import { StorageBucket } from '../../lib/storage-buckets';
import { FormSection } from './form-bits';
import { AgencyProfileForm, draftFromAgency, profilePayload, hasInvalidUrl, type AgencyProfileDraft } from './agency-profile-form';

/** Edit agency — ports edit_agency_screen.dart + updateAgencyDetails + updateLogo. */
export function EditAgencyPage() {
  const trpc = useTRPC();
  const qc = useQueryClient();
  const { agencyId } = useActiveContext();
  const agency = useQuery({ ...trpc.agencies.byId.queryOptions({ id: agencyId! }), enabled: !!agencyId });

  if (!agencyId) return <PageHeader title="Edit agency" description="Select an agency first." />;
  if (agency.isLoading || !agency.data) {
    return (
      <div>
        <PageHeader title="Edit agency" description="Update your agency profile and branding." />
        <Skeleton className="h-96 w-full" />
      </div>
    );
  }
  return <EditForm agencyId={agencyId} agency={agency.data} onSaved={() => {
    qc.invalidateQueries({ queryKey: trpc.agencies.byId.queryKey() });
    qc.invalidateQueries({ queryKey: trpc.agencies.mine.queryKey() });
  }} />;
}

function EditForm({ agencyId, agency, onSaved }: { agencyId: string; agency: any; onSaved: () => void }) {
  const trpc = useTRPC();
  const [draft, setDraft] = useState<AgencyProfileDraft>(draftFromAgency(agency));

  const update = useMutation({
    ...trpc.agencies.update.mutationOptions(),
    onSuccess: () => { toast.success('Agency updated'); onSaved(); },
    onError: (e) => toastError(e),
  });
  const updateLogo = useMutation({
    ...trpc.agencies.updateLogo.mutationOptions(),
    onSuccess: () => { toast.success('Logo updated'); onSaved(); },
    onError: (e) => toastError(e),
  });

  return (
    <div>
      <PageHeader
        title="Edit agency"
        description="Update your agency profile and branding."
        action={<Button variant="accent" disabled={update.isPending || !draft.businessName || hasInvalidUrl(draft)} onClick={() => update.mutate({ id: agencyId, ...profilePayload(draft) })}>{update.isPending ? 'Saving…' : 'Save changes'}</Button>}
      />

      <div className="flex flex-col gap-4">
        <Card className="p-5">
          <FormSection title="Logo">
            <div className="flex items-center gap-4">
              <Avatar className="h-16 w-16 rounded-[var(--radius-md)]">
                {agency.logoUrl && <AvatarImage src={agency.logoUrl} />}
                <AvatarFallback>{initialsOf(agency.businessName)}</AvatarFallback>
              </Avatar>
              <div className="flex flex-col gap-1">
                {/* Upload-only: the logo is whatever was last uploaded here or from
                    the context selector — both write agency.logoUrl via updateLogo,
                    the single source of truth. No pasted URLs allowed. */}
                <UploadButton
                  bucket={StorageBucket.Uploads}
                  pathPrefix={`agencies/${agencyId}/logo`}
                  accept="image/*"
                  label={agency.logoUrl ? 'Change logo' : 'Upload logo'}
                  onUploaded={(url) => updateLogo.mutate({ id: agencyId, logoUrl: url })}
                />
                <span className="text-[12px] text-ink-40">Upload an image file to set your agency logo.</span>
              </div>
            </div>
          </FormSection>
        </Card>

        <Card className="p-5">
          <AgencyProfileForm value={draft} onChange={setDraft} excludeAgencyId={agencyId} />
        </Card>
      </div>
    </div>
  );
}
