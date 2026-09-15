/**
 * The reaction set — now shared with the workspace MessagePanel.
 *
 * It lived here first, and moved to `@shared/pages/chat/emoji` the moment the
 * workspace panel grew reactions too. Re-exported rather than repointed at every
 * call site so this app's imports keep reading `../../lib/emoji`, which is where
 * you would look for it.
 */
export { QUICK, GRID, summarise, type ReactionSummary } from '@shared/pages/chat/emoji';
