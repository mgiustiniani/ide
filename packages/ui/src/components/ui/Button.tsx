// ---------------------------------------------------------------------------
// @ide/ui – Button
// Reusable button component with ripple effect, focus styles, and transitions.
// ---------------------------------------------------------------------------

import type { ButtonHTMLAttributes, ReactNode } from 'react';
import { useRef, useState, useCallback } from 'react';

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger';
export type ButtonSize = 'sm' | 'md' | 'lg';

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  /** Visual variant of the button. */
  variant?: ButtonVariant;
  /** Size preset. */
  size?: ButtonSize;
  /** Optional icon displayed before the label. */
  icon?: ReactNode;
  /** Whether the button is in a loading state. */
  isLoading?: boolean;
  /** Label content. */
  children?: ReactNode;
}

const variantStyles: Record<ButtonVariant, string> = {
  primary:
    'bg-[var(--button-bg)] text-[var(--button-text)] hover:bg-[var(--button-hover-bg)] border border-[var(--border-default)] shadow-sm',
  secondary:
    'bg-[var(--surface-panel)] text-[var(--text-primary)] hover:bg-[var(--highlight-bg)] border border-[var(--border-default)]',
  ghost:
    'bg-transparent text-[var(--text-secondary)] hover:bg-[var(--highlight-bg)] border border-transparent',
  danger:
    'bg-[var(--danger-bg)] text-[var(--danger-text)] hover:bg-[var(--danger-hover-bg)] border border-[var(--danger-text)]',
};

const sizeStyles: Record<ButtonSize, string> = {
  sm: 'px-2 py-0.5 text-xs gap-1',
  md: 'px-3 py-1 text-sm gap-1.5',
  lg: 'px-4 py-2 text-base gap-2',
};

export function Button({
  variant = 'primary',
  size = 'md',
  icon,
  isLoading = false,
  disabled,
  className,
  children,
  ...rest
}: ButtonProps): JSX.Element {
  const btnRef = useRef<HTMLButtonElement>(null);
  const [ripples, setRipples] = useState<{ id: number; x: number; y: number; size: number }[]>([]);
  const rippleIdRef = useRef(0);

  const handleClick = useCallback((e: React.MouseEvent<HTMLButtonElement>) => {
    const btn = btnRef.current;
    if (!btn) return;

    const rect = btn.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    const size = Math.max(rect.width, rect.height);

    const id = ++rippleIdRef.current;
    setRipples((prev) => [...prev, { id, x, y, size }]);

    // Remove ripple after animation
    setTimeout(() => {
      setRipples((prev) => prev.filter((r) => r.id !== id));
    }, 600);
  }, []);

  const base =
    'inline-flex items-center justify-center rounded-sm font-medium transition-all duration-150 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--border-focus)] disabled:opacity-50 disabled:cursor-not-allowed relative overflow-hidden';

  const cls = [base, variantStyles[variant], sizeStyles[size], className]
      .filter(Boolean)
      .join(' ');

  return (
    <button
      className={cls}
      ref={btnRef}
      disabled={disabled || isLoading}
      onClick={handleClick}
      {...rest}
    >
      {isLoading ? (
        <span className="inline-block h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent" />
      ) : icon ? (
        <span className="inline-flex shrink-0">{icon}</span>
      ) : null}
      {children && <span>{children}</span>}

      {/* Ripple effect overlay */}
      {ripples.map((r) => (
        <span
          key={r.id}
          className="absolute pointer-events-none animate-ripple rounded-full bg-white/20"
          style={{
            left: r.x - r.size / 2,
            top: r.y - r.size / 2,
            width: r.size,
            height: r.size,
          }}
        />
      ))}
    </button>
  );
}
