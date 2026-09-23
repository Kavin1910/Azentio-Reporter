import { describe, it, expect, beforeAll } from 'vitest';
import { parseSupabaseUrl, assertSupabaseHost, supabaseSchema, importFromSupabase } from './sources';
import type { Client } from './data';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

beforeAll(() => { process.env.SOURCE_ENCRYPTION_KEY = 'unit-test-key-0123456789'; delete process.env.ALLOW_PRIVATE_DB_HOSTS; });

describe('parseSupabaseUrl', () => {
  it('normalises a project URL', () => {
    expect(parseSupabaseUrl(' https://abcd1234.supabase.co/rest/v1/ ')).toBe('https://abcd1234.supabase.co');
  });
  it('rejects non-Supabase and non-https', () => {
    expect(() => parseSupabaseUrl('https://example.com')).toThrow(/Supabase/);
    expect(() => parseSupabaseUrl('http://abcd.supabase.co')).toThrow(/https/);
    expect(() => parseSupabaseUrl('nonsense')).toThrow(/project URL/);
  });
});

describe('assertSupabaseHost (connection-string mode)', () => {
  it('accepts the direct host and the pooler, refuses everything else', () => {
    expect(() => assertSupabaseHost('db.abcd1234.supabase.co')).not.toThrow();
    expect(() => assertSupabaseHost('aws-0-ap-south-1.pooler.supabase.com')).not.toThrow();
    expect(() => assertSupabaseHost('db.example.com')).toThrow(/Only Supabase/);
    expect(() => assertSupabaseHost('127.0.0.1')).toThrow();
  });
});

// Live: the workspace's own project, read with its service key. Skipped when
// the root .env is absent (CI), so the suite still passes there.
function rootEnv(): Record<string, string> {
  try {
    const out: Record<string, string> = {};
    for (const line of readFileSync(resolve(process.cwd(), '../../.env'), 'utf8').split('\n')) {
      const t = line.trim(); if (!t || t.startsWith('#') || !t.includes('=')) continue;
      const [k, v] = t.split('=', 2); out[k!.trim()] = v!.trim();
    }
    return out;
  } catch { return {}; }
}
const env = rootEnv();
const live = env.NEXT_PUBLIC_SUPABASE_URL && env.SUPABASE_SERVICE_ROLE_KEY ? describe : describe.skip;

live('Supabase REST against a live project', () => {
  const input = { url: env.NEXT_PUBLIC_SUPABASE_URL!, apiKey: env.SUPABASE_SERVICE_ROLE_KEY! };

  it('gets the schema: tables with columns and types', async () => {
    const r = await supabaseSchema(input);
    expect(r.ok, r.note).toBe(true);
    const names = r.tables!.map((t) => t.name);
    expect(names).toContain('report_templates');
    const tpl = r.detail!.find((t) => t.name === 'report_templates')!;
    expect(tpl.columns.map((c) => c.name)).toEqual(expect.arrayContaining(['code', 'name', 'fields', 'position']));
    expect(tpl.columns.find((c) => c.name === 'position')!.type).toBe('number');
    expect(tpl.rows_estimate).toBe(12);
  }, 20_000);

  it('rejects a bad key with a clear message', async () => {
    const r = await supabaseSchema({ ...input, apiKey: 'not-a-key' });
    expect(r.ok).toBe(false);
    expect(r.note).toMatch(/key was rejected/);
  }, 20_000);

  it('imports a table as a header-first grid', async () => {
    const inserted: any[] = [];
    const sb = { from: (table: string) => ({ insert: (rows: any) => { inserted.push({ table, rows }); return { select: () => ({ single: async () => ({ data: { id: 'ds-x' }, error: null }) }) }; }, update: () => ({ eq: async () => ({ error: null }) }) }) } as unknown as Client;
    const r = await importFromSupabase(sb, 'u', input, 'report_templates', null, 'templates');
    expect(r.rows).toBe(12);
    const raw = inserted.filter((i) => i.table === 'raw_rows').flatMap((i) => i.rows);
    expect(raw[0].cells).toEqual(expect.arrayContaining(['code', 'name', 'category']));
    expect(raw).toHaveLength(13);
  }, 30_000);

  it('refuses an invalid table name before touching the network', async () => {
    await expect(importFromSupabase({} as Client, 'u', input, 'x; drop', null, 'n')).rejects.toThrow(/Invalid table/);
  });
});
