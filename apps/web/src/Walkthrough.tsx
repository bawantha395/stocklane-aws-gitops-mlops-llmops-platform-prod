import React, { useEffect, useState } from "react";
import { ArrowLeft, ArrowRight, Check, X } from "lucide-react";
import { t, useLang } from "./i18n";

/** A guided tour built from fake screens. It never touches real stock, jobs or invoices. */
const hot = (text: string) => <span className="wt-hot">{text}</span>;
const Line = ({ a, b, c }: { a: string; b?: string; c?: string }) => (
  <div className="wt-line"><span>{a}{b && <small>{b}</small>}</span>{c && <em>{c}</em>}</div>
);
const Field = ({ label, value, ai }: { label: string; value?: string; ai?: boolean }) => (
  <div className="wt-field"><small>{label}</small><div className={ai ? "wt-ai" : ""}>{value || ""}{ai && <span className="wt-chip">AI</span>}</div></div>
);

const HomeScreen = ({ owner }: { owner: boolean }) => (
  <div className="wt-screen-body">
    {owner && <div className="wt-box"><small>{t("GET STARTED")}</small><strong>{t("{done} of {total} done", { done: 1, total: 4 })}</strong></div>}
    <div className="wt-tiles">
      {owner && <span className="wt-tile dark">{t("Start a job")}</span>}
      {owner && <span className="wt-tile dark">{t("Invoices")}</span>}
      <span className="wt-tile blue">{t("Receive")}</span>
      <span className="wt-tile green">{t("Give a part")}</span>
      <span className="wt-tile">{t("Find a part")}</span>
      <span className="wt-tile">{t("Count stock")}</span>
    </div>
  </div>
);
const AddPartScreen = () => (
  <div className="wt-screen-body">
    <div className="wt-photo">🛢️</div>
    <div className="wt-note">{t("AI filled the blue fields ({model}). Please check them.", { model: "Gemini" })}</div>
    <Field label={t("Item name")} value="Engine oil 5W-30 1L" ai />
    <Field label={t("Manufacturer / brand")} value="Demo Oil Co" ai />
    <span className="wt-btn">{hot(t("Save item"))}</span>
  </div>
);
const CounterScreen = ({ mode }: { mode: "receive" | "give" }) => (
  <div className="wt-screen-body">
    <div className="wt-tabs"><span className={mode === "receive" ? "on" : ""}>{t("Receive")}</span><span className={mode === "give" ? "on" : ""}>{t("Give a part")}</span></div>
    <Line a="Engine oil 5W-30 1L" b={t("Part no.") + " DEMO-001 · 12 " + t("in stock")} />
    <div className="wt-step"><span>−</span><b>{mode === "receive" ? 6 : 2}</b><span>+</span><small>{t("pieces")}</small></div>
    <span className="wt-btn">{hot(mode === "receive" ? t("Add {q} × {name} to stock", { q: 6, name: "Engine oil" }) : t("Record {q} × {name} leaving stock", { q: 2, name: "Engine oil" }))}</span>
  </div>
);
const CameraScreen = () => (
  <div className="wt-screen-body">
    <div className="wt-cam"><span className="wt-frame" /></div>
    <span className="wt-btn">{hot(t("Take photo"))}</span>
  </div>
);
const JobScreen = () => (
  <div className="wt-screen-body">
    <Field label={t("Vehicle")} value="CAB-1234 · Demo Pickup" />
    <Line a={"\u{1F4F7} " + t("Plate · Front · Condition")} b={t("Optional")} c="" />
    <Line a="Oil change" b={t("Labour")} c="Rs 1,500" />
    <Line a="Engine oil 5W-30 × 4" b={t("Part")} c="Rs 6,000" />
    <span className="wt-btn">{hot(t("Add part or labour"))}</span>
  </div>
);
const InvoiceScreen = () => (
  <div className="wt-screen-body">
    <Line a="Oil change" c="Rs 1,500" />
    <Line a="Engine oil 5W-30 × 4" c="Rs 6,000" />
    <div className="wt-total"><span>{t("Total")}</span><b>Rs 7,500</b></div>
    <span className="wt-btn">{hot(t("Take payment"))}</span>
  </div>
);
const ReportsScreen = () => (
  <div className="wt-screen-body">
    <div className="wt-box"><small>{t("Low stock")}</small></div>
    <Line a="Engine oil 5W-30 1L" b={t("Reorder level") + " 10"} c={"3 " + t("left")} />
    <Line a="Oil filter" b={t("Reorder level") + " 6"} c={"2 " + t("left")} />
    <span className="wt-btn">{hot(t("Reports"))}</span>
  </div>
);
const SettingsScreen = () => (
  <div className="wt-screen-body">
    <Field label={t("Business name")} value="Demo Motors" />
    <Field label={t("Address")} value="12 Demo Road" />
    <Field label={t("Phone")} value="011 000 0000" />
    <span className="wt-btn">{hot(t("Save"))}</span>
  </div>
);
const FindScreen = () => (
  <div className="wt-screen-body">
    <div className="wt-search">{hot("oil filter")}</div>
    <Line a="Oil filter small" b={t("Shelf") + " B2"} c={"8 " + t("in stock")} />
    <Line a="Oil filter large" b={t("Shelf") + " B3"} c={"2 " + t("in stock")} />
  </div>
);
const CountScreen = () => (
  <div className="wt-screen-body">
    <Line a="Brake pads front" b={t("Records say") + " 14"} />
    <div className="wt-step"><span>−</span><b>12</b><span>+</span><small>{t("You counted")}</small></div>
    <span className="wt-btn">{hot(t("Save the count"))}</span>
  </div>
);

type Step = { title: string; body: string; screen: React.ReactNode };
function stepsFor(owner: boolean): Step[] {
  const home: Step = { title: t("Home: start here"), body: t("Home shows the jobs you can do today. Tap a card to start."), screen: <HomeScreen owner={owner} /> };
  const receive: Step = { title: t("Receive a part"), body: t("When parts arrive, open Parts counter, choose Receive, find the part, enter how many and confirm."), screen: <CounterScreen mode="receive" /> };
  const give: Step = { title: t("Give a part"), body: t("When a part leaves the shelf, choose Give a part, find the part, enter how many and confirm."), screen: <CounterScreen mode="give" /> };
  if (!owner) {
    return [
      home,
      { title: t("Find a part"), body: t("Search by name, part number or shelf, or take a photo of the part."), screen: <FindScreen /> },
      receive,
      give,
      { title: t("Count stock"), body: t("Count what is on the shelf and type the number. Lifta shows the difference from the records."), screen: <CountScreen /> },
    ];
  }
  return [
    home,
    { title: t("Add a part with a photo"), body: t("Open the camera and take a photo of the part. Lifta reads the label and suggests the details. Check each one and press Use."), screen: <CameraScreen /> },
    { title: t("Save the new part"), body: t("Fix anything that is wrong, then save. Nothing is saved until you press Save."), screen: <AddPartScreen /> },
    receive,
    give,
    { title: t("Start a job"), body: t("One job per vehicle. Add the vehicle (you can also add photos of the number plate, the front and its condition), then the repairs, parts and labour."), screen: <JobScreen /> },
    { title: t("Make an invoice"), body: t("Open the job and press Create invoice. Check the total, then take the payment."), screen: <InvoiceScreen /> },
    { title: t("Reports and low stock"), body: t("Reports shows low stock and what to reorder this week, so you never run out."), screen: <ReportsScreen /> },
    { title: t("Settings"), body: t("Add your business name, address and phone. They appear on every bill."), screen: <SettingsScreen /> },
  ];
}

export function Walkthrough({ owner, onClose }: { owner: boolean; onClose: () => void }) {
  useLang();
  const role = owner ? "owner" : "team";
  const steps = stepsFor(owner);
  const [i, setI] = useState(() => {
    try { const n = Number(localStorage.getItem("lifta.tour." + role)); return n > 0 && n < steps.length ? n : 0; } catch { return 0; }
  });
  useEffect(() => { try { localStorage.setItem("lifta.tour." + role, String(i)); } catch { /* private mode */ } }, [i, role]);
  useEffect(() => {
    const key = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, [onClose]);
  const s = steps[i];
  const last = i === steps.length - 1;
  return (
    <div className="wt-back" onClick={onClose}>
      <section className="wt-card" role="dialog" aria-modal="true" aria-label={t("Workshop walkthrough")} onClick={(e) => e.stopPropagation()}>
        <header>
          <span className="wt-demo">{t("Demo: nothing is saved")}</span>
          <span className="wt-count">{t("Step {n} of {total}", { n: i + 1, total: steps.length })}</span>
          <button className="icon-button" aria-label={t("Close")} onClick={onClose}><X size={18} /></button>
        </header>
        <div className="wt-bar" aria-hidden="true"><span style={{ width: ((i + 1) / steps.length) * 100 + "%" }} /></div>
        <div className="wt-screen" aria-hidden="true">{s.screen}</div>
        <h2>{s.title}</h2>
        <p>{s.body}</p>
        <footer>
          <button className="button secondary" disabled={i === 0} onClick={() => setI(i - 1)}><ArrowLeft size={16} /> {t("Back")}</button>
          {last
            ? <button className="button primary" onClick={() => { try { localStorage.setItem("lifta.tour." + role, "0"); } catch { /* private mode */ } onClose(); }}><Check size={16} /> {t("Done")}</button>
            : <button className="button primary" onClick={() => setI(i + 1)}>{t("Next")} <ArrowRight size={16} /></button>}
        </footer>
      </section>
    </div>
  );
}
