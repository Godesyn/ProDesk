/**
 * Pure port of the Kanban transition → action mapping from the Flutter source of
 * truth (lib/.../kanban_permission_service.dart getTransitionAction, lines
 * 312-360) plus the clientApprove override in kanban_column.dart (lines 86-110).
 *
 * The server (projects.ts getAllowedTransitions) decides *whether* a card may
 * move to a column; this helper decides *which dialog* a permitted drop opens.
 * It is permission-free and deterministic, so it lives entirely on the client.
 */

export type ProjectStatus =
  | 'clientBrief'
  | 'upcoming'
  | 'brief'
  | 'allocate'
  | 'production'
  | 'internalApproval'
  | 'revision'
  | 'clientApproval'
  | 'completed';

export type KanbanTransitionAction =
  | 'completeClientBrief' // clientBrief → brief/upcoming (brand submits brief)
  | 'completeBrief' // brief → allocate
  | 'allocateProject' // allocate → production
  | 'uploadDeliverable' // production/revision → internalApproval
  | 'internalApprove' // internalApproval/revision → clientApproval
  | 'internalReject' // internalApproval → revision
  | 'clientApprove' // clientApproval → completed (pre-override)
  | 'markComplete' // agency requests completion: emails the brand a confirm link
  | 'manualClientApprove' // agency completes an external project on the client's behalf
  | 'directComplete' // immediate completion (brand approval / internal project)
  | 'clientReject' // clientApproval → internalApproval/revision
  | 'startRevision' // revision → production
  | 'moveToClientBrief' // upcoming → clientBrief
  | 'forceStartUpcoming' // upcoming → brief
  | 'invalid';

/** Faithful mirror of getTransitionAction(from, to). */
export function getTransitionAction(from: ProjectStatus, to: ProjectStatus): KanbanTransitionAction {
  if (from === 'clientBrief' && to === 'upcoming') return 'completeClientBrief';
  if (from === 'clientBrief' && to === 'brief') return 'completeClientBrief';
  if (from === 'upcoming' && to === 'clientBrief') return 'moveToClientBrief';
  if (from === 'upcoming' && to === 'brief') return 'forceStartUpcoming';
  if (from === 'brief' && to === 'allocate') return 'completeBrief';
  if (from === 'allocate' && to === 'production') return 'allocateProject';
  if ((from === 'production' || from === 'revision') && to === 'internalApproval') return 'uploadDeliverable';
  if ((from === 'internalApproval' || from === 'revision') && to === 'clientApproval') return 'internalApprove';
  if (from === 'internalApproval' && to === 'revision') return 'internalReject';
  if (from === 'revision' && to === 'production') return 'startRevision';
  if (to === 'completed') return 'clientApprove';
  if (from === 'clientApproval' && (to === 'internalApproval' || to === 'revision')) return 'clientReject';
  return 'invalid';
}

/**
 * Resolves the action for a permitted drop, applying the clientApprove override
 * (kanban_column.dart:86-110). An agency completing an *external* project does
 * NOT complete directly — it requests completion (`markComplete`), which emails
 * the connected brand a one-click confirmation link (the brand owns final
 * completion). Brand approvals and internal projects complete directly. The
 * manual "complete on the client's behalf" override lives on the detail page.
 */
export function resolveDropAction(
  from: ProjectStatus,
  to: ProjectStatus,
  opts: { workspace: 'agency' | 'brand'; isInternal: boolean },
): KanbanTransitionAction {
  const action = getTransitionAction(from, to);
  if (action !== 'clientApprove') return action;
  if (opts.workspace === 'brand') return 'directComplete';
  return opts.isInternal ? 'directComplete' : 'markComplete';
}

/**
 * Actions that commit immediately with no dialog (mirrors kanban_column._handleDrop).
 * Completion is NOT direct: `directComplete`/`markComplete` open a deliverable
 * review dialog so no one completes a project without first seeing the delivery
 * list and being able to annotate/attach/request revision.
 */
export function isDirectAction(action: KanbanTransitionAction): boolean {
  return (
    action === 'startRevision' ||
    action === 'moveToClientBrief' ||
    action === 'forceStartUpcoming'
  );
}
