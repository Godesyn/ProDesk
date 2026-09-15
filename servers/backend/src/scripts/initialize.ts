/**
 * CLI entrypoint for stack initialization: `npm run init` (+ --stage / --prod).
 *
 * The actual (idempotent) work lives in ./initialize-core.ts so it can ALSO be
 * imported and run automatically after migrations on server boot (see
 * servers/backend/src/_core/index.ts) WITHOUT this file's CLI-only concerns:
 *   • `./env-setup.js` MUST be imported first so .env is loaded before the core
 *     module transitively opens the DB/Supabase clients. The boot path doesn't
 *     need it (the server already loads env), and env-setup uses override:true +
 *     logs, so it must stay out of the importable core.
 *   • process.exit + the friendly-error mapper are CLI ergonomics; the boot caller
 *     treats a thrown error as non-fatal instead.
 */
import './env-setup.js';
import { runInitialization } from './initialize-core.js';

function handleFriendlyError(err: any) {
  console.error('\n✖ Initialization failed:');

  const errorMessage = err?.message || String(err);
  const errorStack = err?.stack || '';

  if (
    errorMessage.includes('password authentication failed') ||
    errorStack.includes('password authentication failed')
  ) {
    console.error('\n👉 Error: Database password authentication failed.');
    console.error(
      '👉 Action: Please verify that the database password in DATABASE_URL and DIRECT_URL inside prodesk-web/.env is correct for your Supabase project.',
    );
  } else if (
    errorMessage.includes('Invalid API key') ||
    errorStack.includes('Invalid API key')
  ) {
    console.error('\n👉 Error: Invalid Supabase API key.');
    console.error(
      '👉 Action: Please check your SUPABASE_SECRET_KEY in prodesk-web/.env and ensure it matches the service_role key of your Supabase project.',
    );
  } else if (
    errorMessage.includes('ENOTFOUND') ||
    errorMessage.includes('ECONNREFUSED')
  ) {
    console.error('\n👉 Error: Could not connect to the host.');
    console.error(
      '👉 Action: Please ensure your internet connection is active and the database/Supabase host URLs in prodesk-web/.env are correct.',
    );
  } else {
    console.error(`\n👉 ${errorMessage}`);
    if (err?.stack) {
      console.error(`\nStack trace:\n${err.stack}`);
    }
  }
  process.exit(1);
}

runInitialization()
  .then(() => process.exit(0))
  .catch(handleFriendlyError);
