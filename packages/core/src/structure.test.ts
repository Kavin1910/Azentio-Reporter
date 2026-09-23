import { describe, it, expect } from 'vitest';
import {
  detectHeaderRow, detectTextSplit, inferColumnType, normaliseKey, structureSheet,
  type RawCell,
} from './structure';

/** Mirrors loan_master_2024.xlsx: 3 title rows, a blank, then the header. */
function loanMasterSheet(): RawCell[][] {
  const rows: RawCell[][] = [
    ['AZENTIO BANK LIMITED'],
    ['Loan Master Register — Financial Year 2024-25'],
    ['Generated on 23-09-2026', '', '', 'CONFIDENTIAL'],
    [],
    ['Loan A/c No', 'Borrower Details', 'Branch Name', 'Product',
     'Sanction Amt (Rs.)', 'Disbursed Amt', 'Sanction Dt', 'ROI %', 'CIBIL'],
  ];

  const borrowers = [
    ['Aarti Gupta, 32, Chennai', 'Pune - Kothrud', 'Affordable Housing', 2550000, '23,60,000', '26-10-2025', 9.78, 773],
    ['Rekha Desai, 49, Mumbai', 'Bengaluru - Indiranagar', 'Vehicle Loan', '22,50,000', '₹ 22,50,000', '2025/08/05', 11.14, 774],
    ['Venkat Bhat, 42, Surat', 'Hyderabad - Gachibowli', 'Vehicle Loan', '₹ 23,80,000', '2380000.00', '13 May 2025', 12.33, 829],
    ['Divya Nair, 28, Kochi', 'Chennai - T Nagar', 'Personal Loan', 800000, 800000, '04-03-2025', 'N/A', 'NH'],
    ['Amit Joshi, 55, Indore', 'Jaipur - Malviya Nagar', 'Gold Loan', 150000, '1,50,000', '2025/01/19', 13.5, 690],
  ];
  borrowers.forEach((b, i) => rows.push([`LN10000${i}`, ...(b as RawCell[])]));

  rows.push([]);                                        // spacer
  rows.push(['TOTAL', '', '', '', 5850000, 5840000]);   // totals row
  return rows;
}

describe('normaliseKey', () => {
  it('maps known banking headers onto one canonical vocabulary', () => {
    expect(normaliseKey('Sanction Amt (Rs.)')).toBe('sanctioned_amount');
    expect(normaliseKey('Loan A/c No')).toBe('loan_account_no');
    expect(normaliseKey('acct_no')).toBe('loan_account_no');
    expect(normaliseKey('CUST_NM')).toBe('borrower_name');
    expect(normaliseKey('DOB')).toBe('date_of_birth');
    expect(normaliseKey('brnch')).toBe('branch');
    expect(normaliseKey('Branch Name')).toBe('branch');
    expect(normaliseKey('OS_AMT')).toBe('outstanding_amount');
  });

  it('falls back to a plain snake_case key for anything unknown', () => {
    expect(normaliseKey('Weird Custom Field!')).toBe('weird_custom_field');
  });
});

describe('detectHeaderRow', () => {
  it('skips title rows and finds the real header', () => {
    expect(detectHeaderRow(loanMasterSheet())).toBe(4);
  });

  it('returns row 0 when the file starts with its header', () => {
    const rows: RawCell[][] = [
      ['CUSTOMER_ID', 'CUST_NM', 'DOB', 'SCORE'],
      ['CUST50000', 'AARTI GUPTA', '16 May 1994', 773],
      ['CUST50001', 'REKHA DESAI', '19-05-1977', 774],
    ];
    expect(detectHeaderRow(rows)).toBe(0);
  });
});

describe('inferColumnType', () => {
  it('calls a mixed-format amount column currency', () => {
    const r = inferColumnType([2550000, '23,60,000', '₹ 22,50,000', '2380000.00'], 'Sanction Amt (Rs.)');
    expect(r.type).toBe('currency');
    expect(r.confidence).toBe(100);
  });

  it('calls a mixed-format date column a date, not a number', () => {
    // '2025' inside a date parses as a number; dates must win.
    const r = inferColumnType(['26-10-2025', '2025/08/05', '13 May 2025'], 'Sanction Dt');
    expect(r.type).toBe('date');
  });

  it('reports the values that do not fit, for the user to rule on', () => {
    const r = inferColumnType([773, 774, 829, 'NH', 690, 'NH'], 'CIBIL');
    expect(r.type).toBe('number');
    expect(r.confidence).toBeLessThan(100);
    expect(r.oddValues).toContain('NH');
  });

  it('flags a genuinely ambiguous date column', () => {
    const r = inferColumnType(['03/04/2024', '05/06/2024', '01/02/2024'], 'pay_dt');
    expect(r.type).toBe('date');
    expect(r.dateAmbiguous).toBe(true);
  });

  it('leaves free text as text', () => {
    const r = inferColumnType(['Salaried - IT', 'Business Owner', 'Retired'], 'Occupation');
    expect(r.type).toBe('text');
  });
});

describe('detectTextSplit', () => {
  it('proposes splitting a column that holds three facts', () => {
    const values = [
      'Aarti Gupta, 32, Chennai', 'Rekha Desai, 49, Mumbai', 'Venkat Bhat, 42, Surat',
      'Divya Nair, 28, Kochi', 'Amit Joshi, 55, Indore', 'Priya Rao, 39, Pune',
    ];
    const split = detectTextSplit(values, 'Borrower Details');
    expect(split).not.toBeNull();
    expect(split!.parts).toHaveLength(3);
    // The numeric part in human range is recognised as age, not 'part_2'.
    expect(split!.parts.map((p) => p.key)).toContain('age');
    expect(split!.separator).toBe(', ');
  });

  it('does not propose a split for ordinary text', () => {
    const values = ['Salaried - IT', 'Business Owner', 'Retired', 'Agriculturist', 'Salaried - IT', 'Retired'];
    expect(detectTextSplit(values, 'Occupation')).toBeNull();
  });
});

describe('structureSheet', () => {
  const result = structureSheet(loanMasterSheet());

  it('finds the header and drops everything above it', () => {
    expect(result.headerRowIndex).toBe(4);
    expect(result.excluded.filter((e) => e.reason === 'title')).toHaveLength(3);
  });

  it('drops the totals row so measures are not double-counted', () => {
    expect(result.excluded.some((e) => e.reason === 'totals')).toBe(true);
    expect(result.rows).toHaveLength(5);
  });

  it('drops blank spacer rows', () => {
    expect(result.excluded.some((e) => e.reason === 'blank')).toBe(true);
  });

  it('produces canonical column keys', () => {
    const keys = result.columns.map((c) => c.key);
    expect(keys).toContain('loan_account_no');
    expect(keys).toContain('sanctioned_amount');
    expect(keys).toContain('branch');
  });

  it('parses every amount format to the same number', () => {
    const amounts = result.rows.map((r) => r.data.sanctioned_amount);
    expect(amounts).toEqual([2550000, 2250000, 2380000, 800000, 150000]);
  });

  it('parses all three date formats to ISO', () => {
    const dates = result.rows.map((r) => r.data.sanction_date);
    expect(dates).toEqual(['2025-10-26', '2025-08-05', '2025-05-13', '2025-03-04', '2025-01-19']);
  });

  it('nulls out values that do not fit rather than inventing one', () => {
    // 'ROI %' canonicalises to interest_rate via the vocabulary.
    expect(result.rows[3]!.data.interest_rate).toBeNull();   // was 'N/A'
    expect(result.rows[3]!.data.cibil_score).toBeNull(); // was 'NH'
  });

  it('carries a split proposal for the free-text borrower column', () => {
    const borrower = result.columns.find((c) => c.sourceHeader === 'Borrower Details');
    expect(borrower?.split).toBeDefined();
    expect(borrower!.split!.parts.map((p) => p.key)).toContain('age');
  });

  it('explains what it did', () => {
    expect(result.notes.join(' ')).toMatch(/Header found on row 5/);
    expect(result.notes.join(' ')).toMatch(/totals\/subtotal row/);
  });
});

describe('structureSheet — two-row merged header', () => {
  const rows: RawCell[][] = [
    ['Branch Collection Summary'],
    [],
    ['Branch', 'Region', 'Disbursement', '', 'Collection', ''],
    ['', '', 'Accounts', 'Amount', 'Demand', 'Received'],
    ['Pune - Kothrud', 'West', 45, 137440000, 15118400, 13565278],
    ['Mumbai - Andheri', 'West', 45, 105150000, 11566500, 9351025],
    ['Pune - Hinjewadi', 'West', 46, 123970000, 13636700, 11649521],
    ['West Sub-total', '', 136, 366560000, '', ''],
    ['GRAND TOTAL', '', 420, 1200000000, '', ''],
  ];
  const result = structureSheet(rows);

  it('flattens the group header onto the leaf names', () => {
    expect(result.mergedHeader).toBe(true);
    const headers = result.columns.map((c) => c.sourceHeader);
    expect(headers).toContain('Disbursement Accounts');
    expect(headers).toContain('Disbursement Amount');
    expect(headers).toContain('Collection Received');
  });

  it('drops both the subtotal and the grand total', () => {
    expect(result.excluded.filter((e) => e.reason === 'totals')).toHaveLength(2);
    expect(result.rows).toHaveLength(3);
  });
});

describe('regressions found by running against the real files', () => {
  it('does not turn "Tenure (Months)" into a date', () => {
    // "month" once matched the date hint, so a duration of 6-360 was read as an
    // Excel serial and became a date column.
    const r = inferColumnType([240, 60, 36, 84, 120], 'Tenure (Months)');
    expect(r.type).toBe('number');
  });

  it('still treats a genuinely date-named numeric column as a date', () => {
    const r = inferColumnType([45000, 45100, 45200], 'Sanction Dt');
    expect(r.type).toBe('date');
  });

  it('does not format a count of accounts as currency', () => {
    // "Disbursement Accounts" matches the currency hint via "disburs" but holds
    // a count; ₹45 accounts is nonsense.
    const r = inferColumnType([45, 46, 38, 52], 'Disbursement Accounts');
    expect(r.type).toBe('number');
  });

  it('still calls a real amount column currency', () => {
    const r = inferColumnType([137440000, 105150000], 'Disbursement Amount');
    expect(r.type).toBe('currency');
  });

  it('detects a merged header written as repeated values, not gaps', () => {
    // A real .xlsx merge returns the master value for every cell in the span,
    // so the upper row has no gaps at all — only repeats.
    const rows: RawCell[][] = [
      ['Branch', 'Region', 'Disbursement', 'Disbursement', 'Collection', 'Collection'],
      ['', '', 'Accounts', 'Amount', 'Demand', 'Received'],
      ['Pune - Kothrud', 'West', 45, 137440000, 15118400, 13565278],
      ['Mumbai - Andheri', 'West', 45, 105150000, 11566500, 9351025],
    ];
    const r = structureSheet(rows);
    expect(r.mergedHeader).toBe(true);
    expect(r.columns.map((c) => c.sourceHeader)).toContain('Disbursement Amount');
    expect(r.rows).toHaveLength(2);
  });

  it('does not mistake an ordinary data row for a second header row', () => {
    const rows: RawCell[][] = [
      ['Branch', 'Region', 'Amount'],
      ['Pune', 'West', 137440000],
      ['Mumbai', 'West', 105150000],
    ];
    const r = structureSheet(rows);
    expect(r.mergedHeader).toBe(false);
    expect(r.rows).toHaveLength(2);
  });
});

describe('split part naming', () => {
  it('calls a capitalised place-name part "city" when the subject is a person', () => {
    const values = [
      'Aarti Gupta, 32, Chennai', 'Rekha Desai, 49, Mumbai', 'Venkat Bhat, 42, Surat',
      'Divya Nair, 28, Kochi', 'Amit Joshi, 55, Indore', 'Priya Rao, 39, Pune', 'Ravi Menon, 44, Thane',
    ];
    const split = detectTextSplit(values, 'Borrower Details');
    expect(split!.parts.map((p) => p.key)).toEqual(['borrower_name', 'age', 'city']);
  });

  it('does not invent a city for a non-person column', () => {
    const values = ['Alpha, 12, Red', 'Beta, 30, Blue', 'Gamma, 45, Green', 'Delta, 60, Black', 'Eps, 22, White', 'Zeta, 51, Grey'];
    const split = detectTextSplit(values, 'Item Details');
    expect(split!.parts.map((p) => p.key)).not.toContain('city');
  });
});
