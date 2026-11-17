import { useSyncExternalStore } from "react";
import { ApiError } from "./api";
import { getBusinessName } from "./businessName";

/**
 * Practice mode: the real screens, run against dummy data that lives only in this browser tab.
 * While it is on, api() never reaches the server (see api.ts), so nothing real can be read or changed.
 */
type PState = { active: boolean; owner: boolean; mission: string | null; picker: boolean };
let state: PState = { active: false, owner: true, mission: null, picker: true };
const subscribers = new Set<() => void>();
const emit = () => subscribers.forEach((n) => n());
export const usePractice = () => useSyncExternalStore((n) => { subscribers.add(n); return () => { subscribers.delete(n); }; }, () => state);
export const isPractice = () => state.active;
export function startPractice(owner: boolean) { reset(); events.clear(); state = { active: true, owner, mission: null, picker: true }; emit(); }
export function stopPractice() { state = { ...state, active: false, mission: null, picker: true }; reset(); events.clear(); emit(); }
/** Choose a mission (or null to show the mission list again). */
export function setMission(mission: string | null) { state = { ...state, mission, picker: mission === null }; emit(); }
/**
 * What the learner has really done, as named events: "api:job" when the dummy API handled a create-job,
 * "hit:<step>" when they tapped the thing a step pointed at. Steps finish from these, never from a counter,
 * so the help always matches the screen.
 */
export const events = new Set<string>();
export const mark = (name: string) => { if (!events.has(name)) { events.add(name); state = { ...state }; emit(); } };
/** The coach reads these to know what the learner has done. Counters only go up. */
export const probe = { view: "home" as string };

type Row = Record<string, any>;
const db = { logo: null as null | { data: string; w: number; h: number }, settings: {} as Row, edits: {} as Record<string, Row>, owners: {} as Record<string, Row[]>, archived: [] as Row[], log: [] as Row[], requests: [] as Row[], photos: {} as Record<string, { image: string; thumb: string }>, products: [] as Row[], movements: [] as Row[], jobs: [] as Row[], invoices: [] as Row[], seq: 0, created: 0, moved: 0, jobsMade: 0, paid: 0 };
export const progress = () => ({ created: db.created, moved: db.moved, jobs: db.jobsMade, paid: db.paid });
const now = () => new Date().toISOString();
const next = (p: string) => p + String(++db.seq);
const regKey = (s: string) => String(s || "").replace(/[^A-Za-z0-9]/g, "").toUpperCase();
const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

const practiceQuotes: Row[] = [];
function reset() {
  practiceQuotes.length = 0;
  db.settings = {}; db.logo = null; db.edits = {}; db.owners = {}; db.archived = []; db.log = []; db.requests = []; db.photos = {}; db.seq = 0; db.created = 0; db.moved = 0; db.jobsMade = 0; db.paid = 0; db.jobs = []; db.invoices = []; db.movements = [];
  const p = (name: string, brand: string, category: string, qty: number, location: string, part: string, extra: Row = {}) => ({
    id: next("p"), sku: "DEMO-" + String(db.seq).padStart(3, "0"), name, category, brand, grade: "", capacity: "", barcode: null, unit: "UNIT", quantity: qty,
    selling_price: 0, reorder_level: 5, image_id: null, part_number: part, location, archived: false, ...extra,
  });
  db.products = [
    p("Oil filter small", "Demo Parts", "Filters", 8, "B2", "DP-OF-100", { selling_price: 1800 }),
    p("Brake pads front", "Demo Brakes", "Brakes", 14, "C3", "DB-BP-220", { selling_price: 6500 }),
    p("Engine oil 10W-40 4L", "Demo Oil Co", "Engine oil", 6, "A1", "DO-1040-4", { grade: "10W-40", capacity: "4 L", selling_price: 4200 }),
  ];
}
reset();

/** A drawn oil bottle, so the camera step needs no real camera or real part. */
let sampleBlob: Blob | null = null;
export async function samplePhoto(): Promise<File> {
  if (!sampleBlob) {
    const c = document.createElement("canvas"); c.width = 360; c.height = 460;
    const g = c.getContext("2d")!;
    g.fillStyle = "#eef1f6"; g.fillRect(0, 0, 360, 460);
    g.fillStyle = "#1f3f9a"; g.beginPath(); g.roundRect(105, 80, 150, 340, 26); g.fill();
    g.fillStyle = "#111827"; g.fillRect(150, 38, 60, 48);
    g.fillStyle = "#ffffff"; g.beginPath(); g.roundRect(120, 190, 120, 170, 10); g.fill();
    g.fillStyle = "#1f3f9a"; g.font = "bold 17px sans-serif"; g.textAlign = "center";
    g.fillText("DEMO OIL CO", 180, 222); g.font = "bold 26px sans-serif"; g.fillText("5W-30", 180, 262);
    g.font = "14px sans-serif"; g.fillText("MOTOR OIL", 180, 292); g.fillText("1 L", 180, 322);
    g.fillStyle = "#6b7886"; g.font = "11px sans-serif"; g.fillText("P/N DMO-5W30-1L", 180, 346);
    sampleBlob = await new Promise<Blob>((done) => c.toBlob((b) => done(b as Blob), "image/jpeg", 0.9));
  }
  return new File([sampleBlob], "sample-oil.jpg", { type: "image/jpeg" });
}
export const samplePhotoBlob = () => sampleBlob;

/** Drawn vehicle photos for practice: a number plate, a car front, a scratched door. */
export async function demoShot(kind: "plate" | "front" | "damage"): Promise<File> {
  const c = document.createElement("canvas"); c.width = 480; c.height = 320;
  const g = c.getContext("2d")!;
  g.fillStyle = "#dfe5ee"; g.fillRect(0, 0, 480, 320);
  if (kind === "plate") {
    g.fillStyle = "#4b5563"; g.fillRect(0, 230, 480, 90);
    g.fillStyle = "#fff"; g.beginPath(); g.roundRect(90, 100, 300, 110, 14); g.fill();
    g.strokeStyle = "#111827"; g.lineWidth = 4; g.stroke();
    g.fillStyle = "#111827"; g.font = "bold 62px sans-serif"; g.textAlign = "center"; g.fillText("CAB-1234", 240, 178);
  } else {
    g.fillStyle = "#4b5563"; g.fillRect(0, 250, 480, 70);
    g.fillStyle = "#1f3f9a"; g.beginPath(); g.roundRect(70, 120, 340, 120, 28); g.fill();
    g.fillStyle = "#9db4e6"; g.beginPath(); g.roundRect(120, 70, 240, 70, 22); g.fill();
    g.fillStyle = "#fff"; g.beginPath(); g.arc(130, 190, 20, 0, 7); g.arc(350, 190, 20, 0, 7); g.fill();
    g.fillStyle = "#111827"; g.beginPath(); g.arc(100, 245, 26, 0, 7); g.arc(380, 245, 26, 0, 7); g.fill();
    if (kind === "damage") { g.strokeStyle = "#e11d48"; g.lineWidth = 5; g.beginPath(); g.moveTo(210, 150); g.lineTo(290, 215); g.stroke(); }
  }
  const blob = await new Promise<Blob>((done) => c.toBlob((b) => done(b as Blob), "image/jpeg", 0.85));
  return new File([blob], kind + ".jpg", { type: "image/jpeg" });
}

/** Width and height from a base64 JPEG's frame header. */
function jpegSize(b64: string) {
  const s = atob(b64 || "");
  for (let i = 2; i + 9 < s.length;) {
    if (s.charCodeAt(i) !== 255) { i++; continue; }
    const m = s.charCodeAt(i + 1);
    if (m === 0xd8 || m === 0x01 || (m >= 0xd0 && m <= 0xd7)) { i += 2; continue; }
    if (m >= 0xc0 && m <= 0xc2) return { h: s.charCodeAt(i + 5) * 256 + s.charCodeAt(i + 6), w: s.charCodeAt(i + 7) * 256 + s.charCodeAt(i + 8) };
    i += 2 + s.charCodeAt(i + 2) * 256 + s.charCodeAt(i + 3);
  }
  throw new ApiError("The logo is not a valid JPEG", 400);
}
const clone = <T,>(v: T): T => JSON.parse(JSON.stringify(v));

function business() {
  return { name: getBusinessName(), address: "12 Demo Road", phone: "011 000 0000", email: "", reg_no: "", bank: "", footer: "", tax_name: "VAT", tax_rate: 0, mechanic_discount_pct: 10, payment_terms_days: 0, qr_url: "", warranty: "", invoice_prefix: "INV", default_reorder_level: 5, labour_items: [], mechanics: [], logo: db.logo ? { v: "demo", w: db.logo.w, h: db.logo.h, c: 3 } : null, ...db.settings };
}
function priced(j: Row) {
  j.parts_total = round2(j.parts.reduce((s: number, p: Row) => s + round2((Number(p.quantity) * Number(p.unit_price) * (100 - Number(p.discount_pct || 0))) / 100), 0));
  j.labour_total = round2(j.labour.reduce((s: number, l: Row) => s + Number(l.amount), 0));
  j.subtotal = round2(Math.max(0, j.parts_total + j.labour_total - Number(j.discount || 0)));
  j.tax = round2(j.subtotal * (Number(j.tax_rate || 0) / 100));
  j.total = round2(j.subtotal + j.tax);
  j.lines = j.parts.length + j.labour.length;
  return j;
}
const rows = (list: Row[]) => list.map((j) => ({ ...j }));

/** A one-page sample PDF, so the PDF buttons work in practice. */
function samplePdf(title: string) {
  const text = "BT /F1 18 Tf 24 70 Td (" + title.replace(/[()\\]/g, "") + ") Tj 0 -26 Td /F1 11 Tf (Practice sample. Nothing here is real.) Tj ET";
  const pdf = "%PDF-1.1\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj\n"
    + "3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 360 140]/Contents 4 0 R/Resources<</Font<</F1 5 0 R>>>>>>endobj\n"
    + "4 0 obj<</Length " + text.length + ">>stream\n" + text + "\nendstream endobj\n5 0 obj<</Type/Font/Subtype/Type1/BaseFont/Helvetica>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF";
  return { filename: "practice-sample.pdf", pdf: btoa(pdf) };
}
const logIt = (action: string, j: Row, reason = "") => db.log.unshift({ sk: String(Date.now()) + next("l"), action, job_id: j.id, registration: j.registration, customer: j.customer, actor: "Practice", reason });
const vehicleView = (key: string) => {
  const mine = db.jobs.filter((x) => x.vehicle_key === key);
  if (!mine.length && !db.edits[key]) return null;
  const j = mine[0] || {};
  // like the real vehicle file: owner, phone and model come from the first job that had them; a later job never replaces them
  const first = (f: string) => [...mine].reverse().map((x) => x[f]).find(Boolean);
  const invoiced = mine.filter((x) => x.status === "INVOICED");
  return { id: key, registration: j.registration, owner: first("customer"), phone: first("phone"), make: first("vehicle"), updated_at: now(), visits: invoiced.length, spent: invoiced.reduce((t, x) => t + x.total, 0),
    first_visit: invoiced.length ? invoiced[invoiced.length - 1].created_at.slice(0, 10) : null, average_gap_days: null, front_photo: mine.find((x) => x.front_photo)?.front_photo, plate_photo: mine.find((x) => x.plate_photo)?.plate_photo,
    history: mine.map((x) => ({ id: x.id, created_at: x.created_at, summary: x.summary, status: x.status, odometer: x.odometer, total: x.total, invoice_number: x.invoice_number, invoice_id: x.invoice_id,
      parts: x.parts.map((q: Row) => ({ name: q.name, quantity: q.quantity, unit_price: q.unit_price })), labour: x.labour.map((q: Row) => ({ description: q.description, amount: q.amount })), mechanic: x.mechanic, customer: x.customer })), owner_log: db.owners[key] || [], ...db.edits[key] };
};
function reportFor(from: string, until: string) {
  const inRange = db.invoices.filter((i) => i.status !== "VOID" && i.created_at.slice(0, 10) >= from && i.created_at.slice(0, 10) <= until);
  const sum = (f: (i: Row) => number) => round2(inRange.reduce((t, i) => t + f(i), 0));
  const tally = (pick: (i: Row) => Row[], key: string, qty: (r: Row) => number, amt: (r: Row) => number) => {
    const m = new Map<string, { name: string; n: number; amount: number }>();
    inRange.forEach((i) => pick(i).forEach((r) => { const e = m.get(r[key]) || { name: r[key], n: 0, amount: 0 }; e.n += qty(r); e.amount = round2(e.amount + amt(r)); m.set(r[key], e); }));
    return [...m.values()].sort((a, b) => b.amount - a.amount);
  };
  const owing = db.invoices.filter((i) => i.status === "UNPAID" || i.status === "PARTIAL");
  const byDay = new Map<string, number>();
  inRange.forEach((i) => byDay.set(i.created_at.slice(0, 10), round2((byDay.get(i.created_at.slice(0, 10)) || 0) + i.total)));
  const mech = new Map<string, { mechanic: string; jobs: number; total: number }>();
  inRange.forEach((i) => { const k = i.mechanic || "Not set"; const e = mech.get(k) || { mechanic: k, jobs: 0, total: 0 }; e.jobs++; e.total = round2(e.total + i.total); mech.set(k, e); });
  const meth = new Map<string, number>();
  inRange.forEach((i) => i.payments.forEach((q: Row) => meth.set(q.method, round2((meth.get(q.method) || 0) + q.amount))));
  return { from, until, invoices: inRange.length, vehicles: new Set(inRange.map((i) => i.registration)).size, parts_total: sum((i) => i.parts_total), labour_total: sum((i) => i.labour_total), discount: sum((i) => i.discount || 0),
    tax: sum((i) => i.tax), total: sum((i) => i.total), received: sum((i) => i.paid), unpaid: sum((i) => i.total - i.paid), average: inRange.length ? round2(sum((i) => i.total) / inRange.length) : 0,
    outstanding_all_time: round2(owing.reduce((t, i) => t + i.total - i.paid, 0)), ageing: { d0_7: round2(owing.reduce((t, i) => t + i.total - i.paid, 0)), d8_30: 0, d31_60: 0, d60_plus: 0 },
    by_day: [...byDay].map(([date, billed]) => ({ date, billed })), by_mechanic: [...mech.values()], by_method: [...meth].map(([method, amount]) => ({ method, amount })),
    top_parts: tally((i) => i.parts, "name", (r) => Number(r.quantity), (r) => Number(r.quantity) * Number(r.unit_price)).map((e) => ({ name: e.name, quantity: e.n, amount: e.amount })),
    top_labour: tally((i) => i.labour, "description", () => 1, (r) => Number(r.amount)).map((e) => ({ name: e.name, times: e.n, amount: e.amount })),
    unpaid_list: owing.map((i) => ({ id: i.id, invoice_number: i.invoice_number, registration: i.registration, customer: i.customer, days: 0, balance: round2(i.total - i.paid) })) };
}

async function route(path: string, options: RequestInit = {}): Promise<any> {
  await new Promise((r) => setTimeout(r, 220));
  const method = (options.method || "GET").toUpperCase();
  const url = new URL(path, "http://demo");
  const p = url.pathname;
  let body: Row = {};
  if (typeof options.body === "string") { try { body = JSON.parse(options.body); } catch { body = {}; } }
  const seg = p.split("/").filter(Boolean); // api, area, ...
  const area = seg[1], a = seg[2], b = seg[3];

  if (area === "workshop" && a === "quotes") {
    const money = (n: unknown) => Math.round(Number(n || 0) * 100) / 100;
    const view = (q: Row): Row => { const sec: Row = { "Rem/Refit": 0, Repaint: 0, Other: 0 }; for (const l of q.labour) sec[l.section || "Other"] = money(sec[l.section || "Other"] + money(l.amount)); const parts = q.parts.reduce((x: number, p: Row) => x + money(p.quantity * p.unit_price), 0), total = money(parts + sec["Rem/Refit"] + sec.Repaint + sec.Other); return { ...q, parts_total: money(parts), labour_total: money(total - parts), sections: sec, total, parts_unpriced: q.parts.filter((p: Row) => !Number(p.unit_price)).length }; };
    const fill = (q: Row) => { for (const k of ["registration", "insurer", "insurer_branch", "claim_no", "policy_no", "customer", "phone", "vehicle", "issue", "valid_until"]) if (k in body) q[k] = body[k]; if ("odometer" in body) q.odometer = body.odometer === "" || body.odometer == null ? null : Number(body.odometer); if (q.registration) { q.registration = String(q.registration).toUpperCase(); q.vehicle_key = String(q.registration).replace(/[^A-Z0-9]/g, ""); } if ("photos" in body) q.photos = body.photos; if ("parts" in body) q.parts = body.parts; if ("labour" in body) q.labour = body.labour; return q; };
    if (!b) {
      if (method === "GET") return practiceQuotes.map((q) => { const v = view(q); return { ...v, lines: v.parts.length + v.labour.length, rev_count: q.rev_no, photo_count: (q.photos || []).length }; });
      const id = next("q"), n = practiceQuotes.length + 1;
      const q: Row = fill({ id, kind: body.kind === "QUOTATION" ? "QUOTATION" : "ESTIMATE", number: (body.kind === "QUOTATION" ? "QUO-PRACTICE-" : "EST-PRACTICE-") + String(n).padStart(4, "0"), status: "DRAFT", revision: 0, rev_no: 1, history: [], parts: [], labour: [], photos: [], created_at: now(), updated_at: now() });
      practiceQuotes.unshift(q); return clone(view(q));
    }
    const q = practiceQuotes.find((x) => x.id === b); if (!q) throw new ApiError("Estimate not found", 404);
    if (method === "GET") return clone(view(q));
    if (method === "DELETE") { practiceQuotes.splice(practiceQuotes.indexOf(q), 1); return { deleted: b }; }
    if (method === "PATCH") { fill(q); q.revision++; q.updated_at = now(); return clone(view(q)); }
    const act = seg[4];
    if (act === "revise") { q.history.push({ rev_no: q.rev_no, at: now(), status: q.status, total: view(q).total, parts: q.parts, labour: q.labour }); q.rev_no++; q.status = "DRAFT"; q.revision++; return clone(view(q)); }
    if (act === "status") { q.status = body.status; q.revision++; return clone(view(q)); }
    if (act === "convert") { q.status = "CONVERTED"; q.revision++; return { job_id: "practice-none", quote: clone(view(q)) }; }
  }
  if (area === "inventory") {
    if (a === "session") return { name: "Practice", roles: [state.owner ? "ROLE_OWNER" : "ROLE_MECHANIC"] };
    if (a === "price-review") {
      if (method !== "GET") throw new ApiError("Practice mode does not change prices. In your real workshop they are saved and logged.", 400);
      return { below: 1, items: [{ id: "p1", sku: "OF-1", name: "Oil filter (sample)", part_number: "PN-1", unit: "UNIT", quantity: 4, last_cost: 1400, selling_price: 1500, suggested_price: 1820, markup_used: 30, margin_pct: 6.7, below: true }] };
    }
    if (a === "products" && b && seg[4] === "price-history") return [];
    if (a === "products" && b && seg[4] === "price") throw new ApiError("Practice mode does not change prices. In your real workshop they are saved and logged.", 400);
    if (a === "payables" && method === "GET") return { total: 18500, overdue: 6000, suppliers: [{ id: "s1", name: "Lanka Spares (sample)", balance: 18500, overdue: 6000, oldest_overdue_days: 12, bills: 2 }] };
    if (a === "suppliers" && b && seg[4] === "payables") {
      if (method !== "GET") throw new ApiError("Practice mode does not save payments. In your real workshop they are saved and settle the oldest bill first.", 400);
      return { supplier: { id: b, name: "Lanka Spares (sample)", credit_days: 30 }, balance: 18500, open: 18500, overdue: 6000, oldest_overdue_days: 12, incomplete: 0,
        bills: [{ id: "b2", doc_no: "GRN-SAMPLE-2", created_at: now(), reference: "DN-2", amount: 12500, open: 12500, due: "2030-01-31", overdue_days: 0, unknown: 0 }, { id: "b1", doc_no: "GRN-SAMPLE-1", created_at: "2020-01-01T00:00:00Z", reference: "DN-1", amount: 6000, open: 6000, due: "2020-01-31", overdue_days: 12, unknown: 0 }], returns: [], payments: [] };
    }
    if (a === "to-order" && method === "GET") return { open: 2, items: [
      { key: "low:s1", want_id: null, product_id: "p1", name: "Oil filter (sample)", part_no: "PN-1", unit: "UNIT", quantity: 6, stock: 1, reorder_level: 3, supplier_id: "s1", supplier: "Lanka Spares (sample)", source: "LOW", status: "OPEN" },
      { key: "want:w1", want_id: "w1", product_id: null, name: "Wiper blade (sample)", part_no: "", unit: "UNIT", quantity: 2, supplier_id: null, supplier: "", source: "JOB", job_no: "JOB-1", registration: "CAB-1234", status: "OPEN" }] };
    if (a === "orders" && method === "GET") return [];
    if (a === "orders" && method === "POST" && !b) return { id: "o-practice", order_no: "PO-PRACTICE", supplier_id: body.supplierId, supplier: "Lanka Spares (sample)", status: "SENT", created_at: now(), lines: [], contact: { phone: "0112345678", whatsapp: "" },
      message: "Hello Lanka Spares (sample),\nOrder PO-PRACTICE from your workshop:\n\n1. PN-1 Oil filter x 6\n\nPlease confirm what you have and the price. Thank you." };
    if ((a === "wants" || a === "supplier-returns" || a === "orders") && method !== "GET") throw new ApiError("Practice mode does not save this. In your real workshop it is saved and shown in the lists.", 400);
    if (a === "suppliers") {
      const sample = [{ id: "s1", name: "Lanka Spares (sample)", kind: "MAIN", phone: "0112345678", whatsapp: "", credit_days: 30, active: true, parts: 2, updated_at: now() }, { id: "s2", name: "Kade Mudalali (sample)", kind: "LOCAL", phone: "0715556666", whatsapp: "", credit_days: 0, active: true, parts: 0, updated_at: now() }];
      if (method !== "GET") throw new ApiError("Practice mode does not save suppliers. In your real workshop they are saved and shown in every pick list.", 400);
      if (!b) { const term = (url.searchParams.get("search") || "").toLowerCase(), kind = url.searchParams.get("kind") || ""; return clone(sample.filter((x) => (!term || x.name.toLowerCase().includes(term)) && (!kind || x.kind === kind))); }
      const x = sample.find((y) => y.id === b); if (!x) throw new ApiError("Supplier not found", 404);
      return clone({ ...x, address: "", notes: "", revision: 0, deliveries: [], delivery_count: 0, parts: [], last_delivery: null, bought: 0 });
    }
    if (a === "products" && b === "archived") return clone(db.products.filter((x) => x.archived));
    if (a === "products" && b && seg[4] === "archive" && method === "POST") {
      const item = db.products.find((x) => x.id === b); if (!item) throw new ApiError("Not found", 404);
      if (body.archived && Number(item.quantity) !== 0) throw new ApiError("Stock must be zero before an item is archived.", 409);
      item.archived = !!body.archived; return clone(item);
    }
    if (a === "products" && !b) {
      if (method === "GET") return clone(db.products.filter((x) => !x.archived));
      const id = next("p"); db.created++;
      const item = { id, sku: body.sku || "DEMO-" + id.toUpperCase(), name: body.name, category: body.category, brand: body.brand, grade: body.grade || "", capacity: body.capacity || "", barcode: null,
        unit: body.unit || "UNIT", quantity: Number(body.openingQuantity || 0), selling_price: 0, reorder_level: Number(body.reorderLevel ?? 5), image_id: body.imageId || null,
        part_number: body.partNumber || "", location: body.location || "", supplier: body.supplier || "", archived: false };
      db.products.unshift(item); return clone(item);
    }
    if (a === "products" && b) {
      const item = db.products.find((x) => x.id === b); if (!item) throw new ApiError("Not found", 404);
      if (method === "PATCH") Object.assign(item, { name: body.name, brand: body.brand, category: body.category, grade: body.grade, capacity: body.capacity, part_number: body.partNumber, location: body.location, ...(body.supplier !== undefined ? { supplier: body.supplier } : {}), reorder_level: body.reorderLevel });
      return clone(item);
    }
    if (a === "documents" && method === "POST") {
      const lines = (body.lines || []) as any[]; if (!lines.length) throw new ApiError("Add at least one part", 400);
      if (lines.length > 15) throw new ApiError("One note holds up to 15 parts. Save this one, then start the next", 400);
      const out: any[] = [], docNo = (body.kind === "STOCK_OUT" ? "GIN-P" : "GRN-P") + String(++db.moved).padStart(4, "0");
      for (const l of lines) {
        const it = db.products.find((x) => x.id === l.productId); if (!it) throw new ApiError("Part not found", 404);
        const q = Number(l.quantity), isOut = body.kind === "STOCK_OUT"; if (isOut && q > Number(it.quantity)) throw new ApiError("Only " + it.quantity + " of " + it.name + " in stock", 409);
        it.quantity = round2(Number(it.quantity) + (isOut ? -q : q)); if (l.location) it.location = l.location;
        const m = { id: next("m"), product_id: it.id, sku: it.sku, name: it.name, unit: it.unit, kind: isOut ? "STOCK_OUT" : "RECEIPT", quantity: q, unit_price: 0, balance: it.quantity, job_id: null, issue_id: null, actor: "Practice", note: body.note || "", doc_no: docNo, created_at: now() } as any;
        db.movements.unshift(m); out.push({ id: m.id, product_id: it.id, name: it.name, quantity: q, balance: it.quantity });
      }
      return { doc_no: docNo, kind: body.kind || "RECEIPT", id: out[0].id, lines: out };
    }
    if (a === "movements") {
      if (method === "GET" && seg[4] === "note.pdf") return samplePdf("Stock note");
      if (method === "GET") return clone(db.movements);
      if (method === "POST" && seg[4] === "cost") {
        const mv = db.movements.find((x: any) => x.id === seg[3]); if (!mv || mv.kind !== "RECEIPT") throw new ApiError("Goods received entry not found", 404);
        const c = Number(body.unitCost); if (!Number.isFinite(c) || c < 0) throw new ApiError("Cost price must be zero or more, with at most 2 decimals", 400);
        mv.unit_cost = c; const pr = db.products.find((x) => x.id === mv.product_id); if (pr) { if (pr.last_cost != null && pr.last_cost !== c) pr.prev_cost = pr.last_cost; pr.last_cost = c; }
        return { id: mv.id, unit_cost: c };
      }
      const item = db.products.find((x) => x.id === body.productId); if (!item) throw new ApiError("Part not found", 404);
      const q = Number(body.quantity);
      if (body.kind === "COUNT") {
        const before = Number(item.quantity); if (q === before) throw new ApiError("The count already matches the recorded stock", 400);
        item.quantity = q; const cm = { id: next("m"), product_id: item.id, sku: item.sku, name: item.name, unit: item.unit, kind: q > before ? "COUNT_IN" : "COUNT_OUT", quantity: Math.abs(q - before), unit_price: 0, balance: q, job_id: null, issue_id: null, actor: "practice@example.com", note: "Count correction", created_at: new Date().toISOString() };
        db.movements.unshift(cm); db.moved++; return clone(cm);
      }
      if (body.kind === "STOCK_OUT" && q > Number(item.quantity)) throw new ApiError("Only " + item.quantity + " in stock.", 409);
      item.quantity = round2(Number(item.quantity) + (body.kind === "STOCK_OUT" ? -q : q));
      const m = { id: next("m"), product_id: item.id, sku: item.sku, name: item.name, unit: item.unit, kind: body.kind, quantity: q, unit_price: 0, balance: item.quantity, job_id: null, issue_id: null, actor: "Practice", note: body.note || "", created_at: now(), ...(body.kind === "RECEIPT" || body.kind === "STOCK_OUT" ? { doc_no: (body.kind === "RECEIPT" ? "GRN-" : "GIN-") + now().slice(0, 10).replace(/-/g, "") + "-P" + String(db.moved + 1).padStart(3, "0") } : {}), ...(body.kind === "RECEIPT" ? { supplier: body.supplier || undefined, reference: body.reference || undefined, ...(body.unitCost ? { unit_cost: Number(body.unitCost) } : {}) } : {}) };
      if (body.kind === "RECEIPT" && (body.supplier || body.supplierId) && !item.supplier) item.supplier = body.supplier || (body.supplierId === "s1" ? "Lanka Spares (sample)" : "Kade Mudalali (sample)");
      if (body.kind === "RECEIPT" && body.unitCost) { const c = Number(body.unitCost); if (item.last_cost != null && item.last_cost !== c) item.prev_cost = item.last_cost; item.last_cost = c; }
      db.movements.unshift(m); db.moved++; return clone(m);
    }
  }
  if (area === "vision") {
    if (a === "status") return { modelReady: false, bedrockConfigured: true };
    if (a === "qr") return { value: null };
    if (a === "match") return { imageId: "demo-photo", candidates: [], state: "NO_MATCH", modelVersion: "practice", message: "" };
    if (a === "drafts" && method === "POST") {
      return { id: next("dr"), image_id: "demo-photo", fields: {}, source: "gemini", status: "PENDING", created_at: now(), product_id: null,
        suggestions: { name: "Demo Motor Oil 5W-30 1L", brand: "Demo Oil Co", partNumber: "DMO-5W30-1L", category: "Engine oil", grade: "5W-30", capacity: "1 L", unit: "piece" },
        labelSuggestions: {}, ai: { status: "used", provider: "gemini", model: "gemini-3.8-flash-lite" } };
    }
    if (a === "drafts") return { status: "APPROVED" };
    if (a === "references") return {};
    if (a === "barcodes") return { barcode: decodeURIComponent(b || ""), found: false, suggestions: {} };
    if (a === "drafts") return [];
  }
  if (area === "forecast") return { products: [] };
  if (area === "workshop") {
    if (a === "photos") {
      if (method === "POST") { const id = Array.from({ length: 32 }, () => "0123456789abcdef"[Math.floor(Math.random() * 16)]).join(""); db.photos[id] = { image: body.image, thumb: body.thumb }; return { id }; }
      const shot = b && db.photos[b]; if (!shot) throw new ApiError("Photo not found", 404);
      return { data: url.searchParams.get("size") === "full" ? shot.image : shot.thumb };
    }
    if (a === "logo") {
      if (method === "PUT") { const { w, h } = jpegSize(body.image); db.logo = { data: body.image, w, h }; return { logo: { v: "demo", w, h, c: 3 } }; }
      if (method === "DELETE") { db.logo = null; return { logo: null }; }
      if (!db.logo) throw new ApiError("No logo", 404);
      return { data: db.logo.data, v: "demo", w: db.logo.w, h: db.logo.h, c: 3 };
    }
    if (a === "settings") {
      if (method === "PUT") {
        const prefix = String(body.invoice_prefix || "INV").trim().toUpperCase();
        if (!/^[A-Z0-9]{1,6}$/.test(prefix)) throw new ApiError("The bill number prefix is 1 to 6 letters or numbers (no spaces)", 400);
        const { logo: _logo, ...rest } = body; void _logo;
        db.settings = { ...db.settings, ...rest, invoice_prefix: prefix };
      }
      return business();
    }
    if (a === "report.pdf" || (a === "invoices" && seg[4] === "pdf") || (a === "vehicles" && seg[4] === "history.pdf")) return samplePdf(a === "report.pdf" ? "Workshop report" : a === "invoices" ? "Invoice" : "Vehicle history");
    if (a === "report") return reportFor(url.searchParams.get("from") || "0000-01-01", url.searchParams.get("until") || "9999-12-31");
    if (a === "archive") return clone({ jobs: db.archived, log: db.log });
    if (a === "suggestions") return { parts: [{ name: "Demo Motor Oil 5W-30 1L", price: 1500, uses: 3 }, { name: "Oil filter small", price: 900, uses: 2 }], labour: [{ description: "Oil change", amount: 1500, uses: 3 }] };
    if (a === "cockpit") return { today: { received: 0, profit: 0, profit_unknown: 0 }, month: { profit: 0, profit_unknown: 0 }, owing: 0, owing_count: 0, overdue_count: 0, to_order: 0, approvals: 0, messages: 0, alerts: 0 };
    if (a === "alerts") return { alerts: [], unseen: 0, types: [] };
    if (a === "slow-stock") return { days: 90, items: [], count: 0, value: 0, unknown_cost: 0, categories: [] };
    if (a === "service-due") return [];
    if (a === "messages") return seg[3] === "templates" ? { templates: {}, defaults: {}, variables: ["name", "shop"], custom: {} } : seg[3] === "history" ? [] : seg[3] === "count" ? { count: 0 } : seg[3] === "log" ? { logged: 1 } : { rows: [], count: 0, counts: {} };
    if (a === "dashboard") {
      const open = db.jobs.filter((j) => j.status === "OPEN");
      const owing = db.invoices.filter((i) => i.status === "UNPAID" || i.status === "PARTIAL");
      const d = now().slice(0, 10);
      const sum = (f: (i: Row) => number) => db.invoices.reduce((s, i) => s + f(i), 0);
      return clone({ today: { date: d, invoices: db.invoices.length, billed: sum((i) => i.total), received: sum((i) => i.paid) }, month: { from: d.slice(0, 8) + "01", invoices: db.invoices.length, billed: sum((i) => i.total), received: sum((i) => i.paid) },
        open_jobs: rows(open), open_count: open.length, ready_jobs: rows(open.filter((j) => j.stage === "READY")), ready_count: open.filter((j) => j.stage === "READY").length, unpaid_count: owing.length, unpaid_total: owing.reduce((s, i) => s + i.total - i.paid, 0), oldest_unpaid_days: 0, due_count: 0, delete_requests: db.requests.filter((r) => r.status === "PENDING") });
    }
    if (a === "customers") {
      const canon = (x: string) => x.replace(/\D/g, "").replace(/^94(?=\d{9}$)/, "0");
      const people = (): Row[] => {
        const m = new Map<string, Row>();
        for (const j of db.jobs) {
          const k = canon(String(j.phone || "")); if (k.length < 9) continue;
          const c = m.get(k) || { id: "c" + k, name: j.customer, phone: k, phone2: "", kind: "WALKIN", active: true, birthday: "", address: "", notes: "", names: [], aliases: [], revision: 0, vehicles: 0, regs: [] as string[], jobs: 0, owing: 0, spent: 0, bills: 0, updated_at: j.updated_at || now() };
          if (!c.regs.includes(j.registration)) { c.regs.push(j.registration); c.vehicles = c.regs.length; }
          c.jobs++; m.set(k, c);
        }
        for (const i of db.invoices) { const c = m.get(canon(String(i.phone || ""))); if (!c || i.status === "VOID") continue; c.bills++; c.spent += i.total; if (i.status === "UNPAID" || i.status === "PARTIAL") c.owing += i.total - i.paid; }
        return [...m.values()];
      };
      if (b === "lookup") { const d = (url.searchParams.get("search") || "").replace(/\D/g, ""); return d.length < 4 ? [] : clone(people().filter((c) => c.phone.includes(d)).slice(0, 6).map((c) => ({ id: c.id, name: c.name, phone: c.phone, address: "", kind: c.kind, vehicles: c.regs.map((r: string) => ({ registration: r, make: "", last_km: null })) }))); }
      if (method === "POST" && !b) throw new ApiError("Practice mode does not save customers. In your real workshop a job with a phone number makes the customer by itself.", 400);
      if (!b) { const term = (url.searchParams.get("search") || "").toLowerCase(), digits = term.replace(/\D/g, ""); return clone(people().filter((c) => !term || c.name.toLowerCase().includes(term) || (digits.length >= 3 && c.phone.includes(digits)) || c.regs.some((r: string) => r.toLowerCase().replace(/\W/g, "").includes(term.replace(/\W/g, ""))))); }
      if (method !== "GET") throw new ApiError("Practice mode does not save customers.", 400);
      if (seg[4] === "statement.pdf") return samplePdf("Statement");
      const c = people().find((x) => x.id === b); if (!c) throw new ApiError("Customer not found", 404);
      const mine = db.jobs.filter((j) => canon(String(j.phone || "")) === c.phone);
      return clone({ ...c, vehicle_list: c.regs.map((r: string) => ({ registration: r, make: "", last_km: null, owner: c.name })), timeline: mine.map((j) => { const inv = db.invoices.find((i) => i.job_id === j.id); return { id: j.id, job_no: j.job_no, registration: j.registration, created_at: j.created_at, status: j.status, stage: j.stage, summary: j.summary, name: j.customer, ...(inv ? { total: inv.total, paid: inv.paid, balance: inv.total - inv.paid, pay_status: inv.status, invoice_id: inv.id, invoice_number: inv.invoice_number } : {}) }; }) });
    }
    if (a === "vehicles") {
      if (b) {
        const v = vehicleView(b); if (!v) throw new ApiError("Vehicle not found", 404);
        if (method === "PATCH") { db.edits[b] = { ...db.edits[b], ...(body.owner !== undefined ? { owner: body.owner } : {}), ...(body.make !== undefined ? { make: body.make } : {}), ...(body.phone !== undefined ? { phone: body.phone } : {}), ...(body.notes !== undefined ? { notes: body.notes } : {}) };
          for (const oj of db.jobs.filter((x) => x.vehicle_key === b && x.status === "OPEN")) Object.assign(oj, body.owner !== undefined ? { customer: body.owner } : {}, body.phone !== undefined ? { phone: body.phone } : {}, body.make !== undefined ? { vehicle: body.make } : {});
          return { saved: true }; }
        if (method === "POST" && seg[4] === "owner") {
          const owner = String(body.owner || "").trim(), ph = String(body.phone || "").trim();
          if (!owner) throw new ApiError("New owner is required", 400);
          if (owner === v.owner && ph === (v.phone || "")) throw new ApiError("That is already the owner on file. Use Edit details to correct a name or number.", 400);
          (db.owners[b] = db.owners[b] || []).push({ at: now(), from_owner: v.owner, from_phone: v.phone, to_owner: owner, to_phone: ph });
          db.edits[b] = { ...db.edits[b], owner, phone: ph };
          for (const oj of db.jobs.filter((x) => x.vehicle_key === b && x.status === "OPEN")) Object.assign(oj, { customer: owner, phone: ph });
          return { saved: true };
        }
        return clone(v);
      }
      const term = (url.searchParams.get("search") || "").toLowerCase();
      const keys = [...new Set(db.jobs.map((j) => j.vehicle_key))];
      return clone(keys.map((k) => vehicleView(k)).filter((v): v is NonNullable<ReturnType<typeof vehicleView>> => !!v && (v.registration + v.owner).toLowerCase().includes(term)).map(({ history, ...v }) => v));
    }
    if (a === "jobs") {
      // stock parts: a line with product_id moves stock with it (same rules as the server)
      const moveStock = (pid: string, qty: number, kind: "ISSUE" | "RETURN", j: Row, price: number) => {
        const item = db.products.find((x) => x.id === pid); if (!item) throw new ApiError("Product not found", 404);
        if (kind === "ISSUE" && Number(item.quantity) < qty) throw new ApiError("Only " + item.quantity + " of " + item.name + " in stock", 409);
        item.quantity = round2(Number(item.quantity) + (kind === "ISSUE" ? -qty : qty));
        db.movements.unshift({ id: next("m"), product_id: item.id, sku: item.sku, name: item.name, unit: item.unit, kind, quantity: qty, unit_price: price, balance: item.quantity, job_id: j.id, issue_id: null, actor: "Practice", note: (kind === "ISSUE" ? "Used on " : "Taken back from ") + j.registration, created_at: now() });
        db.moved++; return Number(item.quantity);
      };
      const release = (j: Row) => { for (const l of (j.parts || []) as Row[]) if (l.product_id) { moveStock(l.product_id, Number(l.quantity), "RETURN", j, Number(l.unit_price)); delete l.product_id; } };
      if (b && seg[4] === "stock-batch" && method === "POST") {
        const j = db.jobs.find((x) => x.id === b); if (!j) throw new ApiError("Not found", 404);
        if (j.status !== "OPEN") throw new ApiError("This job already has an invoice", 409);
        const ls = (body.lines || []) as any[]; if (!ls.length) throw new ApiError("Add at least one part", 400);
        for (const l of ls) { const it = db.products.find((x) => x.id === l.productId); if (!it) throw new ApiError("Product not found", 404); if (Number(it.quantity) < Number(l.quantity)) throw new ApiError("Only " + it.quantity + " of " + it.name + " in stock", 409); }
        const done: any[] = [];
        for (const l of ls) {
          const it = db.products.find((x) => x.id === l.productId)!, q = Number(l.quantity);
          const balance = moveStock(it.id, q, "ISSUE", j, Number(it.selling_price)); const line = (j.parts as Row[]).find((x) => x.product_id === it.id);
          if (line) line.quantity = Number(line.quantity) + q; else j.parts.push({ name: it.name, quantity: q, unit_price: Number(it.selling_price), product_id: it.id, part_no: it.part_number || it.sku });
          done.push({ product_id: it.id, name: it.name, quantity: q, balance });
        }
        priced(j); j.revision++; return { ...clone(j), stock: done };
      }
      if (b && seg[4] === "stock" && method === "POST") {
        const j = db.jobs.find((x) => x.id === b); if (!j) throw new ApiError("Not found", 404);
        if (j.status !== "OPEN") throw new ApiError("This job already has an invoice", 409);
        const q = Number(body.quantity); if (!(q > 0)) throw new ApiError("Quantity must be more than 0", 400);
        const item = db.products.find((x) => x.id === body.productId); if (!item) throw new ApiError("Product not found", 404);
        const line = (j.parts as Row[]).find((l) => l.product_id === item.id);
        let balance: number;
        if (body.op === "use") { balance = moveStock(item.id, q, "ISSUE", j, Number(item.selling_price)); if (line) line.quantity = Number(line.quantity) + q; else j.parts.push({ name: item.name, quantity: q, unit_price: Number(item.selling_price), product_id: item.id }); }
        else {
          if (!line) throw new ApiError("This part was not taken from stock for this job", 409);
          if (q > Number(line.quantity)) throw new ApiError("Only " + line.quantity + " of this part are on the job", 409);
          balance = moveStock(item.id, q, "RETURN", j, Number(line.unit_price)); line.quantity = Number(line.quantity) - q; if (line.quantity === 0) j.parts = j.parts.filter((l: Row) => l !== line);
        }
        priced(j); j.revision++; return { ...clone(j), stock: { product_id: item.id, balance } };
      }
      if (!b) {
        if (method === "GET") return clone(rows(db.jobs));
        const j = priced({ id: next("j"), registration: String(body.registration || "").toUpperCase(), vehicle_key: regKey(body.registration), customer: body.customer || "", address: body.address || "", phone: body.phone || "", vehicle: body.vehicle || "",
          job_no: "JOB-" + String(db.jobsMade + 1).padStart(4, "0"), chassis: String(body.chassis || "").toUpperCase(), invoice_type: body.invoice_type || "CASH", odometer: body.odometer ?? undefined, summary: body.summary || "", mechanic: body.mechanic || "", notes: "", status: "OPEN", stage: "WAITING", brought_by: body.brought_by || undefined, brought_phone: body.brought_phone || undefined, revision: 1, parts: [], labour: [], discount: 0, tax_rate: 0, created_at: now(), age_days: 0 });
        Object.assign(j, { front_photo: body.front_photo || undefined, plate_photo: body.plate_photo || undefined, before_photos: body.before_photos || [], photo_count: (body.before_photos || []).length || undefined });
        db.jobs.unshift(j); db.jobsMade++; return clone(j);
      }
      if (seg[4] === "restore" && method === "POST") {
        const back = db.archived.find((x) => x.id === b); if (!back) throw new ApiError("Not found", 404);
        db.archived = db.archived.filter((x) => x.id !== b); back.status = back.invoice_id ? "INVOICED" : "OPEN"; db.jobs.unshift(back); logIt("RESTORED", back); return { restored: true };
      }
      const j = db.jobs.find((x) => x.id === b); if (!j) throw new ApiError("Not found", 404);
      const c = seg[4];
      if (c === "stage" && method === "POST") { if (j.status !== "OPEN") throw new ApiError("Only an open job has a stage", 409); j.stage = body.stage; return clone(j); }
      if (c === "cancel" && method === "POST") { release(j); j.status = "CANCELLED"; j.revision++; logIt("CANCELLED", j); return clone(j); }
      if (c === "undo" && method === "POST") { release(j); db.jobs = db.jobs.filter((x) => x.id !== j.id); logIt("UNDONE", j); return { undone: true }; }
      if (c === "archive" && method === "POST") { release(j); db.jobs = db.jobs.filter((x) => x.id !== j.id); db.archived.unshift({ ...j, status: "ARCHIVED", archive_reason: body.reason || "", archived_by: "Practice", archived_at: now() }); db.requests = db.requests.filter((r) => r.job_id !== j.id); logIt("ARCHIVED", j, body.reason || ""); return { archived: true }; }
      if (c === "delete-request" && seg[5] === "reject" && method === "POST") { db.requests = db.requests.filter((r) => r.job_id !== j.id); j.delete_request = { job_id: j.id, registration: j.registration, customer: j.customer, reason: "", requested_by: "Practice", requested_at: now(), status: "REJECTED", note: body.note || "" }; delete j.delete_requested; logIt("REQUEST_REJECTED", j, body.note || ""); return { rejected: true }; }
      if (c === "delete-request" && method === "POST") { const r = { job_id: j.id, registration: j.registration, customer: j.customer, reason: body.reason || "", requested_by: "Practice", requested_at: now(), status: "PENDING" }; db.requests.push(r); j.delete_request = r; j.delete_requested = true; logIt("DELETE_REQUESTED", j, body.reason || ""); return { requested: true }; }
      if (c === "photos" && method === "POST") {
        const gone = body.remove || [], list = ((j.before_photos || []) as string[]).filter((x) => !gone.includes(x));
        for (const x of body.add || []) if (!list.includes(x)) list.push(x);
        j.before_photos = list; j.photo_count = list.length || undefined;
        if ("front_photo" in body) j.front_photo = body.front_photo || undefined;
        if ("plate_photo" in body) j.plate_photo = body.plate_photo || undefined;
        return { before_photos: list, front_photo: j.front_photo, plate_photo: j.plate_photo };
      }
      if (c === "invoice") {
        const inv = { id: next("i"), invoice_number: String(db.settings.invoice_prefix || "INV") + "-" + String(db.invoices.length + 1).padStart(4, "0"), job_id: j.id, registration: j.registration, customer: j.customer, address: j.address, phone: j.phone, vehicle: j.vehicle, odometer: j.odometer, summary: j.summary,
          brought_by: j.brought_by, brought_phone: j.brought_phone, warranty_until: j.warranty_until, warranty_km: j.warranty_km, warranty_job: j.warranty_job,
          mechanic: j.mechanic, job_no: j.job_no, chassis: j.chassis, invoice_type: j.invoice_type, parts: j.parts, labour: j.labour, parts_total: j.parts_total, labour_total: j.labour_total, discount: j.discount, subtotal: j.subtotal, tax: j.tax, tax_name: "VAT", tax_rate: 0, total: j.total,
          paid: 0, status: "UNPAID", created_at: now(), payments: [] as Row[], currency: "LKR", business: business() };
        db.invoices.unshift(inv); j.status = "INVOICED"; j.invoice_id = inv.id; j.invoice_number = inv.invoice_number; j.revision++;
        return clone(inv);
      }
      if (method === "PATCH") {
        const before = clone(j.parts);
        Object.assign(j, { customer: body.customer, address: body.address, phone: body.phone, vehicle: body.vehicle, chassis: String(body.chassis || "").toUpperCase(), invoice_type: body.invoice_type || j.invoice_type || "CASH", odometer: body.odometer ?? undefined, summary: body.summary, mechanic: body.mechanic, notes: body.notes, brought_by: body.brought_by || undefined, brought_phone: body.brought_phone || undefined,
          warranty_until: body.warranty_until || undefined, warranty_km: body.warranty_km ?? undefined, warranty_job: !!body.warranty_job,
          parts: body.parts || [], labour: body.labour || [], discount: Number(body.discount || 0) });
        const was = new Map(((before as Row[]) || []).filter((l) => l.product_id).map((l) => [l.product_id, Number(l.quantity)] as const));
        const now_ = new Map((j.parts as Row[]).filter((l) => l.product_id).map((l) => [l.product_id, Number(l.quantity)] as const));
        if (was.size !== now_.size || [...was].some(([k, v]) => now_.get(k) !== v)) { j.parts = before; throw new ApiError("Parts taken from stock change only with Pick from stock or Take back, so the stock stays right", 400); }
        priced(j); j.revision++;
      }
      return clone(j);
    }
    if (a === "invoices") {
      if (!b) return clone(rows(db.invoices).map((i) => { const { payments, parts, labour, ...r } = i as Row; return r; }));
      const inv = db.invoices.find((x) => x.id === b); if (!inv) throw new ApiError("Not found", 404);
      if (seg[4] === "void" && method === "POST") {
        inv.status = "VOID"; const j = db.jobs.find((x) => x.id === inv.job_id);
        if (j) { j.status = "OPEN"; delete j.invoice_id; delete j.invoice_number; j.revision++; logIt("INVOICE_VOIDED", j); }
        return clone(inv);
      }
      if (seg[4] === "return" && method === "POST") {
        const asked = (body.lines || []) as { index: number; quantity: number }[];
        if (!asked.length || !String(body.reason || "").trim()) throw new ApiError("Pick the parts that came back and give a reason", 400);
        let credit = 0;
        for (const r of asked) {
          const p = inv.parts[r.index]; const qty = Number(r.quantity);
          if (!p || !(qty > 0) || qty > p.quantity - (p.returned || 0)) throw new ApiError("That is more than can still be returned", 409);
          credit += qty * p.unit_price * (100 - Number(p.discount_pct || 0)) / 100; p.returned = (p.returned || 0) + qty;
          const item = db.products.find((x) => x.id === p.product_id);
          if (item) { item.quantity = round2(item.quantity + qty); db.movements.unshift({ id: next("m"), product_id: item.id, sku: item.sku, name: item.name, unit: item.unit, kind: "RETURN", quantity: qty, unit_price: p.unit_price, balance: item.quantity, job_id: inv.job_id, issue_id: null, actor: "You", note: "Returned after invoice " + inv.invoice_number + ": " + body.reason, created_at: now() }); db.moved++; }
        }
        credit = round2(credit * (1 + Number(inv.tax_rate || 0) / 100));
        inv.total = round2(inv.total - credit); inv.credit_total = round2((inv.credit_total || 0) + credit);
        inv.credits = [...(inv.credits || []), { id: next("c"), at: now(), by: "You", reason: body.reason, amount: credit, lines: asked.map((r) => ({ name: inv.parts[r.index].name, quantity: r.quantity, amount: 0 })) }];
        const over = Math.max(inv.paid - inv.total, 0);
        if (over > 0) { inv.payments.push({ id: next("pay"), amount: -over, method: body.refundMethod || "CASH", note: "Refund: returned parts, " + body.reason, refund: true, at: now() }); inv.paid = round2(inv.paid - over); }
        inv.status = inv.paid >= inv.total ? "PAID" : inv.paid > 0 ? "PARTIAL" : "UNPAID";
        return clone(inv);
      }
      if (seg[4] === "refund" && method === "POST") {
        const amount = Number(body.amount);
        if (!(amount > 0) || !String(body.reason || "").trim()) throw new ApiError("Enter the amount and a reason", 400);
        if (amount > inv.paid) throw new ApiError("That is more than was paid: LKR " + inv.paid.toFixed(2), 409);
        inv.payments.push({ id: next("pay"), amount: -amount, method: body.method || "CASH", note: "Refund: " + body.reason, refund: true, at: now() });
        inv.paid = round2(inv.paid - amount); inv.status = inv.paid >= inv.total ? "PAID" : inv.paid > 0 ? "PARTIAL" : "REFUNDED";
        return clone(inv);
      }
      if (seg[4] === "payments" && method === "POST") {
        const amount = Number(body.amount);
        inv.payments.push({ id: next("pay"), amount, method: body.method || "CASH", note: body.note || "", at: now() });
        inv.paid = round2(inv.paid + amount); inv.status = inv.paid >= inv.total ? "PAID" : "PARTIAL"; db.paid++;
      }
      return clone(inv);
    }
  }
  if (path.includes("/api/workshop/export")) return { exported_at: now(), format: "lifta-export-1", note: "Practice sample. Nothing here is real.", jobs: clone(db.jobs), invoices: clone(db.invoices) };
  if (path.includes("/api/inventory/products/import")) {
    const b = (() => { try { return JSON.parse(String(options.body || "{}")); } catch { return {}; } })();
    if (b.dryRun) return { rows: (b.rows || []).length, ok: (b.rows || []).length, errors: [] };
    throw new ApiError("Practice mode does not import parts. In your real workshop the file is saved.", 400);
  }
  if (path.includes("/api/inventory/stores/count")) return { changed: [], at: now() };
  if (path.includes("/api/inventory/stores/move")) {
    const b = (() => { try { return JSON.parse(String(options.body || "{}")); } catch { return {}; } })();
    return { shelf: "Rack 1-B (sample)", rack_id: b.rackId, level_id: b.levelId || null, moved: (b.productIds || []).map((id: string) => ({ product_id: id, name: "Sample part", from: "Rack 1-A", to: "Rack 1-B (sample)" })) };
  }
  if (path.includes("/api/inventory/stores/shelf")) {
    const rack = new URL(path, "http://demo").searchParams.get("rack");
    return { rack_id: rack, level_id: null, parts: rack === "r1" ? [{ id: "p1", sku: "S-1", name: "Oil filter (sample)", part_number: "OF-1", unit: "UNIT", quantity: 4, reorder_level: 2, location: "Rack 1-A", level_id: "l1" }] : [] };
  }
  if (path.includes("/api/inventory/stores/layout") || path.includes("/api/inventory/stores/quick-start")) {
    if (method !== "GET") throw new ApiError("Practice mode does not save the store room. In your real workshop your walls, racks and levels are saved.", 400);
    return { revision: 1, not_shelved: 1, categories: [], counts: { "r1": { "l1": 2 } }, areas: [{ id: "wall-w", name: "Left wall", pos: "W" }, { id: "wall-e", name: "Right wall", pos: "E" }, { id: "wall-n", name: "Top wall", pos: "N" }, { id: "wall-s", name: "Bottom wall", pos: "S" }],
      racks: [{ id: "r1", name: "1", area_id: "wall-w", type: "RACK", levels: [{ id: "l1", name: "A" }, { id: "l2", name: "B" }, { id: "l3", name: "C" }] }, { id: "r2", name: "2", area_id: "wall-n", type: "RACK", levels: [{ id: "l4", name: "A" }, { id: "l5", name: "B" }] }, { id: "r3", name: "Cupboard", area_id: "wall-e", type: "CUPBOARD", levels: [] }] };
  }
  if (path.includes("/api/inventory/stores")) {
    if (method !== "GET") { const b = (() => { try { return JSON.parse(String(options.body || "{}")); } catch { return {}; } })(); return { racks: b.racks || [], categories: b.categories || [], shelves: [], revision: 1 }; }
    return { racks: [], categories: [], shelves: [], revision: 0 };
  }
  // Anything unlisted still must not error or reach the server: answer as an empty, harmless success.
  return method === "GET" ? [] : { ok: true };
}

/** The dummy API. After a call succeeds it also records what the learner did, so the coach can follow along. */
export async function demoApi(path: string, options: RequestInit = {}): Promise<any> {
  const out = await route(path, options);
  const method = (options.method || "GET").toUpperCase();
  if (method !== "GET") {
    const p = new URL(path, "http://demo").pathname.replace(/\/+$/, "");
    let body: Row = {};
    if (typeof options.body === "string") { try { body = JSON.parse(options.body); } catch { body = {}; } }
    if (method === "POST" && p === "/api/inventory/products") mark("api:product");
    else if (method === "POST" && p === "/api/inventory/documents") mark(body.kind === "STOCK_OUT" ? "api:out" : "api:in");
    else if (method === "POST" && p === "/api/inventory/movements") mark(body.kind === "STOCK_OUT" ? "api:out" : "api:in");
    else if (method === "POST" && p === "/api/workshop/jobs") mark("api:job");
    else if (method === "PATCH" && p.startsWith("/api/workshop/jobs/")) mark("api:jobsave");
    else if (p.endsWith("/invoice")) mark("api:invoice");
    else if (p.endsWith("/payments")) mark("api:pay");
    else if (p.endsWith("/archive")) mark("api:archive");
    else if (p.endsWith("/restore")) mark("api:restore");
    else if (p.endsWith("/void")) mark("api:void");
    else if (p.endsWith("/owner")) mark("api:owner");
    else if (p.endsWith("/stage")) mark("api:stage");
    else if (p.endsWith("/refund")) mark("api:refund");
  }
  return out;
}
