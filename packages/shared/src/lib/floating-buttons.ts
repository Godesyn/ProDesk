import { useEffect, useState } from 'react';

const activeButtons = new Set<string>();
const listeners = new Set<() => void>();

function notify() {
  listeners.forEach((l) => l());
}

export function useFloatingButton(id: string) {
  useEffect(() => {
    activeButtons.add(id);
    notify();
    return () => {
      activeButtons.delete(id);
      notify();
    };
  }, [id]);
}

export function useHasFloatingButton(id: string): boolean {
  const check = () => {
    if (activeButtons.has(id)) return true;
    if (typeof document !== 'undefined') {
      return !!document.querySelector(`[data-floating-button="${id}"]`);
    }
    return false;
  };

  const [has, setHas] = useState(check);

  useEffect(() => {
    const update = () => setHas(check());
    listeners.add(update);
    update();

    let observer: MutationObserver | null = null;
    if (typeof document !== 'undefined') {
      observer = new MutationObserver(update);
      observer.observe(document.body, {
        childList: true,
        subtree: true,
        attributes: true,
        attributeFilter: ['data-floating-button'],
      });
    }

    return () => {
      listeners.delete(update);
      observer?.disconnect();
    };
  }, [id]);

  return has;
}

