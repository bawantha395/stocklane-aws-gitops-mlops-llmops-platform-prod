import { useCallback, useEffect, useRef, useState } from "react";
import { api, download } from "./api";

type Part = { name: string; quantity: string; unit_price: string };
type Labour = { description: string; amount: string };
type Job = {
  id: string; registration: string; customer: string; phone: string; vehicle: string; odometer?: number; summary: string;
  mechanic: string; notes: string; status: "OPEN" | "INVOICED" | "CANCELLED"; revision: number; invoice_id?: string; invoice_number?: string;
  parts: { name: string; quantity: number; unit_price: number }[]; labour: { description: string; amount: number }[];
  discount: number; next_service_date?: string; next_service_km?: number; total: number; created_at: string;
};
type History = { id: string; created_at: string; summary: string; status: string; odometer?: number; total: number; invoice_number?: string };
type Vehicle = { id: string; registration: string; owner?: string; phone?: string; make?: string; last_km?: number; next_service_date?: string; next_service_km?: number; updated_at: string; reason?: string; history?: History[] };
type Invoice = {
  id: string; invoice_number: string; job_id: string; registration: string; customer: string; phone?: string; vehicle?: string; total: number;
  paid: number; status: "UNPAID" | "PARTIAL" | "PAID" | "VOID"; created_at: string; payments: { id: string; amount: number; method: string; note: string; at: string }[];
};
type Report = { from: string; until: string; invoices: number; vehicles: number; parts_total: number; labour_total: number; discount: number; total: number; paid: number; unpaid: number; outstanding_all_time: number; by_mechanic: { mechanic: string; jobs: number; total: number }[] };
type Page = { name: "jobs" | "vehicles" | "due" | "unpaid" | "report" | "new" | "job" | "invoice" | "vehicle"; id?: string; reg?: string };

const lkr = (n: number | string) => Number(n).toLocaleString("en", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const dateOnly = (s: string) => new Date(s).toLocaleDateString("en-CA", { timeZone: "Asia/Colombo" });
const today = () => dateOnly(new Date().toISOString());
const regKey = (s: string) => s.replace(/[^A-Za-z0-9]/g, "");
const LABEL: Record<string, string> = { OPEN: "Open", INVOICED: "Invoiced", CANCELLED: "Cancelled", UNPAID: "Unpaid", PARTIAL: "Part paid", PAID: "Paid", VOID: "Void" };

function useCommand() {
  const pending = useRef({ body: "", key: "" });
  return async <T,>(path: string, body: unknown, method = "POST") => {
    const fingerprint = path + method + JSON.stringify(body);
    if (pending.current.body !== fingerprint) pending.current = { body: fingerprint, key: crypto.randomUUID() };
    const value = await api<T>(path, { method, body: JSON.stringify(body) }, pending.current.key);
    pending.current = { body: "", key: "" };
    return value;
  };
}

const Pill = ({ s }: { s: string }) => <span className={"ws-pill " + s.toLowerCase()}>{LABEL[s] || s}</span>;
const Empty = ({ children }: { children: string }) => <div className="stock-empty">{children}</div>;

export function Workshop({ owner }: { owner: boolean }) {
  const [page, setPage] = useState<Page>({ name: "jobs" });
  const [notice, setNotice] = useState("");
  const go = (next: Page, message = "") => { setPage(next); setNotice(message); };
  const tabs: [Page["name"], string][] = [["jobs", "Jobs"], ["vehicles", "Vehicles"], ["due", "Service due"], ["unpaid", "Invoices"], ...(owner ? [["report", "Report"] as [Page["name"], string]] : [])];
  const tab = page.name === "job" || page.name === "new" ? "jobs" : page.name === "vehicle" ? "vehicles" : page.name === "invoice" ? "unpaid" : page.name;
  return (
    <section className="report ws" aria-label="Workshop">
      <div className="report-head">
        <div><p className="eyebrow">WORKSHOP</p><h1>Repair jobs</h1></div>
        <button className="button primary" onClick={() => go({ name: "new" })}>+ New job</button>
      </div>
      <div className="report-filters" role="tablist">
        {tabs.map(([key, label]) => <button key={key} role="tab" className={"report-chip" + (tab === key ? " chosen" : "")} onClick={() => go({ name: key } as Page)}>{label}</button>)}
      </div>
      {notice && <p className="stock-notice ws-notice" role="status">{notice}</p>}
      {page.name === "jobs" && <Jobs open={(id) => go({ name: "job", id })} />}
      {page.name === "new" && <NewJob reg={page.reg} done={(id) => go({ name: "job", id }, "Job created. Add the parts and labour below.")} />}
      {page.name === "job" && page.id && <JobPage key={page.id} id={page.id} owner={owner} go={go} />}
      {page.name === "vehicles" && <Vehicles open={(id) => go({ name: "vehicle", id })} />}
      {page.name === "vehicle" && page.id && <VehiclePage key={page.id} id={page.id} go={go} />}
      {page.name === "due" && <Due go={go} />}
      {page.name === "unpaid" && <Invoices open={(id) => go({ name: "invoice", id })} />}
      {page.name === "invoice" && page.id && <InvoicePage key={page.id} id={page.id} owner={owner} go={go} />}
      {page.name === "report" && owner && <ReportPage />}
    </section>
  );
}

function useLoad<T>(path: string) {
  const [data, setData] = useState<T | null>(null), [error, setError] = useState("");
  const load = useCallback(async () => { try { setData(await api<T>(path)); setError(""); } catch (e) { setError((e as Error).message); } }, [path]);
  useEffect(() => { void load(); }, [load]);
  return { data, error, reload: load };
}

function Jobs({ open }: { open: (id: string) => void }) {
  const { data, error } = useLoad<Job[]>("/api/workshop/jobs");
  const [filter, setFilter] = useState("OPEN"), [search, setSearch] = useState("");
  if (!data) return <p className="stock-help">{error || "Loading jobs…"}</p>;
  const needle = search.trim().toLowerCase();
  const shown = data.filter((j) => (filter === "ALL" || j.status === filter) && (!needle || (j.registration + " " + j.customer + " " + j.phone).toLowerCase().includes(needle)));
  const count = (s: string) => data.filter((j) => j.status === s).length;
  return (
    <>
      <div className="report-filters">
        {[["OPEN", "Open", count("OPEN")], ["INVOICED", "Invoiced", count("INVOICED")], ["ALL", "All", data.length]].map(([key, label, n]) => (
          <button key={key} className={"report-chip" + (filter === key ? " chosen" : "")} onClick={() => setFilter(String(key))}><b>{n}</b> {label}</button>
        ))}
        <input className="report-search" aria-label="Search jobs" placeholder="Vehicle number, name or phone" value={search} onChange={(e) => setSearch(e.target.value)} />
      </div>
      <div className="stock-table-wrap">
        <table className="stock-table">
          <thead><tr><th>Vehicle</th><th>Customer</th><th>Work</th><th>Status</th><th className="num">Total (LKR)</th><th>Date</th></tr></thead>
          <tbody>
            {shown.map((j) => (
              <tr key={j.id} className="ws-row" onClick={() => open(j.id)}>
                <td><strong>{j.registration}</strong><small>{j.vehicle}</small></td>
                <td>{j.customer}<small>{j.phone}</small></td>
                <td>{j.summary || "—"}</td>
                <td><Pill s={j.status} /></td>
                <td className="num">{lkr(j.total)}</td>
                <td>{dateOnly(j.created_at)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {!shown.length && <Empty>{data.length ? "No jobs match." : "No jobs yet. Press New job."}</Empty>}
      </div>
    </>
  );
}

function NewJob({ reg: start, done }: { reg?: string; done: (id: string) => void }) {
  const [f, setF] = useState({ registration: start || "", customer: "", phone: "", vehicle: "", odometer: "", summary: "", mechanic: "" });
  const [known, setKnown] = useState(""), [error, setError] = useState(""), [busy, setBusy] = useState(false);
  const command = useCommand();
  const set = (k: keyof typeof f, v: string) => setF((x) => ({ ...x, [k]: v }));
  const lookup = async (value: string) => {
    if (regKey(value).length < 2) return;
    try {
      const v = await api<Vehicle>("/api/workshop/vehicles/" + regKey(value));
      setF((x) => ({ ...x, customer: x.customer || v.owner || "", phone: x.phone || v.phone || "", vehicle: x.vehicle || v.make || "" }));
      setKnown("Known vehicle. " + (v.history?.length || 0) + " earlier job(s)" + (v.last_km ? ", last at " + v.last_km + " km." : "."));
    } catch { setKnown(""); }
  };
  useEffect(() => { if (start) void lookup(start); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const submit = async (e: React.FormEvent) => {
    e.preventDefault(); setBusy(true); setError("");
    try { done((await command<Job>("/api/workshop/jobs", { ...f, odometer: f.odometer === "" ? null : Number(f.odometer) })).id); }
    catch (err) { setError((err as Error).message); } finally { setBusy(false); }
  };
  return (
    <form className="stock-panel ws-form" onSubmit={submit}>
      <h2>New repair job</h2>
      <div className="stock-form-grid">
        <label className="stock-field">Vehicle number *<input required autoFocus value={f.registration} onChange={(e) => set("registration", e.target.value)} onBlur={(e) => void lookup(e.target.value)} placeholder="CAB-1234" /></label>
        <label className="stock-field">Customer name *<input required value={f.customer} onChange={(e) => set("customer", e.target.value)} /></label>
        <label className="stock-field">Contact number<input inputMode="tel" value={f.phone} onChange={(e) => set("phone", e.target.value)} placeholder="07X XXX XXXX" /></label>
        <label className="stock-field">Vehicle make and model<input value={f.vehicle} onChange={(e) => set("vehicle", e.target.value)} placeholder="Toyota Prius" /></label>
        <label className="stock-field">Odometer (km)<input inputMode="numeric" value={f.odometer} onChange={(e) => set("odometer", e.target.value.replace(/\D/g, ""))} /></label>
        <label className="stock-field">Mechanic<input value={f.mechanic} onChange={(e) => set("mechanic", e.target.value)} /></label>
      </div>
      {known && <p className="stock-help ws-known">{known}</p>}
      <label className="stock-field">Complaint / work to do<input value={f.summary} onChange={(e) => set("summary", e.target.value)} placeholder="Engine oil change, brake noise" /></label>
      {error && <p role="alert" className="stock-error">{error}</p>}
      <div className="stock-form-actions"><button className="button primary large" disabled={busy}>{busy ? "Saving…" : "Create job"}</button></div>
    </form>
  );
}

const toPart = (p: Job["parts"][0]): Part => ({ name: p.name, quantity: String(p.quantity), unit_price: String(p.unit_price) });
const toLabour = (l: Job["labour"][0]): Labour => ({ description: l.description, amount: String(l.amount) });
const n = (s: string) => (Number.isFinite(Number(s)) ? Number(s) : 0);

function JobPage({ id, owner, go }: { id: string; owner: boolean; go: (p: Page, m?: string) => void }) {
  const { data, error: loadError, reload } = useLoad<Job>("/api/workshop/jobs/" + id);
  const [job, setJob] = useState<Job | null>(null), [f, setF] = useState<Record<string, string>>({});
  const [parts, setParts] = useState<Part[]>([]), [labour, setLabour] = useState<Labour[]>([]), [dirty, setDirty] = useState(false);
  const [error, setError] = useState(""), [busy, setBusy] = useState(false), [saved, setSaved] = useState("");
  const command = useCommand();
  const adopt = (j: Job) => {
    setJob(j); setDirty(false);
    setF({ customer: j.customer, phone: j.phone, vehicle: j.vehicle, odometer: j.odometer == null ? "" : String(j.odometer), summary: j.summary, mechanic: j.mechanic, notes: j.notes, discount: j.discount ? String(j.discount) : "", next_service_date: j.next_service_date || "", next_service_km: j.next_service_km == null ? "" : String(j.next_service_km) });
    setParts(j.parts.map(toPart)); setLabour(j.labour.map(toLabour));
  };
  useEffect(() => { if (data) adopt(data); }, [data]);
  if (!job) return <p className="stock-help">{loadError || "Loading job…"}</p>;
  const locked = job.status !== "OPEN";
  const set = (k: string, v: string) => { setF((x) => ({ ...x, [k]: v })); setDirty(true); };
  const partTotal = parts.reduce((s, p) => s + Math.round(n(p.quantity) * n(p.unit_price) * 100) / 100, 0);
  const labourTotal = labour.reduce((s, l) => s + n(l.amount), 0);
  const total = partTotal + labourTotal - n(f.discount);
  const body = () => ({
    revision: job.revision, customer: f.customer, phone: f.phone, vehicle: f.vehicle, odometer: f.odometer === "" ? null : Number(f.odometer), summary: f.summary, mechanic: f.mechanic, notes: f.notes,
    parts: parts.filter((p) => p.name.trim()).map((p) => ({ name: p.name, quantity: n(p.quantity), unit_price: n(p.unit_price) })),
    labour: labour.filter((l) => l.description.trim()).map((l) => ({ description: l.description, amount: n(l.amount) })),
    discount: n(f.discount), next_service_date: f.next_service_date, next_service_km: f.next_service_km === "" ? null : Number(f.next_service_km),
  });
  const save = async () => { const updated = await command<Job>("/api/workshop/jobs/" + id, body(), "PATCH"); adopt(updated); return updated; };
  const run = async (work: () => Promise<void>) => { setBusy(true); setError(""); setSaved(""); try { await work(); } catch (e) { setError((e as Error).message); } finally { setBusy(false); } };
  const invoice = () => run(async () => {
    const current = dirty ? await save() : job;
    const made = await command<Invoice>("/api/workshop/jobs/" + id + "/invoice", { revision: current.revision });
    go({ name: "invoice", id: made.id }, "Invoice " + made.invoice_number + " created.");
  });
  const cancel = () => { if (confirm("Cancel this job? It stays in the vehicle history as cancelled.")) void run(async () => { await command("/api/workshop/jobs/" + id + "/cancel", {}); await reload(); }); };
  const line = <T,>(list: T[], put: (x: T[]) => void, i: number, patch: Partial<T>) => { put(list.map((x, k) => (k === i ? { ...x, ...patch } : x))); setDirty(true); };
  return (
    <div className="ws-job">
      <div className="ws-bar">
        <button className="button secondary small" onClick={() => go({ name: "jobs" })}>← Jobs</button>
        <button className="button secondary small" onClick={() => go({ name: "vehicle", id: regKey(job.registration) })}>Vehicle file</button>
        <Pill s={job.status} />
        {job.invoice_id && <button className="button secondary small" onClick={() => go({ name: "invoice", id: job.invoice_id! })}>Open invoice {job.invoice_number}</button>}
      </div>
      <div className="stock-panel">
        <h2>{job.registration} <small>{dateOnly(job.created_at)}</small></h2>
        <div className="stock-form-grid">
          <label className="stock-field">Customer name<input disabled={locked} value={f.customer || ""} onChange={(e) => set("customer", e.target.value)} /></label>
          <label className="stock-field">Contact number<input disabled={locked} value={f.phone || ""} onChange={(e) => set("phone", e.target.value)} /></label>
          <label className="stock-field">Vehicle make and model<input disabled={locked} value={f.vehicle || ""} onChange={(e) => set("vehicle", e.target.value)} /></label>
          <label className="stock-field">Odometer (km)<input disabled={locked} inputMode="numeric" value={f.odometer || ""} onChange={(e) => set("odometer", e.target.value.replace(/\D/g, ""))} /></label>
          <label className="stock-field">Mechanic<input disabled={locked} value={f.mechanic || ""} onChange={(e) => set("mechanic", e.target.value)} /></label>
          <label className="stock-field">Complaint / work<input disabled={locked} value={f.summary || ""} onChange={(e) => set("summary", e.target.value)} /></label>
        </div>
      </div>
      <div className="stock-panel">
        <h3>Parts</h3>
        {parts.map((p, i) => (
          <div className="ws-line" key={i}>
            <input disabled={locked} aria-label="Part name" placeholder="Part name" value={p.name} onChange={(e) => line(parts, setParts, i, { name: e.target.value })} />
            <input disabled={locked} aria-label="Quantity" inputMode="decimal" value={p.quantity} onChange={(e) => line(parts, setParts, i, { quantity: e.target.value })} />
            <input disabled={locked} aria-label="Unit price" inputMode="decimal" placeholder="Price" value={p.unit_price} onChange={(e) => line(parts, setParts, i, { unit_price: e.target.value })} />
            <output>{lkr(n(p.quantity) * n(p.unit_price))}</output>
            {!locked && <button className="icon-button" aria-label="Remove part" onClick={() => { setParts(parts.filter((_, k) => k !== i)); setDirty(true); }}>×</button>}
          </div>
        ))}
        {!locked && <button className="button secondary small" onClick={() => { setParts([...parts, { name: "", quantity: "1", unit_price: "" }]); setDirty(true); }}>+ Add part</button>}
        <h3>Labour</h3>
        {labour.map((l, i) => (
          <div className="ws-line labour" key={i}>
            <input disabled={locked} aria-label="Labour description" placeholder="What was done" value={l.description} onChange={(e) => line(labour, setLabour, i, { description: e.target.value })} />
            <input disabled={locked} aria-label="Labour amount" inputMode="decimal" placeholder="Amount" value={l.amount} onChange={(e) => line(labour, setLabour, i, { amount: e.target.value })} />
            {!locked && <button className="icon-button" aria-label="Remove labour" onClick={() => { setLabour(labour.filter((_, k) => k !== i)); setDirty(true); }}>×</button>}
          </div>
        ))}
        {!locked && <button className="button secondary small" onClick={() => { setLabour([...labour, { description: "", amount: "" }]); setDirty(true); }}>+ Add labour</button>}
        <div className="ws-totals">
          <span>Parts <b>{lkr(partTotal)}</b></span><span>Labour <b>{lkr(labourTotal)}</b></span>
          <label>Discount <input disabled={locked} inputMode="decimal" value={f.discount || ""} onChange={(e) => set("discount", e.target.value)} placeholder="0" /></label>
          <span className="grand">Total (LKR) <b>{lkr(total)}</b></span>
        </div>
      </div>
      <div className="stock-panel">
        <h3>Next service (optional)</h3>
        <div className="stock-form-grid">
          <label className="stock-field">Date<input disabled={locked} type="date" value={f.next_service_date || ""} onChange={(e) => set("next_service_date", e.target.value)} /></label>
          <label className="stock-field">At odometer (km)<input disabled={locked} inputMode="numeric" value={f.next_service_km || ""} onChange={(e) => set("next_service_km", e.target.value.replace(/\D/g, ""))} /></label>
        </div>
        <label className="stock-field">Notes<input disabled={locked} value={f.notes || ""} onChange={(e) => set("notes", e.target.value)} /></label>
      </div>
      {error && <p role="alert" className="stock-error">{error}</p>}
      {saved && <p className="stock-notice ws-notice">{saved}</p>}
      {!locked && (
        <div className="stock-form-actions">
          {owner && <button className="button secondary" disabled={busy} onClick={cancel}>Cancel job</button>}
          <button className="button secondary" disabled={busy || !dirty} onClick={() => void run(async () => { await save(); setSaved("Saved."); })}>Save</button>
          <button className="button primary" disabled={busy || total <= 0 && !parts.length && !labour.length} onClick={() => void invoice()}>Create invoice</button>
        </div>
      )}
    </div>
  );
}

function Vehicles({ open }: { open: (id: string) => void }) {
  const [search, setSearch] = useState("");
  const { data, error } = useLoad<Vehicle[]>("/api/workshop/vehicles?search=" + encodeURIComponent(search));
  return (
    <>
      <div className="report-filters"><input className="report-search ws-wide" aria-label="Search vehicles" placeholder="Vehicle number, owner or phone" value={search} onChange={(e) => setSearch(e.target.value)} /></div>
      {!data ? <p className="stock-help">{error || "Loading…"}</p> : (
        <div className="stock-table-wrap">
          <table className="stock-table">
            <thead><tr><th>Vehicle</th><th>Owner</th><th>Last km</th><th>Next service</th></tr></thead>
            <tbody>{data.map((v) => (
              <tr key={v.id} className="ws-row" onClick={() => open(v.id)}>
                <td><strong>{v.registration}</strong><small>{v.make}</small></td><td>{v.owner}<small>{v.phone}</small></td>
                <td>{v.last_km ?? "—"}</td><td>{v.next_service_date || (v.next_service_km ? v.next_service_km + " km" : "—")}</td>
              </tr>))}</tbody>
          </table>
          {!data.length && <Empty>No vehicles yet. They appear when you create a job.</Empty>}
        </div>
      )}
    </>
  );
}

function VehiclePage({ id, go }: { id: string; go: (p: Page, m?: string) => void }) {
  const { data: v, error } = useLoad<Vehicle>("/api/workshop/vehicles/" + id);
  if (!v) return <p className="stock-help">{error || "Loading…"}</p>;
  const spent = (v.history || []).filter((h) => h.status === "INVOICED").reduce((s, h) => s + h.total, 0);
  return (
    <div>
      <div className="ws-bar">
        <button className="button secondary small" onClick={() => go({ name: "vehicles" })}>← Vehicles</button>
        <button className="button primary small" onClick={() => go({ name: "new", reg: v.registration })}>+ New job for this vehicle</button>
        <button className="button secondary small" onClick={() => void download("/api/workshop/vehicles/" + id + "/history.pdf", "history-" + id + ".pdf").catch((e) => alert(e.message))}>Download history PDF</button>
      </div>
      <div className="stock-panel">
        <h2>{v.registration} <small>{v.make}</small></h2>
        <p>Owner: <b>{v.owner}</b>{v.phone && <> · <a href={"tel:" + v.phone}>{v.phone}</a></>}</p>
        <p>Last odometer: <b>{v.last_km ?? "—"}</b> km · Next service: <b>{v.next_service_date || "—"}{v.next_service_km ? " / " + v.next_service_km + " km" : ""}</b></p>
        <p>Invoiced so far: <b>LKR {lkr(spent)}</b></p>
      </div>
      <div className="stock-table-wrap">
        <table className="stock-table">
          <thead><tr><th>Date</th><th>Work</th><th>km</th><th>Status</th><th className="num">Total (LKR)</th></tr></thead>
          <tbody>{(v.history || []).map((h) => (
            <tr key={h.id} className="ws-row" onClick={() => go({ name: "job", id: h.id })}>
              <td>{dateOnly(h.created_at)}</td><td>{h.summary || "—"}{h.invoice_number && <small>{h.invoice_number}</small>}</td><td>{h.odometer ?? "—"}</td><td><Pill s={h.status} /></td><td className="num">{lkr(h.total)}</td>
            </tr>))}</tbody>
        </table>
      </div>
    </div>
  );
}

function Due({ go }: { go: (p: Page, m?: string) => void }) {
  const { data, error } = useLoad<Vehicle[]>("/api/workshop/service-due");
  if (!data) return <p className="stock-help">{error || "Loading…"}</p>;
  const why: Record<string, string> = { overdue: "Overdue", soon: "Due soon", km: "Near service km" };
  return (
    <div className="stock-table-wrap">
      <p className="stock-help">Vehicles due within 14 days (or within 300 km of the service km). Call the customer, then press New job.</p>
      <table className="stock-table">
        <thead><tr><th>Vehicle</th><th>Owner</th><th>Due</th><th /></tr></thead>
        <tbody>{data.map((v) => (
          <tr key={v.id}>
            <td><strong>{v.registration}</strong><small>{v.make}</small></td>
            <td>{v.owner}{v.phone && <small><a href={"tel:" + v.phone}>{v.phone}</a></small>}</td>
            <td><span className={"ws-pill " + (v.reason === "overdue" ? "void" : "partial")}>{why[v.reason || ""]}</span><small>{v.next_service_date}{v.next_service_km ? " / " + v.next_service_km + " km" : ""}</small></td>
            <td><button className="button secondary small" onClick={() => go({ name: "new", reg: v.registration })}>New job</button></td>
          </tr>))}</tbody>
      </table>
      {!data.length && <Empty>Nothing due. Set a next service date on a job and it shows up here.</Empty>}
    </div>
  );
}

function Invoices({ open }: { open: (id: string) => void }) {
  const { data, error } = useLoad<Omit<Invoice, "payments">[]>("/api/workshop/invoices");
  const [filter, setFilter] = useState("UNPAID");
  if (!data) return <p className="stock-help">{error || "Loading…"}</p>;
  const owing = data.filter((i) => i.status === "UNPAID" || i.status === "PARTIAL");
  const shown = filter === "ALL" ? data : owing;
  return (
    <>
      <div className="report-filters">
        <button className={"report-chip" + (filter === "UNPAID" ? " chosen" : "")} onClick={() => setFilter("UNPAID")}><b>{owing.length}</b> Not fully paid</button>
        <button className={"report-chip" + (filter === "ALL" ? " chosen" : "")} onClick={() => setFilter("ALL")}><b>{data.length}</b> All invoices</button>
        <span className="ws-owed">Owed: <b>LKR {lkr(owing.reduce((s, i) => s + i.total - i.paid, 0))}</b></span>
      </div>
      <div className="stock-table-wrap">
        <table className="stock-table">
          <thead><tr><th>Invoice</th><th>Vehicle</th><th>Customer</th><th>Status</th><th className="num">Total</th><th className="num">Balance</th></tr></thead>
          <tbody>{shown.map((i) => (
            <tr key={i.id} className="ws-row" onClick={() => open(i.id)}>
              <td><strong>{i.invoice_number}</strong><small>{dateOnly(i.created_at)}</small></td><td>{i.registration}</td><td>{i.customer}<small>{i.phone}</small></td>
              <td><Pill s={i.status} /></td><td className="num">{lkr(i.total)}</td><td className="num">{i.status === "VOID" ? "—" : lkr(i.total - i.paid)}</td>
            </tr>))}</tbody>
        </table>
        {!shown.length && <Empty>{filter === "ALL" ? "No invoices yet." : "Everything is paid."}</Empty>}
      </div>
    </>
  );
}

function InvoicePage({ id, owner, go }: { id: string; owner: boolean; go: (p: Page, m?: string) => void }) {
  const { data: inv, error: loadError, reload } = useLoad<Invoice>("/api/workshop/invoices/" + id);
  const [amount, setAmount] = useState(""), [method, setMethod] = useState("CASH"), [note, setNote] = useState("");
  const [error, setError] = useState(""), [busy, setBusy] = useState(false);
  const command = useCommand();
  if (!inv) return <p className="stock-help">{loadError || "Loading…"}</p>;
  const balance = inv.total - inv.paid;
  const run = async (work: () => Promise<void>) => { setBusy(true); setError(""); try { await work(); } catch (e) { setError((e as Error).message); } finally { setBusy(false); } };
  const pay = (e: React.FormEvent) => { e.preventDefault(); void run(async () => { await command("/api/workshop/invoices/" + id + "/payments", { amount: n(amount || String(balance)), method, note }); setAmount(""); setNote(""); await reload(); }); };
  const voidIt = () => { if (confirm("Void this invoice? The job reopens so you can correct it.")) void run(async () => { await command("/api/workshop/invoices/" + id + "/void", {}); go({ name: "job", id: inv.job_id }, "Invoice voided. The job is open again."); }); };
  return (
    <div>
      <div className="ws-bar">
        <button className="button secondary small" onClick={() => go({ name: "unpaid" })}>← Invoices</button>
        <button className="button secondary small" onClick={() => go({ name: "job", id: inv.job_id })}>View job</button>
        <button className="button primary small" onClick={() => void download("/api/workshop/invoices/" + id + "/pdf", inv.invoice_number + ".pdf").catch((e) => setError(e.message))}>Download PDF</button>
        {owner && inv.status !== "VOID" && inv.paid === 0 && <button className="button secondary small" disabled={busy} onClick={voidIt}>Void invoice</button>}
      </div>
      <div className="stock-panel">
        <h2>{inv.invoice_number} <Pill s={inv.status} /></h2>
        <p>{inv.registration}{inv.vehicle && " · " + inv.vehicle} · {inv.customer}{inv.phone && " · " + inv.phone}</p>
        <p>Total <b>LKR {lkr(inv.total)}</b> · Paid <b>LKR {lkr(inv.paid)}</b> · Balance <b>LKR {lkr(inv.status === "VOID" ? 0 : balance)}</b></p>
      </div>
      {inv.payments.length > 0 && (
        <div className="stock-table-wrap"><table className="stock-table">
          <thead><tr><th>Date</th><th>How</th><th>Note</th><th className="num">Amount</th></tr></thead>
          <tbody>{inv.payments.map((p) => <tr key={p.id}><td>{dateOnly(p.at)}</td><td>{p.method}</td><td>{p.note}</td><td className="num">{lkr(p.amount)}</td></tr>)}</tbody>
        </table></div>
      )}
      {inv.status !== "VOID" && balance > 0 && (
        <form className="stock-panel ws-pay" onSubmit={pay}>
          <h3>Add a payment</h3>
          <div className="stock-form-grid">
            <label className="stock-field">Amount (LKR)<input inputMode="decimal" value={amount} placeholder={String(balance)} onChange={(e) => setAmount(e.target.value)} /></label>
            <label className="stock-field">Paid by<select value={method} onChange={(e) => setMethod(e.target.value)}><option value="CASH">Cash</option><option value="CARD">Card</option><option value="BANK">Bank transfer</option><option value="OTHER">Other</option></select></label>
          </div>
          <label className="stock-field">Note<input value={note} onChange={(e) => setNote(e.target.value)} /></label>
          <div className="stock-form-actions"><button className="button primary" disabled={busy}>Save payment</button></div>
        </form>
      )}
      {error && <p role="alert" className="stock-error">{error}</p>}
    </div>
  );
}

function ReportPage() {
  const first = today().slice(0, 8) + "01";
  const [from, setFrom] = useState(first), [until, setUntil] = useState(today());
  const { data, error } = useLoad<Report>("/api/workshop/report?from=" + from + "&until=" + until);
  const [pdfError, setPdfError] = useState("");
  return (
    <div>
      <div className="report-filters">
        <label className="ws-date">From <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} /></label>
        <label className="ws-date">Until <input type="date" value={until} onChange={(e) => setUntil(e.target.value)} /></label>
        <button className="button secondary small" onClick={() => void download("/api/workshop/report.pdf?from=" + from + "&until=" + until, "workshop-report-" + from + "_" + until + ".pdf").catch((e) => setPdfError(e.message))}>Download PDF</button>
      </div>
      {(error || pdfError) && <p role="alert" className="stock-error">{error || pdfError}</p>}
      {data && (
        <>
          <div className="ws-cards">
            {([["Invoices", String(data.invoices)], ["Vehicles", String(data.vehicles)], ["Parts", lkr(data.parts_total)], ["Labour", lkr(data.labour_total)], ["Discounts", lkr(data.discount)], ["Billed", lkr(data.total)], ["Received", lkr(data.paid)], ["Unpaid (period)", lkr(data.unpaid)], ["Unpaid (all time)", lkr(data.outstanding_all_time)]] as [string, string][]).map(([k, v]) => (
              <div className="ws-card" key={k}><small>{k}</small><b>{v}</b></div>
            ))}
          </div>
          <div className="stock-table-wrap"><table className="stock-table">
            <thead><tr><th>Mechanic</th><th className="num">Jobs</th><th className="num">Billed (LKR)</th></tr></thead>
            <tbody>{data.by_mechanic.map((m) => <tr key={m.mechanic}><td>{m.mechanic}</td><td className="num">{m.jobs}</td><td className="num">{lkr(m.total)}</td></tr>)}</tbody>
          </table>{!data.by_mechanic.length && <Empty>No invoices in this period.</Empty>}</div>
        </>
      )}
    </div>
  );
}
