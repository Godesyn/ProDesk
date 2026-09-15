import { Redirect, useLocation } from 'wouter';

/**
 * Catch-all route: an unmatched URL sends the visitor to THIS frontend's own
 * root ("/") instead of rendering a 404 screen.
 *
 * Mount it as the LAST <Route> of a <Switch> — a wouter <Route> with no `path`
 * matches everything, so anything the routes above didn't claim lands here:
 *
 *   <Switch>
 *     <Route path="/" component={Home} />
 *     …
 *     <Route component={UnknownRouteRedirect} />
 *   </Switch>
 *
 * Every Prodesk frontend uses this ONE component so the behaviour can never
 * drift app to app — do not hand-roll a local copy or a per-app 404 page.
 *
 * The navigation is client-side (wouter <Redirect>), not a full page load, so
 * the session, the tRPC cache and the surrounding layout all survive it.
 */
export function UnknownRouteRedirect() {
  const [location] = useLocation();

  // Loop guard: if "/" ITSELF fell through to the catch-all, the Switch has no
  // root route — an app wiring bug, not a bad URL. Redirecting to "/" again
  // would just land back here forever, so render nothing and let the missing
  // root route be the visible symptom.
  if (location === '/') return null;

  return <Redirect to="/" replace />;
}
