/**
 * The reporting pipeline, independent of Next.js.
 *
 * Every function takes a Supabase client rather than creating one, so the same
 * code runs as a server action (with the signed-in user's session) and in the
 * end-to-end script (with a test user's session). RLS applies either way.
 */

import { readFile } from 'node:fs/promises';
import { basename, resolve } from 'node:path';
import {
  autoMap, buildReport, structureSheet, normaliseKey, CLEAN_CONFIDENCE, MAP_AUTO_APPROVE,
  type ColumnType, type Customisation, type CustomisationKind, type CustomisationProposal,
  type CustomisationStatus, type RawCell, type ReportFilters, type ReportResult, type TemplateField,
} from '@azentio/core';
import { readCsv, readXlsx } from '@azentio/core/sheet';
import { providerConfigFromEnv, suggestNames } from '@azentio/llm';
import {
  getAllRawRows, getAllRows, getColumns, getCustomisations, getDataset, getEffectiveColumns, getMappingId, listTemplates, type Client,
} from './data';
import { recordUploadSource } from './sources';

export const SAMPLE_FILES = [
  'loan_master_2024.xlsx', 'repayments_q1.csv', 'branch_collections.xlsx', 'bureau_extract.xlsx',
] as const;

const chunk = <T,>(xs: T[], n: number): T[][] => { const o: T[][] = []; for (let i = 0; i < xs.length; i += n) o.push(xs.slice(i, i + n)); return o; };

/* ===================================================================== upload */

export async function parseUpload(filename: string, buffer: Buffer | ArrayBuffer): Promise<{ rows: RawCell[][]; sheetName: string | null }> {
  if (/\.csv$/i.test(filename)) {
    const text = Buffer.isBuffer(buffer) ? buffer.toString('utf8') : Buffer.from(buffer).toString('utf8');
    return { rows: (await readCsv(text, basename(filename))).rows, sheetName: null };
  }
  if (/\.xlsx$/i.test(filename)) {
    const sheet = await readXlsx(buffer);
    return { rows: sheet.rows, sheetName: sheet.sheetName };
  }
  throw new Error('Only .xlsx and .csv files are supported.');
}

export async function persistUpload(sb: Client, userId: string, filename: string, rows: RawCell[][], sheetName: string | null, sourceId: string | null = null): Promise<string> {
  if (rows.length === 0) throw new Error('The file has no rows.');
  const name = filename.replace(/\.(xlsx|csv)$/i, '').replace(/[_-]+/g, ' ');
  const { data: ds, error } = await sb.from('datasets').insert({
    owner_id: userId, name, source_filename: filename, sheet_name: sheetName, status: 'uploaded', raw_row_count: rows.length,
    ...(sourceId ? { source_id: sourceId } : {}),
  }).select('id').single();
  if (error || !ds) throw new Error(error?.message ?? 'Could not create dataset.');

  for (const batch of chunk(rows.map((cells, i) => ({ dataset_id: ds.id, row_index: i, cells })), 400)) {
    const { error: e } = await sb.from('raw_rows').insert(batch as any);
    if (e) throw new Error(`raw rows: ${e.message}`);
  }
  return ds.id;
}

export async function uploadSample(sb: Client, userId: string, filename: string, mockDir: string): Promise<string> {
  if (!(SAMPLE_FILES as readonly string[]).includes(filename)) throw new Error('Unknown sample file.');
  const buffer = await readFile(resolve(mockDir, filename));
  const { rows, sheetName } = await parseUpload(filename, buffer);
  const sourceId = await recordUploadSource(sb, userId, { filename, size: buffer.length, sheet: sheetName });
  return persistUpload(sb, userId, filename, rows, sheetName, sourceId);
}

/** A real file from the browser: record the source, then land the rows. */
export async function uploadFile(sb: Client, userId: string, filename: string, buffer: ArrayBuffer, size: number): Promise<string> {
  const { rows, sheetName } = await parseUpload(filename, buffer);
  const sourceId = await recordUploadSource(sb, userId, { filename, size, sheet: sheetName });
  return persistUpload(sb, userId, filename, rows, sheetName, sourceId);
}

/* ================================================================== structure */

type NewCustomisation = {
  dataset_id: string; mapping_id: string | null; kind: CustomisationKind; target_key: string;
  proposal: CustomisationProposal; override?: CustomisationProposal | null; confidence: number | null;
  affected_rows: number; rationale: string; status: CustomisationStatus;
};

const plainKey = (header: string) =>
  header.trim().toLowerCase().replace(/[%₹$]/g, '_pct_').replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').replace(/_+/g, '_').replace(/_pct_$/, '_pct');

export interface StructureOutcome { columns: number; rows: number; pending: number; notes: string[]; modelAssisted: boolean }

/**
 * THE button. Reads the raw rows, runs the structurer, persists the canonical
 * schema and parsed rows, and writes every uncertain decision to the
 * Customisation Layer as pending. Re-runnable: wipes its own previous output.
 */
export async function structureDataset(sb: Client, datasetId: string, opts: { useModel?: boolean } = {}): Promise<StructureOutcome> {
  const ds = await getDataset(sb, datasetId);
  if (!ds) throw new Error('Dataset not found.');
  await sb.from('datasets').update({ status: 'structuring' }).eq('id', datasetId);

  try {
    const raw = await getAllRawRows(sb, datasetId);
    const grid: RawCell[][] = [];
    for (const r of raw) grid[r.row_index] = r.cells as RawCell[];
    for (let i = 0; i < grid.length; i++) grid[i] ??= [];

    const result = structureSheet(grid);

    // Optional, time-boxed model assist for columns the vocabulary did not
    // recognise. Structuring never waits long on it or fails because of it.
    let renames: Array<{ from: string; to: string; label: string; confidence: number; reason: string }> = [];
    const splitPartNames = new Map<string, { key: string; label: string }>();
    let modelAssisted = false;
    if (opts.useModel !== false) {
      try {
        const cfg = providerConfigFromEnv();
        const unknown = result.columns.filter((c) => c.key === plainKey(c.sourceHeader) && !c.split);
        const splits = result.columns.filter((c) => c.split).map((c) => ({
          column: c.key,
          parts: c.split!.parts.map((p, i) => ({ key: p.key, type: p.type, samples: c.split!.examples.map((e) => e[i]) })),
        }));
        const s = await suggestNames(cfg, {
          columns: unknown.map((c) => ({ key: c.key, source_header: c.sourceHeader, type: c.type, samples: c.samples.slice(0, 3) })),
          splits,
        });
        if (s) {
          modelAssisted = true;
          renames = s.renames.filter((r) => r.from !== r.to && result.columns.some((c) => c.key === r.from));
          for (const p of s.splitParts) splitPartNames.set(`${p.column}:${p.index}`, { key: p.key, label: p.label });
        }
      } catch { /* no key or model unavailable — heuristics stand alone */ }
    }

    await sb.from('customisations').delete().eq('dataset_id', datasetId).is('mapping_id', null);
    await sb.from('dataset_rows').delete().eq('dataset_id', datasetId);
    await sb.from('dataset_columns').delete().eq('dataset_id', datasetId);

    const { error: colErr } = await sb.from('dataset_columns').insert(result.columns.map((c, i) => ({
      dataset_id: datasetId, key: c.key, label: c.label, data_type: c.type, source_header: c.sourceHeader,
      source_index: c.sourceIndex, is_derived: false, formula: null, sample_values: c.samples, null_count: c.nullCount, position: i,
    })) as any);
    if (colErr) throw new Error(`columns: ${colErr.message}`);

    // Totals and repeated-header rows are KEPT as data with a pending exclusion —
    // they leave the report only when someone approves that. Blank and title rows
    // are not data under any reading and are dropped outright.
    const debatable = result.excluded.filter((e) => e.reason === 'totals' || e.reason === 'repeated_header');
    const debatableRows = debatable.map((e) => {
      const cells = grid[e.rowIndex] ?? [];
      const data: Record<string, unknown> = {};
      for (const c of result.columns) data[c.key] = cells[c.sourceIndex] ?? null;
      return { rowIndex: e.rowIndex, data };
    });
    const allRows = [...result.rows, ...debatableRows].sort((a, b) => a.rowIndex - b.rowIndex);
    for (const batch of chunk(allRows.map((r) => ({ dataset_id: datasetId, row_index: r.rowIndex, data: r.data })), 400)) {
      const { error: e } = await sb.from('dataset_rows').insert(batch as any);
      if (e) throw new Error(`rows: ${e.message}`);
    }

    const cust: NewCustomisation[] = [];
    const base = { dataset_id: datasetId, mapping_id: null as string | null, status: 'pending' as CustomisationStatus };

    if (debatable.length) {
      const idx = debatable.map((e) => e.rowIndex);
      cust.push({
        ...base, kind: 'row_exclusion', target_key: '__rows__',
        proposal: { row_indexes: idx, reason: debatable[0]!.reason }, confidence: 92, affected_rows: idx.length,
        rationale: `${idx.length} row${idx.length === 1 ? '' : 's'} look like ${debatable[0]!.reason === 'totals' ? 'totals or subtotals' : 'a repeated header'} — including them would double-count every measure. Approve to exclude them from reports.`,
      });
    }
    for (const c of result.columns) {
      if (c.type !== 'text' && c.confidence < CLEAN_CONFIDENCE && c.oddValues.length) {
        cust.push({
          ...base, kind: 'type_conflict', target_key: c.key,
          proposal: { column: c.key, majority_type: c.type, odd_values: c.oddValues, action: 'null_out' },
          confidence: c.confidence, affected_rows: Math.round(result.rows.length * (1 - c.confidence / 100)),
          rationale: `"${c.sourceHeader}" is ${c.confidence}% ${c.type}, but also holds ${c.oddValues.slice(0, 3).map((v) => `"${v}"`).join(', ')}. Approve to treat those as blank; reject to keep the whole column as text.`,
        });
      }
      if (c.type === 'date' && c.dateAmbiguous) {
        cust.push({
          ...base, kind: 'value_coercion', target_key: c.key,
          proposal: { column: c.key, detected_format: c.dateFormat ?? 'dmy', examples: c.samples.slice(0, 3).map(String), action: 'parse' },
          confidence: 50, affected_rows: result.rows.length - c.nullCount,
          rationale: `Every date in "${c.sourceHeader}" could be read as day/month or month/day. It was read as ${c.dateFormat === 'mdy' ? 'month/day' : 'day/month'}. Approve, or override with the other order.`,
        });
      }
      if (c.split) {
        const parts = c.split.parts.map((p, i) => {
          const named = splitPartNames.get(`${c.key}:${i}`);
          return named ? { ...p, key: normaliseKey(named.key), label: named.label } : p;
        });
        cust.push({
          ...base, kind: 'text_split', target_key: c.key, proposal: { ...c.split, parts },
          confidence: 85, affected_rows: result.rows.length - c.nullCount,
          rationale: `"${c.sourceHeader}" holds ${parts.length} facts in one cell, e.g. ${c.split.examples[0]?.map((x) => `"${x}"`).join(' · ')}. Approve to split it into ${parts.map((p) => p.key).join(', ')}.`,
        });
      }
    }
    for (const r of renames) {
      const col = result.columns.find((c) => c.key === r.from)!;
      cust.push({
        ...base, kind: 'column_rename', target_key: r.from,
        proposal: { from: r.from, to: normaliseKey(r.to), label: r.label || r.to, data_type: col.type },
        confidence: Math.min(99, r.confidence || 70), affected_rows: 0,
        rationale: r.reason || `"${col.sourceHeader}" was not recognised; the model suggests naming it ${r.to}.`,
      });
    }
    if (cust.length) {
      const { error: cuErr } = await sb.from('customisations').insert(cust as any);
      if (cuErr) throw new Error(`customisations: ${cuErr.message}`);
    }

    // The schema changed; previous template mappings are stale.
    await sb.from('mappings').delete().eq('dataset_id', datasetId);

    await sb.from('datasets').update({
      status: 'structured', structured_row_count: result.rows.length, header_row_index: result.headerRowIndex,
      structure_notes: result.notes.join('\n'), structure_model: modelAssisted ? (process.env.OPENROUTER_MODEL ?? 'model') : 'heuristic',
      structured_at: new Date().toISOString(),
    }).eq('id', datasetId);

    return { columns: result.columns.length, rows: result.rows.length, pending: cust.length, notes: result.notes, modelAssisted };
  } catch (err) {
    await sb.from('datasets').update({ status: 'failed' }).eq('id', datasetId);
    throw err;
  }
}

/* ================================================================== templates */

/** Ensures a mapping exists for (dataset, template) and auto-maps it once. */
export async function selectTemplate(sb: Client, datasetId: string, templateCode: string): Promise<{ mappingId: string; created: boolean }> {
  const template = (await listTemplates(sb)).find((t) => t.code === templateCode);
  if (!template) throw new Error('Unknown template.');
  const existing = await getMappingId(sb, datasetId, template.id);
  if (existing) return { mappingId: existing, created: false };

  const { data: mapping, error } = await sb.from('mappings').insert({ dataset_id: datasetId, template_id: template.id }).select('id').single();
  if (error || !mapping) throw new Error(error?.message ?? 'Could not create mapping.');

  const result = autoMap(template.fields as TemplateField[], await getEffectiveColumns(sb, datasetId));
  const rows: NewCustomisation[] = [
    ...result.mapped.map((m) => ({
      dataset_id: datasetId, mapping_id: mapping.id, kind: 'field_mapping' as const, target_key: m.field.key,
      proposal: { field: m.field.key, column: m.column }, confidence: m.confidence, affected_rows: 0,
      // Only an exact key match is written approved — it is not a mismatch. It stays visible and revocable.
      status: (m.confidence >= MAP_AUTO_APPROVE ? 'approved' : 'pending') as CustomisationStatus,
      rationale: m.confidence >= MAP_AUTO_APPROVE
        ? `Exact match: the file has a column named ${m.column}.`
        : `${m.reason} Confidence ${m.confidence}%. Approve, or drag a different column onto ${m.field.label}.`,
    })),
    ...result.derived.map((d) => ({
      dataset_id: datasetId, mapping_id: mapping.id, kind: 'derived_field' as const, target_key: d.field.key,
      proposal: { field: d.field.key, formula: d.recipe.formula, inputs: d.inputs, result_type: d.recipe.resultType },
      confidence: 90, affected_rows: 0, status: 'pending' as CustomisationStatus, rationale: d.recipe.rationale,
    })),
    ...result.unmapped.map((u) => ({
      dataset_id: datasetId, mapping_id: mapping.id, kind: 'unmapped_field' as const, target_key: u.field.key,
      proposal: { field: u.field.key, candidates: u.candidates },
      confidence: u.candidates[0]?.confidence ?? null, affected_rows: 0, status: 'pending' as CustomisationStatus,
      rationale: u.candidates.length
        ? `No confident match for ${u.field.label}${u.field.required ? ' (required)' : ''}. Closest: ${u.candidates.map((c) => `${c.column} ${c.confidence}%`).join(', ')}. Drag a column onto it to resolve.`
        : `No column resembles ${u.field.label}${u.field.required ? ' (required)' : ''}. Drag a column onto it, or leave it out.`,
    })),
  ];
  if (rows.length) {
    const { error: e } = await sb.from('customisations').insert(rows as any);
    if (e) throw new Error(e.message);
  }
  return { mappingId: mapping.id, created: true };
}

export async function resetMapping(sb: Client, datasetId: string, templateCode: string) {
  const template = (await listTemplates(sb)).find((t) => t.code === templateCode);
  if (!template) throw new Error('Unknown template.');
  await sb.from('mappings').delete().eq('dataset_id', datasetId).eq('template_id', template.id);
  return selectTemplate(sb, datasetId, templateCode);
}

/* ============================================================ customisations */

export async function decideCustomisation(sb: Client, id: string, status: CustomisationStatus, override?: CustomisationProposal | null) {
  const patch: Partial<Customisation> = { status };
  if (override !== undefined) patch.override = override;
  const { error } = await sb.from('customisations').update(patch).eq('id', id);
  if (error) throw new Error(error.message);
}

/** Drag & drop: the user chose this, so it is written approved with an override recording the choice. */
export async function assignField(sb: Client, mappingId: string, datasetId: string, fieldKey: string, columnKey: string) {
  const { data: existing } = await sb.from('customisations').select('id').eq('mapping_id', mappingId).eq('target_key', fieldKey)
    .in('kind', ['field_mapping', 'unmapped_field', 'derived_field']).limit(1).maybeSingle();
  const override = { field: fieldKey, column: columnKey };
  const r = existing
    ? await sb.from('customisations').update({ override, status: 'approved' }).eq('id', existing.id)
    : await sb.from('customisations').insert({
        dataset_id: datasetId, mapping_id: mappingId, kind: 'field_mapping', target_key: fieldKey,
        proposal: override, override, confidence: null, affected_rows: 0, status: 'approved', rationale: 'Assigned manually.',
      } as any);
  if (r.error) throw new Error(r.error.message);
}

export async function clearField(sb: Client, mappingId: string, fieldKey: string) {
  const { error } = await sb.from('customisations').update({ status: 'rejected' }).eq('mapping_id', mappingId).eq('target_key', fieldKey);
  if (error) throw new Error(error.message);
}

export async function updateColumn(sb: Client, columnId: string, patch: { label?: string; data_type?: ColumnType }) {
  const { error } = await sb.from('dataset_columns').update(patch).eq('id', columnId);
  if (error) throw new Error(error.message);
}

/** A key rename is an APPROVED column_rename applied at read time — the raw key is never lost. */
export async function renameColumn(sb: Client, datasetId: string, fromKey: string, toKeyRaw: string, label: string) {
  const toKey = normaliseKey(toKeyRaw);
  if (!toKey) throw new Error('Name cannot be empty.');
  const cols = await getColumns(sb, datasetId);
  const col = cols.find((c) => c.key === fromKey);
  if (!col) throw new Error('Column not found.');
  if (cols.some((c) => c.key === toKey && c.key !== fromKey)) throw new Error(`A column named ${toKey} already exists.`);
  await sb.from('customisations').delete().eq('dataset_id', datasetId).eq('kind', 'column_rename').eq('target_key', fromKey);
  if (toKey !== fromKey) {
    const { error } = await sb.from('customisations').insert({
      dataset_id: datasetId, mapping_id: null, kind: 'column_rename', target_key: fromKey,
      proposal: { from: fromKey, to: toKey, label, data_type: col.data_type },
      confidence: null, affected_rows: 0, status: 'approved', rationale: 'Renamed manually.',
    } as any);
    if (error) throw new Error(error.message);
  }
  if (label && label !== col.label) await sb.from('dataset_columns').update({ label }).eq('id', col.id);
}

/* ===================================================================== report */

export async function generateReport(sb: Client, datasetId: string, templateCode: string, filters: ReportFilters): Promise<ReportResult> {
  const template = (await listTemplates(sb)).find((t) => t.code === templateCode);
  if (!template) throw new Error('Unknown template.');
  const { mappingId } = await selectTemplate(sb, datasetId, templateCode);
  const [columns, rows, customisations] = await Promise.all([
    getColumns(sb, datasetId), getAllRows(sb, datasetId), getCustomisations(sb, datasetId, mappingId),
  ]);
  const needsRaw = customisations.some((c) => c.mapping_id === null && c.status !== 'pending' && (c.kind === 'type_conflict' || c.kind === 'value_coercion'));
  const rawByIndex = needsRaw ? new Map((await getAllRawRows(sb, datasetId)).map((r) => [r.row_index, r.cells as RawCell[]])) : undefined;

  const result = buildReport({ template, columns, rows, rawByIndex, customisations, filters }, mappingId);
  const { error } = await sb.from('reports').insert({
    dataset_id: datasetId, template_id: template.id, filters, summary: { result }, row_count: result.rowCount,
  } as any);
  if (error) throw new Error(error.message);
  return result;
}
