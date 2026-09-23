/** Runs the structurer over the generated files and prints what it found. */
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { structureSheet } from '@azentio/core';
import { readXlsx, readCsv } from '@azentio/core/sheet';

const DIR = resolve(process.cwd(), '../../mock-data');

async function run(file: string) {
  const path = resolve(DIR, file);
  const sheet = file.endsWith('.csv')
    ? await readCsv(await readFile(path, 'utf8'))
    : await readXlsx(await readFile(path));

  const r = structureSheet(sheet.rows);

  console.log(`\n══ ${file} ── ${sheet.rows.length} raw rows`);
  console.log(`   header row ${r.headerRowIndex + 1}${r.mergedHeader ? ' (+1, merged)' : ''} · ` +
              `${r.rows.length} data rows · ${r.excluded.length} excluded`);
  for (const n of r.notes) console.log(`   · ${n}`);

  console.log('   columns:');
  for (const c of r.columns) {
    const flags = [
      c.confidence < 95 ? `${c.confidence}% fit` : null,
      c.oddValues.length ? `odd: ${c.oddValues.slice(0, 3).join('/')}` : null,
      c.dateAmbiguous ? 'DATE AMBIGUOUS' : null,
      c.split ? `SPLIT→${c.split.parts.map((p) => p.key).join('+')}` : null,
    ].filter(Boolean);
    console.log(
      `     ${c.sourceHeader.padEnd(22).slice(0, 22)} → ${c.key.padEnd(20)} ${c.type}` +
      (flags.length ? `   [${flags.join(' · ')}]` : ''),
    );
  }

  const sample = r.rows[0];
  if (sample) {
    const shown = Object.entries(sample.data).slice(0, 6)
      .map(([k, v]) => `${k}=${JSON.stringify(v)}`).join('  ');
    console.log(`   first row: ${shown}`);
  }
}

async function main() {
  for (const f of ['loan_master_2024.xlsx', 'repayments_q1.csv', 'branch_collections.xlsx', 'bureau_extract.xlsx']) {
    await run(f);
  }
}
main().catch((e) => { console.error(e); process.exit(1); });
