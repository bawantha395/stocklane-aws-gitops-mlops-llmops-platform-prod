import { t } from "../i18n";
import { toast } from "../ui";
import { useState, useEffect } from "react";
import { Building2, FileText, Percent } from "lucide-react";
import { BizLogo } from "../BizLogo";
import { hue } from "./Cards";
import { lkr, useCommand, useLoad, useWs, num, type Business } from "./common";

export function Settings() {
  const { business, reloadBusiness } = useWs();
  const [f, setF] = useState({ ...business, tax_rate: String(business.tax_rate), mechanic_discount_pct: String(business.mechanic_discount_pct ?? 10) });
  const [msg, setMsg] = useState(""), [error, setError] = useState(""), [busy, setBusy] = useState(false);
  useEffect(() => { if (msg) toast(msg); }, [msg]);
  useEffect(() => { if (msg) toast(msg); }, [msg]);
  const command = useCommand();
  const { data: dash } = useLoad<{ open_count: number; due_count: number; month: { billed: number; invoices: number } }>("/api/workshop/dashboard");
  const set = (k: keyof typeof f, v: string) => { setF((x) => ({ ...x, [k]: v })); setMsg(""); };
  const save = async (e: React.FormEvent) => {
    e.preventDefault(); setBusy(true); setError("");
    try { await command<Business>("/api/workshop/settings", { ...f, tax_rate: num(f.tax_rate), mechanic_discount_pct: num(f.mechanic_discount_pct) }, "PUT"); reloadBusiness(); setMsg(t("Saved. New invoices use these details; old invoices keep the details they were issued with.")); }
    catch (err) { setError((err as Error).message); } finally { setBusy(false); }
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
            <label className="ws-field">{t("Business name")} *<input required value={f.name} onChange={(e) => set("name", e.target.value)} /></label>
            <label className="ws-field">{t("Address")}<textarea rows={2} value={f.address} onChange={(e) => set("address", e.target.value)} placeholder={"12 Galle Road\nColombo 03"} /></label>
            <div className="ws-grid2">
              <label className="ws-field">{t("Phone")}<input inputMode="tel" value={f.phone} onChange={(e) => set("phone", e.target.value)} /></label>
              <label className="ws-field">{t("Email")}<input type="email" value={f.email} onChange={(e) => set("email", e.target.value)} /></label>
            </div>
          </section>
          <section className="ws-sec">
            <h3><span className="ws-sec-ico"><Percent size={18} /></span>{t("Tax and discount")}</h3>
            <div className="ws-grid2">
              <label className="ws-field">{t("Tax name")}<input value={f.tax_name} onChange={(e) => set("tax_name", e.target.value)} /></label>
              <label className="ws-field">{t("Tax rate %")}<input inputMode="decimal" value={f.tax_rate} onChange={(e) => set("tax_rate", e.target.value)} /></label>
            </div>
            <p className="muted">{t("Tax rate 0 means no tax line. A rate above 0 adds the tax to every new bill and prints Tax invoice.")}</p>
            <label className="ws-field">{t("Mechanic discount limit (%)")}<input inputMode="decimal" value={f.mechanic_discount_pct} onChange={(e) => set("mechanic_discount_pct", e.target.value)} /></label>
            <p className="muted">{t("A mechanic can give a discount up to this percent of parts and labour. Anything higher needs the owner. 0 means mechanics cannot give discounts.")}</p>
          </section>
        </div>

        <div className="ws-set-col">
          <section className="ws-sec">
            <h3><span className="ws-sec-ico"><FileText size={18} /></span>{t("Invoice header")} <em className="ws-live">{t("Live preview")}</em></h3>
            <div className="ws-prev" aria-label="Invoice preview">
              <span className="ws-prev-top">
                <span><b>{f.name || t("Your business")}</b>{lines.map((l) => <small key={l}>{l}</small>)}{f.reg_no && <small>{f.reg_no}</small>}</span>
                <span className="ws-prev-no"><small>{Number(f.tax_rate) > 0 ? t("TAX INVOICE") : t("INVOICE")}</small><b>INV-0042</b></span>
              </span>
              <span className="ws-prev-row"><span>{t("Oil filter")} x1</span><span>1,800</span></span>
              <span className="ws-prev-row"><span>{t("Labour")}</span><span>2,500</span></span>
              <span className="ws-prev-row tot"><span>{t("Total")}</span><span>LKR 4,300</span></span>
              {f.bank && <small className="ws-prev-foot">{f.bank.split("\n")[0]}</small>}
              {f.footer && <small className="ws-prev-foot">{f.footer}</small>}
            </div>
            <label className="ws-field">{t("Registration or tax number")}<input value={f.reg_no} onChange={(e) => set("reg_no", e.target.value)} placeholder="VAT 123456789" /></label>
            <label className="ws-field">{t("Bank details for payments")}<textarea rows={3} value={f.bank} onChange={(e) => set("bank", e.target.value)} placeholder={"Bank of Ceylon\nAccount 1234567"} /></label>
            <label className="ws-field">{t("Footer note")}<textarea rows={2} value={f.footer} onChange={(e) => set("footer", e.target.value)} /></label>
          </section>
        </div>
      </div>

      {error && <p role="alert" className="stock-error">{error}</p>}
      
      <div className="ws-savebar"><button className="button primary large" disabled={busy}>{busy ? t("Saving…") : t("Save changes")}</button></div>
    </form>
  );
}
