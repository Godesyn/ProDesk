import { InfoHubTemplateManager } from '../agency/info-hub-template-manager';

/**
 * Super-admin global Info Hub templates — platform-wide default sections. These
 * live in `spot_forms` with no agencyId/brandId; marking one Default fans it out
 * to every brand's Info Hub (and onto new brands at creation), mirroring the
 * Flutter admin `agencyId == 'admin'` default-form flow (onFormWritten /
 * onBrandWritten triggers).
 */
export function GlobalInfoHubTemplatesPage() {
  return (
    <div className="mx-auto max-w-[860px]">
      <InfoHubTemplateManager
        mode="global"
        title="Info Hub templates"
        description="Global default sections. Marking one Default adds it to every brand's Info Hub automatically."
      />
    </div>
  );
}
