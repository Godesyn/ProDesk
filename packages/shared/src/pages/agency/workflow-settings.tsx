import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus, X, Info } from 'lucide-react';
import { toast } from 'sonner';
import { toastError } from '../../lib/errors';
import { useTRPC } from '../../lib/trpc';
import { useActiveContext } from '../../hooks/use-active-context';
import { PageHeader } from '../../components/layout/page-header';
import { Button } from '../../components/ui/button';
import { Card } from '../../components/ui/card';
import { Input } from '../../components/ui/input';
import { Skeleton } from '../../components/ui/skeleton';
import { Avatar, AvatarFallback, AvatarImage } from '../../components/ui/avatar';
import { Field, ToggleRow, FormSection } from './form-bits';
import { AvatarSelect } from '../../components/ui/avatar-select';
import { formatPercent, toNumberInput } from '../../lib/utils';

interface Member { id: string; name: string; email: string; profileUrl?: string | null; bankAccountLinked: boolean; isOwner: boolean }

/**
 * Workflow Settings — ports workflow_settings_screen.dart + workflow_settings_state.dart.
 * Configures briefing/allocation/approval designees, sales staff + per-person
 * commission, production/briefing/internal-approval commissions, and the
 * redirect-to-bank-account toggles (gated on a linked bank account). Shows the
 * live commission summary and enforces the agency-commission cap on save.
 */
export function WorkflowSettingsPage() {
  const trpc = useTRPC();
  const qc = useQueryClient();
  const { agencyId } = useActiveContext();

  const agency = useQuery({ ...trpc.agencies.byId.queryOptions({ id: agencyId! }), enabled: !!agencyId });
  const members = useQuery({ ...trpc.agencies.members.queryOptions({ agencyId: agencyId! }), enabled: !!agencyId });

  if (!agencyId) return <PageHeader title="Workflow settings" description="Select an agency first." />;
  if (agency.isLoading || members.isLoading || !agency.data) {
    return (
      <div>
        <PageHeader title="Workflow settings" description="Role designees and commission split." />
        <div className="space-y-3">{Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-28 w-full" />)}</div>
      </div>
    );
  }
  return <WorkflowForm agencyId={agencyId} agency={agency.data} members={members.data ?? []} onSaved={() => qc.invalidateQueries({ queryKey: trpc.agencies.byId.queryKey() })} />;
}

function WorkflowForm({ agencyId, agency, members, onSaved }: { agencyId: string; agency: any; members: Member[]; onSaved: () => void }) {
  const trpc = useTRPC();
  const owner = members.find((m) => m.isOwner)?.id ?? agency.ownerId;

  const [briefingDesigneeId, setBriefing] = useState<string>(agency.briefingDesigneeId ?? owner);
  const [allocationDesigneeId, setAllocation] = useState<string>(agency.allocationDesigneeId ?? owner);
  const [approvalDesigneeId, setApproval] = useState<string>(agency.approvalDesigneeId ?? owner);

  const [redirectBriefing, setRedirectBriefing] = useState<boolean>(agency.redirectBriefingCommissionToBankAccount ?? false);
  const [redirectProduction, setRedirectProduction] = useState<boolean>(agency.redirectProductionCommissionToBankAccount ?? false);
  const [redirectApproval, setRedirectApproval] = useState<boolean>(agency.redirectInternalApprovalCommissionToBankAccount ?? false);

  const [briefingComm, setBriefingComm] = useState<string>(toNumberInput(agency.briefingManagerCommission) || '0');
  const [productionComm, setProductionComm] = useState<string>(toNumberInput(agency.productionManagerCommission) || '0');
  const [approvalComm, setApprovalComm] = useState<string>(toNumberInput(agency.internalApprovalCommission) || '0');

  const initialSales: string[] = (agency.salesStaffIds && agency.salesStaffIds.length ? agency.salesStaffIds : [owner]) as string[];
  const initialSalesComm = (agency.salesPersonCommissions ?? {}) as Record<string, number>;
  const [salesStaff, setSalesStaff] = useState<string[]>(initialSales);
  const [salesComm, setSalesComm] = useState<Record<string, string>>(() => {
    const m: Record<string, string> = {};
    for (const id of initialSales) m[id] = toNumberInput(initialSalesComm[id] ?? 0);
    return m;
  });
  const [salesRedirect, setSalesRedirect] = useState<Record<string, boolean>>(() => {
    const m: Record<string, boolean> = {};
    for (const id of initialSales) m[id] = Object.prototype.hasOwnProperty.call(initialSalesComm, id);
    return m;
  });

  const memberById = useMemo(() => Object.fromEntries(members.map((m) => [m.id, m])), [members]);
  const hasLinked = (id: string) => memberById[id]?.bankAccountLinked ?? false;

  const save = useMutation({
    ...trpc.agencies.saveWorkflowSettings.mutationOptions(),
    onSuccess: () => { toast.success('Workflow settings saved'); onSaved(); },
    onError: (e) => toastError(e),
  });

  // Live summary: sum of redirected commissions (sales uses max of redirected).
  const summary = useMemo(() => {
    const prod = redirectProduction ? Number(productionComm) || 0 : 0;
    const brief = redirectBriefing ? Number(briefingComm) || 0 : 0;
    const appr = redirectApproval ? Number(approvalComm) || 0 : 0;
    const redirectedSales = salesStaff.filter((id) => salesRedirect[id]).map((id) => Number(salesComm[id]) || 0);
    const maxSales = redirectedSales.length ? Math.max(...redirectedSales) : 0;
    return { prod, brief, appr, maxSales, total: prod + brief + appr + maxSales };
  }, [redirectProduction, redirectBriefing, redirectApproval, productionComm, briefingComm, approvalComm, salesStaff, salesRedirect, salesComm]);

  function toggleRedirect(kind: 'briefing' | 'production' | 'approval', value: boolean) {
    if (value) {
      const designee = kind === 'briefing' ? briefingDesigneeId : kind === 'production' ? allocationDesigneeId : approvalDesigneeId;
      if (!hasLinked(designee)) return toast.error('Please ask the staff to link a bank account');
    }
    if (kind === 'briefing') setRedirectBriefing(value);
    if (kind === 'production') setRedirectProduction(value);
    if (kind === 'approval') setRedirectApproval(value);
  }

  function toggleSalesRedirect(id: string, value: boolean) {
    if (value && !hasLinked(id)) return toast.error('Please ask the staff to link a bank account');
    setSalesRedirect((p) => ({ ...p, [id]: value }));
  }

  function addSalesStaff(id: string) {
    if (!id || salesStaff.includes(id)) return;
    setSalesStaff((p) => [...p, id]);
    setSalesComm((p) => ({ ...p, [id]: '0' }));
    setSalesRedirect((p) => ({ ...p, [id]: false }));
  }
  function removeSalesStaff(id: string) {
    setSalesStaff((p) => p.filter((x) => x !== id));
  }

  function submit() {
    const salesPersonCommissions: Record<string, number> = {};
    for (const id of salesStaff) if (salesRedirect[id]) salesPersonCommissions[id] = Number(salesComm[id]) || 0;
    save.mutate({
      agencyId,
      briefingDesigneeId,
      allocationDesigneeId,
      approvalDesigneeId,
      salesStaffIds: salesStaff,
      redirectBriefingCommissionToBankAccount: redirectBriefing,
      redirectProductionCommissionToBankAccount: redirectProduction,
      redirectSalesPersonCommissionToBankAccount: Object.values(salesRedirect).some(Boolean),
      redirectInternalApprovalCommissionToBankAccount: redirectApproval,
      salesPersonCommissions,
      // A commission only applies when redirected to the bank account; otherwise it's 0.
      productionManagerCommission: redirectProduction ? Number(productionComm) || 0 : 0,
      briefingManagerCommission: redirectBriefing ? Number(briefingComm) || 0 : 0,
      internalApprovalCommission: redirectApproval ? Number(approvalComm) || 0 : 0,
    });
  }

  const availableToAdd = members.filter((m) => !salesStaff.includes(m.id));

  return (
    <div>
      <PageHeader
        title="Workflow settings"
        description="Assign role designees and configure your commission split."
        action={<Button variant="accent" disabled={save.isPending} onClick={submit}>{save.isPending ? 'Saving…' : 'Save settings'}</Button>}
      />

      <div className="flex flex-col gap-4">
        {/* Designees */}
        <Card className="p-5">
          <FormSection title="Role designees" description="Who handles each stage of a project by default.">
            <div className="grid gap-3 sm:grid-cols-3">
              <Field label="Briefing"><DesigneeSelect members={members} value={briefingDesigneeId} onChange={setBriefing} /></Field>
              <Field label="Allocation / Production"><DesigneeSelect members={members} value={allocationDesigneeId} onChange={setAllocation} /></Field>
              <Field label="Internal approval"><DesigneeSelect members={members} value={approvalDesigneeId} onChange={setApproval} /></Field>
            </div>
          </FormSection>
        </Card>

        {/* Commission split */}
        <Card className="p-5">
          <FormSection title="Commission split" description="Percentage of each project that goes to each role. Toggle 'redirect to bank' to pay a role's commission to the agency account.">
            <CommissionRow label="Production" value={productionComm} onValue={setProductionComm} redirect={redirectProduction} onRedirect={(v) => toggleRedirect('production', v)} canRedirect={hasLinked(allocationDesigneeId)} />
            <CommissionRow label="Briefing" value={briefingComm} onValue={setBriefingComm} redirect={redirectBriefing} onRedirect={(v) => toggleRedirect('briefing', v)} canRedirect={hasLinked(briefingDesigneeId)} />
            <CommissionRow label="Internal approval" value={approvalComm} onValue={setApprovalComm} redirect={redirectApproval} onRedirect={(v) => toggleRedirect('approval', v)} canRedirect={hasLinked(approvalDesigneeId)} />
          </FormSection>
        </Card>

        {/* Sales staff */}
        <Card className="p-5">
          <FormSection title="Sales staff" description="Team members who can earn a sales commission.">
            <div className="flex flex-col gap-2">
              {salesStaff.map((id) => {
                const m = memberById[id];
                return (
                  <div key={id} className="flex items-center gap-3 rounded-[var(--radius-sm)] border border-[color:var(--color-border-default)] px-3 py-2">
                    <Avatar className="h-7 w-7">
                      {m?.profileUrl && <AvatarImage src={m.profileUrl} />}
                      <AvatarFallback>{(m?.name ?? '?').slice(0, 2).toUpperCase()}</AvatarFallback>
                    </Avatar>
                    <span className="flex-1 truncate text-sm text-ink-100">{m?.name ?? id}</span>
                    {/* Commission field only applies once redirected to the bank account; otherwise it's 0. */}
                    {salesRedirect[id]
                      ? <Input className="w-24" type="number" min="0" placeholder="%" value={salesComm[id] ?? '0'} onChange={(e) => setSalesComm((p) => ({ ...p, [id]: e.target.value }))} />
                      : <span className="w-24 text-right text-sm text-ink-40">0%</span>}
                    <button
                      type="button"
                      onClick={() => toggleSalesRedirect(id, !salesRedirect[id])}
                      className={`rounded-[var(--radius-pill)] border px-2.5 py-1 text-[0.6875rem] uppercase tracking-wide ${salesRedirect[id] ? 'border-accent/30 bg-accent/12 text-accent' : 'border-[color:var(--color-border-default)] text-ink-40'}`}
                    >
                      Redirect
                    </button>
                    {!m?.isOwner && <Button size="icon" variant="ghost" onClick={() => removeSalesStaff(id)}><X className="h-4 w-4" /></Button>}
                  </div>
                );
              })}
              {availableToAdd.length > 0 && (
                <div className="flex items-center gap-2">
                  <AvatarSelect
                    value=""
                    onChange={addSalesStaff}
                    placeholder="Add sales staff…"
                    options={availableToAdd.map((m) => ({ id: m.id, name: m.name, imageUrl: m.profileUrl }))}
                    className="flex-1"
                  />
                  <Plus className="h-4 w-4 text-ink-40" />
                </div>
              )}
            </div>
          </FormSection>
        </Card>

        {/* Summary — only meaningful once something is actually redirected. */}
        {summary.total > 0 && (
          <Card className="flex items-center gap-3 p-4">
            <Info className="h-4 w-4 text-ink-40" />
            <p className="text-sm text-ink-60">
              Redirected commission total:{' '}
              <span className="font-semibold text-ink-100">{formatPercent(summary.total)}</span>{' '}
              (production {summary.prod}% · briefing {summary.brief}% · approval {summary.appr}% · sales {summary.maxSales}%). Must stay below your agency commission cap.
            </p>
          </Card>
        )}
      </div>
    </div>
  );
}

function DesigneeSelect({ members, value, onChange }: { members: Member[]; value: string; onChange: (v: string) => void }) {
  // Keep the value valid if the member list loads after mount.
  useEffect(() => {
    if (members.length && !members.some((m) => m.id === value)) onChange(members[0].id);
  }, [members]); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <AvatarSelect
      value={value}
      onChange={onChange}
      options={members.map((m) => ({ id: m.id, name: m.name, imageUrl: m.profileUrl, suffix: m.isOwner ? '(owner)' : undefined }))}
    />
  );
}

function CommissionRow({ label, value, onValue, redirect, onRedirect, canRedirect }: { label: string; value: string; onValue: (v: string) => void; redirect: boolean; onRedirect: (v: boolean) => void; canRedirect: boolean }) {
  return (
    <div className="flex flex-col gap-2 md:flex-row md:items-center md:gap-3">
      <div className="flex items-center gap-3">
        <span className="text-sm text-ink-100 md:w-40">{label}</span>
        {/* The commission field only applies once it's redirected to the bank account; otherwise it's 0. */}
        {redirect
          ? <Input className="w-28" type="number" min="0" placeholder="%" value={value} onChange={(e) => onValue(e.target.value)} />
          : <span className="w-28 text-sm text-ink-40">0%</span>}
      </div>
      <div className="flex-1">
        <ToggleRow label="Redirect to bank account" checked={redirect} onChange={onRedirect} disabled={!canRedirect && !redirect} />
      </div>
    </div>
  );
}
