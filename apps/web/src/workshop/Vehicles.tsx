import { can } from "../perms";
import { t } from "../i18n";
import { toast } from "../ui";
import { isPractice } from "../practice";
import { DueCard, VehicleCard } from "./Cards";
import { Face, Photo } from "./Photos";
import { useState } from "react";
import { download } from "../api";
import { Rows, groupByPeriod } from "./Rows";
import { DateChips, SummaryBar, cap, ALL, inRange, useSaved, type Range } from "./DateRange";
import { Empty, Loading, Pill, addDays, dateOnly, kmText, lateDays, lkr, today, useCommand, useDebounced, useLoad, useWs, waLink, type Owing, type Vehicle, type Visit } from "./common";

const total = (v: Visit) => lkr(v.total);

/** One earlier repair, expandable to its parts and labour. */
export function VisitCard({ v, open = false, onOpenJob, showCustomer = false }: { v: Visit; open?: boolean; onOpenJob?: () => void; showCustomer?: boolean }) {
  const [show, setShow] = useState(open);
  const lines = (v.parts?.length || 0) + (v.labour?.length || 0);
  return (
    <div className={"ws-visit " + v.status.toLowerCase()}>
      <button className="ws-visit-head" onClick={() => setShow(!show)} aria-expanded={show}>
        <span><b>{dateOnly(v.created_at)}</b>{v.job_no && <small className="ws-jobno">{v.job_no}</small>}{v.odometer != null && <small>{kmText(v.odometer)}</small>}{showCustomer && v.customer && <small className="ws-visit-who">{v.customer}</small>}</span>
        <span className="ws-visit-work">{v.summary || "No complaint noted"}</span>
        <span className="ws-visit-total">{v.status === "CANCELLED" ? <Pill s="CANCELLED" /> : v.status === "OPEN" ? <Pill s="OPEN" /> : <><b>{total(v)}</b>{v.pay_status && v.pay_status !== "PAID" && v.pay_status !== "REFUNDED" && <small className="ws-visit-owe"><Pill s={v.pay_status} /> {t("Balance")} {lkr(v.balance)}</small>}{v.pay_status === "REFUNDED" && <small className="ws-visit-owe"><Pill s="REFUNDED" /></small>}{v.pay_status === "PAID" && <small className="ws-visit-owe"><Pill s="PAID" /></small>}</>}</span>
      </button>
      {show && (
        <div className="ws-visit-body">
          {v.parts?.map((p, i) => <div className="ws-visit-line" key={"p" + i}><span>{p.quantity} x {p.name}</span><b>{lkr(p.quantity * p.unit_price)}</b></div>)}
          {v.labour?.map((l, i) => <div className="ws-visit-line labour" key={"l" + i}><span>Labour: {l.description}</span><b>{lkr(l.amount)}</b></div>)}
          {!lines && <p className="muted">{t("No lines yet.")}</p>}
          <div className="ws-visit-foot">
            {v.invoice_number && <small>{v.invoice_number}</small>}
            {v.mechanic && <small>Mechanic: {v.mechanic}</small>}
            {onOpenJob && <button className="button secondary small" onClick={onOpenJob}>{t("Preview in Jobs")}</button>}
          </div>
        </div>
      )}
    </div>
  );
}

/** A returning customer who still owes: unpaid and part-paid bills for this vehicle or phone number. */
export function OwingNotice({ reg, phone }: { reg: string; phone?: string }) {
  const { go, business } = useWs();
  const r = useDebounced((reg || "").replace(/[^A-Za-z0-9]/g, "")), p = useDebounced((phone || "").replace(/\D/g, ""));
  const { data } = useLoad<Owing[]>(r.length >= 2 || p.length >= 7 ? "/api/workshop/owing?reg=" + encodeURIComponent(r) + "&phone=" + encodeURIComponent(p) : null);
  if (!data || !data.length) return null;
  const sum = data.reduce((s, i) => s + i.balance, 0);
  const late = data.filter((i) => lateDays(i, business.payment_terms_days) > 0);
  return (
    <section className={"ws-warn ws-owing" + (late.length ? " late" : "")} role="status" data-tour="owing-notice">
      <strong>{t("This customer still owes")} LKR {lkr(sum)}{late.length ? " · " + t("overdue") + " " + (Math.max(...late.map((i) => lateDays(i, business.payment_terms_days))) ) + " " + t("days") : ""}</strong>
      {data.slice(0, 4).map((i) => <button type="button" key={i.id} className="ws-owing-row" onClick={() => go({ name: "invoice", id: i.id })}>{i.invoice_number} · {i.registration} · {dateOnly(i.created_at)} · {i.age_days} {t("days")} · {i.status === "PARTIAL" ? t("Part paid") : t("Not paid")} · LKR {lkr(i.balance)}{lateDays(i, business.payment_terms_days) > 0 ? " · " + t("OVERDUE") : ""}</button>)}
    </section>
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
      <div className="ws-section-head"><h3>Earlier repairs of {data.registration}</h3><button className="button secondary small" onClick={() => go({ name: "vehicle", id: data.id })}>{t("Full file")}</button></div>
      <p className="muted">{data.visits} visit{data.visits === 1 ? "" : "s"}, LKR {lkr(data.spent)} invoiced{data.last_km != null ? ", last seen at " + kmText(data.last_km) : ""}.</p>
      {list.slice(0, 4).map((v, i) => <VisitCard key={v.id} v={v} open={i === 0} onOpenJob={() => go({ name: "job", id: v.id })} />)}
    </section>
  );
}

export function Vehicles() {
  const { go } = useWs();
  const [q, setQ] = useState(""), [range, setRange] = useSaved<Range>("vehicles.range", ALL);
  const term = useDebounced(q.trim());
  const { data, error } = useLoad<Vehicle[]>("/api/workshop/vehicles?search=" + encodeURIComponent(term));
  const shown = (data || []).filter((v) => inRange(v.updated_at, range));
  const rows = shown.length > 0;
  const newest = [...(data || [])].sort((a, b) => (b.updated_at < a.updated_at ? -1 : 1))[0];
  return (
    <>
      <div className="ws-toolbar"><input aria-label="Search vehicles" placeholder={t("Search number, owner, phone or model")} value={q} onChange={(e) => setQ(e.target.value)} /></div>
      <DateChips value={range} onChange={setRange} />
      {data && <SummaryBar text={cap(t("vehicles")) + ": " + shown.length + " · " + t("by last visit")} file="vehicles" rows={shown.map((v) => ({ "Vehicle no.": v.registration, Owner: v.owner || "", Phone: v.phone || "", Model: v.make || "", "Last visit": dateOnly(v.updated_at), "Last km": v.last_km ?? "", "Next service": v.next_service_date || "" }))} />}
      {!data ? <Loading error={error} /> : (
        <>
          {rows ? (
            <Rows groups={groupByPeriod(shown, (v) => v.updated_at, false)} idOf={(v) => v.id} latest={newest?.id} render={(v) => <VehicleCard v={v} onOpen={() => go({ name: "vehicle", id: v.id })} />} />
          ) : (
            <div className="ws-cards">{shown.map((v) => <VehicleCard key={v.id} v={v} onOpen={() => go({ name: "vehicle", id: v.id })} />)}</div>
          )}
          {!shown.length && <div className="ws-cards"><Empty>{term || range.k !== "all" ? "No vehicle matches." : "No vehicles yet. A vehicle is added by itself when you create its first job."}</Empty></div>}
        </>
      )}
    </>
  );
}

export function VehiclePage({ id }: { id: string }) {
  const { go, business } = useWs();
  const { data: v, error, reload } = useLoad<Vehicle>("/api/workshop/vehicles/" + id);
  const [edit, setEdit] = useState(false), [f, setF] = useState({ owner: "", phone: "", make: "", notes: "" }), [base, setBase] = useState({ owner: "", phone: "", make: "", notes: "" }), [msg, setMsg] = useState("");
  const [sold, setSold] = useState(false), [nw, setNw] = useState({ owner: "", phone: "" });
  const command = useCommand();
  if (!v) return <Loading error={error} />;
  const startEdit = () => { const now = { owner: v.owner || "", phone: v.phone || "", make: v.make || "", notes: v.notes || "" }; setF(now); setBase(now); setEdit(true); setMsg(""); };
  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    try { await command("/api/workshop/vehicles/" + id, { ...f, base }, "PATCH"); setEdit(false); await reload(); } catch (err) { setMsg((err as Error).message); }
  };
  const saveOwner = async (e: React.FormEvent) => {
    e.preventDefault();
    try { await command("/api/workshop/vehicles/" + id + "/owner", nw); setSold(false); setMsg(""); await reload(); } catch (err) { setMsg((err as Error).message); }
  };
  const log = v.owner_log || [];
  const showWho = log.length > 0 || new Set((v.history || []).map((h) => h.customer).filter(Boolean)).size > 1;
  // repair history and owner changes on one timeline, newest first
  const timeline = [...(v.history || []).map((h, i) => ({ at: h.created_at, h, i, c: null as null | (typeof log)[number] })), ...log.map((c) => ({ at: c.at, h: null as null | Visit, i: -1, c }))].sort((a, b) => (a.at < b.at ? 1 : -1));
  const due = v.next_service_date && v.next_service_date <= addDays(today(), 14);
  return (
    <div>
      <OwingNotice reg={v.registration} phone={v.phone} />
      <div className="ws-bar">
        {can("jobs") && <button className="button primary small" onClick={() => go({ name: "new", reg: v.registration })}>+ {t("New job")}</button>}
        {can("quotes") && <button className="button secondary small" onClick={() => go({ name: "quote", id: "new", kind: "ESTIMATE", reg: v.registration })}>+ {t("New estimate")}</button>}
        <button className="button secondary small" onClick={() => go({ name: "quote", id: "new", kind: "QUOTATION", reg: v.registration })}>+ {t("New quotation")}</button>
        <button className="button secondary small" onClick={() => void download("/api/workshop/vehicles/" + id + "/history.pdf", "history-" + id + ".pdf").catch((e) => setMsg(e.message))}>{t("History PDF")}</button>
        {can("vehicles") && <button className="button secondary small" onClick={startEdit}>{t("Edit details")}</button>}
        <button data-tour="vehicle-new-owner" className="button secondary small" onClick={() => { setNw({ owner: "", phone: "" }); setSold(true); setEdit(false); setMsg(""); }}>{t("New owner")}</button>
      </div>
      <section className="ws-card">
        <div className="ws-card-head">
          <div className="ws-vtitle"><Face id={v.front_photo} />{v.plate_photo && <Photo id={v.plate_photo} className="ws-face plate" />}<span><h2>{v.registration}</h2><p>{v.make || "Model not set"}</p></span></div>
          {due && <span className="ws-pill unpaid">{t("Service due")}</span>}
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
            <p className="muted">{t("Fixing a typo or a new number? Save here. The open jobs of this vehicle follow; bills already issued keep what was printed. Vehicle sold? Use New owner.")}</p>
            <label className="ws-field">{t("Owner")}<input value={f.owner} onChange={(e) => setF({ ...f, owner: e.target.value })} /></label>
            <label className="ws-field">{t("Contact number")}<input inputMode="tel" value={f.phone} onChange={(e) => setF({ ...f, phone: e.target.value })} /></label>
            <label className="ws-field">{t("Make and model")}<input value={f.make} onChange={(e) => setF({ ...f, make: e.target.value })} /></label>
            <label className="ws-field">{t("Notes about this vehicle")}<textarea rows={3} value={f.notes} onChange={(e) => setF({ ...f, notes: e.target.value })} /></label>
            <div className="ws-actions"><button type="button" className="button secondary" onClick={() => setEdit(false)}>{t("Cancel")}</button><button className="button primary">Save</button></div>
          </form>
        )}
        {sold && (
          <form onSubmit={saveOwner} className="ws-form ws-newowner">
            <p className="muted">{t("Use this when the vehicle was sold. {name} stays on the old bills and jobs. Fixing a typo? Use Edit details instead.", { name: v.owner || t("The old owner") })}</p>
            <label className="ws-field">{t("New owner")}<input autoFocus value={nw.owner} onChange={(e) => setNw({ ...nw, owner: e.target.value })} /></label>
            <label className="ws-field">{t("Contact number")}<input inputMode="tel" value={nw.phone} onChange={(e) => setNw({ ...nw, phone: e.target.value })} /></label>
            <div className="ws-actions"><button type="button" className="button secondary" onClick={() => setSold(false)}>{t("Cancel")}</button><button className="button primary">{t("Save new owner")}</button></div>
          </form>
        )}
        {msg && <p role="alert" className="stock-error">{msg}</p>}
        <dl className="ws-facts">
          <div><dt>{t("Visits")}</dt><dd>{v.visits}</dd></div>
          <div><dt>{t("Invoiced")}</dt><dd>LKR {lkr(v.spent)}</dd></div>
          <div><dt>{t("Last odometer")}</dt><dd>{kmText(v.last_km)}</dd></div>
          <div><dt>{t("Next service")}</dt><dd>{v.next_service_date || "-"}{v.next_service_km ? " / " + kmText(v.next_service_km) : ""}</dd></div>
          <div><dt>{t("First visit")}</dt><dd>{v.first_visit || "-"}</dd></div>
          <div><dt>{t("Usually every")}</dt><dd>{v.average_gap_days ? v.average_gap_days + " days" : "-"}</dd></div>
        </dl>
      </section>
      <div className="ws-section-head"><h3>{t("Repair history")}</h3><small>{v.history?.length || 0} job{v.history?.length === 1 ? "" : "s"}</small></div>
      <div className="ws-list">{timeline.map((r) => r.h
        ? <VisitCard key={r.h.id} v={r.h} open={r.i === 0} showCustomer={showWho} onOpenJob={() => go({ name: "job", id: r.h!.id })} />
        : <div key={"o" + r.at} className="ws-ownerchange"><b>{t("Owner changed")}</b><span>{(r.c!.from_owner || "?") + " \u2192 " + r.c!.to_owner}</span><small>{dateOnly(r.at)}</small></div>)}</div>
      {!v.history?.length && <Empty>{t("No repairs yet.")}</Empty>}
    </div>
  );
}

export function Due() {
  const { go, business } = useWs();
  const { data, error } = useLoad<Vehicle[]>("/api/workshop/service-due");
  if (!data) return <Loading error={error} />;
  const why: Record<string, string> = { overdue: t("Overdue"), soon: t("Due soon"), km: t("Near service km") };
  return (
    <>
      <p className="muted">{t("Vehicles due within 14 days, or within 300 km of the service odometer. Call or message the owner, then start a job.")}</p>
      <div className="ws-cards">
        {data.map((v) => (
          <DueCard key={v.id} v={v} why={why[v.reason || ""]}>
            <span className="ws-contact">
                {v.phone && <a className="button secondary small" href={"tel:" + v.phone}>{t("Call")}</a>}
                {v.phone && <a className="button secondary small" target="_blank" rel="noreferrer" onClick={(e) => { if (isPractice()) { e.preventDefault(); toast(t("Practice: WhatsApp would open here with the message ready.")); } }} href={waLink(v.phone, "Hello " + (v.owner || "") + ", " + business.name + " here. Your " + v.registration + " is due for service" + (v.next_service_date ? " on " + v.next_service_date : "") + (v.next_service_km ? (v.next_service_date ? " or at " : " at ") + kmText(v.next_service_km) : "") + ". Would you like to book a time?")}>{t("Send reminder")}</a>}
                {can("jobs") && <button className="button primary small" onClick={() => go({ name: "new", reg: v.registration })}>{t("New job")}</button>}
              </span>
          </DueCard>
        ))}
        {!data.length && <Empty>{t("Nothing due. Put a next service date on a job and it shows up here.")}</Empty>}
      </div>
    </>
  );
}
