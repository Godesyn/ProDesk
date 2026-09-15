import { useState } from 'react';
import { PlusCircle, X } from 'lucide-react';
import { Input } from '../ui/input';
import { Button } from '../ui/button';
import { SectionHeader } from './section-header';

/**
 * Value-proposition chip editor (ports `_buildValuePropositionSection`). Flutter
 * reuses the `disciplines` list for these benefit strings; Enter or the +
 * button appends a trimmed, non-duplicate value. Chips are deletable.
 */
export function ValuePropositionChips({ benefits, onChange }: { benefits: string[]; onChange: (next: string[]) => void }) {
  const [draft, setDraft] = useState('');

  function add() {
    const b = draft.trim();
    if (b && !benefits.includes(b)) {
      onChange([...benefits, b]);
      setDraft('');
    }
  }

  return (
    <div>
      <SectionHeader title="Value Proposition" />
      <div className="flex items-center gap-2">
        <Input
          className="flex-1"
          placeholder="Add a key benefit..."
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              add();
            }
          }}
        />
        <Button type="button" size="icon" variant="ghost" onClick={add} aria-label="Add benefit">
          <PlusCircle className="h-5 w-5" />
        </Button>
      </div>
      <div className="mt-3">
        {benefits.length === 0 ? (
          <p className="text-[13px] italic text-ink-40">Add features to highlight what clients get</p>
        ) : (
          <div className="flex flex-wrap gap-2">
            {benefits.map((b) => (
              <span key={b} className="inline-flex items-center gap-1.5 rounded-[6px] bg-inset px-2.5 py-1 text-xs text-ink-100">
                {b}
                <button type="button" onClick={() => onChange(benefits.filter((x) => x !== b))} className="text-ink-60 hover:text-ink-100" aria-label={`Remove ${b}`}>
                  <X className="h-3.5 w-3.5" />
                </button>
              </span>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
