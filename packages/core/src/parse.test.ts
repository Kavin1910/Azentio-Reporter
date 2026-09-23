import { describe, it, expect } from 'vitest';
import {
  isNullish, parseNumber, looksLikeCurrency, parseDate, detectDateFormat, parseBoolean,
} from './parse';

const iso = (d: Date | null) => (d ? d.toISOString().slice(0, 10) : null);

describe('isNullish', () => {
  it('recognises the placeholders real exports use instead of empty cells', () => {
    for (const v of ['', ' ', '-', '--', 'N/A', 'n/a', 'NA', 'NULL', 'nil', '#N/A', null, undefined]) {
      expect(isNullish(v)).toBe(true);
    }
  });

  it('does not treat zero or false as missing', () => {
    // A zero EMI is a fact, not an absence.
    expect(isNullish(0)).toBe(false);
    expect(isNullish(false)).toBe(false);
    expect(isNullish('0')).toBe(false);
  });
});

describe('parseNumber', () => {
  it('reads every amount format in the source files', () => {
    expect(parseNumber(2550000)).toBe(2550000);          // real number
    expect(parseNumber('23,60,000')).toBe(2360000);      // Indian grouping
    expect(parseNumber('₹ 22,50,000')).toBe(2250000);    // rupee symbol
    expect(parseNumber('2380000.00')).toBe(2380000);     // number as text
    expect(parseNumber('Rs. 1,800')).toBe(1800);
    expect(parseNumber('1,800.50')).toBe(1800.5);        // Western grouping
  });

  it('handles accounting negatives and percentages', () => {
    expect(parseNumber('(1,200)')).toBe(-1200);
    expect(parseNumber('-450')).toBe(-450);
    expect(parseNumber('9.78%')).toBe(9.78);
  });

  it('returns null rather than NaN so callers must handle failure', () => {
    expect(parseNumber('N/A')).toBeNull();
    expect(parseNumber('NH')).toBeNull();     // bureau's no-history marker
    expect(parseNumber('Standard')).toBeNull();
    expect(parseNumber('')).toBeNull();
    expect(parseNumber(true)).toBeNull();
  });
});

describe('looksLikeCurrency', () => {
  it('detects a currency marker in the raw text', () => {
    expect(looksLikeCurrency('₹ 18,00,000')).toBe(true);
    expect(looksLikeCurrency('Rs. 5000')).toBe(true);
    expect(looksLikeCurrency('1800000')).toBe(false);
    expect(looksLikeCurrency(1800000)).toBe(false);
  });
});

describe('parseDate', () => {
  it('reads all three formats the loan master mixes in one column', () => {
    expect(iso(parseDate('26-10-2025'))).toBe('2025-10-26');
    expect(iso(parseDate('2025/12/04'))).toBe('2025-12-04');
    expect(iso(parseDate('11 Aug 2025'))).toBe('2025-08-11');
  });

  it('respects an explicit format when the value alone is ambiguous', () => {
    // The repayments CSV is mm/dd/yyyy; the master file is dd-mm-yyyy.
    expect(iso(parseDate('09/10/2025', 'mdy'))).toBe('2025-09-10');
    expect(iso(parseDate('09/10/2025', 'dmy'))).toBe('2025-10-09');
  });

  it('lets an out-of-range component settle the order by itself', () => {
    expect(iso(parseDate('25/03/2024'))).toBe('2024-03-25');  // 25 cannot be a month
    expect(iso(parseDate('03/25/2024'))).toBe('2024-03-25');  // nor in second place
  });

  it('defaults an ambiguous value to dd/mm, the Indian convention', () => {
    expect(iso(parseDate('03/04/2024'))).toBe('2024-04-03');
  });

  it('reads Excel serial numbers', () => {
    // 45000 = 2023-03-15 under Excel's 1899-12-30 epoch.
    expect(iso(parseDate(45000))).toBe('2023-03-15');
  });

  it('rejects impossible dates instead of rolling them over', () => {
    // Date() would silently turn 31 Feb into 3 March.
    expect(parseDate('31-02-2024')).toBeNull();
    expect(parseDate('45-13-2024')).toBeNull();
  });

  it('returns null for text that is not a date', () => {
    expect(parseDate('Standard')).toBeNull();
    expect(parseDate('N/A')).toBeNull();
    expect(parseDate(0)).toBeNull();
  });
});

describe('detectDateFormat', () => {
  it('detects dd-mm-yyyy from a value whose first part exceeds 12', () => {
    const r = detectDateFormat(['26-10-2025', '04-03-2025', '15-06-2025']);
    expect(r.format).toBe('dmy');
    expect(r.ambiguous).toBe(false);
  });

  it('detects mm/dd/yyyy from a value whose second part exceeds 12', () => {
    const r = detectDateFormat(['09/10/2025', '07/14/2025', '08/13/2025']);
    expect(r.format).toBe('mdy');
    expect(r.ambiguous).toBe(false);
  });

  it('flags a column as ambiguous when nothing decides the order', () => {
    // Every part <= 12, so dd/mm and mm/dd are equally consistent. This must
    // become a decision for the user, not a silent default.
    const r = detectDateFormat(['03/04/2024', '05/06/2024', '01/02/2024']);
    expect(r.ambiguous).toBe(true);
  });

  it('flags a column as ambiguous when both orderings have evidence', () => {
    // A genuinely mixed column — worse than undecidable, actively inconsistent.
    const r = detectDateFormat(['26-10-2025', '07/14/2025']);
    expect(r.ambiguous).toBe(true);
  });

  it('does not call a yyyy-first column ambiguous', () => {
    const r = detectDateFormat(['2025/12/04', '2025/01/02', '2024/06/06']);
    expect(r.format).toBe('ymd');
    expect(r.ambiguous).toBe(false);
  });

  it('counts how many values parsed at all', () => {
    const r = detectDateFormat(['26-10-2025', 'N/A', 'Standard', '15-06-2025']);
    expect(r.parseable).toBe(2);
  });
});

describe('parseBoolean', () => {
  it('reads the usual spellings', () => {
    expect(parseBoolean('Yes')).toBe(true);
    expect(parseBoolean('N')).toBe(false);
    expect(parseBoolean(true)).toBe(true);
    expect(parseBoolean('maybe')).toBeNull();
  });
});
