import type { HTMLAttributes } from 'react';
import { cn } from './cn';

type BadgeTone = 'neutral' | 'primary' | 'secondary' | 'tertiary' | 'danger';

const tones: Record<BadgeTone, string> = {
  neutral: 'bg-surface-container text-on-surface-variant',
  primary: 'bg-primary-container text-primary-on-container',
  secondary: 'bg-secondary-container text-secondary-on-container',
  tertiary: 'bg-tertiary-container text-tertiary-on-container',
  danger: 'bg-danger-container text-danger-on-container',
};

export function Badge({
  tone = 'neutral',
  className,
  ...rest
}: HTMLAttributes<HTMLSpanElement> & { tone?: BadgeTone }) {
  return (
    <span
      className={cn('inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-label-sm uppercase', tones[tone], className)}
      {...rest}
    />
  );
}
