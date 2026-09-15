/**
 * TemplateSelector — Pill-style template chooser
 * Design: Warm Craft Studio
 */

import { TEMPLATES, type TemplateId } from '@/lib/signatureTypes';
import { cn } from '@/lib/utils';

interface TemplateSelectorProps {
  selected: TemplateId;
  onChange: (id: TemplateId) => void;
}

export function TemplateSelector({ selected, onChange }: TemplateSelectorProps) {
  return (
    <div className="flex flex-wrap gap-2">
      {TEMPLATES.map((tpl) => (
        <button
          key={tpl.id}
          onClick={() => onChange(tpl.id)}
          className={cn(
            'group relative flex items-center gap-2 px-3 py-1.5 rounded-full text-sm font-medium transition-all duration-200',
            selected === tpl.id
              ? 'bg-primary text-[#0E0E0C] border border-[#0E0E0C] shadow-sm scale-105'
              : 'bg-background border border-border text-muted-foreground hover:border-foreground/40 hover:text-foreground'
          )}
          title={tpl.description}
        >
          <span
            className={cn('w-2.5 h-2.5 rounded-full flex-shrink-0 border border-border/50',
              selected === tpl.id ? 'bg-[#0E0E0C]/30' : ''
            )}
            style={selected !== tpl.id ? { backgroundColor: tpl.previewColor } : {}}
          />
          {tpl.name}
        </button>
      ))}
    </div>
  );
}
