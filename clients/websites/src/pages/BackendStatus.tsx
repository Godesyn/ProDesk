/**
 * Tiny indicator showing whether this frontend's own tRPC namespace responded.
 * Proves the scaffold is wired end-to-end (frontend → API → router). Remove once
 * the app has real screens driven by its router.
 */
export function BackendStatus({
  namespace,
  status,
  ok,
}: {
  namespace: string;
  status: 'pending' | 'error' | 'success';
  ok?: boolean;
}) {
  const [dot, text] =
    status === 'success' && ok
      ? ['bg-success', `${namespace}.* connected`]
      : status === 'error'
        ? ['bg-danger', `${namespace}.* unreachable`]
        : ['bg-ink-40', `Checking ${namespace}.* …`];

  return (
    <p className="flex items-center gap-2 text-xs text-ink-40">
      <span className={`inline-block h-2 w-2 rounded-full ${dot}`} />
      {text}
    </p>
  );
}
