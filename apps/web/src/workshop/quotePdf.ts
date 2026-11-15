/** Builds the estimate PDF in the browser, laid out like the paper estimate: letterhead, who it is for, the vehicle, the damage, then the work by section. */
import { Doc, INK, MARGIN, R, W, block, clean, money, qty, width, wrap, type RGB } from "./invoicePdf";
import { dateOnly, num, type Business, type Quote } from "./common";
import { peekLogo } from "../logoStore";

const MUTED: RGB = [0.42, 0.45, 0.44], LINE: RGB = [0.82, 0.85, 0.83], ACCENT: RGB = [0.2, 0.41, 0.31], GREY: RGB = [0.93, 0.94, 0.93];
export const SECTION_TITLE: Record<string, string> = { "Rem/Refit": "REM / REFIT", Repaint: "REPAINT", Other: "OTHER WORK" };

export function quotePdf(q: Quote, shop: Business): Blob {
  const b = shop;
  const d = new Doc((b.name || "Workshop") + " | " + q.number);
  d.rect(0, 0, W, 12, ACCENT);
  const top = d.y;
  const mono = (b.name || "W").split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]).join("").toUpperCase() || "W";
  const logo = peekLogo();
  let nameX = MARGIN + 46;
  if (logo) {
    const lh = 38, lw = Math.min(96, (lh * logo.w) / logo.h), ah = (lw * logo.h) / logo.w;
    d.image(MARGIN, top, lw, ah, atob(logo.data), logo.w, logo.h, logo.c);
    nameX = MARGIN + lw + 10;
  } else {
    d.rect(MARGIN, top, 36, 36, ACCENT);
    d.text(MARGIN + 18 + width(mono, 14, true) / 2, top + 23, mono, 14, true, "r", [1, 1, 1]);
  }
  d.text(nameX, top + 24, b.name || "Workshop", 18, true, "l", ACCENT);
  let y = top + 44;
  for (const part of [b.address, b.phone ? "Tel: " + b.phone : "", b.email ? "Email: " + b.email : "", b.reg_no]) if (part) for (const row of wrap(part, 300, 9)) { d.text(MARGIN, y + 8, row, 9, false, "l", MUTED); y += 12; }
  d.text(R, top + 20, q.kind === "QUOTATION" ? "QUOTATION" : "ESTIMATE", 20, true, "r");
  let ry = top + 36;
  const meta: [string, boolean][] = [[q.number + (q.rev_no > 1 ? "  (version " + q.rev_no + ")" : ""), true], ["Date: " + dateOnly(q.updated_at || q.created_at), false]];
  if (q.valid_until) meta.push(["Valid until: " + q.valid_until, false]);
  for (const [t, bold] of meta) { d.text(R, ry + 8, t, 9.5, bold, "r", bold ? INK : MUTED); ry += 13; }
  d.y = Math.max(y, ry) + 8; d.line(MARGIN, d.y, R, d.y, 1.2, ACCENT); d.y += 14;
  const left = block(d, MARGIN, 230, "TO", [[q.insurer || q.customer || "", 11, true], [q.insurer_branch, 9.5, false], [q.insurer && q.customer ? "Customer: " + q.customer : "", 9.5, false], [q.phone, 9.5, false]]);
  const right = block(d, 320, 235, "VEHICLE", [[q.registration, 13, true], [q.vehicle, 9.5, false], [q.odometer != null ? "Mileage: " + Number(q.odometer).toLocaleString("en") + " km" : "", 9.5, false], [q.claim_no ? "Claim no: " + q.claim_no : "", 9.5, false], [q.policy_no ? "Policy no: " + q.policy_no : "", 9.5, false]]);
  d.y = Math.max(left, right) + 6;
  if (q.issue) { d.text(MARGIN, d.y + 8, "DAMAGE / WORK DETAILS", 8, true, "l", MUTED); d.y += 14; d.paragraph(MARGIN, q.issue, R - MARGIN, 9.5); d.y += 6; }

  const header = (title: string, parts = false) => {
    d.room(60);
    d.rect(MARGIN, d.y, R - MARGIN, 18, GREY);
    d.text(MARGIN + 6, d.y + 12.5, "#", 8.5, true); d.text(MARGIN + 34, d.y + 12.5, title, 8.5, true);
    if (parts) { d.text(330, d.y + 12.5, "QTY", 8.5, true, "r"); d.text(415, d.y + 12.5, "UNIT PRICE", 8.5, true, "r"); }
    d.text(R - 6, d.y + 12.5, "AMOUNT (LKR)", 8.5, true, "r");
    d.y += 18;
  };
  const row = (n: number, name: string, amount: string, extra?: { qty: string; price: string }) => {
    const lines = wrap(name, 270, 9.5), h = Math.max(20, lines.length * 13 + 8);
    d.room(h);
    d.text(MARGIN + 6, d.y + 14, String(n), 9.5, false, "l", MUTED);
    lines.forEach((part, k) => d.text(MARGIN + 34, d.y + 14 + k * 13, part, 9.5));
    if (extra) { d.text(330, d.y + 14, extra.qty, 9.5, false, "r"); d.text(415, d.y + 14, extra.price, 9.5, false, "r"); }
    d.text(R - 6, d.y + 14, amount, 9.5, false, "r");
    d.y += h; d.line(MARGIN, d.y, R, d.y, 0.6, LINE);
  };
  const sub = (label: string, value: string) => { d.room(20); d.text(430, d.y + 14, label, 9.5, true, "r", MUTED); d.text(R - 6, d.y + 14, value, 9.5, true, "r"); d.y += 24; };

  for (const section of ["Rem/Refit", "Repaint", "Other"] as const) {
    const items = (q.labour || []).filter((l) => (l.section || "Other") === section);
    if (!items.length) continue;
    header(SECTION_TITLE[section]!);
    items.forEach((l, n) => row(n + 1, l.description, money(l.amount)));
    sub("Total " + SECTION_TITLE[section]!.toLowerCase(), money(num(q.sections?.[section])));
  }
  const unpriced = (q.parts || []).filter((p) => !num(p.unit_price)).length;
  if ((q.parts || []).length) {
    header("SPARE PARTS", true);
    (q.parts || []).forEach((p, n) => row(n + 1, p.name, num(p.unit_price) ? money(Math.round(num(p.quantity) * num(p.unit_price) * 100) / 100) : "TBC", { qty: qty(p.quantity), price: num(p.unit_price) ? money(p.unit_price) : "TBC" }));
    sub("Total spare parts", money(q.parts_total));
  }
  d.room(70);
  d.rect(300, d.y + 2, R - 300, 26, ACCENT);
  d.text(310, d.y + 19, unpriced ? "TOTAL (excl. TBC)" : "TOTAL (LKR)", 10, true, "l", [1, 1, 1]);
  d.text(R - 6, d.y + 19, money(q.total), 12, true, "r", [1, 1, 1]);
  d.y += 38;
  if (unpriced) { d.paragraph(MARGIN, unpriced + (unpriced === 1 ? " part is" : " parts are") + " marked TBC (price to be confirmed). They will be quoted in the next version of this estimate.", R - MARGIN, 9, MUTED); d.y += 4; }
  if (q.kind === "QUOTATION") { d.paragraph(MARGIN, "This is a fixed price" + (q.valid_until ? ", valid until " + q.valid_until : "") + ".", R - MARGIN, 9, MUTED); d.y += 4; }
  else { d.paragraph(MARGIN, "This is an estimate. The final amount can change if more work or parts are needed.", R - MARGIN, 9, MUTED); d.y += 4; }
  const earlier = q.history || [];
  if (earlier.length) { d.paragraph(MARGIN, "This version replaces: " + earlier.map((h) => "version " + h.rev_no + " (LKR " + money(h.total) + ")").join(", ") + ".", R - MARGIN, 9, MUTED); d.y += 4; }
  if (b.footer) d.paragraph(MARGIN, b.footer, R - MARGIN, 9, MUTED);
  d.room(50);
  d.y = d.pages.length === 1 && d.y < 842 - MARGIN - 80 ? Math.max(d.y + 24, 842 - MARGIN - 50) : d.y + 24;
  d.line(R - 170, d.y, R, d.y, 0.6, INK);
  d.text(R, d.y + 12, "Authorised signature", 8.5, false, "r", MUTED);
  return d.render();
}

export function quoteFileName(q: Quote) { return clean(q.number + (q.rev_no > 1 ? "-v" + q.rev_no : "")).replace(/[^A-Za-z0-9_-]/g, "") + ".pdf"; }

export function downloadQuotePdf(q: Quote, shop: Business) {
  const url = URL.createObjectURL(quotePdf(q, shop));
  const a = document.createElement("a");
  a.href = url; a.download = quoteFileName(q);
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30000);
}

/** Opens the phone's share sheet with the PDF attached. Returns false when the device cannot share files. */
export async function shareQuotePdf(q: Quote, shop: Business, text: string): Promise<boolean> {
  const file = new File([quotePdf(q, shop)], quoteFileName(q), { type: "application/pdf" });
  const nav = navigator as Navigator & { canShare?: (d: ShareData) => boolean };
  if (!nav.share || !nav.canShare || !nav.canShare({ files: [file] })) return false;
  try { await nav.share({ files: [file], title: q.number, text }); } catch (e) { if ((e as Error).name !== "AbortError") throw e; }
  return true;
}
