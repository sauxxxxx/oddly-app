import { jsPDF } from "jspdf";
import { autoTable } from "jspdf-autotable";

import { datedName, saveFile } from "@/lib/download";
import type { ProposalDetail } from "@/types/sales";
import { BILLING_LABELS } from "@/types/sales";

/** PDF-safe money: built-in PDF fonts have no ₱ glyph, so use the ISO code. */
function money(amount: string | number, currency: string) {
  const n = typeof amount === "string" ? Number(amount) : amount;
  return `${currency} ${n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function plainDate(d: string) {
  const [y, m, day] = d.slice(0, 10).split("-").map(Number);
  return new Date(Date.UTC(y!, m! - 1, day!)).toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric", timeZone: "UTC" });
}

const ACCENT: [number, number, number] = [147, 51, 234];
const INK: [number, number, number] = [24, 24, 27];
const MUTED: [number, number, number] = [113, 113, 122];

/** Builds the client-facing proposal PDF and saves it. */
export async function downloadProposalPdf(p: ProposalDetail, preparedBy: { name: string; email: string }) {
  const doc = new jsPDF({ unit: "pt", format: "a4" });
  const W = doc.internal.pageSize.getWidth();
  const M = 48;
  let y = M;

  // Header band
  doc.setFillColor(...ACCENT);
  doc.rect(0, 0, W, 6, "F");
  doc.setFont("helvetica", "bold");
  doc.setFontSize(22);
  doc.setTextColor(...INK);
  doc.text("Proposal", M, (y += 20));
  doc.setFont("helvetica", "normal");
  doc.setFontSize(10);
  doc.setTextColor(...MUTED);
  const meta = [`No. ${p.number}${p.current_version > 1 ? ` · v${p.current_version}` : ""}`, `Date: ${plainDate(p.sent_at ?? p.updated_at)}`];
  if (p.valid_until) meta.push(`Valid until: ${plainDate(p.valid_until)}`);
  meta.forEach((line, i) => doc.text(line, W - M, y - 8 + i * 13, { align: "right" }));

  doc.setFontSize(14);
  doc.setFont("helvetica", "bold");
  doc.setTextColor(...INK);
  y += 28;
  doc.text(doc.splitTextToSize(p.title, W - 2 * M) as string[], M, y);
  y += 26;

  // Parties
  const r = p.recipient;
  const forLines = [
    r.company_name,
    r.contact_name ? `Attn: ${r.contact_name}${r.contact_position ? `, ${r.contact_position}` : ""}` : null,
    [r.address, r.city, r.region, r.country].filter(Boolean).join(", ") || null,
    [r.contact_email, r.contact_phone].filter(Boolean).join(" · ") || null,
  ].filter(Boolean) as string[];
  doc.setFontSize(9);
  doc.setTextColor(...MUTED);
  doc.text("PREPARED FOR", M, y);
  doc.text("PREPARED BY", W / 2 + 10, y);
  doc.setFontSize(10.5);
  doc.setTextColor(...INK);
  doc.setFont("helvetica", "normal");
  const leftEnd = forLines.reduce((yy, line, i) => {
    const wrapped = doc.splitTextToSize(line, W / 2 - M - 10) as string[];
    doc.setFont("helvetica", i === 0 ? "bold" : "normal");
    doc.text(wrapped, M, yy);
    return yy + wrapped.length * 14;
  }, y + 16);
  doc.setFont("helvetica", "bold");
  doc.text(preparedBy.name, W / 2 + 10, y + 16);
  doc.setFont("helvetica", "normal");
  doc.text(preparedBy.email, W / 2 + 10, y + 30);
  y = Math.max(leftEnd, y + 44) + 12;

  // Introduction
  if (p.introduction) {
    doc.setFontSize(10.5);
    doc.setTextColor(...INK);
    const lines = doc.splitTextToSize(p.introduction, W - 2 * M) as string[];
    doc.text(lines, M, y);
    y += lines.length * 14 + 14;
  }

  // Line items
  autoTable(doc, {
    startY: y,
    margin: { left: M, right: M },
    head: [["Service", "Billing", "Qty", "Unit price", "Amount"]],
    body: p.items.map((i) => {
      const detail = [i.description, ...i.deliverables.map((d) => `• ${d}`)].filter(Boolean).join("\n");
      return [
        { content: detail ? `${i.name}\n${detail}` : i.name },
        BILLING_LABELS[i.billing_type],
        Number(i.quantity).toLocaleString("en-US"),
        money(i.unit_price, p.currency),
        money(Number(i.quantity) * Number(i.unit_price), p.currency),
      ];
    }),
    styles: { font: "helvetica", fontSize: 9.5, cellPadding: 7, textColor: INK, lineColor: [228, 228, 231], lineWidth: 0.5 },
    headStyles: { fillColor: [244, 244, 245], textColor: MUTED, fontStyle: "bold", fontSize: 8.5 },
    columnStyles: { 0: { cellWidth: "auto" }, 1: { cellWidth: 64 }, 2: { cellWidth: 36, halign: "right" }, 3: { cellWidth: 92, halign: "right" }, 4: { cellWidth: 96, halign: "right" } },
    didParseCell: (data) => {
      if (data.section === "body" && data.column.index === 0) data.cell.styles.fontStyle = "normal";
    },
  });
  y = (doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY + 16;

  // Totals
  const rows: [string, string, boolean?][] = [["Subtotal", money(p.subtotal, p.currency)]];
  if (Number(p.discount_amount) > 0) {
    rows.push([p.discount_type === "percent" ? `Discount (${Number(p.discount_value)}%)` : "Discount", `- ${money(p.discount_amount, p.currency)}`]);
  }
  if (Number(p.tax_rate) > 0) rows.push([`Tax (${Number(p.tax_rate)}%)`, money(p.tax_amount, p.currency)]);
  rows.push(["Total", money(p.total, p.currency), true]);
  if (y > doc.internal.pageSize.getHeight() - 140) {
    doc.addPage();
    y = M;
  }
  for (const [label, value, strong] of rows) {
    doc.setFont("helvetica", strong ? "bold" : "normal");
    doc.setFontSize(strong ? 12 : 10.5);
    doc.setTextColor(...(strong ? INK : MUTED));
    doc.text(label, W - M - 200, y);
    doc.setTextColor(...INK);
    doc.text(value, W - M, y, { align: "right" });
    y += strong ? 20 : 16;
  }
  if (p.items.some((i) => i.billing_type !== "one_time")) {
    doc.setFont("helvetica", "normal");
    doc.setFontSize(8.5);
    doc.setTextColor(...MUTED);
    doc.text("Recurring items are billed per period shown; the total reflects one billing period.", W - M, y, { align: "right" });
    y += 18;
  }

  // Terms
  if (p.terms) {
    y += 10;
    const lines = doc.splitTextToSize(p.terms, W - 2 * M) as string[];
    if (y + lines.length * 13 > doc.internal.pageSize.getHeight() - M) {
      doc.addPage();
      y = M;
    }
    doc.setFont("helvetica", "bold");
    doc.setFontSize(10.5);
    doc.setTextColor(...INK);
    doc.text("Terms & conditions", M, y);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(9.5);
    doc.setTextColor(...MUTED);
    doc.text(lines, M, y + 16);
  }

  // Footer page numbers
  const pages = doc.getNumberOfPages();
  for (let i = 1; i <= pages; i++) {
    doc.setPage(i);
    doc.setFontSize(8);
    doc.setTextColor(...MUTED);
    doc.text(`${p.number} · Page ${i} of ${pages}`, W / 2, doc.internal.pageSize.getHeight() - 24, { align: "center" });
  }

  const safe = (r.company_name ?? p.title).replace(/[\\/:*?"<>|]+/g, " ").trim();
  return saveFile(datedName(`${p.number} ${safe}`, "pdf"), doc.output("blob"), { name: "PDF", extensions: ["pdf"] });
}
