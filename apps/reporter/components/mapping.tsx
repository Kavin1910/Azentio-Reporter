'use client';

import { useEffect, useRef, useState, type DragEvent } from 'react';
import type {
  Customisation, CustomisationProposal, DerivedFieldProposal, FieldMappingProposal, ReportTemplate,
  RowExclusionProposal, TemplateField, TextSplitProposal, TypeConflictProposal, UnmappedFieldProposal,
  ValueCoercionProposal, ColumnRenameProposal,
} from '@azentio/core';
import { checkFormula } from '@azentio/core';
import { Tip, InfoDot } from './tip';
import { Check, Fx, Grip, Layers, Refresh, Sparkle, X, TypeGlyph } from './icons';
import type { WorkspaceData } from './types';
import { assignField, clearField, decideCustomisation, resetMapping, selectTemplate } from '@/app/actions';

type Run = (fn: () => Promise<unknown>) => void;
const eff = <T,>(c: Customisation): T => ((c.override ?? c.proposal) as unknown) as T;

/* ------------------------------------------------------- template gallery */

export function TemplateGallery({ templates, selected, disabled, onSelect }: {
  templates: ReportTemplate[]; selected: string | null; disabled: boolean; onSelect: (code: string) => void;
}) {
  const groups = new Map<string, ReportTemplate[]>();
  for (const t of templates) { if (!groups.has(t.category)) groups.set(t.category, []); groups.get(t.category)!.push(t); }

  return (
    <section className="surface overflow-hidden">
      <header className="flex items-center gap-2.5 border-b border-[var(--color-line-soft)] px-4 py-3">
        <Layers size={15} className="text-[var(--color-brand)]" />
        <h2 className="text-[13px] font-semibold">Templates</h2>
        <InfoDot text="Twelve report templates. Click one to map its fields against your columns. Exact matches are approved automatically; everything else waits in the Customisation Layer." side="bottom" />
        <span className="ml-auto tabular text-[11.5px] text-[var(--color-ink-faint)]">{templates.length}</span>
      </header>
      <div className="scroll-thin max-h-[calc(100vh-140px)] overflow-y-auto p-2.5">
        {[...groups.entries()].map(([cat, ts]) => (
          <div key={cat} className="mb-2.5 last:mb-0">
            <p className="label px-1.5 pb-1.5 pt-1">{cat}</p>
            <div className="grid gap-1">
              {ts.map((t) => {
                const active = t.code === selected;
                return (
                  <Tip key={t.code} text={disabled ? 'Structure the dataset first' : t.description} className="w-full">
                    <button
                      disabled={disabled}
                      onClick={() => onSelect(t.code)}
                      className="w-full rounded-[var(--radius-sm)] border px-3 py-2.5 text-left transition disabled:cursor-not-allowed disabled:opacity-45"
                      style={{
                        borderColor: active ? 'var(--color-brand)' : 'var(--color-line-soft)',
                        background: active ? 'var(--color-brand-soft)' : 'transparent',
                      }}
                    >
                      <span className="flex items-center justify-between gap-2">
                        <span className="text-[12.5px] font-medium" style={{ color: active ? 'var(--color-brand)' : 'var(--color-ink)' }}>{t.name}</span>
                        <span className="tabular text-[10.5px] text-[var(--color-ink-faint)]">{t.fields.length} fields</span>
                      </span>
                    </button>
                  </Tip>
                );
              })}
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}


/* ------------------------------------------------------- template grid */

const CATEGORY_BLURB: Record<string, string> = {
  Portfolio: 'What the book looks like',
  Operations: 'What moved in the period',
  Risk: 'Where the exposure is',
  Performance: 'How branches and products are doing',
};

export function TemplateGrid({ templates, selected, onSelect }: {
  templates: ReportTemplate[]; selected: string | null; onSelect: (code: string) => void;
}) {
  const groups = new Map<string, ReportTemplate[]>();
  for (const t of templates) { if (!groups.has(t.category)) groups.set(t.category, []); groups.get(t.category)!.push(t); }

  return (
    <div className="grid gap-7">
      {[...groups.entries()].map(([cat, ts]) => (
        <section key={cat}>
          <div className="mb-3 flex items-baseline gap-2.5">
            <h2 className="text-[13px] font-semibold">{cat}</h2>
            <span className="text-[12px] text-[var(--color-ink-muted)]">{CATEGORY_BLURB[cat] ?? ''}</span>
          </div>
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {ts.map((t) => {
              const active = t.code === selected;
              const dims = t.fields.filter((f) => f.role === 'dimension').length;
              const measures = t.fields.filter((f) => f.role === 'measure').length;
              const derivable = t.fields.filter((f) => f.derivable).length;
              return (
                <Tip key={t.code} text={active ? 'Selected — click to open its mapping' : 'Select this template and map its fields'} className="w-full">
                  <button
                    onClick={() => onSelect(t.code)}
                    aria-pressed={active}
                    className="surface flex h-full w-full flex-col text-left transition hover:border-[var(--color-sage-500)] hover:shadow-[var(--shadow-sm)]"
                    style={active ? { borderColor: 'var(--color-brand)', background: 'var(--color-brand-soft)' } : undefined}
                  >
                    <div className="flex items-start justify-between gap-3 px-4 pt-4">
                      <span className="text-[14px] font-semibold leading-snug" style={{ color: active ? 'var(--color-brand)' : 'var(--color-ink)' }}>{t.name}</span>
                      {active && <span className="chip chip-ok">Selected</span>}
                    </div>
                    <p className="flex-1 px-4 pt-1.5 text-[12.5px] leading-relaxed text-[var(--color-ink-muted)]">{t.description}</p>
                    <div className="mt-3 flex flex-wrap gap-x-3 gap-y-1 border-t border-[var(--color-line-soft)] px-4 py-2.5 text-[11px] text-[var(--color-ink-faint)]">
                      <span className="tabular">{t.fields.length} fields</span>
                      <span className="tabular">{dims} dimensions</span>
                      <span className="tabular">{measures} measures</span>
                      {derivable > 0 && <Tip text="Fields the mapper can compute when the file lacks them, e.g. age from date of birth"><span className="tabular">{derivable} computable</span></Tip>}
                    </div>
                  </button>
                </Tip>
              );
            })}
          </div>
        </section>
      ))}
    </div>
  );
}

/* ---------------------------------------------------------- mapping panel */

interface Slot {
  field: TemplateField;
  source: { kind: 'column'; column: string; confidence: number | null; status: Customisation['status']; id: string }
        | { kind: 'derived'; formula: string; status: Customisation['status']; id: string }
        | { kind: 'count' }
        | { kind: 'empty'; id: string | null; candidates: Array<{ column: string; confidence: number }> };
}

function buildSlots(template: ReportTemplate, cs: Customisation[], mappingId: string | null): Slot[] {
  const mine = cs.filter((c) => c.mapping_id === mappingId && c.status !== 'rejected');
  return template.fields.map((field) => {
    const c = mine.find((x) => x.target_key === field.key);
    if (c?.kind === 'field_mapping') {
      const p = eff<FieldMappingProposal>(c);
      return { field, source: { kind: 'column', column: p.column, confidence: c.override ? null : c.confidence, status: c.status, id: c.id } };
    }
    if (c?.kind === 'unmapped_field') {
      const o = c.override as unknown as FieldMappingProposal | null;
      if (o?.column) return { field, source: { kind: 'column', column: o.column, confidence: null, status: c.status, id: c.id } };
      return { field, source: { kind: 'empty', id: c.id, candidates: (c.proposal as UnmappedFieldProposal).candidates ?? [] } };
    }
    if (c?.kind === 'derived_field') {
      return { field, source: { kind: 'derived', formula: eff<DerivedFieldProposal>(c).formula, status: c.status, id: c.id } };
    }
    if (field.aggregation === 'count') return { field, source: { kind: 'count' } };
    return { field, source: { kind: 'empty', id: null, candidates: [] } };
  });
}

export function MappingPanel({ data, run }: { data: WorkspaceData; run: Run }) {
  const template = data.selectedTemplate!;
  const ds = data.dataset!;
  const [dragging, setDragging] = useState<string | null>(null);
  const [overSlot, setOverSlot] = useState<string | null>(null);

  const mappingMissing = data.mappingId === null;
  const slots = buildSlots(template, data.customisations, data.mappingId);

  // Picking a template should map it — nobody should have to find a link to
  // make that happen. Runs once per template when no mapping exists yet.
  const autoRan = useRef<string | null>(null);
  useEffect(() => {
    if (!mappingMissing || autoRan.current === template.code) return;
    autoRan.current = template.code;
    run(() => selectTemplate(ds.id, template.code));
  }, [mappingMissing, template.code, ds.id, run]);

  const inForce = slots.filter((s) => (s.source.kind === 'column' || s.source.kind === 'derived') && s.source.status === 'approved').length + slots.filter((s) => s.source.kind === 'count').length;
  const autoMap = () => {
    if (mappingMissing) { run(() => selectTemplate(ds.id, template.code)); return; }
    if (confirm('Run auto-map again? Manual assignments and approvals for this template will be replaced by fresh proposals.')) {
      run(() => resetMapping(ds.id, template.code));
    }
  };
  const used = new Set(slots.flatMap((s) => (s.source.kind === 'column' ? [s.source.column] : [])));

  const onDropOn = (fieldKey: string) => (e: DragEvent) => {
    e.preventDefault();
    const col = e.dataTransfer.getData('text/column') || dragging;
    setOverSlot(null); setDragging(null);
    if (!col) return;
    run(async () => {
      let mappingId = data.mappingId;
      if (!mappingId) {
        const r = await selectTemplate(ds.id, template.code);
        if (!r.ok) throw new Error(r.error);
        mappingId = r.data.mappingId;
      }
      await assignField(mappingId, ds.id, fieldKey, col);
    });
  };


  return (
    <section className="surface overflow-hidden">
      <header className="flex items-center gap-3 border-b border-[var(--color-line-soft)] px-5 py-3">
        <h2 className="text-[13px] font-semibold">Map to “{template.name}”</h2>
        <InfoDot text="Each template field on the left is a drop target. Drag a column chip onto it to assign it. A pale dashed slot is unmapped; an amber one is a proposal waiting for approval below." side="bottom" />
        <span className="ml-auto tabular text-[12px] text-[var(--color-ink-muted)]">{inForce} / {template.fields.length} in force</span>
        <Tip text={mappingMissing
          ? 'Match every template field to your columns by name and type; exact matches are approved, anything fuzzy waits for you'
          : 'Run the matcher again from scratch. Replaces manual assignments and approvals for this template with fresh proposals.'} side="bottom">
          <button className={`${inForce === 0 ? 'btn btn-primary' : 'btn btn-ghost'} h-[32px] px-3 text-[12.5px]`} onClick={autoMap}>
            <Sparkle size={14} /> Auto-map
          </button>
        </Tip>
      </header>

      {mappingMissing && (
        <div className="flex items-center gap-2 border-b border-[var(--color-line-soft)] bg-[var(--color-paper-tint)] px-5 py-3 text-[12.5px] text-[var(--color-ink-muted)]">
          <span className="typing"><i /><i /><i /></span> Auto-mapping “{template.name}” against your columns…
        </div>
      )}

      <div className="grid gap-5 p-5 lg:grid-cols-[minmax(0,1fr)_260px]">
        {/* slots */}
        <ul className="grid gap-2 m-0 list-none p-0">
          {slots.map(({ field, source }) => {
            const tone = source.kind === 'empty' ? 'empty' : source.kind === 'count' ? 'ok' : source.status === 'approved' ? 'ok' : 'pending';
            const isOver = overSlot === field.key;
            return (
              <li key={field.key}
                  onDragOver={(e) => { e.preventDefault(); setOverSlot(field.key); }}
                  onDragLeave={() => setOverSlot(null)}
                  onDrop={onDropOn(field.key)}
                  className={`grid grid-cols-[minmax(0,200px)_minmax(0,1fr)_auto] items-center gap-3 rounded-[var(--radius-sm)] border px-3 py-2 transition ${isOver ? 'drop-slot-over border-solid' : ''}`}
                  style={{
                    borderColor: isOver ? 'var(--color-accent)' : tone === 'empty' ? 'var(--color-line-strong)' : tone === 'ok' ? 'var(--color-ok-soft)' : 'var(--color-pending-soft)',
                    borderStyle: tone === 'empty' && !isOver ? 'dashed' : 'solid',
                    background: isOver ? 'var(--color-sage-900)' : tone === 'ok' ? 'var(--color-paper)' : tone === 'pending' ? 'var(--color-pending-soft)' : 'var(--color-canvas-sunken)',
                  }}>
                <Tip text={`${field.role} · ${field.type}${field.required ? ' · required' : ''}${field.aggregation && field.aggregation !== 'none' ? ` · ${field.aggregation}` : ''}${field.derivable ? ' · can be computed' : ''}`}>
                  <span className="flex min-w-0 items-center gap-2">
                    <TypeGlyph type={field.type} />
                    <span className="truncate text-[12.5px] font-medium">{field.label}</span>
                    {field.required && <span aria-label="required" className="text-[var(--color-danger)]">*</span>}
                  </span>
                </Tip>

                <span className="min-w-0 text-[12.5px]">
                  {source.kind === 'column' && (
                    <span className="flex items-center gap-2">
                      <span className="text-[var(--color-ink-faint)]">←</span>
                      <span className="truncate font-mono text-[12px]">{source.column}</span>
                      {source.confidence !== null && source.confidence < 100 && <span className="tabular text-[11px] text-[var(--color-pending-text)]">{source.confidence}%</span>}
                      {source.confidence === null && <span className="text-[11px] text-[var(--color-ink-faint)]">manual</span>}
                    </span>
                  )}
                  {source.kind === 'derived' && (
                    <Tip text={source.formula}>
                      <span className="flex items-center gap-1.5 text-[var(--color-accent-text)]"><Fx size={13} /><span className="truncate font-mono text-[11.5px]">{source.formula}</span></span>
                    </Tip>
                  )}
                  {source.kind === 'count' && <span className="text-[var(--color-ink-muted)]">row count</span>}
                  {source.kind === 'empty' && (
                    <span className="text-[var(--color-ink-faint)]">
                      drop a column here{source.candidates.length ? ` — maybe ${source.candidates[0]!.column}?` : ''}
                    </span>
                  )}
                </span>

                <span className="flex items-center gap-1">
                  {(source.kind === 'column' || source.kind === 'derived') && source.status === 'pending' && (
                    <Tip text="Approve this proposal"><button className="btn btn-quiet h-[26px] px-1.5 text-[var(--color-ok-text)]" onClick={() => run(() => decideCustomisation(source.id, 'approved'))}><Check size={14} /></button></Tip>
                  )}
                  {(source.kind === 'column' || source.kind === 'derived') && (
                    <Tip text="Remove this assignment"><button className="btn btn-quiet h-[26px] px-1.5 text-[var(--color-ink-faint)] hover:text-[var(--color-danger-text)]" onClick={() => run(() => clearField(data.mappingId!, field.key))}><X size={14} /></button></Tip>
                  )}
                </span>
              </li>
            );
          })}
        </ul>

        {/* column palette */}
        <div>
          <p className="label mb-2">Your columns <InfoDot text="Drag a chip onto a field on the left. Dimmed chips are already in use." /></p>
          <div className="flex flex-wrap gap-1.5">
            {data.columns.map((c) => (
              <span key={c.id}
                    draggable
                    onDragStart={(e) => { e.dataTransfer.setData('text/column', c.key); e.dataTransfer.effectAllowed = 'link'; setDragging(c.key); }}
                    onDragEnd={() => setDragging(null)}
                    className={`drag-chip ${dragging === c.key ? 'drag-chip-ghost' : ''}`}
                    style={used.has(c.key) ? { opacity: .55 } : undefined}
                    data-tip={`${c.label} · ${c.data_type}${used.has(c.key) ? ' · in use' : ''}`}
                    aria-label={`${c.label}, ${c.data_type}`}>
                <Grip size={12} className="text-[var(--color-ink-faint)]" />
                <TypeGlyph type={c.data_type} />
                <span className="font-mono text-[11.5px]">{c.key}</span>
              </span>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}

/* ---------------------------------------------------- customisation queue */

const KIND_LABEL: Record<Customisation['kind'], string> = {
  column_rename: 'Rename', type_conflict: 'Type conflict', value_coercion: 'Ambiguous format',
  text_split: 'Split column', row_exclusion: 'Exclude rows', field_mapping: 'Field mapping',
  unmapped_field: 'Unmapped field', derived_field: 'Derived field',
};

export function CustomisationQueue({ data, run }: { data: WorkspaceData; run: Run }) {
  const [tab, setTab] = useState<'pending' | 'approved' | 'rejected'>('pending');
  const items = data.customisations
    .filter((c) => c.status === tab)
    // Hide exact-match auto approvals from the approved list by default? No — they are decisions and should be revocable.
    .sort((a, b) => (a.mapping_id ? 1 : 0) - (b.mapping_id ? 1 : 0) || a.created_at.localeCompare(b.created_at));
  const counts = { pending: 0, approved: 0, rejected: 0 };
  for (const c of data.customisations) counts[c.status]++;

  return (
    <section className="surface overflow-hidden">
      <header className="flex items-center gap-3 border-b border-[var(--color-line-soft)] px-5 py-3">
        <h2 className="text-[13px] font-semibold">Customisation Layer</h2>
        <InfoDot text="Every uncertain decision the system made, waiting for you. Nothing here reaches a report until it is approved. Override a proposal to apply your own value instead." side="bottom" />
        <div className="ml-auto flex gap-1">
          {(['pending', 'approved', 'rejected'] as const).map((t) => (
            <Tip key={t} text={t === 'pending' ? 'Awaiting your decision' : t === 'approved' ? 'In force in reports' : 'Discarded'} side="bottom">
              <button onClick={() => setTab(t)} className="rounded-full px-3 py-1 text-[12px] font-medium transition"
                style={{ background: tab === t ? 'var(--color-brand)' : 'transparent', color: tab === t ? '#fff' : 'var(--color-ink-muted)' }}>
                {t} <span className="tabular opacity-70">{counts[t]}</span>
              </button>
            </Tip>
          ))}
        </div>
      </header>

      {items.length === 0 ? (
        <p className="px-5 py-8 text-center text-[13px] text-[var(--color-ink-muted)]">
          {tab === 'pending' ? 'Nothing waiting. Every decision has been made.' : `No ${tab} items.`}
        </p>
      ) : (
        <ul className="m-0 list-none divide-y divide-[var(--color-line-soft)] p-0">
          {items.map((c) => <QueueItem key={c.id} c={c} run={run} columns={data.columns.map((x) => x.key)} />)}
        </ul>
      )}
    </section>
  );
}

function QueueItem({ c, run, columns }: { c: Customisation; run: Run; columns: string[] }) {
  const [editing, setEditing] = useState(false);
  const scope = c.mapping_id ? 'this template' : 'dataset';

  return (
    <li className="grid gap-3 px-5 py-3.5 lg:grid-cols-[minmax(0,1fr)_auto]">
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-2">
          <span className={`chip ${c.status === 'approved' ? 'chip-ok' : c.status === 'rejected' ? 'chip-danger' : 'chip-pending'}`}>{KIND_LABEL[c.kind]}</span>
          <span className="font-mono text-[12px] text-[var(--color-ink)]">{c.target_key === '__rows__' ? `${(c.proposal as RowExclusionProposal).row_indexes.length} rows` : c.target_key}</span>
          {c.confidence !== null && <Tip text="How sure the system is"><span className="tabular text-[11px] text-[var(--color-ink-faint)]">{c.confidence}%</span></Tip>}
          {c.affected_rows > 0 && <span className="tabular text-[11px] text-[var(--color-ink-faint)]">· {c.affected_rows} rows</span>}
          <span className="text-[11px] text-[var(--color-ink-faint)]">· {scope}</span>
          {c.override && <Tip text="You changed the proposal; your value is what applies"><span className="chip chip-neutral">overridden</span></Tip>}
        </div>
        <p className="mt-1.5 text-[12.5px] leading-relaxed text-[var(--color-ink-soft)]">{c.rationale}</p>
        <ProposalSummary c={c} />
        {editing && <OverrideEditor c={c} columns={columns} onDone={() => setEditing(false)} run={run} />}
      </div>

      <div className="flex items-start gap-1.5 lg:justify-end">
        {c.status !== 'approved' && (
          <Tip text="Approve — applies to reports from now on">
            <button className="btn btn-ghost h-[30px] px-2.5 text-[12px] text-[var(--color-ok-text)]" onClick={() => run(() => decideCustomisation(c.id, 'approved'))}><Check size={14} /> Approve</button>
          </Tip>
        )}
        {c.status !== 'rejected' && (
          <Tip text="Reject — the proposal is discarded and the original data stands">
            <button className="btn btn-ghost h-[30px] px-2.5 text-[12px] text-[var(--color-danger-text)]" onClick={() => run(() => decideCustomisation(c.id, 'rejected'))}><X size={14} /> Reject</button>
          </Tip>
        )}
        {canOverride(c.kind) && (
          <Tip text="Change the proposed value before approving">
            <button className="btn btn-quiet h-[30px] px-2.5 text-[12px]" onClick={() => setEditing((v) => !v)}>Override</button>
          </Tip>
        )}
        {c.status !== 'pending' && (
          <Tip text="Move back to pending">
            <button className="btn btn-quiet h-[30px] px-2 text-[12px]" onClick={() => run(() => decideCustomisation(c.id, 'pending'))}><Refresh size={13} /></button>
          </Tip>
        )}
      </div>
    </li>
  );
}

const canOverride = (k: Customisation['kind']) =>
  ['field_mapping', 'unmapped_field', 'derived_field', 'value_coercion', 'type_conflict', 'column_rename', 'text_split'].includes(k);

function ProposalSummary({ c }: { c: Customisation }) {
  const p = eff<CustomisationProposal>(c) as any;
  const mono = 'font-mono text-[11.5px] text-[var(--color-ink-muted)]';
  switch (c.kind) {
    case 'field_mapping': return <p className={`mt-1 ${mono}`}>{p.field} ← {p.column}</p>;
    case 'unmapped_field': return p.column ? <p className={`mt-1 ${mono}`}>{c.target_key} ← {p.column}</p> : null;
    case 'derived_field': return <p className={`mt-1 ${mono}`}>{p.field} = {p.formula}</p>;
    case 'column_rename': return <p className={`mt-1 ${mono}`}>{p.from} → {p.to}</p>;
    case 'type_conflict': return <p className={`mt-1 ${mono}`}>{p.action === 'null_out' ? 'treat as blank' : 'keep as text'}: {(p.odd_values as string[]).slice(0, 5).join(', ')}</p>;
    case 'value_coercion': return <p className={`mt-1 ${mono}`}>read as {p.detected_format === 'mdy' ? 'month/day/year' : p.detected_format === 'dmy' ? 'day/month/year' : p.detected_format} · e.g. {(p.examples as string[]).slice(0, 3).join(', ')}</p>;
    case 'text_split': return <p className={`mt-1 ${mono}`}>{p.column} → {(p.parts as Array<{ key: string; type: string }>).map((x) => `${x.key} (${x.type})`).join(' · ')}</p>;
    case 'row_exclusion': return <p className={`mt-1 ${mono}`}>rows {(p.row_indexes as number[]).slice(0, 8).map((i) => i + 1).join(', ')}{(p.row_indexes as number[]).length > 8 ? '…' : ''}</p>;
    default: return null;
  }
}

function OverrideEditor({ c, columns, onDone, run }: { c: Customisation; columns: string[]; onDone: () => void; run: Run }) {
  const p = eff<any>(c);
  const [draft, setDraft] = useState<any>(structuredClone(p));
  const formulaError = c.kind === 'derived_field' ? checkFormula(String(draft.formula ?? '')) : null;

  const save = () => {
    if (formulaError) return;
    let override: CustomisationProposal;
    switch (c.kind) {
      case 'field_mapping': override = { field: c.target_key, column: draft.column } as FieldMappingProposal; break;
      case 'unmapped_field': override = { field: c.target_key, column: draft.column } as unknown as CustomisationProposal; break;
      case 'derived_field': override = { ...(p as DerivedFieldProposal), formula: draft.formula }; break;
      case 'value_coercion': override = { ...(p as ValueCoercionProposal), detected_format: draft.detected_format, action: draft.action }; break;
      case 'type_conflict': override = { ...(p as TypeConflictProposal), action: draft.action }; break;
      case 'column_rename': override = { ...(p as ColumnRenameProposal), to: draft.to, label: draft.label }; break;
      case 'text_split': override = { ...(p as TextSplitProposal), parts: draft.parts }; break;
      default: return;
    }
    run(() => decideCustomisation(c.id, 'approved', override));
    onDone();
  };

  return (
    <div className="mt-3 rounded-[var(--radius-sm)] border border-[var(--color-line)] bg-[var(--color-paper-tint)] p-3">
      {(c.kind === 'field_mapping' || c.kind === 'unmapped_field') && (
        <label className="block"><span className="label">Column</span>
          <select className="field mt-1.5" value={draft.column ?? ''} onChange={(e) => setDraft({ ...draft, column: e.target.value })}>
            <option value="">— choose —</option>{columns.map((k) => <option key={k} value={k}>{k}</option>)}
          </select>
        </label>
      )}
      {c.kind === 'derived_field' && (
        <label className="block"><span className="label">Formula</span>
          <input className="field mt-1.5 font-mono text-[12px]" value={draft.formula} onChange={(e) => setDraft({ ...draft, formula: e.target.value })} />
          <span className="mt-1 block text-[11px] text-[var(--color-ink-faint)]">Functions: YEARS_BETWEEN, DAYS_BETWEEN, ROUND, BUCKET, EMI, IF, COALESCE, MIN, MAX, ABS.</span>
          {formulaError && <span role="alert" className="mt-1 block text-[11.5px] text-[var(--color-danger-text)]">{formulaError}</span>}
        </label>
      )}
      {c.kind === 'value_coercion' && (
        <div className="grid gap-2 sm:grid-cols-2">
          <label className="block"><span className="label">Date order</span>
            <select className="field mt-1.5" value={draft.detected_format} onChange={(e) => setDraft({ ...draft, detected_format: e.target.value })}>
              <option value="dmy">day / month / year</option><option value="mdy">month / day / year</option><option value="ymd">year / month / day</option>
            </select>
          </label>
          <label className="block"><span className="label">Action</span>
            <select className="field mt-1.5" value={draft.action} onChange={(e) => setDraft({ ...draft, action: e.target.value })}>
              <option value="parse">parse as dates</option><option value="null_out">blank out unparseable</option>
            </select>
          </label>
        </div>
      )}
      {c.kind === 'type_conflict' && (
        <label className="block"><span className="label">Action</span>
          <select className="field mt-1.5" value={draft.action} onChange={(e) => setDraft({ ...draft, action: e.target.value })}>
            <option value="null_out">treat odd values as blank</option><option value="keep_as_text">keep the whole column as text</option>
          </select>
        </label>
      )}
      {c.kind === 'column_rename' && (
        <div className="grid gap-2 sm:grid-cols-2">
          <label className="block"><span className="label">New key</span><input className="field mt-1.5 font-mono text-[12px]" value={draft.to} onChange={(e) => setDraft({ ...draft, to: e.target.value })} /></label>
          <label className="block"><span className="label">Label</span><input className="field mt-1.5" value={draft.label} onChange={(e) => setDraft({ ...draft, label: e.target.value })} /></label>
        </div>
      )}
      {c.kind === 'text_split' && (
        <div className="grid gap-2">
          {(draft.parts as Array<{ key: string; label: string; type: string }>).map((part, i) => (
            <div key={i} className="grid grid-cols-[1fr_1fr_120px] gap-2">
              <input className="field font-mono text-[12px]" value={part.key} aria-label={`Part ${i + 1} key`} onChange={(e) => { const parts = [...draft.parts]; parts[i] = { ...part, key: e.target.value }; setDraft({ ...draft, parts }); }} />
              <input className="field" value={part.label} aria-label={`Part ${i + 1} label`} onChange={(e) => { const parts = [...draft.parts]; parts[i] = { ...part, label: e.target.value }; setDraft({ ...draft, parts }); }} />
              <select className="field" value={part.type} aria-label={`Part ${i + 1} type`} onChange={(e) => { const parts = [...draft.parts]; parts[i] = { ...part, type: e.target.value }; setDraft({ ...draft, parts }); }}>
                {['text', 'number', 'currency', 'date', 'boolean'].map((t) => <option key={t} value={t}>{t}</option>)}
              </select>
            </div>
          ))}
        </div>
      )}
      <div className="mt-3 flex justify-end gap-2">
        <button className="btn btn-quiet h-[30px] text-[12px]" onClick={onDone}>Cancel</button>
        <Tip text="Save your value and approve it">
          <button className="btn btn-primary h-[30px] px-3 text-[12px]" disabled={!!formulaError} onClick={save}><Check size={13} /> Apply override</button>
        </Tip>
      </div>
    </div>
  );
}
