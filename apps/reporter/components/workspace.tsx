'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useRef, useState, useTransition, type DragEvent } from 'react';
import type { ColumnType, DatasetColumn } from '@azentio/core';
import { Tip, InfoDot } from './tip';
import { Logo, Mark } from './logo';
import { StatusChip } from './status-chip';
import { DatabaseSource, SavedDatasets, SourcesNotice } from './sources';
import { Database as DbIcon } from './icons';
import { Alert, ArrowLeft, ArrowRight, Check, FileIcon, Pencil, Refresh, Sparkle, Trash, TypeGlyph, Upload, X, ChevronDown, PanelLeft } from './icons';
import { formatCell } from '@/lib/format';
import { MappingPanel, TemplateGrid, CustomisationQueue } from './mapping';
import { ReportPanel } from './report';
import { ChatWidget } from './chat-widget';
import type { WorkspaceData } from './types';
import { deleteDataset, loadSampleDataset, renameColumn, selectTemplate, structureDataset, updateColumn, uploadDataset } from '@/app/actions';

/* ------------------------------------------------------------------ shell */

export type Step = 'source' | 'schema' | 'template' | 'mapping' | 'review' | 'report';

const STEPS: Array<{ key: Step; n: number; label: string; blurb: string }> = [
  { key: 'source',   n: 1, label: 'Source',               blurb: 'Upload a spreadsheet and press Structure.' },
  { key: 'schema',   n: 2, label: 'Structured schema',    blurb: 'The canonical columns. Rename, relabel or retype them.' },
  { key: 'template', n: 3, label: 'Template',             blurb: 'Pick the report to build.' },
  { key: 'mapping',  n: 4, label: 'Mapping',              blurb: 'Template fields ← your columns. Drag to change.' },
  { key: 'review',   n: 5, label: 'Customisation Layer',  blurb: 'Approve, reject or override every uncertain decision.' },
  { key: 'report',   n: 6, label: 'Report',               blurb: 'Filter by date range and generate.' },
];

/** Where the user most plausibly needs to be next, given the state of the work. */
function defaultStep(d: WorkspaceData): Step {
  if (!d.dataset || d.dataset.status !== 'structured') return 'source';
  if (!d.selectedTemplate) return 'template';
  if (d.customisations.some((c) => c.status === 'pending')) return 'review';
  return 'report';
}

export function Workspace({ data, step: requested }: { data: WorkspaceData; step?: string }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);

  // Sidebar can shrink to an icon rail. Remembered per browser.
  const [collapsed, setCollapsed] = useState(false);
  useEffect(() => { try { setCollapsed(localStorage.getItem('az.sidebar') === 'rail'); } catch { /* storage blocked */ } }, []);
  const toggleSidebar = () => setCollapsed((v) => { try { localStorage.setItem('az.sidebar', v ? 'full' : 'rail'); } catch { /* ignore */ } return !v; });

  // Actions return { ok, data | error } rather than throwing (production
  // redacts thrown messages). Unwrap here so call sites receive the data.
  const run = useCallback((fn: () => Promise<unknown>, after?: (r: any) => void) => {
    setError(null);
    start(async () => {
      try {
        const r = (await fn()) as { ok: boolean; data?: unknown; error?: string } | undefined;
        if (r && typeof r === 'object' && 'ok' in r) {
          if (!r.ok) { setError(r.error ?? 'Something went wrong.'); return; }
          after?.(r.data);
        } else after?.(r);
        router.refresh();
      } catch (e) { setError(e instanceof Error ? e.message : 'Something went wrong.'); }
    });
  }, [router]);

  const ds = data.dataset;
  const structured = ds?.status === 'structured';
  const hasTemplate = !!data.selectedTemplate;
  const pendingAll = data.customisations.filter((c) => c.status === 'pending').length;
  const pendingMapping = data.customisations.filter((c) => c.status === 'pending' && c.mapping_id !== null).length;

  const locked = (k: Step): boolean =>
    (k !== 'source' && !structured) || ((k === 'mapping' || k === 'report') && !hasTemplate);

  const wanted = STEPS.some((s) => s.key === requested) ? (requested as Step) : defaultStep(data);
  const step: Step = locked(wanted) ? defaultStep(data) : wanted;

  const navigate = (params: Record<string, string | null>) => {
    const next = { ds: ds?.id ?? null, tpl: data.selectedTemplate?.code ?? null, step, ...params };
    const q = new URLSearchParams();
    if (next.ds) q.set('ds', next.ds);
    if (next.tpl) q.set('tpl', next.tpl);
    if (next.step) q.set('step', next.step);
    router.push(`/?${q.toString()}`);
  };
  const go = (k: Step) => navigate({ step: k });

  const done = (k: Step): boolean =>
    k === 'source' ? !!structured
    : k === 'schema' ? !!structured
    : k === 'template' ? hasTemplate
    : k === 'mapping' ? hasTemplate && pendingMapping === 0
    : k === 'review' ? !!structured && pendingAll === 0
    : !!data.latestReport;

  const current = STEPS.find((s) => s.key === step)!;

  return (
    <div className={`min-h-screen lg:grid ${collapsed ? 'lg:grid-cols-[72px_minmax(0,1fr)]' : 'lg:grid-cols-[264px_minmax(0,1fr)]'}`} style={{ transition: 'grid-template-columns .2s ease' }}>
      {/* ------------------------------------------------------------ sidebar */}
      <aside className="no-print flex flex-col border-b border-[var(--color-line)] bg-[var(--color-paper)] lg:sticky lg:top-0 lg:h-screen lg:border-b-0 lg:border-r" data-collapsed={collapsed || undefined}>
        <div className={`flex items-center pb-3 pt-4 ${collapsed ? 'justify-center px-2' : 'justify-between px-4'}`}>
          <Link href="/" aria-label="Azentio Reporter home">{collapsed ? <Mark size={30} className="rounded-[8px] shadow-[var(--shadow-sm)]" /> : <Logo compact />}</Link>
          {!collapsed && (
            <Tip text="Collapse the sidebar" side="bottom"><button className="btn btn-quiet hidden h-8 w-8 p-0 lg:inline-flex" onClick={toggleSidebar} aria-label="Collapse sidebar" aria-expanded="true"><PanelLeft size={16} /></button></Tip>
          )}
        </div>
        {collapsed && (
          <div className="hidden justify-center pb-2 lg:flex">
            <Tip text="Expand the sidebar"><button className="btn btn-quiet h-8 w-8 p-0" onClick={toggleSidebar} aria-label="Expand sidebar" aria-expanded="false"><PanelLeft size={16} style={{ transform: 'scaleX(-1)' }} /></button></Tip>
          </div>
        )}

        <div className={`px-4 pb-4 ${collapsed ? 'lg:hidden' : ''}`}>
          <span className="label">Dataset</span>
          <Tip text="Switch between the files you have uploaded" side="bottom" className="mt-1.5 w-full">
            <span className="relative inline-flex w-full">
              <select
                className="field h-[36px] w-full appearance-none py-0 pr-8 text-[12.5px]"
                value={ds?.id ?? ''}
                onChange={(e) => navigate({ ds: e.target.value || null, tpl: null, step: 'source' })}
                aria-label="Dataset"
              >
                {data.datasets.length === 0 && <option value="">No datasets yet</option>}
                {data.datasets.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
              </select>
              <ChevronDown size={14} className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 text-[var(--color-ink-faint)]" />
            </span>
          </Tip>
          {ds && (
            <div className="mt-2 flex flex-wrap items-center gap-1.5">
              <StatusChip status={ds.status} />
              {data.selectedTemplate && <Tip text="Selected template" side="bottom"><span className="chip chip-neutral">{data.selectedTemplate.name}</span></Tip>}
            </div>
          )}
        </div>

        <nav aria-label="Workflow" className="flex-1 overflow-y-auto px-2 lg:px-3">
          <ol className="m-0 flex list-none gap-1 overflow-x-auto p-0 lg:block lg:space-y-0.5">
            {STEPS.map((s) => {
              const isLocked = locked(s.key);
              const isCurrent = s.key === step;
              const isDone = !isLocked && done(s.key);
              const badge =
                s.key === 'review' && pendingAll > 0 ? pendingAll
                : s.key === 'mapping' && pendingMapping > 0 ? pendingMapping
                : null;
              const tip = isLocked
                ? (s.key === 'mapping' || s.key === 'report' ? 'Pick a template first' : 'Structure the dataset first')
                : s.blurb;
              return (
                <li key={s.key}>
                  <Tip text={collapsed ? `${s.n}. ${s.label}${badge ? ` · ${badge} pending` : ''} — ${tip}` : tip} side={collapsed ? 'top' : 'bottom'} className="w-full">
                    <button
                      onClick={() => !isLocked && go(s.key)}
                      disabled={isLocked}
                      aria-current={isCurrent ? 'step' : undefined}
                      aria-label={collapsed ? s.label : undefined}
                      className={`flex w-full items-center gap-3 rounded-[var(--radius-sm)] py-2 text-left transition disabled:cursor-not-allowed ${collapsed ? 'justify-center px-0' : 'px-2.5'}`}
                      style={{
                        background: isCurrent ? 'var(--color-brand-soft)' : 'transparent',
                        opacity: isLocked ? 0.45 : 1,
                      }}
                    >
                      <span
                        className="relative flex h-[22px] w-[22px] shrink-0 items-center justify-center rounded-full text-[10.5px] font-semibold tabular"
                        style={{
                          background: isCurrent ? 'var(--color-brand)' : isDone ? 'var(--color-ok-soft)' : 'var(--color-canvas-sunken)',
                          color: isCurrent ? '#fff' : isDone ? 'var(--color-ok-text)' : 'var(--color-ink-muted)',
                        }}
                      >
                        {isDone && !isCurrent ? <Check size={12} /> : s.n}
                        {badge !== null && collapsed && <span aria-hidden className="absolute -right-0.5 -top-0.5 h-2.5 w-2.5 rounded-full border-2 border-[var(--color-paper)] bg-[var(--color-pending)]" />}
                      </span>
                      {!collapsed && (
                        <span className="min-w-0 flex-1 truncate text-[13px]" style={{ color: isCurrent ? 'var(--color-brand)' : 'var(--color-ink)', fontWeight: isCurrent ? 600 : 500 }}>
                          {s.label}
                        </span>
                      )}
                      {badge !== null && !collapsed && (
                        <span className="chip chip-pending tabular" style={{ padding: '1px 7px' }}>{badge}</span>
                      )}
                    </button>
                  </Tip>
                </li>
              );
            })}
          </ol>
        </nav>

        <div className={`hidden items-center gap-2 border-t border-[var(--color-line-soft)] py-3 lg:flex ${collapsed ? 'justify-center px-2' : 'justify-between px-4'}`}>
          {!collapsed && <span className="truncate text-[12.5px] text-[var(--color-ink-muted)]">{data.profile.full_name}</span>}
          <form action="/auth/signout" method="post">
            <Tip text={collapsed ? `Sign out (${data.profile.full_name})` : 'Sign out of the workspace'}>
              <button className="btn btn-quiet text-[12.5px]" aria-label="Sign out">{collapsed ? <ArrowLeft size={15} /> : 'Sign out'}</button>
            </Tip>
          </form>
        </div>
      </aside>

      {/* --------------------------------------------------------------- main */}
      <div className="min-w-0 pb-28">
        {pending && <div className="h-[2px] w-full overflow-hidden bg-[var(--color-line-soft)]"><div className="h-full w-1/3 bg-[var(--color-accent)] pulsing" /></div>}

        <header className="mx-auto flex max-w-[1180px] items-end justify-between gap-6 px-6 pb-4 pt-7 lg:px-10">
          <div>
            <p className="label">Step {current.n} of {STEPS.length}</p>
            <h1 className="display mt-1 text-[26px] leading-tight text-[var(--color-ink)]">{current.label}</h1>
            <p className="mt-1 text-[13px] text-[var(--color-ink-muted)]">{current.blurb}</p>
          </div>
          <StepNav step={step} go={go} locked={locked} />
        </header>

        {error && (
          <div role="alert" className="mx-auto max-w-[1180px] px-6 lg:px-10">
            <div className="mb-4 flex items-start gap-2 rounded-[var(--radius)] border border-[var(--color-danger-soft)] bg-[var(--color-danger-soft)] px-4 py-3 text-[13px] text-[var(--color-danger-text)]">
              <Alert size={15} className="mt-0.5 shrink-0" />
              <span className="flex-1">{error}</span>
              <button onClick={() => setError(null)} aria-label="Dismiss" className="opacity-70 hover:opacity-100"><X size={14} /></button>
            </div>
          </div>
        )}

        <main className="mx-auto max-w-[1180px] px-6 lg:px-10">
          {step === 'source' && <SourceZone data={data} run={run} busy={pending} onStructured={() => go('schema')} />}
          {step === 'schema' && <StructuredZone data={data} run={run} />}
          {step === 'template' && (
            <TemplateGrid
              templates={data.templates}
              selected={data.selectedTemplate?.code ?? null}
              onSelect={(code) => run(() => selectTemplate(ds!.id, code), () => navigate({ tpl: code, step: 'mapping' }))}
            />
          )}
          {step === 'mapping' && data.selectedTemplate && <MappingPanel data={data} run={run} />}
          {step === 'review' && <CustomisationQueue data={data} run={run} />}
          {step === 'report' && data.selectedTemplate && <ReportPanel data={data} run={run} busy={pending} />}
        </main>
      </div>

      {ds && structured && <ChatWidget datasetId={ds.id} datasetName={ds.name} />}
    </div>
  );
}

/** Previous / next, so the workflow reads as a sequence and not just a menu. */
function StepNav({ step, go, locked }: { step: Step; go: (k: Step) => void; locked: (k: Step) => boolean }) {
  const i = STEPS.findIndex((s) => s.key === step);
  const prev = STEPS[i - 1];
  const next = STEPS[i + 1];
  return (
    <div className="no-print flex shrink-0 items-center gap-2">
      {prev && (
        <Tip text={prev.label}><button className="btn btn-ghost h-[34px] px-3 text-[12.5px]" onClick={() => go(prev.key)}><ArrowLeft size={14} /> Back</button></Tip>
      )}
      {next && (
        <Tip text={locked(next.key) ? (next.key === 'mapping' || next.key === 'report' ? 'Pick a template first' : 'Structure the dataset first') : next.label}>
          <button className="btn btn-primary h-[34px] px-3 text-[12.5px]" disabled={locked(next.key)} onClick={() => go(next.key)}>{next.label} <ArrowRight size={14} /></button>
        </Tip>
      )}
    </div>
  );
}

/* --------------------------------------------------------------- zone 1 */

function SourceZone({ data, run, busy, onStructured }: { data: WorkspaceData; run: (fn: () => Promise<unknown>, after?: (r: any) => void) => void; busy: boolean; onStructured?: () => void }) {
  const router = useRouter();
  const [over, setOver] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const ds = data.dataset;
  const [tab, setTab] = useState<'upload' | 'database' | 'saved'>(ds ? 'saved' : 'upload');

  const openDataset = (id: string) => router.push(id ? `/?ds=${id}&step=source` : '/?step=source');
  const onFile = (file: File | undefined) => {
    if (!file) return;
    const fd = new FormData(); fd.set('file', file);
    run(() => uploadDataset(fd), (r) => openDataset(r.datasetId));
  };
  const onDrop = (e: DragEvent) => { e.preventDefault(); setOver(false); onFile(e.dataTransfer.files?.[0]); };

  const excluded = new Set<number>();
  for (const c of data.customisations) {
    if (c.kind === 'row_exclusion') for (const i of (c.override ?? c.proposal as any).row_indexes ?? []) excluded.add(i);
  }
  const headerIdx = ds?.header_row_index ?? null;
  const rawWidth = Math.max(0, ...data.rawPreview.map((r) => r.cells.length));
  const dbSources = data.sources.filter((x) => x.kind === 'postgres').length;

  const TABS: Array<{ key: typeof tab; label: string; tip: string; count?: number }> = [
    { key: 'upload',   label: 'Upload a file',      tip: 'Drop a .xlsx or .csv, or load a sample' },
    { key: 'database', label: 'Connect a database', tip: 'Read a table or query from your own PostgreSQL', count: dbSources || undefined },
    { key: 'saved',    label: 'Saved datasets',     tip: 'Everything already stored in the platform database', count: data.datasets.length || undefined },
  ];

  return (
    <div className="grid gap-5">
      <section className="surface overflow-hidden">
        <header className="flex items-center gap-1 border-b border-[var(--color-line-soft)] px-3 py-2">
          {TABS.map((t) => (
            <Tip key={t.key} text={t.tip} side="bottom">
              <button onClick={() => setTab(t.key)} className="flex items-center gap-2 rounded-[var(--radius-sm)] px-3 py-2 text-[13px] font-medium transition"
                style={{ background: tab === t.key ? 'var(--color-brand-soft)' : 'transparent', color: tab === t.key ? 'var(--color-brand)' : 'var(--color-ink-muted)' }}>
                {t.key === 'upload' ? <Upload size={14} /> : t.key === 'database' ? <DbIcon size={14} /> : <FileIcon size={14} />}
                {t.label}
                {t.count !== undefined && <span className="tabular rounded-full bg-[var(--color-canvas-sunken)] px-1.5 text-[10.5px] text-[var(--color-ink-muted)]">{t.count}</span>}
              </button>
            </Tip>
          ))}
        </header>
        <input ref={inputRef} type="file" accept=".xlsx,.csv" className="hidden" onChange={(e) => onFile(e.target.files?.[0])} />

        <div className="p-5">
          {data.sourcesError && tab !== 'upload' && <div className="mb-4"><SourcesNotice error={data.sourcesError} /></div>}

          {tab === 'upload' && (
            <>
              <div
                className={`dropzone ${over ? 'dropzone-active' : ''} flex flex-col items-center justify-center px-6 py-10 text-center`}
                onDragOver={(e) => { e.preventDefault(); setOver(true); }} onDragLeave={() => setOver(false)} onDrop={onDrop}
              >
                <span className="mb-3 flex h-11 w-11 items-center justify-center rounded-full bg-[var(--color-brand-soft)] text-[var(--color-brand)]"><Upload size={18} /></span>
                <p className="text-[14px] font-medium">Drop a spreadsheet here</p>
                <p className="mt-1 text-[12.5px] text-[var(--color-ink-muted)]">.xlsx or .csv, up to 10 MB. It is stored as uploaded and shows under Saved datasets.</p>
                <Tip text="Choose a file from your computer" className="mt-4"><button className="btn btn-ghost" onClick={() => inputRef.current?.click()} disabled={busy}>Browse files</button></Tip>
              </div>
              <p className="label mt-6 mb-2.5">Or load a sample</p>
              <div className="grid gap-2 sm:grid-cols-2">
                {data.sampleFiles.map((f) => (
                  <Tip key={f} text={SAMPLE_TIPS[f] ?? 'Load this sample file'} className="w-full">
                    <button className="surface surface-tint flex w-full items-center gap-3 px-3.5 py-3 text-left transition hover:border-[var(--color-sage-500)] hover:shadow-[var(--shadow-sm)]" disabled={busy}
                      onClick={() => run(() => loadSampleDataset(f), (r) => openDataset(r.datasetId))}>
                      <FileIcon size={16} className="shrink-0 text-[var(--color-ink-faint)]" />
                      <span className="min-w-0"><span className="block truncate text-[13px] font-medium">{f}</span><span className="block truncate text-[11.5px] text-[var(--color-ink-muted)]">{SAMPLE_TIPS[f]}</span></span>
                    </button>
                  </Tip>
                ))}
              </div>
            </>
          )}

          {tab === 'database' && (
            <DatabaseSource sources={data.sources} run={run} busy={busy} onImported={openDataset} />
          )}

          {tab === 'saved' && (
            <SavedDatasets datasets={data.datasets} sources={data.sources} current={ds?.id ?? null} run={run} busy={busy} onOpen={openDataset} />
          )}
        </div>
      </section>

      {ds && (
        <section className="surface overflow-hidden">
          <header className="flex items-center gap-3 border-b border-[var(--color-line-soft)] px-5 py-3">
            <h2 className="text-[13px] font-semibold">Active dataset</h2>
            <InfoDot text="The file exactly as parsed — nothing is cleaned until you press Structure. Junk rows are hatched; the detected header is bold." side="bottom" />
            <span className="ml-auto" />
            <Tip text="Delete this dataset and everything derived from it" side="bottom">
              <button className="btn btn-quiet h-[32px] text-[var(--color-danger-text)]" disabled={busy}
                onClick={() => { if (confirm(`Delete "${ds.name}" and all its reports?`)) run(() => deleteDataset(ds.id), () => openDataset('')); }}><Trash size={14} /></button>
            </Tip>
          </header>
          <div className="flex flex-wrap items-center gap-x-5 gap-y-2 px-5 py-3 text-[12.5px] text-[var(--color-ink-muted)]">
            <span className="flex items-center gap-1.5 text-[var(--color-ink)]"><FileIcon size={14} className="text-[var(--color-ink-faint)]" />{ds.source_filename}{ds.sheet_name ? ` · ${ds.sheet_name}` : ''}</span>
            <span className="tabular">{ds.raw_row_count.toLocaleString('en-IN')} raw rows</span>
            {ds.status === 'structured' && <span className="tabular">{ds.structured_row_count.toLocaleString('en-IN')} data rows</span>}
            {headerIdx !== null && <span>header on row {headerIdx + 1}</span>}
          </div>
          <div className="scroll-thin max-h-[260px] overflow-auto border-t border-[var(--color-line-soft)]">
            <table className="grid-table">
              <thead><tr><th className="w-[46px]">#</th>{Array.from({ length: rawWidth }).map((_, i) => <th key={i}>{colLetter(i)}</th>)}</tr></thead>
              <tbody>
                {data.rawPreview.map((r) => {
                  const isHeader = headerIdx === r.row_index;
                  const isJunk = (headerIdx !== null && r.row_index < headerIdx) || excluded.has(r.row_index) || r.cells.every((c) => c === null || c === '');
                  return (
                    <tr key={r.row_index} className={isJunk && !isHeader ? 'raw-junk' : ''} style={isHeader ? { fontWeight: 600 } : undefined}>
                      <td className="num text-[var(--color-ink-faint)]">{r.row_index + 1}</td>
                      {Array.from({ length: rawWidth }).map((_, i) => <td key={i} className="max-w-[220px] truncate">{r.cells[i] === null || r.cells[i] === undefined ? '' : String(r.cells[i])}</td>)}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <div className="flex flex-wrap items-center justify-between gap-3 border-t border-[var(--color-line-soft)] bg-[var(--color-paper-tint)] px-5 py-4">
            <p className="max-w-[560px] text-[12.5px] leading-relaxed text-[var(--color-ink-muted)]">
              {ds.status === 'structured'
                ? <>Structured{ds.structure_model && ds.structure_model !== 'heuristic' ? ' with model assistance' : ''}. {ds.structure_notes?.split('\n').slice(0, 2).join(' ')}</>
                : <>Reads the sheet, finds the real header, drops title and totals rows, normalises column names, infers types and parses every value. Anything uncertain is queued for your approval rather than guessed.</>}
            </p>
            <Tip text={ds.status === 'structured' ? 'Run the structurer again from the raw data. Existing approvals for this dataset are cleared.' : 'Read the unstructured data and put it into a canonical schema'}>
              <button className={ds.status === 'structured' ? 'btn btn-ghost' : 'btn btn-hero'} disabled={busy} onClick={() => run(() => structureDataset(ds.id), () => onStructured?.())}>
                {ds.status === 'structured' ? <><Refresh size={14} /> Re-run structure</> : <><Sparkle size={15} /> Structure</>}
              </button>
            </Tip>
          </div>
        </section>
      )}
    </div>
  );
}

const SAMPLE_TIPS: Record<string, string> = {
  'loan_master_2024.xlsx': 'Title rows, free-text borrower column, three date formats, totals row',
  'repayments_q1.csv': 'Different column names, US date order, numbers as text',
  'branch_collections.xlsx': 'Two-row merged header, regional subtotals, grand total',
  'bureau_extract.xlsx': 'UPPER_SNAKE headers, mixed DOB formats, eight spellings of gender',
};

const colLetter = (i: number) => { let s = ''; i++; while (i > 0) { const m = (i - 1) % 26; s = String.fromCharCode(65 + m) + s; i = Math.floor((i - 1) / 26); } return s; };

/* --------------------------------------------------------------- zone 2 */

const TYPES: ColumnType[] = ['text', 'number', 'currency', 'date', 'boolean'];

function StructuredZone({ data, run }: { data: WorkspaceData; run: (fn: () => Promise<unknown>) => void }) {
  const [editing, setEditing] = useState<DatasetColumn | null>(null);
  const renames = new Map<string, string>();
  for (const c of data.customisations) if (c.kind === 'column_rename' && c.status === 'approved') renames.set(c.target_key, ((c.override ?? c.proposal) as any).to);

  return (
    <section className="surface overflow-hidden">
      <header className="flex items-center gap-3 border-b border-[var(--color-line-soft)] px-5 py-3">
        <h2 className="text-[13px] font-semibold">Structured schema</h2>
        <InfoDot text="The canonical columns the structurer produced. Click a column to rename it, change its label or type. Renames are recorded as approved customisations so the original key is never lost." side="bottom" />
        <span className="ml-auto text-[12px] text-[var(--color-ink-muted)]">{data.columns.length} columns</span>
      </header>

      <div className="flex flex-wrap gap-1.5 px-5 py-3.5">
        {data.columns.map((c) => {
          const renamed = renames.get(c.key);
          return (
            <Tip key={c.id} text={`${c.source_header ?? c.key} → ${renamed ?? c.key} · ${c.data_type}${c.null_count ? ` · ${c.null_count} blank` : ''}. Click to edit.`}>
              <button onClick={() => setEditing(c)} className="drag-chip cursor-pointer" style={{ cursor: 'pointer' }}>
                <TypeGlyph type={c.data_type} />
                <span className="font-medium text-[var(--color-ink)]">{renamed ?? c.key}</span>
                {renamed && <span className="text-[var(--color-ink-faint)] line-through">{c.key}</span>}
                <Pencil size={11} className="text-[var(--color-ink-faint)]" />
              </button>
            </Tip>
          );
        })}
      </div>

      <div className="scroll-thin max-h-[260px] overflow-auto border-t border-[var(--color-line-soft)]">
        <table className="grid-table">
          <thead><tr>{data.columns.map((c) => <th key={c.id} className={['number', 'currency'].includes(c.data_type) ? 'num' : ''}>{c.label}</th>)}</tr></thead>
          <tbody>
            {data.rowPreview.map((r) => (
              <tr key={r.id}>
                {data.columns.map((c) => (
                  <td key={c.id} className={['number', 'currency'].includes(c.data_type) ? 'num' : 'max-w-[220px] truncate'}>{formatCell(r.data[c.key], c.data_type)}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {editing && (
        <ColumnEditor column={editing} currentKey={renames.get(editing.key) ?? editing.key} datasetId={data.dataset!.id}
          onClose={() => setEditing(null)} run={run} />
      )}
    </section>
  );
}

function ColumnEditor({ column, currentKey, datasetId, onClose, run }: {
  column: DatasetColumn; currentKey: string; datasetId: string; onClose: () => void; run: (fn: () => Promise<unknown>) => void;
}) {
  const [key, setKey] = useState(currentKey);
  const [label, setLabel] = useState(column.label);
  const [type, setType] = useState<ColumnType>(column.data_type);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-[rgba(16,22,19,.35)] p-6" onClick={onClose}>
      <div className="surface w-full max-w-[420px] p-5 shadow-[var(--shadow-lg)] rise" onClick={(e) => e.stopPropagation()} role="dialog" aria-label="Edit column">
        <div className="mb-4 flex items-start justify-between">
          <div>
            <h3 className="text-[14px] font-semibold">Edit column</h3>
            <p className="mt-0.5 text-[12px] text-[var(--color-ink-muted)]">From header “{column.source_header}”</p>
          </div>
          <button onClick={onClose} aria-label="Close" className="btn btn-quiet"><X size={15} /></button>
        </div>
        <label className="mb-3 block"><span className="label">Key</span>
          <Tip text="Machine name used in formulas and by the assistant. Lower-case with underscores." className="w-full"><input className="field mt-1.5 font-mono text-[12.5px]" value={key} onChange={(e) => setKey(e.target.value)} /></Tip>
        </label>
        <label className="mb-3 block"><span className="label">Label</span>
          <Tip text="Human label shown in reports" className="w-full"><input className="field mt-1.5" value={label} onChange={(e) => setLabel(e.target.value)} /></Tip>
        </label>
        <label className="mb-5 block"><span className="label">Type</span>
          <Tip text="How values are parsed and formatted" className="w-full">
            <select className="field mt-1.5" value={type} onChange={(e) => setType(e.target.value as ColumnType)}>{TYPES.map((t) => <option key={t} value={t}>{t}</option>)}</select>
          </Tip>
        </label>
        <div className="flex justify-end gap-2">
          <button className="btn btn-ghost" onClick={onClose}>Cancel</button>
          <Tip text="Save. Type and label update immediately; a key change is recorded as an approved rename.">
            <button className="btn btn-primary" onClick={() => {
              run(async () => {
                if (type !== column.data_type || label !== column.label) await updateColumn(column.id, { data_type: type, label });
                if (key.trim() !== currentKey) await renameColumn(datasetId, column.key, key.trim(), label);
              });
              onClose();
            }}><Check size={14} /> Save</button>
          </Tip>
        </div>
      </div>
    </div>
  );
}
