import { t } from "../i18n";
import { useContext, useRef, useState, type ReactNode } from "react";
import { Photo } from "./Photos";
import { RailCtx } from "./Rows";
import { BizLogo } from "../BizLogo";
import { Pill, STAGE_LABEL, dateOnly, kmText, lateDays, lkr, useWs, type Invoice, type Job, type Vehicle } from "./common";

/** Swipe a card left to reveal Call and Open. Vertical scrolling still works; a tap still opens the card. */
function Swipe({ phone, onOpen, children }: { phone?: string; onOpen: () => void; children: ReactNode }) {
  const inRail = useContext(RailCtx);
  const [dx, setDx] = useState(0), start = useRef<{ x: number; y: number; base: number } | null>(null), moved = useRef(false), W = 150;
  const down = (e: React.PointerEvent) => { if (e.pointerType === "mouse") return; start.current = { x: e.clientX, y: e.clientY, base: dx }; moved.current = false; };
  const move = (e: React.PointerEvent) => { const s = start.current; if (!s) return; const mx = e.clientX - s.x, my = e.clientY - s.y; if (!moved.current && Math.abs(mx) < 10) { if (Math.abs(my) > 10) start.current = null; return; } moved.current = true; setDx(Math.max(-W, Math.min(0, s.base + mx))); };
  const up = () => { if (!start.current) return; start.current = null; setDx((d) => (d < -W / 2 ? -W : 0)); };
  if (inRail) return <>{children}</>; // inside a swiped row the sideways swipe belongs to the row
  return (
    <div className="ws-swipe">
      <div className="ws-swipe-acts" aria-hidden={dx === 0}>
        {phone ? <a className="ws-sw-call" href={"tel:" + phone} tabIndex={dx === 0 ? -1 : 0}>{t("Call")}</a> : <span />}
        <button className="ws-sw-open" tabIndex={dx === 0 ? -1 : 0} onClick={onOpen}>{t("Open")}</button>
      </div>
      <div className="ws-swipe-body" style={{ transform: "translateX(" + dx + "px)", transition: start.current ? "none" : "transform .3s var(--lf-ease, ease)" }} onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={up} onClickCapture={(e) => { if (moved.current) { e.stopPropagation(); e.preventDefault(); moved.current = false; } else if (dx < 0) { e.stopPropagation(); e.preventDefault(); setDx(0); } }}>{children}</div>
    </div>
  );
}

/** One soft colour per vehicle number, so a card with no photo still looks like its own. */
export const hue = (s: string) => { let h = 0; for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) % 360; return h; };

/** Top picture of a card: the front photo, or a tinted plate with a car. Children sit on top of it (status, counts). */
function Hero({ photo, reg, text, children }: { photo?: string; reg: string; text?: string; children?: ReactNode }) {
  const { business } = useWs();
  // No photo: a metal card (logo and status on top, the number or `text` embossed below) - all in normal flow, no absolutely placed layers that some phones paint as an empty block.
  if (!photo) return <span className="ws-metal" style={{ ["--h" as string]: hue(reg || "x") }}><span className="ws-metal-top"><span className="ws-metal-logo"><BizLogo name={business.name || "Workshop"} size={40} /></span>{children}</span><span className="ws-metal-plate">{text ?? reg}</span></span>;
  return (
    <span className="ws-hero" style={{ ["--h" as string]: hue(reg || "x") }}>
      <Photo id={photo} className="ws-hero-bg" />
      <Photo id={photo} className="ws-hero-img" />
      {children}
    </span>
  );
}

const Row = ({ label, children }: { label: string; children: ReactNode }) => (children ? <div className="ws-c-row"><dt>{label}</dt><dd>{children}</dd></div> : null);

/** A vehicle: photo, number plate (labelled), owner, phone, last km and next service. */
export function VehicleCard({ v, onOpen }: { v: Vehicle; onOpen: () => void }) {
  return (
    <button className="ws-tile" onClick={onOpen}>
      <Hero photo={v.front_photo} reg={v.registration} />
      <span className="ws-c-body">
        <span className="ws-c-label">{t("Vehicle no.")}</span>
        <strong className="ws-plate">{v.registration}</strong>
        {v.make && <span className="ws-c-make">{v.make}</span>}
        <dl className="ws-c-rows">
          <Row label={t("Customer")}>{v.owner}</Row>
          <Row label={t("Phone")}>{v.phone}</Row>
        </dl>
      </span>
      <span className="ws-c-stats">
        <span><b>{kmText(v.last_km)}</b><small>{t("Last service km")}</small></span>
        <span><b>{v.next_service_date || "-"}</b><small>{t("Next service")}</small></span>
      </span>
    </button>
  );
}

/** A job: photo with status on it, number plate, customer, what is being done, and the money. */
/** `inRow`: the card sits in a vehicle's row (the row header already has the number), so the number is not repeated. */
export function JobCard({ j, onOpen, inRow }: { j: Job; onOpen: () => void; inRow?: boolean }) {
  const when = j.status === "OPEN" && j.age_days != null ? (j.age_days === 0 ? t("Opened today") : t("Open") + " " + j.age_days + " d") : dateOnly(j.created_at);
  return (
    <Swipe phone={j.phone} onOpen={onOpen}><button className="ws-tile ws-jobc" onClick={onOpen}>
      <Hero photo={j.front_photo} reg={j.registration} text={inRow ? dateOnly(j.created_at) : undefined}>
        <span className="ws-hero-top"><Pill s={j.status} />{j.status === "OPEN" && j.stage === "READY" && <span className="ws-stage-pill st-ready">{t(STAGE_LABEL.READY)}</span>}</span>
        {j.photo_count ? <span className="ws-hero-count">{"\u{1F4F7} " + j.photo_count}</span> : null}
      </Hero>
      <span className="ws-c-body">
        {!inRow && <><span className="ws-c-label">{t("Vehicle no.")}</span>
        <strong className="ws-plate">{j.registration}</strong></>}
        {j.vehicle && <span className="ws-c-make">{j.vehicle}</span>}
        {j.job_no && <span className="ws-jobno">{j.job_no}</span>}
        <dl className="ws-c-rows">
          <Row label={t("Customer")}>{j.customer}</Row>
          <Row label={t("Phone")}>{j.phone}</Row>
        </dl>
        <span className="ws-c-work">{j.summary || t("No complaint noted")}</span>
        {j.delete_requested && <span className="ws-flag">{t("Delete requested")}</span>}
      </span>
      <span className="ws-c-stats">
        <span><b>LKR {lkr(j.total)}</b><small>{t("Total")}</small></span>
        <span><b>{j.invoice_number || when}</b><small>{j.invoice_number ? when : t("Status")}</small></span>
      </span>
    </button></Swipe>
  );
}

type InvoiceRow = Omit<Invoice, "payments" | "parts" | "labour">;
/** An invoice: number plate, customer, status, total and what is still owed. */
export function InvoiceCard({ i, onOpen, age }: { i: InvoiceRow; onOpen: () => void; age: number }) {
  const owes = i.status === "UNPAID" || i.status === "PARTIAL";
  const { business } = useWs();
  const late = owes && lateDays(i.created_at, business.payment_terms_days) > 0;
  return (
    <button className="ws-tile ws-invc" onClick={onOpen}>
      <span className="ws-c-body">
        <span className="ws-c-top"><span className="ws-c-label">{t("Invoice")}</span><span>{late && <b className="ws-late">{t("Overdue")}</b>} <Pill s={i.status} /></span></span>
        <strong className="ws-c-num">{i.invoice_number}</strong>
        <span className="ws-c-label">{t("Vehicle no.")}</span>
        <strong className="ws-plate">{i.registration}</strong>
        <dl className="ws-c-rows">
          <Row label={t("Customer")}>{i.customer}</Row>
          <Row label={t("Date")}>{dateOnly(i.created_at)}</Row>
        </dl>
      </span>
      <span className="ws-c-stats">
        <span><b>LKR {lkr(i.total)}</b><small>{t("Total")}</small></span>
        <span className={owes ? "owes" : ""}><b>{owes ? "LKR " + lkr(i.total - i.paid) : i.status === "REFUNDED" ? t("Refunded") : t("Settled")}</b><small>{owes ? t("Owes") + (age > 7 ? ", " + age + " " + t("days") : "") : i.status === "REFUNDED" ? t("Money given back") : t("Nothing owed")}</small></span>
      </span>
    </button>
  );
}

/** A vehicle due for service, with call, message and new-job buttons. */
export function DueCard({ v, why, children }: { v: Vehicle; why: string; children: ReactNode }) {
  return (
    <div className="ws-tile static">
      <Hero photo={v.front_photo} reg={v.registration}><span className="ws-hero-top"><span className={"ws-pill " + (v.reason === "overdue" ? "void" : "unpaid")}>{why}</span></span></Hero>
      <span className="ws-c-body">
        <span className="ws-c-label">{t("Vehicle no.")}</span>
        <strong className="ws-plate">{v.registration}</strong>
        {v.make && <span className="ws-c-make">{v.make}</span>}
        <dl className="ws-c-rows">
          <Row label={t("Customer")}>{v.owner}</Row>
          <Row label={t("Phone")}>{v.phone}</Row>
        </dl>
      </span>
      <span className="ws-c-stats">
        <span><b>{v.next_service_date || "-"}</b><small>{t("Service date")}</small></span>
        <span><b>{v.next_service_km ? kmText(v.next_service_km) : "-"}</b><small>{t("Service km")}</small></span>
      </span>
      <span className="ws-c-actions">{children}</span>
    </div>
  );
}
