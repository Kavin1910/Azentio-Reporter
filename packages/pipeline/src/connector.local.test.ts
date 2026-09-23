/**
 * Integration test against a local Postgres on 127.0.0.1:5433 (the scratch
 * cluster). Skipped automatically when it is not running, so CI without a
 * database still passes.
 */
import { describe, it, expect } from 'vitest';
import { testPostgres, importFromPostgres, sanitiseQuery } from './sources';
import type { Client } from './data';

const conn = { host: '127.0.0.1', port: 5433, database: 'customer_bank', user: 'postgres', password: '', ssl: false };
const probe = await testPostgres(conn);
const d = probe.ok ? describe : describe.skip;

d('connector against a live Postgres', () => {
  it('connects, reports the version and lists tables and views', () => {
    expect(probe.version).toMatch(/PostgreSQL/);
    const names = probe.tables!.map((t) => t.name);
    expect(names).toContain('loan_accounts');
    expect(names).toContain('active_loans');
  });

  it('imports a table as a header-first grid through the normal upload path', async () => {
    // A stub client capturing what persistUpload would write.
    const inserted: any[] = [];
    const sb = {
      from: (table: string) => ({
        insert: (rows: any) => {
          inserted.push({ table, rows });
          return { select: () => ({ single: async () => ({ data: { id: 'ds-1' }, error: null }) }) };
        },
        update: () => ({ eq: async () => ({ error: null }) }),
      }),
    } as unknown as Client;

    const r = await importFromPostgres(sb, 'user-1', conn, { table: 'loan_accounts', schema: 'public' }, null, 'customer bank');
    expect(r.datasetId).toBe('ds-1');
    expect(r.rows).toBe(1200);
    expect(r.columns).toBe(9);

    const rawBatches = inserted.filter((i) => i.table === 'raw_rows').flatMap((i) => i.rows);
    expect(rawBatches).toHaveLength(1201);                       // header + 1200 rows
    expect(rawBatches[0].cells).toEqual(['acct_no', 'borrower', 'branch', 'product', 'sanctioned', 'disbursed', 'disbursed_on', 'dpd', 'cibil']);
    // Dates arrive as ISO strings and numerics as strings the parser already understands.
    expect(rawBatches[1].cells[6]).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it('imports a query, read-only, capped', async () => {
    const inserted: any[] = [];
    const sb = { from: (table: string) => ({ insert: (rows: any) => { inserted.push({ table, rows }); return { select: () => ({ single: async () => ({ data: { id: 'ds-2' }, error: null }) }) }; }, update: () => ({ eq: async () => ({ error: null }) }) }) } as unknown as Client;
    const r = await importFromPostgres(sb, 'u', conn, { query: 'select branch, sum(sanctioned) as total from loan_accounts group by branch' }, null, 'by branch');
    expect(r.rows).toBe(4);
    expect(r.columns).toBe(2);
  });

  it('cannot write even if a query slipped past the sanitiser', async () => {
    // default_transaction_read_only is set on every session.
    const sb = { from: () => ({ insert: () => ({ select: () => ({ single: async () => ({ data: { id: 'x' }, error: null }) }) }), update: () => ({ eq: async () => ({ error: null }) }) }) } as unknown as Client;
    await expect(importFromPostgres(sb, 'u', conn, { query: "select 1" }, null, 'ok')).resolves.toBeTruthy();
    expect(() => sanitiseQuery('create table t (a int)')).toThrow();
  });
});
