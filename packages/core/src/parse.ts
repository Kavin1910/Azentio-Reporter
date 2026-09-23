/**
 * Value parsing for messy spreadsheet cells.
 *
 * Everything here is deterministic and unit-tested. The LLM is not involved in
 * reading a cell — it would be slower, costlier and less reliable than a regex
 * at deciding whether "₹ 18,00,000" is a number. The model's job is semantic
 * (what does this column MEAN), not lexical.
 */

/** Values that stand in for an empty cell in real exports. */
const NULLISH = new Set(['', '-', '--', 'n/a', 'na', 'null', 'nil', 'none', '#n/a']);

export function isNullish(value: unknown): boolean {
  if (value === null || value === undefined) return true;
  if (typeof value === 'string') return NULLISH.has(value.trim().toLowerCase());
  return false;
}

// ---------------------------------------------------------------------------
// Numbers
// ---------------------------------------------------------------------------

/**
 * Strips rupee symbols, thousands separators (Indian or Western grouping — both
 * use commas, so the same strip works) and stray whitespace.
 *
 * Returns null rather than NaN so callers must handle the failure explicitly.
 */
export function parseNumber(value: unknown): number | null {
  if (isNullish(value)) return null;
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value === 'boolean') return null;

  let s = String(value).trim();

  // Accounting negatives: (1,200) means -1200.
  let negative = false;
  if (/^\(.*\)$/.test(s)) { negative = true; s = s.slice(1, -1); }

  s = s.replace(/[₹$€£]/g, '')
       // The trailing \b must come before the optional dot, not after it: there
       // is no word boundary between "." and " ", so `\brs\.?\b` matched only
       // "rs" and left the dot behind, turning "Rs. 1,800" into 0.18.
       .replace(/\brs\b\.?/gi, '')
       .replace(/,/g, '')
       .replace(/\s/g, '');

  if (s.startsWith('-')) { negative = true; s = s.slice(1); }
  if (s.endsWith('%')) s = s.slice(0, -1);
  if (s === '' || !/^\d*\.?\d+$/.test(s)) return null;

  const n = Number(s);
  return Number.isFinite(n) ? (negative ? -n : n) : null;
}

/** True when the raw text carried a currency marker. */
export function looksLikeCurrency(value: unknown): boolean {
  return typeof value === 'string' && /[₹$€£]|\brs\.?\b/i.test(value);
}

// ---------------------------------------------------------------------------
// Dates
// ---------------------------------------------------------------------------

export type DateFormat =
  | 'dmy'        // 15-03-2024, 15/03/2024
  | 'mdy'        // 03/15/2024
  | 'ymd'        // 2024/03/15, 2024-03-15
  | 'text'       // 15 Mar 2024, Mar 15 2024
  | 'excel'      // numeric serial
  | 'unknown';

const MONTHS: Record<string, number> = {
  jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5,
  jul: 6, aug: 7, sep: 8, sept: 8, oct: 9, nov: 10, dec: 11,
};

/** Excel stores dates as days since 1899-12-30 (its leap-year bug included). */
const EXCEL_EPOCH = Date.UTC(1899, 11, 30);

function fromExcelSerial(n: number): Date | null {
  if (n < 1 || n > 80000) return null;   // outside ~1900–2119; not a date
  return new Date(EXCEL_EPOCH + Math.round(n) * 86400000);
}

function build(y: number, m: number, d: number): Date | null {
  if (y < 1900 || y > 2200 || m < 0 || m > 11 || d < 1 || d > 31) return null;
  const date = new Date(Date.UTC(y, m, d));
  // Rejects 31 Feb and friends, which Date would silently roll over.
  if (date.getUTCMonth() !== m || date.getUTCDate() !== d) return null;
  return date;
}

/**
 * Parses a date. `format` disambiguates dd/mm from mm/dd — without it, an
 * ambiguous value such as 03/04/2024 is resolved as dd/mm, which is the Indian
 * convention and the right default here. Where a whole column is ambiguous, the
 * caller should raise a customisation rather than rely on that default.
 */
export function parseDate(value: unknown, format: DateFormat = 'unknown'): Date | null {
  if (isNullish(value)) return null;
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value;

  if (typeof value === 'number') return fromExcelSerial(value);

  const s = String(value).trim();
  if (!s) return null;

  // 15 Mar 2024 / 15-Mar-2024 / Mar 15, 2024
  const textual = s.match(/^(\d{1,2})[\s-]+([a-z]{3,9})[\s-]+(\d{4})$/i);
  if (textual) {
    const m = MONTHS[textual[2]!.slice(0, 4).toLowerCase().replace(/[^a-z]/g, '')]
           ?? MONTHS[textual[2]!.slice(0, 3).toLowerCase()];
    if (m !== undefined) return build(Number(textual[3]), m, Number(textual[1]));
  }
  const textualAlt = s.match(/^([a-z]{3,9})[\s-]+(\d{1,2}),?[\s-]+(\d{4})$/i);
  if (textualAlt) {
    const m = MONTHS[textualAlt[1]!.slice(0, 3).toLowerCase()];
    if (m !== undefined) return build(Number(textualAlt[3]), m, Number(textualAlt[2]));
  }

  // Three numeric parts separated by - / or .
  const numeric = s.match(/^(\d{1,4})[-/.](\d{1,2})[-/.](\d{1,4})$/);
  if (numeric) {
    const a = Number(numeric[1]), b = Number(numeric[2]), c = Number(numeric[3]);

    // A four-digit leading part can only be a year.
    if (String(numeric[1]).length === 4) return build(a, b - 1, c);

    if (format === 'mdy') return build(c, a - 1, b);
    if (format === 'dmy') return build(c, b - 1, a);

    // Unknown format: let the values themselves decide where they can.
    if (a > 12) return build(c, b - 1, a);   // first part cannot be a month
    if (b > 12) return build(c, a - 1, b);   // second part cannot be a month
    return build(c, b - 1, a);               // genuinely ambiguous → dd/mm
  }

  // ISO with a time component.
  const iso = Date.parse(s);
  if (!Number.isNaN(iso) && /^\d{4}-\d{2}-\d{2}/.test(s)) return new Date(iso);

  return null;
}

/**
 * Works out which format a column uses, and whether the column is genuinely
 * ambiguous — meaning every value could be read either way. An ambiguous column
 * is a decision for the user, not for a default.
 */
export function detectDateFormat(values: unknown[]): { format: DateFormat; ambiguous: boolean; parseable: number } {
  let dmyEvidence = 0, mdyEvidence = 0, ymd = 0, text = 0, excel = 0, parseable = 0, numericTriples = 0;

  for (const v of values) {
    if (isNullish(v)) continue;

    if (typeof v === 'number') {
      if (fromExcelSerial(v)) { excel++; parseable++; }
      continue;
    }
    const s = String(v).trim();

    if (/^\d{1,2}[\s-]+[a-z]{3,9}[\s-]+\d{4}$/i.test(s) || /^[a-z]{3,9}[\s-]+\d{1,2},?[\s-]+\d{4}$/i.test(s)) {
      text++; parseable++; continue;
    }

    const m = s.match(/^(\d{1,4})[-/.](\d{1,2})[-/.](\d{1,4})$/);
    if (!m) continue;

    parseable++;
    if (String(m[1]).length === 4) { ymd++; continue; }

    numericTriples++;
    if (Number(m[1]) > 12) dmyEvidence++;        // decisive: first part is a day
    else if (Number(m[2]) > 12) mdyEvidence++;   // decisive: second part is a day
  }

  const counts: Array<[DateFormat, number]> = [
    ['ymd', ymd], ['text', text], ['excel', excel],
    ['dmy', dmyEvidence], ['mdy', mdyEvidence],
  ];
  counts.sort((x, y) => y[1] - x[1]);
  const top = counts[0]!;

  // Ambiguous only when there ARE numeric triples and nothing decided between
  // the two orderings — or when both orderings have evidence, which means the
  // column is genuinely mixed.
  const ambiguous =
    numericTriples > 0 &&
    ((dmyEvidence === 0 && mdyEvidence === 0) || (dmyEvidence > 0 && mdyEvidence > 0));

  return { format: top[1] === 0 ? 'unknown' : top[0], ambiguous, parseable };
}

// ---------------------------------------------------------------------------
// Booleans
// ---------------------------------------------------------------------------

const TRUTHY = new Set(['true', 'yes', 'y', '1']);
const FALSY = new Set(['false', 'no', 'n', '0']);

export function parseBoolean(value: unknown): boolean | null {
  if (isNullish(value)) return null;
  if (typeof value === 'boolean') return value;
  const s = String(value).trim().toLowerCase();
  if (TRUTHY.has(s)) return true;
  if (FALSY.has(s)) return false;
  return null;
}
