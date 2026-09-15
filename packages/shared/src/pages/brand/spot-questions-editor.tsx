import { useState } from 'react';
import { Plus, Trash2, GripVertical, X } from 'lucide-react';
import { Card } from '../../components/ui/card';
import { Button } from '../../components/ui/button';
import { Input } from '../../components/ui/input';
import { Label } from '../../components/ui/label';
import { SortableList } from '../../components/ui/sortable-list';

/** SpotQuestionModel shape (mirrors the server `questionSchema`). */
export type QType =
  | 'text' | 'single_select' | 'multi_select' | 'date' | 'address' | 'url' | 'number'
  | 'price' | 'email' | 'file_upload' | 'carousel' | 'cover_photo' | 'color_palette' | 'audio_upload' | 'phone';

export interface Question { id: string; text: string; type: QType; options: string[]; isRequired: boolean }

export const QUESTION_TYPES: { value: QType; label: string }[] = [
  { value: 'text', label: 'Text' },
  { value: 'single_select', label: 'Single select' },
  { value: 'multi_select', label: 'Multi select' },
  { value: 'date', label: 'Date' },
  { value: 'address', label: 'Address' },
  { value: 'url', label: 'URL' },
  { value: 'number', label: 'Number' },
  { value: 'price', label: 'Price' },
  { value: 'email', label: 'Email' },
  { value: 'file_upload', label: 'File upload' },
  { value: 'carousel', label: 'Image carousel' },
  { value: 'cover_photo', label: 'Cover photo / video' },
  { value: 'color_palette', label: 'Colour palette' },
  { value: 'audio_upload', label: 'Audio upload' },
  { value: 'phone', label: 'Phone' },
];

export const SELECT_TYPES: QType[] = ['single_select', 'multi_select'];

export function newQuestion(): Question {
  return { id: crypto.randomUUID(), text: '', type: 'text', options: [], isRequired: true };
}

/** Whether every question has text (the minimum bar to save a section). */
export function questionsValid(questions: Question[]): boolean {
  return questions.every((q) => q.text.trim().length > 0);
}

/**
 * Shared dynamic question editor used by both the agency form builder and the
 * brand "Build custom section" flow. Supports add / remove / reorder, per-type
 * options and the required toggle. Ports inline_form_builder.dart's question UI.
 */
export function QuestionEditor({ questions, onChange }: { questions: Question[]; onChange: (q: Question[]) => void }) {
  const setQ = (i: number, patch: Partial<Question>) => onChange(questions.map((q, x) => (x === i ? { ...q, ...patch } : q)));
  const removeQ = (i: number) => onChange(questions.filter((_, x) => x !== i));
  const reorder = (ids: string[]) => { const byId = new Map(questions.map((q) => [q.id, q])); onChange(ids.map((id) => byId.get(id)!)); };

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <Label>Questions</Label>
        <Button size="sm" variant="ghost" onClick={() => onChange([...questions, newQuestion()])}><Plus className="h-4 w-4" /> Add question</Button>
      </div>
      {questions.length === 0 && <p className="text-sm text-ink-40">No questions yet — add one to get started.</p>}
      <SortableList items={questions} getId={(q) => q.id} onReorder={reorder} className="flex flex-col gap-3">
        {({ item: q, index: i, handleProps }) => (
          <Card className="flex flex-col gap-2 p-3">
            <div className="flex items-start gap-2">
              <button type="button" {...handleProps} className="mt-2 cursor-grab touch-none text-ink-30 hover:text-ink-60 active:cursor-grabbing" aria-label="Drag to reorder"><GripVertical className="h-4 w-4" /></button>
              <Input className="flex-1" value={q.text} onChange={(e) => setQ(i, { text: e.target.value })} placeholder="Question text" />
              <Button size="icon" variant="ghost" onClick={() => removeQ(i)}><Trash2 className="h-4 w-4" /></Button>
            </div>
            <div className="flex flex-wrap items-center gap-3 pl-6">
              <select
                className="h-9 rounded-[var(--radius-sm)] border border-[color:var(--color-border-default)] bg-card px-2 text-sm"
                value={q.type}
                onChange={(e) => setQ(i, { type: e.target.value as QType })}
              >
                {QUESTION_TYPES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
              </select>
              <label className="flex items-center gap-1.5 text-sm text-ink-80">
                <input type="checkbox" checked={q.isRequired} onChange={(e) => setQ(i, { isRequired: e.target.checked })} /> Required
              </label>
              {SELECT_TYPES.includes(q.type) && (
                <OptionsEditor options={q.options} onChange={(options) => setQ(i, { options })} />
              )}
            </div>
          </Card>
        )}
      </SortableList>
    </div>
  );
}

/**
 * Chip-based options editor for single/multi-select questions. Type an option
 * and press Enter (or comma) to add it as a chip; Backspace on an empty input
 * removes the last chip. Replaces the old comma-joined text field that couldn't
 * keep partially-typed options.
 */
function OptionsEditor({ options, onChange }: { options: string[]; onChange: (o: string[]) => void }) {
  const [draft, setDraft] = useState('');

  const add = () => {
    const v = draft.trim();
    setDraft('');
    if (!v || options.includes(v)) return;
    onChange([...options, v]);
  };
  const remove = (i: number) => onChange(options.filter((_, x) => x !== i));

  return (
    <div className="flex flex-1 basis-full flex-col gap-2">
      {options.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {options.map((o, i) => (
            <span key={`${o}-${i}`} className="inline-flex items-center gap-1 rounded-[var(--radius-pill)] bg-inset px-2.5 py-1 text-sm text-ink-80">
              {o}
              <button type="button" onClick={() => remove(i)} className="text-ink-40 hover:text-ink-100" aria-label={`Remove ${o}`}>
                <X className="h-3 w-3" />
              </button>
            </span>
          ))}
        </div>
      )}
      <Input
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ',') { e.preventDefault(); add(); }
          else if (e.key === 'Backspace' && !draft && options.length) remove(options.length - 1);
        }}
        onBlur={add}
        placeholder="Type an option, press Enter"
      />
    </div>
  );
}
