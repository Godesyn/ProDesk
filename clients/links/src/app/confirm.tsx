/* App-wide replacement for the native window.confirm() — we never use the browser
 * primitive; destructive/confirming actions get a real dialog. Promise-based and
 * imperative so call sites stay terse:
 *
 *   const confirm = useConfirm();
 *   if (!(await confirm({ title: 'Delete this link?', destructive: true }))) return;
 *
 * Adeyy-styled sibling of @shared/components/ui/confirm-dialog (Modal-based). */
import {
  createContext,
  useCallback,
  useContext,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { Modal } from './components';

export type ConfirmOptions = {
  title: string;
  description?: ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  /** Style the confirm button as a destructive action (red). */
  destructive?: boolean;
};

type ConfirmFn = (opts: ConfirmOptions) => Promise<boolean>;

const ConfirmContext = createContext<ConfirmFn | null>(null);

export function ConfirmProvider({ children }: { children: ReactNode }) {
  const [opts, setOpts] = useState<ConfirmOptions | null>(null);
  const resolver = useRef<((value: boolean) => void) | null>(null);

  const confirm = useCallback<ConfirmFn>((o) => {
    setOpts(o);
    return new Promise<boolean>((resolve) => {
      resolver.current = resolve;
    });
  }, []);

  const settle = useCallback((result: boolean) => {
    resolver.current?.(result);
    resolver.current = null;
    setOpts(null);
  }, []);

  return (
    <ConfirmContext.Provider value={confirm}>
      {children}
      {opts && (
        <Modal title={opts.title} onClose={() => settle(false)} width={420}>
          {opts.description ? (
            <p className="mutetext">{opts.description}</p>
          ) : null}
          <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
            <button className="abtn abtn-quiet" onClick={() => settle(false)}>
              {opts.cancelLabel ?? 'Cancel'}
            </button>
            <button
              className="abtn abtn-primary"
              style={
                opts.destructive
                  ? { background: 'var(--danger)', borderColor: 'var(--danger)' }
                  : undefined
              }
              onClick={() => settle(true)}
            >
              {opts.confirmLabel ?? 'Confirm'}
            </button>
          </div>
        </Modal>
      )}
    </ConfirmContext.Provider>
  );
}

export function useConfirm(): ConfirmFn {
  const ctx = useContext(ConfirmContext);
  if (!ctx) throw new Error('useConfirm must be used within a ConfirmProvider');
  return ctx;
}
