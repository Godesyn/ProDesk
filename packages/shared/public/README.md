# Shared static assets

Hand-authored static files (no build step) served at the SAME root-relative URLs
by more than one host. Everything here is public — never put anything secret in
this directory.

Currently one occupant: `adeyy/` — the Adeyy marketing page (a Manus export, see
`docs/agents/manus-migration.md`) plus its CSS, motion script and logos.

## Who serves it

| Host | How | `%APP_ORIGIN%` resolves to |
| --- | --- | --- |
| Links frontend (`www.adeyy.com`) | `sharedPublic()` in `clients/links/vite.config.ts` — dev/preview middleware + a build-time copy into `dist/` | `''` (its own origin owns `/login`, `/signup`) |
| Redirector (`url.adeyy.com`) | `servers/redirector/src/landing.ts`, mounted on `/` and `/adeyy/*` | the absolute Links origin |

The Links frontend frames the page (`@shared/pages/landing`); the redirector
serves it as the top document to visitors who arrive without a session. Because
both publish it at `/adeyy/...`, the markup's asset paths need no rewriting.

## `%APP_ORIGIN%`

The one placeholder. Both hosts substitute it in `.html`, `.css` and `.js` files
on the way out. Write every link to an app ROUTE as `%APP_ORIGIN%/login`, so it
stays same-origin on the frontend and crosses back to the app — in the same
window — from the redirector. Leave asset paths and in-page anchors alone.

Adding a placeholder means teaching both substituters, so prefer this one.

## Gotchas

- These URLs are not content-hashed. A frontend serving a file here shadows a
  same-path file in its own `public/`.
- `target="_parent"` on route links is required, not cosmetic: the framed copy
  must navigate the top window, and Google OAuth 403s inside an iframe.
- Editing a file here redeploys BOTH services — the redirector's Railway config
  watches `packages/shared/public/**` for exactly that reason.
