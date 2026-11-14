import { useEffect, useRef, useState } from "react";
import { t, useLang } from "./i18n";
import { probe, progress, setPracticeStep, stopPractice, usePractice } from "./practice";

type Base = ReturnType<typeof progress> & { saw?: boolean };
type Step = { title: string; body: string; target?: string; until?: (base: Base) => boolean; manual?: boolean };
const has = (sel: string) => !!document.querySelector(sel);

function stepsFor(owner: boolean): Step[] {
  const welcome: Step = { title: t("Welcome to practice"), body: t("This is the real app with dummy data. Nothing here is saved or sent. Each time, press the glowing button."), manual: true };
  const toCounter: Step = { title: t("Open the Parts counter"), body: t("This is where parts come in and go out. Tap Parts counter."), target: '[data-tour="nav-counter"]', until: () => probe.view === "counter" };
  const giveTab: Step = { title: t("Switch to Give a part"), body: t("Use this when a part leaves the shelf. Tap Give a part."), target: '[data-tour="tab-give"]', until: () => has('[data-tour="tab-give"][aria-selected="true"]') };
  const giveFind: Step = { title: t("Find the part"), body: t("Type oil in the box, then tap a part in the list."), target: ".counter-step", until: () => has(".counter-chosen") };
  const giveDo: Step = { title: t("Confirm what left"), body: t("Check the quantity, then press the green button. Lifta takes it off the stock."), target: ".counter-confirm", until: (b) => progress().moved > b.moved };
  const home: Step = { title: t("Back to Home"), body: t("Home is where every job starts. Tap Home."), target: '[data-tour="nav-home"]', until: () => probe.view === "home" };
  if (!owner) {
    return [
      welcome,
      { title: t("Find a part"), body: t("Looking for a part? Tap Find a part."), target: ".task-tiles .task-tile:nth-child(1)", until: () => probe.view === "find" },
      { title: t("Search"), body: t("Type a name, part number or shelf. Tap a part to see its details. Press Next when you are done."), manual: true },
      toCounter,
      { title: t("Find the part that came in"), body: t("Type oil filter in the box, then tap the part."), target: ".counter-step", until: () => has(".counter-chosen") },
      { title: t("Confirm what came in"), body: t("Set how many, then press the button. Lifta adds it to the stock."), target: ".counter-confirm", until: (b) => progress().moved > b.moved },
      giveTab, giveFind, giveDo,
      { title: t("You are ready"), body: t("That is receiving and giving a part. Press Finish to leave practice. Your real stock was never touched."), manual: true },
    ];
  }
  return [
    welcome,
    toCounter,
    { title: t("Open the camera"), body: t("To add a new part, take a photo of it. Tap Open camera."), target: '[data-tour="open-camera"]', until: () => has(".scanner-dialog") },
    { title: t("Take the photo"), body: t("In real use this is your phone camera. Here, tap Use sample photo."), target: '[data-tour="sample-photo"]', until: () => has('[data-tour="add-new"]') },
    { title: t("Read the label"), body: t("Lifta did not know this part. Tap Add as a new item and it reads the label."), target: '[data-tour="add-new"]', until: () => has(".stock-modal") },
    { title: t("AI filled the form"), body: t("The blue fields were filled by AI. Check each one, fix anything wrong, or press × to clear it. Nothing is saved until you press Save item."), target: ".stock-modal .stock-form-grid", manual: true },
    { title: t("Save the part"), body: t("Looks right? Press Save item."), target: ".stock-modal .sticky-actions .button.primary", until: (b) => progress().created > b.created },
    { title: t("The QR label"), body: t("Every part gets a QR label. You print it and stick it on the part, so scanning finds it next time. Press × to close."), target: ".stock-modal .stock-close", until: (b) => { if (has(".stock-qr-preview")) b.saw = true; return !!b.saw && !has(".stock-qr-preview"); } },
    { title: t("How many came in?"), body: t("The new part is selected. Set how many came in, for example 6, with the + button."), target: ".counter-stepper", manual: true },
    { title: t("Confirm what came in"), body: t("Press the button. Lifta adds it to the stock."), target: ".counter-confirm", until: (b) => progress().moved > b.moved },
    giveTab, giveFind, giveDo,
    home,
    { title: t("Start a job"), body: t("A vehicle came in for work. Tap Start a job."), target: ".counter-tile.job", until: () => probe.view === "workshop" },
    { title: t("Enter the vehicle"), body: t("Type a vehicle number, for example CAB-1234, and a customer name. Then press Create job."), target: ".ws-form", until: (b) => progress().jobs > b.jobs },
    { title: t("Add a part"), body: t("Tap the part name to add it with its price."), target: '[data-tour="part-chips"]', until: () => has(".ws-job .ws-line:not(.labour)") },
    { title: t("Add labour"), body: t("Tap the work that was done."), target: '[data-tour="labour-chips"]', until: () => has(".ws-job .ws-line.labour") },
    { title: t("Make the invoice"), body: t("Press Create invoice, then press OK on the question."), target: '[data-tour="create-invoice"]', until: () => has(".ws-pay") },
    { title: t("Take the payment"), body: t("The customer pays. Press Save payment."), target: ".ws-pay .ws-actions .button.primary", until: (b) => progress().paid > b.paid },
    { title: t("You are ready"), body: t("You added a part, gave a part, made a job and an invoice. Press Finish to leave practice. Your real data was never touched."), manual: true },
  ];
}

type Rect = { x: number; y: number; w: number; h: number };
const PAD = 6;

export function PracticeCoach() {
  useLang();
  const st = usePractice();
  const steps = stepsFor(st.owner);
  const step = steps[Math.min(st.step, steps.length - 1)];
  const last = st.step >= steps.length - 1;
  const [rect, setRect] = useState<Rect | null>(null);
  const base = useRef<Base>(progress());
  const scrolled = useRef(false);

  useEffect(() => {
    if (!st.active) return;
    base.current = progress();
    scrolled.current = false;
    setRect(null);
    let gone = false;
    const tick = () => {
      if (gone) return;
      if (step.until && step.until(base.current)) { gone = true; setTimeout(() => setPracticeStep(st.step + 1), 350); return; }
      const el = step.target ? (document.querySelector(step.target) as HTMLElement | null) : null;
      const r = el?.getBoundingClientRect();
      if (el && r && r.width > 0 && r.height > 0) {
        if (!scrolled.current) {
          scrolled.current = true;
          if (r.top < 70 || r.bottom > window.innerHeight - 40) el.scrollIntoView({ block: "center", behavior: "smooth" });
        }
        setRect((old) => (old && Math.abs(old.x - r.left) < 1 && Math.abs(old.y - r.top) < 1 && Math.abs(old.w - r.width) < 1 && Math.abs(old.h - r.height) < 1 ? old : { x: r.left, y: r.top, w: r.width, h: r.height }));
      } else setRect(null);
    };
    tick();
    const timer = setInterval(tick, 200);
    return () => { gone = true; clearInterval(timer); };
  }, [st.active, st.step, st.owner]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!st.active) return;
    document.body.setAttribute("data-practice", "on");
    return () => document.body.removeAttribute("data-practice");
  }, [st.active]);

  if (!st.active) return null;
  const vh = window.innerHeight, vw = window.innerWidth;
  const hole = rect ? { x: Math.max(0, rect.x - PAD), y: Math.max(0, rect.y - PAD), w: rect.w + PAD * 2, h: rect.h + PAD * 2 } : null;
  const mobile = vw <= 760;
  // Put the card where it does not sit on top of the glowing target: below it if there is room, otherwise above it.
  const cardH = mobile ? 215 : 185, topEdge = mobile ? 92 : 14;
  const room = hole ? { below: vh - (hole.y + hole.h) - 12, above: hole.y - topEdge } : { below: 999, above: 0 };
  const top = !!hole && room.below < cardH && room.above >= cardH ? true : !!hole && room.below < cardH && room.above > room.below;
  return (
    <>
      {hole ? (
        <>
          <div className="pc-block" style={{ left: 0, top: 0, width: vw, height: hole.y }} />
          <div className="pc-block" style={{ left: 0, top: hole.y + hole.h, width: vw, height: Math.max(0, vh - hole.y - hole.h) }} />
          <div className="pc-block" style={{ left: 0, top: hole.y, width: hole.x, height: hole.h }} />
          <div className="pc-block" style={{ left: hole.x + hole.w, top: hole.y, width: Math.max(0, vw - hole.x - hole.w), height: hole.h }} />
          <div className="pc-ring" style={{ left: hole.x, top: hole.y, width: hole.w, height: hole.h }} />
        </>
      ) : step.target ? <div className="pc-block pc-soft" style={{ inset: 0 }} /> : null}
      <section className="pc-card" role="dialog" aria-label={t("Practice")} style={top ? { top: mobile ? 92 : 14 } : { bottom: 12 }}>
        <div className="pc-head">
          <span className="pc-tag">{t("PRACTICE")} · {t("nothing is saved")}</span>
          <span className="pc-count">{t("Step {n} of {total}", { n: st.step + 1, total: steps.length })}</span>
        </div>
        <div className="pc-bar" aria-hidden="true"><span style={{ width: ((st.step + 1) / steps.length) * 100 + "%" }} /></div>
        <h3>{step.title}</h3>
        <p>{step.body}</p>
        <div className="pc-actions">
          <button className="button secondary small" onClick={() => stopPractice()}>{t("Exit practice")}</button>
          {!last && step.until && <button className="button secondary small" onClick={() => setPracticeStep(st.step + 1)}>{t("Skip this step")}</button>}
          {(step.manual || last) && (
            <button className="button primary small" onClick={() => (last ? stopPractice() : setPracticeStep(st.step + 1))}>{last ? t("Finish") : t("Next")}</button>
          )}
        </div>
      </section>
    </>
  );
}
