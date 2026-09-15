import { useEffect, useState } from 'react';
import { signOut } from '../auth/auth-context';
import { Button } from './ui/button';

/**
 * Full-screen placeholder shown while the auth gate resolves `auth.me`.
 *
 * It must never trap the user: a 401 redirects to /login on its own (see
 * queryClient), but a session that resolves to *no user* (a stale token the
 * server accepts but maps to no row, a slow/failed fetch) leaves the gate
 * waiting forever. So if the query errored — or it's simply taking too long —
 * we surface a Log out escape hatch that clears the session and drops the user
 * back on the login screen.
 */
export function AuthLoadingScreen({ error }: { error?: unknown }) {
  const [timedOut, setTimedOut] = useState(false);
  useEffect(() => {
    const t = setTimeout(() => setTimedOut(true), 6000);
    return () => clearTimeout(t);
  }, []);

  const stuck = !!error || timedOut;

  return (
    <div className="grid min-h-screen place-items-center px-6 text-center">
      <div className="flex flex-col items-center gap-4 text-ink-40">
        <p>{stuck ? 'This is taking longer than expected.' : 'Loading…'}</p>
        {stuck && (
          <Button variant="outline" onClick={() => signOut()}>
            Log out
          </Button>
        )}
      </div>
    </div>
  );
}
