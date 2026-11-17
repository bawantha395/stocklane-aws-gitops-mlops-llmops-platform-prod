import { useEffect, useState } from "react";
import { api, openPdf } from "./api";
import { can } from "./perms";
import { t } from "./i18n";
import { toast } from "./ui";
import { Empty, Loading, dateOnly, kmText, lkr, useCommand, useDebounced, useLoad } from "./workshop/common";

export type Supplier = { id: string; name: string; kind: "MAIN" | "LOCAL"; phone: string; whatsapp: string; credit_days: number; active: boolean; parts: number; updated_at: string };
type Full = Supplier & { address?: string; notes?: string; revision: number; deliveries: { id: string; doc_no?: string; created_at: string; reference?: string; lines: number; quantity: number; cost?: number; unknown?: number }[]; delivery_count: number;
  parts: { id: string; name: string; sku: string; quantity: number; unit: string; location: string; last_cost?: number | null }[]; bought?: number; last_delivery: string | null };

type Summary = { total: number; overdue: number; suppliers: { id: string; name: string; balance: number; overdue: number; oldest_overdue_days: number; bills: number }[] };
type Books = { supplier: { id: string; name: string; credit_days: number }; balance: number; open: number; overdue: number; oldest_overdue_days: number; incomplete: number;
  bills: { id: string; doc_no?: string; created_at: string; reference?: string; amount: number; open: number; due: string; overdue_days: number; unknown: number }[];
  returns: { id: string; doc_no?: string; created_at: string; reference?: string; reason?: string; amount: number }[];
  payments: { id: string; amount: number; method: string; note?: string; at: string; by?: string; voided?: boolean; voided_reason?: string }[] };
const kindLabel = (k: string) => (k === "LOCAL" ? t("Local shop") : t("Main supplier"));
const newKey = () => (typeof crypto.randomUUID === "function" ? crypto.randomUUID() : Date.now().toString(36) + Math.random().toString(36).slice(2) + Math.random().toString(36).slice(2));

// one shared list, loaded when first needed and again after a supplier is added or changed
let cache: Promise<Supplier[]> | null = null;
export const forgetSuppliers = () => { cache = null; window.dispatchEvent(new Event("lifta:suppliers")); };
export function useSuppliers() {
  const [list, setList] = useState<Supplier[] | null>(null), [denied, setDenied] = useState(false);
  useEffect(() => {
    let live = true;
    const load = () => {
      if (!can("suppliers_view")) { setDenied(true); return; }
      cache = cache || api<Supplier[]>("/api/inventory/suppliers").catch((e) => { cache = null; throw e; });
      cache.then((l) => live && setList(l)).catch(() => live && setDenied(true));
    };
    load();
    window.addEventListener("lifta:suppliers", load);
    return () => { live = false; window.removeEventListener("lifta:suppliers", load); };
  }, []);
  return { list, denied };
}

/** Pick a supplier from the list (or add one). Without permission to see the list it falls back to typing the name, as before. */
export function SupplierPick({ id, name, onChange, kind, disabled, label, hint }: { id: string; name: string; onChange: (v: { id: string; name: string }) => void; kind?: "LOCAL" | "MAIN"; disabled?: boolean; label?: string; hint?: string }) {
  const { list, denied } = useSuppliers();
  const [adding, setAdding] = useState(false), [f, setF] = useState({ name: "", phone: "" }), [busy, setBusy] = useState(false), [err, setErr] = useState("");
  const shown = (list || []).filter((s) => !kind || s.kind === kind || s.id === id);
  const legacy = !id && name.trim() !== "";
  if (denied && !list) return <label className="ws-field">{label || t("Supplier")}<input value={name} maxLength={100} disabled={disabled} onChange={(e) => onChange({ id: "", name: e.target.value })} /></label>;
  const add = async () => {
    setBusy(true); setErr("");
    try {
      const made = await api<Supplier>("/api/inventory/suppliers", { method: "POST", body: JSON.stringify({ name: f.name, phone: f.phone, kind: kind || "MAIN", allow_same_phone: true }) }, newKey());
      forgetSuppliers(); onChange({ id: made.id, name: made.name }); setAdding(false); setF({ name: "", phone: "" });
    } catch (e) { setErr((e as Error).message); } finally { setBusy(false); }
  };
  return (
    <div className="ws-field sup-pick">
      <span>{label || t("Supplier")}</span>
      <div className="sup-pick-row">
        <select aria-label={label || t("Supplier")} disabled={disabled || !list} value={id || (legacy ? "__typed" : "")} onChange={(e) => { const s = (list || []).find((x) => x.id === e.target.value); onChange(s ? { id: s.id, name: s.name } : e.target.value === "__typed" ? { id: "", name } : { id: "", name: "" }); }}>
          <option value="">{t("Not chosen")}</option>
          {legacy && <option value="__typed">{name} ({t("not in the list")})</option>}
          {shown.map((s) => <option key={s.id} value={s.id}>{s.name}{s.kind === "LOCAL" && !kind ? " · " + t("local") : ""}</option>)}
        </select>
        {can("suppliers_edit") && <button type="button" className="button secondary small" disabled={disabled} onClick={() => setAdding(!adding)}>+ {t("Add")}</button>}
      </div>
      {list && shown.length === 0 && !adding && <small className="muted">{kind === "LOCAL" ? t("No local shops in the list yet.") : t("No suppliers in the list yet.")}</small>}
      {hint && <small className="muted">{hint}</small>}
      {adding && (
        <div className="sup-add">
          <input aria-label={t("Supplier name")} placeholder={t("Supplier name")} value={f.name} maxLength={100} onChange={(e) => setF({ ...f, name: e.target.value })} />
          <input aria-label={t("Phone")} placeholder={t("Phone")} inputMode="tel" value={f.phone} onChange={(e) => setF({ ...f, phone: e.target.value })} />
          <button type="button" className="button primary small" disabled={busy || !f.name.trim()} onClick={() => void add()}>{t("Save")}</button>
          {err && <small className="stock-error" role="alert">{err}</small>}
        </div>
      )}
    </div>
  );
}

export function Suppliers() {
  const [open, setOpen] = useState<string | null>(null);
  if (open) return <SupplierPage id={open} onBack={() => setOpen(null)} />;
  return <SupplierList onOpen={setOpen} />;
}

function SupplierList({ onOpen }: { onOpen: (id: string) => void }) {
  const [q, setQ] = useState(""), [kind, setKind] = useState(""), [old, setOld] = useState(false);
  const term = useDebounced(q.trim());
  const owing = useLoad<Summary>(can("supplier_pay") ? "/api/inventory/payables" : null).data;
  const owed = new Map((owing?.suppliers || []).map((r) => [r.id, r]));
  const { data, error } = useLoad<Supplier[]>("/api/inventory/suppliers?search=" + encodeURIComponent(term) + (kind ? "&kind=" + kind : "") + (old ? "&inactive=1" : ""));
  return (
    <section className="ws">
      <div className="ws-top"><div><h1 className="ws-large">{t("Suppliers")}</h1></div>{can("suppliers_edit") && <div className="ws-top-actions"><button className="button primary" onClick={() => onOpen("new")}>+ {t("New supplier")}</button></div>}</div>
      <p className="ws-help">{t("Who you buy parts from. Pick them when a delivery comes in, on a part, and when you buy a part outside.")}</p>
      <div className="ws-toolbar">
        <input aria-label={t("Search suppliers")} placeholder={t("Search name or phone")} value={q} onChange={(e) => setQ(e.target.value)} />
        <div className="ws-seg">{([["", t("All")], ["MAIN", t("Main suppliers")], ["LOCAL", t("Local shops")]] as [string, string][]).map(([k, l]) => <button key={k} type="button" className={kind === k ? "on" : ""} aria-pressed={kind === k} onClick={() => setKind(k)}>{l}</button>)}</div>
        <label className="ws-check"><input type="checkbox" checked={old} onChange={(e) => setOld(e.target.checked)} /> {t("Show closed suppliers")}</label>
      </div>
      {owing && owing.total > 0 && <p className="ws-owed-total">{t("Owed to suppliers")}: <b>LKR {lkr(owing.total)}</b>{owing.overdue > 0 && <span className="ws-debt"> · {t("Overdue")} LKR {lkr(owing.overdue)}</span>}</p>}
      {!data ? <Loading error={error} /> : data.length === 0 ? <Empty>{term ? "No supplier matches." : "No suppliers yet. Add the shops and companies you buy parts from."}</Empty> : (
        <div className="ws-cust-list">
          {data.map((s) => (
            <button key={s.id} className={"ws-cust" + (s.active ? "" : " closed")} onClick={() => onOpen(s.id)}>
              <span className="ws-cust-main"><strong>{s.name}</strong><small>{s.phone || "-"}{s.credit_days ? " · " + s.credit_days + " " + t("days credit") : ""}</small></span>
              <span className="ws-cust-side"><small>{kindLabel(s.kind)}</small><small>{s.parts} {t("parts")}</small>{owed.get(s.id) && owed.get(s.id)!.balance > 0 && <small className={owed.get(s.id)!.overdue > 0 ? "ws-debt" : ""}>{t("Owed")} {lkr(owed.get(s.id)!.balance)}</small>}</span>
            </button>
          ))}
        </div>
      )}
    </section>
  );
}

function SupplierPage({ id, onBack }: { id: string; onBack: () => void }) {
  const fresh = id === "new";
  const { data: s, error, reload } = useLoad<Full>(fresh ? null : "/api/inventory/suppliers/" + id);
  const [edit, setEdit] = useState(fresh), [msg, setMsg] = useState(""), [again, setAgain] = useState(false);
  const [f, setF] = useState({ name: "", kind: "MAIN", phone: "", whatsapp: "", address: "", credit_days: "0", notes: "" });
  const command = useCommand();
  const set = (k: keyof typeof f, v: string) => { setF((x) => ({ ...x, [k]: v })); setAgain(false); };
  if (!fresh && !s) return <section className="ws"><button className="button secondary small" onClick={onBack}>‹ {t("Back")}</button><Loading error={error} /></section>;
  const startEdit = () => { if (!s) return; setF({ name: s.name, kind: s.kind, phone: s.phone || "", whatsapp: s.whatsapp || "", address: s.address || "", credit_days: String(s.credit_days || 0), notes: s.notes || "" }); setEdit(true); setMsg(""); };
  const save = async (e: React.FormEvent) => {
    e.preventDefault(); setMsg("");
    const body = { ...f, credit_days: f.credit_days === "" ? 0 : Number(f.credit_days), ...(again ? { allow_same_phone: true } : {}) };
    try {
      if (fresh) { await command("/api/inventory/suppliers", body); forgetSuppliers(); toast(t("Supplier saved.")); onBack(); return; }
      await command("/api/inventory/suppliers/" + id, { ...body, revision: s!.revision }, "PATCH"); forgetSuppliers(); setEdit(false); await reload();
    } catch (err) { const m = (err as Error).message; setMsg(m); if (/already has this number/.test(m)) setAgain(true); }
  };
  const flip = async () => { try { await command("/api/inventory/suppliers/" + id, { active: !s!.active, revision: s!.revision }, "PATCH"); forgetSuppliers(); await reload(); } catch (err) { setMsg((err as Error).message); } };
  if (edit) {
    return (
      <section className="ws">
        <form className="ws-card ws-form" onSubmit={save}>
          <h2>{fresh ? t("New supplier") : t("Edit supplier")}</h2>
          <div className="ws-grid2">
            <label className="ws-field">{t("Supplier name")} *<input required value={f.name} maxLength={100} onChange={(e) => set("name", e.target.value)} /></label>
            <label className="ws-field">{t("Phone")}<input inputMode="tel" value={f.phone} onChange={(e) => set("phone", e.target.value)} /></label>
            <label className="ws-field">WhatsApp <small>({t("if different")})</small><input inputMode="tel" value={f.whatsapp} onChange={(e) => set("whatsapp", e.target.value)} /></label>
            <label className="ws-field">{t("Credit days")}<input inputMode="numeric" value={f.credit_days} onChange={(e) => set("credit_days", e.target.value.replace(/\D/g, ""))} /></label>
            <label className="ws-field">{t("Address")}<textarea rows={2} value={f.address} onChange={(e) => set("address", e.target.value)} /></label>
            <label className="ws-field">{t("Notes")}<textarea rows={2} value={f.notes} onChange={(e) => set("notes", e.target.value)} /></label>
          </div>
          <div className="ws-field" role="group" aria-label={t("Supplier type")}>{t("Supplier type")}
            <div className="ws-seg">{([["MAIN", t("Main supplier")], ["LOCAL", t("Local shop")]] as [string, string][]).map(([k, l]) => <button type="button" key={k} className={f.kind === k ? "on" : ""} aria-pressed={f.kind === k} onClick={() => set("kind", k)}>{l}</button>)}</div>
            <small className="muted">{t("Local shops are the ones you buy a single part from when it is not in stock.")}</small>
          </div>
          {msg && <p className="stock-error" role="alert">{msg}</p>}
          <div className="ws-bar"><button className="button primary" type="submit">{again ? t("Save anyway") : t("Save")}</button><button type="button" className="button secondary" onClick={() => (fresh ? onBack() : setEdit(false))}>{t("Cancel")}</button></div>
        </form>
      </section>
    );
  }
  if (!s) return null;
  return (
    <section className="ws">
      <div className="ws-crumbs"><button onClick={onBack}>‹ {t("Back")}</button><span>{t("Suppliers")}</span></div>
      <div className="ws-card">
        <div className="ws-section-head"><h2>{s.name}{!s.active && <small> · {t("Closed")}</small>}</h2><span className="ws-pill">{kindLabel(s.kind)}</span></div>
        <dl className="ws-cust-facts">
          <div><dt>{t("Phone")}</dt><dd>{s.phone || "-"}{s.whatsapp ? " · WhatsApp " + s.whatsapp : ""}</dd></div>
          {s.address && <div><dt>{t("Address")}</dt><dd>{s.address}</dd></div>}
          <div><dt>{t("Credit days")}</dt><dd>{s.credit_days || t("Pays on delivery")}</dd></div>
          {s.notes && <div><dt>{t("Notes")}</dt><dd>{s.notes}</dd></div>}
          <div><dt>{t("Deliveries")}</dt><dd>{s.delivery_count}{s.last_delivery ? " · " + t("last") + " " + dateOnly(s.last_delivery) : ""}</dd></div>
          {s.bought !== undefined && <div><dt>{t("Bought in total")}</dt><dd>LKR {lkr(s.bought)}</dd></div>}
        </dl>
        <div className="ws-bar">
          {s.phone && <a className="button secondary small" href={"tel:" + s.phone}>{t("Call")}</a>}
          {(s.whatsapp || s.phone) && <a className="button secondary small" target="_blank" rel="noreferrer" href={"https://wa.me/" + (s.whatsapp || s.phone).replace(/\D/g, "").replace(/^0/, "94")}>WhatsApp</a>}
          {can("suppliers_edit") && <button className="button secondary small" onClick={startEdit}>{t("Edit")}</button>}
          {can("suppliers_edit") && <button className="button secondary small" onClick={() => void flip()}>{s.active ? t("Close supplier") : t("Open again")}</button>}
        </div>
        {msg && <p className="stock-error" role="alert">{msg}</p>}
      </div>
      {can("supplier_pay") && <Payables id={id} name={s.name} />}
      {can("supplier_return") && <SendBack id={id} name={s.name} parts={s.parts} onDone={() => void reload()} />}
      <div className="ws-card">
        <div className="ws-section-head"><h3>{t("Deliveries")} ({s.delivery_count})</h3></div>
        {s.deliveries.length === 0 ? <p className="muted">{t("Nothing received from this supplier yet.")}</p> : s.deliveries.map((d) => (
          <div className="ws-cust-line" key={d.id + (d.doc_no || "")}>
            <span><b>{dateOnly(d.created_at)}</b> <small>{d.doc_no || ""}{d.reference ? " · " + d.reference : ""}</small><br /><span>{d.lines} {t("parts")} · {d.quantity} {t("units")}</span></span>
            <span className="ws-cust-line-r">{d.cost !== undefined && <b>LKR {lkr(d.cost)}</b>}{!!d.unknown && <small>{t("some costs not entered")}</small>}</span>
          </div>
        ))}
      </div>
      <div className="ws-card">
        <div className="ws-section-head"><h3>{t("Parts from this supplier")} ({s.parts.length})</h3></div>
        {s.parts.length === 0 ? <p className="muted">{t("No parts are linked yet. The first delivery of a part sets its usual supplier.")}</p> : s.parts.map((p) => (
          <div className="ws-cust-line" key={p.id}>
            <span><b>{p.name}</b> <small>{p.sku}{p.location ? " · " + p.location : ""}</small></span>
            <span className="ws-cust-line-r"><span>{kmText(p.quantity).replace(" km", "")} {p.unit === "LITRE" ? "L" : t("units")}</span>{p.last_cost != null && <small>{t("Last cost")} {lkr(p.last_cost)}</small>}</span>
          </div>
        ))}
      </div>
    </section>
  );
}

const METHOD_LABEL: Record<string, string> = { CASH: "Cash", BANK: "Bank", CHEQUE: "Cheque", OTHER: "Other" };

function Payables({ id, name }: { id: string; name: string }) {
  const { data: b, error, reload } = useLoad<Books>("/api/inventory/suppliers/" + id + "/payables");
  const command = useCommand();
  const [open, setOpen] = useState(false), [f, setF] = useState({ amount: "", method: "CASH", note: "" }), [msg, setMsg] = useState(""), [voiding, setVoiding] = useState<{ id: string; reason: string } | null>(null);
  if (!b) return <div className="ws-card"><Loading error={error} /></div>;
  const pay = async () => {
    setMsg("");
    try { await command("/api/inventory/suppliers/" + id + "/payments", { amount: f.amount, method: f.method, note: f.note }); setOpen(false); setF({ amount: "", method: "CASH", note: "" }); toast(t("Payment saved.")); await reload(); window.dispatchEvent(new Event("lifta:suppliers")); }
    catch (e) { setMsg((e as Error).message); }
  };
  const cross = async () => {
    if (!voiding) return;
    try { await command("/api/inventory/suppliers/" + id + "/payments/" + voiding.id + "/void", { reason: voiding.reason }); setVoiding(null); await reload(); } catch (e) { setMsg((e as Error).message); }
  };
  const bills = b.bills.filter((x) => x.open > 0);
  return (
    <div className="ws-card ws-owed">
      <div className="ws-section-head"><h3>{t("Money owed")}</h3></div>
      <p className={"ws-owed-big" + (b.overdue > 0 ? " ws-debt" : "")}>
        {b.balance < 0 ? t("Supplier owes you") + " LKR " + lkr(-b.balance) : "LKR " + lkr(b.balance)}
      </p>
      {b.overdue > 0 && <p className="ws-debt">{t("Overdue")}: LKR {lkr(b.overdue)} · {b.oldest_overdue_days} {t("days late")}</p>}
      {b.incomplete > 0 && <small className="muted">{t("Some costs were not entered, so the real figure may be higher.")}</small>}
      {bills.length > 0 && bills.map((x) => (
        <div className="ws-cust-line" key={x.id + (x.doc_no || "")}>
          <span><b>{dateOnly(x.created_at)}</b> <small>{x.doc_no || ""}{x.reference ? " · " + x.reference : ""}</small><br /><small className={x.overdue_days ? "ws-debt" : ""}>{t("Due")} {x.due}{x.overdue_days ? " · " + x.overdue_days + " " + t("days late") : ""}</small></span>
          <span className="ws-cust-line-r"><b>LKR {lkr(x.open)}</b>{x.open !== x.amount && <small>{t("of")} {lkr(x.amount)}</small>}</span>
        </div>
      ))}
      <div className="ws-bar">{b.balance > 0 && !open && <button className="button primary small" onClick={() => { setOpen(true); setF({ amount: String(b.balance), method: "CASH", note: "" }); }}>{t("Record payment")}</button>}</div>
      {open && (
        <div className="ws-form">
          <div className="ws-grid2">
            <label className="ws-field">{t("Amount")} (LKR)<input inputMode="decimal" value={f.amount} onChange={(e) => setF({ ...f, amount: e.target.value.replace(/[^0-9.]/g, "") })} /></label>
            <label className="ws-field">{t("How paid")}<select value={f.method} onChange={(e) => setF({ ...f, method: e.target.value })}>{Object.entries(METHOD_LABEL).map(([k, v]) => <option key={k} value={k}>{t(v)}</option>)}</select></label>
          </div>
          <label className="ws-field">{t("Note")}<input value={f.note} maxLength={200} onChange={(e) => setF({ ...f, note: e.target.value })} /></label>
          <div className="ws-bar"><button className="button primary small" disabled={!f.amount} onClick={() => void pay()}>{t("Save payment")}</button><button className="button secondary small" onClick={() => setOpen(false)}>{t("Cancel")}</button></div>
        </div>
      )}
      {msg && <p className="stock-error" role="alert">{msg}</p>}
      {b.payments.length > 0 && <h4>{t("Payments to")} {name}</h4>}
      {b.payments.map((p) => (
        <div className={"ws-cust-line" + (p.voided ? " voided" : "")} key={p.id}>
          <span><b>{dateOnly(p.at)}</b> <small>{t(METHOD_LABEL[p.method] || p.method)}{p.note ? " · " + p.note : ""}</small>{p.voided && <><br /><small>{t("Crossed out")}: {p.voided_reason}</small></>}</span>
          <span className="ws-cust-line-r"><b>{p.voided ? <s>LKR {lkr(p.amount)}</s> : "LKR " + lkr(p.amount)}</b>{!p.voided && (voiding?.id === p.id
            ? <span className="ws-inline"><input aria-label={t("Reason")} placeholder={t("Reason")} value={voiding.reason} maxLength={200} onChange={(e) => setVoiding({ id: p.id, reason: e.target.value })} /><button className="doc-link" disabled={!voiding.reason.trim()} onClick={() => void cross()}>{t("Cross out")}</button><button className="doc-link" onClick={() => setVoiding(null)}>{t("Cancel")}</button></span>
            : <button className="doc-link" onClick={() => setVoiding({ id: p.id, reason: "" })}>{t("Cross out")}</button>)}</span>
        </div>
      ))}
      {b.returns.length > 0 && <h4>{t("Parts sent back")}</h4>}
      {b.returns.map((r) => (
        <div className="ws-cust-line" key={r.id + (r.doc_no || "")}>
          <span><b>{dateOnly(r.created_at)}</b> <small>{r.doc_no || ""}{r.reason ? " · " + r.reason : ""}</small></span>
          <span className="ws-cust-line-r"><b>- LKR {lkr(r.amount)}</b>{r.doc_no && <button className="doc-link" onClick={() => void openPdf("/api/inventory/movements/" + r.id + "/note.pdf?cost=1", r.doc_no + ".pdf").catch((e) => toast((e as Error).message, { bad: true }))}>{t("Print")}</button>}</span>
        </div>
      ))}
    </div>
  );
}

function SendBack({ id, name, parts, onDone }: { id: string; name: string; parts: Full["parts"]; onDone: () => void }) {
  const command = useCommand();
  const [open, setOpen] = useState(false), [qty, setQty] = useState<Record<string, string>>({}), [reason, setReason] = useState(""), [ref, setRef] = useState(""), [msg, setMsg] = useState("");
  const lines = parts.filter((p) => Number(qty[p.id]) > 0);
  const send = async () => {
    setMsg("");
    try {
      const res = await command("/api/inventory/supplier-returns", { supplierId: id, reason, reference: ref, lines: lines.map((p) => ({ productId: p.id, quantity: qty[p.id], ...(p.last_cost != null ? { unitCost: p.last_cost } : {}) })) }) as { id?: string; doc_no?: string } | undefined;
      setOpen(false); setQty({}); setReason(""); setRef(""); toast(t("Sent back. Stock is updated."));
      if (res?.id && res.doc_no) void openPdf("/api/inventory/movements/" + res.id + "/note.pdf", res.doc_no + ".pdf").catch(() => undefined);
      onDone(); window.dispatchEvent(new Event("lifta:suppliers"));
    } catch (e) { setMsg((e as Error).message); }
  };
  if (!open) return <div className="ws-card"><div className="ws-bar"><button className="button secondary small" onClick={() => setOpen(true)}>{t("Return parts to supplier")}</button></div></div>;
  return (
    <div className="ws-card ws-form">
      <div className="ws-section-head"><h3>{t("Return parts to")} {name}</h3></div>
      {parts.length === 0 ? <p className="muted">{t("No parts are linked yet. The first delivery of a part sets its usual supplier.")}</p> : parts.map((p) => (
        <label className="ws-cust-line" key={p.id}>
          <span><b>{p.name}</b> <small>{p.sku} · {t("in stock")} {kmText(p.quantity).replace(" km", "")}</small></span>
          <input className="ws-qty" aria-label={t("Quantity") + " " + p.name} inputMode="decimal" value={qty[p.id] || ""} placeholder="0" onChange={(e) => setQty({ ...qty, [p.id]: e.target.value.replace(/[^0-9.]/g, "") })} />
        </label>
      ))}
      <label className="ws-field">{t("Reason")} *<input value={reason} maxLength={200} onChange={(e) => setReason(e.target.value)} placeholder={t("Wrong part, faulty, ...")} /></label>
      <label className="ws-field">{t("Supplier credit note no.")}<input value={ref} maxLength={60} onChange={(e) => setRef(e.target.value)} /></label>
      {msg && <p className="stock-error" role="alert">{msg}</p>}
      <div className="ws-bar"><button className="button primary small" disabled={lines.length === 0 || !reason.trim()} onClick={() => void send()}>{t("Send back and print note")}</button><button className="button secondary small" onClick={() => setOpen(false)}>{t("Cancel")}</button></div>
    </div>
  );
}
