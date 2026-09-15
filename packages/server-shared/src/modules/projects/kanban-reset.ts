/**
 * @deprecated Recurring re-cycling moved to {@link ./recurring-schedule} which
 * uses exact-time per-project BullMQ jobs (drift-free, payment-gated, no global
 * sweep). This thin re-export keeps older import sites working and forwards to
 * the daily reconciliation backstop.
 */
export { reconcileDueProjects as resetDueRecurringProjects } from './recurring-schedule.js';
