/**
 * Reads .xlsx and .csv into a positional grid.
 *
 * Server-only: it pulls in exceljs, which has no business in a browser bundle.
 * Imported via the '@azentio/core/sheet' entry point rather than the package
 * index so nothing client-side can reach it by accident.
 */

import ExcelJS from 'exceljs';
import type { RawCell } from './structure';

export interface SheetData {
  sheetName: string;
  rows: RawCell[][];
}

function cellValue(v: ExcelJS.CellValue): RawCell {
  if (v === null || v === undefined) return null;
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  if (typeof v === 'object') {
    // Formula cells carry their computed result; hyperlinks and rich text carry text.
    if ('result' in v && v.result !== undefined) return cellValue(v.result as ExcelJS.CellValue);
    if ('text' in v && typeof v.text === 'string') return v.text;
    if ('richText' in v) return (v.richText as Array<{ text: string }>).map((r) => r.text).join('');
    return null;
  }
  if (typeof v === 'boolean' || typeof v === 'number') return v;
  return String(v);
}

function worksheetToRows(ws: ExcelJS.Worksheet): RawCell[][] {
  const rows: RawCell[][] = [];
  const width = ws.columnCount;

  ws.eachRow({ includeEmpty: true }, (row) => {
    const cells: RawCell[] = [];
    for (let c = 1; c <= width; c++) {
      cells.push(cellValue(row.getCell(c).value));
    }
    rows.push(cells);
  });

  // Trim wholly empty trailing rows that Excel's row count often over-reports.
  while (rows.length && rows[rows.length - 1]!.every((c) => c === null || c === '')) rows.pop();
  return rows;
}

export async function readXlsx(buffer: ArrayBuffer | Buffer, sheet?: string): Promise<SheetData> {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buffer as ArrayBuffer);

  const ws = sheet ? wb.getWorksheet(sheet) : wb.worksheets[0];
  if (!ws) throw new Error(sheet ? `No sheet named "${sheet}".` : 'Workbook has no sheets.');

  return { sheetName: ws.name, rows: worksheetToRows(ws) };
}

export function listSheets(buffer: ArrayBuffer | Buffer): Promise<string[]> {
  const wb = new ExcelJS.Workbook();
  return wb.xlsx.load(buffer as ArrayBuffer).then(() => wb.worksheets.map((w) => w.name));
}

/**
 * Minimal RFC-4180 CSV parser: quoted fields, escaped quotes, embedded commas
 * and newlines. Hand-rolled rather than a dependency because the whole grammar
 * is twenty lines and a parser is easier to reason about than a config.
 */
export function parseCsv(text: string): RawCell[][] {
  const rows: RawCell[][] = [];
  let row: RawCell[] = [];
  let field = '';
  let quoted = false;
  let i = 0;

  const pushField = () => { row.push(field === '' ? null : field); field = ''; };
  const pushRow = () => { pushField(); rows.push(row); row = []; };

  // Strip a UTF-8 BOM, which Excel writes and which otherwise corrupts the
  // first header name.
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);

  while (i < text.length) {
    const ch = text[i]!;

    if (quoted) {
      if (ch === '"') {
        if (text[i + 1] === '"') { field += '"'; i += 2; continue; }
        quoted = false; i++; continue;
      }
      field += ch; i++; continue;
    }

    if (ch === '"') { quoted = true; i++; continue; }
    if (ch === ',') { pushField(); i++; continue; }
    if (ch === '\r') { i++; continue; }
    if (ch === '\n') { pushRow(); i++; continue; }

    field += ch; i++;
  }

  if (field !== '' || row.length > 0) pushRow();
  return rows;
}

export async function readCsv(text: string, name = 'Sheet1'): Promise<SheetData> {
  return { sheetName: name, rows: parseCsv(text) };
}
