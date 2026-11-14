import { t } from "../i18n";
import { toast } from "../ui";
import { useState, useEffect, useRef } from "react";
import { logoFromFile, resetLogo } from "../logoStore";
import { useLogo } from "../BizLogo";
import { Building2, FileText, Landmark, Percent, Wrench } from "lucide-react";
import QRCode from "qrcode";
import { BizLogo } from "../BizLogo";
import { hue } from "./Cards";
import { lkr, useCommand, useLoad, useWs, num, type Business } from "./common";

/** The QR as "N:" plus N*N zeros and ones, so the server can draw it in its PDF without a QR library. */
function qrBits(url?: string) {
  if (!url || !url.trim()) return "";
  try { const m = QRCode.create(url.trim(), { errorCorrectionLevel: "M" }).modules; let b = ""; for (let r = 0; r < m.size; r++) for (let c = 0; c < m.size; c++) b += m.get(r, c) ? "1" : "0"; return m.size + ":" + b; } catch { return ""; }
}

export function Settings() {
  const { business, reloadBusiness, owner } = useWs();
  const logo = useLogo(), fileRef = useRef<HTMLInputElement>(null), [logoBusy, setLogoBusy] = useState(false);
  const [f, setF] = useState({ ...business, qr_url: business.qr_url || "", tax_rate: String(business.tax_rate), mechanic_discount_pct: String(business.mechanic_discount_pct ?? 10), payment_terms_days: String(business.payment_terms_days ?? 0), warranty: business.warranty || "", invoice_prefix: business.invoice_prefix || "INV", default_reorder_level: String(business.default_reorder_level ?? 5), mechanics: [...(business.mechanics || [])], labour_items: (business.labour_items || []).map((l) => ({ description: l.description, amount: String(l.amount) })) });
  const [msg, setMsg] = useState(""), [error, setError] = useState(""), [busy, setBusy] = useState(false);
  useEffect(() => { if (msg) toast(msg); }, [msg]);
  const command = useCommand();
  const { data: dash } = useLoad<{ open_count: number; due_count: number; month: { billed: number; invoices: number } }>("/api/workshop/dashboard");
  const set = (k: keyof typeof f, v: string) => { setF((x) => ({ ...x, [k]: v })); setMsg(""); };
  const save = async (e: React.FormEvent) => {
    e.preventDefault(); setBusy(true); setError("");
    try { await command<Business>("/api/workshop/settings", { ...f, qr_bits: qrBits(f.qr_url), tax_rate: num(f.tax_rate), mechanic_discount_pct: num(f.mechanic_discount_pct), payment_terms_days: num(f.payment_terms_days), default_reorder_level: num(f.default_reorder_level), mechanics: f.mechanics.map((m) => m.trim()).filter(Boolean), labour_items: f.labour_items.filter((l) => l.description.trim()).map((l) => ({ description: l.description.trim(), amount: num(l.amount) })) }, "PUT"); reloadBusiness(); setMsg(t("Saved. New invoices use these details; old invoices keep the details they were issued with.")); }
    catch (err) { setError((err as Error).message); } finally { setBusy(false); }
  };
  const uploadLogo = async (file: File) => {
    setLogoBusy(true); setError("");
    try { const image = await logoFromFile(file); await command("/api/workshop/logo", { image }, "PUT"); resetLogo(); reloadBusiness(); setMsg(t("Logo saved.")); }
    catch (err) { setError((err as Error).message); toast((err as Error).message, { bad: true }); } finally { setLogoBusy(false); }
  };
  const removeLogo = async () => {
    if (!confirm(t("Remove the logo? Bills go back to the initials."))) return;
    setLogoBusy(true); setError("");
    try { await command("/api/workshop/logo", {}, "DELETE"); resetLogo(); reloadBusiness(); setMsg(t("Logo removed.")); }
    catch (err) { setError((err as Error).message); } finally { setLogoBusy(false); }
  };
  const lines = (f.address || "").split("\n").filter(Boolean);
  return (
    <form className="ws-set" onSubmit={save}>
      <section className="ws-set-hero" style={{ ["--h" as string]: hue(f.name || "x") }}>
        <span className="ws-set-cover" />
        <span className="ws-set-id">
          <span className="ws-set-logo"><BizLogo name={f.name || "Business"} size={72} /></span>
          <span className="ws-set-name"><strong>{f.name || t("Your business")}</strong><small>{[lines[0], f.phone].filter(Boolean).join(" · ") || t("Add your address and phone below")}</small></span>
        </span>
        <span className="ws-set-stats">
          <span><b>{dash ? dash.month.invoices : "-"}</b><small>{t("Invoices this month")}</small></span>
          <span><b>{dash ? "LKR " + lkr(dash.month.billed) : "-"}</b><small>{t("Billed this month")}</small></span>
          <span><b>{dash ? dash.open_count : "-"}</b><small>{t("Open jobs")}</small></span>
        </span>
      </section>

      <div className="ws-set-grid">
        <div className="ws-set-col">
          <section className="ws-sec">
            <h3><span className="ws-sec-ico"><Building2 size={18} /></span>{t("Business details")}</h3>
            <p className="muted">{t("Printed at the top of every invoice. English letters only.")}</p>
            <div className="ws-field">{t("Logo")}
              <div className="ws-logo-row">
                <BizLogo name={f.name || "Business"} size={56} />
                {owner && <span className="ws-bar">
                  <button type="button" className="button secondary small" disabled={logoBusy} onClick={() => fileRef.current?.click()}>{logo ? t("Change logo") : t("Upload logo")}</button>
                  {logo && <button type="button" className="button secondary small" disabled={logoBusy} onClick={() => void removeLogo()}>{t("Remove logo")}</button>}
                </span>}
                <input ref={fileRef} type="file" accept="image/*" hidden onChange={(e) => { const file = e.target.files?.[0]; e.target.value = ""; if (file) void uploadLogo(file); }} />
              </div>
              <small className="ws-hint">{t("Shows on the bill: top left, next to the business name. A square or wide picture works best.")}</small>
            </div>
            <label className="ws-field">{t("Business name")} *<input required value={f.name} onChange={(e) => set("name", e.target.value)} /></label>
            <small className="ws-hint">{t("Shows on the bill: top left, big.")}</small>
            <label className="ws-field">{t("Address")}<textarea rows={2} value={f.address} onChange={(e) => set("address", e.target.value)} placeholder={"12 Galle Road\nColombo 03"} /></label>
            <small className="ws-hint">{t("Shows on the bill: under the business name.")}</small>
            <div className="ws-grid2">
              <label className="ws-field">{t("Phone")}<input inputMode="tel" value={f.phone} onChange={(e) => set("phone", e.target.value)} /></label>
              <label className="ws-field">{t("Email")}<input type="email" value={f.email} onChange={(e) => set("email", e.target.value)} /></label>
            </div>
            <small className="ws-hint">{t("Shows on the bill: under the address.")}</small>
            <label className="ws-field">{t("Registration or tax number")}<input value={f.reg_no} onChange={(e) => set("reg_no", e.target.value)} placeholder="VAT 123456789" /></label>
            <small className="ws-hint">{t("Shows on the bill: under the phone number. Fill this if you are tax registered. Empty = bill says 'not a tax invoice'.")}</small>
          </section>
          <section className="ws-sec">
            <h3><span className="ws-sec-ico"><Percent size={18} /></span>{t("Tax and discount")}</h3>
            <div className="ws-grid2">
              <label className="ws-field">{t("Tax name")}<input value={f.tax_name} onChange={(e) => set("tax_name", e.target.value)} /></label>
              <label className="ws-field">{t("Tax rate %")}<input inputMode="decimal" value={f.tax_rate} onChange={(e) => set("tax_rate", e.target.value)} /></label>
            </div>
            <small className="ws-hint">{t("Shows on the bill: a tax line in the totals. Rate 0 = no tax line. A rate above 0 prints Tax invoice.")}</small>
            <label className="ws-field">{t("Mechanic discount limit (%)")}<input inputMode="decimal" value={f.mechanic_discount_pct} onChange={(e) => set("mechanic_discount_pct", e.target.value)} /></label>
            <small className="ws-hint">{t("Not printed. A mechanic can give a discount up to this percent of parts and labour (bill discount and line discounts together). More needs the owner. 0 = no discounts.")}</small>
          </section>
          <section className="ws-sec">
            <h3><span className="ws-sec-ico"><Wrench size={18} /></span>{t("Workshop")}</h3>
            <label className="ws-field">{t("Mechanics")}</label>
            {f.mechanics.map((m, i) => (
              <div className="ws-list-row" key={i}>
                <input aria-label={t("Mechanic name")} value={m} maxLength={60} onChange={(e) => setF((x) => ({ ...x, mechanics: x.mechanics.map((v, k) => (k === i ? e.target.value : v)) }))} />
                <button type="button" className="ws-l-del" aria-label={t("Remove")} onClick={() => setF((x) => ({ ...x, mechanics: x.mechanics.filter((_, k) => k !== i) }))}>×</button>
              </div>
            ))}
            {f.mechanics.length < 20 && <button type="button" className="button secondary small" onClick={() => setF((x) => ({ ...x, mechanics: [...x.mechanics, ""] }))}>{t("+ Add mechanic")}</button>}
            <small className="ws-hint">{t("Shows on the bill: Mechanic name under the vehicle. A job's Mechanic becomes a pick list. Names you remove stay on old jobs.")}</small>
            <label className="ws-field">{t("Quick labour list")}</label>
            {f.labour_items.map((l, i) => (
              <div className="ws-list-row" key={i}>
                <input aria-label={t("What was done")} placeholder={t("What was done")} value={l.description} maxLength={100} onChange={(e) => setF((x) => ({ ...x, labour_items: x.labour_items.map((v, k) => (k === i ? { ...v, description: e.target.value } : v)) }))} />
                <input className="ws-lr-amt" aria-label={t("Amount")} placeholder={t("Amount")} inputMode="decimal" value={l.amount} onChange={(e) => setF((x) => ({ ...x, labour_items: x.labour_items.map((v, k) => (k === i ? { ...v, amount: e.target.value.replace(/[^0-9.]/g, "") } : v)) }))} />
                <button type="button" className="ws-l-del" aria-label={t("Remove")} onClick={() => setF((x) => ({ ...x, labour_items: x.labour_items.filter((_, k) => k !== i) }))}>×</button>
              </div>
            ))}
            {f.labour_items.length < 30 && <button type="button" className="button secondary small" onClick={() => setF((x) => ({ ...x, labour_items: [...x.labour_items, { description: "", amount: "" }] }))}>{t("+ Add labour")}</button>}
            <small className="ws-hint">{t("Shows on the bill: as the labour line when you tap it on a job. Tap-to-add buttons on every job page.")}</small>
            <label className="ws-field">{t("Default reorder level for new parts")}<input inputMode="decimal" value={f.default_reorder_level} onChange={(e) => set("default_reorder_level", e.target.value)} /></label>
            <small className="ws-hint">{t("Not printed. A new part shows in Running low when its stock is at or below this number. You can still change it per part.")}</small>
          </section>
        </div>

        <div className="ws-set-col">
          <section className="ws-sec">
            <h3><span className="ws-sec-ico"><Landmark size={18} /></span>{t("Getting paid")}</h3>
            <label className="ws-field">{t("Bank details for payments")}<textarea rows={3} value={f.bank} onChange={(e) => set("bank", e.target.value)} placeholder={"Bank of Ceylon\nAccount 1234567"} /></label>
            <small className="ws-hint">{t("Shows on the bill: in the How to pay box.")}</small>
            <label className="ws-field">{t("Payment terms")}<select value={f.payment_terms_days} onChange={(e) => set("payment_terms_days", e.target.value)}><option value="0">{t("Due on receipt")}</option><option value="7">7 {t("days")}</option><option value="14">14 {t("days")}</option><option value="30">30 {t("days")}</option></select></label>
            <small className="ws-hint">{t("Shows on the bill: the Due date at the top right.")}</small>
            <label className="ws-field">{t("QR on the bill (optional)")}<input inputMode="url" value={f.qr_url || ""} onChange={(e) => set("qr_url", e.target.value)} placeholder="https://share.google/your-link" /></label>
            <small className="ws-hint">{t("Shows on the bill: a QR next to How to pay. Customer scans to leave a review or open your payment page.")}</small>
          </section>
          <section className="ws-sec">
            <h3><span className="ws-sec-ico"><FileText size={18} /></span>{t("Bill notes")}</h3>
            <label className="ws-field">{t("Bill number prefix")}<input value={f.invoice_prefix} maxLength={6} onChange={(e) => set("invoice_prefix", e.target.value.replace(/[^A-Za-z0-9]/g, "").toUpperCase())} /></label>
            <small className="ws-hint">{t("Shows on the bill: the start of every new bill number, for example")} {(f.invoice_prefix || "INV")}-20260101-AB12CD. {t("Old bills keep their numbers.")}</small>
            <label className="ws-field">{t("Warranty note")}<textarea rows={2} value={f.warranty} onChange={(e) => set("warranty", e.target.value)} placeholder="Parts warranty 30 days" /></label>
            <small className="ws-hint">{t("Shows on the bill: at the bottom, under Warranty.")}</small>
            <label className="ws-field">{t("Footer note")}<textarea rows={2} value={f.footer} onChange={(e) => set("footer", e.target.value)} /></label>
            <small className="ws-hint">{t("Shows on the bill: the last line, for example a thank you.")}</small>
          </section>
        </div>
      </div>

      {error && <p role="alert" className="stock-error">{error}</p>}
      
      <div className="ws-savebar"><button className="button primary large" disabled={busy}>{busy ? t("Saving…") : t("Save changes")}</button></div>
    </form>
  );
}
