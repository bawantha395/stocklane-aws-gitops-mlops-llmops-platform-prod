import { Ban, CheckCircle2, ClipboardList, CircleDashed, CircleDollarSign, FileText, Trash2 } from "lucide-react";
import { t } from "../i18n";
import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import { api } from "../api";

export type PageName = "home" | "jobs" | "vehicles" | "customers" | "customer" | "due" | "invoices" | "archive" | "report" | "settings" | "new" | "job" | "vehicle" | "invoice" | "quotes" | "quote";
export type Page = { name: PageName; id?: string; reg?: string; kind?: "ESTIMATE" | "QUOTATION"; tab?: "JOBS" | "ESTIMATE" | "QUOTATION" };
export type Business = { name: string; address: string; phone: string; email: string; reg_no: string; bank: string; footer: string; tax_name: string; tax_rate: number; mechanic_discount_pct?: number; payment_terms_days?: number; warranty?: string; qr_url?: string; invoice_prefix?: string; default_reorder_level?: number; default_markup_pct?: number; sinhala?: boolean; labour_items?: Labour[]; mechanics?: string[]; logo?: { v: string; w: number; h: number; c: number } | null };
export type Part = { name: string; quantity: number; unit_price: number; outside?: boolean; outside_cost?: number | string; outside_shop?: string; outside_supplier_id?: string; product_id?: string; discount_pct?: number; part_no?: string; added_at?: string; returned?: number; returned_at?: string };
export type Labour = { description: string; amount: number };
export type Stage = "WAITING" | "IN_PROGRESS" | "PARTS" | "READY";
export const STAGES: Stage[] = ["WAITING", "IN_PROGRESS", "PARTS", "READY"];
export const STAGE_LABEL: Record<Stage, string> = { WAITING: "Waiting", IN_PROGRESS: "In progress", PARTS: "Waiting for parts", READY: "Ready for pickup" };
export type Profit = { parts_sales: number; parts_cost: number; parts_margin: number; labour: number; discount: number; profit: number; unknown: number };
export type Job = {
  profit?: Profit;
  id: string; registration: string; vehicle_key: string; customer: string; address?: string; phone: string; vehicle: string; odometer?: number; summary: string;
  mechanic: string; notes: string; status: "OPEN" | "INVOICED" | "CANCELLED" | "ARCHIVED"; revision: number; invoice_id?: string; invoice_number?: string;
  parts: Part[]; labour: Labour[]; discount: number; tax_rate?: number; parts_total: number; labour_total: number; subtotal: number; tax: number; total: number;
  next_service_date?: string; next_service_km?: number; created_at: string; lines?: number; age_days?: number;
  front_photo?: string; plate_photo?: string; before_photos?: string[]; photo_count?: number;
  job_no?: string; chassis?: string; invoice_type?: "CASH" | "CREDIT" | "INSURANCE" | "WARRANTY"; out_at?: string; quote_number?: string; quote_id?: string; voids?: { invoice_number: string; at: string }[];
  stage?: Stage; stage_at?: string; returns?: { at: string; reason: string; quantity: number }[]; brought_by?: string; brought_phone?: string; warranty_until?: string; warranty_km?: number | null; warranty_job?: boolean;
  delete_requested?: boolean; delete_request?: DeleteRequest; undo_seconds_left?: number; archive_reason?: string; archived_by?: string; archived_at?: string;
};
export type DeleteRequest = { job_id: string; registration: string; customer: string; reason: string; requested_by: string; requested_at: string; status: "PENDING" | "REJECTED"; note?: string; decided_by?: string };
export type QuoteWork = { description: string; amount: number; section: "Rem/Refit" | "Repaint" | "Other" };
export type QuoteStatus = "DRAFT" | "SENT" | "APPROVED" | "REJECTED" | "CONVERTED";
export type QuoteVersion = { rev_no: number; at: string; by?: string; status: QuoteStatus; total: number; parts: Part[]; labour: QuoteWork[]; note?: string };
export type Quote = {
  id: string; kind?: "ESTIMATE" | "QUOTATION"; number: string; status: QuoteStatus; revision: number; rev_no: number; registration: string; vehicle_key: string; vehicle?: string; odometer?: number | null; customer?: string; phone?: string;
  insurer?: string; insurer_branch?: string; claim_no?: string; policy_no?: string; issue?: string; valid_until?: string; photos?: string[]; parts: Part[]; labour: QuoteWork[];
  history: QuoteVersion[]; parts_total: number; labour_total: number; sections: Record<string, number>; total: number; parts_unpriced: number; created_at: string; updated_at: string;
  job_id?: string; expired?: boolean; days_left?: number | null; lines?: number; photo_count?: number; front_photo?: string; rev_count?: number;
};
export type Visit = {
  job_no?: string;
  id: string; created_at: string; summary: string; status: string; odometer?: number; total: number; invoice_number?: string; invoice_id?: string;
  parts?: Part[]; labour?: Labour[]; mechanic?: string; customer?: string;
  paid?: number; balance?: number; pay_status?: "UNPAID" | "PARTIAL" | "PAID" | "REFUNDED";
};
export type OwnerChange = { at: string; from_owner?: string; from_phone?: string; to_owner: string; to_phone?: string; by?: string };
export type Vehicle = {
  id: string; registration: string; owner?: string; phone?: string; make?: string; chassis?: string; notes?: string; last_km?: number; next_service_date?: string;
  next_service_km?: number; updated_at: string; reason?: string; history?: Visit[]; visits?: number; spent?: number; first_visit?: string | null; average_gap_days?: number | null;
  front_photo?: string; plate_photo?: string; owner_log?: OwnerChange[];
};
export type Payment = { id: string; amount: number; method: string; note: string; at: string; refund?: boolean };
export type Invoice = {
  profit?: Profit; voided_reason?: string;
  id: string; invoice_number: string; job_id: string; registration: string; customer: string; address?: string; phone?: string; vehicle?: string; odometer?: number; summary?: string; mechanic?: string;
  parts: Part[]; labour: Labour[]; parts_total: number; labour_total: number; discount: number; subtotal: number; tax: number; tax_name?: string; tax_rate: number; total: number;
  paid: number; status: "UNPAID" | "PARTIAL" | "PAID" | "REFUNDED" | "VOID"; created_at: string; payments: Payment[]; currency: string; business?: Business; invoice_type?: string; overdue_days?: number; due_days?: number; job_no?: string; chassis?: string;
  next_service_date?: string; next_service_km?: number;
  brought_by?: string; brought_phone?: string; warranty_until?: string; warranty_km?: number | null; warranty_job?: boolean;
  credit_total?: number; original_total?: number; credits?: { id: string; at: string; by: string; reason: string; amount: number; lines: { name: string; quantity: number; amount: number }[] }[];
};
export type Owing = { id: string; invoice_number: string; registration: string; customer: string; total: number; paid: number; balance: number; status: string; created_at: string; age_days: number; invoice_type?: string; overdue_days?: number; due_days?: number };

export type Ctx = { owner: boolean; business: Business; go: (p: Page, notice?: string) => void; reloadBusiness: () => void };
export const WsContext = createContext<Ctx>(null as unknown as Ctx);
export const useWs = () => useContext(WsContext);

export const lkr = (n: number | string | undefined) => Number(n || 0).toLocaleString("en", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
export const kmText = (n?: number | null) => (n == null ? "-" : Number(n).toLocaleString("en") + " km");
export const dateOnly = (s: string) => new Date(s).toLocaleDateString("en-CA", { timeZone: "Asia/Colombo" });
export const today = () => dateOnly(new Date().toISOString());
export const addDays = (iso: string, n: number) => { const d = new Date(iso + "T00:00:00Z"); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
export const regKey = (s: string) => s.replace(/[^A-Za-z0-9]/g, "").toUpperCase();
export const num = (s: string | number | undefined) => (Number.isFinite(Number(s)) ? Number(s) : 0);
export const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;
/** WhatsApp click-to-chat link for a Sri Lankan number (07x becomes 947x). */
/** Days past the payment terms (Setup; 7 days when none is set) for a bill that still has a balance. 0 when it is not late. */
/** Days past due. Uses the server's own count when the bill carries it (same Colombo-date clock, and 30 days for Insurance/Credit bills); otherwise counts Colombo calendar days here. */
export const lateDays = (i: { created_at: string; invoice_type?: string; overdue_days?: number }, terms?: number) => {
  if (typeof i.overdue_days === "number") return i.overdue_days;
  const age = Math.round((Date.parse(today() + "T00:00:00Z") - Date.parse(dateOnly(i.created_at) + "T00:00:00Z")) / 86400000);
  const base = terms || 7;
  return Math.max(0, age - (i.invoice_type === "INSURANCE" || i.invoice_type === "CREDIT" ? Math.max(base, 30) : base));
};
export const waLink = (phone: string, message: string) => {
  let d = phone.replace(/\D/g, "");
  if (d.startsWith("0")) d = "94" + d.slice(1);
  return "https://wa.me/" + d + "?text=" + encodeURIComponent(message);
};

export function useCommand() {
  const pending = useRef({ body: "", key: "" });
  return async <T,>(path: string, body: unknown, method = "POST") => {
    const fingerprint = path + method + JSON.stringify(body);
    if (pending.current.body !== fingerprint) pending.current = { body: fingerprint, key: typeof crypto.randomUUID === "function" ? crypto.randomUUID() : Date.now().toString(36) + Math.random().toString(36).slice(2) + Math.random().toString(36).slice(2) };
    const value = await api<T>(path, { method, body: JSON.stringify(body) }, pending.current.key);
    pending.current = { body: "", key: "" };
    // these change the stock too (a part used, taken back, or returned when a job is cancelled or deleted): other screens reload it
    if (/\/api\/workshop\/jobs\/[^/]+\/(stock|cancel|archive|undo)$/.test(path)) window.dispatchEvent(new Event("lifta:stock-changed"));
    return value;
  };
}

/** Load once (and again on reload()). A null path loads nothing. */
export function useLoad<T>(path: string | null) {
  const [data, setData] = useState<T | null>(null), [error, setError] = useState("");
  const load = useCallback(async () => {
    if (!path) { setData(null); return; }
    try { setData(await api<T>(path)); setError(""); } catch (e) { setError((e as Error).message); }
  }, [path]);
  useEffect(() => { void load(); }, [load]);
  return { data, error, reload: load };
}

export function useDebounced(value: string, ms = 250) {
  const [v, setV] = useState(value);
  useEffect(() => { const t = setTimeout(() => setV(value), ms); return () => clearTimeout(t); }, [value, ms]);
  return v;
}

const LABEL: Record<string, string> = { DRAFT: "Draft", SENT: "Sent", APPROVED: "Approved", REJECTED: "Rejected", CONVERTED: "Made into a job", OPEN: "Open", INVOICED: "Invoiced", CANCELLED: "Cancelled", ARCHIVED: "Deleted", UNPAID: "Unpaid", PARTIAL: "Part paid", PAID: "Paid", REFUNDED: "Refunded", VOID: "Void", EXPIRED: "Expired" };
const ICON: Record<string, typeof Ban> = { DRAFT: CircleDashed, SENT: FileText, APPROVED: CheckCircle2, REJECTED: Ban, CONVERTED: CheckCircle2, OPEN: CircleDashed, INVOICED: FileText, UNPAID: FileText, PARTIAL: CircleDollarSign, PAID: CheckCircle2, REFUNDED: Ban, VOID: Ban, EXPIRED: Ban, CANCELLED: Ban, ARCHIVED: Trash2 };
/** Status: colour + icon + word, so it never relies on colour alone. */
export const Pill = ({ s }: { s: string }) => { const I = ICON[s] || CircleDashed; return <span className={"ws-pill " + s.toLowerCase()}><I size={13} strokeWidth={2.4} aria-hidden="true" />{t(LABEL[s] || s)}</span>; };
export const Empty = ({ children, action }: { children: string; action?: { label: string; onClick: () => void } }) => (
  <div className="ws-empty">
    <span className="ws-empty-ico" aria-hidden="true"><ClipboardList size={28} strokeWidth={1.6} /></span>
    <span>{t(children)}</span>
    {action && <button className="button primary" onClick={action.onClick}>{action.label}</button>}
  </div>
);
export const Loading = ({ error }: { error?: string }) => error ? <p className="stock-error" role="alert">{error}</p> : (
  <div className="ws-skel" aria-busy="true" aria-label={t("Loading…")}>{[0, 1, 2].map((i) => <span key={i} className="ws-skel-card"><i /><i /><i /></span>)}</div>
);

/** Asks for a reason (or a note) before a delete, a request or a rejection. */
/** Owner (or anyone allowed to see cost): what this job or bill earns. Never sent to anyone else, so it simply is not there for them. */
export function ProfitCard({ p }: { p?: Profit }) {
  if (!p) return null;
  return (
    <section className="ws-card ws-profit">
      <h3>{t("Profit on this job")}</h3>
      <div className="ws-profit-row"><span>{t("Parts sold")}</span><b>{lkr(p.parts_sales)}</b></div>
      <div className="ws-profit-row"><span>{t("Parts cost")}</span><b>-{lkr(p.parts_cost)}</b></div>
      <div className="ws-profit-row"><span>{t("Labour")}</span><b>{lkr(p.labour)}</b></div>
      {num(p.discount) > 0 && <div className="ws-profit-row"><span>{t("Discount")}</span><b>-{lkr(p.discount)}</b></div>}
      <div className="ws-profit-row total"><span>{t("Profit")}</span><b>{lkr(p.profit)}</b></div>
      {p.unknown > 0 && <small className="ws-hint">{t("{n} part line(s) have no cost yet, so they are left out. Enter the cost on the delivery or on the bought-outside line.", { n: p.unknown })}</small>}
    </section>
  );
}

export function ReasonDialog({ title, help, label, confirm, required = true, onDone, onClose }: {
  title: string; help?: string; label: string; confirm: string; required?: boolean; onDone: (text: string) => Promise<void>; onClose: () => void;
}) {
  const [v, setV] = useState(""), [busy, setBusy] = useState(false), [err, setErr] = useState("");
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (required && !v.trim()) { setErr(label + " is required"); return; }
    setBusy(true); setErr("");
    try { await onDone(v.trim()); } catch (x) { setErr((x as Error).message); setBusy(false); }
  };
  return (
    <div className="ws-dialog-back" role="dialog" aria-modal="true" aria-label={title}>
      <form className="ws-dialog" onSubmit={submit}>
        <h3>{title}</h3>
        {help && <p className="muted">{help}</p>}
        <label className="ws-field">{label}<textarea autoFocus rows={3} maxLength={200} value={v} onChange={(e) => setV(e.target.value)} placeholder="English letters only" /></label>
        {err && <p role="alert" className="stock-error">{err}</p>}
        <div className="ws-actions"><button type="button" className="button secondary" disabled={busy} onClick={onClose}>Back</button><button className="button primary" disabled={busy}>{busy ? "Working…" : confirm}</button></div>
      </form>
    </div>
  );
}

/** A number that counts up the first time it scrolls into view (instant when motion is reduced). */
export function Num({ v, fmt = lkr }: { v: number | string | undefined; fmt?: (n: number) => string }) {
  const target = Number(v || 0), ref = useRef<HTMLSpanElement>(null), [shown, setShown] = useState(target), done = useRef(false);
  useEffect(() => {
    const el = ref.current; if (!el || done.current) return;
    if (typeof window === "undefined" || window.matchMedia("(prefers-reduced-motion: reduce)").matches || !("IntersectionObserver" in window)) { setShown(target); return; }
    setShown(0);
    const io = new IntersectionObserver((es) => {
      if (!es[0]?.isIntersecting) return; io.disconnect(); done.current = true;
      const t0 = performance.now(), D = 800;
      const tick = (now: number) => { const p = Math.min(1, (now - t0) / D); setShown(target * (1 - Math.pow(1 - p, 3))); if (p < 1) requestAnimationFrame(tick); else setShown(target); };
      requestAnimationFrame(tick);
    }, { threshold: 0.4 });
    io.observe(el); return () => io.disconnect();
  }, [target]);
  useEffect(() => { if (done.current) setShown(target); }, [target]);
  return <span ref={ref}>{fmt(shown)}</span>;
}

/** Cards below the fold fade and rise as they arrive; charts start drawing when seen. Does nothing when motion is reduced. */
export function useScrollFeel(root: React.RefObject<HTMLElement | null>, key: unknown) {
  useEffect(() => {
    const el = root.current; if (!el || typeof window === "undefined" || !("IntersectionObserver" in window) || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const seen = new WeakSet<Element>();
    const io = new IntersectionObserver((es) => es.forEach((e) => { if (e.isIntersecting) { e.target.classList.add(e.target.classList.contains("rv") ? "rv-in" : "vis"); io.unobserve(e.target); } }), { rootMargin: "0px 0px -8% 0px", threshold: 0.08 });
    const scan = () => el.querySelectorAll(".ws-tile, .ws-card, .ws-sec, .ws-kpi, .ws-bars, .ws-donut, .ws-chart").forEach((n) => {
      if (seen.has(n)) return; seen.add(n);
      const chart = n.matches(".ws-bars, .ws-donut, .ws-chart");
      if (!chart) { if (n.getBoundingClientRect().top < window.innerHeight * 0.95) return; n.classList.add("rv"); }
      io.observe(n);
    });
    scan(); const mo = new MutationObserver(() => scan()); mo.observe(el, { childList: true, subtree: true });
    return () => { io.disconnect(); mo.disconnect(); };
  }, [root, key]);
}
