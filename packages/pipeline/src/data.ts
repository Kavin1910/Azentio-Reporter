import type { SupabaseClient } from '@supabase/supabase-js';
import type {
  Customisation, Database, Dataset, DatasetColumn, DatasetRow, RawRow, Report, ReportResult, ReportTemplate, TextSplitProposal,
} from '@azentio/core';

export type Client = SupabaseClient<Database>;

/** PostgREST caps a response at 1000 rows; anything larger must page. */
export async function fetchAll<T>(
  make: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>,
  pageSize = 1000,
): Promise<T[]> {
  const out: T[] = [];
  for (let from = 0; ; from += pageSize) {
    const { data, error } = await make(from, from + pageSize - 1);
    if (error) throw new Error(error.message);
    if (!data || data.length === 0) break;
    out.push(...data);
    if (data.length < pageSize) break;
  }
  return out;
}

const must = <T,>(r: { data: T | null; error: { message: string } | null }, what: string): T => {
  if (r.error) throw new Error(`${what}: ${r.error.message}`);
  return r.data as T;
};

export async function listDatasets(sb: Client): Promise<Dataset[]> {
  return must(await sb.from('datasets').select('*').order('created_at', { ascending: false }), 'datasets') ?? [];
}
export async function listTemplates(sb: Client): Promise<ReportTemplate[]> {
  return (must(await sb.from('report_templates').select('*').eq('active', true).order('position'), 'templates') ?? []) as ReportTemplate[];
}
export async function getDataset(sb: Client, id: string): Promise<Dataset | null> {
  return must(await sb.from('datasets').select('*').eq('id', id).maybeSingle(), 'dataset');
}
export async function getColumns(sb: Client, datasetId: string): Promise<DatasetColumn[]> {
  return (must(await sb.from('dataset_columns').select('*').eq('dataset_id', datasetId).order('position'), 'columns') ?? []) as DatasetColumn[];
}
export function getAllRows(sb: Client, datasetId: string): Promise<DatasetRow[]> {
  return fetchAll<DatasetRow>((a, b) => sb.from('dataset_rows').select('*').eq('dataset_id', datasetId).order('row_index').range(a, b) as any);
}
export function getAllRawRows(sb: Client, datasetId: string): Promise<RawRow[]> {
  return fetchAll<RawRow>((a, b) => sb.from('raw_rows').select('*').eq('dataset_id', datasetId).order('row_index').range(a, b) as any);
}
export async function getRawPreview(sb: Client, datasetId: string, limit = 40): Promise<RawRow[]> {
  return (must(await sb.from('raw_rows').select('*').eq('dataset_id', datasetId).order('row_index').limit(limit), 'raw preview') ?? []) as RawRow[];
}
export async function getRowPreview(sb: Client, datasetId: string, limit = 40): Promise<DatasetRow[]> {
  return (must(await sb.from('dataset_rows').select('*').eq('dataset_id', datasetId).order('row_index').limit(limit), 'row preview') ?? []) as DatasetRow[];
}
/** Dataset-level customisations plus one mapping's, when given. */
export async function getCustomisations(sb: Client, datasetId: string, mappingId: string | null): Promise<Customisation[]> {
  let q = sb.from('customisations').select('*').eq('dataset_id', datasetId).order('created_at');
  q = mappingId ? q.or(`mapping_id.is.null,mapping_id.eq.${mappingId}`) : q.is('mapping_id', null);
  return (must(await q, 'customisations') ?? []) as Customisation[];
}
export async function getMappingId(sb: Client, datasetId: string, templateId: string): Promise<string | null> {
  const { data, error } = await sb.from('mappings').select('id').eq('dataset_id', datasetId).eq('template_id', templateId).maybeSingle();
  if (error) throw new Error(`mapping: ${error.message}`);
  return data?.id ?? null;
}
export async function getLatestReport(sb: Client, datasetId: string, templateId: string): Promise<(Report & { result: ReportResult | null }) | null> {
  const { data, error } = await sb.from('reports').select('*').eq('dataset_id', datasetId).eq('template_id', templateId)
    .order('generated_at', { ascending: false }).limit(1).maybeSingle();
  if (error) throw new Error(`report: ${error.message}`);
  if (!data) return null;
  return { ...(data as Report), result: ((data.summary as Record<string, unknown>).result as ReportResult | undefined) ?? null };
}

/**
 * The columns a template can be mapped onto: what the structurer stored PLUS the
 * parts of every approved text split. Split parts only exist at read time (the
 * report engine computes them), so without this the mapper could never offer
 * "age" when it lives inside a free-text borrower cell.
 */
export async function getEffectiveColumns(sb: Client, datasetId: string): Promise<DatasetColumn[]> {
  const [columns, customisations] = await Promise.all([getColumns(sb, datasetId), getCustomisations(sb, datasetId, null)]);
  const out = [...columns];
  for (const c of customisations) {
    if (c.kind !== 'text_split' || c.status !== 'approved') continue;
    const split = (c.override ?? c.proposal) as TextSplitProposal;
    split.parts.forEach((part, i) => {
      if (out.some((col) => col.key === part.key)) return;
      out.push({
        id: `split:${split.column}:${part.key}`, dataset_id: datasetId, key: part.key, label: part.label,
        data_type: part.type, source_header: null, source_index: null, is_derived: true,
        formula: `SPLIT(${split.column}, "${split.separator}", ${i + 1})`,
        sample_values: split.examples.map((e) => e[i]).filter((v) => v !== undefined),
        null_count: 0, position: out.length, created_at: c.created_at,
      });
    });
  }
  return out;
}
