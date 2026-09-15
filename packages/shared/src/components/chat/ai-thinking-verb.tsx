import { useEffect, useState, type ReactNode } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { Lightbulb } from 'lucide-react';
import { randomSpinnerVerb } from '../../lib/spinner-verbs';

const ROTATE_MS = 2800;

/**
 * Cycles through random spinner-verbs with a smooth crossfade.
 * Used in AI chat threads while the model is "thinking" before any streamed
 * text has arrived.
 */
export function AiThinkingVerb() {
  const [verb, setVerb] = useState(randomSpinnerVerb);

  useEffect(() => {
    const id = setInterval(() => setVerb(randomSpinnerVerb()), ROTATE_MS);
    return () => clearInterval(id);
  }, []);

  return (
    <span className="inline-flex items-center gap-1 text-ink-40">
      <AnimatePresence mode="wait">
        <motion.span
          key={verb}
          initial={{ opacity: 0, y: 4, filter: 'blur(3px)' }}
          animate={{ opacity: 1, y: 0, filter: 'blur(0px)' }}
          exit={{ opacity: 0, y: -4, filter: 'blur(3px)' }}
          transition={{ duration: 0.25, ease: 'easeInOut' }}
        >
          {verb}…
        </motion.span>
      </AnimatePresence>
    </span>
  );
}

/**
 * Contextual tips shown under the "thinking" verb while the model works. They
 * teach the slash-commands; append more here as commands/features land. Each
 * entry is a small React node so a snippet can be highlighted (e.g. a command in
 * a <code>).
 */
const THINKING_HINTS: ReactNode[] = [
  <>
    Tip: send <code className="rounded bg-inset px-1 py-0.5 text-[10px] text-ink-60">/clear</code> to start a fresh conversation
  </>,
  <>
    Tip: send <code className="rounded bg-inset px-1 py-0.5 text-[10px] text-ink-60">/compact</code> to summarise a long chat and keep going
  </>,
];

const HINT_ROTATE_MS = 5200;

/**
 * Rotates through THINKING_HINTS with a crossfade, shown beneath AiThinkingVerb
 * while the assistant is thinking (before any text has streamed). With a single
 * hint it simply shows that one; the interval kicks in once more are added.
 */
export function AiThinkingHint() {
  const [i, setI] = useState(0);

  useEffect(() => {
    if (THINKING_HINTS.length <= 1) return;
    const id = setInterval(() => setI((n) => (n + 1) % THINKING_HINTS.length), HINT_ROTATE_MS);
    return () => clearInterval(id);
  }, []);

  return (
    <div className="mt-1 flex items-center gap-1.5 text-[11px] text-ink-30">
      <Lightbulb className="h-3 w-3 shrink-0" />
      <AnimatePresence mode="wait">
        <motion.span
          key={i}
          initial={{ opacity: 0, y: 3 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -3 }}
          transition={{ duration: 0.25, ease: 'easeInOut' }}
        >
          {THINKING_HINTS[i]}
        </motion.span>
      </AnimatePresence>
    </div>
  );
}
