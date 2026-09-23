import { Tip } from './tip';

export function StatusChip({ status }: { status: string }) {
  const map: Record<string, { cls: string; label: string; tip: string }> = {
    uploaded:    { cls: 'chip-neutral', label: 'Raw',         tip: 'Uploaded but not structured yet' },
    structuring: { cls: 'chip-pending', label: 'Structuring', tip: 'The structurer is running' },
    structured:  { cls: 'chip-ok',      label: 'Structured',  tip: 'Canonical schema in place; ready to map and report' },
    failed:      { cls: 'chip-danger',  label: 'Failed',      tip: 'Structuring failed — run it again' },
  };
  const m = map[status] ?? map.uploaded!;
  return <Tip text={m.tip} side="bottom"><span className={`chip ${m.cls}`}>{m.label}</span></Tip>;
}
