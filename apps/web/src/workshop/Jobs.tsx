import { t } from "../i18n";
import { askConfirm } from "../ui";
import { useEffect, useRef, useState } from "react";
import { JobItem } from "./Dashboard";
import { OwingNotice, PastRepairs } from "./Vehicles";
import { PhotoSlot, PhotoStrip } from "./Photos";
import { Rows, groupByVehicle } from "./Rows";
import { DateChips, SummaryBar, cap, ALL, inRange, useSaved, type Range } from "./DateRange";
import { Quotes } from "./Quotes";
import { Empty, Loading, dateOnly, kmText, lkr, regKey, useCommand, useDebounced, useLoad, useWs, type Job, type Vehicle } from "./common";

/** Work hub: one place for the three kinds of work. Jobs are the repairs in the workshop; estimates and quotations come before a job. */
export function Jobs({ tab: start }: { tab?: "JOBS" | "ESTIMATE" | "QUOTATION" }) {
  const [tab, setTab] = useState<"JOBS" | "ESTIMATE" | "QUOTATION">(start || "JOBS");
  const quotes = useLoad<{ kind?: string; status: string; expired?: boolean }[]>("/api/workshop/quotes").data;
  const jobs = useLoad<Job[]>("/api/workshop/jobs").data;
  const open = (k: string) => (quotes || []).filter((x) => (x.kind || "ESTIMATE") === k && ["DRAFT", "SENT", "APPROVED"].includes(x.status) && !x.expired).length;
  const tabs: ["JOBS" | "ESTIMATE" | "QUOTATION", string, number | undefined][] = [["JOBS", t("Jobs"), jobs?.filter((j) => j.status === "OPEN").length], ["ESTIMATE", t("Estimates"), quotes ? open("ESTIMATE") : undefined], ["QUOTATION", t("Quotations"), quotes ? open("QUOTATION") : undefined]];
  return (
    <>
      <div className="ws-hubtabs" role="tablist" aria-label={t("Work")}>
        {tabs.map(([k, label, n]) => <button key={k} role="tab" aria-selected={tab === k} data-tour={k === "JOBS" ? undefined : "ws-tab-" + (k === "ESTIMATE" ? "quotes" : "quotations")} className={tab === k ? "chosen" : ""} onClick={() => setTab(k)}>{label}{n !== undefined && <b>{n}</b>}</button>)}
      </div>
      {tab === "JOBS" ? <JobList /> : <Quotes key={tab} lock={tab} />}
    </>
  );
}

function JobList() {
  const { go } = useWs();
  const { data, error } = useLoad<Job[]>("/api/workshop/jobs");
  const [filter, setFilter] = useSaved("jobs.status", "OPEN"), [q, setQ] = useState(""), [range, setRange] = useSaved<Range>("jobs.range", ALL);
  if (!data) return <Loading error={error} />;
  const needle = q.trim().toLowerCase();
  const shown = data.filter((j) => (filter === "ALL" || j.status === filter) && inRange(j.created_at, range) && (!needle || ((j.job_no || "") + " " + j.registration + " " + j.customer + " " + j.phone + " " + j.summary).toLowerCase().includes(needle)));
  const count = (s: string) => data.filter((j) => j.status === s).length;
  // one row per vehicle: all its jobs side by side, newest job first. The vehicle with the newest job is the top row.
  const newest = [...data].sort((a, b) => (b.created_at < a.created_at ? -1 : 1))[0];
  // A job with no vehicle number gets a row of its own (it cannot be matched to a vehicle).
  const keyOf = (j: Job) => regKey(j.registration) || "none-" + j.id;
  const groups = groupByVehicle(shown, keyOf, (j) => j.created_at, (j) => regKey(j.registration) ? j.registration : t("No vehicle number"), (j) => [j.vehicle, j.customer].filter(Boolean).join(" · "),
    (items) => { const n = items.filter((j) => j.status === "OPEN").length; return n && filter !== "OPEN" ? n + " " + t("open") : ""; });
  return (
    <>
      <div className="ws-toolbar">
        <div className="ws-chips">
          {([["OPEN", t("Open"), count("OPEN")], ["INVOICED", t("Invoiced"), count("INVOICED")], ["ALL", t("All"), data.length]] as [string, string, number][]).map(([k, label, n]) => (
            <button key={k} className={"ws-chip" + (filter === k ? " chosen" : "")} onClick={() => setFilter(k)}><b>{n}</b> {label}</button>
          ))}
        </div>
        <input aria-label="Search jobs" placeholder={t("Search job no., vehicle, customer, phone or work")} value={q} onChange={(e) => setQ(e.target.value)} />
      </div>
      <DateChips value={range} onChange={setRange} />
      <SummaryBar text={cap(t("jobs")) + ": " + shown.length + " · LKR " + lkr(shown.reduce((s, j) => s + (j.total || 0), 0))} file="jobs"
        rows={shown.map((j) => ({ "Job no.": j.job_no || "", Date: dateOnly(j.created_at), "Vehicle no.": j.registration, Customer: j.customer, Phone: j.phone, Work: j.summary, Status: j.status, Invoice: j.invoice_number || "", "Total (LKR)": j.total }))} />
      <Rows groups={groups} idOf={(j) => j.id} latest={newest?.id} noun={t("vehicles")} render={(j) => <JobItem inRow j={j} onOpen={() => go({ name: "job", id: j.id })} />} />
      {!shown.length && <div className="ws-cards"><Empty>{data.length ? "No jobs match." : "No jobs yet. Start the first one when a vehicle comes in."}</Empty></div>}
    </>
  );
}

export function NewJob({ reg: start }: { reg?: string }) {
  const { go, business } = useWs();
  const [f, setF] = useState({ registration: start || "", customer: "", address: "", phone: "", vehicle: "", odometer: "", summary: "", mechanic: "", brought_by: "", brought_phone: "", chassis: "", invoice_type: "CASH" });
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
    if (v) setF((x) => ({ ...x, customer: x.customer || v.owner || "", phone: x.phone || v.phone || "", vehicle: x.vehicle || v.make || "", chassis: x.chassis || v.chassis || "" }));
  }, [v?.id]); // eslint-disable-line react-hooks/exhaustive-deps
  const lower = v?.last_km != null && f.odometer !== "" && Number(f.odometer) < v.last_km;
  const same = (x?: string, y?: string) => (x || "").toLowerCase().split(/\s+/).filter(Boolean).join(" ") === (y || "").toLowerCase().split(/\s+/).filter(Boolean).join(" ");
  const [ask, setAsk] = useState(false), askRef = useRef<HTMLDivElement>(null);
  useEffect(() => { if (ask) askRef.current?.scrollIntoView({ block: "center", behavior: "smooth" }); }, [ask]);
  const differs = !!v && !!v.owner && !!f.customer.trim() && !same(f.customer, v.owner);
  const openJobs = (v?.history || []).filter((h) => h.status === "OPEN");
  const create = async (customer: string, newOwner: boolean, extra: Record<string, string> = {}) => {
    setBusy(true); setError(""); setAsk(false);
    try {
      if (newOwner) await command("/api/workshop/vehicles/" + key + "/owner", { owner: f.customer, phone: f.phone });
      const job = await command<Job>("/api/workshop/jobs", { ...f, customer, ...extra, odometer: f.odometer === "" ? null : Number(f.odometer), plate_photo: plate || undefined, front_photo: front || undefined, before_photos: before });
      try { sessionStorage.setItem("ws.justmade", job.id); } catch { /* ignore */ }
      go({ name: "job", id: job.id }, (job.job_no ? job.job_no + " created. " : "Job created. ") + "Print the job card, then add the parts and labour.");
    }
    catch (err) { setError((err as Error).message); setBusy(false); }
  };
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (openJobs.length > 0 && !(await askConfirm(t("This vehicle already has an open job ({no}). Start another one anyway?", { no: openJobs[0]!.job_no || openJobs[0]!.summary || "" }), { confirm: t("Yes, start another") }))) return;
    if (differs) { setAsk(true); return; }
    create(f.customer, false);
  };
  return (
    <div>
      <form ref={formRef} className="ws-card ws-form ws-stepped" data-step-now={step} onSubmit={submit}>
        <h2>{t("New repair job")}</h2>
        <ol className="ws-stepper" aria-label={t("Steps")}>{[t("Vehicle"), t("Photos"), t("Work")].map((l, i) => <li key={l} className={(i === step ? "on " : "") + (i < step ? "done" : "")}><button type="button" onClick={() => i <= step && setStep(i)}><i>{i < step ? "✓" : i + 1}</i>{l}</button></li>)}</ol>
        <div className="ws-step" data-step="0">
        <label className="ws-field">{t("Vehicle number")} *<input required autoFocus autoCapitalize="characters" value={f.registration} onChange={(e) => set("registration", e.target.value)} placeholder="CAB-1234" /></label>
        {v && <p className="ws-known">Known vehicle: {v.make || "model not set"}, {v.visits} earlier visit{v.visits === 1 ? "" : "s"}, last seen at {kmText(v.last_km)}. Details filled in below.</p>}
        <OwingNotice reg={f.registration} phone={f.phone} />
        {openJobs.length > 0 && <p className="ws-warn" role="status">{t("This vehicle already has an open job. Check it before you start another.")} <button type="button" className="button secondary small" onClick={() => go({ name: "job", id: openJobs[0].id })}>{t("Open it")}</button></p>}
        <div className="ws-grid2">
          <label className="ws-field">{t("Customer name")} *<input required value={f.customer} onChange={(e) => set("customer", e.target.value)} /></label>
          <label className="ws-field">{t("Contact number")}<input inputMode="tel" value={f.phone} onChange={(e) => set("phone", e.target.value)} placeholder="07X XXX XXXX" /></label>
          <label className="ws-field">{t("Customer address")} <small>({t("optional")})</small><textarea rows={2} value={f.address} onChange={(e) => set("address", e.target.value)} /></label>
          <label className="ws-field">{t("Make and model")}<input value={f.vehicle} onChange={(e) => set("vehicle", e.target.value)} placeholder="Toyota Prius" /></label>
          <label className="ws-field">{t("Odometer (km)")}<input inputMode="numeric" value={f.odometer} onChange={(e) => set("odometer", e.target.value.replace(/\D/g, ""))} /></label>
          <label className="ws-field">{t("Chassis no.")} <small>({t("optional")})</small><input autoCapitalize="characters" maxLength={30} value={f.chassis} onChange={(e) => set("chassis", e.target.value.toUpperCase())} /></label>
        </div>
        <div className="ws-field" role="group" aria-label={t("Invoice type")}>{t("Invoice type")}
          <div className="ws-seg">{([["CASH", t("Cash")], ["CREDIT", t("Credit")], ["INSURANCE", t("Insurance")], ["WARRANTY", t("Warranty")]] as [string, string][]).map(([k, label]) => <button type="button" key={k} className={f.invoice_type === k ? "on" : ""} aria-pressed={f.invoice_type === k} onClick={() => set("invoice_type", k)}>{label}</button>)}</div>
        </div>
        </div>
        <div className="ws-step" data-step="2">
        {lower && <p className="ws-warn">That is lower than the last recorded {kmText(v?.last_km)}. Check the reading.</p>}
        <label className="ws-field">{t("Complaint / work to do")}<textarea rows={2} value={f.summary} onChange={(e) => set("summary", e.target.value)} placeholder="Engine oil change, brake noise" /></label>
        <label className="ws-field">{t("Mechanic")}{(business.mechanics || []).length ? <select value={f.mechanic} onChange={(e) => set("mechanic", e.target.value)}><option value="">{t("Not chosen")}</option>{(business.mechanics || []).map((m) => <option key={m} value={m}>{m}</option>)}</select> : <><input value={f.mechanic} onChange={(e) => set("mechanic", e.target.value)} /><small className="muted">{t("Mechanics added in Setup can be picked from a list, so every name is spelled the same.")}</small></>}</label>
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
        {ask && v && (
          <div ref={askRef} className="ws-askowner" role="alertdialog" aria-label={t("Is this a new owner?")}>
            <strong>{t("Is this a new owner?")}</strong>
            <p>{t("The vehicle file has {old}. You typed {name}.", { old: v.owner || "", name: f.customer })}</p>
            <button type="button" className="button primary" onClick={() => create(f.customer, true)}><b>{t("Vehicle was sold: {name} is the new owner", { name: f.customer })}</b><small>{t("{old} stays on the old bills and jobs.", { old: v.owner || "" })}</small></button>
            <button type="button" className="button secondary" onClick={() => create(v.owner || "", false, { brought_by: f.customer, brought_phone: f.phone, phone: v.phone || "" })}><b>{t("Same owner, {name} only brought it in", { name: f.customer })}</b><small>{t("The bill goes to {old}. {name} is printed as brought in by.", { old: v.owner || "", name: f.customer })}</small></button>
            <button type="button" className="button secondary" onClick={() => create(f.customer, false)}><b>{t("Only this job: bill {name}", { name: f.customer })}</b><small>{t("The owner on the vehicle stays {old}.", { old: v.owner || "" })}</small></button>
            <button type="button" className="button secondary" onClick={() => create(v.owner || "", false)}><b>{t("I typed the wrong name: use {old}", { old: v.owner || "" })}</b></button>
            <button type="button" className="button secondary small" onClick={() => setAsk(false)}>{t("Cancel")}</button>
          </div>
        )}
        {error && <p role="alert" className="stock-error">{error}</p>}
        <div className="ws-step-nav">{step > 0 ? <button type="button" className="button secondary" onClick={() => setStep(step - 1)}>{t("Back")}</button> : <button type="button" className="button secondary" onClick={() => go({ name: "home" })}>{t("Cancel")}</button>}{step < 2 ? <button key="next" type="button" className="button primary large" onClick={next}>{t("Next")}</button> : <button key="create" type="submit" className="button primary large" disabled={busy}>{busy ? t("Saving…") : t("Create job")}</button>}</div>
        <div className="ws-actions"><button className="button secondary" type="button" onClick={() => go({ name: "home" })}>{t("Cancel")}</button><button className="button primary large" disabled={busy}>{busy ? t("Saving…") : t("Create job")}</button></div>
      </form>
      <PastRepairs regKey={key} />
    </div>
  );
}
