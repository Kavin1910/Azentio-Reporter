import { describe, it, expect } from 'vitest';
import { buildMessages, buildSchemaBlock, SYSTEM_PROMPT } from './prompt';
import { executeTool, TOOL_DEFINITIONS, type DatasetContext } from './tools';
import type { DatasetColumn } from '@azentio/core';

const col = (key: string, data_type: DatasetColumn['data_type']): DatasetColumn => ({
  id: key, dataset_id: 'd', key, label: key, data_type, source_header: key, source_index: 0,
  is_derived: false, formula: null, sample_values: [], null_count: 0, position: 0, created_at: '',
});

const ctx: DatasetContext = {
  datasetName: 'Loan master',
  columns: [col('branch', 'text'), col('sanctioned_amount', 'currency'), col('dpd', 'number'), col('disbursed_on', 'date')],
  rows: [
    { branch: 'Pune', sanctioned_amount: 2500000, dpd: 0, disbursed_on: '2025-01-10' },
    { branch: 'Pune', sanctioned_amount: 500000, dpd: 95, disbursed_on: '2025-02-10' },
    { branch: 'Mumbai', sanctioned_amount: 2000000, dpd: 12, disbursed_on: '2025-03-10' },
  ],
};

describe('prompt', () => {
  it('cached system block first, schema after, nothing volatile in the cache', () => {
    const m = buildMessages(buildSchemaBlock('x', ctx.columns, 3), [{ role: 'user', content: 'hi' }]);
    expect(m[0]).toMatchObject({ role: 'system', cache: true });
    expect((m[1] as any).cache).toBeFalsy();
    expect(SYSTEM_PROMPT).not.toMatch(/\d{4}-\d{2}/);
  });

  it('forbids answering outside the dataset', () => {
    expect(SYSTEM_PROMPT).toMatch(/answer only from the dataset/i);
    expect(SYSTEM_PROMPT).toMatch(/can only answer questions about the loaded data/i);
  });

  it('exposes exactly four dataset-scoped tools and nothing general', () => {
    expect(TOOL_DEFINITIONS.map((t) => t.name).sort())
      .toEqual(['describe_dataset', 'find_rows', 'make_chart', 'query_dataset']);
  });
});

describe('tools', () => {
  it('aggregates by group with Indian currency formatting', async () => {
    const r = JSON.parse((await executeTool('query_dataset',
      JSON.stringify({ group_by: 'branch', measure: 'sanctioned_amount', aggregation: 'sum' }), ctx)).output);
    expect(r.groups[0]).toMatchObject({ branch: 'Pune', value: '₹30,00,000 (₹30 L)', rows: 2 });
  });

  it('returns an overall figure when group_by is omitted', async () => {
    const r = JSON.parse((await executeTool('query_dataset',
      JSON.stringify({ aggregation: 'count' }), ctx)).output);
    expect(r.value).toBe(3);
  });

  it('filters rows and finds the delinquent account', async () => {
    const r = JSON.parse((await executeTool('find_rows',
      JSON.stringify({ where: [{ column: 'dpd', op: 'gt', value: '90' }] }), ctx)).output);
    expect(r.matched).toBe(1);
    expect(r.rows[0].dpd).toBe(95);
  });

  it('respects a date range', async () => {
    const r = JSON.parse((await executeTool('query_dataset',
      JSON.stringify({ aggregation: 'count', date_range: { column: 'disbursed_on', from: '2025-02-01', to: '2025-12-31' } }), ctx)).output);
    expect(r.value).toBe(2);
  });

  it('produces a chart spec and strips it from the model-facing output', async () => {
    const out = await executeTool('make_chart',
      JSON.stringify({ type: 'pie', title: 'Share by branch', group_by: 'branch', measure: 'sanctioned_amount', aggregation: 'sum' }), ctx);
    expect(out.chart).toMatchObject({ type: 'pie', labels: ['Pune', 'Mumbai'], values: [3000000, 2000000], is_currency: true });
    expect(out.output).not.toContain('__chart');
  });

  it('refuses an unknown column with the list of real ones', async () => {
    const r = JSON.parse((await executeTool('query_dataset',
      JSON.stringify({ group_by: 'region', aggregation: 'count' }), ctx)).output);
    expect(r.error).toMatch(/No column "region"/);
    expect(r.error).toContain('branch');
  });

  it('never throws on bad input', async () => {
    const r = JSON.parse((await executeTool('query_dataset', '{not json', ctx)).output);
    expect(r.error).toBeTruthy();
    const u = JSON.parse((await executeTool('nope', '{}', ctx)).output);
    expect(u.error).toMatch(/Unknown tool/);
  });
});
