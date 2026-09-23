import { describe, it, expect } from 'vitest';
import { autoMap, scoreCandidate, MAP_ACCEPT } from './mapper';
import type { DatasetColumn, TemplateField } from './types';

const col = (key: string, data_type: DatasetColumn['data_type'], source_header = key): DatasetColumn => ({
  id: key, dataset_id: 'd', key, label: key.replace(/_/g, ' '), data_type,
  source_header, source_index: 0, is_derived: false, formula: null,
  sample_values: [], null_count: 0, position: 0, created_at: '',
});

const field = (key: string, type: TemplateField['type'], extra: Partial<TemplateField> = {}): TemplateField => ({
  key, label: key.replace(/_/g, ' '), type, role: type === 'date' ? 'date' : type === 'text' ? 'dimension' : 'measure',
  required: true, ...extra,
});

const columns = [
  col('loan_account_no', 'text', 'Loan A/c No'),
  col('borrower_details', 'text', 'Borrower Details'),
  col('branch', 'text', 'Branch Name'),
  col('product', 'text'),
  col('sanctioned_amount', 'currency', 'Sanction Amt (Rs.)'),
  col('disbursed_amount', 'currency', 'Disbursed Amt'),
  col('sanction_date', 'date', 'Sanction Dt'),
  col('disbursed_on', 'date', 'Disb. Date'),
  col('interest_rate', 'number', 'ROI %'),
  col('tenure_months', 'number', 'Tenure (Months)'),
  col('cibil_score', 'number', 'CIBIL'),
  col('monthly_income', 'currency'),
  col('existing_emi', 'currency'),
  col('date_of_birth', 'date', 'DOB'),
];

describe('scoreCandidate', () => {
  it('gives an exact key 100', () => {
    expect(scoreCandidate(field('branch', 'text'), col('branch', 'text')).confidence).toBe(100);
  });

  it('scores a related name with matching type well above the acceptance bar', () => {
    const s = scoreCandidate(field('disbursed_amount', 'currency'), col('disbursement_amount', 'currency'));
    expect(s.confidence).toBeGreaterThanOrEqual(MAP_ACCEPT);
    expect(s.confidence).toBeLessThan(100);
  });

  it('penalises a type clash even when the name is close', () => {
    const good = scoreCandidate(field('disbursed_on', 'date'), col('disbursed_date', 'date'));
    const bad = scoreCandidate(field('disbursed_on', 'date'), col('disbursed_amount', 'currency'));
    expect(good.confidence).toBeGreaterThan(bad.confidence + 20);
  });

  it('does not let a shared stop-word like "amount" carry a match', () => {
    const s = scoreCandidate(field('provision_amount', 'currency'), col('sanctioned_amount', 'currency'));
    expect(s.confidence).toBeLessThan(MAP_ACCEPT);
  });
});

describe('scoreCandidate — hard clashes', () => {
  it('never proposes a date field from a currency column, however similar the labels', () => {
    // Seen on the branch collections file: "Disbursement Date" ← disbursement_amount at 66%.
    const f = { ...field('disbursed_on', 'date'), label: 'Disbursement Date' };
    const c = { ...col('disbursement_amount', 'currency', 'Disbursement Amount'), label: 'Disbursement Amount' };
    expect(scoreCandidate(f, c).confidence).toBeLessThan(MAP_ACCEPT);
  });

  it('does not feed a money field from a count column', () => {
    const f = { ...field('disbursed_amount', 'currency', { aggregation: 'sum' }), label: 'Disbursed' };
    const c = { ...col('disbursement_accounts', 'number', 'Disbursement Accounts'), label: 'Disbursement Accounts' };
    expect(scoreCandidate(f, c).confidence).toBeLessThan(MAP_ACCEPT);
  });

  it('still accepts a currency column for a currency field with a related name', () => {
    const f = { ...field('disbursed_amount', 'currency', { aggregation: 'sum' }), label: 'Disbursed' };
    const c = { ...col('disbursement_amount', 'currency', 'Disbursement Amount'), label: 'Disbursement Amount' };
    expect(scoreCandidate(f, c).confidence).toBeGreaterThanOrEqual(MAP_ACCEPT);
  });
});

describe('autoMap', () => {
  const fields: TemplateField[] = [
    field('disbursed_on', 'date'),
    field('branch', 'text'),
    field('product', 'text'),
    field('sanctioned_amount', 'currency', { aggregation: 'sum' }),
    field('disbursed_amount', 'currency', { aggregation: 'sum' }),
    field('loan_count', 'number', { aggregation: 'count', derivable: true, required: false }),
    field('age', 'number', { derivable: true }),
    field('foir', 'number', { derivable: true }),
    field('customer_segment', 'text', { required: false }),
  ];
  const r = autoMap(fields, columns);

  it('maps exact keys at full confidence', () => {
    const exact = r.mapped.filter((m) => m.confidence === 100).map((m) => m.field.key).sort();
    expect(exact).toEqual(['branch', 'disbursed_amount', 'disbursed_on', 'product', 'sanctioned_amount']);
  });

  it('satisfies a count field without any column', () => {
    expect(r.implicit.map((f) => f.key)).toEqual(['loan_count']);
  });

  it('derives age from date_of_birth rather than failing', () => {
    const age = r.derived.find((d) => d.field.key === 'age');
    expect(age).toBeDefined();
    expect(age!.recipe.formula).toMatch(/YEARS_BETWEEN\(date_of_birth/);
  });

  it('derives foir through the emi_amount chain', () => {
    expect(r.derived.some((d) => d.field.key === 'foir')).toBe(true);
  });

  it('leaves a field with no plausible column unmapped, with candidates for the user', () => {
    const u = r.unmapped.find((x) => x.field.key === 'customer_segment');
    expect(u).toBeDefined();
    expect(u!.candidates.every((c) => c.confidence < MAP_ACCEPT)).toBe(true);
  });

  it('never assigns one column to two fields', () => {
    const used = r.mapped.map((m) => m.column);
    expect(new Set(used).size).toBe(used.length);
  });

  it('lets an exact match keep its column ahead of a fuzzy competitor', () => {
    // "disbursed_amount" (fuzzy for sanctioned?) must not steal sanctioned_amount's column.
    const sanctioned = r.mapped.find((m) => m.field.key === 'sanctioned_amount');
    expect(sanctioned?.column).toBe('sanctioned_amount');
  });
});
