import type { ReactNode } from 'react';
import { cn } from './cn';

interface Tab<T extends string> {
  id: T;
  label: ReactNode;
  icon?: ReactNode;
}

export function SegmentedTabs<T extends string>({
  tabs,
  value,
  onChange,
  size = 'md',
  className,
}: {
  tabs: Tab<T>[];
  value: T;
  onChange: (v: T) => void;
  size?: 'sm' | 'md';
  className?: string;
}) {
  const padding = size === 'sm' ? 'p-0.5' : 'p-1';
  const btn = size === 'sm' ? 'h-7 px-2.5 text-label-md' : 'h-9 px-3.5 text-label-md';
  return (
    <div role="tablist" className={cn('inline-flex items-center rounded-full bg-surface-container', padding, className)}>
      {tabs.map((t) => {
        const active = t.id === value;
        return (
          <button
            key={t.id}
            role="tab"
            aria-selected={active}
            onClick={() => onChange(t.id)}
            className={cn(
              'inline-flex items-center gap-1.5 rounded-full font-medium transition-colors duration-200 ease-soft',
              btn,
              active
                ? 'bg-surface-lowest text-on-surface shadow-ambient'
                : 'text-on-surface-variant hover:text-on-surface',
            )}
          >
            {t.icon}
            {t.label}
          </button>
        );
      })}
    </div>
  );
}
