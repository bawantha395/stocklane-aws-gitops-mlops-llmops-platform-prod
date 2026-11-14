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
const db = { products: [] as Row[], movements: [] as Row[], jobs: [] as Row[], invoices: [] as Row[], seq: 0, created: 0, moved: 0, jobsMade: 0, paid: 0 };
export const progress = () => ({ created: db.created, moved: db.moved, jobs: db.jobsMade, paid: db.paid });
const now = () => new Date().toISOString();
const next = (p: string) => p + String(++db.seq);
const regKey = (s: string) => String(s || "").replace(/[^A-Za-z0-9]/g, "").toUpperCase();
const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

function reset() {
  db.seq = 0; db.created = 0; db.moved = 0; db.jobsMade = 0; db.paid = 0; db.jobs = []; db.invoices = []; db.movements = [];
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

const clone = <T,>(v: T): T => JSON.parse(JSON.stringify(v));
const unavailable = () => new ApiError("This is not part of the practice. Close practice mode to use it for real.", 404);

function business() {
  return { name: getBusinessName(), address: "12 Demo Road", phone: "011 000 0000", email: "", reg_no: "", bank: "", footer: "", tax_name: "VAT", tax_rate: 0, mechanic_discount_pct: 10 };
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
    if (a === "products" && b === "archived") return [];
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
    if (a === "drafts") return [];
  }
  if (area === "forecast") return { products: [] };
  if (area === "workshop") {
    if (a === "settings") return business();
    if (a === "suggestions") return { parts: [{ name: "Demo Motor Oil 5W-30 1L", price: 1500, uses: 3 }, { name: "Oil filter small", price: 900, uses: 2 }], labour: [{ description: "Oil change", amount: 1500, uses: 3 }] };
    if (a === "service-due") return [];
    if (a === "dashboard") {
      const open = db.jobs.filter((j) => j.status === "OPEN");
      const owing = db.invoices.filter((i) => i.status === "UNPAID" || i.status === "PARTIAL");
      const d = now().slice(0, 10);
      const sum = (f: (i: Row) => number) => db.invoices.reduce((s, i) => s + f(i), 0);
      return clone({ today: { date: d, invoices: db.invoices.length, billed: sum((i) => i.total), received: sum((i) => i.paid) }, month: { from: d.slice(0, 8) + "01", invoices: db.invoices.length, billed: sum((i) => i.total), received: sum((i) => i.paid) },
        open_jobs: rows(open), open_count: open.length, unpaid_count: owing.length, unpaid_total: owing.reduce((s, i) => s + i.total - i.paid, 0), oldest_unpaid_days: 0, due_count: 0, delete_requests: [] });
    }
    if (a === "vehicles") {
      if (b) {
        const j = db.jobs.filter((x) => x.vehicle_key === b);
        if (!j.length) throw new ApiError("Not found", 404);
        return clone({ id: b, registration: j[0].registration, owner: j[0].customer, phone: j[0].phone, make: j[0].vehicle, updated_at: now(), visits: j.length, history: [] });
      }
      const term = (url.searchParams.get("search") || "").toLowerCase();
      return clone(db.jobs.filter((j) => (j.registration + j.customer).toLowerCase().includes(term)).map((j) => ({ id: j.vehicle_key, registration: j.registration, owner: j.customer, phone: j.phone, make: j.vehicle, updated_at: now() })));
    }
    if (a === "jobs") {
      if (!b) {
        if (method === "GET") return clone(rows(db.jobs));
        const j = priced({ id: next("j"), registration: String(body.registration || "").toUpperCase(), vehicle_key: regKey(body.registration), customer: body.customer || "", phone: body.phone || "", vehicle: body.vehicle || "",
          odometer: body.odometer ?? undefined, summary: body.summary || "", mechanic: body.mechanic || "", notes: "", status: "OPEN", revision: 1, parts: [], labour: [], discount: 0, tax_rate: 0, created_at: now(), age_days: 0 });
        db.jobs.unshift(j); db.jobsMade++; return clone(j);
      }
      const j = db.jobs.find((x) => x.id === b); if (!j) throw new ApiError("Not found", 404);
      const c = seg[4];
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
      if (seg[4] === "payments" && method === "POST") {
        const amount = Number(body.amount);
        inv.payments.push({ id: next("pay"), amount, method: body.method || "CASH", note: body.note || "", at: now() });
        inv.paid = round2(inv.paid + amount); inv.status = inv.paid >= inv.total ? "PAID" : "PARTIAL"; db.paid++;
      }
      return clone(inv);
    }
  }
  throw unavailable();
}
