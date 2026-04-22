import { useEffect, type ReactNode } from 'react';
import { cn } from './cn';

export function Dialog({
  open,
  onClose,
  title,
  description,
  children,
  footer,
  size = 'md',
}: {
  open: boolean;
  onClose: () => void;
  title?: ReactNode;
  description?: ReactNode;
  children?: ReactNode;
  footer?: ReactNode;
  size?: 'sm' | 'md' | 'lg';
}) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = prev;
    };
  }, [open, onClose]);
  if (!open) return null;
  const sizeClass = { sm: 'max-w-md', md: 'max-w-xl', lg: 'max-w-3xl' }[size];
  return (
    <div role="dialog" aria-modal="true" className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div aria-hidden onClick={onClose} className="absolute inset-0 bg-on-surface/30 backdrop-blur-sm" />
      <div className={cn('relative w-full overflow-hidden rounded-xl bg-surface-lowest shadow-ambient-lg', sizeClass)}>
        {(title || description) && (
          <div className="border-b border-outline-variant/60 px-6 py-5">
            {title && <h2 className="font-display text-headline-md text-on-surface">{title}</h2>}
            {description && <p className="mt-1 text-body-md text-on-surface-variant">{description}</p>}
          </div>
        )}
        <div className="max-h-[70vh] overflow-y-auto px-6 py-5">{children}</div>
        {footer && (
          <div className="flex items-center justify-end gap-2 border-t border-outline-variant/60 bg-surface-container-low/60 px-6 py-4">
            {footer}
          </div>
        )}
      </div>
    </div>
  );
}
