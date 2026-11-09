import { useEffect, useState } from "react";
import { Bill, autoPrintOn } from "./Bill";
import { downloadInvoicePdf } from "./invoicePdf";
import { printerConnected, receiptBytes, sendToPrinter } from "./printer";
import { Empty, Loading, Pill, dateOnly, lkr, num, today, useCommand, useLoad, useWs, waLink, type Invoice } from "./common";

type Row = Omit<Invoice, "payments" | "parts" | "labour">;

const days = (iso: string) => Math.max(0, Math.round((new Date(today()).getTime() - new Date(dateOnly(iso)).getTime()) / 86400000));

export function Invoices() {
  const { go } = useWs();
  const { data, error } = useLoad<Row[]>("/api/workshop/invoices");
  const [filter, setFilter] = useState("UNPAID"), [q, setQ] = useState("");
  if (!data) return <Loading error={error} />;
  const owing = data.filter((i) => i.status === "UNPAID" || i.status === "PARTIAL");
  const needle = q.trim().toLowerCase();
  const base = filter === "UNPAID" ? owing : filter === "PAID" ? data.filter((i) => i.status === "PAID") : data;
  const shown = base.filter((i) => !needle || (i.invoice_number + " " + i.registration + " " + i.customer + " " + (i.phone || "")).toLowerCase().includes(needle));
  return (
    <>
      <div className="ws-toolbar">
        <div className="ws-chips">
          {([["UNPAID", "Not fully paid", owing.length], ["PAID", "Paid", data.filter((i) => i.status === "PAID").length], ["ALL", "All", data.length]] as [string, string, number][]).map(([k, label, n]) => (
            <button key={k} className={"ws-chip" + (filter === k ? " chosen" : "")} onClick={() => setFilter(k)}><b>{n}</b> {label}</button>
          ))}
        </div>
        <input aria-label="Search invoices" placeholder="Search invoice, vehicle or customer" value={q} onChange={(e) => setQ(e.target.value)} />
      </div>
      {filter === "UNPAID" && <p className="ws-owed">Customers owe <b>LKR {lkr(owing.reduce((s, i) => s + i.total - i.paid, 0))}</b></p>}
      <div className="ws-list">
        {shown.map((i) => (
          <button className="ws-item" key={i.id} onClick={() => go({ name: "invoice", id: i.id })}>
            <span className="ws-item-main"><strong>{i.registration}</strong><span>{i.customer}</span><small>{i.invoice_number} · {dateOnly(i.created_at)}</small></span>
            <span className="ws-item-side"><b>{lkr(i.total)}</b><Pill s={i.status} />{(i.status === "UNPAID" || i.status === "PARTIAL") && <small>Owes {lkr(i.total - i.paid)}{days(i.created_at) > 7 ? ", " + days(i.created_at) + " d" : ""}</small>}</span>
          </button>
        ))}
        {!shown.length && <Empty>{filter === "UNPAID" ? "Everything is paid." : "No invoices."}</Empty>}
      </div>
    </>
  );
}

export function InvoicePage({ id }: { id: string }) {
  const { go, owner, business } = useWs();
  const { data: inv, error: loadError, reload } = useLoad<Invoice>("/api/workshop/invoices/" + id);
  const [amount, setAmount] = useState(""), [method, setMethod] = useState("CASH"), [note, setNote] = useState("");
  const [error, setError] = useState(""), [busy, setBusy] = useState(false);
  const command = useCommand();
  /** One Print action. A connected thermal printer prints straight away. Otherwise the browser print preview opens, and it lays the bill out for whatever paper is chosen (A4 or a narrow roll). */
  const printNow = async () => {
    if (!inv) return;
    if (printerConnected()) {
      try { await sendToPrinter(receiptBytes(inv, inv.business ? { ...business, ...inv.business } : business)); return; }
      catch (e) { setError((e as Error).message + " The print preview was opened instead."); }
    }
    window.print();
  };
  const ready = !!inv;
  useEffect(() => {
    if (!ready) return;
    let fresh = false;
    try { fresh = sessionStorage.getItem("ws.print") === id; if (fresh) sessionStorage.removeItem("ws.print"); } catch { /* ignore */ }
    if (fresh && autoPrintOn()) { const t = setTimeout(() => void printNow(), 400); return () => clearTimeout(t); }
  }, [ready, id]);
  if (!inv) return <Loading error={loadError} />;
  const balance = num(inv.total) - num(inv.paid);
  const run = async (work: () => Promise<void>) => { setBusy(true); setError(""); try { await work(); } catch (e) { setError((e as Error).message); } finally { setBusy(false); } };
  const pay = (e: React.FormEvent) => { e.preventDefault(); void run(async () => { await command("/api/workshop/invoices/" + id + "/payments", { amount: num(amount || balance), method, note }); setAmount(""); setNote(""); await reload(); if (autoPrintOn()) setTimeout(() => void printNow(), 400); }); };
  const voidIt = () => { if (confirm("Void this invoice? The job opens again so you can correct it.")) void run(async () => { await command("/api/workshop/invoices/" + id + "/void", {}); go({ name: "job", id: inv.job_id }, "Invoice voided. The job is open again."); }); };
  const shop = inv.business ? { ...business, ...inv.business } : business;
  return (
    <div>
      <div className="ws-bar">
        <button className="button primary small" onClick={() => void printNow()}>Print</button>
        <button className="button secondary small" onClick={() => { try { downloadInvoicePdf(inv, shop); } catch (e) { setError((e as Error).message); } }}>Download PDF</button>
        <button className="button secondary small" onClick={() => go({ name: "job", id: inv.job_id })}>View job</button>
        <button className="button secondary small" onClick={() => go({ name: "vehicle", id: inv.registration.replace(/[^A-Za-z0-9]/g, "").toUpperCase() })}>Vehicle file</button>
        {inv.phone && <a className="button secondary small" target="_blank" rel="noreferrer" href={waLink(inv.phone, "Hello " + inv.customer + ", your invoice " + inv.invoice_number + " from " + shop.name + " is LKR " + lkr(inv.total) + (balance > 0 ? ", balance LKR " + lkr(balance) : ", paid in full") + ". Thank you.")}>WhatsApp</a>}
        {owner && inv.status !== "VOID" && num(inv.paid) === 0 && <button className="button secondary small" disabled={busy} onClick={voidIt}>Void invoice</button>}
      </div>
      {error && <p role="alert" className="stock-error">{error}</p>}
      {inv.status !== "VOID" && balance > 0 && (
        <form className="ws-card ws-pay" onSubmit={pay}>
          <h3>Take a payment <small>Balance LKR {lkr(balance)}</small></h3>
          <div className="ws-grid2">
            <label className="ws-field">Amount (LKR)<input inputMode="decimal" value={amount} placeholder={String(balance)} onChange={(e) => setAmount(e.target.value)} /></label>
            <label className="ws-field">Paid by<select value={method} onChange={(e) => setMethod(e.target.value)}><option value="CASH">Cash</option><option value="CARD">Card</option><option value="BANK">Bank transfer</option><option value="OTHER">Other</option></select></label>
          </div>
          <label className="ws-field">Note<input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Optional, e.g. advance" /></label>
          <div className="ws-actions"><button className="button primary" disabled={busy}>Save payment</button></div>
        </form>
      )}
      <div className="ws-print">
        <Bill d={{ business: shop, number: inv.invoice_number, date: dateOnly(inv.created_at), status: inv.status, customer: inv.customer, phone: inv.phone, registration: inv.registration, vehicle: inv.vehicle,
          odometer: inv.odometer, mechanic: inv.mechanic, summary: inv.summary, parts: inv.parts, labour: inv.labour, discount: inv.discount, tax_name: inv.tax_name, tax_rate: inv.tax_rate,
          payments: inv.payments, paid: inv.paid, next_service_date: inv.next_service_date, next_service_km: inv.next_service_km }} />
      </div>
    </div>
  );
}
