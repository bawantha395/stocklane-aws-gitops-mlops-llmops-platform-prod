import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import { api } from "../api";

export type PageName = "home" | "jobs" | "vehicles" | "due" | "invoices" | "report" | "settings" | "new" | "job" | "vehicle" | "invoice";
export type Page = { name: PageName; id?: string; reg?: string };
export type Business = { name: string; address: string; phone: string; email: string; reg_no: string; bank: string; footer: string; tax_name: string; tax_rate: number };
export type Part = { name: string; quantity: number; unit_price: number };
export type Labour = { description: string; amount: number };
export type Job = {
  id: string; registration: string; vehicle_key: string; customer: string; phone: string; vehicle: string; odometer?: number; summary: string;
  mechanic: string; notes: string; status: "OPEN" | "INVOICED" | "CANCELLED"; revision: number; invoice_id?: string; invoice_number?: string;
  parts: Part[]; labour: Labour[]; discount: number; tax_rate?: number; parts_total: number; labour_total: number; subtotal: number; tax: number; total: number;
  next_service_date?: string; next_service_km?: number; created_at: string; lines?: number; age_days?: number;
};
export type Visit = {
  id: string; created_at: string; summary: string; status: string; odometer?: number; total: number; invoice_number?: string; invoice_id?: string;
  parts?: Part[]; labour?: Labour[]; mechanic?: string;
};
export type Vehicle = {
  id: string; registration: string; owner?: string; phone?: string; make?: string; notes?: string; last_km?: number; next_service_date?: string;
  next_service_km?: number; updated_at: string; reason?: string; history?: Visit[]; visits?: number; spent?: number; first_visit?: string | null; average_gap_days?: number | null;
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

const LABEL: Record<string, string> = { OPEN: "Open", INVOICED: "Invoiced", CANCELLED: "Cancelled", UNPAID: "Unpaid", PARTIAL: "Part paid", PAID: "Paid", VOID: "Void" };
export const Pill = ({ s }: { s: string }) => <span className={"ws-pill " + s.toLowerCase()}>{LABEL[s] || s}</span>;
export const Empty = ({ children }: { children: string }) => <div className="ws-empty">{children}</div>;
export const Loading = ({ error }: { error?: string }) => <p className={error ? "stock-error" : "stock-help"} role={error ? "alert" : undefined}>{error || "Loading…"}</p>;
