import { useState, useEffect, useCallback, useRef } from 'react';

export interface HistoryEnvelope<T> {
  __historyEnvelope: true;
  history: T[];
  currentIndex: number;
}

const MAX_HISTORY = 50; // Max undo/redo states per workspace

export function useUndoRedoState<T>(initialValue: T, storageKey: string) {
  // Load initial state from localStorage if it exists, otherwise use initialValue
  const [state, setState] = useState<T>(() => {
    if (typeof window !== 'undefined') {
      const saved = localStorage.getItem(storageKey);
      if (saved) {
        try {
          const parsed = JSON.parse(saved);
          if (parsed && parsed.__historyEnvelope === true) {
            return parsed.history[parsed.currentIndex] as T;
          }
          return parsed as T;
        } catch {
          return initialValue;
        }
      }
    }
    return initialValue;
  });

  // Use refs to track history and index without triggering effect dependencies
  const historyRef = useRef<T[]>([state]);
  const currentIndexRef = useRef<number>(0);

  // Sync refs with localStorage after hook is instantiated (only runs once on mount)
  useEffect(() => {
    if (typeof window !== 'undefined') {
      const saved = localStorage.getItem(storageKey);
      if (saved) {
        try {
          const parsed = JSON.parse(saved);
          if (parsed && parsed.__historyEnvelope === true) {
            historyRef.current = parsed.history.slice(-MAX_HISTORY);
            currentIndexRef.current = Math.min(parsed.currentIndex, historyRef.current.length - 1);
            syncHistoryState();
          }
        } catch {
          // ignore
        }
      }
    }
  }, [storageKey]);

  // States to trigger re-renders when history indicators change
  const [canUndo, setCanUndo] = useState(false);
  const [canRedo, setCanRedo] = useState(false);
  const [undoDepth, setUndoDepth] = useState(0);
  const [redoDepth, setRedoDepth] = useState(0);

  // Sync undo/redo states
  const syncHistoryState = useCallback(() => {
    const ud = currentIndexRef.current;
    const rd = historyRef.current.length - 1 - currentIndexRef.current;
    setCanUndo(ud > 0);
    setCanRedo(rd > 0);
    setUndoDepth(ud);
    setRedoDepth(rd);
  }, []);

  // Save to localStorage when state changes.
  useEffect(() => {
    // Persisting the full 50-entry history duplicates every base64 image (photo,
    // logo, banner…) up to 50×, which easily exceeds the ~5MB localStorage quota.
    // A QuotaExceededError here is uncaught and blanks the entire app, so never
    // let the write throw: retry with progressively less history, and if even the
    // current state alone won't fit, skip persistence. In-memory undo/redo
    // (historyRef) is unaffected either way.
    const write = (history: T[], currentIndex: number): boolean => {
      try {
        const envelope: HistoryEnvelope<T> = { __historyEnvelope: true, history, currentIndex };
        localStorage.setItem(storageKey, JSON.stringify(envelope));
        return true;
      } catch {
        return false;
      }
    };
    const cur = currentIndexRef.current;
    if (write(historyRef.current, cur)) return;
    const trimmed = historyRef.current.slice(Math.max(0, cur - 4));
    if (write(trimmed, trimmed.length - 1)) return;
    write([historyRef.current[cur]], 0);
  }, [state, storageKey]);

  // Update state and push to history stack
  const set = useCallback((newValue: T | ((prev: T) => T)) => {
    setState((prev) => {
      const resolved = typeof newValue === 'function' ? (newValue as Function)(prev) : newValue;
      
      // Update history stack
      let nextHistory = historyRef.current.slice(0, currentIndexRef.current + 1);
      nextHistory.push(resolved);
      
      // Limit history stack size to enforce scalability
      if (nextHistory.length > MAX_HISTORY) {
        nextHistory = nextHistory.slice(nextHistory.length - MAX_HISTORY);
      }
      
      historyRef.current = nextHistory;
      currentIndexRef.current = nextHistory.length - 1;
      
      syncHistoryState();
      return resolved;
    });
  }, [syncHistoryState]);

  const undo = useCallback(() => {
    if (currentIndexRef.current > 0) {
      currentIndexRef.current -= 1;
      const prevVal = historyRef.current[currentIndexRef.current];
      setState(prevVal);
      syncHistoryState();
    }
  }, [syncHistoryState]);

  const redo = useCallback(() => {
    if (currentIndexRef.current < historyRef.current.length - 1) {
      currentIndexRef.current += 1;
      const nextVal = historyRef.current[currentIndexRef.current];
      setState(nextVal);
      syncHistoryState();
    }
  }, [syncHistoryState]);

  // Clear / reset history
  const resetState = useCallback((newValue: T) => {
    setState(newValue);
    historyRef.current = [newValue];
    currentIndexRef.current = 0;
    syncHistoryState();
  }, [syncHistoryState]);

  // Load a complete history envelope or a single state object
  const loadHistoryState = useCallback((envelope: HistoryEnvelope<T> | T) => {
    if (envelope && typeof envelope === 'object' && '__historyEnvelope' in envelope && envelope.__historyEnvelope === true) {
      historyRef.current = envelope.history.slice(-MAX_HISTORY);
      currentIndexRef.current = Math.min(envelope.currentIndex, historyRef.current.length - 1);
      setState(historyRef.current[currentIndexRef.current]);
    } else {
      historyRef.current = [envelope as T];
      currentIndexRef.current = 0;
      setState(envelope as T);
    }
    syncHistoryState();
  }, [syncHistoryState]);

  // Return the envelope representation
  const getEnvelope = useCallback((): HistoryEnvelope<T> => {
    return {
      __historyEnvelope: true,
      history: historyRef.current,
      currentIndex: currentIndexRef.current,
    };
  }, []);

  return [
    state,
    set,
    { undo, redo, canUndo, canRedo, undoDepth, redoDepth, resetState, loadHistoryState, getEnvelope }
  ] as const;
}
