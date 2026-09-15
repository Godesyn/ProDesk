import { useState } from "react";
import { MERGE_FIELD_DEFINITIONS } from "@/lib/mergeFields";
import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

interface MergeFieldToolbarProps {
  /** Called when a field is selected — insert the key at cursor position */
  onInsert: (key: string) => void;
  className?: string;
}

const CATEGORY_LABELS: Record<string, string> = {
  payer: "Payer",
  business: "Your Business",
  proposal: "Proposal",
};

const CATEGORY_COLORS: Record<string, string> = {
  payer: "bg-blue-500/15 text-blue-400 border-blue-500/20",
  business: "bg-emerald-500/15 text-emerald-400 border-emerald-500/20",
  proposal: "bg-violet-500/15 text-violet-400 border-violet-500/20",
};

export function MergeFieldToolbar({ onInsert, className }: MergeFieldToolbarProps) {
  const [open, setOpen] = useState(false);
  const [activeCategory, setActiveCategory] = useState<string>("payer");

  const categories = ["payer", "business", "proposal"];
  const filtered = MERGE_FIELD_DEFINITIONS.filter(f => f.category === activeCategory);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          size="sm"
          className={cn("gap-1.5 text-xs font-mono border-dashed", className)}
          title="Insert merge field"
        >
          <span className="text-muted-foreground">{"{ }"}</span>
          Merge fields
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-80 p-0" align="start">
        <div className="p-3 border-b">
          <p className="text-xs font-semibold text-foreground mb-1">Insert merge field</p>
          <p className="text-xs text-muted-foreground">
            Fields are replaced with real data when the proposal is sent.
          </p>
        </div>
        {/* Category tabs */}
        <div className="flex gap-1 p-2 border-b">
          {categories.map(cat => (
            <button
              key={cat}
              onClick={() => setActiveCategory(cat)}
              className={cn(
                "flex-1 text-xs py-1 px-2 rounded-md transition-colors",
                activeCategory === cat
                  ? "bg-accent text-accent-foreground font-medium"
                  : "text-muted-foreground hover:text-foreground hover:bg-accent/50"
              )}
            >
              {CATEGORY_LABELS[cat]}
            </button>
          ))}
        </div>
        {/* Fields list */}
        <div className="p-2 max-h-56 overflow-y-auto">
          {filtered.map(field => (
            <button
              key={field.key}
              onClick={() => {
                onInsert(field.key);
                setOpen(false);
              }}
              className="w-full flex items-center justify-between gap-2 px-2 py-1.5 rounded-md hover:bg-accent/60 transition-colors text-left group"
            >
              <div className="flex flex-col gap-0.5 min-w-0">
                <span className="text-xs font-medium text-foreground truncate">{field.label}</span>
                <span className="text-[10px] text-muted-foreground truncate">{field.description}</span>
              </div>
              <Badge
                variant="outline"
                className={cn("text-[10px] font-mono shrink-0 px-1.5 py-0", CATEGORY_COLORS[field.category])}
              >
                {field.key}
              </Badge>
            </button>
          ))}
        </div>
        <div className="p-2 border-t bg-muted/30">
          <p className="text-[10px] text-muted-foreground">
            Tip: You can also type <code className="font-mono bg-muted px-0.5 rounded">{"{{field_name}}"}</code> directly in any text block.
          </p>
        </div>
      </PopoverContent>
    </Popover>
  );
}
