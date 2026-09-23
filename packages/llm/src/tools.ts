/**
 * Chatbot tools — every one of them scoped to a single loaded dataset.
 *
 * The assistant can answer only from the data because these are the only
 * capabilities it has. There is no web tool, no general-knowledge tool, and no
 * way to reach a second dataset. Ask it about the weather and it has nothing to
 * call; the system prompt tells it to say so.
 */

import {
  applyFilters, groupBy, formatINR, formatLakhCrore,
  type Aggregation, type ChartSpec, type DatasetColumn, type ReportFilters,
} from '@azentio/core';
import type { ToolDefinition } from './provider';

export interface DatasetContext {
  datasetName: string;
  columns: DatasetColumn[];
  /** Rows after approved customisations — the chat sees what the report sees. */
  rows: Array<Record<string, unknown>>;
}

export interface ToolHandler {
  definition: ToolDefinition;
  run: (args: Record<string, any>, ctx: DatasetContext) => Promise<unknown>;
}

const AGGS: Aggregation[] = ['sum', 'avg', 'count', 'min', 'max'];

const whereSchema = {
  type: 'array',
  description: 'Optional row filters, all must match.',
  items: {
    type: 'object',
    properties: {
      column: { type: 'string' },
      op: { type: 'string', enum: ['eq', 'neq', 'gt', 'lt', 'contains'] },
      value: { type: 'string' },
    },
    required: ['column', 'op', 'value'],
    additionalProperties: false,
  },
};

const dateRangeSchema = {
  type: 'object',
  description: 'Optional date range on a date column (ISO yyyy-mm-dd).',
  properties: {
    column: { type: 'string' },
    from: { type: 'string' },
    to: { type: 'string' },
  },
  required: ['column'],
  additionalProperties: false,
};

function toFilters(args: Record<string, any>): ReportFilters {
  const f: ReportFilters = {};
  if (args.date_range?.column) {
    f.date_column = args.date_range.column;
    if (args.date_range.from) f.from = args.date_range.from;
    if (args.date_range.to) f.to = args.date_range.to;
  }
  if (Array.isArray(args.where)) f.where = args.where;
  return f;
}

function requireColumn(ctx: DatasetContext, key: string | undefined, what: string): DatasetColumn {
  if (!key) throw new Error(`${what} is required.`);
  const col = ctx.columns.find((c) => c.key === key);
  if (!col) {
    throw new Error(`No column "${key}". Available: ${ctx.columns.map((c) => c.key).join(', ')}`);
  }
  return col;
}

const fmt = (v: number | null, currency: boolean) =>
  v === null ? null : currency ? `${formatINR(v)} (${formatLakhCrore(v)})` : Math.round(v * 100) / 100;

// ---------------------------------------------------------------------------

const describeDataset: ToolHandler = {
  definition: {
    name: 'describe_dataset',
    description:
      'Describe the loaded dataset: its columns, their types, row count and sample values. ' +
      'Call this first when unsure which columns exist or what they are called.',
    parameters: { type: 'object', properties: {}, required: [], additionalProperties: false },
  },
  async run(_args, ctx) {
    return {
      dataset: ctx.datasetName,
      row_count: ctx.rows.length,
      columns: ctx.columns.map((c) => ({
        key: c.key,
        label: c.label,
        type: c.data_type,
        derived: c.is_derived || undefined,
        samples: c.sample_values.slice(0, 3),
      })),
    };
  },
};

const queryDataset: ToolHandler = {
  definition: {
    name: 'query_dataset',
    description:
      'Aggregate the dataset. Group by a column and aggregate a measure (sum/avg/count/min/max), ' +
      'or aggregate the whole dataset when group_by is omitted. Supports filters and a date range. ' +
      'Use for any question about totals, averages, counts, rankings or breakdowns.',
    parameters: {
      type: 'object',
      properties: {
        group_by: { type: 'string', description: 'Column key to group by. Omit for a single overall figure.' },
        measure: { type: 'string', description: 'Numeric column key to aggregate. Omit when aggregation is count.' },
        aggregation: { type: 'string', enum: AGGS },
        where: whereSchema,
        date_range: dateRangeSchema,
        limit: { type: 'number', description: 'Max groups to return, default 10.' },
        sort: { type: 'string', enum: ['desc', 'asc'], description: 'Sort groups by the aggregated value.' },
      },
      required: ['aggregation'],
      additionalProperties: false,
    },
  },
  async run(args, ctx) {
    const agg = (args.aggregation ?? 'count') as Aggregation;
    const rows = applyFilters(ctx.rows, toFilters(args));

    let measureCol: DatasetColumn | null = null;
    if (agg !== 'count') measureCol = requireColumn(ctx, args.measure, 'measure');
    const currency = measureCol?.data_type === 'currency';
    const measureKey = measureCol?.key ?? '__count__';

    if (!args.group_by) {
      const g = groupBy(rows, '__all__', [{ key: measureKey, aggregation: agg }]);
      const v = g[0]?.values[measureKey] ?? (agg === 'count' ? rows.length : null);
      return { rows_considered: rows.length, aggregation: agg, measure: measureCol?.key ?? null, value: fmt(v as number | null, currency) };
    }

    const dim = requireColumn(ctx, args.group_by, 'group_by');
    let groups = groupBy(rows, dim.key, [{ key: measureKey, aggregation: agg }]);
    const dir = args.sort === 'asc' ? 1 : -1;
    groups.sort((a, b) => dir * ((a.values[measureKey] ?? -Infinity) - (b.values[measureKey] ?? -Infinity)));
    const limit = Math.max(1, Math.min(50, Number(args.limit) || 10));
    const truncated = groups.length > limit;
    groups = groups.slice(0, limit);

    return {
      rows_considered: rows.length,
      group_by: dim.key,
      aggregation: agg,
      measure: measureCol?.key ?? null,
      groups: groups.map((g) => ({ [dim.key]: g.key, value: fmt(g.values[measureKey] ?? null, currency), rows: g.count })),
      truncated,
    };
  },
};

const findRows: ToolHandler = {
  definition: {
    name: 'find_rows',
    description:
      'Return individual rows matching filters, e.g. accounts with DPD over 90. ' +
      'Returns at most 25 rows; use query_dataset for totals.',
    parameters: {
      type: 'object',
      properties: {
        where: whereSchema,
        date_range: dateRangeSchema,
        columns: { type: 'array', items: { type: 'string' }, description: 'Column keys to include. Defaults to the first 6.' },
        limit: { type: 'number' },
      },
      required: [],
      additionalProperties: false,
    },
  },
  async run(args, ctx) {
    const rows = applyFilters(ctx.rows, toFilters(args));
    const keys: string[] = Array.isArray(args.columns) && args.columns.length
      ? args.columns.filter((k: string) => ctx.columns.some((c) => c.key === k))
      : ctx.columns.slice(0, 6).map((c) => c.key);
    const limit = Math.max(1, Math.min(25, Number(args.limit) || 10));
    return {
      matched: rows.length,
      showing: Math.min(limit, rows.length),
      rows: rows.slice(0, limit).map((r) => Object.fromEntries(keys.map((k) => [k, r[k] ?? null]))),
    };
  },
};

const makeChart: ToolHandler = {
  definition: {
    name: 'make_chart',
    description:
      'Draw a bar or pie chart from the dataset. Groups by a column and aggregates a measure. ' +
      'Use bar for comparing categories, pie for share of a whole (at most 6 slices). ' +
      'The chart renders inline in the chat; after calling this, give a one-sentence takeaway.',
    parameters: {
      type: 'object',
      properties: {
        type: { type: 'string', enum: ['bar', 'pie'] },
        title: { type: 'string' },
        group_by: { type: 'string' },
        measure: { type: 'string', description: 'Omit when aggregation is count.' },
        aggregation: { type: 'string', enum: AGGS },
        where: whereSchema,
        date_range: dateRangeSchema,
        limit: { type: 'number', description: 'Top-N groups. Default 8 for bar, 6 for pie.' },
      },
      required: ['type', 'title', 'group_by', 'aggregation'],
      additionalProperties: false,
    },
  },
  async run(args, ctx) {
    const type = args.type === 'pie' ? 'pie' : 'bar';
    const agg = (args.aggregation ?? 'count') as Aggregation;
    const rows = applyFilters(ctx.rows, toFilters(args));
    const dim = requireColumn(ctx, args.group_by, 'group_by');

    let measureCol: DatasetColumn | null = null;
    if (agg !== 'count') measureCol = requireColumn(ctx, args.measure, 'measure');
    const measureKey = measureCol?.key ?? '__count__';

    let groups = groupBy(rows, dim.key, [{ key: measureKey, aggregation: agg }]);
    groups.sort((a, b) => (b.values[measureKey] ?? -Infinity) - (a.values[measureKey] ?? -Infinity));

    const limit = Math.max(2, Math.min(type === 'pie' ? 6 : 12, Number(args.limit) || (type === 'pie' ? 6 : 8)));
    const top = groups.slice(0, limit);
    const rest = groups.slice(limit).reduce((s, g) => s + (g.values[measureKey] ?? 0), 0);

    const chart: ChartSpec = {
      type,
      title: String(args.title ?? '').slice(0, 80) || `${measureCol?.label ?? 'Count'} by ${dim.label}`,
      labels: [...top.map((g) => g.key), ...(type === 'pie' && rest > 0 ? ['Other'] : [])],
      values: [...top.map((g) => g.values[measureKey] ?? 0), ...(type === 'pie' && rest > 0 ? [rest] : [])],
      value_label: measureCol?.label ?? 'Count',
      is_currency: measureCol?.data_type === 'currency',
    };

    // The route recognises this shape and attaches the chart to the message.
    return { __chart: chart, summary: chart.labels.map((l, i) => `${l}: ${fmt(chart.values[i] ?? 0, !!chart.is_currency)}`) };
  },
};

// ---------------------------------------------------------------------------

export const TOOLS: ToolHandler[] = [describeDataset, queryDataset, findRows, makeChart];
export const TOOL_DEFINITIONS: ToolDefinition[] = TOOLS.map((t) => t.definition);
const BY_NAME = new Map(TOOLS.map((t) => [t.definition.name, t]));

export interface ToolOutcome {
  output: string;
  chart?: ChartSpec;
}

/** Runs one tool call. Never throws — failures go back to the model as text. */
export async function executeTool(name: string, rawArgs: string, ctx: DatasetContext): Promise<ToolOutcome> {
  const handler = BY_NAME.get(name);
  if (!handler) return { output: JSON.stringify({ error: `Unknown tool: ${name}` }) };

  let args: Record<string, unknown>;
  try { args = rawArgs ? JSON.parse(rawArgs) : {}; }
  catch { return { output: JSON.stringify({ error: 'Arguments were not valid JSON.' }) }; }

  try {
    const result = (await handler.run(args, ctx)) as Record<string, unknown>;
    const chart = (result?.__chart as ChartSpec | undefined) ?? undefined;
    if (chart) delete result.__chart;
    return { output: JSON.stringify(result), chart };
  } catch (err) {
    return { output: JSON.stringify({ error: err instanceof Error ? err.message : 'Tool failed.' }) };
  }
}
