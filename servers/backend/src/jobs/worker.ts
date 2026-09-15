// Thin entrypoint — the worker logic lives in the shared package.
// This file exists so `server/package.json` scripts (worker, start:worker)
// and the Railway worker service can boot the worker from the server workspace.
import '@prodesk/server-shared/jobs/worker';
