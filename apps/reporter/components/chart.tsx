'use client';

import { useId, useState } from 'react';
import { formatINR, formatLakhCrore, type ChartSpec } from '@azentio/core';

/**
 * Bar and donut charts as inline SVG.
 *
 * Colour follows the data-viz method, not the brand: the brand's five greens
 * fail the chroma floor and read as grey when used as marks, so the categorical
 * set below is a validated companion palette — eight hues in a FIXED order
 * (never cycled), every adjacent pair clearing CVD ΔE ≥ 8 and normal-vision
 * ΔE ≥ 15, all ≥ 3:1 on the warm surface. Slot 1 is a forest green so a single
 * series still reads as brand.
 *
 * Marks are thin, data-ends rounded at 4px, 2px surface gaps between fills, and
 * every mark carries a direct label — identity is never colour alone.
 */
export const SERIES = [
  '#2a7f56', '#4a5fb5', '#b8562e', '#0e94a0', '#ad7d09', '#8f4a8f', '#9a4f1f', '#6f8f2a',
] as const;

const SURFACE = '#ffffff';
const INK = 'var(--color-ink)';
const INK_MUTED = 'var(--color-ink-muted)';
const INK_FAINT = 'var(--color-ink-faint)';
const GRID = 'var(--color-line-soft)';

const fmtValue = (v: number, currency: boolean, compact = false) =>
  currency ? (compact ? formatLakhCrore(v) : formatINR(v))
  : Math.abs(v) >= 1000 ? Math.round(v).toLocaleString('en-IN')
  : (Math.round(v * 100) / 100).toLocaleString('en-IN');

export function Chart({ spec, compact = false }: { spec: ChartSpec; compact?: boolean }) {
  return spec.type === 'pie' ? <Donut spec={spec} compact={compact} /> : <Bars spec={spec} compact={compact} />;
}

/* ------------------------------------------------------------------ bars */

function Bars({ spec, compact }: { spec: ChartSpec; compact: boolean }) {
  const [hover, setHover] = useState<number | null>(null);
  const id = useId();
  const currency = !!spec.is_currency;

  const n = spec.labels.length;
  const max = Math.max(0, ...spec.values);
  const width = 560;
  const labelW = compact ? 118 : 150;
  const rowH = compact ? 22 : 26;
  const gap = 8;
  const padTop = 6;
  const height = padTop + n * (rowH + gap);
  const plotW = width - labelW - 96;

  return (
    <figure className="m-0" aria-label={spec.title}>
      <figcaption className="mb-2 flex items-baseline justify-between gap-3">
        <span className="text-[12.5px] font-semibold text-[var(--color-ink)]">{spec.title}</span>
        {spec.value_label && <span className="label">{spec.value_label}</span>}
      </figcaption>

      <svg viewBox={`0 0 ${width} ${height}`} width="100%" role="img" aria-labelledby={`${id}-t`} style={{ display: 'block', overflow: 'visible' }}>
        <title id={`${id}-t`}>{spec.title}</title>

        {/* recessive grid: quarter ticks only */}
        {[0.25, 0.5, 0.75, 1].map((t) => (
          <line key={t} x1={labelW + plotW * t} x2={labelW + plotW * t} y1={0} y2={height} stroke={GRID} strokeWidth={1} />
        ))}

        {spec.labels.map((label, i) => {
          const v = spec.values[i] ?? 0;
          const w = max > 0 ? Math.max(2, (v / max) * plotW) : 0;
          const y = padTop + i * (rowH + gap);
          const active = hover === null || hover === i;
          return (
            <g
              key={label}
              onMouseEnter={() => setHover(i)}
              onMouseLeave={() => setHover(null)}
              style={{ cursor: 'default' }}
            >
              {/* hit target larger than the mark */}
              <rect x={0} y={y - gap / 2} width={width} height={rowH + gap} fill="transparent" />
              <text x={labelW - 10} y={y + rowH / 2} textAnchor="end" dominantBaseline="central"
                    fontSize={compact ? 11 : 12} fill={active ? INK : INK_FAINT} style={{ transition: 'fill .15s' }}>
                {truncate(label, compact ? 18 : 24)}
              </text>
              <rect x={labelW} y={y} width={w} height={rowH} rx={4} ry={4}
                    fill={SERIES[0]} opacity={active ? 1 : 0.35}
                    style={{ transition: 'opacity .15s, width .4s cubic-bezier(.4,0,.2,1)' }} />
              {/* 2px surface gap shown as a hairline at the baseline, keeps bars separate */}
              <text x={labelW + w + 8} y={y + rowH / 2} dominantBaseline="central"
                    fontSize={compact ? 11 : 12} fontWeight={600} fill={active ? INK : INK_MUTED}
                    style={{ fontVariantNumeric: 'tabular-nums', transition: 'fill .15s' }}>
                {fmtValue(v, currency, true)}
              </text>
              <title>{`${label}: ${fmtValue(v, currency)}`}</title>
            </g>
          );
        })}

        <line x1={labelW} x2={labelW} y1={0} y2={height} stroke="var(--color-line)" strokeWidth={1} />
      </svg>
    </figure>
  );
}

/* ----------------------------------------------------------------- donut */

function Donut({ spec, compact }: { spec: ChartSpec; compact: boolean }) {
  const [hover, setHover] = useState<number | null>(null);
  const id = useId();
  const currency = !!spec.is_currency;

  const total = spec.values.reduce((s, v) => s + Math.max(0, v), 0);
  const size = compact ? 150 : 180;
  const r = size / 2 - 4;
  const inner = r * 0.62;
  const cx = size / 2, cy = size / 2;

  let angle = -Math.PI / 2;
  const slices = spec.labels.map((label, i) => {
    const v = Math.max(0, spec.values[i] ?? 0);
    const frac = total > 0 ? v / total : 0;
    const start = angle;
    const end = angle + frac * Math.PI * 2;
    angle = end;
    // "Other" is always the last slot and takes a neutral, never a series hue.
    const colour = label === 'Other' ? '#b6b09c' : SERIES[Math.min(i, SERIES.length - 1)]!;
    return { label, v, frac, start, end, colour, i };
  });

  return (
    <figure className="m-0" aria-label={spec.title}>
      <figcaption className="mb-2 text-[12.5px] font-semibold text-[var(--color-ink)]">{spec.title}</figcaption>

      <div className={`flex ${compact ? 'flex-col items-center gap-3' : 'items-center gap-6'}`}>
        <svg viewBox={`0 0 ${size} ${size}`} width={size} height={size} role="img" aria-labelledby={`${id}-t`} style={{ flexShrink: 0 }}>
          <title id={`${id}-t`}>{spec.title}</title>
          {slices.map((s) => {
            if (s.frac <= 0) return null;
            const active = hover === null || hover === s.i;
            const d = arcPath(cx, cy, r, inner, s.start, s.end);
            return (
              <path key={s.label} d={d} fill={s.colour} opacity={active ? 1 : 0.35}
                    stroke={SURFACE} strokeWidth={2} /* 2px surface gap between slices */
                    onMouseEnter={() => setHover(s.i)} onMouseLeave={() => setHover(null)}
                    style={{ transition: 'opacity .15s' }}>
                <title>{`${s.label}: ${fmtValue(s.v, currency)} (${(s.frac * 100).toFixed(1)}%)`}</title>
              </path>
            );
          })}
          {/* hero total in the hole */}
          <text x={cx} y={cy - 6} textAnchor="middle" fontSize={compact ? 13 : 15} fontWeight={600} fill={INK}
                style={{ fontVariantNumeric: 'tabular-nums' }}>
            {hover !== null ? `${((slices[hover]?.frac ?? 0) * 100).toFixed(1)}%` : fmtValue(total, currency, true)}
          </text>
          <text x={cx} y={cy + 10} textAnchor="middle" fontSize={9.5} fill={INK_FAINT} style={{ letterSpacing: '.08em', textTransform: 'uppercase' }}>
            {hover !== null ? truncate(slices[hover]!.label, 16) : 'total'}
          </text>
        </svg>

        {/* legend with values: identity is never colour alone */}
        <ul className="m-0 grid w-full list-none gap-1.5 p-0">
          {slices.map((s) => (
            <li key={s.label}
                onMouseEnter={() => setHover(s.i)} onMouseLeave={() => setHover(null)}
                className="flex items-center gap-2 text-[12px]"
                style={{ opacity: hover === null || hover === s.i ? 1 : 0.45, transition: 'opacity .15s' }}>
              <span aria-hidden className="inline-block h-[9px] w-[9px] shrink-0 rounded-[2px]" style={{ background: s.colour }} />
              <span className="min-w-0 flex-1 truncate text-[var(--color-ink-soft)]">{s.label}</span>
              <span className="tabular shrink-0 text-[var(--color-ink-muted)]">{(s.frac * 100).toFixed(1)}%</span>
              <span className="tabular shrink-0 font-semibold text-[var(--color-ink)]">{fmtValue(s.v, currency, true)}</span>
            </li>
          ))}
        </ul>
      </div>
    </figure>
  );
}

function arcPath(cx: number, cy: number, r: number, inner: number, start: number, end: number): string {
  // A full circle degenerates; pull the end back a hair so the arc renders.
  if (end - start >= Math.PI * 2 - 1e-6) end = start + Math.PI * 2 - 1e-4;
  const large = end - start > Math.PI ? 1 : 0;
  const p = (rad: number, ang: number) => [cx + rad * Math.cos(ang), cy + rad * Math.sin(ang)] as const;
  const [x1, y1] = p(r, start), [x2, y2] = p(r, end);
  const [x3, y3] = p(inner, end), [x4, y4] = p(inner, start);
  return [
    `M ${x1} ${y1}`,
    `A ${r} ${r} 0 ${large} 1 ${x2} ${y2}`,
    `L ${x3} ${y3}`,
    `A ${inner} ${inner} 0 ${large} 0 ${x4} ${y4}`,
    'Z',
  ].join(' ');
}

function truncate(s: string, n: number): string {
  return s.length > n ? s.slice(0, n - 1) + '…' : s;
}
