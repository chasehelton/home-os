import type { ReactNode } from 'react';
import { cn } from './cn';

export function PageHeader({
  title,
  description,
  actions,
  className,
}: {
  title: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  className?: string;
}) {
  return (
    <header
      className={cn(
        'flex flex-col gap-3 border-b border-outline-variant/60 pb-6 sm:flex-row sm:items-end sm:justify-between',
        className,
      )}
    >
      <div className="min-w-0">
        <h1 className="font-display text-headline-lg text-on-surface sm:text-display-lg">{title}</h1>
        {description && <p className="mt-2 max-w-2xl text-body-md text-on-surface-variant">{description}</p>}
      </div>
      {actions && <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div>}
    </header>
  );
}
