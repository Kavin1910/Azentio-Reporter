import type { SVGProps } from 'react';

type P = SVGProps<SVGSVGElement> & { size?: number };
const base = (size = 16) => ({
  width: size, height: size, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor',
  strokeWidth: 1.75, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const, 'aria-hidden': true,
});

export const Upload = ({ size, ...p }: P) => <svg {...base(size)} {...p}><path d="M12 16V4M6 10l6-6 6 6M4 20h16" /></svg>;
export const Sparkle = ({ size, ...p }: P) => <svg {...base(size)} {...p}><path d="M12 3v4M12 17v4M3 12h4M17 12h4M5.6 5.6l2.8 2.8M15.6 15.6l2.8 2.8M18.4 5.6l-2.8 2.8M8.4 15.6l-2.8 2.8" /></svg>;
export const Table = ({ size, ...p }: P) => <svg {...base(size)} {...p}><rect x="3" y="4" width="18" height="16" rx="2" /><path d="M3 10h18M9 4v16" /></svg>;
export const Layers = ({ size, ...p }: P) => <svg {...base(size)} {...p}><path d="M12 3l9 5-9 5-9-5 9-5zM3 13l9 5 9-5" /></svg>;
export const Check = ({ size, ...p }: P) => <svg {...base(size)} {...p}><path d="M5 12l5 5L20 7" /></svg>;
export const X = ({ size, ...p }: P) => <svg {...base(size)} {...p}><path d="M6 6l12 12M18 6L6 18" /></svg>;
export const Pencil = ({ size, ...p }: P) => <svg {...base(size)} {...p}><path d="M4 20h4l10-10-4-4L4 16v4zM13 7l4 4" /></svg>;
export const BarChart = ({ size, ...p }: P) => <svg {...base(size)} {...p}><path d="M4 20h16M7 16v-5M12 16V6M17 16v-8" /></svg>;
export const Message = ({ size, ...p }: P) => <svg {...base(size)} {...p}><path d="M4 5h16v11H9l-5 4V5z" /></svg>;
export const Send = ({ size, ...p }: P) => <svg {...base(size)} {...p}><path d="M4 12l16-8-6 16-2-7-8-1z" /></svg>;
export const Download = ({ size, ...p }: P) => <svg {...base(size)} {...p}><path d="M12 4v12M6 10l6 6 6-6M4 20h16" /></svg>;
export const Printer = ({ size, ...p }: P) => <svg {...base(size)} {...p}><path d="M6 9V4h12v5M6 17H4v-8h16v8h-2M6 14h12v6H6z" /></svg>;
export const Grip = ({ size, ...p }: P) => <svg {...base(size)} {...p}><path d="M9 6h.01M15 6h.01M9 12h.01M15 12h.01M9 18h.01M15 18h.01" strokeWidth="2.5" /></svg>;
export const Filter = ({ size, ...p }: P) => <svg {...base(size)} {...p}><path d="M4 5h16l-6 8v6l-4-2v-4L4 5z" /></svg>;
export const Refresh = ({ size, ...p }: P) => <svg {...base(size)} {...p}><path d="M20 12a8 8 0 1 1-2.3-5.7M20 4v5h-5" /></svg>;
export const Trash = ({ size, ...p }: P) => <svg {...base(size)} {...p}><path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13" /></svg>;
export const Fx = ({ size, ...p }: P) => <svg {...base(size)} {...p}><path d="M5 18c2 0 3-1 3.5-3l1.5-8c.4-2 1.5-3 3.5-3M6 10h6M12 14l6 6M18 14l-6 6" /></svg>;
export const Alert = ({ size, ...p }: P) => <svg {...base(size)} {...p}><path d="M12 3l10 18H2L12 3zM12 10v4M12 17.5v.5" /></svg>;
export const ChevronDown = ({ size, ...p }: P) => <svg {...base(size)} {...p}><path d="M6 9l6 6 6-6" /></svg>;
export const FileIcon = ({ size, ...p }: P) => <svg {...base(size)} {...p}><path d="M6 3h8l4 4v14H6V3zM14 3v4h4" /></svg>;

/** Type glyph for a column: kept textual so it prints and reads without colour. */
export function TypeGlyph({ type }: { type: string }) {
  const t = type === 'currency' ? '₹' : type === 'number' ? '#' : type === 'date' ? '◷' : type === 'boolean' ? '◑' : 'Aa';
  return (
    <span className="inline-flex h-[16px] min-w-[16px] items-center justify-center rounded-[4px] bg-[var(--color-canvas-sunken)] px-1 text-[9.5px] font-semibold text-[var(--color-ink-muted)]" aria-label={type}>
      {t}
    </span>
  );
}
export const History = ({ size, ...p }: P) => <svg {...base(size)} {...p}><path d="M3 12a9 9 0 1 0 3-6.7M3 4v5h5M12 8v4l3 2" /></svg>;
export const Plus = ({ size, ...p }: P) => <svg {...base(size)} {...p}><path d="M12 5v14M5 12h14" /></svg>;
export const ArrowLeft = ({ size, ...p }: P) => <svg {...base(size)} {...p}><path d="M19 12H5M11 6l-6 6 6 6" /></svg>;
export const ArrowRight = ({ size, ...p }: P) => <svg {...base(size)} {...p}><path d="M5 12h14M13 6l6 6-6 6" /></svg>;
export const Mic = ({ size, ...p }: P) => <svg {...base(size)} {...p}><rect x="9" y="3" width="6" height="11" rx="3" /><path d="M5 11a7 7 0 0 0 14 0M12 18v3M9 21h6" /></svg>;
export const MicOff = ({ size, ...p }: P) => <svg {...base(size)} {...p}><path d="M9 9v2a3 3 0 0 0 5.1 2.1M15 9.3V6a3 3 0 0 0-6 0v.3M5 11a7 7 0 0 0 11.4 5.4M19 11a7 7 0 0 1-1 3.6M12 18v3M9 21h6M4 4l16 16" /></svg>;
export const Database = ({ size, ...p }: P) => <svg {...base(size)} {...p}><ellipse cx="12" cy="6" rx="8" ry="3" /><path d="M4 6v12c0 1.7 3.6 3 8 3s8-1.3 8-3V6M4 12c0 1.7 3.6 3 8 3s8-1.3 8-3" /></svg>;
export const PanelLeft = ({ size, ...p }: P) => <svg {...base(size)} {...p}><rect x="3" y="4" width="18" height="16" rx="2" /><path d="M9 4v16M15 10l-2 2 2 2" /></svg>;
