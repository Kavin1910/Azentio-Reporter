import type { ReactNode } from 'react';

/**
 * Tooltip wrapper.
 *
 * The visible tip is CSS-driven off `data-tip`, which keeps it free of JS and
 * lets any element carry one. The aria-label matters just as much: a CSS
 * pseudo-element is invisible to assistive technology, so without it the
 * tooltip would exist only for sighted mouse users.
 *
 * Shows on focus as well as hover — a tooltip a keyboard user cannot reach is
 * decoration, not help.
 */
export function Tip({
  text,
  side = 'top',
  children,
  className = '',
  as: Tag = 'span',
}: {
  text: string;
  side?: 'top' | 'bottom';
  children: ReactNode;
  className?: string;
  as?: 'span' | 'div';
}) {
  return (
    <Tag
      data-tip={text}
      data-tip-side={side === 'bottom' ? 'bottom' : undefined}
      aria-label={text}
      className={`inline-flex ${className}`}
    >
      {children}
    </Tag>
  );
}

/** A small circled "i" that explains a term inline. */
export function InfoDot({ text, side = 'top' }: { text: string; side?: 'top' | 'bottom' }) {
  return (
    <button
      type="button"
      data-tip={text}
      data-tip-side={side === 'bottom' ? 'bottom' : undefined}
      aria-label={text}
      className="ml-1 inline-flex h-[13px] w-[13px] shrink-0 cursor-help items-center justify-center rounded-full border border-[var(--color-line-strong)] text-[8.5px] font-semibold leading-none text-[var(--color-ink-faint)] transition-colors hover:border-[var(--color-ink-muted)] hover:text-[var(--color-ink-muted)]"
    >
      i
    </button>
  );
}
