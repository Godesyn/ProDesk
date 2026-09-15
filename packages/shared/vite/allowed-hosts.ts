/**
 * Hosts every frontend's `vite` dev/preview server accepts (the `server.allowedHosts`
 * list). Kept in one place so all clients share the same set — adding a new
 * white-label or preview domain means editing this file, not each vite.config.ts.
 *
 * A leading `.` matches the domain and all its subdomains (e.g. `.prodesk.com`
 * covers `links.prodesk.com`, `stage-app.prodesk.com`, …).
 */
export const ALLOWED_HOSTS = [
  '.prodesk.com',
  '.railway.app',
  '.manus.computer',
  '.adeyy.com',
  '.verdiict.com',
  '.noize.com.au',
  '.sigkitt.com',
];
