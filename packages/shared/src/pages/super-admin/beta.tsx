/**
 * Super-admin → Beta programme (`/super-admin/beta`, Prodesk app only).
 *
 * Two things happen here:
 *
 *  1. COHORTS. Create and edit beta versions (`v1`, `v2`, …). A version carries a
 *     duration in days and an optional signup cap; its code is what goes in the
 *     shareable `/signup?beta=<code>` link. Editing a duration affects only FUTURE
 *     signups — members keep the deadline they were promised, which is why
 *     extending an individual is a separate, audited action.
 *
 *  2. MEMBERS. Open a cohort to see everyone in it with their days remaining, and
 *     extend any one of them by N days. An extension revives a lapsed member
 *     (access rides on the same deadline every paid gate reads) and re-arms their
 *     7/3/0-day reminder emails.
 *
 * Model + rules: docs/beta-program.md.
 */
import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import {
  CalendarClock,
  Copy,
  Link2,
  Plus,
  Sparkles,
  UserPlus,
} from 'lucide-react';
import { useTRPC } from '../../lib/trpc';
import { cn, formatPrice } from '../../lib/utils';
import { toastError } from '../../lib/errors';
import { mainAppUrl } from '../../lib/origins';
import { PageHeader } from '../../components/layout/page-header';
import { Button } from '../../components/ui/button';
import { Card } from '../../components/ui/card';
import { Input } from '../../components/ui/input';
import { Badge } from '../../components/ui/badge';
import { Skeleton } from '../../components/ui/skeleton';
import { Pagination } from '../../components/ui/pagination';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '../../components/ui/dialog';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '../../components/ui/table';
import { SearchBar, SectionCard, StatCard, Switch } from './components';
import { Field } from '../agency/form-bits';

const MEMBER_LIMIT = 25;

/** Quick-pick extension lengths — the lengths support actually reaches for. */
const EXTEND_PRESETS = [7, 14, 30, 60, 90];

const dateFmt = (v: string | Date | null | undefined) =>
  v
    ? new Date(v).toLocaleDateString(undefined, {
        day: 'numeric',
        month: 'short',
        year: 'numeric',
      })
    : '—';

export function BetaAdminPage() {
  const trpc = useTRPC();
  const overview = useQuery(trpc.beta.adminOverview.queryOptions());
  const versions = useQuery(trpc.beta.adminVersions.queryOptions());
  const [createOpen, setCreateOpen] = useState(false);
  const [openVersionId, setOpenVersionId] = useState<string | null>(null);

  const rows = versions.data ?? [];
  const openVersion = rows.find((v) => v.id === openVersionId) ?? null;

  return (
    <div className="px-4 py-6 md:px-8">
      <PageHeader
        title="Beta programme"
        description="Time-boxed free access to the whole suite in exchange for feedback. Each version is a cohort with its own length; members are extended individually."
      />

      <div className="mb-6 flex flex-wrap gap-3">
        <StatCard label="Beta members" value={overview.data?.enrolled ?? 0} />
        <StatCard
          label="Access live"
          value={overview.data?.live ?? 0}
          tone="success"
        />
        <StatCard
          label="Ending this week"
          value={overview.data?.endingThisWeek ?? 0}
          tone="warn"
        />
        <StatCard label="Ended" value={overview.data?.expired ?? 0} />
        <StatCard
          label="Unlimited (manual)"
          value={overview.data?.unlimited ?? 0}
        />
      </div>

      <SectionCard
        icon={<Sparkles className="h-5 w-5" />}
        title="Versions"
        description="A version's duration applies to new signups. Existing members keep the end date they were given — extend them individually instead."
        action={
          <Button onClick={() => setCreateOpen(true)}>
            <Plus className="h-4 w-4" /> New version
          </Button>
        }
      >
        {versions.isLoading ? (
          <div className="space-y-2">
            {Array.from({ length: 3 }).map((_, i) => (
              <Skeleton key={i} className="h-12 w-full" />
            ))}
          </div>
        ) : rows.length === 0 ? (
          <p className="py-10 text-center text-sm text-ink-40">
            No beta versions yet. Create one to start inviting people with a{' '}
            <code className="rounded bg-inset px-1.5 py-0.5 text-xs">
              ?beta=
            </code>{' '}
            link.
          </p>
        ) : (
          <div className="space-y-3">
            {rows.map((v) => (
              <VersionRow
                key={v.id}
                version={v}
                onOpen={() => setOpenVersionId(v.id)}
              />
            ))}
          </div>
        )}
      </SectionCard>

      <CreateVersionDialog open={createOpen} onOpenChange={setCreateOpen} />

      <Dialog
        open={!!openVersion}
        onOpenChange={(o) => !o && setOpenVersionId(null)}
      >
        <DialogContent className="max-h-[90vh] max-w-4xl overflow-y-auto">
          {openVersion && <VersionMembers version={openVersion} />}
        </DialogContent>
      </Dialog>
    </div>
  );
}

type VersionRowData = {
  id: string;
  code: string;
  label: string | null;
  description: string | null;
  durationDays: number;
  active: boolean;
  signupLimit: number | null;
  memberCount: number;
  activeMemberCount: number;
  expiredMemberCount: number;
  seatsRemaining: number | null;
};

function VersionRow({
  version,
  onOpen,
}: {
  version: VersionRowData;
  onOpen: () => void;
}) {
  const trpc = useTRPC();
  const qc = useQueryClient();
  const update = useMutation({
    ...trpc.beta.adminUpdateVersion.mutationOptions(),
    onSuccess: () => {
      void qc.invalidateQueries({
        queryKey: trpc.beta.adminVersions.queryKey(),
      });
    },
    onError: (e) => toastError(e),
  });

  // The signup link points at the MAIN app: it's the canonical front door, and the
  // beta code is redeemed at provisioning regardless of which frontend they land on.
  const signupUrl = mainAppUrl(
    `/signup?beta=${encodeURIComponent(version.code)}`,
  );

  return (
    <div className="rounded-[var(--radius-md)] border border-[color:var(--color-border-hairline)] p-4">
      <div className="flex flex-wrap items-start gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <code className="rounded-[var(--radius-sm)] bg-inset px-2 py-0.5 text-sm font-semibold text-ink-100">
              {version.code}
            </code>
            {version.label && (
              <span className="text-sm font-medium text-ink-80">
                {version.label}
              </span>
            )}
            <Badge variant={version.active ? 'outline' : 'muted'}>
              {version.active ? 'Open' : 'Closed'}
            </Badge>
            {version.seatsRemaining != null && (
              <Badge variant="muted">
                {version.seatsRemaining} of {version.signupLimit} seats left
              </Badge>
            )}
          </div>
          {version.description && (
            <p className="mt-1.5 text-sm leading-relaxed text-ink-60">
              {version.description}
            </p>
          )}
          <p className="mt-2 text-xs text-ink-40">
            {version.durationDays} days from signup · {version.memberCount}{' '}
            member
            {version.memberCount === 1 ? '' : 's'} ({version.activeMemberCount}{' '}
            live, {version.expiredMemberCount} ended)
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <label className="flex items-center gap-2 text-xs text-ink-60">
            Accepting signups
            <Switch
              checked={version.active}
              disabled={update.isPending}
              onChange={(next) =>
                update.mutate({ id: version.id, active: next })
              }
            />
          </label>
          <Button variant="outline" size="sm" onClick={onOpen}>
            <UserPlus className="h-4 w-4" /> Members
          </Button>
        </div>
      </div>

      {/* Shareable signup link — the whole point of a version code. */}
      <div className="mt-3 flex items-center gap-2 rounded-[var(--radius-sm)] bg-inset px-3 py-2">
        <Link2 className="h-3.5 w-3.5 shrink-0 text-ink-40" />
        <code className="min-w-0 flex-1 truncate text-xs text-ink-60">
          {signupUrl}
        </code>
        <button
          type="button"
          onClick={() => {
            void navigator.clipboard
              .writeText(signupUrl)
              .then(() => toast.success('Signup link copied'))
              .catch(() => toast.error('Could not copy the link'));
          }}
          className="shrink-0 rounded-[var(--radius-sm)] p-1 text-ink-40 transition-colors hover:bg-card hover:text-ink-100"
          aria-label="Copy signup link"
        >
          <Copy className="h-3.5 w-3.5" />
        </button>
      </div>
    </div>
  );
}

function CreateVersionDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
}) {
  const trpc = useTRPC();
  const qc = useQueryClient();
  const [code, setCode] = useState('');
  const [label, setLabel] = useState('');
  const [description, setDescription] = useState('');
  const [durationDays, setDurationDays] = useState('90');
  const [signupLimit, setSignupLimit] = useState('');

  const create = useMutation({
    ...trpc.beta.adminCreateVersion.mutationOptions(),
    onSuccess: () => {
      void qc.invalidateQueries({
        queryKey: trpc.beta.adminVersions.queryKey(),
      });
      void qc.invalidateQueries({
        queryKey: trpc.beta.adminOverview.queryKey(),
      });
      toast.success('Beta version created');
      setCode('');
      setLabel('');
      setDescription('');
      setDurationDays('90');
      setSignupLimit('');
      onOpenChange(false);
    },
    onError: (e) => toastError(e),
  });

  const days = Number(durationDays);
  const validDays = Number.isInteger(days) && days >= 1 && days <= 1825;
  const validCode = /^[a-zA-Z0-9][a-zA-Z0-9-]{0,39}$/.test(code.trim());

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>New beta version</DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          <Field
            label="Code"
            htmlFor="beta-code"
            hint="Appears in the signup link: /signup?beta=<code>. Letters, numbers and hyphens. Can't be changed later — a shared link must keep meaning the same thing."
            error={
              code.length > 0 && !validCode
                ? 'Letters, numbers and hyphens only'
                : null
            }
          >
            <Input
              id="beta-code"
              value={code}
              onChange={(e) => setCode(e.target.value)}
              placeholder="v1"
              autoComplete="off"
            />
          </Field>

          <Field
            label="Name"
            htmlFor="beta-label"
            hint="Shown on the signup screen."
          >
            <Input
              id="beta-label"
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              placeholder="Founding members"
            />
          </Field>

          <Field
            label="Description"
            htmlFor="beta-desc"
            hint="The pitch on the signup screen. Leave blank for the default wording."
          >
            <Input
              id="beta-desc"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Full access to every Prodesk tool while we build in public."
            />
          </Field>

          <Field
            label="Length (days)"
            htmlFor="beta-days"
            hint="Counted from each member's own signup date, so joining later means ending later."
            error={durationDays.length > 0 && !validDays ? '1–1825 days' : null}
          >
            <Input
              id="beta-days"
              type="number"
              min={1}
              max={1825}
              value={durationDays}
              onChange={(e) => setDurationDays(e.target.value)}
            />
          </Field>

          <Field
            label="Signup cap"
            htmlFor="beta-limit"
            hint="Optional. Once reached, the code stops working for new signups — nobody already in is affected."
          >
            <Input
              id="beta-limit"
              type="number"
              min={1}
              value={signupLimit}
              onChange={(e) => setSignupLimit(e.target.value)}
              placeholder="Unlimited"
            />
          </Field>
        </div>

        <div className="flex justify-end gap-2">
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            variant="accent"
            disabled={!validCode || !validDays || create.isPending}
            onClick={() =>
              create.mutate({
                code: code.trim(),
                label: label.trim() || undefined,
                description: description.trim() || undefined,
                durationDays: days,
                active: true,
                signupLimit: signupLimit.trim() ? Number(signupLimit) : null,
              })
            }
          >
            {create.isPending ? 'Creating…' : 'Create version'}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function VersionMembers({ version }: { version: VersionRowData }) {
  const trpc = useTRPC();
  const [search, setSearch] = useState('');
  const [offset, setOffset] = useState(0);
  const [extendUserId, setExtendUserId] = useState<string | null>(null);

  const members = useQuery(
    trpc.beta.adminVersionUsers.queryOptions({
      versionId: version.id,
      search: search || undefined,
      limit: MEMBER_LIMIT,
      offset,
    }),
  );
  const items = members.data?.items ?? [];

  return (
    <div>
      <DialogHeader>
        <DialogTitle>
          {version.label ?? `Beta ${version.code}`} — members
        </DialogTitle>
      </DialogHeader>
      <p className="mb-4 text-sm text-ink-60">
        Soonest deadline first. Extending someone adds days to their own end
        date — counted from now if theirs already passed, so an extension is
        always usable.
      </p>

      <SearchBar
        value={search}
        onChange={(v) => {
          setSearch(v);
          setOffset(0);
        }}
        placeholder="Search name or email…"
      />

      <Card className="overflow-hidden p-0">
        {members.isLoading ? (
          <div className="space-y-2 p-4">
            {Array.from({ length: 5 }).map((_, i) => (
              <Skeleton key={i} className="h-10 w-full" />
            ))}
          </div>
        ) : items.length === 0 ? (
          <p className="py-12 text-center text-sm text-ink-40">
            {search
              ? 'Nobody matches that search.'
              : 'Nobody has joined this version yet.'}
          </p>
        ) : (
          <>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Member</TableHead>
                  <TableHead>Joined</TableHead>
                  <TableHead>Ends</TableHead>
                  <TableHead>Remaining</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {items.map((u) => {
                  const name =
                    [u.firstName, u.lastName]
                      .filter(Boolean)
                      .join(' ')
                      .trim() || '—';
                  return (
                    <TableRow key={u.id}>
                      <TableCell>
                        <p className="font-medium text-ink-100">{name}</p>
                        <p className="text-xs text-ink-40">{u.email}</p>
                      </TableCell>
                      <TableCell className="text-ink-60">
                        {dateFmt(u.betaStartedAt)}
                      </TableCell>
                      <TableCell className="text-ink-60">
                        {dateFmt(u.betaEndsAt)}
                      </TableCell>
                      <TableCell>
                        {u.betaEndsAt == null ? (
                          <Badge variant="outline">Unlimited</Badge>
                        ) : u.expired ? (
                          <Badge variant="muted">Ended</Badge>
                        ) : (
                          <span
                            className={cn(
                              'text-sm font-semibold tabular-nums',
                              (u.daysRemaining ?? 0) <= 7
                                ? 'text-warn'
                                : 'text-ink-100',
                            )}
                          >
                            {u.daysRemaining} day
                            {u.daysRemaining === 1 ? '' : 's'}
                          </span>
                        )}
                      </TableCell>
                      <TableCell className="text-right">
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => setExtendUserId(u.id)}
                        >
                          <CalendarClock className="h-4 w-4" /> Extend
                        </Button>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
            <Pagination
              total={members.data?.total ?? 0}
              limit={MEMBER_LIMIT}
              offset={offset}
              onChange={setOffset}
            />
          </>
        )}
      </Card>

      <Dialog
        open={!!extendUserId}
        onOpenChange={(o) => !o && setExtendUserId(null)}
      >
        <DialogContent className="max-h-[90vh] max-w-lg overflow-y-auto">
          {extendUserId && (
            <ExtendMember
              userId={extendUserId}
              onDone={() => setExtendUserId(null)}
            />
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}

function ExtendMember({
  userId,
  onDone,
}: {
  userId: string;
  onDone: () => void;
}) {
  const trpc = useTRPC();
  const qc = useQueryClient();
  const detail = useQuery(trpc.beta.adminUserDetail.queryOptions({ userId }));
  const [days, setDays] = useState('30');
  const [reason, setReason] = useState('');

  const extend = useMutation({
    ...trpc.beta.adminExtendUser.mutationOptions(),
    onSuccess: (res) => {
      void qc.invalidateQueries({
        queryKey: trpc.beta.adminVersionUsers.queryKey(),
      });
      void qc.invalidateQueries({
        queryKey: trpc.beta.adminOverview.queryKey(),
      });
      void qc.invalidateQueries({
        queryKey: trpc.beta.adminVersions.queryKey(),
      });
      toast.success(
        res.revived
          ? `Access restored — now ends ${dateFmt(res.newEndsAt)}`
          : `Extended to ${dateFmt(res.newEndsAt)}`,
      );
      onDone();
    },
    onError: (e) => toastError(e),
  });

  const n = Number(days);
  const validDays = Number.isInteger(n) && n >= 1 && n <= 730;
  const status = detail.data?.status;
  const report = detail.data?.report;
  const notices = detail.data?.notices ?? [];
  const extensions = detail.data?.extensions ?? [];

  return (
    <div>
      <DialogHeader>
        <DialogTitle>Extend beta access</DialogTitle>
      </DialogHeader>

      {detail.isLoading ? (
        <Skeleton className="h-24 w-full" />
      ) : (
        <div className="space-y-5">
          <div className="rounded-[var(--radius-sm)] bg-inset px-4 py-3 text-sm">
            <p className="text-ink-60">
              Currently{' '}
              <span className="font-semibold text-ink-100">
                {status?.active ? 'live' : 'ended'}
              </span>
              {status?.endsAt
                ? ` · ends ${dateFmt(status.endsAt)}`
                : ' · no end date'}
              {status?.daysRemaining != null
                ? ` · ${status.daysRemaining} day${status.daysRemaining === 1 ? '' : 's'} left`
                : ''}
            </p>
            {report && report.lines.length > 0 && (
              <p className="mt-1.5 text-xs text-ink-40">
                Would be billed{' '}
                {formatPrice(report.monthlyTotal, report.currency)}/month across{' '}
                {report.lines.length} tool{report.lines.length === 1 ? '' : 's'}
                .
              </p>
            )}
            {notices.length > 0 && (
              <p className="mt-1.5 text-xs text-ink-40">
                Warned:{' '}
                {notices.map((nt) => nt.kind.replace('day_', '')).join(', ')}{' '}
                days out.
              </p>
            )}
          </div>

          <div>
            <p className="mb-2 text-xs font-medium text-ink-60">Add</p>
            <div className="flex flex-wrap gap-2">
              {EXTEND_PRESETS.map((p) => (
                <button
                  key={p}
                  type="button"
                  onClick={() => setDays(String(p))}
                  className={cn(
                    'press rounded-[var(--radius-pill)] border px-3 py-1.5 text-sm font-medium transition-colors',
                    Number(days) === p
                      ? 'border-accent bg-accent/10 text-accent'
                      : 'border-[color:var(--color-border-default)] text-ink-60 hover:text-ink-100',
                  )}
                >
                  {p} days
                </button>
              ))}
            </div>
          </div>

          <Field
            label="Days"
            htmlFor="extend-days"
            error={days.length > 0 && !validDays ? '1–730 days' : null}
          >
            <Input
              id="extend-days"
              type="number"
              min={1}
              max={730}
              value={days}
              onChange={(e) => setDays(e.target.value)}
            />
          </Field>

          <Field
            label="Reason"
            htmlFor="extend-reason"
            hint="Recorded against the extension so the history explains itself later."
          >
            <Input
              id="extend-reason"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="Gave detailed feedback on the proposals flow"
            />
          </Field>

          {extensions.length > 0 && (
            <div>
              <p className="mb-2 text-xs font-medium text-ink-60">
                Previous extensions
              </p>
              <ul className="space-y-1.5">
                {extensions.map((e) => (
                  <li key={e.id} className="text-xs text-ink-40">
                    +{e.days} days → {dateFmt(e.newEndsAt)}
                    {e.reason ? ` · ${e.reason}` : ''}
                  </li>
                ))}
              </ul>
            </div>
          )}

          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={onDone}>
              Cancel
            </Button>
            <Button
              variant="accent"
              disabled={!validDays || extend.isPending}
              onClick={() =>
                extend.mutate({
                  userId,
                  days: n,
                  reason: reason.trim() || undefined,
                })
              }
            >
              {extend.isPending
                ? 'Extending…'
                : `Add ${validDays ? n : 0} days`}
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
