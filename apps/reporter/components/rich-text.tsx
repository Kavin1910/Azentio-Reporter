import type { ReactNode } from 'react';

/**
 * Renders the assistant's text with a deliberately tiny markdown subset:
 * paragraphs, "- " bullet lists, **bold**, *italic* and `code`. Nothing else —
 * no links, no HTML, no headings — so model output can never inject markup.
 *
 * The prompt asks for plain text; this is the safety net for when the model
 * writes **bold** anyway, so the reader sees emphasis rather than asterisks.
 */
export function RichText({ text }: { text: string }) {
  const blocks = text.replace(/\r\n/g, '\n').trim().split(/\n{2,}/);
  return (
    <>
      {blocks.map((block, i) => {
        const lines = block.split('\n');
        const isList = lines.length > 0 && lines.every((l) => /^\s*[-•*]\s+/.test(l));
        if (isList) {
          return (
            <ul key={i} className={`m-0 list-disc pl-4 ${i > 0 ? 'mt-2' : ''}`}>
              {lines.map((l, j) => <li key={j}>{inline(l.replace(/^\s*[-•*]\s+/, ''))}</li>)}
            </ul>
          );
        }
        return (
          <p key={i} className={i > 0 ? 'mt-2' : ''}>
            {lines.map((l, j) => <span key={j}>{j > 0 && <br />}{inline(l)}</span>)}
          </p>
        );
      })}
    </>
  );
}

/** **bold**, *italic*, `code`. Unmatched markers are shown as-is. */
function inline(s: string): ReactNode[] {
  const out: ReactNode[] = [];
  const re = /(\*\*[^*\n]+\*\*|`[^`\n]+`|\*[^*\n]+\*)/g;
  let last = 0; let k = 0;
  for (const m of s.matchAll(re)) {
    if (m.index! > last) out.push(s.slice(last, m.index));
    const tok = m[0];
    if (tok.startsWith('**')) out.push(<strong key={k++} className="font-semibold text-[var(--color-ink)]">{tok.slice(2, -2)}</strong>);
    else if (tok.startsWith('`')) out.push(<code key={k++} className="rounded-[4px] bg-[var(--color-canvas-sunken)] px-1 font-mono text-[12px]">{tok.slice(1, -1)}</code>);
    else out.push(<em key={k++}>{tok.slice(1, -1)}</em>);
    last = m.index! + tok.length;
  }
  if (last < s.length) out.push(s.slice(last));
  return out;
}
