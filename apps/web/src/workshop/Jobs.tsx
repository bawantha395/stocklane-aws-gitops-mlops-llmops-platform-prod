import { t } from "../i18n";
import { useEffect, useRef, useState } from "react";
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
          {([["OPEN", t("Open"), count("OPEN")], ["INVOICED", t("Invoiced"), count("INVOICED")], ["ALL", t("All"), data.length]] as [string, string, number][]).map(([k, label, n]) => (
            <button key={k} className={"ws-chip" + (filter === k ? " chosen" : "")} onClick={() => setFilter(k)}><b>{n}</b> {label}</button>
          ))}
        </div>
        <input aria-label="Search jobs" placeholder={t("Search number, customer, phone or work")} value={q} onChange={(e) => setQ(e.target.value)} />
      </div>
      <div className="ws-cards">
        {shown.map((j) => <JobItem key={j.id} j={j} onOpen={() => go({ name: "job", id: j.id })} />)}
        {!shown.length && <Empty action={data.length ? undefined : { label: "+ " + t("New job"), onClick: () => go({ name: "new" }) }}>{data.length ? "No jobs match." : "No jobs yet. Start the first one when a vehicle comes in."}</Empty>}
      </div>
    </>
  );
}

export function NewJob({ reg: start }: { reg?: string }) {
  const { go } = useWs();
  const [f, setF] = useState({ registration: start || "", customer: "", address: "", phone: "", vehicle: "", odometer: "", summary: "", mechanic: "" });
  const [error, setError] = useState(""), [busy, setBusy] = useState(false);
  const [plate, setPlate] = useState(""), [front, setFront] = useState(""), [before, setBefore] = useState<string[]>([]);
  const command = useCommand();
  const [step, setStep] = useState(0);
  const formRef = useRef<HTMLFormElement>(null);
  const next = () => { const bad = Array.from(formRef.current?.querySelectorAll<HTMLInputElement>('[data-step="' + step + '"] [required]') || []).find((x) => !x.checkValidity()); if (bad) { bad.reportValidity(); return; } setStep((n) => Math.min(n + 1, 2)); window.scrollTo({ top: 0 }); };
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
      <form ref={formRef} className="ws-card ws-form ws-stepped" data-step-now={step} onSubmit={submit}>
        <h2>{t("New repair job")}</h2>
        <ol className="ws-stepper" aria-label={t("Steps")}>{[t("Vehicle"), t("Photos"), t("Work")].map((l, i) => <li key={l} className={(i === step ? "on " : "") + (i < step ? "done" : "")}><button type="button" onClick={() => i <= step && setStep(i)}><i>{i < step ? "✓" : i + 1}</i>{l}</button></li>)}</ol>
        <div className="ws-step" data-step="0">
        <label className="ws-field">{t("Vehicle number")} *<input required autoFocus autoCapitalize="characters" value={f.registration} onChange={(e) => set("registration", e.target.value)} placeholder="CAB-1234" /></label>
        {v && <p className="ws-known">Known vehicle: {v.make || "model not set"}, {v.visits} earlier visit{v.visits === 1 ? "" : "s"}, last seen at {kmText(v.last_km)}. Details filled in below.</p>}
        <div className="ws-grid2">
          <label className="ws-field">{t("Customer name")} *<input required value={f.customer} onChange={(e) => set("customer", e.target.value)} /></label>
          <label className="ws-field">{t("Contact number")}<input inputMode="tel" value={f.phone} onChange={(e) => set("phone", e.target.value)} placeholder="07X XXX XXXX" /></label>
          <label className="ws-field">{t("Customer address")} <small>({t("optional")})</small><textarea rows={2} value={f.address} onChange={(e) => set("address", e.target.value)} /></label>
          <label className="ws-field">{t("Make and model")}<input value={f.vehicle} onChange={(e) => set("vehicle", e.target.value)} placeholder="Toyota Prius" /></label>
          <label className="ws-field">{t("Odometer (km)")}<input inputMode="numeric" value={f.odometer} onChange={(e) => set("odometer", e.target.value.replace(/\D/g, ""))} /></label>
        </div>
        </div>
        <div className="ws-step" data-step="2">
        {lower && <p className="ws-warn">That is lower than the last recorded {kmText(v?.last_km)}. Check the reading.</p>}
        <label className="ws-field">{t("Complaint / work to do")}<textarea rows={2} value={f.summary} onChange={(e) => set("summary", e.target.value)} placeholder="Engine oil change, brake noise" /></label>
        <label className="ws-field">{t("Mechanic")}<input value={f.mechanic} onChange={(e) => set("mechanic", e.target.value)} /></label>
        </div>
        <div className="ws-step" data-step="1">
        <div className="ws-photos" data-tour="job-photos">
          <strong>{t("Photos")} <small>({t("optional")})</small></strong>
          <div className="ws-photo-grid">
            <PhotoSlot kind="plate" label={t("Number plate")} id={plate} onId={setPlate} />
            <PhotoSlot kind="front" label={t("Front of the vehicle")} id={front || v?.front_photo || ""} onId={setFront} saved={!front && !!v?.front_photo} />
          </div>
          <span className="ws-photo-label">{t("Condition when it arrived (before fixing)")}</span>
          <PhotoStrip ids={before} onAdd={(id) => setBefore((x) => [...x, id])} onRemove={(id) => setBefore((x) => x.filter((y) => y !== id))} />
        </div>
        </div>
        {error && <p role="alert" className="stock-error">{error}</p>}
        <div className="ws-step-nav">{step > 0 ? <button type="button" className="button secondary" onClick={() => setStep(step - 1)}>{t("Back")}</button> : <button type="button" className="button secondary" onClick={() => go({ name: "home" })}>{t("Cancel")}</button>}{step < 2 ? <button key="next" type="button" className="button primary large" onClick={next}>{t("Next")}</button> : <button key="create" type="submit" className="button primary large" disabled={busy}>{busy ? t("Saving…") : t("Create job")}</button>}</div>
        <div className="ws-actions"><button className="button secondary" type="button" onClick={() => go({ name: "home" })}>{t("Cancel")}</button><button className="button primary large" disabled={busy}>{busy ? t("Saving…") : t("Create job")}</button></div>
      </form>
      <PastRepairs regKey={key} />
    </div>
  );
}
