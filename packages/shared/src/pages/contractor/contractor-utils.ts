// Contractor-side helpers shared across the dashboard and contracts views.

/**
 * The contractor's working deadline for a project — a 1:1 port of
 * ProjectModel.contractorDeadline (project_model.dart). Starting from when the
 * work was assigned (`updatedAt`), it spreads the estimated hours across
 * business days at 8h/day, skipping weekends, and returns the resulting date.
 * Returns null when either input is missing (rendered as "No Deadline").
 */
export function contractorDeadline(dateAssigned: string | Date | null | undefined, hours: number | null | undefined): Date | null {
  if (!dateAssigned || hours == null) return null;
  let current = new Date(dateAssigned);
  if (Number.isNaN(current.getTime())) return null;
  let remaining = hours;
  // Guard against absurd inputs spinning the loop (mirrors Flutter's bounded data).
  let guard = 0;
  while (remaining > 0 && guard < 100000) {
    guard++;
    const day = current.getDay(); // 0 = Sun, 6 = Sat
    const isWeekend = day === 0 || day === 6;
    if (!isWeekend) {
      if (remaining >= 8) {
        remaining -= 8;
        current = new Date(current.getTime() + 24 * 60 * 60 * 1000);
      } else {
        const runHours = (remaining / 8) * 24;
        current = new Date(current.getTime() + Math.trunc(runHours * 60) * 60 * 1000);
        remaining = 0;
      }
    } else {
      current = new Date(current.getTime() + 24 * 60 * 60 * 1000);
    }
  }
  return current;
}

/** Whether the contractor's working deadline has elapsed (isContractorDurationExceeded). */
export function isContractorDurationExceeded(dateAssigned: string | Date | null | undefined, hours: number | null | undefined): boolean {
  const deadline = contractorDeadline(dateAssigned, hours);
  if (!deadline) return false;
  return Date.now() > deadline.getTime();
}
