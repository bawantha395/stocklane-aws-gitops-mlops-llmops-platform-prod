import { useEffect, useState } from "react";
import { can } from "../perms";
import { t } from "../i18n";
import { download } from "../api";
import { askConfirm } from "../ui";
import { Empty, Loading, Pill, dateOnly, kmText, lkr, useCommand, useDebounced, useLoad, useWs, waLink } from "./common";

export type CustomerRow = { id: string; name: string; phone: string; phone2?: string; kind: string; active: boolean; birthday?: string; vehicles: number; regs: string[]; jobs: number; owing: number; updated_at: string };
type Line = { id: string; job_no?: string; registration: string; created_at: string; status: string; stage?: string; summary?: string; name?: string; total?: number; paid?: number; balance?: number; pay_status?: string; invoice_id?: string; invoice_number?: string };
export type CustomerFull = CustomerRow & { address?: string; notes?: string; names?: string[]; aliases?: string[]; revision: number; spent: number; bills: number; vehicle_list: { registration: string; make: string; last_km?: number | null; owner?: string }[]; timeline: Line[] };
export type Suggest = { id: string; name: string; phone: string; address?: string; kind: string; vehicles: { registration: string; make: string; last_km?: number | null }[] };

const KINDS: [string, string][] = [["WALKIN", "Walk-in"], ["REGULAR", "Regular"], ["FLEET", "Fleet"], ["INSURANCE", "Insurance"]];
export const kindLabel = (k: string) => t(KINDS.find((x) => x[0] === k)?.[1] || "Regular");
const key = (s: string) => s.replace(/[^A-Za-z0-9]/g, "").toUpperCase();

export function Customers() {
  const { go } = useWs();
  const [q, setQ] = useState(""), [old, setOld] = useState(false);
  const term = useDebounced(q.trim());
  const { data, error } = useLoad<CustomerRow[]>("/api/workshop/customers?search=" + encodeURIComponent(term) + (old ? "&inactive=1" : ""));
  return (
    <>
      <div className="ws-toolbar">
        <input aria-label={t("Search customers")} placeholder={t("Search name, phone or vehicle number")} value={q} onChange={(e) => setQ(e.target.value)} />
        <label className="ws-check"><input type="checkbox" checked={old} onChange={(e) => setOld(e.target.checked)} /> {t("Show closed customers")}</label>
        {can("customers_edit") && <button className="button secondary" onClick={() => go({ name: "customer", id: "new" })}>+ {t("New customer")}</button>}
      </div>
      {!data ? <Loading error={error} /> : data.length === 0 ? <Empty>{term ? "No customer matches." : "No customers yet. A customer is added by itself when you create a job with a phone number."}</Empty> : (
        <div className="ws-cust-list">
          {data.map((c) => (
            <button key={c.id} className={"ws-cust" + (c.active ? "" : " closed")} onClick={() => go({ name: "customer", id: c.id })}>
              <span className="ws-cust-main"><strong>{c.name}</strong><small>{c.phone || "-"}{c.regs.length ? " · " + c.regs.join(", ") + (c.vehicles > c.regs.length ? " +" + (c.vehicles - c.regs.length) : "") : ""}</small></span>
              <span className="ws-cust-side">{c.owing > 0 && <b className="ws-cust-owe">LKR {lkr(c.owing)}</b>}<small>{kindLabel(c.kind)} · {c.vehicles} {t("vehicles")}</small></span>
            </button>
          ))}
        </div>
      )}
    </>
  );
}

export function CustomerPage({ id }: { id: string }) {
  const { go } = useWs();
  const fresh = id === "new";
  const { data: c, error, reload } = useLoad<CustomerFull>(fresh ? null : "/api/workshop/customers/" + id);
  const [edit, setEdit] = useState(fresh), [msg, setMsg] = useState(""), [merge, setMerge] = useState(false);
  const [f, setF] = useState({ name: "", phone: "", phone2: "", address: "", birthday: "", kind: "REGULAR", notes: "" });
  const command = useCommand();
  if (!fresh && !c) return <Loading error={error} />;
  const set = (k: keyof typeof f, v: string) => setF((x) => ({ ...x, [k]: v }));
  const startEdit = () => { if (!c) return; setF({ name: c.name, phone: c.phone || "", phone2: c.phone2 || "", address: c.address || "", birthday: c.birthday || "", kind: c.kind, notes: c.notes || "" }); setEdit(true); setMsg(""); };
  const save = async (e: React.FormEvent) => {
    e.preventDefault(); setMsg("");
    try {
      if (fresh) { const made = await command<CustomerRow>("/api/workshop/customers", f); go({ name: "customer", id: made.id }, t("Customer saved.")); return; }
      await command("/api/workshop/customers/" + id, { ...f, revision: c!.revision }, "PATCH"); setEdit(false); await reload();
    } catch (err) { setMsg((err as Error).message); }
  };
  const setActive = async (active: boolean) => {
    if (!active && !(await askConfirm(t("Close this customer? Their jobs and bills stay. They leave the list, and come back by themselves with the next job."), { confirm: t("Close customer") }))) return;
    try { await command("/api/workshop/customers/" + id, { active, revision: c!.revision }, "PATCH"); await reload(); } catch (err) { setMsg((err as Error).message); }
  };
  if (edit) {
    return (
      <form className="ws-card ws-form" onSubmit={save}>
        <h2>{fresh ? t("New customer") : t("Edit customer")}</h2>
        <div className="ws-grid2">
          <label className="ws-field">{t("Name")} *<input required value={f.name} onChange={(e) => set("name", e.target.value)} /></label>
          <label className="ws-field">{t("Phone")}<input inputMode="tel" value={f.phone} onChange={(e) => set("phone", e.target.value)} placeholder="07X XXX XXXX" /></label>
          <label className="ws-field">{t("Second phone")}<input inputMode="tel" value={f.phone2} onChange={(e) => set("phone2", e.target.value)} /></label>
          <label className="ws-field">{t("Birthday")} <small>({t("month and day, like 12-25")})</small><input value={f.birthday} onChange={(e) => set("birthday", e.target.value)} placeholder="MM-DD" /></label>
          <label className="ws-field">{t("Address")}<textarea rows={2} value={f.address} onChange={(e) => set("address", e.target.value)} /></label>
          <label className="ws-field">{t("Notes")}<textarea rows={2} value={f.notes} onChange={(e) => set("notes", e.target.value)} /></label>
        </div>
        <div className="ws-field" role="group" aria-label={t("Customer type")}>{t("Customer type")}
          <div className="ws-seg">{KINDS.map(([k, l]) => <button type="button" key={k} className={f.kind === k ? "on" : ""} aria-pressed={f.kind === k} onClick={() => set("kind", k)}>{t(l)}</button>)}</div>
        </div>
        {msg && <p className="stock-error" role="alert">{msg}</p>}
        <div className="ws-bar"><button className="button primary" type="submit">{t("Save")}</button><button type="button" className="button secondary" onClick={() => (fresh ? go({ name: "customers" }) : setEdit(false))}>{t("Cancel")}</button></div>
      </form>
    );
  }
  if (!c) return null;
  const other = (c.names || []).filter((n) => n !== c.name);
  return (
    <div>
      {c.owing > 0 && <p className="ws-warn ws-owing late" role="status"><strong>{t("This customer owes")} LKR {lkr(c.owing)}</strong></p>}
      <section className="ws-card">
        <div className="ws-section-head"><h2>{c.name}{!c.active && <small> · {t("Closed")}</small>}</h2><span className="ws-pill">{kindLabel(c.kind)}</span></div>
        <dl className="ws-cust-facts">
          <div><dt>{t("Phone")}</dt><dd>{c.phone || "-"}{c.phone2 ? " · " + c.phone2 : ""}</dd></div>
          {c.address && <div><dt>{t("Address")}</dt><dd>{c.address}</dd></div>}
          {c.birthday && <div><dt>{t("Birthday")}</dt><dd>{c.birthday}</dd></div>}
          {other.length > 0 && <div><dt>{t("Also written as")}</dt><dd>{other.join(", ")}</dd></div>}
          {c.notes && <div><dt>{t("Notes")}</dt><dd>{c.notes}</dd></div>}
          <div><dt>{t("Total billed")}</dt><dd>LKR {lkr(c.spent)} · {c.bills} {t("bills")}</dd></div>
        </dl>
        <div className="ws-bar">
          {c.phone && <a className="button secondary small" href={"tel:" + c.phone}>{t("Call")}</a>}
          {c.phone && <a className="button secondary small" href={waLink(c.phone, "")} target="_blank" rel="noreferrer">WhatsApp</a>}
          <button className="button secondary small" onClick={() => void download("/api/workshop/customers/" + id + "/statement.pdf", "statement-" + id + ".pdf").catch((e) => setMsg(e.message))}>{t("Statement PDF")}</button>
          {can("customers_edit") && <button className="button secondary small" onClick={startEdit}>{t("Edit")}</button>}
          {can("customers_edit") && <button className="button secondary small" onClick={() => setMerge(true)}>{t("Merge with another")}</button>}
          {can("customers_edit") && <button className="button secondary small" onClick={() => void setActive(!c.active)}>{c.active ? t("Close customer") : t("Open again")}</button>}
        </div>
        {msg && <p className="stock-error" role="alert">{msg}</p>}
      </section>
      {merge && <MergeBox from={c} onClose={() => setMerge(false)} onDone={(into) => go({ name: "customer", id: into }, t("Merged. All jobs, vehicles and bills are on this customer now."))} />}
      <section className="ws-card">
        <div className="ws-section-head"><h3>{t("Vehicles")} ({c.vehicle_list.length})</h3></div>
        <div className="ws-cust-chips">{c.vehicle_list.map((v) => <button key={v.registration} className="ws-chip" onClick={() => go({ name: "vehicle", id: key(v.registration) })}><b>{v.registration}</b>{v.make ? " · " + v.make : ""}{v.last_km != null ? " · " + kmText(v.last_km) : ""}</button>)}{!c.vehicle_list.length && <span className="muted">{t("No vehicles yet.")}</span>}</div>
        {can("jobs") && c.vehicle_list.length > 0 && <div className="ws-bar" style={{ marginTop: 10 }}>{c.vehicle_list.slice(0, 3).map((v) => <button key={v.registration} className="button primary small" onClick={() => go({ name: "new", reg: v.registration })}>+ {t("New job")} · {v.registration}</button>)}</div>}
      </section>
      <section className="ws-card">
        <div className="ws-section-head"><h3>{t("Jobs and bills")} ({c.timeline.length})</h3></div>
        {c.timeline.length === 0 ? <p className="muted">{t("No jobs yet.")}</p> : c.timeline.map((l) => (
          <button key={l.id} className="ws-cust-line" onClick={() => go({ name: "job", id: l.id })}>
            <span><b>{dateOnly(l.created_at)}</b> <small>{l.job_no || ""} · {l.registration}</small><br /><span>{l.summary || t("No complaint noted")}</span></span>
            <span className="ws-cust-line-r">{l.total != null && <b>LKR {lkr(l.total)}</b>}{l.pay_status ? <Pill s={l.pay_status} /> : <Pill s={l.status} />}{l.pay_status && l.pay_status !== "PAID" && l.pay_status !== "REFUNDED" && <small>{t("Balance")} {lkr(l.balance)}</small>}</span>
          </button>
        ))}
      </section>
    </div>
  );
}

function MergeBox({ from, onClose, onDone }: { from: CustomerFull; onClose: () => void; onDone: (into: string) => void }) {
  const [q, setQ] = useState(""), [msg, setMsg] = useState(""), [busy, setBusy] = useState(false);
  const term = useDebounced(q.trim());
  const { data } = useLoad<CustomerRow[]>(term.length >= 2 ? "/api/workshop/customers?search=" + encodeURIComponent(term) : null);
  const command = useCommand();
  const run = async (into: CustomerRow) => {
    if (!(await askConfirm(t("Move everything of {a} to {b}? {a} is closed afterwards. This cannot be undone.", { a: from.name, b: into.name }), { confirm: t("Merge"), danger: true }))) return;
    setBusy(true); setMsg("");
    try {
      // a big customer moves in steps; keep asking until the server says it is done
      for (let i = 0; i < 40; i++) {
        const r = await command<{ done: boolean }>("/api/workshop/customers/" + from.id + "/merge", { into: into.id, step: i });
        if (r.done) { onDone(into.id); return; }
      }
      setMsg(t("Not finished. Open the customer and press Merge again."));
    } catch (err) { setMsg((err as Error).message); }
    setBusy(false);
  };
  useEffect(() => { setMsg(""); }, [term]);
  return (
    <section className="ws-card">
      <div className="ws-section-head"><h3>{t("Merge {name} into another customer", { name: from.name })}</h3><button className="button secondary small" onClick={onClose}>{t("Cancel")}</button></div>
      <input aria-label={t("Search customers")} placeholder={t("Search the customer to keep")} value={q} onChange={(e) => setQ(e.target.value)} />
      <div className="ws-cust-list">{(data || []).filter((x) => x.id !== from.id).map((x) => <button key={x.id} disabled={busy} className="ws-cust" onClick={() => void run(x)}><span className="ws-cust-main"><strong>{x.name}</strong><small>{x.phone || "-"} · {x.vehicles} {t("vehicles")}</small></span></button>)}</div>
      {msg && <p className="stock-error" role="alert">{msg}</p>}
    </section>
  );
}

/** While the phone number is typed on a new job: customers it matches. One tap fills the name, phone and address. */
export function CustomerSuggest({ phone, onPick }: { phone: string; onPick: (c: Suggest) => void }) {
  const digits = useDebounced(phone.replace(/\D/g, ""), 300);
  const { data } = useLoad<Suggest[]>(can("jobs") && digits.length >= 4 && digits.length < 10 ? "/api/workshop/customers/lookup?search=" + digits : null);
  if (!data || !data.length) return null;
  return (
    <div className="ws-suggest" role="listbox" aria-label={t("Customers with this number")}>
      {data.map((c) => <button type="button" role="option" aria-selected="false" key={c.id} onClick={() => onPick(c)}><b>{c.name}</b><small>{c.phone}{c.vehicles.length ? " · " + c.vehicles.map((v) => v.registration).join(", ") : ""}</small></button>)}
    </div>
  );
}
