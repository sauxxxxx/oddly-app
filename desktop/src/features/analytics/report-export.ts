import { datedName, saveFile } from "@/lib/download";

/** One table in an exported report. Cells are already formatted (money keeps its currency code). */
export interface ReportSection {
  title: string;
  columns: string[];
  rows: (string | number)[][];
}

export interface ReportDoc {
  title: string;
  period: string;
  sections: ReportSection[];
  note?: string;
}

/** PDF-safe money: built-in PDF fonts have no ₱ glyph, so exports use the ISO code. */
export function plainMoney(amount: string | number, currency: string) {
  const n = typeof amount === "string" ? Number(amount) : amount;
  return `${currency} ${n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

/** All sections in one CSV, each preceded by its title row. */
export async function exportReportCsv(report: ReportDoc) {
  const { default: Papa } = await import("papaparse");
  const blocks = [
    Papa.unparse([[report.title], [report.period], ...(report.note ? [[report.note]] : [])]),
    ...report.sections.map((s) => Papa.unparse([[s.title], s.columns, ...s.rows])),
  ];
  const csv = blocks.join("\r\n\r\n");
  return saveFile(datedName(report.title, "csv"), new Blob(["﻿" + csv], { type: "text/csv;charset=utf-8" }), {
    name: "CSV",
    extensions: ["csv"],
  });
}

const ACCENT: [number, number, number] = [147, 51, 234];
const INK: [number, number, number] = [24, 24, 27];
const MUTED: [number, number, number] = [113, 113, 122];

export async function exportReportPdf(report: ReportDoc, preparedBy: string) {
  const [{ jsPDF }, { autoTable }] = await Promise.all([import("jspdf"), import("jspdf-autotable")]);
  const doc = new jsPDF({ unit: "pt", format: "a4" });
  const W = doc.internal.pageSize.getWidth();
  const M = 40;
  doc.setFillColor(...ACCENT);
  doc.rect(0, 0, W, 6, "F");
  doc.setFont("helvetica", "bold");
  doc.setFontSize(20);
  doc.setTextColor(...INK);
  doc.text(report.title, M, 52);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(10);
  doc.setTextColor(...MUTED);
  doc.text(`${report.period}  ·  Prepared by ${preparedBy}  ·  ODDLY`, M, 70);
  let y = 86;
  if (report.note) {
    const lines = doc.splitTextToSize(report.note, W - 2 * M) as string[];
    doc.text(lines, M, y);
    y += lines.length * 12 + 4;
  }

  for (const section of report.sections) {
    if (y > doc.internal.pageSize.getHeight() - 100) {
      doc.addPage();
      y = M;
    }
    doc.setFont("helvetica", "bold");
    doc.setFontSize(12);
    doc.setTextColor(...INK);
    doc.text(section.title, M, (y += 16));
    autoTable(doc, {
      startY: y + 6,
      head: [section.columns],
      body: section.rows.length ? section.rows.map((r) => r.map(String)) : [[{ content: "No data for this period", colSpan: section.columns.length }]],
      margin: { left: M, right: M },
      styles: { fontSize: 9, cellPadding: 5, textColor: INK },
      headStyles: { fillColor: [244, 244, 245], textColor: MUTED, fontStyle: "bold" },
      columnStyles: Object.fromEntries(section.columns.map((_, i) => [i, { halign: i === 0 ? "left" : "right" }])),
      theme: "plain",
    });
    y = (doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY + 14;
  }

  const pages = doc.getNumberOfPages();
  for (let i = 1; i <= pages; i++) {
    doc.setPage(i);
    doc.setFontSize(8);
    doc.setTextColor(...MUTED);
    doc.text(`Page ${i} of ${pages}`, W - M, doc.internal.pageSize.getHeight() - 20, { align: "right" });
  }
  return saveFile(datedName(report.title, "pdf"), doc.output("blob"), { name: "PDF", extensions: ["pdf"] });
}
