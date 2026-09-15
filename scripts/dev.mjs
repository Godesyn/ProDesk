#!/usr/bin/env node
/**
 * Dev orchestrator — the body of the root `dev` / `dev:<frontend>` scripts,
 * replacing the unreadable concurrently one-liners in package.json.
 *
 *   node scripts/dev.mjs             backend + worker + stripe + redirector
 *                                    + EVERY frontend
 *   node scripts/dev.mjs <frontend>  backend + worker + stripe + that frontend
 *                                    (+ its extras, e.g. links → redirector)
 *
 * The backend API is started FIRST and we wait for its /health endpoint to
 * respond before launching the worker, stripe, redirector and frontends — so
 * nothing that depends on the API comes up before the API is actually serving.
 *
 * Every frontend must be registered in FRONTENDS below with a prefix color —
 * check-frontend-wiring.mjs fails when one is missing, so a new frontend
 * can't be silently absent from `bun run dev`.
 */
import concurrently from 'concurrently';

const SERVER = {
  name: 'server',
  prefixColor: 'blue',
  command: 'bun run --filter backend dev',
};

// The redirector rides with every dev target: links serves short-link hits
// through it and reviews' QR codes hop through /v/:locationId.
const CORE = [
  {
    name: 'worker',
    prefixColor: 'magenta',
    command: 'bun run --filter backend worker',
  },
  {
    name: 'stripe',
    prefixColor: 'yellow',
    command: 'node scripts/stripe-listen.mjs',
  },
  {
    name: 'redirector',
    prefixColor: 'gray',
    command: 'bun run --filter redirector dev',
  },
];

/** Frontend registry: prefix color + any extra services the frontend needs. */
const FRONTENDS = {
  prodesk: { prefixColor: 'green' },
  dashboard: { prefixColor: 'cyan' },
  links: { prefixColor: 'white' },
  reviews: { prefixColor: 'red' },
  payments: { prefixColor: 'blueBright' },
  signatures: { prefixColor: 'magentaBright' },
  jobs: { prefixColor: 'yellowBright' },
  websites: { prefixColor: 'greenBright' },
  design: { prefixColor: 'cyanBright' },
  logo: { prefixColor: 'redBright' },
  passwords: { prefixColor: 'blackBright' },
  chat: { prefixColor: 'whiteBright' },
};

const target = process.argv[2];
if (target && !FRONTENDS[target]) {
  console.error(
    `Unknown frontend "${target}". Registered: ${Object.keys(FRONTENDS).join(', ')}`,
  );
  process.exit(1);
}

const frontend = (name) => ({
  name,
  prefixColor: FRONTENDS[name].prefixColor,
  command: `bun run --filter ${name} dev`,
});

const rest = target
  ? [...CORE, frontend(target), ...(FRONTENDS[target].extras ?? [])]
  : [...CORE, ...Object.keys(FRONTENDS).map(frontend)];

const PORT = process.env.PORT ?? 4000;
const HEALTH_URL = `http://localhost:${PORT}/health`;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Poll /health until the backend answers, the server dies, or we time out. */
async function waitForBackend(isDead, timeoutMs = 60_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (isDead()) return false;
    try {
      const res = await fetch(HEALTH_URL);
      if (res.ok) return true;
    } catch {
      // not up yet — keep polling
    }
    await sleep(500);
  }
  return false;
}

// Start the backend API first, on its own.
const server = concurrently([SERVER], { killOthersOn: ['failure', 'success'] });

let serverDead = false;
const markDead = () => {
  serverDead = true;
};
server.result.then(markDead, markDead);

const ready = await waitForBackend(() => serverDead);
if (serverDead) {
  console.error('Backend exited before it became healthy — aborting.');
  process.exit(1);
}
if (ready) {
  console.log(`▸ Backend healthy at ${HEALTH_URL} — starting everything else.`);
} else {
  console.error(
    `Backend did not answer ${HEALTH_URL} within the timeout — starting the rest anyway.`,
  );
}

// Now bring up the worker, stripe, redirector and frontend(s).
const others = concurrently(rest, { killOthers: ['failure', 'success'] });

// -k equivalent across both groups: any process exiting tears the rest down.
const killAll = () => {
  for (const cmd of [...server.commands, ...others.commands]) {
    try {
      cmd.kill();
    } catch {
      // already gone
    }
  }
};
server.result.then(killAll, killAll);
others.result.then(killAll, killAll);

Promise.allSettled([server.result, others.result]).then((results) => {
  const failed = results.some((r) => r.status === 'rejected');
  process.exit(failed ? 1 : 0);
});
