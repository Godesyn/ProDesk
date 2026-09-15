/* Single source of truth for "may this user edit links?" in the Links app.
 *
 * The URL workspace splits into an editor permission (`links`) and a read-only
 * one (`linksViewer`) — mirrors the server gate: writes use assertBrandAccess
 * (…, 'links'); reads use assertBrandAccessAny (…, ['links','linksViewer']).
 * Editors can create/edit/toggle/delete links; viewers only look
 * (and copy). The brand owner always edits. Used to hide editor-only UI so a
 * viewer never sees a control the server would just reject. */
import { useCurrentUser } from '@shared/auth/auth-context';

export function useCanEditLinks(): boolean {
  const { data: user } = useCurrentUser();
  if (!user) return false;
  if (user.role === 'brandOwner') return true;
  return (user.permissions ?? []).includes('links');
}
