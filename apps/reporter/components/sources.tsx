'use client';

import { useState } from 'react';
import type { Dataset } from '@azentio/core';
import { formatDateTime } from '@azentio/core';
import type { PublicSource, TestResult, TableInfo } from '@azentio/pipeline';
import type { PostgresSourceConfig, UploadSourceConfig } from '@azentio/core';
import { Tip, InfoDot } from './tip';
import { Check, Database, FileIcon, Refresh, Trash, X, Alert, TypeGlyph } from './icons';
import { StatusChip } from './status-chip';
import { deleteDataset, deleteSource, importFromConnection, saveConnection, testConnection, type ConnectionForm } from '@/app/actions';

type Run = (fn: () => Promise<unknown>, after?: (r: any) => void) => void;

/* ============================================================ database tab */

type RestCfg = { mode?: 'rest'; url?: string; schema?: string };

function describeSource(s: PublicSource): string {
  const c = s.config as PostgresSourceConfig & RestCfg;
  if (c.mode === 'rest' && c.url) return `${new URL(c.url).hostname} · schema ${c.schema ?? 'public'} · API key`;
  return `${c.user}@${c.host}:${c.port}/${c.database}`;
}

export function DatabaseSource({ sources, run, busy, onImported }: {
  sources: PublicSource[]; run: Run; busy: boolean; onImported: (datasetId: string) => void;
}) {
  const saved = sources.filter((s) => s.kind === 'postgres');
  const [editing, setEditing] = useState<PublicSource | null | 'new'>(saved.length ? null : 'new');

  return (
    <div className="grid gap-5">
      {saved.length > 0 && (
        <div>
          <div className="mb-2 flex items-baseline justify-between">
            <p className="label">Saved Supabase connections</p>
            <Tip text="Add another project"><button className="btn btn-quiet h-[28px] text-[12px]" onClick={() => setEditing('new')}>+ New connection</button></Tip>
          </div>
          <ul className="m-0 grid list-none gap-2 p-0">
            {saved.map((s) => (
              <li key={s.id} className="surface surface-tint flex flex-wrap items-center gap-3 px-4 py-3">
                <SupabaseMark />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[13px] font-medium">{s.name}</p>
                  <p className="truncate font-mono text-[11.5px] text-[var(--color-ink-muted)]">{describeSource(s)}</p>
                  <p className="mt-0.5 text-[11px] text-[var(--color-ink-faint)]">
                    {s.last_tested_at ? <>tested {formatDateTime(s.last_tested_at)} · {s.last_test_ok ? <span className="text-[var(--color-ok-text)]">ok</span> : <span className="text-[var(--color-danger-text)]">failed</span>}</> : 'not tested yet'}
                    {s.last_imported_at && <> · imported {formatDateTime(s.last_imported_at)}</>}
                  </p>
                </div>
                <Tip text="Open this connection to refresh the schema or import a table"><button className="btn btn-ghost h-[30px] px-3 text-[12px]" onClick={() => setEditing(s)}>Open</button></Tip>
                <Tip text="Forget this connection (its key is deleted with it)">
                  <button className="btn btn-quiet h-[30px] text-[var(--color-danger-text)]" disabled={busy} onClick={() => confirm(`Delete connection "${s.name}"?`) && run(() => deleteSource(s.id), () => setEditing(null))}><Trash size={14} /></button>
                </Tip>
              </li>
            ))}
          </ul>
        </div>
      )}
      {editing && (
        <ConnectionEditor source={editing === 'new' ? null : editing} run={run} busy={busy}
          onClose={() => setEditing(saved.length ? null : 'new')} onImported={onImported} />
      )}
    </div>
  );
}

function SupabaseMark() {
  return (
    <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-[8px] bg-[#1c1c1c]" aria-hidden>
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none"><path d="M13 2 4 14h7l-1 8 9-12h-7l1-8z" fill="#3ecf8e" /></svg>
    </span>
  );
}

type Detail = { name: string; columns: Array<{ name: string; type: string; format: string; required: boolean }>; rows_estimate: number | null };

function ConnectionEditor({ source, run, busy, onClose, onImported }: {
  source: PublicSource | null; run: Run; busy: boolean; onClose: () => void; onImported: (id: string) => void;
}) {
  const cfg = (source?.config ?? {}) as PostgresSourceConfig & RestCfg;
  const savedIsRest = cfg.mode === 'rest';
  const [mode, setMode] = useState<'rest' | 'pg'>(source ? (savedIsRest ? 'rest' : 'pg') : 'rest');
  const [name, setName] = useState(source?.name ?? '');
  const [form, setForm] = useState<ConnectionForm>({
    mode: source ? (savedIsRest ? 'rest' : 'pg') : 'rest',
    url: savedIsRest ? cfg.url ?? '' : '', apiKey: '', schema: savedIsRest ? cfg.schema ?? 'public' : 'public',
    connectionString: '', sourceId: source?.id ?? null,
  });
  const [test, setTest] = useState<(TestResult & { detail?: Detail[] }) | null>(null);
  const [testing, setTesting] = useState(false);
  const [target, setTarget] = useState<'table' | 'query'>(cfg.query ? 'query' : 'table');
  const [table, setTable] = useState<string>(cfg.table ?? '');
  const [query, setQuery] = useState<string>(cfg.query ?? '');
  const [datasetName, setDatasetName] = useState('');
  const [importResult, setImportResult] = useState<string | null>(null);

  const field = (k: keyof ConnectionForm, v: string) => setForm((f) => ({ ...f, [k]: v }));
  const payload = (): ConnectionForm => ({ ...form, mode });
  const hasSavedSecret = !!source?.has_secret && ((mode === 'rest') === savedIsRest);
  const canTest = mode === 'rest'
    ? !!form.url?.trim() && (!!form.apiKey?.trim() || hasSavedSecret)
    : !!form.connectionString?.trim() || hasSavedSecret;

  const doTest = () => {
    setTesting(true); setTest(null); setImportResult(null);
    run(() => testConnection(payload()), (r: TestResult & { detail?: Detail[] }) => {
      setTest(r); setTesting(false);
      if (r.ok && r.tables?.length && !table) {
        const first = r.tables.find((t) => t.schema === 'public') ?? r.tables[0]!;
        setTable(`${first.schema}.${first.name}`);
      }
    });
    setTimeout(() => setTesting(false), 20_000);
  };
  const doSave = () => run(() => saveConnection(payload(), name), (r: { sourceId: string; test: TestResult }) => { setForm((f) => ({ ...f, sourceId: r.sourceId })); setTest(r.test); });
  const doImport = () => {
    const [schema, tbl] = table.includes('.') ? table.split('.', 2) : ['public', table];
    run(
      () => importFromConnection(payload(), target === 'table' ? { schema, table: tbl } : { query }, datasetName || (target === 'table' ? tbl! : 'query')),
      (r) => { setImportResult(`Imported ${r.rows.toLocaleString('en-IN')} rows × ${r.columns} columns${r.truncated ? ' (capped at 50,000)' : ''}.`); onImported(r.datasetId); },
    );
  };

  const tables = test?.tables ?? [];
  const detail = test?.detail?.find((d) => `${test?.tables?.find((t) => t.name === d.name)?.schema ?? 'public'}.${d.name}` === table || d.name === table.split('.').pop());

  return (
    <div className="surface p-5">
      <div className="mb-4 flex items-start justify-between gap-4">
        <div className="flex items-start gap-3">
          <SupabaseMark />
          <div>
            <h3 className="text-[14px] font-semibold">{source ? `Supabase · ${source.name}` : 'Connect a Supabase project'}</h3>
            <p className="mt-0.5 text-[12.5px] text-[var(--color-ink-muted)]">Paste the project URL and an API key. The schema is read from the project's REST layer — no database password, no open port. Everything is read-only.</p>
          </div>
        </div>
        <Tip text="Close"><button className="btn btn-quiet" onClick={onClose} aria-label="Close"><X size={15} /></button></Tip>
      </div>

      <div className="mb-3 flex gap-1">
        {(['rest', 'pg'] as const).map((m) => (
          <Tip key={m} text={m === 'rest' ? 'Project URL + API key. Lists tables and imports them; cannot run SQL.' : 'The postgresql:// string from Supabase → Connect. Needed for SQL queries.'}>
            <button onClick={() => { setMode(m); setTest(null); }} className="rounded-full px-3 py-1 text-[12px] font-medium transition"
              style={{ background: mode === m ? 'var(--color-brand)' : 'var(--color-canvas-sunken)', color: mode === m ? '#fff' : 'var(--color-ink-muted)' }}>
              {m === 'rest' ? 'Project URL + API key' : 'Connection string'}
            </button>
          </Tip>
        ))}
      </div>

      {mode === 'rest' ? (
        <div className="grid gap-3 lg:grid-cols-[1.4fr_1.6fr_120px]">
          <label className="block"><span className="label">Project URL</span>
            <Tip text="Supabase → Project Settings → API → Project URL" className="w-full">
              <input className="field mt-1.5 font-mono text-[12.5px]" placeholder="https://abcd1234.supabase.co" value={form.url ?? ''} onChange={(e) => field('url', e.target.value)} autoComplete="off" spellCheck={false} />
            </Tip>
          </label>
          <label className="block"><span className="label">API key</span>
            <Tip text={hasSavedSecret ? 'Leave blank to use the saved key.' : 'service_role sees every table (use it to import your own data). anon sees only what RLS exposes publicly. Stored encrypted; never shown again.'} className="w-full">
              <input type="password" className="field mt-1.5 font-mono text-[12.5px]" placeholder={hasSavedSecret ? '•••••• (saved)' : 'eyJhbGciOi…'} value={form.apiKey ?? ''} onChange={(e) => field('apiKey', e.target.value)} autoComplete="new-password" />
            </Tip>
          </label>
          <label className="block"><span className="label">Schema</span>
            <Tip text="Postgres schema to read. Almost always public." className="w-full">
              <input className="field mt-1.5 font-mono text-[12.5px]" value={form.schema ?? 'public'} onChange={(e) => field('schema', e.target.value)} />
            </Tip>
          </label>
        </div>
      ) : (
        <label className="block"><span className="label">Connection string</span>
          <Tip text="Supabase → Connect → URI (Transaction pooler or Direct). Contains the database password, which is stored encrypted." className="w-full">
            <input type="password" className="field mt-1.5 font-mono text-[12.5px]" placeholder={hasSavedSecret ? '•••••• (saved)' : 'postgresql://postgres.abcd1234:[PASSWORD]@aws-0-ap-south-1.pooler.supabase.com:6543/postgres'} value={form.connectionString ?? ''} onChange={(e) => field('connectionString', e.target.value)} autoComplete="off" />
          </Tip>
        </label>
      )}

      <div className="mt-3 flex flex-wrap items-center gap-3">
        <label className="flex min-w-[220px] flex-1 items-center gap-2 text-[12.5px]"><span className="label">Save as</span>
          <input className="field h-[32px] py-0 text-[12.5px]" value={name} onChange={(e) => setName(e.target.value)} placeholder="connection name" />
        </label>
        <Tip text={mode === 'rest' ? 'Read the schema: every table the key can see, with columns and row counts. Nothing is imported.' : 'Open a read-only session, read the server version and list the tables.'}>
          <button className="btn btn-primary" disabled={busy || !canTest} onClick={doTest}>{testing ? 'Reading schema…' : mode === 'rest' ? 'Get schema' : 'Test connection'}</button>
        </Tip>
        <Tip text="Test and save. The key is encrypted with a server-side key before it is stored.">
          <button className="btn btn-ghost" disabled={busy || !canTest} onClick={doSave}><Check size={14} /> {source ? 'Update' : 'Save'} connection</button>
        </Tip>
      </div>

      {test && (
        <div className="mt-4 flex items-start gap-2 rounded-[var(--radius-sm)] px-3.5 py-2.5 text-[12.5px]"
             style={{ background: test.ok ? 'var(--color-ok-soft)' : 'var(--color-danger-soft)', color: test.ok ? 'var(--color-ok-text)' : 'var(--color-danger-text)' }}>
          {test.ok ? <Check size={15} className="mt-0.5 shrink-0" /> : <Alert size={15} className="mt-0.5 shrink-0" />}
          <div><p className="font-medium">{test.ok ? 'Connected' : 'Could not connect'}</p><p className="mt-0.5 opacity-90">{test.note}{test.version ? ` · ${test.version}` : ''}</p></div>
        </div>
      )}

      {test?.ok && tables.length > 0 && (
        <div className="mt-5 border-t border-[var(--color-line-soft)] pt-4">
          <div className="mb-3 flex items-center gap-1.5"><h4 className="text-[13px] font-semibold">Schema</h4><InfoDot text="Tables the key can read. Pick one to see its columns and import it as a dataset — it then goes through Structure like any file." /></div>

          {mode === 'pg' && (
            <div className="mb-3 flex gap-1">
              {(['table', 'query'] as const).map((m) => (
                <button key={m} onClick={() => setTarget(m)} className="rounded-full px-3 py-1 text-[12px] font-medium transition"
                  style={{ background: target === m ? 'var(--color-brand)' : 'var(--color-canvas-sunken)', color: target === m ? '#fff' : 'var(--color-ink-muted)' }}>
                  {m === 'table' ? 'A table' : 'A SQL query'}
                </button>
              ))}
            </div>
          )}

          {target === 'table' || mode === 'rest' ? (
            <div className="grid gap-4 lg:grid-cols-[1fr_1.2fr]">
              <div className="scroll-thin max-h-[300px] overflow-auto rounded-[var(--radius-sm)] border border-[var(--color-line-soft)]">
                <table className="grid-table">
                  <thead><tr><th>Table</th><th className="num">Rows</th>{test.detail && <th className="num">Columns</th>}</tr></thead>
                  <tbody>
                    {tables.map((t: TableInfo) => {
                      const key = `${t.schema}.${t.name}`;
                      const d = test.detail?.find((x) => x.name === t.name);
                      const active = key === table;
                      return (
                        <tr key={key} onClick={() => setTable(key)} style={{ cursor: 'pointer', background: active ? 'var(--color-brand-soft)' : undefined }} aria-selected={active}>
                          <td className="font-mono text-[12px]" style={{ color: active ? 'var(--color-brand)' : undefined, fontWeight: active ? 600 : undefined }}>{t.name}</td>
                          <td className="num">{t.rows_estimate === null ? '—' : t.rows_estimate.toLocaleString('en-IN')}</td>
                          {test.detail && <td className="num">{d?.columns.length ?? '—'}</td>}
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              <div className="rounded-[var(--radius-sm)] border border-[var(--color-line-soft)] bg-[var(--color-paper-tint)] p-3">
                <p className="label">{detail ? `${detail.name} · ${detail.columns.length} columns` : table ? table : 'Select a table'}</p>
                {detail ? (
                  <ul className="scroll-thin m-0 mt-2 max-h-[248px] list-none overflow-auto p-0">
                    {detail.columns.map((c) => (
                      <li key={c.name} className="flex items-center justify-between gap-3 border-b border-[var(--color-line-soft)] py-1.5 last:border-0">
                        <span className="flex items-center gap-2 font-mono text-[12px]"><TypeGlyph type={c.type === 'json' || c.type === 'uuid' ? 'text' : c.type} />{c.name}{c.required && <span className="text-[var(--color-danger)]" aria-label="required">*</span>}</span>
                        <span className="text-[11px] text-[var(--color-ink-faint)]">{c.format}</span>
                      </li>
                    ))}
                  </ul>
                ) : <p className="mt-2 text-[12.5px] text-[var(--color-ink-muted)]">{mode === 'pg' ? 'Column detail is available in Project URL mode.' : 'Click a table on the left.'}</p>}
              </div>
            </div>
          ) : (
            <label className="block"><span className="label">SELECT query</span>
              <Tip text="One SELECT (or WITH…SELECT). Wrapped in a 50,000-row cap; the session is read-only." className="w-full">
                <textarea className="field mt-1.5 min-h-[88px] font-mono text-[12.5px]" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="select branch, product, sanctioned_amount, disbursed_on from loans where disbursed_on >= '2025-01-01'" />
              </Tip>
            </label>
          )}

          <div className="mt-3 flex flex-wrap items-end gap-3">
            <label className="min-w-[220px] flex-1"><span className="label">Dataset name</span><input className="field mt-1.5" value={datasetName} onChange={(e) => setDatasetName(e.target.value)} placeholder={target === 'table' || mode === 'rest' ? (table.split('.').pop() || 'table') : 'query result'} /></label>
            <Tip text="Read the rows and create the dataset">
              <button className="btn btn-hero" disabled={busy || ((target === 'table' || mode === 'rest') ? !table : !query.trim())} onClick={doImport}><Database size={15} /> Import as dataset</button>
            </Tip>
          </div>
          {importResult && <p className="mt-3 text-[12.5px] text-[var(--color-ok-text)]">{importResult}</p>}
        </div>
      )}
    </div>
  );
}

/* =============================================================== saved tab */

export function SavedDatasets({ datasets, sources, current, run, busy, onOpen }: {
  datasets: Dataset[]; sources: PublicSource[]; current: string | null; run: Run; busy: boolean; onOpen: (id: string) => void;
}) {
  const byId = new Map(sources.map((s) => [s.id, s]));
  if (datasets.length === 0) return <p className="px-2 py-8 text-center text-[13px] text-[var(--color-ink-muted)]">Nothing stored yet. Upload a file or connect a database.</p>;
  return (
    <div className="scroll-thin overflow-auto rounded-[var(--radius-sm)] border border-[var(--color-line-soft)]">
      <table className="grid-table">
        <thead><tr><th>Dataset</th><th>Source</th><th className="num">Raw rows</th><th className="num">Data rows</th><th>Status</th><th>Created</th><th></th></tr></thead>
        <tbody>
          {datasets.map((d) => {
            const src = d.source_id ? byId.get(d.source_id) : null;
            const srcLabel = src
              ? src.kind === 'postgres' ? `${(src.config as PostgresSourceConfig).database}@${(src.config as PostgresSourceConfig).host}` : (src.config as UploadSourceConfig).filename
              : d.source_filename;
            return (
              <tr key={d.id} style={d.id === current ? { background: 'var(--color-brand-soft)' } : undefined}>
                <td className="font-medium text-[var(--color-ink)]">{d.name}</td>
                <td><span className="inline-flex items-center gap-1.5">{src?.kind === 'postgres' ? <Database size={13} className="text-[var(--color-ink-faint)]" /> : <FileIcon size={13} className="text-[var(--color-ink-faint)]" />}<span className="truncate max-w-[260px]">{srcLabel}</span></span></td>
                <td className="num">{d.raw_row_count.toLocaleString('en-IN')}</td>
                <td className="num">{d.status === 'structured' ? d.structured_row_count.toLocaleString('en-IN') : '—'}</td>
                <td><StatusChip status={d.status} /></td>
                <td className="text-[var(--color-ink-muted)]">{formatDateTime(d.created_at)}</td>
                <td className="text-right whitespace-nowrap">
                  {d.id !== current && <Tip text="Make this the active dataset"><button className="btn btn-ghost h-[28px] px-2.5 text-[12px]" onClick={() => onOpen(d.id)}>Open</button></Tip>}
                  <Tip text="Delete this dataset and everything derived from it"><button className="btn btn-quiet h-[28px] text-[var(--color-danger-text)]" disabled={busy} onClick={() => confirm(`Delete "${d.name}"?`) && run(() => deleteDataset(d.id), () => { if (d.id === current) onOpen(''); })}><Trash size={13} /></button></Tip>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

export function SourcesNotice({ error }: { error: string }) {
  return (
    <p className="flex items-start gap-2 rounded-[var(--radius-sm)] bg-[var(--color-pending-soft)] px-3 py-2 text-[12.5px] text-[var(--color-pending-text)]"><Alert size={14} className="mt-0.5 shrink-0" /><span>{error}</span></p>
  );
}

export { Refresh };
