/**
 * Turns a raw sheet into a canonical schema.
 *
 * Everything here is heuristic and deterministic. It finds the real header row,
 * classifies junk rows, infers a type per column and parses the values. What it
 * deliberately does NOT do is decide anything semantic — whether "Sanction Amt
 * (Rs.)" means the same thing as "sanctioned_amount" is a judgement, and
 * judgements go to the Customisation Layer for a human to approve.
 */

import {
  detectDateFormat, isNullish, looksLikeCurrency, parseBoolean, parseDate, parseNumber,
  type DateFormat,
} from './parse';
import type { ColumnType, TextSplitProposal } from './types';

export type RawCell = string | number | boolean | null;
export type ExclusionReason = 'blank' | 'title' | 'totals' | 'repeated_header';

export interface ColumnInference {
  sourceIndex: number;
  sourceHeader: string;
  key: string;
  label: string;
  type: ColumnType;
  /** 0-100. How cleanly the sampled values fit the inferred type. */
  confidence: number;
  /** Values that do not fit the inferred type, deduped and capped. */
  oddValues: string[];
  dateFormat?: DateFormat;
  dateAmbiguous?: boolean;
  nullCount: number;
  samples: unknown[];
  /** True when the canonical key is materially different from the file's header. */
  renamed: boolean;
  split?: TextSplitProposal;
}

export interface StructureResult {
  headerRowIndex: number;
  /** True when the header spanned two rows and was flattened. */
  mergedHeader: boolean;
  excluded: Array<{ rowIndex: number; reason: ExclusionReason }>;
  columns: ColumnInference[];
  rows: Array<{ rowIndex: number; data: Record<string, unknown> }>;
  notes: string[];
}

// ---------------------------------------------------------------------------
// Canonical vocabulary
//
// Deterministic synonyms for headers seen constantly in Indian retail lending
// exports. Handling these in code rather than through the model keeps the
// common path fast, free and identical on every run; anything not listed here
// falls through to a normalised key and, where it matters, to the model.
// ---------------------------------------------------------------------------
const SYNONYMS: Record<string, string> = {
  // identifiers
  'loan_a_c_no': 'loan_account_no', 'loan_ac_no': 'loan_account_no',
  'acct_no': 'loan_account_no', 'acct_number': 'loan_account_no',
  'account_no': 'loan_account_no', 'loan_no': 'loan_account_no',
  'cust_id': 'customer_id', 'customer_no': 'customer_id',
  // people
  'cust_nm': 'borrower_name', 'customer_name': 'borrower_name',
  'borrower': 'borrower_name', 'name': 'borrower_name',
  'dob': 'date_of_birth', 'birth_date': 'date_of_birth', 'date_of_birth': 'date_of_birth',
  // place
  'branch_name': 'branch', 'brnch': 'branch', 'br_name': 'branch',
  // money
  'sanction_amt_rs': 'sanctioned_amount', 'sanction_amt': 'sanctioned_amount',
  'sanctioned_amt': 'sanctioned_amount', 'sanction_amount': 'sanctioned_amount',
  'disbursed_amt': 'disbursed_amount', 'disb_amt': 'disbursed_amount',
  'amt_recd': 'amount_paid', 'amount_received': 'amount_paid', 'collected': 'amount_paid',
  'emi_due': 'emi_amount', 'emi': 'emi_amount', 'instalment': 'emi_amount',
  'os_amt': 'outstanding_amount', 'outstanding': 'outstanding_amount',
  'os_balance': 'outstanding_amount', 'overdue_amount': 'outstanding_amount',
  'monthly_income': 'monthly_income', 'income': 'monthly_income',
  'existing_emi': 'existing_emi',
  // dates
  'sanction_dt': 'sanction_date', 'disb_date': 'disbursed_on',
  'disbursement_date': 'disbursed_on', 'disbursed_date': 'disbursed_on',
  'pay_dt': 'payment_date', 'payment_dt': 'payment_date',
  'last_review_dt': 'as_of_date', 'as_on': 'as_of_date',
  // risk
  'cibil': 'cibil_score', 'score': 'cibil_score', 'bureau_score': 'cibil_score',
  'dpd': 'dpd', 'days_past_due': 'dpd',
  'asset_class': 'asset_classification',
  // terms
  'roi': 'interest_rate', 'roi_pct': 'interest_rate', 'rate_of_interest': 'interest_rate',
  'tenure_months': 'tenure_months', 'tenure': 'tenure_months',
};

/** Header text -> snake_case identifier. */
export function normaliseKey(header: string): string {
  const base = header
    .trim().toLowerCase()
    .replace(/[%₹$]/g, '_pct_')
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .replace(/_+/g, '_');

  // 'roi_pct_' -> 'roi_pct', and the vocabulary lookup below.
  const trimmed = base.replace(/_pct_$/, '_pct').replace(/^_+|_+$/g, '');
  return SYNONYMS[trimmed] ?? trimmed ?? 'column';
}

/** A readable label, preferring the file's own wording where it is presentable. */
export function humanLabel(header: string, key: string): string {
  const cleaned = header.trim().replace(/\s+/g, ' ');
  if (cleaned && cleaned.length <= 40 && /[a-z]/i.test(cleaned) && !/^[A-Z_]+$/.test(cleaned)) {
    return cleaned;
  }
  return key.split('_').map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
}

// ---------------------------------------------------------------------------
// Row classification
// ---------------------------------------------------------------------------

const isBlankRow = (cells: RawCell[]) => cells.every(isNullish);

function nonEmptyCount(cells: RawCell[]): number {
  return cells.filter((c) => !isNullish(c)).length;
}

function looksLikeTotals(cells: RawCell[]): boolean {
  return cells.some(
    (c) => typeof c === 'string' && /^\s*(grand\s+)?(sub-?)?total\b/i.test(c),
  ) || cells.some((c) => typeof c === 'string' && /sub-?total\s*$/i.test(c.trim()));
}

/**
 * Finds the header row.
 *
 * Scores each of the first rows on how header-like it is — many non-empty
 * cells, all short text, no numbers, all distinct — then requires that the rows
 * beneath it are at least as wide. A title row like "AZENTIO BANK LIMITED"
 * scores badly on width; a data row scores badly on "no numbers".
 */
export function detectHeaderRow(rows: RawCell[][], scanDepth = 20): number {
  let best = 0;
  let bestScore = -Infinity;

  const limit = Math.min(scanDepth, rows.length);
  const maxWidth = Math.max(...rows.slice(0, limit).map(nonEmptyCount), 1);

  for (let i = 0; i < limit; i++) {
    const cells = rows[i]!;
    const filled = cells.filter((c) => !isNullish(c));
    if (filled.length < 2) continue;

    const strings = filled.filter((c) => typeof c === 'string' && c.trim().length <= 40);
    const numbers = filled.filter((c) => typeof c === 'number' || parseNumber(c) !== null);
    const distinct = new Set(filled.map((c) => String(c).trim().toLowerCase())).size;

    // Width relative to the widest row seen; a title row is narrow.
    const widthScore = filled.length / maxWidth;
    const textScore = strings.length / filled.length;
    const distinctScore = distinct / filled.length;
    const numericPenalty = numbers.length / filled.length;

    // Rows below should be at least as wide as a real header.
    const below = rows.slice(i + 1, i + 6).filter((r) => !isBlankRow(r));
    const belowWidth = below.length
      ? below.reduce((s, r) => s + nonEmptyCount(r), 0) / below.length / maxWidth
      : 0;

    const score =
      widthScore * 3 + textScore * 2 + distinctScore * 1.5 + belowWidth * 2 - numericPenalty * 4;

    if (score > bestScore) { bestScore = score; best = i; }
  }

  return best;
}

/**
 * Flattens a two-row header.
 *
 * Merged group cells ("Disbursement" spanning two columns) leave gaps in the
 * upper row and leaf names ("Accounts", "Amount") in the lower one. Detected by
 * the lower row being wider than the upper while still being all text.
 */
function mergeHeaderRows(upper: RawCell[], lower: RawCell[]): { headers: string[]; merged: boolean } {
  const lowerPresent = lower.filter((c) => !isNullish(c));

  const lowerIsText = lowerPresent.length > 0 && lowerPresent
    .every((c) => typeof c === 'string' && c.trim().length <= 40 && parseNumber(c) === null);

  // The tell is not width — a merged header often has the same number of filled
  // cells as the row beneath it. It is that the lower row supplies names exactly
  // where the upper row has holes, because a merged cell only stores its value
  // in the first column of its span.
  const width = Math.max(upper.length, lower.length);

  // A group header shows up in one of two ways depending on who wrote the file.
  //
  //  (a) gaps — the exporter left the spanned cells empty:
  //        ['Disbursement', '',       'Collection', '']
  //  (b) repeats — a genuine Excel merge, which returns the master value for
  //      every cell in the range:
  //        ['Disbursement', 'Disbursement', 'Collection', 'Collection']
  //
  // Only (a) was handled at first, so real .xlsx merges slipped through and the
  // leaf-name row was parsed as data.
  let fillsGaps = 0;
  for (let i = 0; i < width; i++) {
    if (isNullish(upper[i] ?? null) && !isNullish(lower[i] ?? null)) fillsGaps++;
  }

  let repeatedAdjacent = 0;
  for (let i = 1; i < width; i++) {
    const a = upper[i - 1], b = upper[i];
    if (!isNullish(a) && !isNullish(b) && String(a).trim() === String(b).trim()) repeatedAdjacent++;
  }

  const groupShaped = fillsGaps > 0 || repeatedAdjacent > 0;

  if (!lowerIsText || !groupShaped || lowerPresent.length < 2) {
    return { headers: upper.map((c) => String(c ?? '').trim()), merged: false };
  }

  const headers: string[] = [];
  let carried = '';

  for (let i = 0; i < width; i++) {
    const top = String(upper[i] ?? '').trim();
    const bottom = String(lower[i] ?? '').trim();
    // In the gap form the value appears once and must be carried across the
    // span; in the repeat form it is already present on every cell.
    if (top) carried = top;
    const group = top || carried;
    headers.push(
      [group, bottom].filter(Boolean).join(' ').trim() || `column_${i + 1}`,
    );
  }

  return { headers, merged: true };
}

// ---------------------------------------------------------------------------
// Type inference
// ---------------------------------------------------------------------------

const CURRENCY_HINT = /(amt|amount|rs|inr|value|balance|principal|emi|income|outstanding|sanction|disburs|collect|provision|exposure)/i;

/**
 * Overrides CURRENCY_HINT. "Disbursement Accounts" contains "disburs" but holds
 * a count of 45, and formatting it as ₹45 is plainly wrong. A counting word
 * wins over a money word.
 */
const COUNT_HINT = /(accounts?|count|number|no_of|nos?\b|qty|quantity|units?|cases?|days?|months?|years?|tenure|age|score|rate|pct|percent|ratio|dpd)/i;

/**
 * Share of values that must fit for a type to win. Set below the point where a
 * column is "clean" on purpose: a column that is 70% dates and 30% junk is a
 * date column with a problem, and calling it text would hide that problem
 * instead of raising it. Anything under CLEAN_CONFIDENCE becomes a
 * type_conflict customisation for the user to rule on.
 */
const TYPE_MAJORITY = 0.65;
export const CLEAN_CONFIDENCE = 95;

/**
 * Header wording that licenses reading a bare number as an Excel date serial.
 *
 * Deliberately narrow. An earlier version matched "month", which turned
 * "Tenure (Months)" — a duration of 6 to 360 — into a date column. A word has
 * to name a date, not merely a unit of time.
 */
const DATE_HINT = /(^|[^a-z])(date|dt|dob)([^a-z]|$)|birth|as_of|as_on/i;

export function inferColumnType(
  values: RawCell[],
  header: string,
): Pick<ColumnInference, 'type' | 'confidence' | 'oddValues' | 'dateFormat' | 'dateAmbiguous'> {
  const present = values.filter((v) => !isNullish(v));
  if (present.length === 0) {
    return { type: 'text', confidence: 0, oddValues: [] };
  }

  const dateInfo = detectDateFormat(present);

  // Excel stores dates as plain numbers, so any integer can be read as one:
  // a CIBIL score of 773 "is" 1902-02-11. Only treat bare numbers as dates when
  // the column gives a reason to — a date-ish header, or at least one value
  // written as text in a date format. Without this guard, score, DPD, tenure
  // and income columns all silently become dates.
  const textualDateHits = present.filter(
    (v) => typeof v !== 'number' && parseDate(v, dateInfo.format) !== null,
  ).length;
  const numericDateHits = present.filter(
    (v) => typeof v === 'number' && parseDate(v) !== null,
  ).length;

  // The licence applies to the NUMERIC values specifically. A CIBIL column of
  // [773, 774, 'NH'] is not "all numeric", but its numbers still must not be
  // read as serials just because one cell holds text.
  const serialsAllowed = DATE_HINT.test(header) || textualDateHits > 0;
  const dateHits = textualDateHits + (serialsAllowed ? numericDateHits : 0);
  const numberHits = present.filter((v) => parseNumber(v) !== null).length;
  const boolHits = present.filter((v) => parseBoolean(v) !== null).length;

  const dateRatio = dateHits / present.length;
  const numberRatio = numberHits / present.length;
  const boolRatio = boolHits / present.length;

  const odd = (test: (v: RawCell) => boolean) =>
    [...new Set(present.filter((v) => !test(v)).map((v) => String(v).trim()))].slice(0, 8);

  // Dates first: "2025" parses as a number too, so a date-shaped column must
  // not be stolen by the numeric test.
  if (dateRatio >= TYPE_MAJORITY && dateRatio >= numberRatio) {
    return {
      type: 'date',
      confidence: Math.round(dateRatio * 100),
      oddValues: odd((v) => parseDate(v, dateInfo.format) !== null),
      dateFormat: dateInfo.format,
      dateAmbiguous: dateInfo.ambiguous,
    };
  }

  const distinct = new Set(present.map((v) => String(v).trim().toLowerCase()));
  if (boolRatio >= 0.95 && distinct.size <= 3) {
    return {
      type: 'boolean',
      confidence: Math.round(boolRatio * 100),
      oddValues: odd((v) => parseBoolean(v) !== null),
    };
  }

  if (numberRatio >= TYPE_MAJORITY) {
    // An explicit ₹ in the data outranks any header wording; otherwise a
    // counting word vetoes the currency hint.
    const currency = present.some(looksLikeCurrency)
      || (CURRENCY_HINT.test(header) && !COUNT_HINT.test(header));
    return {
      type: currency ? 'currency' : 'number',
      confidence: Math.round(numberRatio * 100),
      oddValues: odd((v) => parseNumber(v) !== null),
    };
  }

  return { type: 'text', confidence: 100, oddValues: [] };
}

/** Parses one cell into the column's inferred type. */
export function coerce(value: RawCell, type: ColumnType, dateFormat?: DateFormat): unknown {
  if (isNullish(value)) return null;
  switch (type) {
    case 'date': {
      const d = parseDate(value, dateFormat ?? 'unknown');
      return d ? d.toISOString().slice(0, 10) : null;
    }
    case 'number':
    case 'currency':
      return parseNumber(value);
    case 'boolean':
      return parseBoolean(value);
    default:
      return String(value).trim();
  }
}

// ---------------------------------------------------------------------------
// Free-text splitting
// ---------------------------------------------------------------------------

const SPLIT_SEPARATORS = [', ', ' | ', ';', ' - '];

/**
 * Detects a column holding several facts in one cell, e.g.
 * "Rajesh Kumar, 34, Pune". Requires a consistent part count across most rows,
 * because a single comma in a free-text note is not a schema.
 */
export function detectTextSplit(values: RawCell[], header: string): TextSplitProposal | null {
  const present = values.filter((v) => typeof v === 'string' && v.trim().length > 0) as string[];
  if (present.length < 5) return null;

  for (const sep of SPLIT_SEPARATORS) {
    const counts = present.map((v) => v.split(sep).length);
    const parts = counts[0]!;
    if (parts < 2 || parts > 5) continue;

    const consistent = counts.filter((c) => c === parts).length / counts.length;
    if (consistent < 0.85) continue;

    const columns: RawCell[][] = Array.from({ length: parts }, () => []);
    for (const v of present) {
      const bits = v.split(sep);
      if (bits.length !== parts) continue;
      bits.forEach((b, i) => columns[i]!.push(b.trim()));
    }

    const base = normaliseKey(header).replace(/_details?$/, '');
    const built = columns.map((col, i) => {
      const { type } = inferColumnType(col, '');
      // Name the parts from what they contain rather than by position.
      const isAge = type === 'number' && col.every((c) => { const n = parseNumber(c); return n !== null && n > 0 && n < 120; });
      // Short, capitalised single tokens with many distinct values read as place
      // names: "Pune", "Chennai", "Indore". Only claimed when a person is the
      // subject of the column, so an unrelated split does not invent a city.
      const looksLikeCity =
        type === 'text' && i > 0 && (base.includes('borrower') || base.includes('customer')) &&
        col.every((c) => typeof c === 'string' && /^[A-Z][A-Za-z.\- ]{1,24}$/.test(c) && c.split(' ').length <= 2) &&
        new Set(col.map((c) => String(c))).size >= Math.min(5, col.length);
      const key =
        isAge ? 'age'
          : type === 'date' ? `${base}_date`
          : i === 0 ? (base.includes('borrower') || base.includes('customer') ? 'borrower_name' : `${base}_1`)
          : looksLikeCity ? 'city'
          : `${base}_${i + 1}`;
      return { key, label: humanLabel(key, key), type };
    });

    // A split that produces nothing but text fragments is not worth proposing.
    if (built.every((b) => b.type === 'text') && parts === 2) continue;

    return {
      column: normaliseKey(header),
      parts: built,
      separator: sep,
      examples: present.slice(0, 3).map((v) => v.split(sep).map((x) => x.trim())),
    };
  }

  return null;
}

// ---------------------------------------------------------------------------
// The whole sheet
// ---------------------------------------------------------------------------

export function structureSheet(rawRows: RawCell[][]): StructureResult {
  const notes: string[] = [];
  const excluded: StructureResult['excluded'] = [];

  if (rawRows.length === 0) {
    return { headerRowIndex: 0, mergedHeader: false, excluded, columns: [], rows: [], notes: ['Empty sheet.'] };
  }

  const headerRowIndex = detectHeaderRow(rawRows);
  const { headers, merged } = mergeHeaderRows(
    rawRows[headerRowIndex] ?? [],
    rawRows[headerRowIndex + 1] ?? [],
  );
  const firstDataRow = headerRowIndex + (merged ? 2 : 1);

  if (headerRowIndex > 0) {
    for (let i = 0; i < headerRowIndex; i++) {
      excluded.push({ rowIndex: i, reason: isBlankRow(rawRows[i]!) ? 'blank' : 'title' });
    }
    notes.push(`Header found on row ${headerRowIndex + 1}; ${headerRowIndex} row(s) above it discarded.`);
  }
  if (merged) notes.push('Header spans two rows (merged group cells); flattened into single names.');

  const headerSignature = headers.map((h) => h.trim().toLowerCase()).join('|');

  const dataRows: Array<{ rowIndex: number; cells: RawCell[] }> = [];
  for (let i = firstDataRow; i < rawRows.length; i++) {
    const cells = rawRows[i]!;
    if (isBlankRow(cells)) { excluded.push({ rowIndex: i, reason: 'blank' }); continue; }
    if (looksLikeTotals(cells)) { excluded.push({ rowIndex: i, reason: 'totals' }); continue; }
    if (cells.map((c) => String(c ?? '').trim().toLowerCase()).join('|') === headerSignature) {
      excluded.push({ rowIndex: i, reason: 'repeated_header' }); continue;
    }
    dataRows.push({ rowIndex: i, cells });
  }

  const blanks = excluded.filter((e) => e.reason === 'blank').length;
  const totals = excluded.filter((e) => e.reason === 'totals').length;
  if (blanks) notes.push(`${blanks} blank row(s) removed.`);
  if (totals) notes.push(`${totals} totals/subtotal row(s) removed — they would double-count every measure.`);

  // ---- columns -----------------------------------------------------------
  const width = Math.max(headers.length, ...dataRows.slice(0, 50).map((r) => r.cells.length));
  const columns: ColumnInference[] = [];
  const usedKeys = new Set<string>();

  for (let c = 0; c < width; c++) {
    const header = (headers[c] ?? '').trim() || `column_${c + 1}`;
    const values = dataRows.map((r) => r.cells[c] ?? null);
    // An entirely empty column is an artefact of a merged cell, not a field.
    if (values.every(isNullish) && !headers[c]) continue;

    const inferred = inferColumnType(values, header);

    let key = normaliseKey(header);
    if (usedKeys.has(key)) key = `${key}_${c + 1}`;
    usedKeys.add(key);

    const samples = values.filter((v) => !isNullish(v)).slice(0, 5);

    columns.push({
      sourceIndex: c,
      sourceHeader: header,
      key,
      label: humanLabel(header, key),
      ...inferred,
      nullCount: values.filter(isNullish).length,
      samples,
      renamed: key !== normaliseKey(header) ? true : normaliseKey(header) !== header.trim().toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, ''),
      split: inferred.type === 'text' ? (detectTextSplit(values, header) ?? undefined) : undefined,
    });
  }

  // ---- rows --------------------------------------------------------------
  const rows = dataRows.map(({ rowIndex, cells }) => {
    const data: Record<string, unknown> = {};
    for (const col of columns) {
      data[col.key] = coerce(cells[col.sourceIndex] ?? null, col.type, col.dateFormat);
    }
    return { rowIndex, data };
  });

  return { headerRowIndex, mergedHeader: merged, excluded, columns, rows, notes };
}
