import { useState } from 'react';
import { useLocation } from 'wouter';
import { useQuery } from '@tanstack/react-query';
import {
  Building2,
  Briefcase,
  User,
  ArrowRight,
  Mail,
  Link2,
  ChevronRight,
} from 'lucide-react';
import { useTRPC } from '../lib/trpc';
import { useCurrentUser } from '../auth/auth-context';
import { Button } from '../components/ui/button';
import { TaskDetailDialog } from './tasks/task-detail-dialog';
import { shortSummary, type TaskRow } from './tasks/task-utils';

/**
 * Role selection (Flutter role_selection_screen). Picking a role does NOT set it
 * — it navigates to the matching create screen, and the role + organization are
 * committed only once that entity is created (brands.create / agencies.create /
 * contractor.create). This mirrors role_selection_screen.dart, whose cards call
 * context.pushPreservingParams('/create-brand' | '/create-agency' |
 * '/create-contractor').
 */
const ROLES = [
  {
    to: '/create-brand',
    label: 'Brand / Business',
    desc: 'Hire and manage agencies to deliver your projects.',
    Icon: Building2,
    contractor: false,
  },
  {
    to: '/create-agency',
    label: 'Agency',
    desc: 'Offer your services and manage clients & contractors.',
    Icon: Briefcase,
    contractor: false,
  },
  {
    to: '/create-contractor',
    label: 'Contractor',
    desc: 'Work with agencies on projects as an individual.',
    Icon: User,
    contractor: true,
  },
] as const;

export function RoleSelectionPage() {
  const [, navigate] = useLocation();
  const { data: user } = useCurrentUser();

  const hasRole = !!user?.role;
  const hasContractorProfile = !!user?.hasContractorProfile;
  // The "Contractor" card is hidden once a contractor profile already exists.
  const roles = ROLES.filter((r) => !r.contractor || !hasContractorProfile);

  // Carry the current query string through (Flutter pushPreservingParams) — keeps
  // ?ref / ?name (brand referral) and ?add=true (add-role mode) across the hop.
  const go = (to: string) => navigate(to + window.location.search);

  // Column count / container width track the number of visible cards so a 2-card
  // row (Contractor hidden) stays centered instead of left-hugging an empty 3rd column.
  const isTwo = roles.length === 2;

  return (
    <div className="grid place-items-center px-5 py-14">
      <div
        className={`w-full animate-reveal ${isTwo ? 'max-w-2xl' : 'max-w-3xl'}`}
      >
        <div className="mb-10 text-center">
          <div className="text-eyebrow mb-3 text-accent">Get started</div>
          <h1 className="text-h2 text-ink-100">
            How do you want to{' '}
            <span className="text-serif-italic text-accent">use Prodesk</span>?
          </h1>
          <p className="mx-auto mt-3 max-w-md text-sm leading-relaxed text-ink-60">
            Choose the role that fits you. You can set up the details on the
            next step.
          </p>
        </div>

        <div
          className={`grid gap-4 ${isTwo ? 'sm:grid-cols-2' : 'sm:grid-cols-3'}`}
        >
          {roles.map(({ to, label, desc, Icon }, i) => (
            <button
              key={to}
              onClick={() => go(to)}
              style={{ animationDelay: `${80 + i * 70}ms` }}
              className="group press animate-reveal flex flex-col gap-4 rounded-[var(--radius-md)] border border-[color:var(--color-border-hairline)] bg-card p-6 text-left shadow-1 transition-all duration-[240ms] [animation-fill-mode:backwards] hover:-translate-y-1 hover:border-accent/40 hover:shadow-2"
            >
              <span className="grid h-12 w-12 place-items-center rounded-[var(--radius-md)] bg-accent/12 text-accent ring-1 ring-accent/15 transition-colors group-hover:bg-accent group-hover:text-white">
                <Icon className="h-6 w-6" />
              </span>
              <div className="flex-1">
                <div className="text-ui-lg text-ink-100">{label}</div>
                <p className="mt-1.5 text-sm leading-relaxed text-ink-60">
                  {desc}
                </p>
              </div>
              <span className="inline-flex items-center gap-1.5 text-sm font-medium text-accent">
                Continue
                <ArrowRight className="h-4 w-4 transition-transform duration-[240ms] group-hover:translate-x-1" />
              </span>
            </button>
          ))}
        </div>

        <InvitationsSection />

        {/* "Later" escape: only once the user already has a role (Flutter shows it
            when currentUser.role != null). Returns to the dashboard untouched. */}
        {hasRole && (
          <div className="mt-8 flex justify-center">
            <Button variant="ghost" onClick={() => navigate('/')}>
              Maybe later
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}

/**
 * Task types that represent an invitation a user can accept before (or instead
 * of) picking a role — surfaced as tiles below the role cards so a freshly
 * signed-up user can act on them without first choosing a role. Mirrors
 * role_selection_screen.dart's _invitationTaskTypes.
 */
const INVITATION_TASK_TYPES = new Set(['staffInvitation', 'connectionRequest']);

/**
 * Pending invitations for the current user, shown as tappable tiles beneath the
 * role cards (port of _InvitationsSection). Pulls active tasks (inbox + todo,
 * matching Flutter's userActiveTasksProvider) and keeps only invitation types.
 * Hidden entirely when there are none. Tapping a tile opens the same
 * TaskDetailDialog the Tasks board uses, so accept/decline works identically.
 */
export function InvitationsSection() {
  const trpc = useTRPC();
  const [openTask, setOpenTask] = useState<TaskRow | null>(null);

  const inbox = useQuery(
    trpc.tasks.list.queryOptions({ category: 'inbox', limit: 200 }),
  );
  const todo = useQuery(
    trpc.tasks.list.queryOptions({ category: 'todo', limit: 200 }),
  );

  const invitations = [
    ...(inbox.data?.items ?? []),
    ...(todo.data?.items ?? []),
  ].filter((t) => INVITATION_TASK_TYPES.has(t.type));

  if (invitations.length === 0) return null;

  return (
    <div className="mx-auto mt-14 max-w-xl">
      <div className="mb-1 text-center text-h4 text-ink-100">
        Pending invitations
      </div>
      <p className="mb-5 text-center text-sm text-ink-60">
        You can respond to these now or after choosing a role.
      </p>
      <div className="flex flex-col gap-3">
        {invitations.map((task) => {
          const Icon = task.type === 'connectionRequest' ? Link2 : Mail;
          return (
            <button
              key={task.id}
              onClick={() => setOpenTask(task)}
              className="group press flex items-center gap-4 rounded-[var(--radius-md)] border border-[color:var(--color-border-hairline)] bg-card px-5 py-4 text-left shadow-1 transition-all duration-[200ms] hover:border-accent/40 hover:shadow-2"
            >
              <span className="grid h-10 w-10 shrink-0 place-items-center rounded-[var(--radius-md)] bg-accent/12 text-accent ring-1 ring-accent/15 transition-colors group-hover:bg-accent group-hover:text-white">
                <Icon className="h-5 w-5" />
              </span>
              <div className="min-w-0 flex-1">
                <div className="truncate text-ui-md text-ink-100">
                  {task.title}
                </div>
                <div className="truncate text-sm text-ink-60">
                  {shortSummary(task)}
                </div>
              </div>
              <ChevronRight className="h-5 w-5 shrink-0 text-ink-40 transition-transform group-hover:translate-x-0.5" />
            </button>
          );
        })}
      </div>

      {openTask && (
        <TaskDetailDialog task={openTask} onClose={() => setOpenTask(null)} />
      )}
    </div>
  );
}
