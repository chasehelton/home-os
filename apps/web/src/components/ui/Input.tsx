import { forwardRef, type InputHTMLAttributes, type SelectHTMLAttributes, type TextareaHTMLAttributes, type ReactNode } from 'react';
import { cn } from './cn';

const fieldBase =
  'w-full rounded-md bg-surface-lowest px-3.5 py-2.5 text-body-md text-on-surface placeholder:text-on-surface-variant/60 ring-1 ring-inset ring-outline-variant transition-shadow duration-200 ease-soft focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary disabled:cursor-not-allowed disabled:opacity-50';

export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(
  function Input({ className, ...rest }, ref) {
    return <input ref={ref} className={cn(fieldBase, className)} {...rest} />;
  },
);

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaHTMLAttributes<HTMLTextAreaElement>>(
  function Textarea({ className, ...rest }, ref) {
    return (
      <textarea ref={ref} className={cn(fieldBase, 'min-h-24 resize-y leading-relaxed', className)} {...rest} />
    );
  },
);

export const Select = forwardRef<HTMLSelectElement, SelectHTMLAttributes<HTMLSelectElement>>(
  function Select({ className, children, ...rest }, ref) {
    return (
      <select ref={ref} className={cn(fieldBase, 'pr-8', className)} {...rest}>
        {children}
      </select>
    );
  },
);

export function Field({
  label,
  hint,
  error,
  required,
  children,
}: {
  label: ReactNode;
  hint?: ReactNode;
  error?: ReactNode;
  required?: boolean;
  children: ReactNode;
}) {
  return (
    <label className="flex flex-col gap-1.5">
      <span className="text-label-md text-on-surface-variant">
        {label}
        {required && <span className="ml-0.5 text-danger">*</span>}
      </span>
      {children}
      {error ? (
        <span className="text-label-md text-danger">{error}</span>
      ) : hint ? (
        <span className="text-label-md text-on-surface-variant/80">{hint}</span>
      ) : null}
    </label>
  );
}
