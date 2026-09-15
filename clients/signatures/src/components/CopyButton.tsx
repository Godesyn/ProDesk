/**
 * CopyButton — Clipboard copy with animated checkmark
 * Design: Warm Craft Studio
 *
 * Supports both static `text` and async `getText` for cases where the
 * copy content needs to be generated on-the-fly (e.g. brand-coloured icons).
 */

import { useState } from 'react';
import { Check, Copy, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

interface CopyButtonProps {
  /** Static text to copy. Used when getText is not provided. */
  text?: string;
  /** Async function that returns the text to copy. Takes priority over `text`. */
  getText?: () => Promise<string>;
  label?: string;
  className?: string;
  variant?: 'default' | 'outline' | 'secondary';
  onCopy?: () => void;
}

export function CopyButton({ text, getText, label = 'Copy HTML', className, variant = 'default', onCopy }: CopyButtonProps) {
  const [copied, setCopied] = useState(false);
  const [loading, setLoading] = useState(false);

  const handleCopy = async () => {
    setLoading(true);
    try {
      const content = getText ? await getText() : (text ?? '');
      try {
        await navigator.clipboard.writeText(content);
      } catch {
        // Fallback for older browsers
        const el = document.createElement('textarea');
        el.value = content;
        document.body.appendChild(el);
        el.select();
        document.execCommand('copy');
        document.body.removeChild(el);
      }
      setCopied(true);
      onCopy?.();
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // silently fail
    } finally {
      setLoading(false);
    }
  };

  return (
    <Button
      onClick={handleCopy}
      disabled={loading}
      variant={variant}
      className={cn(
        'transition-all duration-200',
        copied && 'scale-95',
        className
      )}
    >
      {loading ? (
        <Loader2 className="w-4 h-4 mr-2 inline animate-spin" />
      ) : (
        <>
          <span className={cn('transition-all duration-200', copied ? 'opacity-0 w-0' : 'opacity-100')}>
            <Copy className="w-4 h-4 mr-2 inline" />
          </span>
          <span className={cn('transition-all duration-200 absolute', copied ? 'opacity-100' : 'opacity-0')}>
            <Check className="w-4 h-4 mr-2 inline text-green-400" />
          </span>
        </>
      )}
      {loading ? 'Preparing…' : copied ? 'Copied!' : label}
    </Button>
  );
}
