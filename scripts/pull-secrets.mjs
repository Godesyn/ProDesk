#!/usr/bin/env node
// Export ALL Firebase Functions secrets (Google Secret Manager) to local files.
//
// Usage (uses your authenticated gcloud):
//   node scripts/pull-secrets.mjs <gcp-project-id>          # e.g. crew-prodesk
//   # or: GCLOUD_PROJECT=crew-prodesk node scripts/pull-secrets.mjs
//
// Writes (gitignored):
//   functions-secrets.json  — every secret: { NAME: value }
//   .env.functions          — the prod secret set mapped onto this app's .env names
// Secret VALUES are written to files only — never printed to stdout.

import { spawnSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';

const project = process.argv[2] ?? process.env.GCLOUD_PROJECT;
if (!project) {
  console.error('Usage: node scripts/pull-secrets.mjs <gcp-project-id>');
  process.exit(1);
}

// shell:true so the gcloud .cmd/.ps1 shim resolves on Windows too.
function gcloud(args) {
  const r = spawnSync('gcloud', args, { shell: true, encoding: 'utf8', maxBuffer: 10 * 1024 * 1024 });
  return r.status === 0 ? r.stdout.trim() : null;
}

// Discover every secret name in the project (fall back to a known list).
const listed = gcloud(['secrets', 'list', `--project=${project}`, '--format=value(name)']);
const names = listed
  ? listed.split(/\r?\n/).map((s) => s.trim()).filter(Boolean)
  : ['STRIPE_SECRET_KEY', 'PROD_STRIPE_SECRET_KEY', 'SMTP_HOST', 'SMTP_USER', 'SMTP_PASS'];
if (!listed) console.warn('! could not list secrets — using fallback list (check auth/permissions)');

const out = {};
let ok = 0;
for (const name of names) {
  const value = gcloud(['secrets', 'versions', 'access', 'latest', `--secret=${name}`, `--project=${project}`]);
  out[name] = value;
  if (value !== null) ok++;
  console.log(`${value !== null ? '✓' : '✗'} ${name}`); // names only, never values
}

writeFileSync('functions-secrets.json', JSON.stringify(out, null, 2));

// Map the production secret set onto this project's .env variable names.
const ENV_MAP = {
  PROD_STRIPE_SECRET_KEY: 'STRIPE_SECRET_KEY',
  PROD_STRIPE_CHECKOUT_SESSION_COMPLETED_WEBHOOK_SECRET: 'STRIPE_WEBHOOK_SECRET',
  PROD_PAYPAL_CLIENT_ID: 'PAYPAL_CLIENT_ID',
  PROD_PAYPAL_CLIENT_SECRET: 'PAYPAL_CLIENT_SECRET',
  PROD_WISE_API_TOKEN: 'WISE_API_TOKEN',
  PROD_WISE_PROFILE_ID: 'WISE_PROFILE_ID',
  PROD_WISE_STRIPE_CONNECT_ACCOUNT_ID: 'WISE_STRIPE_CONNECT_ACCOUNT_ID',
  SMTP_HOST: 'SMTP_HOST', SMTP_PORT: 'SMTP_PORT', SMTP_USER: 'SMTP_USER', SMTP_PASS: 'SMTP_PASS',
  GOOGLE_CLIENT_ID: 'GOOGLE_CLIENT_ID', GOOGLE_CLIENT_SECRET: 'GOOGLE_CLIENT_SECRET',
};
const envLines = Object.entries(ENV_MAP)
  .filter(([secret]) => out[secret] != null)
  .map(([secret, envName]) => `${envName}="${out[secret]}"`);
writeFileSync('.env.functions', envLines.join('\n') + '\n');

console.log(`\nWrote functions-secrets.json (${ok}/${names.length} resolved) and .env.functions (${envLines.length} mapped)`);
