import { forwardRef, type ButtonHTMLAttributes, type AnchorHTMLAttributes, type ReactNode } from 'react';
import { cn } from './cn';

export type ButtonVariant = 'primary' | 'secondary' | 'tonal' | 'ghost' | 'danger' | 'outline';
export type ButtonSize = 'sm' | 'md' | 'lg';

const base =
  'inline-flex items-center justify-center gap-2 rounded-md font-sans font-medium transition-all duration-200 ease-soft focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 focus-visible:ring-offset-surface disabled:pointer-events-none disabled:opacity-50';

const variants: Record<ButtonVariant, string> = {
  primary:
    'bg-primary text-primary-on hover:bg-primary-container hover:text-primary-on-container shadow-ambient hover:-translate-y-px',
  secondary: 'bg-secondary-container text-secondary-on-container hover:brightness-[0.97]',
  tonal: 'bg-surface-high text-on-surface hover:bg-surface-highest',
  ghost: 'bg-transparent text-on-surface hover:bg-surface-container',
  outline:
    'bg-transparent text-on-surface ring-1 ring-inset ring-outline-variant hover:bg-surface-container',
  danger: 'bg-danger text-danger-on hover:brightness-110',
};

const sizes: Record<ButtonSize, string> = {
  sm: 'h-8 px-3 text-label-md',
  md: 'h-10 px-4 text-label-md',
  lg: 'h-12 px-6 text-body-md',
};

interface StyleProps {
  variant?: ButtonVariant;
  size?: ButtonSize;
  leadingIcon?: ReactNode;
  trailingIcon?: ReactNode;
}

type ButtonProps = StyleProps & ButtonHTMLAttributes<HTMLButtonElement>;
type AnchorProps = StyleProps & AnchorHTMLAttributes<HTMLAnchorElement>;

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = 'primary', size = 'md', leadingIcon, trailingIcon, className, children, ...rest },
  ref,
) {
  return (
    <button
      ref={ref}
      className={cn(base, variants[variant], sizes[size], className)}
      {...rest}
    >
      {leadingIcon}
      {children}
      {trailingIcon}
    </button>
  );
});

export const ButtonLink = forwardRef<HTMLAnchorElement, AnchorProps>(function ButtonLink(
  { variant = 'primary', size = 'md', leadingIcon, trailingIcon, className, children, ...rest },
  ref,
) {
  return (
    <a ref={ref} className={cn(base, variants[variant], sizes[size], className)} {...rest}>
      {leadingIcon}
      {children}
      {trailingIcon}
    </a>
  );
});

interface IconButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  size?: ButtonSize;
  variant?: ButtonVariant;
}

export const IconButton = forwardRef<HTMLButtonElement, IconButtonProps>(function IconButton(
  { className, variant = 'ghost', size = 'md', children, ...rest },
  ref,
) {
  const dim = size === 'sm' ? 'h-8 w-8' : size === 'lg' ? 'h-12 w-12' : 'h-10 w-10';
  return (
    <button ref={ref} className={cn(base, variants[variant], dim, 'p-0', className)} {...rest}>
      {children}
    </button>
  );
});
