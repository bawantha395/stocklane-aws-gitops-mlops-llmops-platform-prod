import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import { api } from "../api";

export type PageName = "home" | "jobs" | "vehicles" | "due" | "invoices" | "archive" | "report" | "settings" | "new" | "job" | "vehicle" | "invoice";
export type Page = { name: PageName; id?: string; reg?: string };
export type Business = { name: string; address: string; phone: string; email: string; reg_no: string; bank: string; footer: string; tax_name: string; tax_rate: number; mechanic_discount_pct?: number };
export type Part = { name: string; quantity: number; unit_price: number };
export type Labour = { description: string; amount: number };
export type Job = {
  id: string; registration: string; vehicle_key: string; customer: string; phone: string; vehicle: string; odometer?: number; summary: string;
  mechanic: string; notes: string; status: "OPEN" | "INVOICED" | "CANCELLED" | "ARCHIVED"; revision: number; invoice_id?: string; invoice_number?: string;
  parts: Part[]; labour: Labour[]; discount: number; tax_rate?: number; parts_total: number; labour_total: number; subtotal: number; tax: number; total: number;
  next_service_date?: string; next_service_km?: number; created_at: string; lines?: number; age_days?: number;
  front_photo?: string; plate_photo?: string; before_photos?: string[]; photo_count?: number;
  delete_requested?: boolean; delete_request?: DeleteRequest; undo_seconds_left?: number; archive_reason?: string; archived_by?: string; archived_at?: string;
};
export type DeleteRequest = { job_id: string; registration: string; customer: string; reason: string; requested_by: string; requested_at: string; status: "PENDING" | "REJECTED"; note?: string; decided_by?: string };
export type Visit = {
  id: string; created_at: string; summary: string; status: string; odometer?: number; total: number; invoice_number?: string; invoice_id?: string;
  parts?: Part[]; labour?: Labour[]; mechanic?: string;
};
export type Vehicle = {
  id: string; registration: string; owner?: string; phone?: string; make?: string; notes?: string; last_km?: number; next_service_date?: string;
  next_service_km?: number; updated_at: string; reason?: string; history?: Visit[]; visits?: number; spent?: number; first_visit?: string | null; average_gap_days?: number | null;
  front_photo?: string; plate_photo?: string;
};
export type Payment = { id: string; amount: number; method: string; note: string; at: string };
export type Invoice = {
  id: string; invoice_number: string; job_id: string; registration: string; customer: string; phone?: string; vehicle?: string; odometer?: number; summary?: string; mechanic?: string;
  parts: Part[]; labour: Labour[]; parts_total: number; labour_total: number; discount: number; subtotal: number; tax: number; tax_name?: string; tax_rate: number; total: number;
  paid: number; status: "UNPAID" | "PARTIAL" | "PAID" | "VOID"; created_at: string; payments: Payment[]; currency: string; business?: Business;
  next_service_date?: string; next_service_km?: number;
};

export type Ctx = { owner: boolean; business: Business; go: (p: Page, notice?: string) => void; reloadBusiness: () => void };
export const WsContext = createContext<Ctx>(null as unknown as Ctx);
export const useWs = () => useContext(WsContext);

export const lkr = (n: number | string | undefined) => Number(n || 0).toLocaleString("en", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
export const kmText = (n?: number | null) => (n == null ? "-" : Number(n).toLocaleString("en") + " km");
export const dateOnly = (s: string) => new Date(s).toLocaleDateString("en-CA", { timeZone: "Asia/Colombo" });
export const today = () => dateOnly(new Date().toISOString());
export const addDays = (iso: string, n: number) => { const d = new Date(iso + "T00:00:00Z"); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
export const regKey = (s: string) => s.replace(/[^A-Za-z0-9]/g, "").toUpperCase();
export const num = (s: string | number) => (Number.isFinite(Number(s)) ? Number(s) : 0);
export const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;
/** WhatsApp click-to-chat link for a Sri Lankan number (07x becomes 947x). */
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

const LABEL: Record<string, string> = { OPEN: "Open", INVOICED: "Invoiced", CANCELLED: "Cancelled", ARCHIVED: "Deleted", UNPAID: "Unpaid", PARTIAL: "Part paid", PAID: "Paid", VOID: "Void" };
export const Pill = ({ s }: { s: string }) => <span className={"ws-pill " + s.toLowerCase()}>{LABEL[s] || s}</span>;
export const Empty = ({ children }: { children: string }) => <div className="ws-empty">{children}</div>;
export const Loading = ({ error }: { error?: string }) => <p className={error ? "stock-error" : "stock-help"} role={error ? "alert" : undefined}>{error || "Loading…"}</p>;

/** Asks for a reason (or a note) before a delete, a request or a rejection. */
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
