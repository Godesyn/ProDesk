import { useEffect, useRef, useState } from 'react';
import { Input } from '../../components/ui/input';
import { Button } from '../../components/ui/button';
import { TASK_TITLE_MAX } from './task-utils';

export function NewTaskField({
  onSubmit,
  onClose,
  placeholder = 'New task…',
  autoFocus = true,
}: {
  onSubmit: (title: string) => void;
  onClose: () => void;
  placeholder?: string;
  autoFocus?: boolean;
}) {
  const [value, setValue] = useState('');
  const ref = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (autoFocus) ref.current?.focus();
  }, [autoFocus]);

  function submit() {
    // Clamp defensively too — maxLength guards typing, this guards paste/IME.
    const t = value.trim().slice(0, TASK_TITLE_MAX);
    if (t) onSubmit(t);
    setValue('');
    onClose();
  }

  return (
    <div className="mb-2 flex items-center gap-2">
      <Input
        ref={ref}
        value={value}
        onChange={(e) => setValue(e.target.value)}
        placeholder={placeholder}
        maxLength={TASK_TITLE_MAX}
        className="h-8 text-sm"
        onKeyDown={(e) => {
          if (e.key === 'Enter') submit();
          if (e.key === 'Escape') { setValue(''); onClose(); }
        }}
        onBlur={() => { if (!value.trim()) onClose(); }}
      />
      <Button size="sm" onClick={submit} disabled={!value.trim()}>Add</Button>
    </div>
  );
}
