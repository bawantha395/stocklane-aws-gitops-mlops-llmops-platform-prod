/** The paper job card, printed by the system and laid out like Ganga Motors' own card: header, in/out times, job no, the vehicle and
 *  customer lines, then lines for the work. Page 2 is the parts sheet. Details are filled in; the mechanic writes the work and signs.
 *  No prices appear, so it can travel with the vehicle. Built in the browser (A4, Helvetica, ASCII only). */
import { Doc, INK, MARGIN, R, W, clean, width, wrap, type RGB } from "./invoicePdf";
import { dateOnly, type Business, type Job } from "./common";
import { getLogo, peekLogo } from "../logoStore";
import { api, type Product } from "../api";

const MUTED: RGB = [0.42, 0.45, 0.44], RULE: RGB = [0.62, 0.66, 0.64], ACCENT: RGB = [0.2, 0.41, 0.31], GREY: RGB = [0.93, 0.94, 0.93];
const TYPE: Record<string, string> = { CASH: "Cash", CREDIT: "Credit", INSURANCE: "Insurance", WARRANTY: "Warranty" };
const hhmm = (iso: string) => new Date(iso).toLocaleTimeString("en-GB", { timeZone: "Asia/Colombo", hour: "2-digit", minute: "2-digit" });

export const jobLink = (id: string) => location.origin + "/?job=" + encodeURIComponent(id);

function header(d: Doc, b: Business, title: string) {
  const logo = peekLogo(), top = d.y;
  let bottom = top;
  if (logo) {
    const lh = 40, lw = Math.min(170, (lh * logo.w) / logo.h), ah = (lw * logo.h) / logo.w;
    d.image((W - lw) / 2, top, lw, ah, atob(logo.data), logo.w, logo.h, logo.c); bottom = top + ah;
    // the business name goes under the logo as well, so the card reads the same as the bill
    const n = clean(b.name || "").toUpperCase();
    if (n) { let sz = 18; while (sz > 10 && width(n, sz, true) > R - MARGIN - 20) sz -= 1; d.text((W + width(n, sz, true)) / 2, bottom + 18, n, sz, true, "r", ACCENT); bottom += 24; }
  } else { const n = clean(b.name || "Workshop").toUpperCase(); d.text((W + width(n, 22, true)) / 2, top + 24, n, 22, true, "r", ACCENT); bottom = top + 30; }
  const t = title; d.text((W + width(t, 15) + 0) / 2, bottom + 20, t, 15, false, "r");
  d.y = bottom + 30;
  // the shop's own details from Setup, centred under the title: address, then mobile and email (same details as the bill)
  const one = (x: unknown) => clean(String(x || "").replace(/\s+/g, " ")).trim();
  const rows = [...wrap(one(b.address), R - MARGIN - 40, 9).slice(0, 2), [b.phone ? "Mobile: " + one(b.phone) : "", b.email ? "Email: " + one(b.email) : ""].filter(Boolean).join("     |     ")].filter(Boolean);
  for (const row of rows) { d.text((W + width(row, 9)) / 2, d.y + 2, row, 9, false, "r", MUTED); d.y += 12; }
  if (rows.length) d.y += 2;
}

export function jobCardPdf(j: Job, shop: Business, partNos: Record<string, string> = {}): Blob {
  const d = new Doc((shop.name || "Workshop") + " | " + (j.job_no || "Job card"));
  header(d, shop, "JOB CARD");
  const dots = (x: number, y: number, w: number, value = "", bold = false) => { d.line(x, y + 1, x + w, y + 1, 0.5, RULE); if (value) d.text(x + 3, y - 2, value, 10, bold); };
  const out = j.out_at;
  const pair = (x: number, y: number, label: string, value: string, w: number) => { d.text(x, y, label, 9.5); d.text(x + 46, y, ":", 9.5); dots(x + 54, y, w, value); };
  pair(MARGIN, d.y + 8, "Date in", dateOnly(j.created_at), 120); pair(R - 190, d.y + 8, "Date Out", out ? dateOnly(out) : "", 120);
  d.y += 22;
  pair(MARGIN, d.y + 8, "Time in", hhmm(j.created_at), 120); pair(R - 190, d.y + 8, "Time Out", out ? hhmm(out) : "", 120);
  d.y += 24;
  // job number box
  const label = "Job No", bx = W / 2 - 62, bw = 150;
  d.text(bx - 6 - width(label, 10), d.y + 16, label, 10);
  d.rect(bx, d.y, bw, 24, GREY); d.line(bx, d.y, bx + bw, d.y, 0.8, RULE); d.line(bx, d.y + 24, bx + bw, d.y + 24, 0.8, RULE); d.line(bx, d.y, bx, d.y + 24, 0.8, RULE); d.line(bx + bw, d.y, bx + bw, d.y + 24, 0.8, RULE);
  d.text(bx + bw / 2 + width(j.job_no || "", 13, true) / 2, d.y + 17, j.job_no || "", 13, true, "r");
  d.y += 40;
  const rows: [string, string][] = [["Vehicle No", j.registration], ["Customer Name", j.customer], ["Address", (j.address || "").replace(/\s+/g, " ")], ["Contact No", j.phone],
    ["Invoice Type", TYPE[j.invoice_type || "CASH"] || ""], ["Estimate No", j.quote_number || ""], ["Mileage", j.odometer != null ? Number(j.odometer).toLocaleString("en") + " km" : ""],
    ["Model", j.vehicle], ["Chassis No", j.chassis || ""]];
  for (const [l, v] of rows) {
    d.text(MARGIN, d.y + 12, l, 10.5); d.text(MARGIN + 100, d.y + 12, ":", 10.5);
    // a long value (usually the address) takes a second ruled line instead of running off the page
    const parts = wrap(clean(v), R - MARGIN - 116, 10, true);
    dots(MARGIN + 110, d.y + 14, R - MARGIN - 110, parts[0] || "", true); d.y += 27;
    if (parts.length > 1) { dots(MARGIN + 110, d.y + 14, R - MARGIN - 110, parts.slice(1).join(" "), true); d.y += 22; }
  }
  d.y += 4; d.line(MARGIN, d.y, R, d.y, 1, INK); d.y += 6;
  // the complaint comes first, written in; the rest of the page is for the work
  const qrTop = 842 - MARGIN - 18 - 70;
  const slots = Math.max(1, Math.floor((qrTop - 10 - d.y) / 26));
  // fit the complaint: 10pt, then 8.5pt; if it is still too long the last line says so (the full text stays on the job page)
  let size = 10, lines = j.summary ? wrap(j.summary, R - MARGIN - 8, size) : [];
  if (lines.length > slots) { size = 8.5; lines = wrap(j.summary, R - MARGIN - 8, size); }
  if (lines.length > slots) { lines = lines.slice(0, slots); const last = lines[slots - 1] || ""; lines[slots - 1] = (last.length > 60 ? last.slice(0, 60) : last) + " ... (more on the job page)"; }
  let k = 0;
  while (d.y + 26 < qrTop - 6 || k < 1) { d.y += 26; if (d.y > qrTop - 4) break; if (lines[k]) d.text(MARGIN + 3, d.y - 4, lines[k]!, size); d.line(MARGIN, d.y, R, d.y, 0.5, RULE); k++; }
  try { d.qr(R - 56, qrTop, 56, jobLink(j.id)); d.text(R - 60 - 4, qrTop + 30, "Scan to open this job", 7.5, false, "r", MUTED); } catch { /* ignore */ }
  d.text(MARGIN, qrTop + 30, j.mechanic ? "Mechanic: " + j.mechanic : "", 8.5, false, "l", MUTED);

  // page 2: parts sheet
  d.pages.push([]); d.y = MARGIN;
  header(d, shop, "PARTS ISSUED");
  d.text(MARGIN, d.y + 2, (j.job_no || "") + "   " + j.registration + (j.customer ? "   " + j.customer : ""), 10, true, "l", MUTED); d.y += 14;
  const cols = [{ x: MARGIN + 4, t: "Date" }, { x: MARGIN + 66, t: "Part No" }, { x: MARGIN + 150, t: "Description" }, { x: MARGIN + 330, t: "Qty" }, { x: MARGIN + 370, t: "Remarks" }, { x: MARGIN + 450, t: "Signature" }];
  d.rect(MARGIN, d.y, R - MARGIN, 20, GREY);
  for (const c of cols) d.text(c.x, d.y + 14, c.t, 9, true);
  const top2 = d.y; d.y += 20;
  // Date = the day the part went on the job (older lines: the day the job opened); Part No = from the stock item
  const given = (j.parts || []).map((p) => ({ name: p.name, qty: String(Number(p.quantity)), date: dateOnly(p.added_at || j.created_at), no: p.part_no || (p.product_id ? partNos[p.product_id] : "") || "" }));
  const rowH = 30, bottom = 842 - MARGIN - 22;
  let n = 0;
  while (d.y + rowH <= bottom) {
    const p = given[n]; n++;
    if (p) { const nm = wrap(p.name, 170, 9)[0] || ""; d.text(cols[0]!.x, d.y + 18, p.date, 8.5); d.text(cols[1]!.x, d.y + 18, wrap(clean(p.no), 78, 8.5)[0] || "", 8.5); d.text(cols[2]!.x, d.y + 18, nm, 9); d.text(cols[3]!.x, d.y + 18, p.qty, 9); }
    d.line(MARGIN, d.y + rowH, R, d.y + rowH, 0.5, RULE); d.y += rowH;
  }
  for (const c of cols.slice(1)) d.line(c.x - 4, top2, c.x - 4, d.y, 0.5, RULE);
  d.line(MARGIN, top2, MARGIN, d.y, 0.5, RULE); d.line(R, top2, R, d.y, 0.5, RULE);
  if (given.length > n) d.text(MARGIN, d.y + 12, "+ " + (given.length - n) + " more parts on the job in the system", 8.5, false, "l", MUTED);
  return d.render();
}

/** Opens the job card so it can be printed (a new tab). The tab opens at once (a click is needed for that) and the card is put in it when the logo is ready.
 *  Falls back to saving the file when the browser blocks the tab. */
export async function printJobCard(j: Job, shop: Business) {
  const tab = window.open("", "_blank");
  try { await getLogo(); } catch { /* the name is printed instead */ }
  // older stock lines were saved without a part number: look them up in the parts list
  const partNos: Record<string, string> = {};
  if ((j.parts || []).some((p) => p.product_id && !p.part_no)) {
    try { for (const p of await api<Product[]>("/api/inventory/products")) partNos[p.id] = (p as Product & { part_number?: string }).part_number || p.sku; } catch { /* leave blank */ }
  }
  const url = URL.createObjectURL(jobCardPdf(j, shop, partNos));
  if (tab) tab.location.href = url;
  else { const a = document.createElement("a"); a.href = url; a.download = (j.job_no || "job-card") + ".pdf"; document.body.appendChild(a); a.click(); a.remove(); }
  setTimeout(() => URL.revokeObjectURL(url), 120000);
}
