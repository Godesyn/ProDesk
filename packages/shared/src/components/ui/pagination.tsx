import { ChevronLeft, ChevronRight } from 'lucide-react';
import { Button } from './button';

interface PaginationProps {
  total: number;
  limit: number;
  offset: number;
  onChange: (offset: number) => void;
}

/** Offset-based pager matching the server `page()` envelope. */
export function Pagination({ total, limit, offset, onChange }: PaginationProps) {
  if (total === 0) return null;
  const start = offset + 1;
  const end = Math.min(offset + limit, total);
  const canPrev = offset > 0;
  const canNext = end < total;
  const pageNum = Math.floor(offset / limit) + 1;
  const pageCount = Math.max(1, Math.ceil(total / limit));

  return (
    <div className="flex items-center justify-between gap-4 pt-3 text-sm text-ink-60">
      <span>
        {start}–{end} of {total}
      </span>
      <div className="flex items-center gap-2">
        <span className="text-ink-40">
          Page {pageNum} / {pageCount}
        </span>
        <Button size="icon" variant="outline" disabled={!canPrev} onClick={() => onChange(Math.max(0, offset - limit))}>
          <ChevronLeft className="h-4 w-4" />
        </Button>
        <Button size="icon" variant="outline" disabled={!canNext} onClick={() => onChange(offset + limit)}>
          <ChevronRight className="h-4 w-4" />
        </Button>
      </div>
    </div>
  );
}
