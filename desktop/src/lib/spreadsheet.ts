import Papa from "papaparse";
import { readSheet } from "read-excel-file/browser";
import writeXlsxFile from "write-excel-file/browser";

import { datedName, saveFile } from "./download";

export interface ParsedSheet {
  headers: string[];
  rows: string[][];
}

function cellText(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  return String(value).trim();
}

/** Reads the first sheet of an .xlsx file or a .csv file into header + text rows. */
export async function parseSpreadsheet(file: File): Promise<ParsedSheet> {
  const name = file.name.toLowerCase();
  let grid: string[][];

  if (name.endsWith(".csv") || file.type === "text/csv") {
    const text = await file.text();
    const result = Papa.parse<string[]>(text.replace(/^﻿/, ""), { skipEmptyLines: "greedy" });
    if (result.errors.length && !result.data.length) throw new Error(result.errors[0]?.message ?? "Couldn't read the CSV file.");
    grid = result.data.map((r) => r.map(cellText));
  } else if (name.endsWith(".xlsx")) {
    const data = await readSheet(file);
    grid = data.map((r) => r.map(cellText));
  } else {
    throw new Error("Use an .xlsx or .csv file. Older .xls files: open in Excel and save as .xlsx first.");
  }

  // Header row = first row with at least two non-empty cells (sheets often start with a title).
  const headerIndex = grid.findIndex((r) => r.filter(Boolean).length >= 2);
  if (headerIndex < 0) throw new Error("The file has no header row.");
  const headers = grid[headerIndex]!.map((h, i) => h || `Column ${i + 1}`);
  const rows = grid
    .slice(headerIndex + 1)
    .map((r) => headers.map((_, i) => r[i] ?? ""))
    .filter((r) => r.some(Boolean));
  return { headers, rows };
}

export interface ExportColumn<T> {
  header: string;
  value: (row: T) => string | number | null | undefined;
}

/** Builds an .xlsx or .csv file from rows and saves it. */
export async function exportRows<T>(format: "xlsx" | "csv", baseName: string, columns: ExportColumn<T>[], rows: T[]) {
  const fileName = datedName(baseName, format);
  if (format === "csv") {
    const csv = Papa.unparse({
      fields: columns.map((c) => c.header),
      data: rows.map((r) => columns.map((c) => c.value(r) ?? "")),
    });
    // BOM so Excel opens UTF-8 (ñ, é…) correctly.
    return saveFile(fileName, new Blob(["﻿" + csv], { type: "text/csv;charset=utf-8" }), {
      name: "CSV",
      extensions: ["csv"],
    });
  }
  const header = columns.map((c) => ({ value: c.header, fontWeight: "bold" as const }));
  const body = rows.map((r) =>
    columns.map((c) => {
      const v = c.value(r);
      return v === null || v === undefined || v === "" ? null : { value: v };
    }),
  );
  const blob = await writeXlsxFile([header, ...body], { columns: columns.map(() => ({ width: 22 })) }).toBlob();
  return saveFile(fileName, blob, { name: "Excel workbook", extensions: ["xlsx"] });
}
