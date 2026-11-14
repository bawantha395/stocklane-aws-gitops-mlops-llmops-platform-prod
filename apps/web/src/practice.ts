import { useSyncExternalStore } from "react";
import { ApiError } from "./api";
import { getBusinessName } from "./businessName";

/**
 * Practice mode: the real screens, run against dummy data that lives only in this browser tab.
 * While it is on, api() never reaches the server (see api.ts), so nothing real can be read or changed.
 */
type PState = { active: boolean; owner: boolean; step: number };
let state: PState = { active: false, owner: true, step: 0 };
const subscribers = new Set<() => void>();
const emit = () => subscribers.forEach((n) => n());
export const usePractice = () => useSyncExternalStore((n) => { subscribers.add(n); return () => { subscribers.delete(n); }; }, () => state);
export const isPractice = () => state.active;
export function startPractice(owner: boolean) { reset(); state = { active: true, owner, step: 0 }; emit(); }
export function stopPractice() { state = { ...state, active: false, step: 0 }; reset(); emit(); }
export function setPracticeStep(step: number) { state = { ...state, step }; emit(); }
/** The coach reads these to know what the learner has done. Counters only go up. */
export const probe = { view: "home" as string };

type Row = Record<string, any>;
const db = { settings: {} as Row, edits: {} as Record<string, Row>, archived: [] as Row[], log: [] as Row[], requests: [] as Row[], photos: {} as Record<string, { image: string; thumb: string }>, products: [] as Row[], movements: [] as Row[], jobs: [] as Row[], invoices: [] as Row[], seq: 0, created: 0, moved: 0, jobsMade: 0, paid: 0 };
export const progress = () => ({ created: db.created, moved: db.moved, jobs: db.jobsMade, paid: db.paid });
const now = () => new Date().toISOString();
const next = (p: string) => p + String(++db.seq);
const regKey = (s: string) => String(s || "").replace(/[^A-Za-z0-9]/g, "").toUpperCase();
const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

function reset() {
  db.settings = {}; db.edits = {}; db.archived = []; db.log = []; db.requests = []; db.photos = {}; db.seq = 0; db.created = 0; db.moved = 0; db.jobsMade = 0; db.paid = 0; db.jobs = []; db.invoices = []; db.movements = [];
  const p = (name: string, brand: string, category: string, qty: number, location: string, part: string, extra: Row = {}) => ({
    id: next("p"), sku: "DEMO-" + String(db.seq).padStart(3, "0"), name, category, brand, grade: "", capacity: "", barcode: null, unit: "UNIT", quantity: qty,
    selling_price: 0, reorder_level: 5, image_id: null, part_number: part, location, archived: false, ...extra,
  });
  db.products = [
    p("Oil filter small", "Demo Parts", "Filters", 8, "B2", "DP-OF-100"),
    p("Brake pads front", "Demo Brakes", "Brakes", 14, "C3", "DB-BP-220"),
    p("Engine oil 10W-40 4L", "Demo Oil Co", "Engine oil", 6, "A1", "DO-1040-4", { grade: "10W-40", capacity: "4 L" }),
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

const clone = <T,>(v: T): T => JSON.parse(JSON.stringify(v));

function business() {
  return { name: getBusinessName(), address: "12 Demo Road", phone: "011 000 0000", email: "", reg_no: "", bank: "", footer: "", tax_name: "VAT", tax_rate: 0, mechanic_discount_pct: 10, ...db.settings };
}
function priced(j: Row) {
  j.parts_total = round2(j.parts.reduce((s: number, p: Row) => s + Number(p.quantity) * Number(p.unit_price), 0));
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
  const invoiced = mine.filter((x) => x.status === "INVOICED");
  return { id: key, registration: j.registration, owner: j.customer, phone: j.phone, make: j.vehicle, updated_at: now(), visits: invoiced.length, spent: invoiced.reduce((t, x) => t + x.total, 0),
    first_visit: invoiced.length ? invoiced[invoiced.length - 1].created_at.slice(0, 10) : null, average_gap_days: null, front_photo: mine.find((x) => x.front_photo)?.front_photo, plate_photo: mine.find((x) => x.plate_photo)?.plate_photo,
    history: mine.map((x) => ({ id: x.id, created_at: x.created_at, summary: x.summary, status: x.status, odometer: x.odometer, total: x.total, invoice_number: x.invoice_number, invoice_id: x.invoice_id,
      parts: x.parts.map((q: Row) => ({ name: q.name, quantity: q.quantity, unit_price: q.unit_price })), labour: x.labour.map((q: Row) => ({ description: q.description, amount: q.amount })), mechanic: x.mechanic })), ...db.edits[key] };
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

export async function demoApi(path: string, options: RequestInit = {}): Promise<any> {
  await new Promise((r) => setTimeout(r, 220));
  const method = (options.method || "GET").toUpperCase();
  const url = new URL(path, "http://demo");
  const p = url.pathname;
  let body: Row = {};
  if (typeof options.body === "string") { try { body = JSON.parse(options.body); } catch { body = {}; } }
  const seg = p.split("/").filter(Boolean); // api, area, ...
  const area = seg[1], a = seg[2], b = seg[3];

  if (area === "inventory") {
    if (a === "session") return { name: "Practice", roles: [state.owner ? "ROLE_OWNER" : "ROLE_MECHANIC"] };
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
        part_number: body.partNumber || "", location: body.location || "", archived: false };
      db.products.unshift(item); return clone(item);
    }
    if (a === "products" && b) {
      const item = db.products.find((x) => x.id === b); if (!item) throw new ApiError("Not found", 404);
      if (method === "PATCH") Object.assign(item, { name: body.name, brand: body.brand, category: body.category, grade: body.grade, capacity: body.capacity, part_number: body.partNumber, location: body.location, reorder_level: body.reorderLevel });
      return clone(item);
    }
    if (a === "movements") {
      if (method === "GET") return clone(db.movements);
      const item = db.products.find((x) => x.id === body.productId); if (!item) throw new ApiError("Part not found", 404);
      const q = Number(body.quantity);
      if (body.kind === "STOCK_OUT" && q > Number(item.quantity)) throw new ApiError("Only " + item.quantity + " in stock.", 409);
      item.quantity = round2(Number(item.quantity) + (body.kind === "STOCK_OUT" ? -q : q));
      const m = { id: next("m"), product_id: item.id, sku: item.sku, name: item.name, unit: item.unit, kind: body.kind, quantity: q, unit_price: 0, balance: item.quantity, job_id: null, issue_id: null, actor: "Practice", note: body.note || "", created_at: now() };
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
    if (a === "settings") {
      if (method === "PUT") { db.settings = { ...db.settings, ...body }; }
      return business();
    }
    if (a === "report.pdf" || (a === "invoices" && seg[4] === "pdf") || (a === "vehicles" && seg[4] === "history.pdf")) return samplePdf(a === "report.pdf" ? "Workshop report" : a === "invoices" ? "Invoice" : "Vehicle history");
    if (a === "report") return reportFor(url.searchParams.get("from") || "0000-01-01", url.searchParams.get("until") || "9999-12-31");
    if (a === "archive") return clone({ jobs: db.archived, log: db.log });
    if (a === "suggestions") return { parts: [{ name: "Demo Motor Oil 5W-30 1L", price: 1500, uses: 3 }, { name: "Oil filter small", price: 900, uses: 2 }], labour: [{ description: "Oil change", amount: 1500, uses: 3 }] };
    if (a === "service-due") return [];
    if (a === "dashboard") {
      const open = db.jobs.filter((j) => j.status === "OPEN");
      const owing = db.invoices.filter((i) => i.status === "UNPAID" || i.status === "PARTIAL");
      const d = now().slice(0, 10);
      const sum = (f: (i: Row) => number) => db.invoices.reduce((s, i) => s + f(i), 0);
      return clone({ today: { date: d, invoices: db.invoices.length, billed: sum((i) => i.total), received: sum((i) => i.paid) }, month: { from: d.slice(0, 8) + "01", invoices: db.invoices.length, billed: sum((i) => i.total), received: sum((i) => i.paid) },
        open_jobs: rows(open), open_count: open.length, unpaid_count: owing.length, unpaid_total: owing.reduce((s, i) => s + i.total - i.paid, 0), oldest_unpaid_days: 0, due_count: 0, delete_requests: db.requests.filter((r) => r.status === "PENDING") });
    }
    if (a === "vehicles") {
      if (b) {
        const v = vehicleView(b); if (!v) throw new ApiError("Vehicle not found", 404);
        if (method === "PATCH") { db.edits[b] = { ...db.edits[b], ...(body.owner !== undefined ? { owner: body.owner } : {}), ...(body.make !== undefined ? { make: body.make } : {}), ...(body.phone !== undefined ? { phone: body.phone } : {}), ...(body.notes !== undefined ? { notes: body.notes } : {}) }; return { saved: true }; }
        return clone(v);
      }
      const term = (url.searchParams.get("search") || "").toLowerCase();
      const keys = [...new Set(db.jobs.map((j) => j.vehicle_key))];
      return clone(keys.map((k) => vehicleView(k)).filter((v): v is NonNullable<ReturnType<typeof vehicleView>> => !!v && (v.registration + v.owner).toLowerCase().includes(term)).map(({ history, ...v }) => v));
    }
    if (a === "jobs") {
      if (!b) {
        if (method === "GET") return clone(rows(db.jobs));
        const j = priced({ id: next("j"), registration: String(body.registration || "").toUpperCase(), vehicle_key: regKey(body.registration), customer: body.customer || "", phone: body.phone || "", vehicle: body.vehicle || "",
          odometer: body.odometer ?? undefined, summary: body.summary || "", mechanic: body.mechanic || "", notes: "", status: "OPEN", revision: 1, parts: [], labour: [], discount: 0, tax_rate: 0, created_at: now(), age_days: 0 });
        Object.assign(j, { front_photo: body.front_photo || undefined, plate_photo: body.plate_photo || undefined, before_photos: body.before_photos || [], photo_count: (body.before_photos || []).length || undefined });
        db.jobs.unshift(j); db.jobsMade++; return clone(j);
      }
      if (seg[4] === "restore" && method === "POST") {
        const back = db.archived.find((x) => x.id === b); if (!back) throw new ApiError("Not found", 404);
        db.archived = db.archived.filter((x) => x.id !== b); back.status = back.invoice_id ? "INVOICED" : "OPEN"; db.jobs.unshift(back); logIt("RESTORED", back); return { restored: true };
      }
      const j = db.jobs.find((x) => x.id === b); if (!j) throw new ApiError("Not found", 404);
      const c = seg[4];
      if (c === "cancel" && method === "POST") { j.status = "CANCELLED"; j.revision++; logIt("CANCELLED", j); return clone(j); }
      if (c === "undo" && method === "POST") { db.jobs = db.jobs.filter((x) => x.id !== j.id); logIt("UNDONE", j); return { undone: true }; }
      if (c === "archive" && method === "POST") { db.jobs = db.jobs.filter((x) => x.id !== j.id); db.archived.unshift({ ...j, status: "ARCHIVED", archive_reason: body.reason || "", archived_by: "Practice", archived_at: now() }); db.requests = db.requests.filter((r) => r.job_id !== j.id); logIt("ARCHIVED", j, body.reason || ""); return { archived: true }; }
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
        const inv = { id: next("i"), invoice_number: "INV-" + String(db.invoices.length + 1).padStart(4, "0"), job_id: j.id, registration: j.registration, customer: j.customer, phone: j.phone, vehicle: j.vehicle, odometer: j.odometer, summary: j.summary,
          mechanic: j.mechanic, parts: j.parts, labour: j.labour, parts_total: j.parts_total, labour_total: j.labour_total, discount: j.discount, subtotal: j.subtotal, tax: j.tax, tax_name: "VAT", tax_rate: 0, total: j.total,
          paid: 0, status: "UNPAID", created_at: now(), payments: [] as Row[], currency: "LKR", business: business() };
        db.invoices.unshift(inv); j.status = "INVOICED"; j.invoice_id = inv.id; j.invoice_number = inv.invoice_number; j.revision++;
        return clone(inv);
      }
      if (method === "PATCH") {
        Object.assign(j, { customer: body.customer, phone: body.phone, vehicle: body.vehicle, odometer: body.odometer ?? undefined, summary: body.summary, mechanic: body.mechanic, notes: body.notes,
          parts: body.parts || [], labour: body.labour || [], discount: Number(body.discount || 0) });
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
      if (seg[4] === "payments" && method === "POST") {
        const amount = Number(body.amount);
        inv.payments.push({ id: next("pay"), amount, method: body.method || "CASH", note: body.note || "", at: now() });
        inv.paid = round2(inv.paid + amount); inv.status = inv.paid >= inv.total ? "PAID" : "PARTIAL"; db.paid++;
      }
      return clone(inv);
    }
  }
  // Anything unlisted still must not error or reach the server: answer as an empty, harmless success.
  return method === "GET" ? [] : { ok: true };
}
