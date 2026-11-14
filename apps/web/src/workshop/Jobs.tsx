import { useEffect, useState } from "react";
import { JobItem } from "./Dashboard";
import { PastRepairs } from "./Vehicles";
import { PhotoSlot, PhotoStrip } from "./Photos";
import { Empty, Loading, kmText, regKey, useCommand, useDebounced, useLoad, useWs, type Job, type Vehicle } from "./common";

export function Jobs() {
  const { go } = useWs();
  const { data, error } = useLoad<Job[]>("/api/workshop/jobs");
  const [filter, setFilter] = useState("OPEN"), [q, setQ] = useState("");
  if (!data) return <Loading error={error} />;
  const needle = q.trim().toLowerCase();
  const shown = data.filter((j) => (filter === "ALL" || j.status === filter) && (!needle || (j.registration + " " + j.customer + " " + j.phone + " " + j.summary).toLowerCase().includes(needle)));
  const count = (s: string) => data.filter((j) => j.status === s).length;
  return (
    <>
      <div className="ws-toolbar">
        <div className="ws-chips">
          {([["OPEN", "Open", count("OPEN")], ["INVOICED", "Invoiced", count("INVOICED")], ["ALL", "All", data.length]] as [string, string, number][]).map(([k, label, n]) => (
            <button key={k} className={"ws-chip" + (filter === k ? " chosen" : "")} onClick={() => setFilter(k)}><b>{n}</b> {label}</button>
          ))}
        </div>
        <input aria-label="Search jobs" placeholder="Search number, customer, phone or work" value={q} onChange={(e) => setQ(e.target.value)} />
      </div>
      <div className="ws-list">
        {shown.map((j) => <JobItem key={j.id} j={j} onOpen={() => go({ name: "job", id: j.id })} />)}
        {!shown.length && <Empty>{data.length ? "No jobs match." : "No jobs yet. A job is one vehicle\u2019s visit: its repairs, parts and bill. Press + New job to start the first one."}</Empty>}
      </div>
    </>
  );
}

export function NewJob({ reg: start }: { reg?: string }) {
  const { go } = useWs();
  const [f, setF] = useState({ registration: start || "", customer: "", phone: "", vehicle: "", odometer: "", summary: "", mechanic: "" });
  const [error, setError] = useState(""), [busy, setBusy] = useState(false);
  const [plate, setPlate] = useState(""), [front, setFront] = useState(""), [before, setBefore] = useState<string[]>([]);
  const command = useCommand();
  const set = (k: keyof typeof f, v: string) => setF((x) => ({ ...x, [k]: v }));
  const key = useDebounced(regKey(f.registration), 300);
  const known = useLoad<Vehicle>(key.length >= 2 ? "/api/workshop/vehicles/" + key : null);
  const v = key.length >= 2 ? known.data : null;
  // Fill the empty fields from the vehicle file as soon as it is found.
  useEffect(() => {
    if (v) setF((x) => ({ ...x, customer: x.customer || v.owner || "", phone: x.phone || v.phone || "", vehicle: x.vehicle || v.make || "" }));
  }, [v?.id]); // eslint-disable-line react-hooks/exhaustive-deps
  const lower = v?.last_km != null && f.odometer !== "" && Number(f.odometer) < v.last_km;
  const submit = async (e: React.FormEvent) => {
    e.preventDefault(); setBusy(true); setError("");
    try { const job = await command<Job>("/api/workshop/jobs", { ...f, odometer: f.odometer === "" ? null : Number(f.odometer), plate_photo: plate || undefined, front_photo: front || undefined, before_photos: before }); go({ name: "job", id: job.id }, "Job created. Add the parts and labour."); }
    catch (err) { setError((err as Error).message); setBusy(false); }
  };
  return (
    <div>
      <form className="ws-card ws-form" onSubmit={submit}>
        <h2>New repair job</h2>
        <label className="ws-field">Vehicle number *<input required autoFocus autoCapitalize="characters" value={f.registration} onChange={(e) => set("registration", e.target.value)} placeholder="CAB-1234" /></label>
        {v && <p className="ws-known">Known vehicle: {v.make || "model not set"}, {v.visits} earlier visit{v.visits === 1 ? "" : "s"}, last seen at {kmText(v.last_km)}. Details filled in below.</p>}
        <div className="ws-grid2">
          <label className="ws-field">Customer name *<input required value={f.customer} onChange={(e) => set("customer", e.target.value)} /></label>
          <label className="ws-field">Contact number<input inputMode="tel" value={f.phone} onChange={(e) => set("phone", e.target.value)} placeholder="07X XXX XXXX" /></label>
          <label className="ws-field">Make and model<input value={f.vehicle} onChange={(e) => set("vehicle", e.target.value)} placeholder="Toyota Prius" /></label>
          <label className="ws-field">Odometer (km)<input inputMode="numeric" value={f.odometer} onChange={(e) => set("odometer", e.target.value.replace(/\D/g, ""))} /></label>
        </div>
        {lower && <p className="ws-warn">That is lower than the last recorded {kmText(v?.last_km)}. Check the reading.</p>}
        <label className="ws-field">Complaint / work to do<textarea rows={2} value={f.summary} onChange={(e) => set("summary", e.target.value)} placeholder="Engine oil change, brake noise" /></label>
        <label className="ws-field">Mechanic<input value={f.mechanic} onChange={(e) => set("mechanic", e.target.value)} /></label>
        <div className="ws-photos" data-tour="job-photos">
          <strong>Photos <small>(optional)</small></strong>
          <div className="ws-photo-grid">
            <PhotoSlot kind="plate" label="Number plate" id={plate} onId={setPlate} />
            <PhotoSlot kind="front" label="Front of the vehicle" id={front || v?.front_photo || ""} onId={setFront} saved={!front && !!v?.front_photo} />
          </div>
          <span className="ws-photo-label">Condition when it arrived (before fixing)</span>
          <PhotoStrip ids={before} onAdd={(id) => setBefore((x) => [...x, id])} onRemove={(id) => setBefore((x) => x.filter((y) => y !== id))} />
        </div>
        {error && <p role="alert" className="stock-error">{error}</p>}
        <div className="ws-actions"><button className="button secondary" type="button" onClick={() => go({ name: "home" })}>Cancel</button><button className="button primary large" disabled={busy}>{busy ? "Saving…" : "Create job"}</button></div>
      </form>
      <PastRepairs regKey={key} />
    </div>
  );
}
