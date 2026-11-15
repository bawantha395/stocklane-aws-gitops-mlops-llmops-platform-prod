import { createContext, useEffect, useRef, useState, type ReactNode } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { t } from "../i18n";
import { addDays, dateOnly, today } from "./common";

/** Cards inside a row are swiped sideways, so the card's own swipe-to-reveal turns itself off there. */
export const RailCtx = createContext(false);

export type Group<T> = { key: string; title: string; items: T[] };

const monthName = (d: string, now: string) => {
  const s = new Date(d.slice(0, 7) + "-15T12:00:00").toLocaleString("en-GB", { month: "long", ...(d.slice(0, 4) !== now.slice(0, 4) ? { year: "numeric" as const } : {}) });
  return s;
};

/** Newest-first items split into rows by date: Today, This week, This month, Last month, then one row per earlier month.
 *  `weekly` = false skips the Today / This week rows (used for vehicles and bills, which are grouped by month only). */
export function groupByPeriod<T>(items: T[], dateOf: (x: T) => string | undefined, weekly: boolean): Group<T>[] {
  const now = today(), monthStart = now.slice(0, 8) + "01", lastStart = addDays(monthStart, -1).slice(0, 8) + "01", weekStart = addDays(now, -6);
  const order: string[] = [], by = new Map<string, Group<T>>();
  const push = (key: string, title: string, x: T) => { let g = by.get(key); if (!g) { g = { key, title, items: [] }; by.set(key, g); order.push(key); } g.items.push(x); };
  const sorted = [...items].sort((a, b) => ((dateOf(b) || "") < (dateOf(a) || "") ? -1 : 1));
  for (const x of sorted) {
    const iso = dateOf(x), d = iso ? dateOnly(iso) : "";
    if (!d) push("none", t("Earlier"), x);
    else if (weekly && d === now) push("today", t("Today"), x);
    else if (weekly && d >= weekStart && d <= now) push("week", t("This week"), x);
    else if (d >= monthStart) push("month", t("This month"), x);
    else if (d >= lastStart) push("last", t("Last month"), x);
    else push(d.slice(0, 7), monthName(d, now), x);
  }
  return order.map((k) => by.get(k)!);
}

const MAX = 30;

/** One horizontally swiped row per group (Apple-style): the next card peeks in, snaps into place, arrows on a computer. */
export function Rows<T>({ groups, idOf, render, latest }: { groups: Group<T>[]; idOf: (x: T) => string; render: (x: T) => ReactNode; latest?: string }) {
  return (
    <div className="ws-rows">
      {groups.filter((g) => g.items.length).map((g) => <Row key={g.key} g={g} idOf={idOf} render={render} latest={latest} />)}
    </div>
  );
}

function Row<T>({ g, idOf, render, latest }: { g: Group<T>; idOf: (x: T) => string; render: (x: T) => ReactNode; latest?: string }) {
  const rail = useRef<HTMLDivElement>(null), [edge, setEdge] = useState({ l: false, r: false }), [all, setAll] = useState(false), [at, setAt] = useState(0);
  const measure = () => {
    const el = rail.current; if (!el) return;
    setEdge({ l: el.scrollLeft > 4, r: el.scrollLeft + el.clientWidth < el.scrollWidth - 4 });
    const first = el.querySelector<HTMLElement>(".ws-rail-item"); if (first) setAt(Math.round(el.scrollLeft / (first.offsetWidth + 14)));
  };
  const goTo = (i: number) => { const el = rail.current, first = el?.querySelector<HTMLElement>(".ws-rail-item"); if (el && first) el.scrollTo({ left: i * (first.offsetWidth + 14), behavior: "smooth" }); };
  useEffect(() => { measure(); window.addEventListener("resize", measure); return () => window.removeEventListener("resize", measure); }, [g.items.length, all]); // eslint-disable-line react-hooks/exhaustive-deps
  const by = (dir: number) => rail.current?.scrollBy({ left: dir * Math.max(240, rail.current.clientWidth * 0.85), behavior: "smooth" });
  const shown = all ? g.items : g.items.slice(0, MAX), more = g.items.length - shown.length;
  return (
    <section className="ws-row" aria-label={g.title}>
      <div className="ws-row-head"><h3>{g.title}</h3><small>{g.items.length}</small></div>
      <div className="ws-rail-wrap">
        {edge.l && <button type="button" className="ws-rail-arrow left" aria-label={t("Earlier cards")} onClick={() => by(-1)}><ChevronLeft size={20} /></button>}
        <div ref={rail} className="ws-rail" onScroll={measure}>
          <RailCtx.Provider value={true}>
            {shown.map((x) => (
              <div className="ws-rail-item" key={idOf(x)}>
                {latest && idOf(x) === latest && <span className="ws-latest"><i />{t("Latest")}</span>}
                {render(x)}
              </div>
            ))}
          </RailCtx.Provider>
          {more > 0 && <div className="ws-rail-item ws-rail-more"><button type="button" className="button secondary" onClick={() => setAll(true)}>{t("Show all")} {g.items.length}</button></div>}
        </div>
        {edge.r && <button type="button" className="ws-rail-arrow right" aria-label={t("More cards")} onClick={() => by(1)}><ChevronRight size={20} /></button>}
      </div>
      {shown.length > 1 && shown.length <= 8 && (
        <div className="ws-dots" role="tablist" aria-label={g.title}>
          {shown.map((x, i) => <button key={idOf(x)} type="button" role="tab" aria-selected={i === Math.min(at, shown.length - 1)} aria-label={String(i + 1)} className={i === Math.min(at, shown.length - 1) ? "on" : ""} onClick={() => goTo(i)} />)}
        </div>
      )}
    </section>
  );
}
