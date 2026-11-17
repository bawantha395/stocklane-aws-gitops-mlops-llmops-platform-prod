import { can } from "../perms";
import { t } from "../i18n";
import { toast, askConfirm } from "../ui";
import { AlertTriangle } from "lucide-react";
import { isPractice } from "../practice";
import { JobPhotos } from "./Photos";
import { useEffect, useMemo, useRef, useState } from "react";
import { billTotals, partAmount } from "./Bill";
import { PastRepairs } from "./Vehicles";
import { StockPicker } from "./StockPicker";
import { printJobCard } from "./jobCardPdf";
import { Loading, Pill, ReasonDialog, addDays, dateOnly, kmText, lkr, num, round2, today, useCommand, useLoad, useWs, type Invoice, type Job, STAGE_LABEL, type Stage, waLink, ProfitCard } from "./common";

type PartRow = { name: string; quantity: string; unit_price: string; outside?: boolean; outside_cost?: string; outside_shop?: string; product_id?: string; discount_pct?: string; part_no?: string; returned?: number };
type LabourRow = { description: string; amount: string };
type Suggest = { parts: { name: string; price: number; uses: number }[]; labour: { description: string; amount: number; uses: number }[] };

export function JobPage({ id }: { id: string }) {
  const { go, business, owner } = useWs();
  const { data, error: loadError, reload } = useLoad<Job>("/api/workshop/jobs/" + id);
  const sugg = useLoad<Suggest>("/api/workshop/suggestions").data;
  const [job, setJob] = useState<Job | null>(null);
  const [f, setF] = useState<Record<string, string>>({});
  const [parts, setParts] = useState<PartRow[]>([]), [labour, setLabour] = useState<LabourRow[]>([]);
  const [picking, setPicking] = useState(false), [dialog, setDialog] = useState<"" | "delete" | "request" | "reject" | "approve">(""), [dirty, setDirty] = useState(false), [busy, setBusy] = useState(false), [error, setError] = useState(""), [saved, setSaved] = useState("");
  useEffect(() => { if (saved) toast(saved); }, [saved]);
  const command = useCommand();
  const [madeNow, setMadeNow] = useState(() => { try { return sessionStorage.getItem("ws.justmade") === id; } catch { return false; } });
  const [editing, setEditing] = useState(false), [more, setMore] = useState(false), [needLines, setNeedLines] = useState(false);
  const partsRef = useRef<HTMLElement>(null);

  const adopt = (j: Job) => {
    setJob(j); setDirty(false);
    setF({ customer: j.customer, address: j.address || "", brought_by: j.brought_by || "", brought_phone: j.brought_phone || "", warranty_until: j.warranty_until || "", warranty_km: j.warranty_km == null ? "" : String(j.warranty_km), warranty_job: j.warranty_job ? "1" : "", phone: j.phone, vehicle: j.vehicle, chassis: j.chassis || "", invoice_type: j.invoice_type || "CASH", odometer: j.odometer == null ? "" : String(j.odometer), summary: j.summary, mechanic: j.mechanic, notes: j.notes,
      discount: j.discount ? String(j.discount) : "", next_service_date: j.next_service_date || "", next_service_km: j.next_service_km == null ? "" : String(j.next_service_km) });
    setParts(j.parts.map((p) => ({ name: p.name, quantity: String(p.quantity), unit_price: String(p.unit_price), ...(p.product_id ? { product_id: p.product_id } : {}), ...(p.outside ? { outside: true, ...(owner ? { outside_cost: p.outside_cost == null ? "" : String(p.outside_cost), outside_shop: p.outside_shop || "" } : {}) } : {}), ...(p.part_no ? { part_no: p.part_no } : {}), ...(p.returned ? { returned: p.returned } : {}), ...(p.discount_pct ? { discount_pct: String(p.discount_pct) } : {}) })));
    setLabour(j.labour.map((l) => ({ description: l.description, amount: String(l.amount) })));
  };
  useEffect(() => { if (data) adopt(data); }, [data]);
  useEffect(() => {
    const warn = (e: BeforeUnloadEvent) => { if (dirty) e.preventDefault(); };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);

  const rate = job?.tax_rate ?? business.tax_rate;
  const mechanicList = business.mechanics || [];
  const lines = useMemo(() => ({
    parts: parts.filter((p) => p.name.trim()).map((p) => ({ name: p.name.trim(), quantity: num(p.quantity), unit_price: num(p.unit_price), ...(p.product_id ? { product_id: p.product_id } : {}), ...(p.outside && !p.product_id ? { outside: true, ...(p.outside_cost !== undefined ? { outside_cost: p.outside_cost } : {}), ...(p.outside_shop !== undefined ? { outside_shop: p.outside_shop.trim() } : {}) } : {}), ...(num(p.discount_pct) > 0 ? { discount_pct: num(p.discount_pct) } : {}) })),
    labour: labour.filter((l) => l.description.trim()).map((l) => ({ description: l.description.trim(), amount: num(l.amount) })),
  }), [parts, labour]);
  const totals = billTotals({ ...lines, discount: num(f.discount), tax_rate: rate });
  /** What the customer asks while the vehicle is still in: a WhatsApp message with what has been done so far and the running total. */
  const costSoFar = () => {
    const rows = [...lines.parts.map((p) => num(p.quantity) + " x " + p.name + ": LKR " + lkr(partAmount(p))), ...lines.labour.map((l) => l.description + ": LKR " + lkr(num(l.amount)))];
    const msg = "Hello " + f.customer + ", update on " + job!.registration + " at " + business.name + ".\n" + (rows.length ? rows.join("\n") + "\n" : "Nothing is charged yet.\n") + "Total so far: LKR " + lkr(totals.total) + (num(f.discount) ? " (after discount)" : "") + ". This is not the final bill, more work may be added. Thank you.";
    window.open(waLink(f.phone || "", msg), "_blank", "noopener");
  };
  const grossParts = round2(lines.parts.reduce((a, p) => a + p.quantity * p.unit_price, 0)), lineOff = round2(grossParts - totals.parts);
  useEffect(() => { if (lines.parts.length || lines.labour.length) setNeedLines(false); }, [lines]);
  if (!job) return <Loading error={loadError} />;
  const locked = job.status !== "OPEN";

  const set = (k: string, v: string) => { setF((x) => ({ ...x, [k]: v })); setDirty(true); };
  const body = () => ({
    revision: job.revision, customer: f.customer, address: f.address || "", brought_by: f.brought_by || "", brought_phone: f.brought_phone || "", warranty_until: f.warranty_until || "", warranty_km: f.warranty_km ? Number(f.warranty_km) : null, warranty_job: f.warranty_job === "1", phone: f.phone, vehicle: f.vehicle, chassis: f.chassis || "", invoice_type: f.invoice_type || "CASH", odometer: f.odometer === "" ? null : Number(f.odometer), summary: f.summary, mechanic: f.mechanic, notes: f.notes,
    parts: lines.parts, labour: lines.labour, discount: num(f.discount), next_service_date: f.next_service_date, next_service_km: f.next_service_km === "" ? null : Number(f.next_service_km),
  });
  const save = async () => { const j = await command<Job>("/api/workshop/jobs/" + id, body(), "PATCH"); adopt(j); return j; };
  const run = async (work: () => Promise<void>) => { setBusy(true); setError(""); setSaved(""); try { await work(); } catch (e) { setError((e as Error).message); toast((e as Error).message, { bad: true, action: { label: t("Retry"), run: () => void run(work) }, ms: 8000 }); } finally { setBusy(false); } };
  // Taking a part from stock (or putting it back) changes the job and the stock together on the server. Anything typed but not saved is saved first.
  const stockCall = async (productId: string, qty: number, op: "use" | "return") => {
    if (dirty) await save();
    const j = await command<Job & { stock?: { balance: number } }>("/api/workshop/jobs/" + id + "/stock", { productId, quantity: qty, op });
    adopt(j);
    return j.stock?.balance;
  };
  const stepStock = (p: PartRow, op: "use" | "return", all = false) => void run(async () => {
    const have = num(p.quantity), qty = all ? have : Math.min(1, have);
    const left = await stockCall(p.product_id!, op === "use" ? 1 : qty, op);
    toast(op === "use" ? p.name + " +1. " + t("In stock") + ": " + left : p.name + " " + t("taken back to stock") + ". " + t("In stock") + ": " + left);
  });
  const invoice = async () => {
    // One review box before the bill is made: what will be billed, and a warning when a part has no price.
    const unpriced = lines.parts.filter((p) => num(p.unit_price) <= 0 && num(p.quantity) > 0);
    const body = (
      <div className="ui-review">
        <p className="ui-review-who"><b>{job.registration}</b>{job.customer ? " · " + job.customer : ""}</p>
        {unpriced.length > 0 && <p className="ui-review-warn" role="alert"><AlertTriangle size={16} aria-hidden="true" /> {t("No price on")}: {unpriced.map((p) => p.name).join(", ")}. {t("They will be billed at LKR 0.00.")}</p>}
        <table>
          <tbody>
            {lines.parts.map((p, i) => <tr key={"p" + i} className={num(p.unit_price) <= 0 ? "nop" : ""}><td>{num(p.quantity)} × {p.name}</td><td>{lkr(partAmount(p))}</td></tr>)}
            {lines.labour.map((l, i) => <tr key={"l" + i}><td>{l.description}</td><td>{lkr(num(l.amount))}</td></tr>)}
            {num(f.discount) > 0 && <tr><td>{t("Discount")}</td><td>-{lkr(num(f.discount))}</td></tr>}
            {totals.tax > 0 && <tr><td>{t("Tax")}</td><td>{lkr(totals.tax)}</td></tr>}
            <tr className="sum"><td>{t("Total")} (LKR)</td><td>{lkr(totals.total)}</td></tr>
          </tbody>
        </table>
      </div>
    );
    if (!(await askConfirm("The job will be locked. You can still take payments and, as owner, void the bill.", { title: unpriced.length ? t("Some parts have no price") : t("Review the invoice"), confirm: unpriced.length ? t("Create anyway") : t("Create invoice"), danger: unpriced.length > 0, body }))) {
      if (unpriced.length) toast(t("Set the price of") + " " + unpriced[0].name, { bad: true });
      return;
    }
    void run(async () => {
      const current = dirty ? await save() : job;
      const made = await command<Invoice>("/api/workshop/jobs/" + id + "/invoice", { revision: current.revision });
      try { sessionStorage.setItem("ws.print", made.id); } catch { /* ignore */ }
      go({ name: "invoice", id: made.id }, "Invoice " + made.invoice_number + " created. Take a payment below.");
    });
  };
  const req = job.delete_request;
  const waiting = req?.status === "PENDING";
  const base = "/api/workshop/jobs/" + id;
  const removed = (message: string) => go({ name: owner ? "archive" : "jobs" }, message);
  const undo = async () => { if (await askConfirm("Use this only for a job opened by mistake.", { title: "Undo this job?", confirm: "Undo job", danger: true })) void run(async () => { await command(base + "/undo", {}); go({ name: "jobs" }, "Job undone."); }); };
  const cancel = async () => { if (await askConfirm("It stays in the vehicle history as cancelled.", { title: "Cancel this job?", confirm: "Cancel job", danger: true })) void run(async () => { await command("/api/workshop/jobs/" + id + "/cancel", {}); await reload(); }); };

  const part = (i: number, patch: Partial<PartRow>) => { setParts(parts.map((x, k) => (k === i ? { ...x, ...patch } : x))); setDirty(true); };
  const work = (i: number, patch: Partial<LabourRow>) => { setLabour(labour.map((x, k) => (k === i ? { ...x, ...patch } : x))); setDirty(true); };
  /** The discount for one part line, in percent. Labour has no discount. */
  const offRow = (p: PartRow, i: number) => {
    if (locked && !num(p.discount_pct)) return null;
    return <label className="ws-l-off"><span>{t("Disc %")}</span><input disabled={locked} inputMode="decimal" aria-label="Line discount percent" placeholder="0" value={p.discount_pct || ""} onChange={(e) => part(i, { discount_pct: e.target.value.replace(/[^0-9.]/g, "") })} /></label>;
  };
  const partName = (i: number, name: string) => {
    const hit = sugg?.parts?.find((s) => s.name.toLowerCase() === name.trim().toLowerCase());
    part(i, { name, ...(hit && !parts[i].unit_price ? { unit_price: String(hit.price) } : {}) });
  };
  const workName = (i: number, description: string) => {
    const hit = sugg?.labour?.find((s) => s.description.toLowerCase() === description.trim().toLowerCase());
    work(i, { description, ...(hit && !labour[i].amount ? { amount: String(hit.amount) } : {}) });
  };
  const odo = f.odometer === "" ? 0 : Number(f.odometer);
  const stage: Stage = job.stage || "WAITING";
  const setStage = (next: Stage) => void run(async () => { const j = await command<Job>("/api/workshop/jobs/" + id + "/stage", { stage: next }); setJob((x) => (x ? { ...x, stage: j.stage } : x)); });
  const readyTo = f.brought_phone || f.phone;
  const readyMsg = "Hello " + (f.brought_by || f.customer) + ", your vehicle " + job.registration + " is ready for pickup. Thank you. " + (business.name || "");

  const moreItems: { label: string; run: () => void }[] = [];
  if (!!job.undo_seconds_left && !waiting) moreItems.push({ label: t("Undo job"), run: () => void undo() });
  if (!locked && !owner && !waiting) moreItems.push({ label: t("Request delete"), run: () => setDialog("request") });
  if (owner && (job.status === "OPEN" || job.status === "CANCELLED")) moreItems.push({ label: t("Delete job"), run: () => setDialog("delete") });
  if (!locked && owner) moreItems.push({ label: t("Cancel job"), run: () => void cancel() });

  return (
    <div className="ws-job">
      <div className="ws-job-head">
        <div><h2>{job.registration}</h2><p>{job.job_no && <b className="ws-jobno">{job.job_no}</b>} {dateOnly(job.created_at)} <Pill s={job.status} /></p>{job.status === "OPEN" && !!job.voids?.length && <p className="ws-fromquote muted">{t("Invoice")} {job.voids[job.voids.length - 1].invoice_number} {t("was voided on")} {dateOnly(job.voids[job.voids.length - 1].at)}. {t("The parts are still on this job; change them here and make a new invoice.")}</p>}{job.quote_id && <p className="ws-fromquote muted">{t("From")} <button type="button" className="linklike" onClick={() => go({ name: "quote", id: job.quote_id })}>{job.quote_number || t("estimate")}</button></p>}</div>
        <div className="ws-bar">
          {!locked && f.phone && <button className="button secondary small" data-tour="cost-so-far" onClick={() => costSoFar()}>{t("Cost so far")}</button>}
          {!madeNow && <button className="button secondary small" data-tour="print-jobcard" onClick={() => printJobCard(dirty ? { ...job, customer: f.customer, address: f.address, phone: f.phone, vehicle: f.vehicle, chassis: f.chassis, invoice_type: f.invoice_type as Job["invoice_type"], odometer: f.odometer === "" ? undefined : Number(f.odometer), summary: f.summary, mechanic: f.mechanic } : job, business)}>{t("Print job card")}</button>}
          {job.status === "INVOICED" && job.invoice_id && <button className="button secondary small" onClick={() => printJobCard(job, business, true)}>{t("Print job file")}</button>}
          <button className="button secondary small" onClick={() => go({ name: "vehicle", id: job.vehicle_key })}>{t("Vehicle file")}</button>
          {job.invoice_id && <button className="button primary small" onClick={() => go({ name: "invoice", id: job.invoice_id! })}>Invoice {job.invoice_number}</button>}
        </div>
      </div>

      {madeNow && (
        <div className="ws-note ws-made" role="status">
          <b>{job.job_no}</b> {t("is ready. Print the job card and send it with the vehicle.")}
          <span className="ws-note-actions"><button className="button primary small" onClick={() => { printJobCard(job, business); setMadeNow(false); try { sessionStorage.removeItem("ws.justmade"); } catch { /* ignore */ } }}>{t("Print job card")}</button><button className="button secondary small" onClick={() => { setMadeNow(false); try { sessionStorage.removeItem("ws.justmade"); } catch { /* ignore */ } }}>{t("Later")}</button></span>
        </div>
      )}
      {waiting && (
        <div className="ws-note" role="status">
          <b>{t("Delete requested")}</b> by {req!.requested_by}: {req!.reason}. {owner ? "Approve it to move this job to the Archive." : "Waiting for the owner."}
          {owner && <span className="ws-note-actions"><button className="button primary small" onClick={() => setDialog("approve")}>{t("Approve and delete")}</button><button className="button secondary small" onClick={() => setDialog("reject")}>{t("Reject")}</button></span>}
        </div>
      )}
      {req?.status === "REJECTED" && <div className="ws-note" role="status">The owner did not approve the earlier delete request{req.note ? ": " + req.note : ""}.</div>}

      {!locked && (
        <section className="ws-card ws-stage" data-tour="job-stage" aria-label={t("Where is this job?")}>
          <h3>{t("Where is this job?")}</h3>
          <div className="ws-stage-chips" role="group">
            <button type="button" className={"ws-quick" + (stage !== "READY" ? " on" : "")} aria-pressed={stage !== "READY"} disabled={busy} onClick={() => stage === "READY" && setStage("IN_PROGRESS")}>{t("Open")}</button>
            <button type="button" className={"ws-quick" + (stage === "READY" ? " on" : "")} aria-pressed={stage === "READY"} disabled={busy} onClick={() => stage !== "READY" && setStage("READY")}>{t(STAGE_LABEL.READY)}</button>
            <span className="ws-quick ws-stage-auto">{t("Invoiced")}</span>
          </div>
          <small className="muted ws-stage-note">{t("Invoiced is set when you create the invoice.")}</small>
          {stage === "READY" && (readyTo
            ? <a className="button primary small" href={waLink(readyTo, readyMsg)} target="_blank" rel="noopener noreferrer" onClick={(e) => { if (isPractice()) { e.preventDefault(); toast(t("Practice: WhatsApp would open here with the message ready.")); } }}>{t("Tell the customer it is ready")}</a>
            : <small className="muted">{t("Add a contact number to send the ready message.")}</small>)}
        </section>
      )}

      <section className="ws-card ws-cust">
        <div className="ws-cust-head"><h3>{t("Customer and vehicle")}</h3>{!locked && <button type="button" className="button secondary small" onClick={() => setEditing(!editing)}>{editing ? t("Done") : t("Edit")}</button>}</div>
        {editing && !locked ? (
        <div className="ws-grid2">
          <label className="ws-field">{t("Customer name")}<input disabled={locked} value={f.customer || ""} onChange={(e) => set("customer", e.target.value)} /></label>
          <label className="ws-field">{t("Contact number")}<input disabled={locked} inputMode="tel" value={f.phone || ""} onChange={(e) => set("phone", e.target.value)} /></label>
          <label className="ws-field">{t("Customer address")}<textarea disabled={locked} rows={2} value={f.address || ""} onChange={(e) => set("address", e.target.value)} /></label>
          <label className="ws-field">{t("Someone else brought it in?")} <small>({t("optional")})</small><input disabled={locked} value={f.brought_by || ""} onChange={(e) => set("brought_by", e.target.value)} placeholder={t("Name, e.g. the driver")} /></label>
          <label className="ws-field">{t("Their number")} <small>({t("optional")})</small><input disabled={locked} inputMode="tel" value={f.brought_phone || ""} onChange={(e) => set("brought_phone", e.target.value)} /></label>
          <label className="ws-field">{t("Make and model")}<input disabled={locked} value={f.vehicle || ""} onChange={(e) => set("vehicle", e.target.value)} /></label>
          <label className="ws-field">{t("Chassis no.")}<input disabled={locked} autoCapitalize="characters" maxLength={30} value={f.chassis || ""} onChange={(e) => set("chassis", e.target.value.toUpperCase())} /></label>
          <label className="ws-field">{t("Invoice type")}<select disabled={locked} value={f.invoice_type || "CASH"} onChange={(e) => set("invoice_type", e.target.value)}>{([["CASH", t("Cash")], ["CREDIT", t("Credit")], ["INSURANCE", t("Insurance")], ["WARRANTY", t("Warranty")]] as [string, string][]).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></label>
          <label className="ws-field">{t("Odometer (km)")}<input disabled={locked} inputMode="numeric" value={f.odometer || ""} onChange={(e) => set("odometer", e.target.value.replace(/\D/g, ""))} /></label>
          <label className="ws-field">{t("Mechanic")}{mechanicList.length ? (
            <select disabled={locked} value={f.mechanic || ""} onChange={(e) => set("mechanic", e.target.value)}>
              <option value="">{t("Not chosen")}</option>
              {(f.mechanic && !mechanicList.includes(f.mechanic) ? [f.mechanic] : []).concat(mechanicList).map((m) => <option key={m} value={m}>{m}</option>)}
            </select>
          ) : <><input disabled={locked} value={f.mechanic || ""} onChange={(e) => set("mechanic", e.target.value)} /><small className="muted">{t("Mechanics added in Setup can be picked from a list, so every name is spelled the same.")}</small></>}</label>
          <label className="ws-field">{t("Complaint / work")}<textarea disabled={locked} rows={2} value={f.summary || ""} onChange={(e) => set("summary", e.target.value)} /></label>
        </div>
        ) : (
        <dl className="ws-c-rows ws-cust-sum">
          {([[t("Customer"), f.customer], [t("Phone"), f.phone], [t("Customer address"), f.address], [t("Brought in by"), [f.brought_by, f.brought_phone].filter(Boolean).join(" · ")], [t("Make and model"), f.vehicle], [t("Chassis no."), f.chassis], [t("Invoice type"), ({ CASH: t("Cash"), CREDIT: t("Credit"), INSURANCE: t("Insurance"), WARRANTY: t("Warranty") } as Record<string, string>)[f.invoice_type || "CASH"]], [t("Odometer (km)"), f.odometer], [t("Mechanic"), f.mechanic], [t("Complaint / work"), f.summary]] as [string, string | undefined][]).filter(([, v]) => v).map(([k, v]) => <div className="ws-c-row" key={k}><dt>{k}</dt><dd>{v}</dd></div>)}
        </dl>
        )}
      </section>

      {picking && <StockPicker taken={Object.fromEntries(parts.filter((p) => p.product_id).map((p) => [p.product_id!, num(p.quantity)]))} onClose={() => setPicking(false)}
        onPick={async (p, qty) => { const left = await stockCall(p.id, qty, "use"); setPicking(false); toast(p.name + " " + t("added to the job") + ". " + t("In stock") + ": " + left); }} />}
      <JobPhotos id={id} start={job} locked={locked} />

      <section className="ws-card" ref={partsRef}>
        <h3>{t("Parts")}</h3>
        {!owner && !locked && business.mechanic_discount_pct != null && <small className="muted ws-lim">{t("You can give up to {n}% off. More needs the owner.", { n: String(business.mechanic_discount_pct) })}</small>}
        <datalist id="ws-part-names">{sugg?.parts?.map((s) => <option key={s.name} value={s.name} />)}</datalist>
        <datalist id="ws-work-names">{sugg?.labour?.map((s) => <option key={s.description} value={s.description} />)}</datalist>
        {parts.map((p, i) => (
          p.product_id ? (
            <div className="ws-line from-stock" key={p.product_id}>
              <span className="ws-l-name stock-name"><b>{p.name}</b>{p.part_no && <small className="stock-pno">{t("Part No")}: {p.part_no}</small>}{Number(p.returned) > 0 && <small className="stock-pno">{t("Returned")}: {p.returned}</small>}<small className="stock-tag">{t("From stock")}</small></span>
              <span className="ws-l-qty stock-qty">
                {!locked && <button type="button" className="ws-stk-step" aria-label={"Take one " + p.name + " back"} disabled={busy} onClick={() => stepStock(p, "return")}>−</button>}
                <output>{p.quantity}</output>
                {!locked && <button type="button" className="ws-stk-step" aria-label={"Add one more " + p.name} disabled={busy} onClick={() => stepStock(p, "use")}>+</button>}
              </span>
              <input className="ws-l-price" disabled={locked} aria-label="Unit price" inputMode="decimal" placeholder={t("Price")} value={p.unit_price} onChange={(e) => part(i, { unit_price: e.target.value })} />
              <output className="ws-l-total">{lkr(partAmount({ name: p.name, quantity: num(p.quantity), unit_price: num(p.unit_price), discount_pct: num(p.discount_pct) }))}</output>
              {!locked && <button className="ws-l-del" aria-label={"Take " + p.name + " back to stock"} title={t("Take back to stock")} disabled={busy} onClick={() => stepStock(p, "return", true)}>×</button>}
              {offRow(p, i)}
            </div>
          ) : (
          <div className="ws-line" key={i}>
            <input className="ws-l-name" disabled={locked} list="ws-part-names" aria-label="Part name" placeholder={t("Part name")} value={p.name} onChange={(e) => partName(i, e.target.value)} />
            <input className="ws-l-qty" disabled={locked} aria-label="Quantity" inputMode="decimal" placeholder={t("Qty")} value={p.quantity} onChange={(e) => part(i, { quantity: e.target.value })} />
            <input className="ws-l-price" disabled={locked} aria-label="Unit price" inputMode="decimal" placeholder={t("Price")} value={p.unit_price} onChange={(e) => part(i, { unit_price: e.target.value })} />
            <output className="ws-l-total">{lkr(partAmount({ name: p.name, quantity: num(p.quantity), unit_price: num(p.unit_price), discount_pct: num(p.discount_pct) }))}</output>
            {!locked && <button className="ws-l-del" aria-label="Remove part" onClick={() => { setParts(parts.filter((_, k) => k !== i)); setDirty(true); }}>×</button>}
            {p.outside && (
              <div className="ws-l-out">
                <small className="stock-tag out">{t("Bought outside")}</small>
                <input disabled={locked} aria-label="Cost price per unit" inputMode="decimal" placeholder={owner ? t("Cost each") : t("Cost each (owner sees)")} value={p.outside_cost ?? ""} onChange={(e) => part(i, { outside_cost: e.target.value.replace(/[^0-9.]/g, "") })} />
                <input disabled={locked} aria-label="Shop" placeholder={t("Shop")} value={p.outside_shop ?? ""} onChange={(e) => part(i, { outside_shop: e.target.value })} />
                {owner && num(p.outside_cost ?? "") > 0 && num(p.unit_price) > 0 && num(p.quantity) > 0 && <span className="ws-l-margin">{t("Margin")} {lkr(round2((num(p.unit_price) - num(p.outside_cost ?? "")) * num(p.quantity)))}</span>}
              </div>
            )}
            {offRow(p, i)}
          </div>
          )
        ))}
        {!locked && (
          <div className="ws-add" data-tour="part-chips">
            {can("job_stock") && <button className="button primary small" disabled={busy} onClick={() => setPicking(true)}>{t("Pick from stock")}</button>}
            <button className="button secondary small" onClick={() => { setParts([...parts, { name: "", quantity: "1", unit_price: "" }]); setDirty(true); }}>+ Add part</button>
            <button className="button secondary small" data-tour="bought-outside" onClick={() => { setParts([...parts, { name: "", quantity: "1", unit_price: "", outside: true, outside_cost: "", outside_shop: "" }]); setDirty(true); }}>+ {t("Bought outside")}</button>
            {sugg?.parts?.slice(0, 5).map((s) => <button key={s.name} className="ws-quick" onClick={() => { setParts([...parts, { name: s.name, quantity: "1", unit_price: String(s.price) }]); setDirty(true); }}>{s.name}</button>)}
          </div>
        )}
        <h3>{t("Labour")}</h3>
        {labour.map((l, i) => (
          <div className="ws-line labour" key={i}>
            <input className="ws-l-name" disabled={locked} list="ws-work-names" aria-label="Labour description" placeholder={t("What was done")} value={l.description} onChange={(e) => workName(i, e.target.value)} />
            <input className="ws-l-price" disabled={locked} aria-label="Labour amount" inputMode="decimal" placeholder={t("Amount")} value={l.amount} onChange={(e) => work(i, { amount: e.target.value })} />
            {!locked && <button className="ws-l-del" aria-label="Remove labour" onClick={() => { setLabour(labour.filter((_, k) => k !== i)); setDirty(true); }}>×</button>}
          </div>
        ))}
        {!locked && (
          <div className="ws-add" data-tour="labour-chips">
            <button className="button secondary small" onClick={() => { setLabour([...labour, { description: "", amount: "" }]); setDirty(true); }}>+ Add labour</button>
            {[...(business.labour_items || []).map((s) => ({ description: s.description, amount: s.amount })), ...(sugg?.labour || []).filter((s) => !(business.labour_items || []).some((x) => x.description.toLowerCase() === s.description.toLowerCase()))].slice(0, 8).map((s) => <button key={s.description} className="ws-quick" onClick={() => { setLabour([...labour, { description: s.description, amount: String(s.amount) }]); setDirty(true); }}>{s.description}</button>)}
          </div>
        )}
        <dl className="ws-sum">
          <div><dt>{t("Parts")}</dt><dd>{lkr(grossParts)}</dd></div>
          {lineOff > 0 && <div className="off"><dt>{t("Parts discount")}</dt><dd>- {lkr(lineOff)}</dd></div>}
          <div><dt>{t("Labour")}</dt><dd>{lkr(totals.labour)}</dd></div>
          {num(f.discount) > 0 && <div><dt>{t("Discount")}</dt><dd><input disabled={locked} inputMode="decimal" aria-label="Discount" placeholder="0" value={f.discount || ""} onChange={(e) => set("discount", e.target.value)} /></dd></div>}
          {totals.tax > 0 && <div><dt>{business.tax_name} ({rate}%)</dt><dd>{lkr(totals.tax)}</dd></div>}
          <div className="grand"><dt>{t("Total (LKR)")}</dt><dd>{lkr(totals.total)}</dd></div>
        </dl>
      </section>

      <section className="ws-card" data-tour="job-warranty">
        <h3>{t("Warranty on this work (optional)")}</h3>
        <div className="ws-grid2">
          <label className="ws-field">{t("Covered until")}<input disabled={locked} type="date" value={f.warranty_until || ""} onChange={(e) => set("warranty_until", e.target.value)} /></label>
          <label className="ws-field">{t("Or until odometer (km)")}<input disabled={locked} inputMode="numeric" value={f.warranty_km || ""} onChange={(e) => set("warranty_km", e.target.value.replace(/\D/g, ""))} /></label>
        </div>
        <label className="ws-check"><input disabled={locked} type="checkbox" checked={f.warranty_job === "1"} onChange={(e) => set("warranty_job", e.target.checked ? "1" : "")} /> {t("This is a warranty / redo job")}</label>
        <small className="ws-hint">{t("Shows on the bill under the work.")}</small>
      </section>

      <section className="ws-card">
        <h3>{t("Next service (optional)")}</h3>
        <div className="ws-grid2">
          <label className="ws-field">{t("Date")}<input disabled={locked} type="date" value={f.next_service_date || ""} onChange={(e) => set("next_service_date", e.target.value)} /></label>
          <label className="ws-field">{t("At odometer (km)")}<input disabled={locked} inputMode="numeric" value={f.next_service_km || ""} onChange={(e) => set("next_service_km", e.target.value.replace(/\D/g, ""))} /></label>
        </div>
        {!locked && (
          <div className="ws-add">
            {[[3, "+3 months"], [6, "+6 months"]].map(([m, label]) => <button key={label} className="ws-quick" onClick={() => set("next_service_date", addDays(today(), Number(m) * 30))}>{label}</button>)}
            {odo > 0 && [5000, 10000].map((n) => <button key={n} className="ws-quick" onClick={() => set("next_service_km", String(odo + n))}>+{n.toLocaleString("en")} km ({kmText(odo + n)})</button>)}
          </div>
        )}
        <label className="ws-field">{t("Notes")}<textarea disabled={locked} rows={2} value={f.notes || ""} onChange={(e) => set("notes", e.target.value)} /></label>
      </section>

      <PastRepairs regKey={job.vehicle_key} skipJob={id} />
      {error && <p role="alert" className="stock-error">{error}</p>}
      
      <ProfitCard p={job.profit} />
      <div className="ws-actionbar">
        {needLines && <p className="ws-need" role="status">{t("Add at least one part or labour line to create the invoice.")}</p>}
        <span className="ws-actionbar-total"><small>{dirty ? "Unsaved changes" : "Total"}</small><b>LKR {lkr(totals.total)}</b></span>
        <span className="ws-actionbar-btns">
          {moreItems.length > 0 && (
            <span className="ws-more">
              <button type="button" className="button secondary" aria-label={t("More")} aria-expanded={more} disabled={busy} onClick={() => setMore(!more)}>⋯</button>
              {more && <div className="ws-more-menu" role="menu">{moreItems.map((m) => <button key={m.label} type="button" role="menuitem" onClick={() => { setMore(false); m.run(); }}>{m.label}</button>)}</div>}
            </span>
          )}
          {!locked && <button className="button secondary" disabled={busy || !dirty} onClick={() => void run(async () => { await save(); setSaved("Saved."); })}>{t("Save")}</button>}
          {!locked && can("bill") && <button data-tour="create-invoice" className="button primary" disabled={busy} onClick={() => { if (!lines.parts.length && !lines.labour.length) { setNeedLines(true); partsRef.current?.scrollIntoView({ block: "center", behavior: "smooth" }); return; } setNeedLines(false); void invoice(); }}>{t("Create invoice")}</button>}
        </span>
      </div>
      {dialog === "delete" && <ReasonDialog title="Delete this job?" help="It moves to the Archive and disappears from jobs and the vehicle history. You can restore it later." label="Reason" confirm="Delete job"
        onDone={async (reason) => { await command(base + "/archive", { reason }); removed("Job deleted. It is in the Archive."); }} onClose={() => setDialog("")} />}
      {dialog === "approve" && <ReasonDialog title="Delete this job?" help="Approving moves the job to the Archive." label="Reason" confirm="Approve and delete" onClose={() => setDialog("")}
        onDone={async (note) => { await command(base + "/archive", { reason: ("Approved: " + (note || req!.reason)).slice(0, 200) }); removed("Job deleted. It is in the Archive."); }} />}
      {dialog === "request" && <ReasonDialog title="Ask the owner to delete this job" help="The owner sees your request on the Home page and approves or rejects it." label="Why should it be deleted?" confirm="Send request"
        onDone={async (reason) => { await command(base + "/delete-request", { reason }); setDialog(""); setSaved("Sent to the owner."); await reload(); }} onClose={() => setDialog("")} />}
      {dialog === "reject" && <ReasonDialog title="Reject the delete request" label="Note for the mechanic (optional)" confirm="Reject" required={false}
        onDone={async (note) => { await command(base + "/delete-request/reject", { note }); setDialog(""); setSaved("Request rejected."); await reload(); }} onClose={() => setDialog("")} />}
    </div>
  );
}
