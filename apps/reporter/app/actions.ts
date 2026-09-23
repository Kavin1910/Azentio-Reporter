'use server';

/**
 * Server actions — thin wrappers over @azentio/pipeline.
 *
 * Every action returns an ActionResult instead of throwing. In production
 * Next.js redacts the message of any error thrown from a server action
 * ("An error occurred in the Server Components render…"), so a thrown
 * "Sources table missing — run 0004_sources.sql" would reach the user as
 * nothing useful. Returning the failure keeps the message; the client's run()
 * unwraps it.
 */

import { revalidatePath } from 'next/cache';
import { resolve } from 'node:path';
import type { ColumnType, CustomisationProposal, CustomisationStatus, ReportFilters, ReportResult } from '@azentio/core';
import * as P from '@azentio/pipeline';
import { getServerSupabase } from '@/lib/supabase/server';
import { SAMPLE_FILES } from '@/lib/samples';
import { assertUuid, MAX_UPLOAD_BYTES } from '@/lib/validate';

const MOCK_DIR = resolve(process.cwd(), '../../mock-data');

export type ActionResult<T> = { ok: true; data: T } | { ok: false; error: string };

async function safe<T>(fn: () => Promise<T>): Promise<ActionResult<T>> {
  try {
    const data = await fn();
    revalidatePath('/');
    return { ok: true, data };
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Something went wrong.';
    console.error('[action]', message);
    return { ok: false, error: message };
  }
}

async function client() {
  const sb = await getServerSupabase();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) throw new Error('Your session has expired. Sign in again.');
  return { sb, userId: user.id };
}

/* ===================================================================== upload */

export async function uploadDataset(formData: FormData): Promise<ActionResult<{ datasetId: string }>> {
  return safe(async () => {
    const { sb, userId } = await client();
    const file = formData.get('file');
    if (!(file instanceof File)) throw new Error('No file received.');
    if (!/\.(xlsx|csv)$/i.test(file.name)) throw new Error('Only .xlsx and .csv files are supported.');
    if (file.size > MAX_UPLOAD_BYTES) throw new Error(`File is larger than ${Math.round(MAX_UPLOAD_BYTES / 1024 / 1024)} MB.`);
    return { datasetId: await P.uploadFile(sb, userId, file.name, await file.arrayBuffer(), file.size) };
  });
}

export async function loadSampleDataset(filename: string): Promise<ActionResult<{ datasetId: string }>> {
  return safe(async () => {
    const { sb, userId } = await client();
    if (!(SAMPLE_FILES as readonly string[]).includes(filename)) throw new Error('Unknown sample file.');
    return { datasetId: await P.uploadSample(sb, userId, filename, MOCK_DIR) };
  });
}

export async function deleteDataset(datasetId: string): Promise<ActionResult<void>> {
  return safe(async () => {
    assertUuid(datasetId, 'dataset');
    const { sb } = await client();
    const { error } = await sb.from('datasets').delete().eq('id', datasetId);
    if (error) throw new Error(error.message);
  });
}

/* ================================================================== structure */

export async function structureDataset(datasetId: string): Promise<ActionResult<P.StructureOutcome>> {
  return safe(async () => {
    assertUuid(datasetId, 'dataset');
    const { sb } = await client();
    return P.structureDataset(sb, datasetId);
  });
}

/* ================================================================== templates */

export async function selectTemplate(datasetId: string, templateCode: string): Promise<ActionResult<{ mappingId: string; created: boolean }>> {
  return safe(async () => {
    assertUuid(datasetId, 'dataset');
    const { sb } = await client();
    return P.selectTemplate(sb, datasetId, templateCode);
  });
}

export async function resetMapping(datasetId: string, templateCode: string): Promise<ActionResult<{ mappingId: string; created: boolean }>> {
  return safe(async () => {
    assertUuid(datasetId, 'dataset');
    const { sb } = await client();
    return P.resetMapping(sb, datasetId, templateCode);
  });
}

/* ============================================================ customisations */

export async function decideCustomisation(id: string, status: CustomisationStatus, override?: CustomisationProposal | null): Promise<ActionResult<void>> {
  return safe(async () => {
    assertUuid(id, 'customisation');
    if (!['pending', 'approved', 'rejected'].includes(status)) throw new Error('Invalid status.');
    const { sb } = await client();
    await P.decideCustomisation(sb, id, status, override);
  });
}

export async function assignField(mappingId: string, datasetId: string, fieldKey: string, columnKey: string): Promise<ActionResult<void>> {
  return safe(async () => {
    assertUuid(mappingId, 'mapping'); assertUuid(datasetId, 'dataset');
    const { sb } = await client();
    await P.assignField(sb, mappingId, datasetId, fieldKey, columnKey);
  });
}

export async function clearField(mappingId: string, fieldKey: string): Promise<ActionResult<void>> {
  return safe(async () => {
    assertUuid(mappingId, 'mapping');
    const { sb } = await client();
    await P.clearField(sb, mappingId, fieldKey);
  });
}

export async function updateColumn(columnId: string, patch: { label?: string; data_type?: ColumnType }): Promise<ActionResult<void>> {
  return safe(async () => {
    assertUuid(columnId, 'column');
    const { sb } = await client();
    await P.updateColumn(sb, columnId, patch);
  });
}

export async function renameColumn(datasetId: string, fromKey: string, toKey: string, label: string): Promise<ActionResult<void>> {
  return safe(async () => {
    assertUuid(datasetId, 'dataset');
    const { sb } = await client();
    await P.renameColumn(sb, datasetId, fromKey, toKey, label);
  });
}

/* ===================================================================== report */

export async function generateReport(datasetId: string, templateCode: string, filters: ReportFilters): Promise<ActionResult<ReportResult>> {
  return safe(async () => {
    assertUuid(datasetId, 'dataset');
    const { sb } = await client();
    return P.generateReport(sb, datasetId, templateCode, filters);
  });
}

/* ==================================================================== sources */

/**
 * Supabase only, two ways in:
 *  - rest: project URL + API key. Schema from PostgREST's OpenAPI document,
 *          rows over REST. No database password, no open port.
 *  - pg:   the connection string Supabase's Connect dialog prints. Needed only
 *          for SQL queries; host must be a Supabase host.
 */
export type ConnectionForm = {
  mode: 'rest' | 'pg';
  url?: string;          // rest: https://<ref>.supabase.co
  apiKey?: string;       // rest
  schema?: string;       // rest, default public
  connectionString?: string; // pg: postgresql://postgres.<ref>:…@…pooler.supabase.com:6543/postgres
  /** Reuse the saved secret when the form leaves it blank. */
  sourceId?: string | null;
};

type Resolved = { mode: 'rest'; rest: P.SupabaseRestInput } | { mode: 'pg'; pg: P.PgConnectionInput };

async function resolveConnection(sb: Awaited<ReturnType<typeof client>>['sb'], f: ConnectionForm): Promise<Resolved> {
  if (f.mode === 'rest') {
    if (f.sourceId && !f.apiKey) { assertUuid(f.sourceId, 'connection'); return { mode: 'rest', rest: await P.supabaseInputFor(sb, f.sourceId) }; }
    if (!f.url?.trim() || !f.apiKey?.trim()) throw new Error('Project URL and API key are required.');
    return { mode: 'rest', rest: { url: f.url, apiKey: f.apiKey, schema: f.schema } };
  }
  let pg: P.PgConnectionInput;
  if (f.sourceId && !f.connectionString) { assertUuid(f.sourceId, 'connection'); pg = (await P.connectionFor(sb, f.sourceId)).input; }
  else {
    if (!f.connectionString?.trim()) throw new Error('Paste the connection string from Supabase → Connect.');
    pg = P.parseConnectionUrl(f.connectionString);
  }
  P.assertSupabaseHost(pg.host);
  return { mode: 'pg', pg };
}

export async function testConnection(form: ConnectionForm): Promise<ActionResult<P.TestResult & { detail?: P.SupabaseTable[] }>> {
  return safe(async () => {
    const { sb } = await client();
    const c = await resolveConnection(sb, form);
    const result = c.mode === 'rest' ? await P.supabaseSchema(c.rest) : await P.testPostgres(c.pg);
    if (form.sourceId) await P.recordTest(sb, form.sourceId, result);
    return result;
  });
}

export async function saveConnection(form: ConnectionForm, name: string): Promise<ActionResult<{ sourceId: string; test: P.TestResult }>> {
  return safe(async () => {
    const { sb, userId } = await client();
    const c = await resolveConnection(sb, form);
    const test = c.mode === 'rest' ? await P.supabaseSchema(c.rest) : await P.testPostgres(c.pg);
    if (!test.ok) throw new Error(`Not saved — ${test.note}`);
    const label = name.trim() || (c.mode === 'rest' ? new URL(P.parseSupabaseUrl(c.rest.url)).hostname.split('.')[0]! : `${c.pg.database}@${c.pg.host}`);
    const sourceId = c.mode === 'rest'
      ? await P.saveSupabaseConnection(sb, userId, label, c.rest, test, form.sourceId ?? null)
      : await P.saveConnection(sb, userId, label, c.pg, test, form.sourceId ?? null);
    return { sourceId, test };
  });
}

export async function importFromConnection(
  form: ConnectionForm, target: { table?: string; schema?: string; query?: string }, name: string,
): Promise<ActionResult<P.ImportResult>> {
  return safe(async () => {
    const { sb, userId } = await client();
    const c = await resolveConnection(sb, form);
    const label = name.trim() || target.table || 'query';
    if (c.mode === 'rest') {
      if (!target.table) throw new Error('Choose a table. SQL queries need the connection-string mode.');
      return P.importFromSupabase(sb, userId, { ...c.rest, schema: target.schema ?? c.rest.schema }, target.table, form.sourceId ?? null, label);
    }
    const result = await P.importFromPostgres(sb, userId, c.pg, target, form.sourceId ?? null, label);
    if (form.sourceId) {
      await sb.from('data_sources').update({
        config: { host: c.pg.host, port: c.pg.port, database: c.pg.database, user: c.pg.user, ssl: c.pg.ssl, table: target.table, query: target.query },
      } as any).eq('id', form.sourceId);
    }
    return result;
  });
}

export async function deleteSource(id: string): Promise<ActionResult<void>> {
  return safe(async () => {
    assertUuid(id, 'connection');
    const { sb } = await client();
    await P.deleteSource(sb, id);
  });
}
