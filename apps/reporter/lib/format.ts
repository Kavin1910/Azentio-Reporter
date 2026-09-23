import { formatINR, formatDate, type ColumnType } from '@azentio/core';

/** Renders a cell for display according to its column type. */
export function formatCell(value: unknown, type: ColumnType | 'percent' | 'integer'): string {
  if (value === null || value === undefined || value === '') return '—';
  switch (type) {
    case 'currency': return typeof value === 'number' ? formatINR(value) : String(value);
    case 'percent': return typeof value === 'number' ? `${(Math.round(value * 10) / 10).toFixed(1)}%` : String(value);
    case 'integer': return typeof value === 'number' ? Math.round(value).toLocaleString('en-IN') : String(value);
    case 'number': return typeof value === 'number' ? (Number.isInteger(value) ? value.toLocaleString('en-IN') : (Math.round(value * 100) / 100).toLocaleString('en-IN')) : String(value);
    case 'date': return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}/.test(value) ? formatDate(value) : String(value);
    case 'boolean': return value ? 'Yes' : 'No';
    default: return String(value);
  }
}

export function csvEscape(v: unknown): string {
  const s = v === null || v === undefined ? '' : String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}
