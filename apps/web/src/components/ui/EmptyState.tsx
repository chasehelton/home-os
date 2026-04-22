import type { ReactNode } from 'react';
import { cn } from './cn';

export function EmptyState({
  icon,
  title,
  description,
  action,
  className,
}: {
  icon?: ReactNode;
  title: ReactNode;
  description?: ReactNode;
  action?: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        'flex flex-col items-center gap-3 rounded-xl bg-surface-container-low px-6 py-12 text-center',
        className,
      )}
    >
      {icon && (
        <div className="grid h-12 w-12 place-items-center rounded-full bg-surface-container text-on-surface-variant">
          {icon}
        </div>
      )}
      <h3 className="font-display text-headline-md text-on-surface">{title}</h3>
      {description && <p className="max-w-md text-body-md text-on-surface-variant">{description}</p>}
      {action && <div className="mt-2">{action}</div>}
    </div>
  );
}
