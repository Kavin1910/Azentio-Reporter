/**
 * Brand mark and wordmark.
 *
 * The mark: three ascending bars — the report — the tallest tapering to a leaf
 * tip, the one nod to the sage/forest palette. Filled pine, bars stepping
 * through the sage ramp so the set reads as one object at 16px and as a
 * considered mark at 64px. Drawn once here and reused for the favicon files in
 * app/, so there is exactly one source of truth.
 */
export function Mark({ size = 32, className = '' }: { size?: number; className?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 64 64" className={className} aria-hidden="true" focusable="false">
      <rect width="64" height="64" rx="18" fill="#344e41" />
      <rect x="15" y="34" width="9" height="14" rx="3" fill="#a3b18a" />
      <rect x="27.5" y="25" width="9" height="23" rx="3" fill="#c8d0b9" />
      <path d="M40 48 V24 Q44.5 12 49 24 V48 Z" fill="#edefe8" />
      <path d="M44.5 15.5 V46" stroke="#344e41" strokeWidth="1.2" strokeLinecap="round" opacity=".55" />
    </svg>
  );
}

export function Wordmark({ compact = false }: { compact?: boolean }) {
  return (
    <span className="flex items-baseline gap-2">
      <span className={`display ${compact ? 'text-[17px]' : 'text-[28px]'} font-medium tracking-[-0.015em] text-[var(--color-ink)]`}>Azentio</span>
      <span className={`${compact ? 'text-[10px]' : 'text-[12px]'} font-semibold uppercase tracking-[0.16em] text-[var(--color-ink-faint)]`}>Reporter</span>
    </span>
  );
}

export function Logo({ compact = true }: { compact?: boolean }) {
  return (
    <span className="flex items-center gap-2.5">
      <Mark size={compact ? 30 : 56} className={compact ? 'shadow-[var(--shadow-sm)] rounded-[8px]' : 'shadow-[var(--shadow)] rounded-[15px]'} />
      <Wordmark compact={compact} />
    </span>
  );
}
