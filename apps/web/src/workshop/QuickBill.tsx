import { useState } from "react";
import { t } from "../i18n";
import { can } from "../perms";
import { StockPicker } from "./StockPicker";
import { lkr, useCommand, useWs } from "./common";

type Line = { id: string; name: string; unit: string; price: number; qty: number };
type Inv = { id: string; invoice_number: string; total: number };
const METHODS: [string, string][] = [["CASH", "Cash"], ["CARD", "Card"], ["BANK", "Bank transfer"], ["OTHER", "Other"]];
const num = (v: string) => (v.trim() === "" ? 0 : Number(v.replace(/,/g, "")));

/** A bill without a repair job: a part sold over the counter, or a small paid job. One save: the stock goes down, the bill is made and the payment is taken. */
export function QuickBill() {
  const { go, business } = useWs();
  const command = useCommand();
  const [lines, setLines] = useState<Line[]>([]), [labour, setLabour] = useState<{ description: string; amount: string }[]>([]), [pick, setPick] = useState(false);
  const [customer, setCustomer] = useState(""), [phone, setPhone] = useState(""), [reg, setReg] = useState(""), [credit, setCredit] = useState(false), [paid, setPaid] = useState(""), [method, setMethod] = useState("CASH"), [discount, setDiscount] = useState("");
  const [busy, setBusy] = useState(false), [error, setError] = useState("");
  const parts = lines.reduce((a, l) => a + l.qty * l.price, 0), work = labour.reduce((a, l) => a + num(l.amount), 0), off = num(discount);
  const sub = Math.max(0, parts + work - off), tax = Math.round(sub * Number(business.tax_rate || 0)) / 100, total = sub + tax;
  const owing = credit ? Math.max(0, total - (paid.trim() === "" ? 0 : num(paid))) : 0;
  const ready = (lines.length > 0 || labour.some((l) => l.description.trim() && num(l.amount) > 0)) && (!credit || customer.trim().length > 0);
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!ready || busy) return;
    setBusy(true); setError("");
    const body = {
      lines: lines.map((l) => ({ productId: l.id, quantity: l.qty })),
      labour: labour.filter((l) => l.description.trim() && num(l.amount) > 0).map((l) => ({ description: l.description.trim(), amount: num(l.amount) })),
      customer: customer.trim() || undefined, phone: phone.trim() || undefined, registration: reg.trim() || undefined,
      invoice_type: credit ? "CREDIT" : "CASH", method, ...(credit ? { paid: paid.trim() === "" ? 0 : num(paid) } : {}), ...(off > 0 ? { discount: off } : {}),
    };
    try {
      const inv = await command<Inv>("/api/workshop/quick-bill", body);
      window.dispatchEvent(new Event("lifta:stock-changed"));
      go({ name: "invoice", id: inv.id }, inv.invoice_number + " " + t("is ready. Print it or send it to the customer."));
    } catch (x) { setError((x as Error).message); setBusy(false); }
  };
  return (
    <form className="ws-card ws-form" onSubmit={submit}>
      <h2>{t("Quick bill")}</h2>
      <p className="muted">{t("For a part sold over the counter or a small job. No repair job is needed.")}</p>
      <h3>{t("Parts")}</h3>
      {lines.map((l, i) => (
        <div className="ws-list-row" key={l.id}>
          <span className="ws-l-name"><b>{l.name}</b><small> × {l.qty} · LKR {lkr(l.price * l.qty)}</small></span>
          <button type="button" className="ws-l-del" aria-label={t("Remove")} onClick={() => setLines(lines.filter((_, k) => k !== i))}>×</button>
        </div>
      ))}
      <button type="button" className="button secondary small" onClick={() => setPick(true)}>+ {t("Pick from stock")}</button>
      <h3>{t("Labour")}</h3>
      {labour.map((l, i) => (
        <div className="ws-list-row" key={i}>
          <input className="ws-l-name" aria-label={t("What was done")} placeholder={t("What was done")} value={l.description} onChange={(e) => setLabour(labour.map((x, k) => (k === i ? { ...x, description: e.target.value } : x)))} />
          <input className="ws-l-price" aria-label={t("Amount")} inputMode="decimal" placeholder={t("Amount")} value={l.amount} onChange={(e) => setLabour(labour.map((x, k) => (k === i ? { ...x, amount: e.target.value } : x)))} />
          <button type="button" className="ws-l-del" aria-label={t("Remove")} onClick={() => setLabour(labour.filter((_, k) => k !== i))}>×</button>
        </div>
      ))}
      <button type="button" className="button secondary small" onClick={() => setLabour([...labour, { description: "", amount: "" }])}>+ {t("Labour")}</button>
      <h3>{t("Customer")}</h3>
      <div className="ws-grid2">
        <label className="ws-field">{t("Customer name")}{credit ? " *" : ""}<input value={customer} placeholder={t("Walk-in customer")} onChange={(e) => setCustomer(e.target.value)} /></label>
        <label className="ws-field">{t("Phone")}<input inputMode="tel" value={phone} onChange={(e) => setPhone(e.target.value)} /></label>
      </div>
      <label className="ws-field">{t("Vehicle number")} ({t("optional")})<input autoCapitalize="characters" value={reg} onChange={(e) => setReg(e.target.value)} placeholder="CAB-1234" /></label>
      <h3>{t("Payment")}</h3>
      <div className="ws-bar" role="group" aria-label={t("Payment")}>
        <button type="button" className={"button small " + (!credit ? "primary" : "secondary")} aria-pressed={!credit} onClick={() => setCredit(false)}>{t("Paid now")}</button>
        {can("bill") && <button type="button" className={"button small " + (credit ? "primary" : "secondary")} aria-pressed={credit} onClick={() => setCredit(true)}>{t("On credit")}</button>}
      </div>
      {credit && <label className="ws-field">{t("Paid so far")} (LKR)<input inputMode="decimal" value={paid} placeholder="0" onChange={(e) => setPaid(e.target.value)} /></label>}
      <label className="ws-field">{t("Paid by")}<select value={method} onChange={(e) => setMethod(e.target.value)}>{METHODS.map(([k, l]) => <option key={k} value={k}>{t(l)}</option>)}</select></label>
      <label className="ws-field">{t("Discount")} (LKR)<input inputMode="decimal" value={discount} onChange={(e) => setDiscount(e.target.value)} placeholder="0" /></label>
      <p className="ws-total"><b>{t("Total")}: LKR {lkr(total)}</b>{tax > 0 && <small> ({t("includes tax")} {lkr(tax)})</small>}{credit && <small> · {t("Customer owes")} LKR {lkr(owing)}</small>}</p>
      {error && <p role="alert" className="ws-err">{error}</p>}
      <div className="ws-actions"><button className="button primary" disabled={!ready || busy}>{busy ? t("Saving…") : credit ? t("Make the bill (on credit)") : t("Make the bill and take payment")}</button></div>
      {pick && <StockPicker taken={Object.fromEntries(lines.map((l) => [l.id, l.qty]))} confirmLabel={t("Add to bill")} onClose={() => setPick(false)}
        onPick={async (p, qty) => { setLines((x) => { const at = x.findIndex((l) => l.id === p.id); return at >= 0 ? x.map((l, k) => (k === at ? { ...l, qty: l.qty + qty } : l)) : [...x, { id: p.id, name: p.name, unit: p.unit, price: Number(p.selling_price), qty }]; }); setPick(false); }} />}
    </form>
  );
}
