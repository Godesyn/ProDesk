/**
 * The beta programme, as one mount.
 *
 * MANDATORY on every frontend. Add `<BetaProgram />` beside `<PendingInvitePrompt />`
 * in the authenticated branch of your `App.tsx` — `scripts/check-frontend-wiring.mjs`
 * fails the typecheck if a frontend is missing it.
 *
 * The two halves are the two sides of the beta bargain:
 *   • <BetaOverlays />  — the countdown, and the price report once it ends.
 *   • <FeedbackPanel /> — the floating tab beta members give feedback through.
 *
 * Both self-suppress for non-members and neither fetches anything until it has a
 * reason to, so this is safe (and cheap) to mount app-wide on every frontend.
 *
 * Deliberately ONE component rather than two separate mounts: eleven frontends ×
 * two imports is eleven chances to wire half a feature. One symbol per frontend is
 * one thing to check, and future additions to the programme land everywhere at once.
 */
import { FeedbackPanel } from '../feedback/feedback-panel';
import { BetaOverlays } from './beta-overlays';

export function BetaProgram() {
  return (
    <>
      <BetaOverlays />
      <FeedbackPanel />
    </>
  );
}
