'use client';

import { useEffect, useState } from 'react';

/**
 * One tooltip for the whole app.
 *
 * Triggers keep the `data-tip` attribute (and `aria-label`, for assistive
 * technology) exactly as before. What changed is where the bubble is drawn: as
 * a single fixed-position element mounted at the document root, placed from
 * the trigger's bounding rect. A CSS `::after` on the trigger was clipped by
 * every `overflow: hidden` ancestor — the report cards, the chat panel — and
 * could not see the viewport edge. This can.
 *
 * Shows on hover AND keyboard focus. Flips below when there is no room above,
 * clamps horizontally with an 8px margin, and the arrow stays on the trigger.
 */
interface Tip { text: string; x: number; y: number; side: 'top' | 'bottom'; arrowX: number }

const GAP = 8;
const MARGIN = 8;
const MAX_W = 280;

export function TooltipLayer() {
  const [tip, setTip] = useState<Tip | null>(null);
  const [size, setSize] = useState<{ w: number; h: number } | null>(null);

  useEffect(() => {
    let current: Element | null = null;

    const place = (el: Element) => {
      const text = el.getAttribute('data-tip');
      if (!text) return;
      const r = el.getBoundingClientRect();
      if (r.width === 0 && r.height === 0) return;
      const prefer = el.getAttribute('data-tip-side') === 'bottom' ? 'bottom' : 'top';
      // Measured height is unknown until render; assume two lines and correct below.
      const estH = 40;
      const side: 'top' | 'bottom' =
        prefer === 'top' ? (r.top - GAP - estH < MARGIN ? 'bottom' : 'top')
        : (r.bottom + GAP + estH > window.innerHeight - MARGIN ? 'top' : 'bottom');
      const centre = r.left + r.width / 2;
      setTip({ text, x: centre, y: side === 'top' ? r.top - GAP : r.bottom + GAP, side, arrowX: centre });
      setSize(null);
    };

    const show = (e: Event) => {
      const el = (e.target as Element | null)?.closest?.('[data-tip]');
      if (!el || el === current) return;
      current = el;
      place(el);
    };
    const hide = (e: Event) => {
      const to = (e as MouseEvent).relatedTarget as Element | null;
      if (to && current && current.contains(to)) return;
      current = null;
      setTip(null);
    };
    const hideNow = () => { current = null; setTip(null); };

    document.addEventListener('mouseover', show, true);
    document.addEventListener('mouseout', hide, true);
    document.addEventListener('focusin', show, true);
    document.addEventListener('focusout', hideNow, true);
    // A stale bubble after the page moves is worse than none.
    document.addEventListener('scroll', hideNow, true);
    window.addEventListener('resize', hideNow);
    document.addEventListener('mousedown', hideNow, true);
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape') hideNow(); });

    return () => {
      document.removeEventListener('mouseover', show, true);
      document.removeEventListener('mouseout', hide, true);
      document.removeEventListener('focusin', show, true);
      document.removeEventListener('focusout', hideNow, true);
      document.removeEventListener('scroll', hideNow, true);
      window.removeEventListener('resize', hideNow);
      document.removeEventListener('mousedown', hideNow, true);
    };
  }, []);

  if (!tip) return null;

  // Clamp horizontally once the bubble's real width is known; the arrow keeps
  // pointing at the trigger even when the bubble had to shift.
  const w = size?.w ?? MAX_W;
  const half = w / 2;
  const left = Math.min(Math.max(tip.x - half, MARGIN), window.innerWidth - MARGIN - w);
  const arrowLeft = Math.min(Math.max(tip.arrowX - left, 12), w - 12);

  return (
    <div
      role="tooltip"
      ref={(node) => { if (node && !size) { const r = node.getBoundingClientRect(); setSize({ w: r.width, h: r.height }); } }}
      className="pointer-events-none fixed z-[1000] rounded-[var(--radius-sm)] px-2.5 py-1.5 text-[11.5px] leading-[1.45] shadow-[var(--shadow-lg)]"
      style={{
        left,
        top: tip.side === 'top' ? tip.y : undefined,
        bottom: tip.side === 'bottom' ? undefined : undefined,
        transform: tip.side === 'top' ? 'translateY(-100%)' : 'none',
        ...(tip.side === 'bottom' ? { top: tip.y } : {}),
        maxWidth: MAX_W,
        width: 'max-content',
        background: 'var(--color-pine-200)',
        color: 'var(--color-dust-800)',
        opacity: size ? 1 : 0,          // measure first, then show — no flash at the wrong spot
        transition: 'opacity .12s ease',
      }}
    >
      {tip.text}
      <span
        aria-hidden
        className="absolute h-0 w-0 border-[5px] border-transparent"
        style={
          tip.side === 'top'
            ? { top: '100%', left: arrowLeft, transform: 'translateX(-50%)', borderTopColor: 'var(--color-pine-200)' }
            : { bottom: '100%', left: arrowLeft, transform: 'translateX(-50%)', borderBottomColor: 'var(--color-pine-200)' }
        }
      />
    </div>
  );
}
