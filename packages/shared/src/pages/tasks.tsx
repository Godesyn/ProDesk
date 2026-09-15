import { useEffect, useRef, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useTRPC } from '../lib/trpc';
import { useCurrentUser } from '../auth/auth-context';
import { useIsMobile } from '../hooks/use-is-mobile';
import { PageHeader } from '../components/layout/page-header';
import { cn } from '../lib/utils';
import { MySection } from './tasks/my-section';
import { TeamSection } from './tasks/team-section';
import { TaskDetailDialog } from './tasks/task-detail-dialog';
import type { TaskRow, TaskCategory } from './tasks/task-utils';

interface DragState { task: TaskRow; from: TaskCategory; }

export function TasksPage() {
  const trpc = useTRPC();
  const qc = useQueryClient();
  const { data: me } = useCurrentUser();
  const [openTask, setOpenTask] = useState<TaskRow | null>(null);
  const [dragState, setDragState] = useState<DragState | null>(null);

  const isContractor = me?.role === 'individualContractor';
  const isMobile = useIsMobile();
  // Mobile non-contractors get a tabbed single-column layout (each pane full
  // width) instead of the desktop two-pane split.
  const showTabs = isMobile && !isContractor;
  const [activeTab, setActiveTab] = useState<'my' | 'team'>('my');

  // Snapshot the previous "viewed at" once on landing (mirrors Flutter's
  // tasksScreenLandedAtProvider) so unviewed dots stay visible this session;
  // then stamp lastTasksViewedAt so the next visit starts clean.
  const landedAtRef = useRef<Date | string | null | undefined>(undefined);
  if (landedAtRef.current === undefined && me) {
    landedAtRef.current = me.lastTasksViewedAt ?? null;
  }
  const lastViewedAt = landedAtRef.current ?? null;

  const markViewed = useMutation(trpc.tasks.markTasksViewed.mutationOptions());
  const markedRef = useRef<string | null>(null);
  useEffect(() => {
    if (!me || markedRef.current === me.id) return;
    markedRef.current = me.id;
    markViewed.mutate(undefined, {
      onSuccess: () => qc.invalidateQueries({ queryKey: trpc.auth.me.queryKey() }),
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [me?.id]);

  const mySection = (
    <MySection
      lastViewedAt={lastViewedAt}
      onOpenTask={setOpenTask}
      dragState={dragState}
      setDragState={setDragState}
    />
  );
  const teamSection = !isContractor && (
    <TeamSection
      lastViewedAt={lastViewedAt}
      onOpenTask={setOpenTask}
      dragState={dragState}
      setDragState={setDragState}
    />
  );

  // Mobile (non-contractor): single-column tabbed layout — each pane gets the
  // full width and the page scrolls naturally (no trapped fixed-height region).
  if (showTabs) {
    return (
      <div className="flex flex-col">
        <PageHeader title="Tasks" description="Your action items across the platform." />

        <div className="flex gap-2 border-b border-[color:var(--color-border-hairline)]">
          {(['my', 'team'] as const).map((tab) => (
            <button
              key={tab}
              onClick={() => setActiveTab(tab)}
              className={cn(
                'flex-1 border-b-2 px-3 py-2 text-sm font-semibold transition-colors',
                activeTab === tab
                  ? 'border-accent text-ink-100'
                  : 'border-transparent text-ink-40 hover:text-ink-80',
              )}
            >
              {tab === 'my' ? 'My Tasks' : 'Team'}
            </button>
          ))}
        </div>

        <div className="rounded-b-[var(--radius-md)] border border-t-0 border-[color:var(--color-border-hairline)] bg-card">
          <div className={activeTab === 'my' ? '' : 'hidden'}>{mySection}</div>
          <div className={activeTab === 'team' ? '' : 'hidden'}>{teamSection}</div>
        </div>

        {openTask && <TaskDetailDialog task={openTask} onClose={() => setOpenTask(null)} />}
      </div>
    );
  }

  return (
    <div className="flex h-[calc(100vh-7rem)] flex-col">
      <PageHeader title="Tasks" description="Your action items across the platform." />

      <div className="flex flex-1 overflow-hidden rounded-[var(--radius-md)] border border-[color:var(--color-border-hairline)] bg-card">
        {/* Personal pane (web: flex 2, contractor: full width). min-w-0 lets long
            task titles ellipsize instead of forcing the pane wider. */}
        <div className={isContractor ? 'min-w-0 flex-1' : 'min-w-0 flex-[2]'}>
          {mySection}
        </div>

        {/* Team pane (non-contractors only) */}
        {!isContractor && (
          <>
            <div className="w-px shrink-0 bg-[color:var(--color-border-hairline)]" />
            <div className="min-w-0 flex-1">
              {teamSection}
            </div>
          </>
        )}
      </div>

      {openTask && <TaskDetailDialog task={openTask} onClose={() => setOpenTask(null)} />}
    </div>
  );
}
