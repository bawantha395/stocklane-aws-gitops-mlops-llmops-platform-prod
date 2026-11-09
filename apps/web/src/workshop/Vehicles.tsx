import { useState } from "react";
import { download } from "../api";
import { Empty, Loading, Pill, addDays, dateOnly, kmText, lkr, today, useCommand, useDebounced, useLoad, useWs, waLink, type Vehicle, type Visit } from "./common";

const total = (v: Visit) => lkr(v.total);

/** One earlier repair, expandable to its parts and labour. */
export function VisitCard({ v, open = false, onOpenJob }: { v: Visit; open?: boolean; onOpenJob?: () => void }) {
  const [show, setShow] = useState(open);
  const lines = (v.parts?.length || 0) + (v.labour?.length || 0);
  return (
    <div className={"ws-visit " + v.status.toLowerCase()}>
      <button className="ws-visit-head" onClick={() => setShow(!show)} aria-expanded={show}>
        <span><b>{dateOnly(v.created_at)}</b>{v.odometer != null && <small>{kmText(v.odometer)}</small>}</span>
        <span className="ws-visit-work">{v.summary || "No complaint noted"}</span>
        <span className="ws-visit-total">{v.status === "CANCELLED" ? <Pill s="CANCELLED" /> : v.status === "OPEN" ? <Pill s="OPEN" /> : <b>{total(v)}</b>}</span>
      </button>
      {show && (
        <div className="ws-visit-body">
          {v.parts?.map((p, i) => <div className="ws-visit-line" key={"p" + i}><span>{p.quantity} x {p.name}</span><b>{lkr(p.quantity * p.unit_price)}</b></div>)}
          {v.labour?.map((l, i) => <div className="ws-visit-line labour" key={"l" + i}><span>Labour: {l.description}</span><b>{lkr(l.amount)}</b></div>)}
          {!lines && <p className="muted">No lines yet.</p>}
          <div className="ws-visit-foot">
            {v.invoice_number && <small>{v.invoice_number}</small>}
            {v.mechanic && <small>Mechanic: {v.mechanic}</small>}
            {onOpenJob && <button className="button secondary small" onClick={onOpenJob}>Open job</button>}
          </div>
        </div>
      )}
    </div>
  );
}

/** Earlier repairs of a vehicle, shown while a job is created or edited. */
export function PastRepairs({ regKey, skipJob }: { regKey: string; skipJob?: string }) {
  const { go } = useWs();
  const { data } = useLoad<Vehicle>((regKey || "").length >= 2 ? "/api/workshop/vehicles/" + regKey : null);
  const list = (data?.history || []).filter((h) => h.id !== skipJob);
  if (!data || !list.length) return null;
  return (
    <section className="ws-past" aria-label="Earlier repairs">
      <div className="ws-section-head"><h3>Earlier repairs of {data.registration}</h3><button className="button secondary small" onClick={() => go({ name: "vehicle", id: data.id })}>Full file</button></div>
      <p className="muted">{data.visits} visit{data.visits === 1 ? "" : "s"}, LKR {lkr(data.spent)} invoiced{data.last_km != null ? ", last seen at " + kmText(data.last_km) : ""}.</p>
      {list.slice(0, 4).map((v, i) => <VisitCard key={v.id} v={v} open={i === 0} onOpenJob={() => go({ name: "job", id: v.id })} />)}
    </section>
  );
}

export function Vehicles() {
  const { go } = useWs();
  const [q, setQ] = useState("");
  const term = useDebounced(q.trim());
  const { data, error } = useLoad<Vehicle[]>("/api/workshop/vehicles?search=" + encodeURIComponent(term));
  return (
    <>
      <div className="ws-toolbar"><input aria-label="Search vehicles" placeholder="Search number, owner, phone or model" value={q} onChange={(e) => setQ(e.target.value)} /></div>
      {!data ? <Loading error={error} /> : (
        <div className="ws-list">
          {data.map((v) => (
            <button className="ws-item" key={v.id} onClick={() => go({ name: "vehicle", id: v.id })}>
              <span className="ws-item-main"><strong>{v.registration}</strong><span>{v.owner}{v.make ? " · " + v.make : ""}</span><small>{v.phone}</small></span>
              <span className="ws-item-side"><small>{kmText(v.last_km)}</small>{v.next_service_date && <small>Next: {v.next_service_date}</small>}</span>
            </button>
          ))}
          {!data.length && <Empty>{term ? "No vehicle matches." : "No vehicles yet. They appear when you create a job."}</Empty>}
        </div>
      )}
    </>
  );
}

export function VehiclePage({ id }: { id: string }) {
  const { go, business } = useWs();
  const { data: v, error, reload } = useLoad<Vehicle>("/api/workshop/vehicles/" + id);
  const [edit, setEdit] = useState(false), [f, setF] = useState({ owner: "", phone: "", make: "", notes: "" }), [msg, setMsg] = useState("");
  const command = useCommand();
  if (!v) return <Loading error={error} />;
  const startEdit = () => { setF({ owner: v.owner || "", phone: v.phone || "", make: v.make || "", notes: v.notes || "" }); setEdit(true); setMsg(""); };
  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    try { await command("/api/workshop/vehicles/" + id, f, "PATCH"); setEdit(false); await reload(); } catch (err) { setMsg((err as Error).message); }
  };
  const due = v.next_service_date && v.next_service_date <= addDays(today(), 14);
  return (
    <div>
      <div className="ws-bar">
        <button className="button primary small" onClick={() => go({ name: "new", reg: v.registration })}>+ New job</button>
        <button className="button secondary small" onClick={() => void download("/api/workshop/vehicles/" + id + "/history.pdf", "history-" + id + ".pdf").catch((e) => setMsg(e.message))}>History PDF</button>
        <button className="button secondary small" onClick={startEdit}>Edit details</button>
      </div>
      <section className="ws-card">
        <div className="ws-card-head">
          <div><h2>{v.registration}</h2><p>{v.make || "Model not set"}</p></div>
          {due && <span className="ws-pill unpaid">Service due</span>}
        </div>
        {!edit ? (
          <>
            <p><b>{v.owner}</b></p>
            {v.phone && (
              <p className="ws-contact">
                <a className="button secondary small" href={"tel:" + v.phone}>Call {v.phone}</a>
                <a className="button secondary small" target="_blank" rel="noreferrer" href={waLink(v.phone, "Hello " + (v.owner || "") + ", this is " + business.name + " about your vehicle " + v.registration + ".")}>WhatsApp</a>
              </p>
            )}
            {v.notes && <p className="ws-note">{v.notes}</p>}
          </>
        ) : (
          <form onSubmit={save} className="ws-form">
            <label className="ws-field">Owner<input value={f.owner} onChange={(e) => setF({ ...f, owner: e.target.value })} /></label>
            <label className="ws-field">Contact number<input inputMode="tel" value={f.phone} onChange={(e) => setF({ ...f, phone: e.target.value })} /></label>
            <label className="ws-field">Make and model<input value={f.make} onChange={(e) => setF({ ...f, make: e.target.value })} /></label>
            <label className="ws-field">Notes about this vehicle<textarea rows={3} value={f.notes} onChange={(e) => setF({ ...f, notes: e.target.value })} /></label>
            <div className="ws-actions"><button type="button" className="button secondary" onClick={() => setEdit(false)}>Cancel</button><button className="button primary">Save</button></div>
          </form>
        )}
        {msg && <p role="alert" className="stock-error">{msg}</p>}
        <dl className="ws-facts">
          <div><dt>Visits</dt><dd>{v.visits}</dd></div>
          <div><dt>Invoiced</dt><dd>LKR {lkr(v.spent)}</dd></div>
          <div><dt>Last odometer</dt><dd>{kmText(v.last_km)}</dd></div>
          <div><dt>Next service</dt><dd>{v.next_service_date || "-"}{v.next_service_km ? " / " + kmText(v.next_service_km) : ""}</dd></div>
          <div><dt>First visit</dt><dd>{v.first_visit || "-"}</dd></div>
          <div><dt>Usually every</dt><dd>{v.average_gap_days ? v.average_gap_days + " days" : "-"}</dd></div>
        </dl>
      </section>
      <div className="ws-section-head"><h3>Repair history</h3><small>{v.history?.length || 0} job{v.history?.length === 1 ? "" : "s"}</small></div>
      {(v.history || []).map((h, i) => <VisitCard key={h.id} v={h} open={i === 0} onOpenJob={() => go({ name: "job", id: h.id })} />)}
      {!v.history?.length && <Empty>No repairs yet.</Empty>}
    </div>
  );
}

export function Due() {
  const { go, business } = useWs();
  const { data, error } = useLoad<Vehicle[]>("/api/workshop/service-due");
  if (!data) return <Loading error={error} />;
  const why: Record<string, string> = { overdue: "Overdue", soon: "Due soon", km: "Near service km" };
  return (
    <>
      <p className="muted">Vehicles due within 14 days, or within 300 km of the service odometer. Call or message the owner, then start a job.</p>
      <div className="ws-list">
        {data.map((v) => (
          <div className="ws-item static" key={v.id}>
            <span className="ws-item-main">
              <strong>{v.registration}</strong><span>{v.owner}{v.make ? " · " + v.make : ""}</span>
              <small>{v.next_service_date || ""}{v.next_service_km ? "  " + kmText(v.next_service_km) : ""}</small>
              <span className="ws-contact">
                {v.phone && <a className="button secondary small" href={"tel:" + v.phone}>Call</a>}
                {v.phone && <a className="button secondary small" target="_blank" rel="noreferrer" href={waLink(v.phone, "Hello " + (v.owner || "") + ", " + business.name + " here. Your " + v.registration + " is due for service" + (v.next_service_date ? " on " + v.next_service_date : "") + ". Would you like to book a time?")}>WhatsApp</a>}
                <button className="button primary small" onClick={() => go({ name: "new", reg: v.registration })}>New job</button>
              </span>
            </span>
            <span className="ws-item-side"><span className={"ws-pill " + (v.reason === "overdue" ? "void" : "unpaid")}>{why[v.reason || ""]}</span></span>
          </div>
        ))}
        {!data.length && <Empty>Nothing due. Put a next service date on a job and it shows up here.</Empty>}
      </div>
    </>
  );
}
