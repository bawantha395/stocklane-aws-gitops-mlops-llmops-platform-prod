import { t } from "../i18n";
import { askConfirm } from "../ui";
import { Rows, groupByPeriod } from "./Rows";
import { InvoiceCard } from "./Cards";
import { useEffect, useState } from "react";
import { Bill, autoPrintOn } from "./Bill";
import { downloadInvoicePdf, shareInvoicePdf } from "./invoicePdf";
import { printerConnected, receiptBytes, sendToPrinter } from "./printer";
import { DateChips, SummaryBar, cap, ALL, inRange, useSaved, type Range } from "./DateRange";
import { lateDays, Empty, Loading, Pill, dateOnly, lkr, num, today, useCommand, useLoad, useWs, waLink, type Invoice } from "./common";

type Row = Omit<Invoice, "payments" | "parts" | "labour">;

const days = (iso: string) => Math.max(0, Math.round((new Date(today()).getTime() - new Date(dateOnly(iso)).getTime()) / 86400000));

export function Invoices() {
  const { go } = useWs();
  const { data, error } = useLoad<Row[]>("/api/workshop/invoices");
  const [filter, setFilter] = useSaved("bills.status", "UNPAID"), [q, setQ] = useState(""), [range, setRange] = useSaved<Range>("bills.range", ALL);
  if (!data) return <Loading error={error} />;
  const owing = data.filter((i) => i.status === "UNPAID" || i.status === "PARTIAL");
  const refunded = data.filter((i) => i.status === "REFUNDED").length;
  const needle = q.trim().toLowerCase();
  const base = filter === "UNPAID" ? owing : filter === "PAID" ? data.filter((i) => i.status === "PAID") : filter === "REFUNDED" ? data.filter((i) => i.status === "REFUNDED") : data;
  const shown = base.filter((i) => inRange(i.created_at, range) && (!needle || (i.invoice_number + " " + i.registration + " " + i.customer + " " + (i.phone || "") + " " + (i.job_no || "") + " " + (i.chassis || "")).toLowerCase().includes(needle)));
  // rows: money still owed first, then one row per month (newest first); a search or a date filter shows a plain list
  const rows = shown.length > 0; // always rows (a search or a date filter just makes fewer rows)
  const newest = [...data].sort((a, b) => (b.created_at < a.created_at ? -1 : 1))[0];
  const owingShown = filter === "ALL" ? shown.filter((i) => i.status === "UNPAID" || i.status === "PARTIAL") : [];
  const groups = [...(owingShown.length ? [{ key: "owing", title: t("Not fully paid"), items: [...owingShown].sort((a, b) => (b.created_at < a.created_at ? -1 : 1)) }] : []), ...groupByPeriod(filter === "ALL" ? shown.filter((i) => !(i.status === "UNPAID" || i.status === "PARTIAL")) : shown, (i) => i.created_at, false)];
  return (
    <>
      <div className="ws-toolbar">
        <div className="ws-chips">
          {([["UNPAID", t("Not fully paid"), owing.length], ["PAID", t("Paid"), data.filter((i) => i.status === "PAID").length], ...(refunded > 0 || filter === "REFUNDED" ? [["REFUNDED", t("Refunded"), refunded]] : []), ["ALL", t("All"), data.length]] as [string, string, number][]).map(([k, label, n]) => (
            <button key={k} className={"ws-chip" + (filter === k ? " chosen" : "")} onClick={() => setFilter(k)}><b>{n}</b> {label}</button>
          ))}
        </div>
        <input aria-label="Search invoices" placeholder={t("Search invoice, vehicle or customer")} value={q} onChange={(e) => setQ(e.target.value)} />
      </div>
      {filter === "UNPAID" && <p className="ws-owed">{t("Customers owe")} <b>LKR {lkr(owing.reduce((s, i) => s + i.total - i.paid, 0))}</b></p>}
      <DateChips value={range} onChange={setRange} />
      <SummaryBar text={cap(t("bills")) + ": " + shown.length + " · LKR " + lkr(shown.reduce((s, i) => s + (i.status === "VOID" ? 0 : i.total), 0))} file="bills"
        rows={shown.map((i) => ({ Date: dateOnly(i.created_at), Invoice: i.invoice_number, "Vehicle no.": i.registration, Customer: i.customer, Status: i.status, "Job no.": i.job_no || "", "Invoice type": i.invoice_type || "", Chassis: i.chassis || "", "Total (LKR)": i.total, "Paid (LKR)": i.paid, "Owing (LKR)": i.status === "VOID" ? 0 : i.total - i.paid }))} />
      {rows ? (
        <Rows groups={groups} idOf={(i) => i.id} latest={newest?.id} render={(i) => <InvoiceCard i={i} age={days(i.created_at)} onOpen={() => go({ name: "invoice", id: i.id })} />} />
      ) : (
        <div className="ws-cards">{shown.map((i) => <InvoiceCard key={i.id} i={i} age={days(i.created_at)} onOpen={() => go({ name: "invoice", id: i.id })} />)}</div>
      )}
      <div className="ws-cards">
        {!shown.length && <Empty action={filter === "UNPAID" ? undefined : { label: t("Jobs"), onClick: () => go({ name: "jobs" }) }}>{filter === "UNPAID" ? "Everything is paid." : filter === "REFUNDED" ? t("No refunded bills.") : "No invoices yet. Open a job and press Create invoice. It will appear here."}</Empty>}
      </div>
    </>
  );
}

/** One Refund panel. Tick the parts that came back (they go into stock again, the bill goes down and any extra money paid is given back),
 *  or leave the parts empty and give an amount back without any parts. */
function ReturnParts({ inv, onClose, onDone }: { inv: Invoice; onClose: () => void; onDone: () => Promise<void> }) {
  const command = useCommand();
  const [qty, setQty] = useState<Record<number, string>>({}), [reason, setReason] = useState(""), [method, setMethod] = useState("CASH"), [amount, setAmount] = useState(""), [busy, setBusy] = useState(false), [err, setErr] = useState("");
  const left = (i: number) => num(inv.parts[i].quantity) - num((inv.parts[i] as { returned?: number }).returned);
  const picked = inv.parts.map((_, i) => ({ index: i, quantity: num(qty[i]) })).filter((r) => r.quantity > 0);
  const credit = picked.reduce((s, r) => s + (num(inv.parts[r.index].unit_price) * r.quantity * (100 - num(inv.parts[r.index].discount_pct))) / 100, 0) * (1 + num(inv.tax_rate) / 100);
  const hasParts = inv.parts.some((_, i) => left(i) > 0), paid = num(inv.paid);
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!picked.length && paid <= 0) { setErr(t("Pick the parts that came back")); return; }
    setBusy(true); setErr("");
    try {
      if (picked.length) await command("/api/workshop/invoices/" + inv.id + "/return", { lines: picked, reason, refundMethod: method });
      else await command("/api/workshop/invoices/" + inv.id + "/refund", { amount: num(amount || paid), method, reason });
      await onDone();
    } catch (x) { setErr((x as Error).message); setBusy(false); }
  };
  return (
    <form className="ws-card ws-pay ws-return" onSubmit={submit} data-tour="return-parts">
      <h3>{t("Refund")} <small>{inv.invoice_number}{paid > 0 ? " · " + t("Paid so far") + " LKR " + lkr(paid) : ""}</small></h3>
      {hasParts && <p className="muted">{t("Parts that came back: put the number here. They go back into stock by themselves and the bill goes down.")}</p>}
      {inv.parts.map((p, i) => left(i) > 0 && (
        <label className="ws-field ws-return-line" key={i}>
          <span>{p.name}{p.product_id ? "" : " (" + t("not from stock") + ")"} <small>{t("up to")} {left(i)}</small></span>
          <input inputMode="decimal" value={qty[i] || ""} placeholder="0" onChange={(e) => setQty((x) => ({ ...x, [i]: e.target.value }))} />
        </label>
      ))}
      {!picked.length && paid > 0 && (
        <>
          <p className="muted">{hasParts ? t("No parts came back? Give an amount back instead.") : t("After a full refund you can void this invoice and correct the job.")}</p>
          <label className="ws-field">{t("Amount (LKR)")}<input inputMode="decimal" value={amount} placeholder={String(paid)} onChange={(e) => setAmount(e.target.value)} /></label>
        </>
      )}
      <label className="ws-field">{t("Reason")} *<input required value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. Wrong part, customer cancelled" /></label>
      <label className="ws-field">{t("Given back by")}<select value={method} onChange={(e) => setMethod(e.target.value)}><option value="CASH">Cash</option><option value="CARD">Card</option><option value="BANK">Bank transfer</option><option value="OTHER">Other</option></select></label>
      {credit > 0 && <p className="ws-return-sum">{t("Bill goes down by about")} <b>LKR {lkr(credit)}</b></p>}
      {err && <p role="alert" className="stock-error">{err}</p>}
      <div className="ws-actions"><button type="button" className="button secondary" disabled={busy} onClick={onClose}>{t("Cancel")}</button><button className="button primary" disabled={busy || (!picked.length && paid <= 0)}>{picked.length ? t("Return to stock and refund") : t("Save refund")}</button></div>
    </form>
  );
}

export function InvoicePage({ id }: { id: string }) {
  const { go, owner, business } = useWs();
  const { data: inv, error: loadError, reload } = useLoad<Invoice>("/api/workshop/invoices/" + id);
  const [amount, setAmount] = useState(""), [method, setMethod] = useState("CASH"), [note, setNote] = useState("");
  const [returning, setReturning] = useState(false);
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
  const voidIt = async () => { if (await askConfirm("The job opens again so you can correct it.", { title: "Void this invoice?", confirm: "Void invoice", danger: true })) void run(async () => { await command("/api/workshop/invoices/" + id + "/void", {}); go({ name: "job", id: inv.job_id }, "Invoice voided. The job is open again."); }); };
  const shop = inv.business ? { ...business, ...inv.business } : business;
  const shareBill = () => void run(async () => {
    const msg = "Hello " + inv.customer + ", your invoice " + inv.invoice_number + " from " + shop.name + " is LKR " + lkr(inv.total) + (balance > 0 ? ", balance LKR " + lkr(balance) : ", paid in full") + ". Thank you.";
    // Phones with a share sheet send the PDF itself; otherwise open WhatsApp with the message.
    if (!(await shareInvoicePdf(inv, shop, msg))) window.open(waLink(inv.phone || "", msg), "_blank", "noopener");
  });
  const late = lateDays(inv, shop.payment_terms_days);
  return (
    <div>
      <section className={"ws-sum " + (inv.status === "PAID" ? "paid" : inv.status === "VOID" || inv.status === "REFUNDED" ? "void" : "owes")}>
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
        {(inv.status === "UNPAID" || inv.status === "PARTIAL") && <button data-tour="remind" className="button secondary small" disabled={!inv.phone} title={inv.phone ? "" : t("No phone number on this bill")} onClick={() => window.open(waLink(inv.phone || "", "Hello " + inv.customer + ", this is a reminder from " + shop.name + ": " + (inv.invoice_type === "INSURANCE" ? "the insurance claim bill " : "invoice ") + inv.invoice_number + " (" + inv.registration + ") has a balance of LKR " + lkr(balance) + (late > 0 ? ", " + late + " days past the due date" : "") + ". Thank you."), "_blank", "noopener")}>{late > 0 ? t("Remind") + " · " + t("Overdue") : t("Remind")}</button>}
        {owner && inv.status !== "VOID" && (num(inv.paid) > 0 || inv.parts.some((p) => num(p.quantity) > num((p as { returned?: number }).returned))) && <button data-tour="refund" className="button secondary small" disabled={busy} onClick={() => setReturning(!returning)}>{t("Refund")}</button>}
        {owner && inv.status !== "VOID" && num(inv.paid) === 0 && <button className="button secondary small" disabled={busy} onClick={voidIt}>{t("Void invoice")}</button>}
      </div>
      {error && <p role="alert" className="stock-error">{error}</p>}
      {returning && owner && <ReturnParts inv={inv} onClose={() => setReturning(false)} onDone={async () => { setReturning(false); await reload(); }} />}
      {!!inv.credits?.length && (
        <section className="ws-card ws-credits"><h3>{t("Returned parts")}</h3>
          {inv.credits.map((c) => <div key={c.id} className="ws-credit"><span>{dateOnly(c.at)} · {c.lines.map((l) => l.quantity + " x " + l.name).join(", ")} · {c.reason}</span><b>-{lkr(c.amount)}</b></div>)}
        </section>
      )}
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
        <Bill d={{ job_no: inv.job_no, chassis: inv.chassis, invoice_type: inv.invoice_type, business: shop, number: inv.invoice_number, date: dateOnly(inv.created_at), status: inv.status, customer: inv.customer, address: inv.address, phone: inv.phone, registration: inv.registration, vehicle: inv.vehicle,
          odometer: inv.odometer, mechanic: inv.mechanic, summary: inv.summary, parts: inv.parts, labour: inv.labour, discount: inv.discount, tax_name: inv.tax_name, tax_rate: inv.tax_rate, credit_total: inv.credit_total,
          payments: inv.payments, paid: inv.paid, next_service_date: inv.next_service_date, next_service_km: inv.next_service_km,
          brought_by: inv.brought_by, brought_phone: inv.brought_phone, warranty_until: inv.warranty_until, warranty_km: inv.warranty_km, warranty_job: inv.warranty_job }} />
      </div>
    </div>
  );
}
