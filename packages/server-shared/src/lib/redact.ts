/**
 * Strip the server-only one-click action tokens from a project row before it
 * leaves the API. `completionToken` and `softDeleteToken` complete or delete a
 * project with NO further auth (they back the email confirm links), so they must
 * never reach any client — least of all a brand or contractor. They are only
 * ever read server-side via fresh DB selects, so removing them from responses is
 * always safe.
 */
export function omitActionTokens<
  T extends { completionToken?: unknown; softDeleteToken?: unknown },
>(project: T): Omit<T, 'completionToken' | 'softDeleteToken'> {
  const { completionToken: _c, softDeleteToken: _s, ...rest } = project;
  return rest;
}
