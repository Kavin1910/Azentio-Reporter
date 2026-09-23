import { describe, it, expect } from 'vitest';
import { structureSheet, type RawCell } from './structure';
import { autoMap } from './mapper';
import { buildReport, applyFilters, resolveMapping } from './report';
import type { Customisation, DatasetColumn, DatasetRow, ReportTemplate, TemplateField } from './types';

/* ------------------------------------------------------------ fixtures */

const sheet: RawCell[][] = [
  ['AZENTIO BANK LIMITED'],
  [],
  ['Loan A/c No', 'Borrower Details', 'Branch Name', 'Product', 'Sanction Amt (Rs.)', 'Disbursed Amt', 'Disb. Date', 'CIBIL', 'DOB'],
  ['LN1', 'Aarti Gupta, 32, Chennai',  'Pune - Kothrud',   'Home Loan', 2550000, '23,60,000',  '26-01-2025', 773,  '16-05-1994'],
  ['LN2', 'Rekha Desai, 49, Mumbai',   'Mumbai - Andheri', 'Home Loan', '22,50,000', '₹ 22,50,000', '05-02-2025', 774, '19-05-1977'],
  ['LN3', 'Venkat Bhat, 42, Surat',    'Pune - Kothrud',   'Gold Loan', 150000,  '1,50,000',   '13-05-2025', 'NH', '27-10-1984'],
  ['LN4', 'Divya Nair, 28, Kochi',     'Chennai - T Nagar','Personal Loan', 800000, 800000,    '04-03-2025', 690,  '10-03-1998'],
  ['LN5', 'Amit Joshi, 55, Indore',    'Mumbai - Andheri', 'Gold Loan', 200000,  200000,       '19-06-2025', 812,  '12-05-1971'],
  ['TOTAL', '', '', '', 5950000, 5960000],
];

const f = (key: string, type: TemplateField['type'], role: TemplateField['role'], extra: Partial<TemplateField> = {}): TemplateField =>
  ({ key, label: key.replace(/_/g, ' '), type, role, required: true, ...extra });

const template: ReportTemplate = {
  id: 't1', code: 'DISBURSEMENT', name: 'Disbursement Report', description: '', category: 'Ops', icon: null,
  position: 1, active: true, created_at: '',
  fields: [
    f('disbursed_on', 'date', 'date'),
    f('branch', 'text', 'dimension'),
    f('product', 'text', 'dimension', { required: false }),
    f('sanctioned_amount', 'currency', 'measure', { aggregation: 'sum' }),
    f('disbursed_amount', 'currency', 'measure', { aggregation: 'sum' }),
    f('loan_count', 'number', 'measure', { aggregation: 'count', required: false, derivable: true }),
    f('age', 'number', 'measure', { aggregation: 'avg', required: false, derivable: true }),
  ],
};

/** Build the dataset the way the Structure action would persist it. */
function persist() {
  const r = structureSheet(sheet);

  // Totals rows are kept as data with a pending exclusion — the contract is
  // that they leave the report only once someone approves that.
  const totalsRow = sheet.findIndex((row) => row[0] === 'TOTAL');
  const totalsCells = sheet[totalsRow]!;
  const totalsData: Record<string, unknown> = {};
  for (const c of r.columns) totalsData[c.key] = totalsCells[c.sourceIndex] ?? null;

  const columns: DatasetColumn[] = r.columns.map((c, i) => ({
    id: `c${i}`, dataset_id: 'ds', key: c.key, label: c.label, data_type: c.type,
    source_header: c.sourceHeader, source_index: c.sourceIndex, is_derived: false, formula: null,
    sample_values: c.samples, null_count: c.nullCount, position: i, created_at: '',
  }));

  const rows: DatasetRow[] = [
    ...r.rows.map((row, i) => ({ id: i, dataset_id: 'ds', row_index: row.rowIndex, data: row.data })),
    { id: 99, dataset_id: 'ds', row_index: totalsRow, data: totalsData },
  ];

  const rawByIndex = new Map(sheet.map((cells, i) => [i, cells]));
  return { r, columns, rows, rawByIndex, totalsRow };
}

let seq = 0;
function cust(partial: Partial<Customisation> & Pick<Customisation, 'kind' | 'target_key' | 'proposal'>): Customisation {
  return {
    id: `cu${++seq}`, dataset_id: 'ds', mapping_id: null, override: null, confidence: null,
    affected_rows: 0, rationale: 'test', status: 'pending', created_at: '', decided_at: null, decided_by: null,
    ...partial,
  };
}

/* --------------------------------------------------------------- tests */

describe('the approval contract', () => {
  const { columns, rows, rawByIndex, totalsRow } = persist();
  const exclusion = cust({
    kind: 'row_exclusion', target_key: '__rows__',
    proposal: { row_indexes: [totalsRow], reason: 'totals' },
  });
  const branchMap = cust({
    kind: 'field_mapping', target_key: 'branch', mapping_id: 'm1', status: 'approved',
    proposal: { field: 'branch', column: 'branch' },
  });
  const sanctionedMap = cust({
    kind: 'field_mapping', target_key: 'sanctioned_amount', mapping_id: 'm1', status: 'approved',
    proposal: { field: 'sanctioned_amount', column: 'sanctioned_amount' },
  });

  it('does NOT apply a pending row exclusion, and says so', () => {
    const report = buildReport(
      { template, columns, rows, rawByIndex, customisations: [exclusion, branchMap, sanctionedMap], filters: {} },
      'm1',
    );
    expect(report.rowCount).toBe(6);                    // the TOTAL row is still in
    expect(report.pendingCount).toBe(1);
    expect(report.warnings.join(' ')).toMatch(/1 customisation still pending/);
  });

  it('applies the same exclusion once approved', () => {
    const report = buildReport(
      { template, columns, rows, rawByIndex,
        customisations: [{ ...exclusion, status: 'approved' }, branchMap, sanctionedMap], filters: {} },
      'm1',
    );
    expect(report.rowCount).toBe(5);
    expect(report.pendingCount).toBe(0);
  });

  it('ignores a pending field mapping — the field simply is not there', () => {
    const report = buildReport(
      { template, columns, rows, rawByIndex,
        customisations: [{ ...branchMap, status: 'pending' }, sanctionedMap], filters: {} },
      'm1',
    );
    expect(report.groups.find((g) => g.dimension === 'branch')).toBeUndefined();
    expect(report.warnings.join(' ')).toMatch(/Required fields not mapped: .*branch/);
  });

  it('honours a rejected parse by re-reading the original text', () => {
    // The user says "don't null out NH, keep the column as text".
    const conflict = cust({
      kind: 'type_conflict', target_key: 'cibil_score', status: 'rejected',
      proposal: { column: 'cibil_score', majority_type: 'number', odd_values: ['NH'], action: 'null_out' },
    });
    const report = buildReport(
      { template: { ...template, fields: [...template.fields, f('cibil_score', 'text', 'dimension', { required: false })] },
        columns, rows, rawByIndex,
        customisations: [
          { ...exclusion, status: 'approved' }, branchMap, sanctionedMap, conflict,
          cust({ kind: 'field_mapping', target_key: 'cibil_score', mapping_id: 'm1', status: 'approved',
                 proposal: { field: 'cibil_score', column: 'cibil_score' } }),
        ],
        filters: {} },
      'm1',
    );
    const values = report.table.rows.map((r) => r.cibil_score);
    expect(values).toContain('NH');              // raw text preserved
    expect(values).toContain('773');             // and the numbers are text now too
  });
});

describe('a full run: structure → auto-map → approve → report', () => {
  const { columns, rows, rawByIndex, totalsRow } = persist();
  const mapped = autoMap(template.fields, columns);

  const customisations: Customisation[] = [
    cust({ kind: 'row_exclusion', target_key: '__rows__', status: 'approved',
           proposal: { row_indexes: [totalsRow], reason: 'totals' } }),
    ...mapped.mapped.map((m) => cust({
      kind: 'field_mapping', target_key: m.field.key, mapping_id: 'm1',
      status: m.confidence === 100 ? 'approved' : 'pending',
      confidence: m.confidence,
      proposal: { field: m.field.key, column: m.column },
    })),
    ...mapped.derived.map((d) => cust({
      kind: 'derived_field', target_key: d.field.key, mapping_id: 'm1', status: 'approved',
      proposal: { field: d.field.key, formula: d.recipe.formula, inputs: d.inputs, result_type: d.recipe.resultType },
    })),
  ];

  const report = buildReport(
    { template, columns, rows, rawByIndex, customisations, filters: {}, now: new Date('2026-09-23') },
    'm1',
  );

  it('maps every exact field and derives age from DOB', () => {
    expect(mapped.mapped.map((m) => m.field.key).sort())
      .toEqual(['branch', 'disbursed_amount', 'disbursed_on', 'product', 'sanctioned_amount']);
    expect(mapped.derived.map((d) => d.field.key)).toEqual(['age']);
    expect(mapped.implicit.map((x) => x.key)).toEqual(['loan_count']);
  });

  it('parses every amount format into one total', () => {
    const tile = report.tiles.find((t) => t.key === 'sanctioned_amount');
    expect(tile?.value).toBe(2550000 + 2250000 + 150000 + 800000 + 200000);
    expect(tile?.format).toBe('currency');
  });

  it('groups by branch, sorted by the primary measure', () => {
    const g = report.groups.find((x) => x.dimension === 'branch')!;
    expect(g.rows[0]!.key).toBe('Pune - Kothrud');          // 25.5L + 1.5L = 27L, ahead of Mumbai's 24.5L
    expect(g.rows[0]!.count).toBe(2);
    expect(g.totalGroups).toBe(3);
  });

  it('computes age per row from date_of_birth', () => {
    const ages = report.table.rows.map((r) => r.age);
    expect(ages).toEqual([32, 49, 41, 28, 55]);
  });

  it('emits a bar and a pie chart with currency flagged', () => {
    expect(report.charts.map((c) => c.type)).toEqual(['bar', 'pie']);
    expect(report.charts[0]!.is_currency).toBe(true);
    expect(report.charts[0]!.labels.length).toBe(report.charts[0]!.values.length);
  });

  it('narrows to a date range', () => {
    const q1 = buildReport(
      { template, columns, rows, rawByIndex, customisations,
        filters: { date_column: 'disbursed_on', from: '2025-01-01', to: '2025-03-31' } },
      'm1',
    );
    expect(q1.rowCount).toBe(3);      // Jan, Feb, Mar
    expect(q1.tiles[0]!.hint).toMatch(/of 5 after filters/);
  });

  it('applies a where filter', () => {
    const rows2 = applyFilters(
      [{ product: 'Gold Loan', x: 1 }, { product: 'Home Loan', x: 2 }],
      { where: [{ column: 'product', op: 'eq', value: 'gold loan' }] },
    );
    expect(rows2).toHaveLength(1);
  });

  it('a pending fuzzy mapping is listed as missing, not silently used', () => {
    const resolved = resolveMapping(template, columns,
      customisations.map((c) => (c.kind === 'field_mapping' ? { ...c, status: 'pending' as const } : c)), 'm1');
    expect(resolved.missingRequired).toContain('branch');
  });
});

describe('dimension choice for groups and charts', () => {
  const { columns, rows, rawByIndex } = persist();
  const tpl: ReportTemplate = {
    ...template,
    fields: [
      f('loan_account_no', 'text', 'dimension'),          // one per row — an identifier
      f('branch', 'text', 'dimension'),                    // 3 distinct
      f('product', 'text', 'dimension', { required: false }), // 3 distinct
      f('sanctioned_amount', 'currency', 'measure', { aggregation: 'sum' }),
    ],
  };
  const cs: Customisation[] = ['loan_account_no', 'branch', 'product', 'sanctioned_amount'].map((k) =>
    cust({ kind: 'field_mapping', target_key: k, mapping_id: 'm1', status: 'approved', proposal: { field: k, column: k } }));
  const report = buildReport({ template: tpl, columns, rows, rawByIndex, customisations: cs, filters: {} }, 'm1');

  it('never charts by an identifier — one bar per record is not a chart', () => {
    expect(report.groups.map((g) => g.dimension)).not.toContain('loan_account_no');
    expect(report.charts[0]!.title).not.toMatch(/Loan Account/i);
  });

  it('groups by the lowest-cardinality dimension first', () => {
    expect(report.groups[0]!.dimension).toMatch(/^(branch|product)$/);
  });

  it('keeps the identifier in the detail table', () => {
    expect(report.table.columns.map((c) => c.key)).toContain('loan_account_no');
  });

  it('labels the distinct-count tile as distinct, not as a plural', () => {
    const tile = report.tiles.find((t) => t.key.startsWith('distinct_'));
    expect(tile?.label).toMatch(/^Distinct /);
  });
});
