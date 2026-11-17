import { ArrowDownLeft, ArrowUpRight, ClipboardCheck, PlusCircle, Search } from "lucide-react";
import { t, useLang } from "./i18n";

/** Home for everyone but the owner: big buttons for what this role may do, nothing else. */
type Low = { id: string; name: string; quantity: number | string; reorder_level?: number | string | null; location?: string };
export function MechanicHome({ onFind, onIn, onOut, onJob, onCount, onOrder, onLow, low, lowTotal = 0, disabled }: { onFind: () => void; onIn?: () => void; onOut?: () => void; onJob?: () => void; onCount?: () => void; onOrder?: () => void; onLow?: (id: string) => void; low?: Low[]; lowTotal?: number; disabled: boolean }) {
  useLang();
  const tiles = [
    { cls: "find", Icon: Search, title: t("Find a part"), sub: t("Look up a part, photo or shelf."), go: onFind },
    { cls: "in", Icon: ArrowDownLeft, title: t("Part came in"), sub: t("Scan or photo what came in"), go: onIn },
    { cls: "out", Icon: ArrowUpRight, title: t("Part went out"), sub: t("Scan the part and confirm the quantity"), go: onOut },
    { cls: "job", Icon: PlusCircle, title: t("Start a job"), sub: t("A vehicle comes in for work"), go: onJob },
    { cls: "count", Icon: ClipboardCheck, title: t("Count a shelf"), sub: t("Check what is really on a shelf"), go: onCount },
  ].filter((x) => x.go);  // a tile this role may not use is simply not there
  return (
    <section className="mh" aria-label={t("What are we doing today?")}>
      <h1>{t("What are we doing today?")}</h1>
      <div className="mh-grid">
        {tiles.map((x) => (
          <button key={x.cls} className={"mh-tile " + x.cls} disabled={disabled} onClick={x.go}>
            <span className="mh-ico"><x.Icon size={34} strokeWidth={1.8} /></span>
            <strong>{x.title}</strong>
            <small>{x.sub}</small>
          </button>
        ))}
      </div>
      {low && (
        <div className="mh-low">
          <h2>{t("Low stock")} {lowTotal > 0 && <span>({lowTotal})</span>}</h2>
          {low.length === 0 ? <p className="muted">{t("Nothing is low. Good.")}</p> : (
            <ul>{low.map((p) => (
              <li key={p.id}><button type="button" onClick={() => onLow?.(p.id)}><b>{p.name}</b><small>{p.location || ""}</small><span className="low-stock">{Number(p.quantity)} / {Number(p.reorder_level ?? 0)}</span></button></li>
            ))}</ul>
          )}
          {onOrder && <button type="button" className="button primary" disabled={disabled} onClick={onOrder}>{t("To order")}</button>}
        </div>
      )}
    </section>
  );
}
