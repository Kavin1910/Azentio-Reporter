/**
 * Generates the mock source files.
 *
 * These are deliberately messy — title rows, merged headers, three date
 * formats, numbers stored as text, free-text columns holding several facts,
 * totals rows, and the same concept named differently in each file. A clean
 * spreadsheet would make the Structure button look like it does nothing.
 *
 *   pnpm --filter @azentio/mockdata generate
 */

import ExcelJS from 'exceljs';
import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  ASSET_CLASSES, BRANCHES, CITIES, FIRST_NAMES, GENDER_VARIANTS,
  LAST_NAMES, NULLISH, OCCUPATIONS, PRODUCTS,
} from './fixtures';

const OUT = resolve(process.cwd(), '../../mock-data');

// ---------------------------------------------------------------- randomness
let seed = 20260923;
function rnd(): number {
  seed |= 0; seed = (seed + 0x6d2b79f5) | 0;
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}
const pick = <T,>(xs: readonly T[]): T => xs[Math.floor(rnd() * xs.length)]!;
const between = (lo: number, hi: number) => Math.floor(rnd() * (hi - lo + 1)) + lo;
const chance = (p: number) => rnd() < p;

// ------------------------------------------------------------- date formats
const MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
const pad = (n: number) => String(n).padStart(2, '0');

/** Three renderings of the same date, rotated per row so one column holds all three. */
function formatDate(d: Date, style: number): string {
  const dd = pad(d.getDate()), mm = pad(d.getMonth() + 1), yyyy = d.getFullYear();
  switch (style % 3) {
    case 0: return `${dd}-${mm}-${yyyy}`;              // 15-03-2024
    case 1: return `${yyyy}/${mm}/${dd}`;              // 2024/03/15
    default: return `${d.getDate()} ${MONTHS[d.getMonth()]} ${yyyy}`;  // 15 Mar 2024
  }
}

function randomDate(startYear = 2024, endYear = 2025): Date {
  const start = new Date(startYear, 0, 1).getTime();
  const end = new Date(endYear, 11, 31).getTime();
  return new Date(start + rnd() * (end - start));
}

/** Rupee amounts written the way a human or a legacy export would write them. */
function formatAmount(n: number, style: number): string | number {
  switch (style % 4) {
    case 0: return n;                                            // a real number
    case 1: return n.toLocaleString('en-IN');                    // "18,00,000"
    case 2: return `₹ ${n.toLocaleString('en-IN')}`;             // "₹ 18,00,000"
    default: return `${n.toFixed(2)}`;                           // "1800000.00"
  }
}

function person(): { name: string; gender: string } {
  const first = pick(FIRST_NAMES);
  return {
    name: `${first.name} ${pick(LAST_NAMES)}`,
    // Spelling varies per row; the value itself matches the name.
    gender: pick(GENDER_VARIANTS[first.gender]),
  };
}

interface Loan {
  acct: string; customerId: string; name: string; age: number; city: string;
  dob: Date; gender: string; occupation: string;
  branch: string; region: string; product: string;
  sanctioned: number; disbursed: number;
  sanctionDate: Date; disbDate: Date;
  rate: number; tenure: number; cibil: number;
  income: number; existingEmi: number;
  outstanding: number; dpd: number; assetClass: string;
}

function buildLoans(count: number): Loan[] {
  const loans: Loan[] = [];
  for (let i = 0; i < count; i++) {
    const product = pick(PRODUCTS);
    const branch = pick(BRANCHES);
    const sanctioned = Math.round(between(product.min, product.max) / 10000) * 10000;
    // Disbursement is usually the full sanction, occasionally less.
    const disbursed = chance(0.78) ? sanctioned : Math.round(sanctioned * (0.6 + rnd() * 0.35) / 10000) * 10000;
    const sanctionDate = randomDate();
    const disbDate = new Date(sanctionDate.getTime() + between(1, 45) * 86400000);
    const age = between(23, 64);
    const dob = new Date(2026 - age, between(0, 11), between(1, 28));
    // Most accounts are current; a minority carry real delinquency.
    const dpd = chance(0.72) ? 0 : chance(0.5) ? between(1, 30) : chance(0.6) ? between(31, 90) : between(91, 400);

    const who = person();

    loans.push({
      acct: `LN${String(100000 + i)}`,
      customerId: `CUST${String(50000 + i)}`,
      name: who.name,
      age, dob,
      city: pick(CITIES),
      gender: who.gender,
      occupation: pick(OCCUPATIONS),
      branch: branch.name, region: branch.region,
      product: product.name,
      sanctioned, disbursed,
      sanctionDate, disbDate,
      rate: Number((product.rateMin + rnd() * (product.rateMax - product.rateMin)).toFixed(2)),
      tenure: pick(product.tenures),
      cibil: chance(0.06) ? -1 : between(540, 860),   // -1 = no bureau history
      income: Math.round(between(22000, 350000) / 1000) * 1000,
      existingEmi: chance(0.45) ? Math.round(between(2000, 60000) / 500) * 500 : 0,
      outstanding: Math.round(disbursed * (0.35 + rnd() * 0.6) / 1000) * 1000,
      dpd,
      assetClass: dpd === 0 ? 'Standard'
        : dpd <= 90 ? 'Standard'
        : dpd <= 180 ? 'Sub-Standard'
        : dpd <= 365 ? 'Doubtful' : 'Loss',
    });
  }
  return loans;
}

// ===========================================================================
// 1. loan_master_2024.xlsx — title rows, free-text borrower column, totals row
// ===========================================================================
async function loanMaster(loans: Loan[]) {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Loan Register');

  // Three junk rows above the real header, as a core-banking export produces.
  ws.addRow(['AZENTIO BANK LIMITED']);
  ws.addRow(['Loan Master Register — Financial Year 2024-25']);
  ws.addRow([`Generated on ${formatDate(new Date(), 0)}`, '', '', 'CONFIDENTIAL']);
  ws.addRow([]);

  ws.addRow([
    'Loan A/c No', 'Borrower Details', 'Branch Name', 'Product',
    'Sanction Amt (Rs.)', 'Disbursed Amt', 'Sanction Dt', 'Disb. Date',
    'ROI %', 'Tenure (Months)', 'CIBIL', 'Monthly Income', 'Existing EMI', 'Occupation',
  ]);
  ws.getRow(5).font = { bold: true };

  loans.forEach((l, i) => {
    // Blank spacer rows, as if the file were paginated.
    if (i > 0 && i % 60 === 0) ws.addRow([]);

    ws.addRow([
      l.acct,
      // Three facts crammed into one cell — needs splitting.
      `${l.name}, ${l.age}, ${l.city}`,
      l.branch,
      l.product,
      formatAmount(l.sanctioned, i),
      chance(0.04) ? pick(NULLISH) : formatAmount(l.disbursed, i + 1),
      formatDate(l.sanctionDate, i),
      formatDate(l.disbDate, i + 1),
      chance(0.03) ? pick(NULLISH) : l.rate,
      l.tenure,
      l.cibil === -1 ? 'NH' : l.cibil,          // bureau's no-history marker
      formatAmount(l.income, i + 2),
      l.existingEmi === 0 ? pick(['0', '-', '']) : formatAmount(l.existingEmi, i),
      l.occupation,
    ]);
  });

  // A totals row that must not be treated as data.
  ws.addRow([]);
  ws.addRow([
    'TOTAL', '', '', '',
    loans.reduce((s, l) => s + l.sanctioned, 0),
    loans.reduce((s, l) => s + l.disbursed, 0),
  ]);
  ws.getRow(ws.rowCount).font = { bold: true };

  ws.columns.forEach((c) => { c.width = 20; });
  await wb.xlsx.writeFile(resolve(OUT, 'loan_master_2024.xlsx'));
  return ws.rowCount;
}

// ===========================================================================
// 2. repayments_q1.csv — different names for the same things, US date order
// ===========================================================================
async function repayments(loans: Loan[]) {
  const rows: string[] = ['acct_no,pay_dt,amt_recd,emi_due,brnch,mode,receipt_no'];

  let n = 0;
  for (const l of loans) {
    const installments = between(1, 4);
    for (let k = 0; k < installments; k++) {
      const d = new Date(l.disbDate.getTime() + (k + 1) * 30 * 86400000);
      if (d > new Date(2025, 11, 31)) break;

      const emi = Math.round(
        (l.disbursed * (l.rate / 1200) * Math.pow(1 + l.rate / 1200, l.tenure)) /
        (Math.pow(1 + l.rate / 1200, l.tenure) - 1),
      );
      // Part payments and misses, as really happens.
      const paid = l.dpd > 60 && chance(0.5) ? 0 : chance(0.12) ? Math.round(emi * 0.5) : emi;

      // mm/dd/yyyy — ambiguous against the dd-mm-yyyy used in the master file.
      const payDt = `${pad(d.getMonth() + 1)}/${pad(d.getDate())}/${d.getFullYear()}`;

      rows.push([
        l.acct,
        payDt,
        // Numbers stored as text, some with a thousands separator.
        chance(0.3) ? `"${paid.toLocaleString('en-IN')}"` : String(paid),
        String(emi),
        `"${l.branch}"`,
        pick(['NEFT', 'UPI', 'Cash', 'Cheque', 'Auto Debit', 'ACH']),
        `RCP${600000 + n}`,
      ].join(','));
      n++;
    }
  }

  const { writeFileSync } = await import('node:fs');
  writeFileSync(resolve(OUT, 'repayments_q1.csv'), rows.join('\n'), 'utf8');
  return rows.length - 1;
}

// ===========================================================================
// 3. branch_collections.xlsx — two-row merged header, regional subtotals
// ===========================================================================
async function branchCollections(loans: Loan[]) {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Branch Summary');

  ws.addRow(['Branch Collection Summary']);
  ws.addRow([]);

  // Two-row header with merged group cells above the leaf columns.
  ws.addRow(['Branch', 'Region', 'Disbursement', '', 'Collection', '', 'Overdue']);
  ws.addRow(['', '', 'Accounts', 'Amount', 'Demand', 'Received', 'Amount']);
  ws.mergeCells('C3:D3');
  ws.mergeCells('E3:F3');
  ws.getRow(3).font = { bold: true };
  ws.getRow(4).font = { bold: true };

  const byRegion = new Map<string, Loan[]>();
  for (const l of loans) {
    if (!byRegion.has(l.region)) byRegion.set(l.region, []);
    byRegion.get(l.region)!.push(l);
  }

  for (const [region, regionLoans] of byRegion) {
    const byBranch = new Map<string, Loan[]>();
    for (const l of regionLoans) {
      if (!byBranch.has(l.branch)) byBranch.set(l.branch, []);
      byBranch.get(l.branch)!.push(l);
    }

    for (const [branch, bl] of byBranch) {
      const disbursed = bl.reduce((s, l) => s + l.disbursed, 0);
      const overdue = bl.filter((l) => l.dpd > 0).reduce((s, l) => s + l.outstanding, 0);
      ws.addRow([
        branch, region, bl.length,
        disbursed,
        Math.round(disbursed * 0.11),
        Math.round(disbursed * 0.11 * (0.72 + rnd() * 0.26)),
        overdue,
      ]);
    }

    // Subtotal rows interleaved with data — classic spreadsheet, hostile to parsing.
    const sub = ws.addRow([
      `${region} Sub-total`, '', regionLoans.length,
      regionLoans.reduce((s, l) => s + l.disbursed, 0), '', '', '',
    ]);
    sub.font = { bold: true, italic: true };
  }

  const total = ws.addRow([
    'GRAND TOTAL', '', loans.length,
    loans.reduce((s, l) => s + l.disbursed, 0), '', '', '',
  ]);
  total.font = { bold: true };

  ws.columns.forEach((c) => { c.width = 24; });
  await wb.xlsx.writeFile(resolve(OUT, 'branch_collections.xlsx'));
  return ws.rowCount;
}

// ===========================================================================
// 4. bureau_extract.xlsx — UPPER_SNAKE headers, mixed DOB formats, mixed gender
// ===========================================================================
async function bureauExtract(loans: Loan[]) {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Bureau');

  ws.addRow([
    'CUSTOMER_ID', 'ACCT_NUMBER', 'CUST_NM', 'DOB', 'GENDER',
    'SCORE', 'DPD', 'OS_AMT', 'ASSET_CLASS', 'LAST_REVIEW_DT',
  ]);
  ws.getRow(1).font = { bold: true };

  loans.forEach((l, i) => {
    ws.addRow([
      l.customerId,
      l.acct,
      l.name.toUpperCase(),                      // different casing to the master file
      formatDate(l.dob, i + 2),                  // all three date styles again
      l.gender,                                  // M / Male / m / MALE …
      l.cibil === -1 ? pick(['NH', 'NA', '-1']) : l.cibil,
      l.dpd === 0 ? pick(['0', '', '-']) : l.dpd,
      formatAmount(l.outstanding, i),
      l.assetClass,
      formatDate(new Date(2025, 11, 31), i),
    ]);
  });

  ws.columns.forEach((c) => { c.width = 18; });
  await wb.xlsx.writeFile(resolve(OUT, 'bureau_extract.xlsx'));
  return ws.rowCount - 1;
}

// ===========================================================================
async function main() {
  mkdirSync(OUT, { recursive: true });
  const loans = buildLoans(420);

  const a = await loanMaster(loans);
  const b = await repayments(loans);
  const c = await branchCollections(loans);
  const d = await bureauExtract(loans);

  console.log(`\nMock files written to mock-data/\n`);
  console.log(`  loan_master_2024.xlsx    ${a} rows   title rows, free-text borrower column, 3 date formats, totals row`);
  console.log(`  repayments_q1.csv        ${b} rows   different column names, mm/dd/yyyy dates, numbers as text`);
  console.log(`  branch_collections.xlsx  ${c} rows   two-row merged header, regional subtotals, grand total`);
  console.log(`  bureau_extract.xlsx      ${d} rows   UPPER_SNAKE headers, mixed DOB formats, 8 spellings of gender\n`);
}

main().catch((e) => { console.error(e); process.exit(1); });
