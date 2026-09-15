import { useRef, useState } from 'react';
import { useLocation } from 'wouter';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { ChevronsUpDown, PlusCircle, Pencil, Loader2 } from 'lucide-react';
import { useCurrentUser } from '../../../auth/auth-context';
import { useTRPC } from '../../../lib/trpc';
import { uploadFile } from '../../../lib/storage';
import { StorageBucket } from '../../../lib/storage-buckets';
import { cn } from '../../../lib/utils';
import { DropdownMenu, DropdownMenuContent, DropdownMenuTrigger, DropdownMenuSeparator } from '../../ui/dropdown-menu';
import { ContextOptionItem } from './context-option-item';
import { ContextDropdownItems } from './context-dropdown-items';
import { OverlayAction } from './overlay-action';
import { optionAllowedByApp, type ContextOption } from './context-option';

const UPLOADABLE_ROLES = new Set(['brandOwner', 'brandStaff', 'agencyOwner', 'agencyStaff']);

/**
 * Workspace/identity switcher at the top of the sidebar — 1:1 behavioural port
 * of lib/src/shared/components/context_selector.dart. Lists every context the
 * user can act as (admin, owned/staff agencies, owned/staff brands, contractor),
 * grouped with section headers; selecting one switches role + active org
 * server-side (auth.switchContext) and returns home. Includes the "Add role"
 * action and in-trigger logo upload.
 */
export function ContextSelector({
  onClose,
  collapsed = false,
  onExpand,
  onCollapse,
  appPermissions,
}: {
  onClose?: () => void;
  /** True when the desktop rail is collapsed (logo-only trigger). */
  collapsed?: boolean;
  /** Expand the rail (called when the collapsed trigger is clicked). */
  onExpand?: () => void;
  /** Re-collapse the rail after a selection/dismiss that auto-expanded it. */
  onCollapse?: () => void;
  /**
   * For a brand-only frontend, the tool permission(s) that gate it (e.g.
   * ['links','linksViewer']). When set, brand options are hidden unless the user
   * owns the brand or holds one of these for it — so a staffer never sees a brand
   * they have no access to use here. Omit on multi-tool frontends (prodesk). Pair
   * with `useEnsureBrandContext({ appPermissions })` so a revoked-permission brand
   * that's still server-selected is switched away from, not just hidden.
   */
  appPermissions?: string[];
}) {
  const { data: user } = useCurrentUser();
  const trpc = useTRPC();
  const qc = useQueryClient();
  const [, navigate] = useLocation();
  const fileRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  // Controlled dropdown so we can sequence "expand rail → then open menu" when the
  // selector is clicked while collapsed, and revert the rail afterwards.
  const [open, setOpen] = useState(false);
  const autoExpandedRef = useRef(false);

  function handleOpenChange(next: boolean) {
    if (next && collapsed) {
      // Expand first; open the menu once the rail has widened so it anchors to
      // the full-width trigger rather than the 64px collapsed stub.
      autoExpandedRef.current = true;
      onExpand?.();
      window.setTimeout(() => setOpen(true), 200);
      return;
    }
    setOpen(next);
    // Dropdown dismissed (selection or outside-click) after an auto-expand → tuck back.
    if (!next && autoExpandedRef.current) {
      autoExpandedRef.current = false;
      onCollapse?.();
    }
  }

  const { data } = useQuery({ ...trpc.auth.contextOptions.queryOptions(), enabled: !!user });
  // Hide brand options this frontend can't use (see appPermissions). Non-brand
  // options and owned brands always pass; a brand-staff option needs one of the
  // tool's permissions. With no appPermissions, every option is kept.
  const options = ((data ?? []) as ContextOption[]).filter((o) =>
    optionAllowedByApp(o, appPermissions),
  );

  const switchCtx = useMutation(trpc.auth.switchContext.mutationOptions());
  const agencyUpdateLogo = useMutation(trpc.agencies.updateLogo.mutationOptions());
  const brandUpdateLogo = useMutation(trpc.brands.updateLogo.mutationOptions());

  if (!user || options.length === 0) return null;

  // Resolve the current selection the same way Flutter findMatch does:
  // exact (role + entityId) → role-only → first.
  const role = user.role;
  const entityId =
    role === 'agencyOwner' || role === 'agencyStaff'
      ? (user.selectedAgencyId ?? null)
      : role === 'brandOwner' || role === 'brandStaff'
        ? (user.selectedBrandId ?? null)
        : null;
  const current =
    options.find((o) => o.role === role && o.entityId === entityId) ??
    options.find((o) => o.role === role) ??
    options[0];

  const isBrand = current.role === 'brandOwner' || current.role === 'brandStaff';
  const canUpload = !!current.entityId && UPLOADABLE_ROLES.has(current.role);

  async function onPickLogo(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = '';
    const entityId = current.entityId;
    if (!file || !entityId) return;
    setUploading(true);
    try {
      const url = await uploadFile(StorageBucket.Uploads, `${isBrand ? 'brands' : 'agencies'}/${entityId}`, file);
      if (isBrand) await brandUpdateLogo.mutateAsync({ brandId: entityId, logoUrls: [url] });
      else await agencyUpdateLogo.mutateAsync({ id: entityId, logoUrl: url });
      await qc.invalidateQueries();
      toast.success('Logo updated');
    } catch (err) {
      toast.error(`Upload failed: ${err instanceof Error ? err.message : 'unknown error'}`);
    } finally {
      setUploading(false);
    }
  }

  function handleSelect(o: ContextOption) {
    if (o.isDisabled) return;
    switchCtx.mutate(
      { type: o.type, entityId: o.entityId ?? undefined },
      {
        onSuccess: () => {
          qc.invalidateQueries();
          navigate('/');
          onClose?.();
        },
      },
    );
  }

  // Pending/deleted contexts get a status-tinted bar (border + faint fill) so the
  // state reads at a glance, not just from the small label below the name.
  const triggerStatus =
    current?.status === 'pending'
      ? 'border-warn/60 bg-warn/[0.06] hover:bg-warn/10'
      : current?.status === 'deleted'
        ? 'border-danger/60 bg-danger/[0.06] hover:bg-danger/10'
        : 'border-[color:var(--color-border-hairline)] hover:bg-inset';

  return (
    <div className="relative">
      <DropdownMenu open={open} onOpenChange={handleOpenChange}>
        <DropdownMenuTrigger asChild>
          {/* The trigger IS the top bar: full width + h-16 + bottom border, matching
              the page header on the right. No inset card, so no margin around it.
              Collapsed → logo-only, centered. */}
          <button
            type="button"
            title={collapsed ? current?.label : undefined}
            className={cn(
              'flex h-16 w-full items-center border-b transition-colors',
              collapsed ? 'justify-center px-0' : 'gap-2.5 px-3 text-left',
              triggerStatus,
            )}
          >
            {collapsed ? (
              current && <ContextOptionItem option={current} iconOnly />
            ) : (
              <>
                <span className="min-w-0 flex-1">{current && <ContextOptionItem option={current} inOverlay={false} />}</span>
                <ChevronsUpDown className="h-4 w-4 shrink-0 text-ink-40" />
              </>
            )}
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="max-h-[350px] w-[250px] overflow-y-auto p-0">
          <div className="py-1">
            <ContextDropdownItems options={options} onSelect={handleSelect} activeId={current?.id} />
          </div>
          <DropdownMenuSeparator className="my-0" />
          <OverlayAction
            icon={PlusCircle}
            label="Add role"
            onClick={() => {
              navigate('/role-selection?add=true');
              onClose?.();
            }}
          />
        </DropdownMenuContent>
      </DropdownMenu>

      {/* Click-to-upload logo — overlaid on the trigger's avatar but rendered OUTSIDE
          the Radix trigger <button>, so its click opens the file picker instead of
          being swallowed by the dropdown. Aligned to the h-9 avatar at px-3. */}
      {canUpload && !collapsed && (
        <>
          <button
            type="button"
            onClick={() => fileRef.current?.click()}
            disabled={uploading}
            aria-label="Change logo"
            title="Change logo"
            className="absolute left-3 top-1/2 z-10 grid h-9 w-9 -translate-y-1/2 place-items-center rounded-full"
          >
            {uploading && (
              <span className="absolute inset-0 grid place-items-center rounded-full bg-ink-100/50">
                <Loader2 className="h-4 w-4 animate-spin text-paper" />
              </span>
            )}
            <span className="absolute -right-0.5 -top-0.5 grid h-3.5 w-3.5 place-items-center rounded-full bg-accent">
              <Pencil className="h-2 w-2 text-paper" />
            </span>
          </button>
          <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={onPickLogo} />
        </>
      )}
    </div>
  );
}
