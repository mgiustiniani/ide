// ---------------------------------------------------------------------------
// @ide/ui – Input
// A reusable text input component with Tailwind styling.
// ---------------------------------------------------------------------------

import type { InputHTMLAttributes } from 'react';

export type InputVariant = 'default' | 'ghost';

export interface InputProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'size'> {
  /** Visual variant. */
  variant?: InputVariant;
  /** Optional leading icon. */
  icon?: React.ReactNode;
  /** Whether the input has an error. */
  hasError?: boolean;
}

const variantStyles: Record<InputVariant, string> = {
  default:
    'bg-[var(--input-bg)] text-[var(--text-primary)] border-[var(--input-border)] placeholder:text-[var(--input-placeholder)] focus:border-[var(--input-focus-border)]',
  ghost:
    'bg-transparent text-[var(--text-primary)] border-transparent placeholder:text-[var(--text-muted)] focus:border-[var(--input-focus-border)]',
};

export function Input({
  variant = 'default',
  icon,
  hasError = false,
  className,
  ...rest
}: InputProps): JSX.Element {
  const base =
    'w-full rounded-sm px-2 py-1 text-sm border outline-none transition-colors duration-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--border-focus)] disabled:opacity-50 disabled:cursor-not-allowed';

  const errorBorder = hasError ? 'border-[var(--accent-red)]' : '';

  const wrapperCls = [
    'flex items-center gap-1 rounded-sm border',
    hasError ? 'border-[var(--accent-red)]' : 'border-[var(--input-border)]',
    'focus-within:border-[var(--input-focus-border)] focus-within:ring-2 focus-within:ring-[var(--border-focus)]',
    className,
  ]
    .filter(Boolean)
    .join(' ');

  const inputCls = [base, variantStyles[variant], errorBorder]
    .filter(Boolean)
    .join(' ');

  return (
    <div className={wrapperCls}>
      {icon && (
        <span className="inline-flex pl-1 text-[var(--text-muted)]">{icon}</span>
      )}
      <input className={inputCls} {...rest} />
    </div>
  );
}
