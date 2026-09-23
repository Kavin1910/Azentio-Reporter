'use client';

import { useState } from 'react';
import type { Dataset } from '@azentio/core';
import { formatDateTime } from '@azentio/core';
import type { PublicSource, TestResult, TableInfo } from '@azentio/pipeline';
import type { PostgresSourceConfig, UploadSourceConfig } from '@azentio/core';
import { Tip, InfoDot } from './tip';
import { Check, Database, FileIcon, Refresh, Trash, X, Alert } from './icons';
import { StatusChip } from './status-chip';
import { deleteDataset, deleteSource, importFromConnection, saveConnection, testConnection, type ConnectionForm } from '@/app/actions';

type Run = (fn: () => Promise<unknown>, after?: (r: any) => void) => void;

/* ============================================================ database tab */

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
            <p className="label">Saved connections</p>
            <Tip text="Add another database"><button className="btn btn-quiet h-[28px] text-[12px]" onClick={() => setEditing('new')}>+ New connection</button></Tip>
          </div>
          <ul className="m-0 grid list-none gap-2 p-0">
            {saved.map((s) => {
              const c = s.config as PostgresSourceConfig;
              return (
                <li key={s.id} className="surface surface-tint flex flex-wrap items-center gap-3 px-4 py-3">
                  <Database size={16} className="shrink-0 text-[var(--color-ink-faint)]" />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-[13px] font-medium">{s.name}</p>
                    <p className="truncate font-mono text-[11.5px] text-[var(--color-ink-muted)]">{c.user}@{c.host}:{c.port}/{c.database}{c.ssl ? ' · ssl' : ''}</p>
                    <p className="mt-0.5 text-[11px] text-[var(--color-ink-faint)]">
                      {s.last_tested_at ? <>tested {formatDateTime(s.last_tested_at)} · {s.last_test_ok ? <span className="text-[var(--color-ok-text)]">ok</span> : <span className="text-[var(--color-danger-text)]">failed</span>}</> : 'not tested yet'}
                      {s.last_imported_at && <> · imported {formatDateTime(s.last_imported_at)}</>}
                    </p>
                  </div>
                  <Tip text="Open this connection to test it or import a table"><button className="btn btn-ghost h-[30px] px-3 text-[12px]" onClick={() => setEditing(s)}>Open</button></Tip>
                  <Tip text="Forget this connection (its password is deleted with it)">
                    <button className="btn btn-quiet h-[30px] text-[var(--color-danger-text)]" disabled={busy} onClick={() => confirm(`Delete connection "${s.name}"?`) && run(() => deleteSource(s.id), () => setEditing(null))}><Trash size={14} /></button>
                  </Tip>
                </li>
              );
            })}
          </ul>
        </div>
      )}

      {editing && (
        <ConnectionEditor
          source={editing === 'new' ? null : editing}
          run={run} busy={busy}
          onClose={() => setEditing(saved.length ? null : 'new')}
          onImported={onImported}
        />
      )}
    </div>
  );
}

function ConnectionEditor({ source, run, busy, onClose, onImported }: {
  source: PublicSource | null; run: Run; busy: boolean; onClose: () => void; onImported: (id: string) => void;
}) {
  const cfg = (source?.config ?? {}) as Partial<PostgresSourceConfig>;
  const [mode, setMode] = useState<'fields' | 'url'>('fields');
  const [name, setName] = useState(source?.name ?? '');
  const [form, setForm] = useState<ConnectionForm>({
    host: cfg.host ?? '', port: String(cfg.port ?? 5432), database: cfg.database ?? '', user: cfg.user ?? '',
    password: '', ssl: cfg.ssl ?? true, url: '', sourceId: source?.id ?? null,
  });
  const [test, setTest] = useState<TestResult | null>(null);
  const [testing, setTesting] = useState(false);
  const [target, setTarget] = useState<'table' | 'query'>(cfg.query ? 'query' : 'table');
  const [table, setTable] = useState<string>(cfg.table ?? '');
  const [query, setQuery] = useState<string>(cfg.query ?? '');
  const [datasetName, setDatasetName] = useState('');
  const [importResult, setImportResult] = useState<string | null>(null);

  const field = (k: keyof ConnectionForm, v: string | boolean) => setForm((f) => ({ ...f, [k]: v }));
  const canTest = mode === 'url' ? !!form.url?.trim() : !!(form.host && form.database && form.user) && (!!form.password || !!source?.has_secret);

  const doTest = () => {
    setTesting(true); setTest(null); setImportResult(null);
    run(() => testConnection(mode === 'url' ? { url: form.url, sourceId: form.sourceId } : form), (r: TestResult) => {
      setTest(r); setTesting(false);
      if (r.ok && r.tables?.length && !table) {
        const first = r.tables.find((t) => t.schema === 'public') ?? r.tables[0]!;
        setTable(`${first.schema}.${first.name}`);
      }
    });
    setTimeout(() => setTesting(false), 15_000);
  };

  const doSave = () => run(
    () => saveConnection(mode === 'url' ? { url: form.url, sourceId: form.sourceId } : form, name || `${form.database}@${form.host}`),
    (r: { sourceId: string; test: TestResult }) => { setForm((f) => ({ ...f, sourceId: r.sourceId })); setTest(r.test); },
  );

  const doImport = () => {
    const [schema, tbl] = table.includes('.') ? table.split('.', 2) : ['public', table];
    run(
      () => importFromConnection(
        mode === 'url' ? { url: form.url, sourceId: form.sourceId } : form,
        target === 'table' ? { schema, table: tbl } : { query },
        datasetName || (target === 'table' ? tbl! : 'query'),
      ),
      (r) => { setImportResult(`Imported ${r.rows.toLocaleString('en-IN')} rows × ${r.columns} columns${r.truncated ? ' (capped at 50,000)' : ''}.`); onImported(r.datasetId); },
    );
  };

  const tables = test?.tables ?? [];

  return (
    <div className="surface p-5">
      <div className="mb-4 flex items-start justify-between gap-4">
        <div>
          <h3 className="text-[14px] font-semibold">{source ? `Connection · ${source.name}` : 'Connect a database'}</h3>
          <p className="mt-0.5 text-[12.5px] text-[var(--color-ink-muted)]">PostgreSQL, including Supabase, Neon, RDS and self-hosted. The session is opened read-only; only SELECT is ever run.</p>
        </div>
        <Tip text="Close"><button className="btn btn-quiet" onClick={onClose} aria-label="Close"><X size={15} /></button></Tip>
      </div>

      <div className="mb-3 flex gap-1">
        {(['fields', 'url'] as const).map((m) => (
          <button key={m} onClick={() => setMode(m)} className="rounded-full px-3 py-1 text-[12px] font-medium transition"
            style={{ background: mode === m ? 'var(--color-brand)' : 'var(--color-canvas-sunken)', color: mode === m ? '#fff' : 'var(--color-ink-muted)' }}>
            {m === 'fields' ? 'Host & credentials' : 'Connection URL'}
          </button>
        ))}
      </div>

      {mode === 'url' ? (
        <label className="block"><span className="label">postgres:// URL</span>
          <Tip text="e.g. postgresql://user:password@host:5432/dbname?sslmode=require" className="w-full">
            <input className="field mt-1.5 font-mono text-[12.5px]" placeholder="postgresql://user:password@host:5432/dbname" value={form.url ?? ''} onChange={(e) => field('url', e.target.value)} autoComplete="off" />
          </Tip>
        </label>
      ) : (
        <div className="grid gap-3 sm:grid-cols-[2fr_1fr] lg:grid-cols-[2fr_90px_1.4fr_1.2fr_1.2fr]">
          <label className="block"><span className="label">Host</span><Tip text="Hostname or IP of the database server" className="w-full"><input className="field mt-1.5" value={form.host} onChange={(e) => field('host', e.target.value)} placeholder="db.example.com" /></Tip></label>
          <label className="block"><span className="label">Port</span><input className="field mt-1.5 tabular" value={form.port} onChange={(e) => field('port', e.target.value)} /></label>
          <label className="block"><span className="label">Database</span><input className="field mt-1.5" value={form.database} onChange={(e) => field('database', e.target.value)} placeholder="postgres" /></label>
          <label className="block"><span className="label">User</span><input className="field mt-1.5" value={form.user} onChange={(e) => field('user', e.target.value)} autoComplete="off" /></label>
          <label className="block"><span className="label">Password</span>
            <Tip text={source?.has_secret ? 'Leave blank to use the saved password. Stored encrypted; never shown again.' : 'Stored encrypted on the server; never sent back to the browser.'} className="w-full">
              <input type="password" className="field mt-1.5" value={form.password ?? ''} onChange={(e) => field('password', e.target.value)} placeholder={source?.has_secret ? '•••••• (saved)' : ''} autoComplete="new-password" />
            </Tip>
          </label>
        </div>
      )}

      <div className="mt-3 flex flex-wrap items-center gap-4">
        {mode === 'fields' && (
          <Tip text="Most hosted databases require SSL; local ones usually do not">
            <label className="flex items-center gap-2 text-[12.5px]"><input type="checkbox" checked={!!form.ssl} onChange={(e) => field('ssl', e.target.checked)} /> Use SSL</label>
          </Tip>
        )}
        <label className="flex min-w-[200px] flex-1 items-center gap-2 text-[12.5px]"><span className="label">Save as</span>
          <input className="field h-[32px] py-0 text-[12.5px]" value={name} onChange={(e) => setName(e.target.value)} placeholder={form.database && form.host ? `${form.database}@${form.host}` : 'connection name'} />
        </label>
        <Tip text="Open a connection, read the server version and list the tables. Nothing is written or imported.">
          <button className="btn btn-ghost" disabled={busy || !canTest} onClick={doTest}>{testing ? 'Testing…' : 'Test connection'}</button>
        </Tip>
        <Tip text="Test and save. The password is encrypted with a server-side key before it is stored.">
          <button className="btn btn-primary" disabled={busy || !canTest} onClick={doSave}><Check size={14} /> {source ? 'Update' : 'Save'} connection</button>
        </Tip>
      </div>

      {test && (
        <div className="mt-4 flex items-start gap-2 rounded-[var(--radius-sm)] px-3.5 py-2.5 text-[12.5px]"
             style={{ background: test.ok ? 'var(--color-ok-soft)' : 'var(--color-danger-soft)', color: test.ok ? 'var(--color-ok-text)' : 'var(--color-danger-text)' }}>
          {test.ok ? <Check size={15} className="mt-0.5 shrink-0" /> : <Alert size={15} className="mt-0.5 shrink-0" />}
          <div><p className="font-medium">{test.ok ? 'Connected' : 'Connection failed'}</p><p className="mt-0.5 opacity-90">{test.note}{test.version ? ` · ${test.version}` : ''}</p></div>
        </div>
      )}

      {test?.ok && (
        <div className="mt-5 border-t border-[var(--color-line-soft)] pt-4">
          <div className="mb-3 flex items-center gap-1.5"><h4 className="text-[13px] font-semibold">Import</h4><InfoDot text="The result lands as a new dataset, exactly like an uploaded file, and goes through Structure like any other source." /></div>
          <div className="mb-3 flex gap-1">
            {(['table', 'query'] as const).map((m) => (
              <button key={m} onClick={() => setTarget(m)} className="rounded-full px-3 py-1 text-[12px] font-medium transition"
                style={{ background: target === m ? 'var(--color-brand)' : 'var(--color-canvas-sunken)', color: target === m ? '#fff' : 'var(--color-ink-muted)' }}>
                {m === 'table' ? 'A table' : 'A SQL query'}
              </button>
            ))}
          </div>
          {target === 'table' ? (
            <label className="block"><span className="label">Table or view</span>
              <Tip text="Tables and views the connected user can see, with the planner's row estimate" className="w-full">
                <select className="field mt-1.5 font-mono text-[12.5px]" value={table} onChange={(e) => setTable(e.target.value)}>
                  {tables.map((t: TableInfo) => <option key={`${t.schema}.${t.name}`} value={`${t.schema}.${t.name}`}>{t.schema}.{t.name}{t.rows_estimate !== null ? ` · ~${t.rows_estimate.toLocaleString('en-IN')} rows` : ''}</option>)}
                </select>
              </Tip>
            </label>
          ) : (
            <label className="block"><span className="label">SELECT query</span>
              <Tip text="One SELECT (or WITH…SELECT). Wrapped in a 50,000-row cap; the session is read-only." className="w-full">
                <textarea className="field mt-1.5 min-h-[88px] font-mono text-[12.5px]" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="select branch, product, sanctioned, disbursed_on from loan_accounts where disbursed_on >= '2025-01-01'" />
              </Tip>
            </label>
          )}
          <div className="mt-3 flex flex-wrap items-end gap-3">
            <label className="min-w-[220px] flex-1"><span className="label">Dataset name</span><input className="field mt-1.5" value={datasetName} onChange={(e) => setDatasetName(e.target.value)} placeholder={target === 'table' ? table.split('.').pop() : 'query result'} /></label>
            <Tip text="Run the read and create the dataset">
              <button className="btn btn-hero" disabled={busy || (target === 'table' ? !table : !query.trim())} onClick={doImport}><Database size={15} /> Import as dataset</button>
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
