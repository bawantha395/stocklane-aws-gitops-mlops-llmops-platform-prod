import { useState } from "react";
import { useCommand, useWs, num, type Business } from "./common";

export function Settings() {
  const { business, reloadBusiness } = useWs();
  const [f, setF] = useState({ ...business, tax_rate: String(business.tax_rate) });
  const [msg, setMsg] = useState(""), [error, setError] = useState(""), [busy, setBusy] = useState(false);
  const command = useCommand();
  const set = (k: keyof typeof f, v: string) => { setF((x) => ({ ...x, [k]: v })); setMsg(""); };
  const save = async (e: React.FormEvent) => {
    e.preventDefault(); setBusy(true); setError("");
    try { await command<Business>("/api/workshop/settings", { ...f, tax_rate: num(f.tax_rate) }, "PUT"); reloadBusiness(); setMsg("Saved. New invoices use these details; old invoices keep the details they were issued with."); }
    catch (err) { setError((err as Error).message); } finally { setBusy(false); }
  };
  return (
    <form className="ws-card ws-form" onSubmit={save}>
      <h2>Business details</h2>
      <p className="muted">Printed at the top of every invoice. English letters only.</p>
      <label className="ws-field">Business name *<input required value={f.name} onChange={(e) => set("name", e.target.value)} /></label>
      <label className="ws-field">Address<textarea rows={2} value={f.address} onChange={(e) => set("address", e.target.value)} placeholder={"12 Galle Road\nColombo 03"} /></label>
      <div className="ws-grid2">
        <label className="ws-field">Phone<input inputMode="tel" value={f.phone} onChange={(e) => set("phone", e.target.value)} /></label>
        <label className="ws-field">Email<input type="email" value={f.email} onChange={(e) => set("email", e.target.value)} /></label>
        <label className="ws-field">Registration or tax number<input value={f.reg_no} onChange={(e) => set("reg_no", e.target.value)} placeholder="VAT 123456789" /></label>
        <div className="ws-grid2 tight">
          <label className="ws-field">Tax name<input value={f.tax_name} onChange={(e) => set("tax_name", e.target.value)} /></label>
          <label className="ws-field">Tax rate %<input inputMode="decimal" value={f.tax_rate} onChange={(e) => set("tax_rate", e.target.value)} /></label>
        </div>
      </div>
      <p className="muted">Tax rate 0 means no tax line. A rate above 0 adds the tax to every new bill and prints "Tax invoice".</p>
      <label className="ws-field">Bank details for payments<textarea rows={3} value={f.bank} onChange={(e) => set("bank", e.target.value)} placeholder={"Bank of Ceylon\nAccount 1234567"} /></label>
      <label className="ws-field">Footer note<textarea rows={2} value={f.footer} onChange={(e) => set("footer", e.target.value)} /></label>
      {error && <p role="alert" className="stock-error">{error}</p>}
      {msg && <p className="stock-notice ws-notice" role="status">{msg}</p>}
      <div className="ws-actions"><button className="button primary large" disabled={busy}>{busy ? "Saving…" : "Save"}</button></div>
    </form>
  );
}
