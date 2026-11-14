/** Builds the invoice PDF in the browser from the invoice already on screen, so Download PDF never depends on the server. A4, Helvetica, ASCII only. */
import QRCode from "qrcode";
import { addDays, dateOnly, num, type Business, type Invoice } from "./common";

type RGB = [number, number, number];
const W = 595, H = 842, MARGIN = 40, R = W - MARGIN;
const REGULAR = [278, 278, 355, 556, 556, 889, 667, 191, 333, 333, 389, 584, 278, 333, 278, 278, 556, 556, 556, 556, 556, 556, 556, 556, 556, 556, 278, 278, 584, 584, 584, 556, 1015, 667, 667, 722, 722, 667, 611, 778, 722, 278, 500, 667, 556, 833, 722, 778, 667, 778, 722, 667, 611, 722, 667, 944, 667, 667, 611, 278, 278, 278, 469, 556, 333, 556, 556, 500, 556, 556, 278, 556, 556, 222, 222, 500, 222, 833, 556, 556, 556, 556, 333, 500, 278, 556, 500, 722, 500, 500, 500, 334, 260, 334, 584];
const BOLD = [278, 333, 474, 556, 556, 889, 722, 238, 333, 333, 389, 584, 278, 333, 278, 278, 556, 556, 556, 556, 556, 556, 556, 556, 556, 556, 333, 333, 584, 584, 584, 611, 975, 722, 722, 722, 722, 667, 611, 778, 722, 278, 556, 722, 611, 833, 722, 778, 667, 778, 722, 667, 611, 722, 667, 944, 667, 667, 611, 333, 278, 333, 584, 556, 333, 556, 611, 556, 611, 556, 333, 611, 611, 278, 278, 556, 278, 889, 611, 611, 611, 611, 389, 556, 333, 611, 556, 778, 556, 556, 500, 389, 280, 389, 584];
const INK: RGB = [0.1, 0.12, 0.11], MUTED: RGB = [0.42, 0.45, 0.44], LINE: RGB = [0.82, 0.85, 0.83], ACCENT: RGB = [0.2, 0.41, 0.31], WASH: RGB = [0.94, 0.96, 0.94], GREY: RGB = [0.93, 0.94, 0.93];

const clean = (s: unknown) => Array.from(String(s ?? "")).map((c) => (c.charCodeAt(0) >= 32 && c.charCodeAt(0) < 127 ? c : "?")).join("");
const width = (s: string, size = 10, bold = false) => { const t = bold ? BOLD : REGULAR; let n = 0; for (const c of clean(s)) n += t[c.charCodeAt(0) - 32]; return (n * size) / 1000; };
function wrap(s: string, max: number, size = 10, bold = false): string[] {
  const out: string[] = [];
  for (const para of String(s ?? "").split("\n")) {
    let line = "";
    for (const word of clean(para).split(/\s+/).filter(Boolean)) {
      const trial = (line + " " + word).trim();
      if (width(trial, size, bold) <= max || !line) line = trial; else { out.push(line); line = word; }
      while (width(line, size, bold) > max && line.length > 1) {
        let cut = line.length - 1;
        while (cut > 1 && width(line.slice(0, cut), size, bold) > max) cut--;
        out.push(line.slice(0, cut)); line = line.slice(cut);
      }
    }
    out.push(line);
  }
  return out.length ? out : [""];
}
const esc = (s: string) => clean(s).replace(/\\/g, "\\\\").replace(/\(/g, "\\(").replace(/\)/g, "\\)");
const rgb = (c: RGB) => c.map((v) => v.toFixed(3)).join(" ");
const f1 = (n: number) => n.toFixed(1);
const money = (n: unknown) => num(n as number).toLocaleString("en", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const qty = (n: unknown) => String(Number(num(n as number).toFixed(3)));

class Doc {
  pages: string[][] = [[]];
  y = MARGIN;
  constructor(public footer: string) {}
  get ops() { return this.pages[this.pages.length - 1]; }
  room(needed: number) { if (this.y + needed > H - MARGIN - 18) { this.pages.push([]); this.y = MARGIN; return true; } return false; }
  text(x: number, y: number, s: string, size = 10, bold = false, align: "l" | "r" = "l", color: RGB = INK) {
    const t = clean(s), w = width(t, size, bold);
    this.ops.push(`BT /${bold ? "F2" : "F1"} ${size} Tf ${rgb(color)} rg ${f1(align === "r" ? x - w : x)} ${f1(H - y)} Td (${esc(t)}) Tj ET`);
  }
  line(x1: number, y1: number, x2: number, y2: number, w = 0.6, color: RGB = LINE) { this.ops.push(`${rgb(color)} RG ${w} w ${f1(x1)} ${f1(H - y1)} m ${f1(x2)} ${f1(H - y2)} l S`); }
  rect(x: number, y: number, w: number, h: number, fill: RGB = WASH) { this.ops.push(`${rgb(fill)} rg ${f1(x)} ${f1(H - y - h)} ${f1(w)} ${f1(h)} re f`); }
  /** A slanted PAID / VOID stamp on a given page. */
  stamp(label: string, x: number, y: number, color: RGB, page: number, size = 54, angle = 18) {
    const a = (angle * Math.PI) / 180, c = Math.cos(a).toFixed(4), sn = Math.sin(a).toFixed(4);
    this.pages[page].push(`BT /F2 ${size} Tf ${rgb(color)} rg ${c} ${sn} -${sn} ${c} ${f1(x)} ${f1(H - y)} Tm (${esc(label)}) Tj ET`);
  }
  /** A QR code drawn as plain squares, so it stays sharp at any size and needs no image. */
  qr(x: number, y: number, size: number, text: string) {
    const q = QRCode.create(text, { errorCorrectionLevel: "M" }), n = q.modules.size, cell = size / n;
    this.rect(x - 4, y - 4, size + 8, size + 8, [1, 1, 1]);
    for (let r = 0; r < n; r++) { let c = 0; while (c < n) { if (!q.modules.get(r, c)) { c++; continue; } let e = c; while (e < n && q.modules.get(r, e)) e++; this.rect(x + c * cell, y + r * cell, (e - c) * cell + 0.2, cell + 0.2, INK); c = e; } }
  }
  paragraph(x: number, s: string, max: number, size = 10, color: RGB = INK) {
    for (const part of wrap(s, max, size)) { this.room(size * 1.35); this.text(x, this.y + size, part, size, false, "l", color); this.y += size * 1.35; }
  }
  render(): Blob {
    const count = this.pages.length;
    const objects: string[] = ["<< /Type /Catalog /Pages 2 0 R >>", `<< /Type /Pages /Kids [${this.pages.map((_, i) => `${3 + i * 2} 0 R`).join(" ")}] /Count ${count} >>`];
    const regular = 3 + count * 2, bold = 4 + count * 2;
    this.pages.forEach((ops, n) => {
      const label = `Page ${n + 1} of ${count}`;
      const stream = [...ops, `BT /F1 8 Tf ${rgb(MUTED)} rg ${MARGIN} 24 Td (${esc(this.footer)}) Tj ET`, `BT /F1 8 Tf ${rgb(MUTED)} rg ${f1(W - MARGIN - width(label, 8))} 24 Td (${label}) Tj ET`].join("\n");
      objects.push(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${W} ${H}] /Resources << /Font << /F1 ${regular} 0 R /F2 ${bold} 0 R >> >> /Contents ${4 + n * 2} 0 R >>`);
      objects.push(`<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`);
    });
    objects.push("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>", "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>");
    let out = "%PDF-1.4\n"; const offsets: number[] = [];
    objects.forEach((body, i) => { offsets.push(out.length); out += `${i + 1} 0 obj\n${body}\nendobj\n`; });
    const start = out.length;
    out += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n` + offsets.map((o) => `${String(o).padStart(10, "0")} 00000 n \n`).join("");
    out += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${start}\n%%EOF\n`;
    return new Blob([new TextEncoder().encode(out)], { type: "application/pdf" });
  }
}

function block(d: Doc, x: number, w: number, label: string, rows: [string | undefined, number, boolean][]) {
  d.text(x, d.y + 8, label, 8, true, "l", MUTED);
  let y = d.y + 22;
  for (const [text, size, bold] of rows) if (text) for (const part of wrap(text, w, size, bold)) { d.text(x, y + size * 0.8, part, size, bold); y += size * 1.4; }
  return y;
}

export function invoicePdf(inv: Invoice, shop: Business): Blob {
  const b = { ...shop, ...(inv.business || {}) };
  const d = new Doc((b.name || "Workshop") + " | " + inv.invoice_number);
  const taxRate = num(inv.tax_rate), status = inv.status;
  // header
  d.rect(0, 0, W, 12, ACCENT);
  const top = d.y;
  const mono = (b.name || "W").split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]).join("").toUpperCase() || "W";
  d.rect(MARGIN, top, 36, 36, ACCENT);
  d.text(MARGIN + 18 + width(mono, 14, true) / 2, top + 23, mono, 14, true, "r", [1, 1, 1]);
  d.text(MARGIN + 46, top + 24, b.name || "Workshop", 18, true, "l", ACCENT);
  let y = top + 44;
  for (const part of [b.address, [b.phone, b.email].filter(Boolean).join(" | "), b.reg_no]) if (part) for (const row of wrap(part, 300, 9)) { d.text(MARGIN, y + 8, row, 9, false, "l", MUTED); y += 12; }
  d.text(R, top + 20, status === "VOID" ? "VOID" : taxRate ? "TAX INVOICE" : "INVOICE", 20, true, "r");
  let ry = top + 36;
  const label = { UNPAID: "Unpaid", PARTIAL: "Part paid", PAID: "Paid", VOID: "Void" }[status] || status;
  const terms = num(b.payment_terms_days ?? 0);
  const meta: [string, boolean][] = [[inv.invoice_number, true], ["Date: " + dateOnly(inv.created_at), false]];
  if (terms) meta.push(["Due: " + addDays(dateOnly(inv.created_at), terms) + " (" + terms + " days)", false]);
  meta.push(["Status: " + label, false]);
  for (const [t, bold] of meta) { d.text(R, ry + 8, t, 9.5, bold, "r", bold ? INK : MUTED); ry += 13; }
  d.y = Math.max(y, ry) + 8; d.line(MARGIN, d.y, R, d.y, 1.2, ACCENT); d.y += 14;
  // parties
  const left = block(d, MARGIN, 230, "BILL TO", [[inv.customer, 11, true], [inv.address, 9.5, false], [inv.phone, 9.5, false]]);
  const km = inv.odometer != null ? Math.round(num(inv.odometer)).toLocaleString("en") + " km" : "";
  const right = block(d, 320, 235, "VEHICLE", [[inv.registration, 13, true], [inv.vehicle, 9.5, false], [km, 9.5, false], [inv.mechanic ? "Mechanic: " + inv.mechanic : "", 9.5, false]]);
  d.y = Math.max(left, right) + 6;
  if (inv.summary) { d.text(MARGIN, d.y + 8, "WORK REQUESTED", 8, true, "l", MUTED); d.y += 14; d.paragraph(MARGIN, inv.summary, R - MARGIN, 9.5); d.y += 6; }
  // lines
  const table = (title: string, items: { name: string; qty?: number; price?: number; amount: number }[]) => {
    if (!items.length) return;
    d.room(60);
    d.rect(MARGIN, d.y, R - MARGIN, 18, GREY);
    d.text(MARGIN + 6, d.y + 12.5, "#", 8.5, true); d.text(MARGIN + 34, d.y + 12.5, title, 8.5, true);
    if (title === "PARTS") { d.text(330, d.y + 12.5, "QTY", 8.5, true, "r"); d.text(415, d.y + 12.5, "UNIT PRICE", 8.5, true, "r"); }
    d.text(R - 6, d.y + 12.5, "AMOUNT (" + (inv.currency || "LKR") + ")", 8.5, true, "r");
    d.y += 18;
    items.forEach((row, n) => {
      const lines = wrap(row.name, 270, 9.5), h = Math.max(20, lines.length * 13 + 8);
      d.room(h);
      d.text(MARGIN + 6, d.y + 14, String(n + 1), 9.5, false, "l", MUTED);
      lines.forEach((part, k) => d.text(MARGIN + 34, d.y + 14 + k * 13, part, 9.5));
      if (row.qty != null) { d.text(330, d.y + 14, qty(row.qty), 9.5, false, "r"); d.text(415, d.y + 14, money(row.price), 9.5, false, "r"); }
      d.text(R - 6, d.y + 14, money(row.amount), 9.5, false, "r");
      d.y += h; d.line(MARGIN, d.y, R, d.y);
    });
    d.y += 8;
  };
  table("PARTS", (inv.parts || []).map((p) => ({ name: p.name, qty: p.quantity, price: p.unit_price, amount: num(p.quantity) * num(p.unit_price) })));
  table("LABOUR", (inv.labour || []).map((l) => ({ name: l.description, amount: num(l.amount) })));
  // totals
  const totals: [string, string][] = [["Parts", money(inv.parts_total)], ["Labour", money(inv.labour_total)]];
  if (num(inv.discount)) totals.push(["Discount", "-" + money(inv.discount)]);
  if (num(inv.tax)) totals.push([(inv.tax_name || "VAT") + " (" + qty(taxRate) + "%)", money(inv.tax)]);
  d.room(30 + 16 * totals.length + 70);
  const totPage = d.pages.length - 1, totY = d.y;
  for (const [l, v] of totals) { d.text(430, d.y + 10, l, 9.5, false, "r", MUTED); d.text(R - 6, d.y + 10, v, 9.5, false, "r"); d.y += 16; }
  d.rect(300, d.y + 2, R - 300, 26, ACCENT);
  d.text(310, d.y + 19, "TOTAL (" + (inv.currency || "LKR") + ")", 10, true, "l", [1, 1, 1]);
  d.text(R - 6, d.y + 19, money(inv.total), 12, true, "r", [1, 1, 1]);
  d.y += 36;
  if (num(inv.paid)) { d.text(430, d.y + 8, "Paid", 9.5, false, "r", MUTED); d.text(R - 6, d.y + 8, money(inv.paid), 9.5, false, "r"); d.y += 16; }
  if (status !== "VOID") { d.text(430, d.y + 10, "Balance due", 10, true, "r"); d.text(R - 6, d.y + 10, money(num(inv.total) - num(inv.paid)), 11, true, "r"); d.y += 22; }
  const pays = inv.payments || [];
  if (pays.length) {
    d.room(40 + 14 * pays.length);
    d.text(MARGIN, d.y + 8, "PAYMENTS RECEIVED", 8, true, "l", MUTED); d.y += 14;
    for (const p of pays) {
      const m = String(p.method || ""); d.text(MARGIN, d.y + 9, dateOnly(p.at) + "   " + m.charAt(0) + m.slice(1).toLowerCase() + (p.note ? "   " + p.note : ""), 9);
      d.text(R - 6, d.y + 9, money(p.amount), 9, false, "r"); d.y += 14;
    }
    d.y += 6;
  }
  if (inv.next_service_date || inv.next_service_km) {
    d.room(40); d.rect(MARGIN, d.y, R - MARGIN, 26, WASH);
    const what = [inv.next_service_date && "on " + inv.next_service_date, inv.next_service_km && "at " + Math.round(num(inv.next_service_km)).toLocaleString("en") + " km"].filter(Boolean).join(" and ");
    d.text(MARGIN + 10, d.y + 17, "Next service due " + what, 9.5, true, "l", ACCENT); d.y += 36;
  }
  if (!taxRate && !num(inv.tax) && !b.reg_no) { d.room(20); d.text(MARGIN, d.y + 10, "This is not a tax invoice.", 9, true, "l", MUTED); d.y += 18; }
  if (b.bank || b.qr_url) {
    const bankLines = b.bank ? wrap(b.bank, 280, 9) : [], boxH = Math.max(b.qr_url ? 84 : 0, 30 + bankLines.length * 12);
    d.room(boxH + 14); d.rect(MARGIN, d.y, R - MARGIN, boxH, WASH);
    d.text(MARGIN + 10, d.y + 14, "HOW TO PAY", 8, true, "l", ACCENT);
    bankLines.forEach((l, k) => d.text(MARGIN + 10, d.y + 29 + k * 12, l, 9));
    if (b.qr_url) { try { d.qr(R - 76, d.y + 8, 64, b.qr_url); d.text(R - 44, d.y + boxH - 1, "Scan", 7, false, "r", MUTED); } catch { /* link too long for a QR */ } }
    d.y += boxH + 10;
  }
  if (b.warranty) { d.room(46); d.text(MARGIN, d.y + 8, "WARRANTY", 8, true, "l", MUTED); d.y += 14; d.paragraph(MARGIN, b.warranty, R - MARGIN, 9); d.y += 4; }
  if (b.footer) d.paragraph(MARGIN, b.footer, R - MARGIN, 9, MUTED);
  d.room(50);
  d.y = d.pages.length === 1 && d.y < H - MARGIN - 80 ? Math.max(d.y + 24, H - MARGIN - 50) : d.y + 24;
  d.line(R - 170, d.y, R, d.y);
  d.text(R, d.y + 12, "Authorised signature", 8.5, false, "r", MUTED);
  if (status === "PAID" || status === "VOID") d.stamp(status === "PAID" ? "PAID" : "VOID", 150, totY + 70, status === "PAID" ? [0.2, 0.55, 0.35] : [0.75, 0.2, 0.2], totPage);
  return d.render();
}

/** Saves the invoice as a PDF file on this device. */
export function downloadInvoicePdf(inv: Invoice, shop: Business) {
  const url = URL.createObjectURL(invoicePdf(inv, shop));
  const a = document.createElement("a");
  a.href = url; a.download = clean(inv.invoice_number).replace(/[^A-Za-z0-9_-]/g, "") + ".pdf";
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30000);
}

/** Opens the phone's share sheet with the PDF attached (WhatsApp, email...). Returns false when the device cannot share files, so the caller can fall back. */
export async function shareInvoicePdf(inv: Invoice, shop: Business, text: string): Promise<boolean> {
  const file = new File([invoicePdf(inv, shop)], clean(inv.invoice_number).replace(/[^A-Za-z0-9_-]/g, "") + ".pdf", { type: "application/pdf" });
  const nav = navigator as Navigator & { canShare?: (d: ShareData) => boolean };
  if (!nav.share || !nav.canShare || !nav.canShare({ files: [file] })) return false;
  try { await nav.share({ files: [file], title: inv.invoice_number, text }); } catch (e) { if ((e as Error).name !== "AbortError") throw e; }
  return true;
}
