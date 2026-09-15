/**
 * URL the Adeyy marketing page is served from. The file itself lives in
 * `packages/shared/public/adeyy/` and is published at this root-relative path by
 * BOTH hosts that render it:
 *  - every frontend that mounts `sharedPublic()` in its vite config
 *  - the redirector, which serves the same bytes as the top document on `/`
 *    (servers/redirector/src/landing.ts)
 */
export const ADEYY_LANDING_PATH = '/adeyy/Adeyy.html';

export interface LandingPageProps {
  /** Marketing page to frame. Defaults to Adeyy's. */
  src?: string;
  /** Iframe title (accessibility). */
  title?: string;
}

/**
 * Full-viewport frame around a static marketing page.
 *
 * The marketing pages are hand-authored HTML+CSS (a Manus export, see
 * docs/agents/manus-migration.md) rather than React, so a frontend shows one by
 * framing it instead of porting it. Route links inside carry `target="_parent"`
 * so a click navigates THIS window — never the frame — which is also what keeps
 * Google OAuth working (a framed /login 403s).
 */
export function LandingPage({
  src = ADEYY_LANDING_PATH,
  title = 'Adeyy landing page',
}: LandingPageProps = {}) {
  return (
    <iframe
      src={src}
      style={{
        width: '100vw',
        height: '100vh',
        border: 'none',
        display: 'block',
      }}
      title={title}
    />
  );
}
