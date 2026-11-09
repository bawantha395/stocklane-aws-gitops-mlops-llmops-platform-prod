import { useEffect, useMemo, useState } from "react";
import { Bill, PrintButton, billTotals, type BillData } from "./Bill";
import { PastRepairs } from "./Vehicles";
import { Loading, Pill, addDays, dateOnly, kmText, lkr, num, today, useCommand, useLoad, useWs, type Invoice, type Job } from "./common";

type PartRow = { name: string; quantity: string; unit_price: string };
type LabourRow = { description: string; amount: string };
type Suggest = { parts: { name: string; price: number; uses: number }[]; labour: { description: string; amount: number; uses: number }[] };

export function JobPage({ id }: { id: string }) {
  const { go, business, owner } = useWs();
  const { data, error: loadError, reload } = useLoad<Job>("/api/workshop/jobs/" + id);
  const sugg = useLoad<Suggest>("/api/workshop/suggestions").data;
  const [job, setJob] = useState<Job | null>(null);
  const [f, setF] = useState<Record<string, string>>({});
  const [parts, setParts] = useState<PartRow[]>([]), [labour, setLabour] = useState<LabourRow[]>([]);
  const [dirty, setDirty] = useState(false), [busy, setBusy] = useState(false), [error, setError] = useState(""), [saved, setSaved] = useState(""), [preview, setPreview] = useState(false);
  const command = useCommand();

  const adopt = (j: Job) => {
    setJob(j); setDirty(false);
    setF({ customer: j.customer, phone: j.phone, vehicle: j.vehicle, odometer: j.odometer == null ? "" : String(j.odometer), summary: j.summary, mechanic: j.mechanic, notes: j.notes,
      discount: j.discount ? String(j.discount) : "", next_service_date: j.next_service_date || "", next_service_km: j.next_service_km == null ? "" : String(j.next_service_km) });
    setParts(j.parts.map((p) => ({ name: p.name, quantity: String(p.quantity), unit_price: String(p.unit_price) })));
    setLabour(j.labour.map((l) => ({ description: l.description, amount: String(l.amount) })));
  };
  useEffect(() => { if (data) adopt(data); }, [data]);
  useEffect(() => {
    const warn = (e: BeforeUnloadEvent) => { if (dirty) e.preventDefault(); };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);

  const rate = job?.tax_rate ?? business.tax_rate;
  const lines = useMemo(() => ({
    parts: parts.filter((p) => p.name.trim()).map((p) => ({ name: p.name.trim(), quantity: num(p.quantity), unit_price: num(p.unit_price) })),
    labour: labour.filter((l) => l.description.trim()).map((l) => ({ description: l.description.trim(), amount: num(l.amount) })),
  }), [parts, labour]);
  const totals = billTotals({ ...lines, discount: num(f.discount), tax_rate: rate });
  if (!job) return <Loading error={loadError} />;
  const locked = job.status !== "OPEN";

  const set = (k: string, v: string) => { setF((x) => ({ ...x, [k]: v })); setDirty(true); };
  const body = () => ({
    revision: job.revision, customer: f.customer, phone: f.phone, vehicle: f.vehicle, odometer: f.odometer === "" ? null : Number(f.odometer), summary: f.summary, mechanic: f.mechanic, notes: f.notes,
    parts: lines.parts, labour: lines.labour, discount: num(f.discount), next_service_date: f.next_service_date, next_service_km: f.next_service_km === "" ? null : Number(f.next_service_km),
  });
  const save = async () => { const j = await command<Job>("/api/workshop/jobs/" + id, body(), "PATCH"); adopt(j); return j; };
  const run = async (work: () => Promise<void>) => { setBusy(true); setError(""); setSaved(""); try { await work(); } catch (e) { setError((e as Error).message); } finally { setBusy(false); } };
  const invoice = () => {
    if (!confirm("Create the invoice for LKR " + lkr(totals.total) + "? The job will be locked.")) return;
    void run(async () => {
      const current = dirty ? await save() : job;
      const made = await command<Invoice>("/api/workshop/jobs/" + id + "/invoice", { revision: current.revision });
      try { sessionStorage.setItem("ws.print", made.id); } catch { /* ignore */ }
      go({ name: "invoice", id: made.id }, "Invoice " + made.invoice_number + " created. Take a payment below.");
    });
  };
  const cancel = () => { if (confirm("Cancel this job? It stays in the vehicle history as cancelled.")) void run(async () => { await command("/api/workshop/jobs/" + id + "/cancel", {}); await reload(); }); };

  const part = (i: number, patch: Partial<PartRow>) => { setParts(parts.map((x, k) => (k === i ? { ...x, ...patch } : x))); setDirty(true); };
  const work = (i: number, patch: Partial<LabourRow>) => { setLabour(labour.map((x, k) => (k === i ? { ...x, ...patch } : x))); setDirty(true); };
  const partName = (i: number, name: string) => {
    const hit = sugg?.parts?.find((s) => s.name.toLowerCase() === name.trim().toLowerCase());
    part(i, { name, ...(hit && !parts[i].unit_price ? { unit_price: String(hit.price) } : {}) });
  };
  const workName = (i: number, description: string) => {
    const hit = sugg?.labour?.find((s) => s.description.toLowerCase() === description.trim().toLowerCase());
    work(i, { description, ...(hit && !labour[i].amount ? { amount: String(hit.amount) } : {}) });
  };
  const bill: BillData = {
    business, number: job.invoice_number, date: today(), draft: !locked, status: locked ? "INVOICED" : undefined, customer: f.customer, phone: f.phone, registration: job.registration,
    vehicle: f.vehicle, odometer: f.odometer === "" ? null : Number(f.odometer), mechanic: f.mechanic, summary: f.summary, ...lines, discount: num(f.discount),
    tax_name: business.tax_name, tax_rate: rate, next_service_date: f.next_service_date, next_service_km: f.next_service_km === "" ? null : Number(f.next_service_km),
  };
  const odo = f.odometer === "" ? 0 : Number(f.odometer);

  return (
    <div className="ws-job">
      <div className="ws-job-head">
        <div><h2>{job.registration}</h2><p>{dateOnly(job.created_at)} <Pill s={job.status} /></p></div>
        <div className="ws-bar">
          <button className="button secondary small" onClick={() => go({ name: "vehicle", id: job.vehicle_key })}>Vehicle file</button>
          {job.invoice_id && <button className="button primary small" onClick={() => go({ name: "invoice", id: job.invoice_id! })}>Invoice {job.invoice_number}</button>}
        </div>
      </div>

      <section className="ws-card">
        <h3>Customer and vehicle</h3>
        <div className="ws-grid2">
          <label className="ws-field">Customer name<input disabled={locked} value={f.customer || ""} onChange={(e) => set("customer", e.target.value)} /></label>
          <label className="ws-field">Contact number<input disabled={locked} inputMode="tel" value={f.phone || ""} onChange={(e) => set("phone", e.target.value)} /></label>
          <label className="ws-field">Make and model<input disabled={locked} value={f.vehicle || ""} onChange={(e) => set("vehicle", e.target.value)} /></label>
          <label className="ws-field">Odometer (km)<input disabled={locked} inputMode="numeric" value={f.odometer || ""} onChange={(e) => set("odometer", e.target.value.replace(/\D/g, ""))} /></label>
          <label className="ws-field">Mechanic<input disabled={locked} value={f.mechanic || ""} onChange={(e) => set("mechanic", e.target.value)} /></label>
          <label className="ws-field">Complaint / work<textarea disabled={locked} rows={2} value={f.summary || ""} onChange={(e) => set("summary", e.target.value)} /></label>
        </div>
      </section>

      <section className="ws-card">
        <h3>Parts</h3>
        <datalist id="ws-part-names">{sugg?.parts?.map((s) => <option key={s.name} value={s.name} />)}</datalist>
        <datalist id="ws-work-names">{sugg?.labour?.map((s) => <option key={s.description} value={s.description} />)}</datalist>
        {parts.map((p, i) => (
          <div className="ws-line" key={i}>
            <input className="ws-l-name" disabled={locked} list="ws-part-names" aria-label="Part name" placeholder="Part name" value={p.name} onChange={(e) => partName(i, e.target.value)} />
            <input className="ws-l-qty" disabled={locked} aria-label="Quantity" inputMode="decimal" value={p.quantity} onChange={(e) => part(i, { quantity: e.target.value })} />
            <input className="ws-l-price" disabled={locked} aria-label="Unit price" inputMode="decimal" placeholder="Price" value={p.unit_price} onChange={(e) => part(i, { unit_price: e.target.value })} />
            <output className="ws-l-total">{lkr(num(p.quantity) * num(p.unit_price))}</output>
            {!locked && <button className="ws-l-del" aria-label="Remove part" onClick={() => { setParts(parts.filter((_, k) => k !== i)); setDirty(true); }}>×</button>}
          </div>
        ))}
        {!locked && (
          <div className="ws-add">
            <button className="button secondary small" onClick={() => { setParts([...parts, { name: "", quantity: "1", unit_price: "" }]); setDirty(true); }}>+ Add part</button>
            {sugg?.parts?.slice(0, 5).map((s) => <button key={s.name} className="ws-quick" onClick={() => { setParts([...parts, { name: s.name, quantity: "1", unit_price: String(s.price) }]); setDirty(true); }}>{s.name}</button>)}
          </div>
        )}
        <h3>Labour</h3>
        {labour.map((l, i) => (
          <div className="ws-line labour" key={i}>
            <input className="ws-l-name" disabled={locked} list="ws-work-names" aria-label="Labour description" placeholder="What was done" value={l.description} onChange={(e) => workName(i, e.target.value)} />
            <input className="ws-l-price" disabled={locked} aria-label="Labour amount" inputMode="decimal" placeholder="Amount" value={l.amount} onChange={(e) => work(i, { amount: e.target.value })} />
            {!locked && <button className="ws-l-del" aria-label="Remove labour" onClick={() => { setLabour(labour.filter((_, k) => k !== i)); setDirty(true); }}>×</button>}
          </div>
        ))}
        {!locked && (
          <div className="ws-add">
            <button className="button secondary small" onClick={() => { setLabour([...labour, { description: "", amount: "" }]); setDirty(true); }}>+ Add labour</button>
            {sugg?.labour?.slice(0, 5).map((s) => <button key={s.description} className="ws-quick" onClick={() => { setLabour([...labour, { description: s.description, amount: String(s.amount) }]); setDirty(true); }}>{s.description}</button>)}
          </div>
        )}
        <dl className="ws-sum">
          <div><dt>Parts</dt><dd>{lkr(totals.parts)}</dd></div>
          <div><dt>Labour</dt><dd>{lkr(totals.labour)}</dd></div>
          <div><dt>Discount</dt><dd><input disabled={locked} inputMode="decimal" aria-label="Discount" placeholder="0" value={f.discount || ""} onChange={(e) => set("discount", e.target.value)} /></dd></div>
          {totals.tax > 0 && <div><dt>{business.tax_name} ({rate}%)</dt><dd>{lkr(totals.tax)}</dd></div>}
          <div className="grand"><dt>Total (LKR)</dt><dd>{lkr(totals.total)}</dd></div>
        </dl>
      </section>

      <section className="ws-card">
        <h3>Next service (optional)</h3>
        <div className="ws-grid2">
          <label className="ws-field">Date<input disabled={locked} type="date" value={f.next_service_date || ""} onChange={(e) => set("next_service_date", e.target.value)} /></label>
          <label className="ws-field">At odometer (km)<input disabled={locked} inputMode="numeric" value={f.next_service_km || ""} onChange={(e) => set("next_service_km", e.target.value.replace(/\D/g, ""))} /></label>
        </div>
        {!locked && (
          <div className="ws-add">
            {[[3, "+3 months"], [6, "+6 months"]].map(([m, label]) => <button key={label} className="ws-quick" onClick={() => set("next_service_date", addDays(today(), Number(m) * 30))}>{label}</button>)}
            {odo > 0 && [5000, 10000].map((n) => <button key={n} className="ws-quick" onClick={() => set("next_service_km", String(odo + n))}>+{n.toLocaleString("en")} km ({kmText(odo + n)})</button>)}
          </div>
        )}
        <label className="ws-field">Notes<textarea disabled={locked} rows={2} value={f.notes || ""} onChange={(e) => set("notes", e.target.value)} /></label>
      </section>

      <PastRepairs regKey={job.vehicle_key} skipJob={id} />
      {error && <p role="alert" className="stock-error">{error}</p>}
      {saved && <p className="stock-notice ws-notice" role="status">{saved}</p>}
      <div className="ws-actionbar">
        <span className="ws-actionbar-total"><small>{dirty ? "Unsaved changes" : "Total"}</small><b>LKR {lkr(totals.total)}</b></span>
        <button className="button secondary" disabled={busy} onClick={() => setPreview(true)}>Preview bill</button>
        {!locked && owner && <button className="button secondary" disabled={busy} onClick={cancel}>Cancel job</button>}
        {!locked && <button className="button secondary" disabled={busy || !dirty} onClick={() => void run(async () => { await save(); setSaved("Saved."); })}>Save</button>}
        {!locked && <button className="button primary" disabled={busy || (!lines.parts.length && !lines.labour.length)} onClick={invoice}>Create invoice</button>}
      </div>
      {preview && (
        <div className="ws-modal" role="dialog" aria-modal="true" aria-label="Bill preview">
          <div className="ws-modal-bar"><b>{locked ? "Bill" : "Draft bill (not issued yet)"}</b><span><PrintButton /> <button className="button primary small" onClick={() => setPreview(false)}>Close</button></span></div>
          <div className="ws-print"><Bill d={bill} /></div>
        </div>
      )}
    </div>
  );
}
