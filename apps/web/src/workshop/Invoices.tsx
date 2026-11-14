import { t } from "../i18n";
import { InvoiceCard } from "./Cards";
import { useEffect, useState } from "react";
import { Bill, autoPrintOn } from "./Bill";
import { downloadInvoicePdf, shareInvoicePdf } from "./invoicePdf";
import { printerConnected, receiptBytes, sendToPrinter } from "./printer";
import { DateChips, SummaryBar, cap, ALL, inRange, useSaved, type Range } from "./DateRange";
import { Empty, Loading, Pill, dateOnly, lkr, num, today, useCommand, useLoad, useWs, waLink, type Invoice } from "./common";

type Row = Omit<Invoice, "payments" | "parts" | "labour">;

const days = (iso: string) => Math.max(0, Math.round((new Date(today()).getTime() - new Date(dateOnly(iso)).getTime()) / 86400000));

export function Invoices() {
  const { go } = useWs();
  const { data, error } = useLoad<Row[]>("/api/workshop/invoices");
  const [filter, setFilter] = useSaved("bills.status", "UNPAID"), [q, setQ] = useState(""), [range, setRange] = useSaved<Range>("bills.range", ALL);
  if (!data) return <Loading error={error} />;
  const owing = data.filter((i) => i.status === "UNPAID" || i.status === "PARTIAL");
  const needle = q.trim().toLowerCase();
  const base = filter === "UNPAID" ? owing : filter === "PAID" ? data.filter((i) => i.status === "PAID") : data;
  const shown = base.filter((i) => inRange(i.created_at, range) && (!needle || (i.invoice_number + " " + i.registration + " " + i.customer + " " + (i.phone || "")).toLowerCase().includes(needle)));
  return (
    <>
      <div className="ws-toolbar">
        <div className="ws-chips">
          {([["UNPAID", t("Not fully paid"), owing.length], ["PAID", t("Paid"), data.filter((i) => i.status === "PAID").length], ["ALL", t("All"), data.length]] as [string, string, number][]).map(([k, label, n]) => (
            <button key={k} className={"ws-chip" + (filter === k ? " chosen" : "")} onClick={() => setFilter(k)}><b>{n}</b> {label}</button>
          ))}
        </div>
        <input aria-label="Search invoices" placeholder={t("Search invoice, vehicle or customer")} value={q} onChange={(e) => setQ(e.target.value)} />
      </div>
      {filter === "UNPAID" && <p className="ws-owed">{t("Customers owe")} <b>LKR {lkr(owing.reduce((s, i) => s + i.total - i.paid, 0))}</b></p>}
      <DateChips value={range} onChange={setRange} />
      <SummaryBar text={cap(t("bills")) + ": " + shown.length + " · LKR " + lkr(shown.reduce((s, i) => s + (i.status === "VOID" ? 0 : i.total), 0))} file="bills"
        rows={shown.map((i) => ({ Date: dateOnly(i.created_at), Invoice: i.invoice_number, "Vehicle no.": i.registration, Customer: i.customer, Status: i.status, "Total (LKR)": i.total, "Paid (LKR)": i.paid, "Owing (LKR)": i.status === "VOID" ? 0 : i.total - i.paid }))} />
      <div className="ws-cards">
        {shown.map((i) => <InvoiceCard key={i.id} i={i} age={days(i.created_at)} onOpen={() => go({ name: "invoice", id: i.id })} />)}
        {!shown.length && <Empty action={filter === "UNPAID" ? undefined : { label: t("Jobs"), onClick: () => go({ name: "jobs" }) }}>{filter === "UNPAID" ? "Everything is paid." : "No invoices yet. Open a job and press Create invoice. It will appear here."}</Empty>}
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
  const shareBill = () => void run(async () => {
    const msg = "Hello " + inv.customer + ", your invoice " + inv.invoice_number + " from " + shop.name + " is LKR " + lkr(inv.total) + (balance > 0 ? ", balance LKR " + lkr(balance) : ", paid in full") + ". Thank you.";
    // Phones with a share sheet send the PDF itself; otherwise open WhatsApp with the message.
    if (!(await shareInvoicePdf(inv, shop, msg))) window.open(waLink(inv.phone || "", msg), "_blank", "noopener");
  });
  return (
    <div>
      <section className={"ws-sum " + (inv.status === "PAID" ? "paid" : inv.status === "VOID" ? "void" : "owes")}>
        <span className="ws-sum-top"><span className="ws-c-label">{t("Invoice")}</span><Pill s={inv.status} /></span>
        <strong className="ws-sum-num">{inv.invoice_number}</strong>
        <span className="ws-sum-who"><b className="ws-plate">{inv.registration}</b> {inv.customer}</span>
        <span className="ws-sum-bar" aria-hidden="true"><u style={{ width: Math.min(100, (num(inv.paid) / Math.max(1, num(inv.total))) * 100) + "%" }} /></span>
        <span className="ws-sum-nums"><span>{t("Paid")} <b>LKR {lkr(inv.paid)}</b></span><span className={balance > 0 ? "owes" : ""}>{balance > 0 ? t("Owes") : t("Total")} <b>LKR {lkr(balance > 0 ? balance : inv.total)}</b></span></span>
      </section>
      <div className="ws-bar">
        <button className="button primary small" onClick={() => void printNow()}>{t("Print")}</button>
        <button className="button secondary small" onClick={() => { try { downloadInvoicePdf(inv, shop); } catch (e) { setError((e as Error).message); } }}>{t("Download PDF")}</button>
        <button className="button secondary small" onClick={() => go({ name: "job", id: inv.job_id })}>{t("View job")}</button>
        <button className="button secondary small" onClick={() => go({ name: "vehicle", id: inv.registration.replace(/[^A-Za-z0-9]/g, "").toUpperCase() })}>{t("Vehicle file")}</button>
        <button className="button secondary small" disabled={busy} onClick={shareBill}>{t("Share bill")}</button>
        {owner && inv.status !== "VOID" && num(inv.paid) === 0 && <button className="button secondary small" disabled={busy} onClick={voidIt}>{t("Void invoice")}</button>}
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
          <div className="ws-actions"><button className="button primary" disabled={busy}>{t("Save payment")}</button></div>
        </form>
      )}
      <div className="ws-print">
        <Bill d={{ business: shop, number: inv.invoice_number, date: dateOnly(inv.created_at), status: inv.status, customer: inv.customer, address: inv.address, phone: inv.phone, registration: inv.registration, vehicle: inv.vehicle,
          odometer: inv.odometer, mechanic: inv.mechanic, summary: inv.summary, parts: inv.parts, labour: inv.labour, discount: inv.discount, tax_name: inv.tax_name, tax_rate: inv.tax_rate,
          payments: inv.payments, paid: inv.paid, next_service_date: inv.next_service_date, next_service_km: inv.next_service_km }} />
      </div>
    </div>
  );
}
