/** Prints the top rows of each generated file, so the mess is visible. */
import ExcelJS from 'exceljs';
import { resolve } from 'node:path';

const OUT = resolve(process.cwd(), '../../mock-data');

async function main() {
  for (const f of ['loan_master_2024.xlsx', 'branch_collections.xlsx', 'bureau_extract.xlsx']) {
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.readFile(resolve(OUT, f));
    const ws = wb.worksheets[0]!;
    console.log(`\n===== ${f}  (${ws.rowCount} rows) =====`);
    for (let r = 1; r <= Math.min(8, ws.rowCount); r++) {
      const cells: string[] = [];
      ws.getRow(r).eachCell({ includeEmpty: true }, (c) => cells.push(String(c.value ?? '').slice(0, 20)));
      console.log(` ${String(r).padStart(2)}| ${cells.join(' | ')}`);
    }
  }
}
main().catch((e) => { console.error(e); process.exit(1); });
