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
