/**
 * Data sources: uploads and external Postgres connections.
 *
 * Secrets: the connection password is encrypted with AES-256-GCM under
 * SOURCE_ENCRYPTION_KEY before it reaches the database, and decrypted only on
 * the server at the moment of use. It is never returned to the browser — the
 * `PublicSource` shape strips it — so a leaked API response or a compromised
 * client cannot recover it. Rotating the key invalidates stored passwords;
 * users re-enter them.
 */

import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';
import { Client as PgClient } from 'pg';
import type { DataSource, PostgresSourceConfig, RawCell, UploadSourceConfig } from '@azentio/core';
import { persistUpload } from './pipeline';
import type { Client } from './data';

/* ------------------------------------------------------------------ crypto */

function key(): Buffer {
  const raw = process.env.SOURCE_ENCRYPTION_KEY;
  if (!raw || raw.length < 16) {
    throw new Error('SOURCE_ENCRYPTION_KEY is not set (need 16+ characters) — cannot store connection passwords.');
  }
  // Any-length secret → 32-byte key.
  return createHash('sha256').update(raw).digest();
}

export function encryptSecret(plain: string): string {
  const iv = randomBytes(12);
  const c = createCipheriv('aes-256-gcm', key(), iv);
  const ct = Buffer.concat([c.update(plain, 'utf8'), c.final()]);
  return Buffer.concat([iv, c.getAuthTag(), ct]).toString('base64');
}

export function decryptSecret(enc: string): string {
  const buf = Buffer.from(enc, 'base64');
  const iv = buf.subarray(0, 12), tag = buf.subarray(12, 28), ct = buf.subarray(28);
  const d = createDecipheriv('aes-256-gcm', key(), iv);
  d.setAuthTag(tag);
  return Buffer.concat([d.update(ct), d.final()]).toString('utf8');
}

/* ------------------------------------------------------------ persistence */

/** What the browser is allowed to see. */
export type PublicSource = Omit<DataSource, 'secret_enc'> & { has_secret: boolean };

const toPublic = (s: DataSource): PublicSource => {
  const { secret_enc, ...rest } = s;
  return { ...rest, has_secret: !!secret_enc };
};

export async function listSources(sb: Client): Promise<PublicSource[]> {
  const { data, error } = await sb.from('data_sources').select('*').order('created_at', { ascending: false });
  if (error) {
    // Migration 0004 not applied yet: say so rather than break the whole step.
    if (/data_sources/.test(error.message) && /does not exist|schema cache/i.test(error.message)) {
      throw new Error('Sources table missing — run supabase/migrations/0004_sources.sql in the SQL editor.');
    }
    throw new Error(error.message);
  }
  return ((data ?? []) as DataSource[]).map(toPublic);
}

export async function recordUploadSource(sb: Client, userId: string, cfg: UploadSourceConfig): Promise<string | null> {
  const { data, error } = await sb.from('data_sources').insert({
    owner_id: userId, kind: 'upload', name: cfg.filename, config: cfg, last_imported_at: new Date().toISOString(),
  } as any).select('id').single();
  // A missing sources table must not block the upload itself.
  if (error) return null;
  return data?.id ?? null;
}

export async function deleteSource(sb: Client, id: string): Promise<void> {
  const { error } = await sb.from('data_sources').delete().eq('id', id);
  if (error) throw new Error(error.message);
}

/* ------------------------------------------------------------- host guard */

/**
 * A server that will connect to any host a user types is an SSRF primitive:
 * it can be pointed at the cloud metadata endpoint, the platform's own
 * database, or anything else on the private network. Loopback, link-local,
 * RFC1918 and metadata addresses are refused unless ALLOW_PRIVATE_DB_HOSTS is
 * set — which is right for local development and wrong for production.
 */
export function isPrivateHost(host: string): boolean {
  const h = host.trim().toLowerCase().replace(/^\[|\]$/g, '');
  if (h === 'localhost' || h.endsWith('.localhost') || h === '0.0.0.0' || h === '::1' || h === '::') return true;
  if (/^169\.254\.169\.254$/.test(h) || h === 'metadata.google.internal' || h === 'metadata') return true;
  const v4 = h.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (v4) {
    const [a, b] = [Number(v4[1]), Number(v4[2])];
    return a === 10 || a === 127 || a === 0 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 169 && b === 254) || (a === 100 && b >= 64 && b <= 127);
  }
  if (/^(fc|fd)[0-9a-f]{2}:/.test(h) || /^fe80:/.test(h)) return true;   // IPv6 ULA / link-local
  return false;
}

export function assertAllowedHost(host: string): void {
  if (!host?.trim()) throw new Error('Host is required.');
  if (isPrivateHost(host) && process.env.ALLOW_PRIVATE_DB_HOSTS !== 'true') {
    throw new Error('Connections to private or local addresses are not allowed from this server.');
  }
}

/* --------------------------------------------------------------- postgres */

export interface PgConnectionInput {
  host: string; port: number; database: string; user: string; password: string; ssl: boolean;
}

export interface TableInfo { schema: string; name: string; rows_estimate: number | null }

export interface TestResult {
  ok: boolean;
  note: string;
  version?: string;
  tables?: TableInfo[];
  ms: number;
}

/** Accepts a postgres:// URL or the discrete fields. */
export function parseConnectionUrl(url: string): PgConnectionInput {
  const u = new URL(url.trim());
  if (!/^postgres(ql)?:$/.test(u.protocol)) throw new Error('Connection URL must start with postgres:// or postgresql://');
  const ssl = /sslmode=(require|verify-full|verify-ca)/.test(u.search) || u.hostname.endsWith('.supabase.co');
  return {
    host: u.hostname,
    port: u.port ? Number(u.port) : 5432,
    database: decodeURIComponent(u.pathname.replace(/^\//, '')) || 'postgres',
    user: decodeURIComponent(u.username),
    password: decodeURIComponent(u.password),
    ssl,
  };
}

async function withClient<T>(c: PgConnectionInput, fn: (pg: PgClient) => Promise<T>, timeoutMs = 8000): Promise<T> {
  const pg = new PgClient({
    host: c.host, port: c.port, database: c.database, user: c.user, password: c.password,
    ssl: c.ssl ? { rejectUnauthorized: false } : undefined,
    connectionTimeoutMillis: timeoutMs,
    statement_timeout: 30_000,
    application_name: 'azentio-reporter',
  });
  await pg.connect();
  try {
    // Everything this app does against a customer database is read-only.
    await pg.query('SET default_transaction_read_only = on');
    return await fn(pg);
  } finally {
    await pg.end().catch(() => {});
  }
}

export async function testPostgres(c: PgConnectionInput): Promise<TestResult> {
  const t0 = Date.now();
  try {
    return await withClient(c, async (pg) => {
      const v = await pg.query<{ v: string }>('select version() as v');
      const t = await pg.query<{ schema: string; name: string; rows_estimate: string | null }>(`
        select n.nspname as schema, c.relname as name,
               nullif(c.reltuples, -1)::bigint::text as rows_estimate
          from pg_class c join pg_namespace n on n.oid = c.relnamespace
         where c.relkind in ('r','v','m','p')
           and n.nspname not in ('pg_catalog','information_schema','pg_toast')
           and n.nspname not like 'pg_temp%'
         order by n.nspname = 'public' desc, n.nspname, c.relname
         limit 300`);
      const version = v.rows[0]?.v.split(' on ')[0] ?? 'PostgreSQL';
      return {
        ok: true, ms: Date.now() - t0, version,
        note: `Connected in ${Date.now() - t0}ms · ${t.rows.length} table${t.rows.length === 1 ? '' : 's'} visible`,
        tables: t.rows.map((r) => ({ schema: r.schema, name: r.name, rows_estimate: r.rows_estimate === null ? null : Number(r.rows_estimate) })),
      };
    });
  } catch (err) {
    return { ok: false, ms: Date.now() - t0, note: friendlyPgError(err) };
  }
}

function friendlyPgError(err: unknown): string {
  const m = err instanceof Error ? err.message : String(err);
  if (/ECONNREFUSED/.test(m)) return 'Connection refused — check the host and port, and that the database accepts remote connections.';
  if (/ENOTFOUND|EAI_AGAIN/.test(m)) return 'Host not found — check the hostname.';
  if (/timeout/i.test(m)) return 'Timed out — the host may be unreachable or a firewall is blocking the port.';
  if (/password authentication failed/i.test(m)) return 'Password authentication failed.';
  if (/does not exist/.test(m) && /database/.test(m)) return m.replace(/^error:\s*/i, '');
  if (/SSL|ssl/.test(m)) return `SSL problem: ${m}. Try toggling SSL.`;
  return m.replace(/^error:\s*/i, '');
}

const MAX_IMPORT_ROWS = 50_000;

/**
 * Only a single SELECT (or WITH…SELECT) is accepted, no statement separators,
 * and it is wrapped in a row cap. The connection is read-only regardless, so
 * this is belt-and-braces rather than the only guard.
 */
export function sanitiseQuery(q: string): string {
  const s = q.trim().replace(/;+\s*$/, '');
  if (!s) throw new Error('Query is empty.');
  if (/;/.test(s)) throw new Error('One statement only — remove the semicolon.');
  if (!/^\s*(select|with)\b/i.test(s)) throw new Error('Only SELECT queries can be imported.');
  if (/\b(insert|update|delete|drop|alter|create|truncate|grant|revoke|copy|vacuum)\b/i.test(s)) {
    throw new Error('Only read-only SELECT queries can be imported.');
  }
  return `select * from (${s}) as azentio_import limit ${MAX_IMPORT_ROWS}`;
}

const qident = (s: string) => `"${s.replace(/"/g, '""')}"`;

export interface ImportResult { datasetId: string; rows: number; columns: number; truncated: boolean }

/** Runs the table/query and lands the result as a dataset, header row first, exactly like a file. */
export async function importFromPostgres(
  sb: Client, userId: string, c: PgConnectionInput,
  target: { table?: string; schema?: string; query?: string },
  sourceId: string | null, name: string,
): Promise<ImportResult> {
  const sql = target.query
    ? sanitiseQuery(target.query)
    : target.table
      ? `select * from ${qident(target.schema ?? 'public')}.${qident(target.table)} limit ${MAX_IMPORT_ROWS}`
      : (() => { throw new Error('Choose a table or write a query.'); })();

  const { fields, rows } = await withClient(c, async (pg) => {
    const r = await pg.query({ text: sql, rowMode: 'array' });
    return { fields: r.fields.map((f) => f.name), rows: r.rows as unknown[][] };
  }, 10_000);

  if (fields.length === 0) throw new Error('The query returned no columns.');

  const grid: RawCell[][] = [fields, ...rows.map((r) => r.map(toCell))];
  const datasetId = await persistUpload(sb, userId, `${name}.pg`, grid, target.table ?? 'query', sourceId);

  if (sourceId) {
    await sb.from('data_sources').update({
      last_imported_at: new Date().toISOString(),
    } as any).eq('id', sourceId);
  }

  return { datasetId, rows: rows.length, columns: fields.length, truncated: rows.length >= MAX_IMPORT_ROWS };
}

/** Postgres driver values → the cell types the structurer understands. */
function toCell(v: unknown): RawCell {
  if (v === null || v === undefined) return null;
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  if (typeof v === 'number' || typeof v === 'boolean') return v;
  if (typeof v === 'bigint') return Number(v);
  if (typeof v === 'object') return JSON.stringify(v);
  return String(v);
}

/* ------------------------------------------------------- saved connections */

export async function saveConnection(
  sb: Client, userId: string, name: string, c: PgConnectionInput, test: TestResult, existingId?: string | null,
): Promise<string> {
  const config: PostgresSourceConfig = { host: c.host, port: c.port, database: c.database, user: c.user, ssl: c.ssl };
  const row = {
    owner_id: userId, kind: 'postgres', name, config,
    secret_enc: c.password ? encryptSecret(c.password) : null,
    last_tested_at: new Date().toISOString(), last_test_ok: test.ok, last_test_note: test.note,
  };
  const r = existingId
    ? await sb.from('data_sources').update(row as any).eq('id', existingId).select('id').single()
    : await sb.from('data_sources').insert(row as any).select('id').single();
  if (r.error || !r.data) throw new Error(r.error?.message ?? 'Could not save the connection.');
  return r.data.id;
}

/** Rebuilds credentials for a saved connection, server-side only. */
export async function connectionFor(sb: Client, sourceId: string): Promise<{ input: PgConnectionInput; source: DataSource }> {
  const { data, error } = await sb.from('data_sources').select('*').eq('id', sourceId).eq('kind', 'postgres').maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) throw new Error('Connection not found.');
  const s = data as DataSource;
  const cfg = s.config as PostgresSourceConfig;
  if (!s.secret_enc) throw new Error('This connection has no saved password — enter it again.');
  return { source: s, input: { host: cfg.host, port: cfg.port, database: cfg.database, user: cfg.user, ssl: cfg.ssl, password: decryptSecret(s.secret_enc) } };
}

export async function recordTest(sb: Client, sourceId: string, test: TestResult): Promise<void> {
  await sb.from('data_sources').update({
    last_tested_at: new Date().toISOString(), last_test_ok: test.ok, last_test_note: test.note,
  } as any).eq('id', sourceId);
}

/* ================================================================ supabase */

/**
 * Supabase over its REST layer (PostgREST). Needs only the project URL and an
 * API key — no database password, no driver, no open port. The schema comes
 * from the OpenAPI document PostgREST publishes at /rest/v1/, which lists
 * every table the key can see with its columns and types.
 *
 * Which key: service_role sees everything and bypasses RLS — right for an
 * owner importing their own data. anon sees only what RLS exposes to the
 * public, which is usually nothing; the schema will come back near-empty.
 */

export interface SupabaseRestInput { url: string; apiKey: string; schema?: string }

export interface SupabaseColumn { name: string; type: string; format: string; required: boolean; description?: string }
export interface SupabaseTable { name: string; columns: SupabaseColumn[]; rows_estimate: number | null }

export function parseSupabaseUrl(raw: string): string {
  let u: URL;
  try { u = new URL(raw.trim()); } catch { throw new Error('Enter the project URL, e.g. https://abcd1234.supabase.co'); }
  if (u.protocol !== 'https:') throw new Error('The Supabase project URL must start with https://');
  if (!/\.supabase\.(co|in|red)$/.test(u.hostname) && process.env.ALLOW_PRIVATE_DB_HOSTS !== 'true') {
    throw new Error('Only Supabase project URLs (…supabase.co) are accepted here.');
  }
  return `${u.protocol}//${u.host}`;
}

const restHeaders = (apiKey: string, schema = 'public') => ({
  apikey: apiKey, Authorization: `Bearer ${apiKey}`, 'Accept-Profile': schema, 'Content-Profile': schema,
});

async function fetchWithTimeout(url: string, init: RequestInit, ms = 10_000): Promise<Response> {
  const c = new AbortController();
  const t = setTimeout(() => c.abort(), ms);
  try { return await fetch(url, { ...init, signal: c.signal }); }
  finally { clearTimeout(t); }
}

/** OpenAPI `format` → the structurer's column vocabulary, for the schema view. */
function pgFormatToType(format: string): string {
  const f = format.toLowerCase();
  if (/timestamp|^date$/.test(f)) return 'date';
  if (/int|numeric|decimal|real|double|money/.test(f)) return 'number';
  if (/bool/.test(f)) return 'boolean';
  if (/json/.test(f)) return 'json';
  if (/uuid/.test(f)) return 'uuid';
  return 'text';
}

export async function supabaseSchema(input: SupabaseRestInput): Promise<TestResult & { tables?: TableInfo[]; detail?: SupabaseTable[] }> {
  const t0 = Date.now();
  const schema = input.schema?.trim() || 'public';
  let base: string;
  try { base = parseSupabaseUrl(input.url); } catch (e) { return { ok: false, ms: 0, note: (e as Error).message }; }
  if (!input.apiKey?.trim()) return { ok: false, ms: 0, note: 'An API key is required (Project Settings → API).' };

  let res: Response;
  try { res = await fetchWithTimeout(`${base}/rest/v1/`, { headers: restHeaders(input.apiKey.trim(), schema) }); }
  catch (e) { return { ok: false, ms: Date.now() - t0, note: /abort/i.test(String(e)) ? 'Timed out reaching the project.' : `Could not reach the project: ${(e as Error).message}` }; }

  if (res.status === 401 || res.status === 403) return { ok: false, ms: Date.now() - t0, note: 'The API key was rejected. Check it is the anon or service_role key for this project.' };
  if (!res.ok) return { ok: false, ms: Date.now() - t0, note: `Supabase answered ${res.status}. Is the URL the project URL (…supabase.co) rather than the dashboard?` };

  let spec: any;
  try { spec = await res.json(); } catch { return { ok: false, ms: Date.now() - t0, note: 'Unexpected response — not a Supabase REST endpoint.' }; }

  const defs: Record<string, any> = spec.definitions ?? spec.components?.schemas ?? {};
  const detail: SupabaseTable[] = Object.entries(defs).map(([name, d]) => {
    const required = new Set<string>(d.required ?? []);
    const columns: SupabaseColumn[] = Object.entries(d.properties ?? {}).map(([col, p]: [string, any]) => ({
      name: col, format: String(p.format ?? p.type ?? ''), type: pgFormatToType(String(p.format ?? p.type ?? '')),
      required: required.has(col), description: p.description,
    }));
    return { name, columns, rows_estimate: null };
  }).sort((a, b) => a.name.localeCompare(b.name));

  // Row estimates: one HEAD per table, in parallel, best effort.
  await Promise.all(detail.slice(0, 60).map(async (t) => {
    try {
      const r = await fetchWithTimeout(`${base}/rest/v1/${encodeURIComponent(t.name)}?select=*`, {
        method: 'HEAD', headers: { ...restHeaders(input.apiKey.trim(), schema), Prefer: 'count=estimated', Range: '0-0' },
      }, 6000);
      const cr = r.headers.get('content-range');
      const total = cr?.split('/')[1];
      if (total && total !== '*') t.rows_estimate = Number(total);
    } catch { /* estimate stays unknown */ }
  }));

  const ref = new URL(base).hostname.split('.')[0];
  return {
    ok: true, ms: Date.now() - t0,
    version: `Supabase · ${ref}`,
    note: `Connected in ${Date.now() - t0}ms · ${detail.length} table${detail.length === 1 ? '' : 's'} in schema "${schema}"` +
      (detail.length === 0 ? ' — with the anon key RLS usually hides everything; use the service_role key to import your own data' : ''),
    tables: detail.map((t) => ({ schema, name: t.name, rows_estimate: t.rows_estimate })),
    detail,
  };
}

const PAGE = 1000;

/** Pulls a table through REST in pages and lands it as a dataset, header row first. */
export async function importFromSupabase(
  sb: Client, userId: string, input: SupabaseRestInput, table: string, sourceId: string | null, name: string,
): Promise<ImportResult> {
  const base = parseSupabaseUrl(input.url);
  const schema = input.schema?.trim() || 'public';
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(table)) throw new Error('Invalid table name.');

  const rows: Record<string, unknown>[] = [];
  for (let from = 0; from < MAX_IMPORT_ROWS; from += PAGE) {
    const r = await fetchWithTimeout(`${base}/rest/v1/${encodeURIComponent(table)}?select=*`, {
      headers: { ...restHeaders(input.apiKey.trim(), schema), Range: `${from}-${from + PAGE - 1}`, 'Range-Unit': 'items' },
    }, 20_000);
    if (r.status === 416) break;                       // past the end
    if (!r.ok) throw new Error(`Supabase answered ${r.status} while reading "${table}".`);
    const page = (await r.json()) as Record<string, unknown>[];
    rows.push(...page);
    if (page.length < PAGE) break;
  }

  // Column order from the first row, widened by any later keys.
  const keys: string[] = [];
  const seen = new Set<string>();
  for (const r of rows) for (const k of Object.keys(r)) if (!seen.has(k)) { seen.add(k); keys.push(k); }
  if (keys.length === 0) throw new Error(`"${table}" returned no rows or no columns the key can read.`);

  const grid: RawCell[][] = [keys, ...rows.map((r) => keys.map((k) => toCell(r[k])))];
  const datasetId = await persistUpload(sb, userId, `${name}.supabase`, grid, table, sourceId);
  if (sourceId) await sb.from('data_sources').update({ last_imported_at: new Date().toISOString() } as any).eq('id', sourceId);
  return { datasetId, rows: rows.length, columns: keys.length, truncated: rows.length >= MAX_IMPORT_ROWS };
}

/** Saved Supabase (REST) connection: URL in config, API key encrypted. */
export async function saveSupabaseConnection(
  sb: Client, userId: string, name: string, input: SupabaseRestInput, test: TestResult, existingId?: string | null,
): Promise<string> {
  const base = parseSupabaseUrl(input.url);
  const row = {
    owner_id: userId, kind: 'postgres', name,
    config: { mode: 'rest', url: base, schema: input.schema?.trim() || 'public', host: new URL(base).hostname, port: 443, database: 'postgres', user: 'api-key', ssl: true },
    secret_enc: encryptSecret(input.apiKey.trim()),
    last_tested_at: new Date().toISOString(), last_test_ok: test.ok, last_test_note: test.note,
  };
  const r = existingId
    ? await sb.from('data_sources').update(row as any).eq('id', existingId).select('id').single()
    : await sb.from('data_sources').insert(row as any).select('id').single();
  if (r.error || !r.data) throw new Error(r.error?.message ?? 'Could not save the connection.');
  return r.data.id;
}

export async function supabaseInputFor(sb: Client, sourceId: string): Promise<SupabaseRestInput> {
  const { data, error } = await sb.from('data_sources').select('*').eq('id', sourceId).maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) throw new Error('Connection not found.');
  const s = data as DataSource;
  const cfg = s.config as unknown as { mode?: string; url?: string; schema?: string };
  if (cfg.mode !== 'rest' || !cfg.url) throw new Error('This saved connection is a connection-string connection, not a project URL.');
  if (!s.secret_enc) throw new Error('This connection has no saved key — enter it again.');
  return { url: cfg.url, apiKey: decryptSecret(s.secret_enc), schema: cfg.schema };
}

/**
 * Supabase-only policy for the connection-string mode. The direct host is
 * db.<ref>.supabase.co and the pooler is *.pooler.supabase.com; anything else
 * is refused unless the dev-only override is set.
 */
export function assertSupabaseHost(host: string): void {
  const h = host.trim().toLowerCase();
  const ok = /\.supabase\.(co|in|red)$/.test(h) || /\.pooler\.supabase\.com$/.test(h);
  if (!ok && process.env.ALLOW_PRIVATE_DB_HOSTS !== 'true') {
    throw new Error('Only Supabase database hosts are accepted here (db.<ref>.supabase.co or the pooler).');
  }
  assertAllowedHost(host);
}
