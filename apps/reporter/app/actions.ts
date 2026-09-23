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

export type ConnectionForm = {
  url?: string; host?: string; port?: string; database?: string; user?: string; password?: string; ssl?: boolean;
  /** Reuse the saved password when the form leaves it blank. */
  sourceId?: string | null;
};

async function connectionInput(sb: Awaited<ReturnType<typeof client>>['sb'], f: ConnectionForm): Promise<P.PgConnectionInput> {
  let input: P.PgConnectionInput;
  if (f.url?.trim()) input = P.parseConnectionUrl(f.url);
  else if (f.sourceId && !f.password) { assertUuid(f.sourceId, 'connection'); input = (await P.connectionFor(sb, f.sourceId)).input; }
  else {
    if (!f.host || !f.database || !f.user) throw new Error('Host, database and user are required.');
    input = { host: f.host.trim(), port: Number(f.port) || 5432, database: f.database.trim(), user: f.user.trim(), password: f.password ?? '', ssl: !!f.ssl };
  }
  P.assertAllowedHost(input.host);
  return input;
}

export async function testConnection(form: ConnectionForm): Promise<ActionResult<P.TestResult>> {
  return safe(async () => {
    const { sb } = await client();
    const input = await connectionInput(sb, form);
    const result = await P.testPostgres(input);
    if (form.sourceId) await P.recordTest(sb, form.sourceId, result);
    return result;
  });
}

export async function saveConnection(form: ConnectionForm, name: string): Promise<ActionResult<{ sourceId: string; test: P.TestResult }>> {
  return safe(async () => {
    const { sb, userId } = await client();
    const input = await connectionInput(sb, form);
    const test = await P.testPostgres(input);
    if (!test.ok) throw new Error(`Not saved — ${test.note}`);
    const sourceId = await P.saveConnection(sb, userId, name.trim() || `${input.database}@${input.host}`, input, test, form.sourceId ?? null);
    return { sourceId, test };
  });
}

export async function importFromConnection(
  form: ConnectionForm, target: { table?: string; schema?: string; query?: string }, name: string,
): Promise<ActionResult<P.ImportResult>> {
  return safe(async () => {
    const { sb, userId } = await client();
    const input = await connectionInput(sb, form);
    const label = name.trim() || target.table || 'query';
    const result = await P.importFromPostgres(sb, userId, input, target, form.sourceId ?? null, label);
    if (form.sourceId) {
      await sb.from('data_sources').update({
        config: { host: input.host, port: input.port, database: input.database, user: input.user, ssl: input.ssl, table: target.table, query: target.query },
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
