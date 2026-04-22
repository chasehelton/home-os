import { useEffect, type ReactNode } from 'react';
import { cn } from './cn';

export function Sheet({
  open,
  onClose,
  side = 'bottom',
  children,
  title,
}: {
  open: boolean;
  onClose: () => void;
  side?: 'bottom' | 'right';
  children: ReactNode;
  title?: ReactNode;
}) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open, onClose]);
  if (!open) return null;
  const panel =
    side === 'bottom'
      ? 'inset-x-0 bottom-0 rounded-t-xl max-h-[85vh]'
      : 'right-0 top-0 h-full w-full max-w-sm rounded-l-xl';
  return (
    <div className="fixed inset-0 z-50" role="dialog" aria-modal="true">
      <div aria-hidden onClick={onClose} className="absolute inset-0 bg-on-surface/30 backdrop-blur-sm" />
      <div className={cn('absolute bg-surface-lowest shadow-ambient-lg', panel)}>
        {title && (
          <div className="border-b border-outline-variant/60 px-6 py-4">
            <h3 className="font-display text-headline-md text-on-surface">{title}</h3>
          </div>
        )}
        <div className="overflow-y-auto px-6 py-5">{children}</div>
      </div>
    </div>
  );
}
