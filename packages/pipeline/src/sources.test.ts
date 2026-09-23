import { describe, it, expect, beforeAll } from 'vitest';
import {
  encryptSecret, decryptSecret, parseConnectionUrl, sanitiseQuery, testPostgres, isPrivateHost, assertAllowedHost,
} from './sources';

beforeAll(() => { process.env.SOURCE_ENCRYPTION_KEY = 'unit-test-key-0123456789'; });

describe('secret encryption', () => {
  it('round-trips and never stores the plaintext', () => {
    const enc = encryptSecret('s3cret-pass!');
    expect(enc).not.toContain('s3cret');
    expect(decryptSecret(enc)).toBe('s3cret-pass!');
  });

  it('uses a fresh IV each time, so equal passwords do not produce equal ciphertext', () => {
    expect(encryptSecret('same')).not.toBe(encryptSecret('same'));
  });

  it('refuses to decrypt under a different key', () => {
    const enc = encryptSecret('pw');
    process.env.SOURCE_ENCRYPTION_KEY = 'another-key-abcdefghijk';
    expect(() => decryptSecret(enc)).toThrow();
    process.env.SOURCE_ENCRYPTION_KEY = 'unit-test-key-0123456789';
  });
});

describe('parseConnectionUrl', () => {
  it('reads every part of a postgres URL', () => {
    const c = parseConnectionUrl('postgresql://app_user:p%40ss@db.example.com:6543/bank?sslmode=require');
    expect(c).toEqual({ host: 'db.example.com', port: 6543, database: 'bank', user: 'app_user', password: 'p@ss', ssl: true });
  });

  it('defaults the port and infers SSL for Supabase hosts', () => {
    const c = parseConnectionUrl('postgres://u:p@db.abc.supabase.co/postgres');
    expect(c.port).toBe(5432);
    expect(c.ssl).toBe(true);
  });

  it('rejects anything that is not a postgres URL', () => {
    expect(() => parseConnectionUrl('mysql://u:p@h/db')).toThrow(/postgres/);
  });
});

describe('sanitiseQuery', () => {
  it('wraps a SELECT in a row cap', () => {
    expect(sanitiseQuery('select * from loans')).toMatch(/^select \* from \(select \* from loans\) as azentio_import limit \d+$/);
  });

  it('accepts a CTE and tolerates a trailing semicolon', () => {
    expect(() => sanitiseQuery('with x as (select 1) select * from x;')).not.toThrow();
  });

  it('refuses multiple statements and anything that writes', () => {
    expect(() => sanitiseQuery('select 1; drop table loans')).toThrow(/One statement/);
    expect(() => sanitiseQuery('delete from loans')).toThrow(/SELECT/);
    expect(() => sanitiseQuery('select 1 union select 1; update x set a=1')).toThrow();
    expect(() => sanitiseQuery("select * from loans where note = 'drop'")).toThrow(/read-only/);
  });
});

describe('testPostgres (unreachable host)', () => {
  it('returns a friendly failure rather than throwing', async () => {
    const r = await testPostgres({ host: '127.0.0.1', port: 1, database: 'x', user: 'x', password: 'x', ssl: false });
    expect(r.ok).toBe(false);
    expect(r.note).toMatch(/refused|Timed out|unreachable/i);
  }, 15_000);
});

describe('host guard (SSRF)', () => {
  it('recognises private, loopback, link-local and metadata addresses', () => {
    for (const h of ['localhost', '127.0.0.1', '10.0.0.5', '172.16.4.2', '192.168.1.10', '169.254.169.254', '::1', 'metadata.google.internal', '[::1]', 'fd12:3456::1', '100.64.0.1']) {
      expect(isPrivateHost(h), h).toBe(true);
    }
  });

  it('allows public hosts', () => {
    for (const h of ['db.abc.supabase.co', '8.8.8.8', 'ep-cool.neon.tech', '172.32.0.1', '11.0.0.1']) {
      expect(isPrivateHost(h), h).toBe(false);
    }
  });

  it('refuses private hosts unless explicitly allowed', () => {
    const prev = process.env.ALLOW_PRIVATE_DB_HOSTS;
    delete process.env.ALLOW_PRIVATE_DB_HOSTS;
    expect(() => assertAllowedHost('127.0.0.1')).toThrow(/not allowed/);
    expect(() => assertAllowedHost('db.example.com')).not.toThrow();
    process.env.ALLOW_PRIVATE_DB_HOSTS = 'true';
    expect(() => assertAllowedHost('127.0.0.1')).not.toThrow();
    if (prev === undefined) delete process.env.ALLOW_PRIVATE_DB_HOSTS; else process.env.ALLOW_PRIVATE_DB_HOSTS = prev;
  });
});
