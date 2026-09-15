import { useActiveContext } from '../../hooks/use-active-context';
import { InfoHubTemplateManager } from './info-hub-template-manager';

/**
 * Info Hub setup — the agency SPOT form-builder. Lists the agency's reusable
 * section templates and lets owners / `agencyBusinessInfo` staff create, edit, delete and
 * mark them default (auto-applied to every connected brand). Ports
 * form_builder_screen.dart + component_editor*, wired to the `spot` router.
 */
export function InfoHubSetupPage() {
  const { agencyId } = useActiveContext();
  return (
    <InfoHubTemplateManager
      mode="agency"
      agencyId={agencyId ?? undefined}
      title="Info Hub setup"
      description="Build the SPOT sections your clients fill out to share brand information."
    />
  );
}
