import { useEffect, useRef, useState } from "react";
import { t, useLang } from "./i18n";
import { events, mark, probe, setMission, stopPractice, usePractice } from "./practice";

/**
 * Practice = a few short missions on the real screens with dummy data.
 * A step is finished by something the learner really did (a tap on the glowing thing, or an action the dummy
 * API handled), never by a counter, and the current step is always the one after the furthest thing done.
 * So if someone jumps ahead, the help jumps with them and never shows an old step.
 */
type Ctx = { ev: (name: string) => boolean; has: (sel: string) => boolean };
type Step = {
  id: string; title: string; body: string; target?: string;
  go?: { sel: string; label: string }; need?: string;
  hit?: boolean; manual?: boolean; done?: (c: Ctx) => boolean;
};
type Mission = { id: string; icon: string; title: string; blurb: string; minutes: number; steps: Step[] };

const NAV = (k: string) => '[data-tour="nav-' + k + '"]';
const TAB = (k: string) => '[data-tour="ws-tab-' + k + '"]';

function missionsFor(owner: boolean): Mission[] {
  const counter: Step = { id: "counter", title: t("Open the Parts counter"), body: t("This is where parts come in and go out. Tap Parts counter."), target: NAV("counter"), hit: true, done: () => probe.view === "counter" };
  const giveTab: Step = { id: "give-tab", title: t("Switch to Part went out"), body: t("Use this when a part leaves the shelf. Tap Part went out."), target: '[data-tour="tab-give"]', go: { sel: NAV("counter"), label: t("Parts counter") }, hit: true, done: (c) => c.has('[data-tour="tab-give"][aria-selected="true"]') };
  const give: Mission = {
    id: "give", icon: "↗", title: t("Part went out"), blurb: t("A mechanic takes a part off the shelf."), minutes: 1,
    steps: [
      giveTab,
      { id: "give-find", title: t("Find the part"), body: t("Type oil in the box, then tap a part in the list."), target: ".counter-step", done: (c) => c.has(".counter-chosen") || c.ev("api:out") },
      { id: "give-do", title: t("Confirm what left"), body: t("Check the quantity, then press the green button. Lifta takes it off the stock."), target: ".counter-confirm", done: (c) => c.ev("api:out") },
    ],
  };
  if (!owner) {
    return [
      {
        id: "find", icon: "🔎", title: t("Find a part"), blurb: t("Look up a part and see where it is."), minutes: 1,
        steps: [
          { id: "find-open", title: t("Find a part"), body: t("Looking for a part? Tap Find a part."), target: ".mh-tile.find", go: { sel: NAV("home"), label: t("Home") }, hit: true, done: () => probe.view === "find" },
          { id: "find-search", title: t("Search"), body: t("Type a name, part number or shelf. Tap a part to see its details. Press Next when you are done."), manual: true },
        ],
      },
      {
        id: "receive", icon: "↘", title: t("Receive a part"), blurb: t("A part came in. Add it to the stock."), minutes: 1,
        steps: [
          counter,
          { id: "rcv-find", title: t("Find the part that came in"), body: t("Type oil filter in the box, then tap the part."), target: ".counter-step", done: (c) => c.has(".counter-chosen") || c.ev("api:in") },
          { id: "rcv-do", title: t("Confirm what came in"), body: t("Set how many, then press the button. Lifta adds it to the stock."), target: ".counter-confirm", done: (c) => c.ev("api:in") },
        ],
      },
      give,
    ];
  }
  return [
    {
      id: "add", icon: "＋", title: t("Add a new part"), blurb: t("Photo, AI reads the label, save, receive."), minutes: 2,
      steps: [
        counter,
        { id: "add-cam", title: t("Open the camera"), body: t("To add a new part, take a photo of it. Tap Open camera."), target: '[data-tour="open-camera"]', go: { sel: NAV("counter"), label: t("Parts counter") }, hit: true },
        { id: "add-photo", title: t("Take the photo"), body: t("In real use this is your phone camera. Here, tap Use sample photo."), target: '[data-tour="sample-photo"]', hit: true },
        { id: "add-new", title: t("Read the label"), body: t("Lifta did not know this part. Tap Add as a new item and it reads the label."), target: '[data-tour="add-new"]', hit: true, done: (c) => c.has(".stock-modal") },
        { id: "add-form", title: t("AI filled the form"), body: t("The blue fields were filled by AI. Check each one, fix anything wrong, or press × to clear it. Nothing is saved until you press Save item."), target: ".stock-modal .stock-form-grid", manual: true },
        { id: "add-save", title: t("Save the part"), body: t("Looks right? Press Save item."), target: ".stock-modal .sticky-actions .button.primary", done: (c) => c.ev("api:product") },
        { id: "add-qr", title: t("The QR label"), body: t("Every part gets a QR label. You print it and stick it on the part, so scanning finds it next time. Press × to close."), target: ".stock-label-dialog .stock-close", done: (c) => c.ev("saw:qr") && !c.has(".stock-label-dialog") },
        { id: "add-in", title: t("How many came in?"), body: t("The new part is selected. Set how many came in with the + button, then press the green button."), target: ".counter-confirm", done: (c) => c.ev("api:in") },
      ],
    },
    give,
    {
      id: "job", icon: "🔧", title: t("Open a job card"), blurb: t("A vehicle comes in. Photos, parts, labour."), minutes: 2,
      steps: [
        { id: "job-start", title: t("Start a job"), body: t("A vehicle came in for work. Tap Start a job."), target: ".counter-tile.job", go: { sel: NAV("home"), label: t("Home") }, hit: true, done: (c) => probe.view === "workshop" || c.ev("api:job") },
        { id: "job-make", title: t("Enter the vehicle"), body: t("Type a vehicle number, for example CAB-1234, and a customer name. On a phone the form has 3 pages: Vehicle, Photos, Work. Press Next on this card when you have looked."), target: ".ws-form", manual: true },
        { id: "job-photos", title: t("Add photos (optional)"), body: t("On this form you can also add photos: the number plate, the front, and how the vehicle looks before fixing. All optional. Here we use drawn samples. Try one, then press Next."), target: '[data-tour="job-photos"]', manual: true },
        { id: "job-create", title: t("Create the job"), body: t("Press Create job. On a phone, use the Next button until the last page."), target: ".ws-form", done: (c) => c.ev("api:job") },
        { id: "job-part", title: t("Add a part"), body: t("Tap the part name to add it with its price."), target: '[data-tour="part-chips"]', done: (c) => c.has(".ws-job .ws-line:not(.labour)") || c.ev("api:invoice") },
        { id: "job-labour", title: t("Add labour"), body: t("Tap the work that was done."), target: '[data-tour="labour-chips"]', done: (c) => c.has(".ws-job .ws-line.labour") || c.ev("api:invoice") },
      ],
    },
    {
      id: "invoice", icon: "🧾", title: t("Invoice and payment"), blurb: t("Bill the customer and take the money."), minutes: 1,
      steps: [
        { id: "inv-make", title: t("Make the invoice"), body: t("Press Create invoice, then press OK on the question."), target: '[data-tour="create-invoice"]', need: t("Open a job first. Do the Open a job card mission."), done: (c) => c.ev("api:invoice") || c.has(".ws-pay") },
        { id: "inv-pay", title: t("Take the payment"), body: t("The customer pays. Press Save payment."), target: ".ws-pay .ws-actions .button.primary", done: (c) => c.ev("api:pay") },
      ],
    },
    {
      id: "explore", icon: "▦", title: t("Look around"), blurb: t("Vehicles, invoices, reports, archive, settings."), minutes: 1,
      steps: [
        { id: "ex-ws", title: t("Open Jobs & Invoices"), body: t("Everything about the workshop lives here."), target: NAV("workshop"), hit: true, done: () => probe.view === "workshop" },
        { id: "ex-veh", title: t("Vehicles"), body: t("Every vehicle you served, with its owner, photos and history. Tap Vehicles."), target: TAB("vehicles"), go: { sel: NAV("workshop"), label: t("Jobs & Invoices") }, hit: true },
        { id: "ex-inv", title: t("Invoices"), body: t("Every bill, paid or not. Tap Invoices."), target: TAB("invoices"), go: { sel: NAV("workshop"), label: t("Jobs & Invoices") }, hit: true },
        { id: "ex-rep", title: t("Reports"), body: t("Sales, what is unpaid, best parts and work. Tap Reports."), target: TAB("report"), go: { sel: NAV("workshop"), label: t("Jobs & Invoices") }, hit: true },
        { id: "ex-arc", title: t("Archive"), body: t("A deleted job is never lost. It waits here and you can restore it. Tap Archive."), target: TAB("archive"), go: { sel: NAV("workshop"), label: t("Jobs & Invoices") }, hit: true },
        { id: "ex-set", title: t("Settings"), body: t("Business name, address and tax, printed on every invoice. Tap Settings."), target: TAB("settings"), go: { sel: NAV("workshop"), label: t("Jobs & Invoices") }, hit: true },
      ],
    },
  ];
}

const has = (sel: string) => !!document.querySelector(sel);
const ctx: Ctx = { ev: (n) => events.has(n), has };
const stepDone = (s: Step) => (s.manual ? events.has("next:" + s.id) : (s.hit && events.has("hit:" + s.id)) || events.has("skip:" + s.id) || !!s.done?.(ctx));
/** The step to show: one after the furthest step done, and never earlier than we have already been. */
function reached(m: Mission) {
  let far = -1;
  m.steps.forEach((s, i) => { if (stepDone(s)) far = i; });
  let at = far + 1;
  events.forEach((e) => { if (e.startsWith("reach:" + m.id + ":")) at = Math.max(at, Number(e.split(":")[2])); });
  return Math.min(at, m.steps.length);
}

type Rect = { x: number; y: number; w: number; h: number };
const PAD = 6;
const rectOf = (sel?: string): Rect | null => {
  const el = sel ? (document.querySelector(sel) as HTMLElement | null) : null;
  const r = el?.getBoundingClientRect();
  if (!el || !r || r.width <= 0 || r.height <= 0) return null;
  return { x: r.left, y: r.top, w: r.width, h: r.height };
};

export function PracticeCoach() {
  useLang();
  const st = usePractice();
  const missions = missionsFor(st.owner);
  const mission = missions.find((m) => m.id === st.mission) || null;
  const [, setBeat] = useState(0);
  const [focus, setFocus] = useState<Rect | null>(null);
  const [goHint, setGoHint] = useState(false);
  const [small, setSmall] = useState(false);
  const scrolled = useRef("");
  const rev = useRef("");

  // Listen for taps on whatever any step points at.
  useEffect(() => {
    if (!st.active) return;
    const onTap = (e: Event) => {
      const el = e.target as Element | null;
      if (!el || el.closest(".pc-card, .pc-picker")) return;
      for (const m of missionsFor(st.owner)) for (const s of m.steps) if (s.hit && s.target && el.closest(s.target)) mark("hit:" + s.id);
    };
    document.addEventListener("click", onTap, true);
    document.body.setAttribute("data-practice", "on");
    return () => { document.removeEventListener("click", onTap, true); document.body.removeAttribute("data-practice"); };
  }, [st.active, st.owner]);

  // Follow the screen: find the step, its glowing target, and note how far we have got.
  useEffect(() => {
    if (!st.active || !mission) { setFocus(null); return; }
    const tick = () => {
      if (has(".stock-label-dialog")) mark("saw:qr");
      const at = reached(mission);
      if (at > 0) mark("reach:" + mission.id + ":" + at);
      const step = mission.steps[at];
      let r: Rect | null = null, hint = false;
      if (step) {
        r = rectOf(step.target);
        if (!r && step.go) { r = rectOf(step.go.sel); hint = !!r; }
        if (r && scrolled.current !== step.id + (hint ? "g" : "")) {
          scrolled.current = step.id + (hint ? "g" : "");
          const el = document.querySelector(hint ? step.go!.sel : step.target!) as HTMLElement | null;
          const b = el?.getBoundingClientRect();
          if (el && b && (b.top < 70 || b.bottom > window.innerHeight - 40)) el.scrollIntoView({ block: "center", behavior: "smooth" });
        }
      }
      const sig = mission.id + ":" + at + ":" + hint + ":" + (r ? [r.x, r.y, r.w, r.h].map(Math.round).join(",") : "-");
      if (sig !== rev.current) { rev.current = sig; setFocus(r); setGoHint(hint); setBeat((n) => n + 1); }
    };
    tick();
    const timer = setInterval(tick, 250);
    return () => clearInterval(timer);
  }, [st.active, st.mission, st.owner]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!st.active) return null;
  const vh = window.innerHeight, vw = window.innerWidth;
  const mobile = vw <= 760;

  // ---------- the mission list ----------
  if (!mission) {
    const done = missions.filter((m) => reached(m) >= m.steps.length).length;
    return (
      <div className="pc-picker-shade">
        <section className="pc-picker" role="dialog" aria-modal="true" aria-label={t("Practice")}>
          <span className="pc-tag">{t("PRACTICE") + " · " + t("nothing is saved")}</span>
          <h2>{t("Pick a mission")}</h2>
          <p>{t("This is the real app with dummy data. Nothing here is saved or sent. Do the missions in any order.")}</p>
          <div className="pc-missions">
            {missions.map((m, i) => {
              const at = reached(m), fin = at >= m.steps.length;
              return (
                <button key={m.id} className={"pc-mission" + (fin ? " done" : "")} onClick={() => setMission(m.id)}>
                  <span className="pc-m-ico" aria-hidden="true">{fin ? "✓" : m.icon}</span>
                  <span className="pc-m-text">
                    <small>{t("Mission {n}", { n: i + 1 })}</small>
                    <strong>{m.title}</strong>
                    <em>{m.blurb}</em>
                    <span className="pc-m-meta">{t("{n} steps", { n: m.steps.length })} · ~{m.minutes} {t("min")}</span>
                  </span>
                  <span className="pc-m-go">{fin ? t("Again") : at > 0 ? t("Continue") : t("Start")}</span>
                </button>
              );
            })}
          </div>
          <div className="pc-picker-foot">
            <small>{done} / {missions.length} {t("done")}</small>
            <button className="button secondary" onClick={() => stopPractice()}>{done ? t("Finish") : t("Exit practice")}</button>
          </div>
        </section>
      </div>
    );
  }

  // ---------- the help card for the current mission ----------
  const at = reached(mission), total = mission.steps.length, fin = at >= total;
  const step = mission.steps[Math.min(at, total - 1)];
  const idx = missions.findIndex((m) => m.id === mission.id);
  const nextMission = missions.find((m, i) => i !== idx && reached(m) < m.steps.length && i > idx) || missions.find((m, i) => i !== idx && reached(m) < m.steps.length);
  const hole = !fin && focus ? { x: Math.max(0, focus.x - PAD), y: Math.max(0, focus.y - PAD), w: focus.w + PAD * 2, h: focus.h + PAD * 2 } : null;

  type Spot = { left: number; width: number; top?: number; bottom?: number };
  const edge = 12, topEdge = mobile ? 92 : 14;
  const W = mobile ? vw - 24 : 340;
  const heights = mobile ? { full: 232, mini: 120, pill: 46 } : { full: 262, mini: 128, pill: 46 };
  const spotsFor = (h: number) => {
    const xs = mobile ? [12] : [vw - W - 16, 16];
    const out: { s: Spot; box: Rect }[] = [];
    for (const x of xs) {
      out.push({ s: { left: x, width: W, bottom: edge }, box: { x, y: vh - edge - h, w: W, h } });
      out.push({ s: { left: x, width: W, top: topEdge }, box: { x, y: topEdge, w: W, h } });
    }
    return out;
  };
  const touches = (b: Rect) => !!hole && b.x < hole.x + hole.w + 8 && b.x + b.w > hole.x - 8 && b.y < hole.y + hole.h + 8 && b.y + b.h > hole.y - 8;
  const modes: ("full" | "mini" | "pill")[] = small ? ["pill"] : ["full", "mini", "pill"];
  let mode: "full" | "mini" | "pill" = modes[modes.length - 1], spot: Spot = spotsFor(heights[mode])[0].s;
  search: for (const m of modes) for (const c of spotsFor(heights[m])) if (!touches(c.box)) { mode = m; spot = c.s; break search; }
  const style = { left: spot.left, width: spot.width, top: spot.top, bottom: spot.bottom, transform: "none" } as const;

  const missing = !fin && !focus && !!step.target && !!step.need;
  const body = fin ? t("Nice work. Pick the next mission, or look at the list.") : goHint && step.go ? t("First tap {where}. Then come back to this step.", { where: step.go.label }) : missing ? step.need! : step.body;
  const title = fin ? t("Mission complete") : step.title;

  return (
    <>
      {hole && <div className="pc-ring" style={{ left: hole.x, top: hole.y, width: hole.w, height: hole.h }} />}
      <section className={"pc-card pc-" + mode + (fin ? " pc-fin" : "")} role="dialog" aria-label={t("Practice")} style={style}>
        <div className="pc-head">
          <span className="pc-tag">{mode === "pill" ? t("PRACTICE") : t("PRACTICE") + " · " + t("nothing is saved")}</span>
          <span className="pc-count">
            {fin ? "✓" : t("Step {n} of {total}", { n: at + 1, total })}
            <button className="pc-fold" aria-label={small ? t("Show the help") : t("Make the help small")} title={small ? t("Show the help") : t("Make the help small")} onClick={() => setSmall(!small)}>{small ? "▴" : "▾"}</button>
          </span>
        </div>
        {mode !== "pill" && (
          <>
            <div className="pc-mname">{t("Mission {n}", { n: idx + 1 })} · {mission.title}</div>
            {mode === "full" && <div className="pc-bar" aria-hidden="true"><span style={{ width: (Math.min(at, total) / total) * 100 + "%" }} /></div>}
            <h3>{title}</h3>
            {mode === "full" && <p>{body}</p>}
          </>
        )}
        {mode === "pill" && <h3 className="pc-pill-title">{title}</h3>}
        <div className="pc-actions">
          <button className="button secondary small" onClick={() => setMission(null)}>{t("Missions")}</button>
          {mode !== "pill" && !fin && !step.manual && <button className="button secondary small" onClick={() => mark("skip:" + step.id)}>{t("Skip this step")}</button>}
          {!fin && step.manual && <button className="button primary small" onClick={() => mark("next:" + step.id)}>{t("Next")}</button>}
          {fin && nextMission && <button className="button primary small" onClick={() => setMission(nextMission.id)}>{t("Next mission")}</button>}
          {fin && !nextMission && <button className="button primary small" onClick={() => stopPractice()}>{t("Finish")}</button>}
          {mode !== "pill" && !fin && <button className="button secondary small" onClick={() => stopPractice()}>{t("Exit practice")}</button>}
        </div>
      </section>
    </>
  );
}
