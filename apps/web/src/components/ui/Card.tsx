import type { HTMLAttributes, ReactNode } from 'react';
import { cn } from './cn';

interface CardProps extends HTMLAttributes<HTMLDivElement> {
  variant?: 'surface' | 'elevated' | 'tonal' | 'outline';
  padding?: 'none' | 'sm' | 'md' | 'lg';
  interactive?: boolean;
}

const variantClass = {
  surface: 'bg-surface-lowest',
  elevated: 'bg-surface-lowest shadow-ambient',
  tonal: 'bg-surface-container',
  outline: 'bg-surface-lowest ring-1 ring-inset ring-outline-variant',
} as const;

const paddingClass = {
  none: 'p-0',
  sm: 'p-4',
  md: 'p-6',
  lg: 'p-10',
} as const;

export function Card({
  variant = 'elevated',
  padding = 'md',
  interactive = false,
  className,
  children,
  ...rest
}: CardProps) {
  return (
    <div
      className={cn(
        'rounded-lg text-on-surface transition-all duration-200 ease-soft',
        variantClass[variant],
        paddingClass[padding],
        interactive && 'hover:shadow-ambient-lg hover:-translate-y-0.5 cursor-pointer',
        className,
      )}
      {...rest}
    >
      {children}
    </div>
  );
}

export function CardHeader({
  title,
  description,
  action,
  className,
}: {
  title: ReactNode;
  description?: ReactNode;
  action?: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn('mb-4 flex items-start justify-between gap-4', className)}>
      <div className="min-w-0">
        <h3 className="font-display text-headline-md text-on-surface">{title}</h3>
        {description && <p className="mt-1 text-body-md text-on-surface-variant">{description}</p>}
      </div>
      {action && <div className="shrink-0">{action}</div>}
    </div>
  );
}
