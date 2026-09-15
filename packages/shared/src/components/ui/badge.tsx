import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '../../lib/utils';

// Flutter PdBadge / PdStatusPill: squared 4px corners, JetBrains-mono UPPERCASE,
// tinted fill (~12%) with a matching ~25-30% border. Not a pill.
const badgeVariants = cva(
  'inline-flex items-center rounded-[4px] border px-2 py-0.5 font-mono text-[0.6875rem] uppercase leading-none tracking-[0.06em] transition-colors',
  {
    variants: {
      variant: {
        default: 'border-ink-100 bg-ink-100 text-paper',
        muted: 'border-transparent bg-inset text-ink-60',
        accent: 'border-accent/30 bg-accent/12 text-accent',
        success: 'border-success/30 bg-success/12 text-success',
        warn: 'border-warn/35 bg-warn/15 text-warn',
        danger: 'border-danger/30 bg-danger/12 text-danger',
        outline: 'border-[color:var(--color-border-default)] text-ink-60',
      },
    },
    defaultVariants: { variant: 'muted' },
  },
);

export interface BadgeProps
  extends React.HTMLAttributes<HTMLSpanElement>,
    VariantProps<typeof badgeVariants> {}

export function Badge({ className, variant, ...props }: BadgeProps) {
  return <span className={cn(badgeVariants({ variant }), className)} {...props} />;
}
