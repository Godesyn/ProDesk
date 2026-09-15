/* App-wide replacement for native window.confirm() — never use the browser
 * primitive (see AGENTS.md). Promise-based and imperative:
 *
 *   const confirm = useConfirm();
 *   if (!(await confirm({ title: 'Delete this location?', destructive: true }))) return;
 *
 * Verdiict-styled sibling of @shared/components/ui/confirm-dialog. */
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
  destructive?: boolean;
  /** Type-to-confirm: the confirm button stays disabled until this exact
   * text is typed (used for irreversible actions like purging a location). */
  requireText?: string;
};

type ConfirmFn = (opts: ConfirmOptions) => Promise<boolean>;
const ConfirmContext = createContext<ConfirmFn | null>(null);

export function ConfirmProvider({ children }: { children: ReactNode }) {
  const [opts, setOpts] = useState<ConfirmOptions | null>(null);
  const [typed, setTyped] = useState('');
  const resolver = useRef<((value: boolean) => void) | null>(null);

  const confirm = useCallback<ConfirmFn>((o) => {
    setOpts(o);
    setTyped('');
    return new Promise<boolean>((resolve) => {
      resolver.current = resolve;
    });
  }, []);

  const settle = useCallback((result: boolean) => {
    resolver.current?.(result);
    resolver.current = null;
    setOpts(null);
    setTyped('');
  }, []);

  const blocked = !!opts?.requireText && typed.trim() !== opts.requireText;

  return (
    <ConfirmContext.Provider value={confirm}>
      {children}
      {opts && (
        <Modal title={opts.title} onClose={() => settle(false)} width={420}>
          {opts.description ? (
            <p className="vmuted" style={{ marginTop: 0 }}>
              {opts.description}
            </p>
          ) : null}
          {opts.requireText ? (
            <div className="vfield">
              <label className="vlabel">
                Type <span className="mono">{opts.requireText}</span> to confirm
              </label>
              <input
                className="vinput"
                value={typed}
                autoFocus
                placeholder={opts.requireText}
                onChange={(e) => setTyped(e.target.value)}
              />
            </div>
          ) : null}
          <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 8 }}>
            <button className="vbtn vbtn-quiet" onClick={() => settle(false)}>
              {opts.cancelLabel ?? 'Cancel'}
            </button>
            <button
              className={'vbtn ' + (opts.destructive ? 'vbtn-danger' : 'vbtn-primary')}
              disabled={blocked}
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
