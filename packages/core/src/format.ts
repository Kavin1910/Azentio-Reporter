/**
 * Indian number, currency and date formatting.
 *
 * Indian digit grouping is 2-2-3, not 3-3-3: ₹18,00,000 — not ₹1,800,000.
 * `en-IN` gets this right; a hand-rolled formatter almost never does.
 */

const INR = new Intl.NumberFormat('en-IN', {
  style: 'currency',
  currency: 'INR',
  maximumFractionDigits: 0,
});

const INR_PRECISE = new Intl.NumberFormat('en-IN', {
  style: 'currency',
  currency: 'INR',
  maximumFractionDigits: 2,
});

export function formatINR(amount: number): string {
  return INR.format(amount);
}

export function formatINRPrecise(amount: number): string {
  return INR_PRECISE.format(amount);
}

/**
 * Lakh/crore shorthand, as an Indian borrower would read it.
 * 1,00,000 = 1 lakh. 1,00,00,000 = 1 crore.
 */
export function formatLakhCrore(amount: number): string {
  if (amount >= 1_00_00_000) {
    const cr = amount / 1_00_00_000;
    return `₹${trimZeros(cr)} Cr`;
  }
  if (amount >= 1_00_000) {
    const lakh = amount / 1_00_000;
    return `₹${trimZeros(lakh)} L`;
  }
  return formatINR(amount);
}

function trimZeros(n: number): string {
  return n.toFixed(2).replace(/\.00$/, '').replace(/(\.\d)0$/, '$1');
}

export function formatPercent(value: number, digits = 1): string {
  return `${value.toFixed(digits)}%`;
}

export function formatDate(iso: string | Date | null | undefined): string {
  if (!iso) return '—';
  const d = typeof iso === 'string' ? new Date(iso) : iso;
  return new Intl.DateTimeFormat('en-IN', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  }).format(d);
}

export function formatDateTime(iso: string | Date | null | undefined): string {
  if (!iso) return '—';
  const d = typeof iso === 'string' ? new Date(iso) : iso;
  return new Intl.DateTimeFormat('en-IN', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(d);
}
