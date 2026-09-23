/**
 * Report engine.
 *
 * Reads only APPROVED customisations. Pending ones are counted and surfaced as a
 * warning, never applied — that is the whole contract of the Customisation
 * Layer. Rejected type conflicts and coercions fall back to the raw text so the
 * user's decision to distrust a parse is honoured, not overridden.
 */

import { compileFormula } from './formula';
import { recipeFor, type DerivationRecipe } from './derive';
import { coerce, type RawCell } from './structure';
import type { DateFormat } from './parse';
import type {
  Aggregation, ChartSpec, ColumnType, Customisation, DatasetColumn, DatasetRow,
  DerivedFieldProposal, FieldMappingProposal, ReportFilters, ReportTemplate,
  RowExclusionProposal, TemplateField, TextSplitProposal, TypeConflictProposal,
  UnmappedFieldProposal, ValueCoercionProposal, ColumnRenameProposal,
} from './types';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type FieldSource =
  | { kind: 'column'; column: string }
  | { kind: 'derived'; formula: string; label: string }
  | { kind: 'count' };

export interface ResolvedMapping {
  sources: Record<string, FieldSource>;
  missingRequired: string[];
}

export interface ReportTile {
  key: string;
  label: string;
  value: number | string | null;
  format: 'currency' | 'number' | 'percent' | 'text' | 'integer';
  hint?: string;
}

export interface GroupRow {
  key: string;
  count: number;
  values: Record<string, number | null>;
}

export interface GroupTable {
  dimension: string;
  label: string;
  measures: Array<{ key: string; label: string; type: ColumnType; aggregation: Aggregation }>;
  rows: GroupRow[];
  totalGroups: number;
}

export interface ReportResult {
  templateCode: string;
  templateName: string;
  generatedAt: string;
  filters: ReportFilters;
  totalRows: number;
  rowCount: number;
  pendingCount: number;
  tiles: ReportTile[];
  groups: GroupTable[];
  charts: ChartSpec[];
  table: {
    columns: Array<{ key: string; label: string; type: ColumnType }>;
    rows: Array<Record<string, unknown>>;
    truncatedFrom: number;
  };
  warnings: string[];
}

export interface ReportInput {
  template: ReportTemplate;
  columns: DatasetColumn[];
  rows: DatasetRow[];
  /** Raw cells by row_index — needed only when a parse was rejected. */
  rawByIndex?: Map<number, RawCell[]>;
  customisations: Customisation[];
  filters: ReportFilters;
  now?: Date;
}

const DETAIL_LIMIT = 200;
const GROUP_LIMIT = 12;

// ---------------------------------------------------------------------------
// 1. Dataset-level customisations
// ---------------------------------------------------------------------------

/** The value actually in force: the user's override if they made one. */
export function effective<T>(c: Customisation): T {
  return ((c.override ?? c.proposal) as unknown) as T;
}

export function applyDatasetCustomisations(
  columns: DatasetColumn[],
  rows: DatasetRow[],
  customisations: Customisation[],
  rawByIndex?: Map<number, RawCell[]>,
): { columns: DatasetColumn[]; rows: Array<Record<string, unknown>>; warnings: string[] } {
  const warnings: string[] = [];
  const dsLevel = customisations.filter((c) => c.mapping_id === null);
  const approved = dsLevel.filter((c) => c.status === 'approved');
  const rejected = dsLevel.filter((c) => c.status === 'rejected');

  // Row exclusions — approved only.
  const excluded = new Set<number>();
  for (const c of approved.filter((c) => c.kind === 'row_exclusion')) {
    for (const i of effective<RowExclusionProposal>(c).row_indexes) excluded.add(i);
  }

  let cols = columns.map((c) => ({ ...c }));
  const data: Array<Record<string, unknown>> = rows
    .filter((r) => !excluded.has(r.row_index))
    .map((r) => ({ __row_index: r.row_index, ...r.data }));

  const colByKey = () => new Map(cols.map((c) => [c.key, c]));

  // Re-read from raw where the user distrusted the parse. Both a rejected
  // type_conflict and a rejected value_coercion mean "keep the text".
  const reReadAsText = new Set<string>();
  for (const c of rejected) {
    if (c.kind === 'type_conflict') reReadAsText.add(effective<TypeConflictProposal>(c).column);
    if (c.kind === 'value_coercion') reReadAsText.add(effective<ValueCoercionProposal>(c).column);
  }
  for (const c of approved.filter((c) => c.kind === 'type_conflict')) {
    if (effective<TypeConflictProposal>(c).action === 'keep_as_text') {
      reReadAsText.add(effective<TypeConflictProposal>(c).column);
    }
  }

  // Approved coercion with an overridden date format: re-parse from raw.
  const reparse = new Map<string, DateFormat>();
  for (const c of approved.filter((c) => c.kind === 'value_coercion')) {
    const p = effective<ValueCoercionProposal>(c);
    if (c.override && p.action === 'parse') reparse.set(p.column, p.detected_format as DateFormat);
  }

  if ((reReadAsText.size || reparse.size) && !rawByIndex) {
    warnings.push('Some columns needed the original cell text but raw rows were not loaded; parsed values were used instead.');
  } else if (rawByIndex) {
    const byKey = colByKey();
    for (const row of data) {
      const raw = rawByIndex.get(row.__row_index as number);
      if (!raw) continue;
      for (const key of reReadAsText) {
        const col = byKey.get(key);
        if (col?.source_index != null) {
          const v = raw[col.source_index];
          row[key] = v === null || v === undefined ? null : String(v);
        }
      }
      for (const [key, fmt] of reparse) {
        const col = byKey.get(key);
        if (col?.source_index != null) row[key] = coerce(raw[col.source_index] ?? null, 'date', fmt);
      }
    }
    for (const key of reReadAsText) {
      cols = cols.map((c) => (c.key === key ? { ...c, data_type: 'text' } : c));
    }
  }

  // Approved renames.
  for (const c of approved.filter((c) => c.kind === 'column_rename')) {
    const { from, to, label } = effective<ColumnRenameProposal>(c);
    if (from === to) continue;
    cols = cols.map((col) => (col.key === from ? { ...col, key: to, label: label || col.label } : col));
    for (const row of data) {
      if (from in row) { row[to] = row[from]; delete row[from]; }
    }
  }

  // Approved text splits — computed on the fly, no schema mutation needed.
  for (const c of approved.filter((c) => c.kind === 'text_split')) {
    const split = effective<TextSplitProposal>(c);
    const nextPos = cols.length;
    split.parts.forEach((part, i) => {
      if (cols.some((col) => col.key === part.key)) return;
      cols.push({
        id: `split:${split.column}:${part.key}`,
        dataset_id: columns[0]?.dataset_id ?? '',
        key: part.key, label: part.label, data_type: part.type,
        source_header: null, source_index: null,
        is_derived: true, formula: `SPLIT(${split.column}, "${split.separator}", ${i + 1})`,
        sample_values: [], null_count: 0, position: nextPos + i, created_at: '',
      });
    });
    for (const row of data) {
      const v = row[split.column];
      const parts = typeof v === 'string' ? v.split(split.separator).map((s) => s.trim()) : [];
      split.parts.forEach((part, i) => {
        row[part.key] = coerce(parts[i] ?? null, part.type);
      });
    }
  }

  return { columns: cols, rows: data, warnings };
}

// ---------------------------------------------------------------------------
// 2. Mapping resolution
// ---------------------------------------------------------------------------

export function resolveMapping(
  template: ReportTemplate,
  columns: DatasetColumn[],
  customisations: Customisation[],
  mappingId: string | null,
): ResolvedMapping {
  const sources: Record<string, FieldSource> = {};
  const colKeys = new Set(columns.map((c) => c.key));
  const mine = customisations.filter((c) => c.mapping_id === mappingId && c.status === 'approved');

  for (const c of mine) {
    switch (c.kind) {
      case 'field_mapping': {
        const p = effective<FieldMappingProposal>(c);
        if (colKeys.has(p.column)) sources[p.field] = { kind: 'column', column: p.column };
        break;
      }
      case 'unmapped_field': {
        // Only meaningful once the user has dragged a column onto it.
        const o = c.override as unknown as FieldMappingProposal | null;
        if (o?.column && colKeys.has(o.column)) sources[c.target_key] = { kind: 'column', column: o.column };
        break;
      }
      case 'derived_field': {
        const p = effective<DerivedFieldProposal>(c);
        sources[p.field] = { kind: 'derived', formula: p.formula, label: p.field };
        break;
      }
      default:
        break;
    }
  }

  for (const f of template.fields) {
    if (sources[f.key]) continue;
    if (f.aggregation === 'count') sources[f.key] = { kind: 'count' };
  }

  const missingRequired = template.fields
    .filter((f) => f.required && !sources[f.key])
    .map((f) => f.key);

  return { sources, missingRequired };
}

// ---------------------------------------------------------------------------
// 3. Build the field view per row
// ---------------------------------------------------------------------------

function buildViewRows(
  rows: Array<Record<string, unknown>>,
  mapping: ResolvedMapping,
  now: Date,
): Array<Record<string, unknown>> {
  const columnSources = Object.entries(mapping.sources).filter(
    (e): e is [string, { kind: 'column'; column: string }] => e[1].kind === 'column',
  );
  const derivedSources = Object.entries(mapping.sources).filter(
    (e): e is [string, { kind: 'derived'; formula: string; label: string }] => e[1].kind === 'derived',
  );

  // Derived formulas may read other derived fields (foir reads emi_amount), so
  // order them so dependencies run first.
  const compiled = derivedSources.map(([field, src]) => ({ field, fn: compileFormula(src.formula) }));
  const ordered: typeof compiled = [];
  const placed = new Set<string>();
  let guard = 0;
  while (ordered.length < compiled.length && guard++ < compiled.length + 1) {
    for (const c of compiled) {
      if (placed.has(c.field)) continue;
      const deps = c.fn.inputs.filter((i) => compiled.some((o) => o.field === i));
      if (deps.every((d) => placed.has(d))) { ordered.push(c); placed.add(c.field); }
    }
  }
  for (const c of compiled) if (!placed.has(c.field)) ordered.push(c);

  return rows.map((row) => {
    // Every column stays readable by its own key, and mapped fields are
    // additionally exposed under the template's field key.
    const view: Record<string, unknown> = { ...row };
    for (const [field, src] of columnSources) view[field] = row[src.column];
    for (const { field, fn } of ordered) {
      try { view[field] = fn.run(view, now); } catch { view[field] = null; }
    }
    return view;
  });
}

// ---------------------------------------------------------------------------
// 4. Filters
// ---------------------------------------------------------------------------

export function applyFilters(
  rows: Array<Record<string, unknown>>,
  filters: ReportFilters,
): Array<Record<string, unknown>> {
  let out = rows;

  if (filters.date_column && (filters.from || filters.to)) {
    const key = filters.date_column;
    const from = filters.from ? filters.from.slice(0, 10) : null;
    const to = filters.to ? filters.to.slice(0, 10) : null;
    out = out.filter((r) => {
      const v = r[key];
      if (typeof v !== 'string' || v.length < 10) return false;
      const d = v.slice(0, 10);
      if (from && d < from) return false;
      if (to && d > to) return false;
      return true;
    });
  }

  for (const w of filters.where ?? []) {
    if (!w.column || w.value === '') continue;
    const needle = w.value.toLowerCase();
    const num = Number(w.value);
    out = out.filter((r) => {
      const v = r[w.column];
      switch (w.op) {
        case 'eq': return String(v ?? '').toLowerCase() === needle;
        case 'neq': return String(v ?? '').toLowerCase() !== needle;
        case 'contains': return String(v ?? '').toLowerCase().includes(needle);
        case 'gt': return typeof v === 'number' && !Number.isNaN(num) && v > num;
        case 'lt': return typeof v === 'number' && !Number.isNaN(num) && v < num;
        default: return true;
      }
    });
  }

  return out;
}

// ---------------------------------------------------------------------------
// 5. Aggregation
// ---------------------------------------------------------------------------

function aggregate(values: Array<number | null>, how: Aggregation): number | null {
  const nums = values.filter((v): v is number => typeof v === 'number' && Number.isFinite(v));
  if (how === 'count') return values.length;
  if (nums.length === 0) return null;
  switch (how) {
    case 'sum': return nums.reduce((a, b) => a + b, 0);
    case 'avg': return nums.reduce((a, b) => a + b, 0) / nums.length;
    case 'min': return Math.min(...nums);
    case 'max': return Math.max(...nums);
    default: return null;
  }
}

const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);

export function groupBy(
  rows: Array<Record<string, unknown>>,
  dimension: string,
  measures: Array<{ key: string; aggregation: Aggregation }>,
): GroupRow[] {
  const buckets = new Map<string, Array<Record<string, unknown>>>();
  for (const r of rows) {
    const raw = r[dimension];
    const key = raw === null || raw === undefined || raw === '' ? '(blank)' : String(raw);
    if (!buckets.has(key)) buckets.set(key, []);
    buckets.get(key)!.push(r);
  }

  return [...buckets.entries()].map(([key, group]) => ({
    key,
    count: group.length,
    values: Object.fromEntries(
      measures.map((m) => [
        m.key,
        m.aggregation === 'count' ? group.length : aggregate(group.map((g) => num(g[m.key])), m.aggregation),
      ]),
    ),
  }));
}

// ---------------------------------------------------------------------------
// 6. The report
// ---------------------------------------------------------------------------

export function buildReport(input: ReportInput, mappingId: string | null): ReportResult {
  const now = input.now ?? new Date();
  const warnings: string[] = [];

  const pendingCount = input.customisations.filter(
    (c) => c.status === 'pending' && (c.mapping_id === null || c.mapping_id === mappingId),
  ).length;
  if (pendingCount > 0) {
    warnings.push(
      `${pendingCount} customisation${pendingCount === 1 ? '' : 's'} still pending — not reflected in this report until approved.`,
    );
  }

  const applied = applyDatasetCustomisations(input.columns, input.rows, input.customisations, input.rawByIndex);
  warnings.push(...applied.warnings);

  const mapping = resolveMapping(input.template, applied.columns, input.customisations, mappingId);
  if (mapping.missingRequired.length > 0) {
    warnings.push(`Required fields not mapped: ${mapping.missingRequired.join(', ')}. Sections that depend on them are omitted.`);
  }

  const viewRows = buildViewRows(applied.rows, mapping, now);
  const filtered = applyFilters(viewRows, input.filters);

  const fields = input.template.fields;
  const has = (f: TemplateField) => !!mapping.sources[f.key];

  const measures = fields.filter((f) => f.role === 'measure' && has(f));

  // Dimensions worth grouping by are the low-cardinality ones. An identifier
  // such as loan_account_no is a dimension in the template (it belongs in the
  // detail table) but grouping by it yields one row per record and a bar chart
  // with one bar per loan — which is what the first version drew. Rank by
  // distinct count and drop anything that is nearly unique.
  const cardinality = (key: string) => new Set(filtered.map((r) => String(r[key] ?? ''))).size;
  const dimensions = fields
    .filter((f) => f.role === 'dimension' && has(f))
    .map((f) => ({ f, n: cardinality(f.key) }))
    // More than one group, not one per record, and not more than a dozen or
    // half the rows — whichever is larger.
    .filter(({ n }) => n > 1 && n < filtered.length && n <= Math.max(12, filtered.length * 0.5))
    .sort((a, b) => a.n - b.n)
    .map(({ f }) => f);

  const measureSpecs = measures.map((m) => ({
    key: m.key, label: m.label, type: m.type,
    aggregation: (m.aggregation ?? 'sum') as Aggregation,
  }));

  // The measure charts and ranking are built around: a required sum first.
  const primary =
    measures.find((m) => m.required && m.aggregation === 'sum') ??
    measures.find((m) => m.aggregation === 'sum') ??
    measures[0];

  // ---- tiles ------------------------------------------------------------
  const tiles: ReportTile[] = [
    { key: 'rows', label: 'Records', value: filtered.length, format: 'integer',
      hint: filtered.length !== viewRows.length ? `of ${viewRows.length} after filters` : undefined },
  ];
  for (const m of measures) {
    if (tiles.length >= 5) break;
    const agg = (m.aggregation ?? 'sum') as Aggregation;
    if (agg === 'count') continue;
    const v = aggregate(filtered.map((r) => num(r[m.key])), agg);
    tiles.push({
      key: m.key,
      label: agg === 'sum' ? `Total ${m.label}` : agg === 'avg' ? `Avg ${m.label}` : `${agg} ${m.label}`,
      value: v,
      format: m.type === 'currency' ? 'currency' : /pct|%|ratio|efficiency|share/i.test(m.key + m.label) ? 'percent' : 'number',
    });
  }
  if (dimensions[0] && tiles.length < 6) {
    const distinct = new Set(filtered.map((r) => String(r[dimensions[0]!.key] ?? ''))).size;
    tiles.push({ key: `distinct_${dimensions[0].key}`, label: `Distinct ${dimensions[0].label.toLowerCase()}`, value: distinct, format: 'integer' });
  }

  // ---- groups -----------------------------------------------------------
  const groups: GroupTable[] = dimensions.slice(0, 3).map((d) => {
    let rows = groupBy(filtered, d.key, measureSpecs);
    if (primary) {
      rows.sort((a, b) => (b.values[primary.key] ?? -Infinity) - (a.values[primary.key] ?? -Infinity));
    } else {
      rows.sort((a, b) => b.count - a.count);
    }

    // Share-of-total post-aggregates, when the template asks for them.
    const shareField = fields.find((f) => /share|ratio/i.test(f.key) && !has(f) && primary);
    if (shareField && primary) {
      const total = rows.reduce((s, r) => s + (r.values[primary.key] ?? 0), 0);
      for (const r of rows) {
        r.values[shareField.key] = total > 0 ? ((r.values[primary.key] ?? 0) / total) * 100 : null;
      }
    }

    const totalGroups = rows.length;
    rows = rows.slice(0, GROUP_LIMIT);

    const ms = [...measureSpecs];
    if (shareField && primary) ms.push({ key: shareField.key, label: shareField.label, type: 'number', aggregation: 'sum' });

    return { dimension: d.key, label: d.label, measures: ms, rows, totalGroups };
  });

  // ---- charts -----------------------------------------------------------
  const charts: ChartSpec[] = [];
  if (primary && groups[0]) {
    const g = groups[0];
    const top = g.rows.slice(0, 8);
    charts.push({
      type: 'bar',
      title: `${primary.label} by ${g.label}`,
      labels: top.map((r) => r.key),
      values: top.map((r) => r.values[primary.key] ?? 0),
      value_label: primary.label,
      is_currency: primary.type === 'currency',
    });
  }
  if (primary && (groups[1] ?? groups[0])) {
    const g = groups[1] ?? groups[0]!;
    const top = g.rows.slice(0, 6);
    const rest = g.rows.slice(6).reduce((s, r) => s + (r.values[primary.key] ?? 0), 0);
    charts.push({
      type: 'pie',
      title: `Share of ${primary.label} by ${g.label}`,
      labels: [...top.map((r) => r.key), ...(rest > 0 ? ['Other'] : [])],
      values: [...top.map((r) => r.values[primary.key] ?? 0), ...(rest > 0 ? [rest] : [])],
      value_label: primary.label,
      is_currency: primary.type === 'currency',
    });
  }

  // ---- detail table -----------------------------------------------------
  const tableFields = fields.filter(has);
  const table = {
    columns: tableFields.map((f) => ({ key: f.key, label: f.label, type: f.type })),
    rows: filtered.slice(0, DETAIL_LIMIT).map((r) =>
      Object.fromEntries(tableFields.map((f) => [f.key, r[f.key] ?? null])),
    ),
    truncatedFrom: filtered.length,
  };

  return {
    templateCode: input.template.code,
    templateName: input.template.name,
    generatedAt: now.toISOString(),
    filters: input.filters,
    totalRows: input.rows.length,
    rowCount: filtered.length,
    pendingCount,
    tiles,
    groups,
    charts,
    table,
    warnings,
  };
}

/** The date fields a filter can bind to for this template + mapping. */
export function dateFieldOptions(template: ReportTemplate, mapping: ResolvedMapping): TemplateField[] {
  return template.fields.filter((f) => f.role === 'date' && mapping.sources[f.key]);
}

export type { DerivationRecipe };
export { recipeFor };
