'use client';

import { useMemo, useState } from 'react';
import type { ReportFilters, ReportResult } from '@azentio/core';
import { resolveMapping, dateFieldOptions } from '@azentio/core';
import { Tip, InfoDot } from './tip';
import { Alert, BarChart, Download, Filter, Printer } from './icons';
import { Chart } from './chart';
import { formatCell, csvEscape } from '@/lib/format';
import type { WorkspaceData } from './types';
import { generateReport } from '@/app/actions';

type Run = (fn: () => Promise<unknown>, after?: (r: any) => void) => void;

export function ReportPanel({ data, run, busy }: { data: WorkspaceData; run: Run; busy: boolean }) {
  const template = data.selectedTemplate!;
  const ds = data.dataset!;

  const mapping = useMemo(
    () => resolveMapping(template, data.columns, data.customisations, data.mappingId),
    [template, data.columns, data.customisations, data.mappingId],
  );
  const dateFields = dateFieldOptions(template, mapping);
  const mappedKeys = Object.keys(mapping.sources);

  const [filters, setFilters] = useState<ReportFilters>(() => ({
    date_column: data.latestReport?.filters.date_column ?? dateFields[0]?.key,
    from: data.latestReport?.filters.from ?? '',
    to: data.latestReport?.filters.to ?? '',
    where: data.latestReport?.filters.where ?? [],
  }));
  const [result, setResult] = useState<ReportResult | null>(data.latestReport);

  const pending = data.customisations.filter((c) => c.status === 'pending').length;
  const where = filters.where?.[0] ?? { column: '', op: 'eq' as const, value: '' };
  const setWhere = (patch: Partial<typeof where>) => setFilters({ ...filters, where: [{ ...where, ...patch }] });

  const generate = () => run(
    () => generateReport(ds.id, template.code, {
      date_column: filters.date_column || undefined,
      from: filters.from || undefined,
      to: filters.to || undefined,
      where: filters.where?.filter((w) => w.column && w.value !== ''),
    }),
    (r) => setResult(r as ReportResult),
  );

  return (
    <>
      {/* ------------------------------------------------------- zone 5 */}
      <section className="surface overflow-hidden">
        <header className="flex items-center gap-3 border-b border-[var(--color-line-soft)] px-5 py-3">
          <h2 className="text-[13px] font-semibold">Filters &amp; generate</h2>
          <InfoDot text="The report covers only rows inside the date range. The date binds to one of the template's date fields, so it has to be mapped first." side="bottom" />
        </header>
        <div className="grid gap-3 px-5 py-4 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-end">
          <div className="grid gap-3 sm:grid-cols-[1.2fr_1fr_1fr]">
            <label className="block"><span className="label flex items-center gap-1"><Filter size={11} /> Date field</span>
              <Tip text={dateFields.length ? 'Which date the range applies to' : 'Map a date field first — none is in force yet'} className="w-full">
                <select className="field mt-1.5" value={filters.date_column ?? ''} disabled={dateFields.length === 0}
                        onChange={(e) => setFilters({ ...filters, date_column: e.target.value || undefined })}>
                  <option value="">No date filter</option>
                  {dateFields.map((f) => <option key={f.key} value={f.key}>{f.label}</option>)}
                </select>
              </Tip>
            </label>
            <label className="block"><span className="label">From</span>
              <Tip text="Inclusive start date" className="w-full"><input type="date" className="field mt-1.5 tabular" value={filters.from ?? ''} disabled={!filters.date_column} onChange={(e) => setFilters({ ...filters, from: e.target.value })} /></Tip>
            </label>
            <label className="block"><span className="label">To</span>
              <Tip text="Inclusive end date" className="w-full"><input type="date" className="field mt-1.5 tabular" value={filters.to ?? ''} disabled={!filters.date_column} onChange={(e) => setFilters({ ...filters, to: e.target.value })} /></Tip>
            </label>
          </div>

          <div className="flex items-end gap-3">
            <Tip text={pending > 0 ? `Generate now. ${pending} pending item${pending === 1 ? '' : 's'} will NOT be reflected until approved.` : 'Generate the report from approved decisions only'}>
              <button className="btn btn-hero whitespace-nowrap" disabled={busy || mapping.missingRequired.length === template.fields.filter((f) => f.required).length} onClick={generate}>
                <BarChart size={15} /> Generate report
                {pending > 0 && <span className="ml-1 rounded-full bg-[rgba(255,255,255,.18)] px-1.5 py-0.5 text-[10.5px]">{pending} pending</span>}
              </button>
            </Tip>
          </div>
        </div>

        <details className="border-t border-[var(--color-line-soft)] px-5 py-3">
          <summary className="cursor-pointer text-[12.5px] text-[var(--color-ink-muted)]">Additional filter</summary>
          <div className="mt-3 grid gap-2 sm:grid-cols-[1.2fr_120px_1fr]">
            <Tip text="Column to filter on (template field keys and dataset columns both work)" className="w-full">
              <select className="field" value={where.column} onChange={(e) => setWhere({ column: e.target.value })}>
                <option value="">— column —</option>
                {[...new Set([...mappedKeys, ...data.columns.map((c) => c.key)])].map((k) => <option key={k} value={k}>{k}</option>)}
              </select>
            </Tip>
            <select className="field" value={where.op} onChange={(e) => setWhere({ op: e.target.value as any })} aria-label="Operator">
              <option value="eq">equals</option><option value="neq">not equal</option><option value="contains">contains</option><option value="gt">greater than</option><option value="lt">less than</option>
            </select>
            <input className="field" placeholder="value" value={where.value} onChange={(e) => setWhere({ value: e.target.value })} aria-label="Value" />
          </div>
        </details>
      </section>

      {/* ------------------------------------------------------- zone 6 */}
      <section className="surface overflow-hidden" id="report">
        <header className="flex items-center gap-3 border-b border-[var(--color-line-soft)] px-5 py-3">
          <h2 className="text-[13px] font-semibold">Report</h2>
          {result && <span className="text-[12px] text-[var(--color-ink-muted)]">· {template.name} · generated {formatCell(result.generatedAt.slice(0, 10), 'date')}</span>}
          {result && (
            <div className="ml-auto flex items-center gap-1.5 no-print">
              <Tip text="Download the detail table as CSV" side="bottom">
                <button className="btn btn-ghost h-[30px] px-2.5 text-[12px]" onClick={() => downloadCsv(result)}><Download size={13} /> CSV</button>
              </Tip>
              <Tip text="Print or save as PDF" side="bottom">
                <button className="btn btn-ghost h-[30px] px-2.5 text-[12px]" onClick={() => window.print()}><Printer size={13} /> PDF</button>
              </Tip>
            </div>
          )}
        </header>

        {!result ? (
          <p className="px-5 py-10 text-center text-[13px] text-[var(--color-ink-muted)]">No report yet. Set a range and press Generate.</p>
        ) : (
          <ReportView result={result} />
        )}
      </section>
    </>
  );
}

export function ReportView({ result }: { result: ReportResult }) {
  return (
    <div className="grid gap-5 p-5">
      {result.warnings.length > 0 && (
        <ul className="m-0 grid list-none gap-1.5 p-0">
          {result.warnings.map((w, i) => (
            <li key={i} className="flex items-start gap-2 rounded-[var(--radius-sm)] bg-[var(--color-pending-soft)] px-3 py-2 text-[12.5px] text-[var(--color-pending-text)]">
              <Alert size={14} className="mt-0.5 shrink-0" /><span>{w}</span>
            </li>
          ))}
        </ul>
      )}

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {result.tiles.map((t) => (
          <div key={t.key} className="rounded-[var(--radius)] border border-[var(--color-line-soft)] bg-[var(--color-paper-tint)] px-4 py-3.5">
            <p className="label">{t.label}</p>
            <p className="display tabular mt-1 text-[24px] leading-none text-[var(--color-ink)]">
              {t.value === null ? '—' : formatCell(t.value, t.format === 'text' ? 'text' : t.format)}
            </p>
            {t.hint && <p className="mt-1 text-[11px] text-[var(--color-ink-faint)]">{t.hint}</p>}
          </div>
        ))}
      </div>

      {result.charts.length > 0 && (
        <div className="grid gap-5 lg:grid-cols-2">
          {result.charts.map((c, i) => (
            <div key={i} className="rounded-[var(--radius)] border border-[var(--color-line-soft)] p-4 print-keep">
              <Chart spec={c} />
            </div>
          ))}
        </div>
      )}

      {result.groups.map((g) => (
        <div key={g.dimension} className="print-keep">
          <div className="mb-2 flex items-baseline justify-between">
            <h3 className="text-[13px] font-semibold">By {g.label}</h3>
            <span className="text-[11.5px] text-[var(--color-ink-faint)]">{g.rows.length < g.totalGroups ? `top ${g.rows.length} of ${g.totalGroups}` : `${g.totalGroups} groups`}</span>
          </div>
          <div className="scroll-thin overflow-auto rounded-[var(--radius-sm)] border border-[var(--color-line-soft)]">
            <table className="grid-table">
              <thead><tr><th>{g.label}</th><th className="num">Rows</th>{g.measures.map((m) => <th key={m.key} className="num">{m.aggregation === 'count' ? m.label : `${m.aggregation} ${m.label}`}</th>)}</tr></thead>
              <tbody>
                {g.rows.map((r) => (
                  <tr key={r.key}>
                    <td className="font-medium text-[var(--color-ink)]">{r.key}</td>
                    <td className="num">{r.count.toLocaleString('en-IN')}</td>
                    {g.measures.map((m) => <td key={m.key} className="num">{formatCell(r.values[m.key], /share|pct|ratio|efficiency/i.test(m.key) ? 'percent' : m.type)}</td>)}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ))}

      <div>
        <div className="mb-2 flex items-baseline justify-between">
          <h3 className="text-[13px] font-semibold">Detail</h3>
          <span className="text-[11.5px] text-[var(--color-ink-faint)]">
            {result.table.rows.length < result.table.truncatedFrom ? `first ${result.table.rows.length} of ${result.table.truncatedFrom.toLocaleString('en-IN')} — export CSV for all` : `${result.table.rows.length} rows`}
          </span>
        </div>
        <div className="scroll-thin max-h-[420px] overflow-auto rounded-[var(--radius-sm)] border border-[var(--color-line-soft)]">
          <table className="grid-table">
            <thead><tr>{result.table.columns.map((c) => <th key={c.key} className={['number', 'currency'].includes(c.type) ? 'num' : ''}>{c.label}</th>)}</tr></thead>
            <tbody>
              {result.table.rows.map((r, i) => (
                <tr key={i}>{result.table.columns.map((c) => <td key={c.key} className={['number', 'currency'].includes(c.type) ? 'num' : 'max-w-[240px] truncate'}>{formatCell(r[c.key], c.type)}</td>)}</tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

function downloadCsv(result: ReportResult) {
  const header = result.table.columns.map((c) => csvEscape(c.label)).join(',');
  const lines = result.table.rows.map((r) => result.table.columns.map((c) => csvEscape(r[c.key])).join(','));
  const blob = new Blob(['﻿' + [header, ...lines].join('\n')], { type: 'text/csv;charset=utf-8' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `${result.templateCode.toLowerCase()}-${result.generatedAt.slice(0, 10)}.csv`;
  a.click();
  URL.revokeObjectURL(a.href);
}
