import { Fragment, type ReactNode, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ArrowRightLeft, Boxes, CalendarDays, ClipboardCheck, Layers, LayoutGrid, List, Plus, Printer, Search, TriangleAlert, X } from "lucide-react";
import { can } from "./perms";
import { toast } from "./ui";
import { api } from "./api";
import { printLabelsInPage } from "./partsShared";
import { ItemPhoto } from "./LabelDialog";
import { t } from "./i18n";
import { Empty, Loading, useLoad } from "./workshop/common";
import { Photo } from "./workshop/Photos";

type Level = { id: string; name: string; photo_id?: string };
type Rack = { id: string; photo_id?: string; name: string; area_id?: string | null; type: "RACK" | "CUPBOARD" | "FLOOR"; levels: Level[] };
type Layout = { counted?: Record<string, Record<string, { at: string; by?: string }>>; areas: { id: string; name: string; pos?: string }[]; racks: Rack[]; counts: Record<string, Record<string, number>>; not_shelved: number };
type Part = { id: string; sku: string; name: string; brand?: string; part_number?: string; unit: string; quantity: number; reorder_level?: number; location?: string; level_id?: string | null; image_id?: string };
type Item = { id: string; sku: string; name: string; brand?: string; part_number?: string; location?: string; quantity: number; unit: string; category?: string };
type Sel = { rack: string; level: string; label: string };

const TYPE: Record<string, string> = { RACK: "Rack", CUPBOARD: "Cupboard", FLOOR: "Floor" };
export const SHELF_FOCUS = "lifta.shelfFocus";
/** What a shelf QR label holds. It uses ids, so renaming a rack never breaks a printed label. */
export const shelfCode = (rack: string, level = "") => "lifta:shelf:" + rack + ":" + level;
export const parseShelfCode = (v: string) => { const m = /^lifta:shelf:([^:]+):(.*)$/.exec((v || "").trim()); return m ? { rack: m[1], level: m[2] } : null; };
const DAY = 86400000, STALE_DAYS = 90;
const dayText = (iso?: string) => (iso ? new Date(iso).toLocaleDateString() : "");
const ago = (iso?: string) => { if (!iso) return t("Never"); const d = Math.floor((Date.now() - new Date(iso).getTime()) / DAY); return d <= 0 ? t("Today") : d === 1 ? t("Yesterday") : d + " " + t("days ago"); };
/** True on a wide screen: the rack panel then sits beside the map instead of covering it. */
function useWide() {
  const q = "(min-width: 1100px)";
  const [w, setW] = useState(() => typeof window !== "undefined" && window.matchMedia(q).matches);
  useEffect(() => { const m = window.matchMedia(q); const f = () => setW(m.matches); m.addEventListener("change", f); return () => m.removeEventListener("change", f); }, []);
  return w;
}

/** One A4 sheet: a QR and the shelf name in big letters for every shelf. Prints from this page, like a bill. */
function printLabels(data: Layout) {
  const labels: { title: string; sub?: string; code: string }[] = [];
  for (const r of data.racks) for (const l of r.levels.length ? r.levels : [undefined]) labels.push({ title: label(r, l), sub: t("Shelf"), code: shelfCode(r.id, l?.id || "") });
  try { printLabelsInPage(labels); } catch (e) { toast((e as Error).message, { bad: true }); }
}
/** A rack named just "3" reads as "Rack 3"; any other name is shown as the owner wrote it. */
export const rackTitle = (n: string) => (/^\d+$/.test(n.trim()) ? t("Rack") + " " + n.trim() : n);
const label = (r: Rack, l?: Level) => (l ? r.name + "-" + l.name : r.name);
const total = (c: Record<string, number> | undefined) => Object.values(c || {}).reduce((a, b) => a + b, 0);

/** The store room as the owner drew it: walls, racks, levels. Tap a shelf to see its parts; search a part to see where it is. */
export function StoreMap({ items }: { items: Item[] }) {
  const { data, error, reload } = useLoad<Layout>("/api/inventory/stores/layout");
  const wide = useWide();
  const [sel, setSel] = useState<Sel | null>(null), [start, setStart] = useState<"" | "count" | "transfer">(""), [q, setQ] = useState(""), [look, setLook] = useState<{ rack: Rack; wall: string } | null>(null);
  // Move: parts ticked on a shelf page, then the shelf they go to is tapped on the map
  const [moving, setMoving] = useState<string[] | null>(null), [ver, setVer] = useState(0), [busyMove, setBusyMove] = useState(false);
  const [attn, setAttn] = useState(false), [openWalls, setOpenWalls] = useState<Record<string, boolean>>({});
  const [layoutView, setLayoutView] = useState<"map" | "list">(() => { try { return localStorage.getItem("lifta.storeView") === "list" ? "list" : "map"; } catch { return "map"; } });
  const chooseView = (v: "map" | "list") => { setLayoutView(v); try { localStorage.setItem("lifta.storeView", v); } catch { /* ignore */ } };
  // a movement made elsewhere (quick box, batch) changes the counts: load the layout again
  const firstItems = useRef(true);
  useEffect(() => { if (firstItems.current) { firstItems.current = false; return; } void reload(); }, [items]); // eslint-disable-line react-hooks/exhaustive-deps
  // Esc closes the rack panel; the last rack looked at is opened again when the page is revisited
  useEffect(() => {
    if (!look) return;
    const f = (e: KeyboardEvent) => { if (e.key === "Escape") setLook(null); };
    window.addEventListener("keydown", f);
    try { sessionStorage.setItem("lifta.lastRack", look.rack.id); } catch { /* ignore */ }
    return () => window.removeEventListener("keydown", f);
  }, [look]);
  const restored = useRef(false);
  useEffect(() => {
    if (!data || restored.current) return;
    restored.current = true;
    let id = ""; try { id = sessionStorage.getItem("lifta.lastRack") || ""; } catch { /* ignore */ }
    const r = id && data.racks.find((x) => x.id === id && x.levels.length > 0);
    if (r && wide) setLook({ rack: r, wall: data.areas.find((a) => a.id === r.area_id)?.name || "" });
  }, [data]); // eslint-disable-line react-hooks/exhaustive-deps
  const moveTo = async (rack: Rack, level?: Level) => {
    if (!moving || busyMove) return;
    setBusyMove(true);
    try {
      const r = await api<{ shelf: string }>("/api/inventory/stores/move", { method: "POST", body: JSON.stringify({ productIds: moving, rackId: rack.id, ...(level ? { levelId: level.id } : {}) }) }, crypto.randomUUID());
      toast(t("Moved to {shelf}.", { shelf: r.shelf })); setMoving(null); setSel({ rack: rack.id, level: level?.id || "", label: r.shelf }); setVer((v) => v + 1); window.dispatchEvent(new Event("lifta:stock-changed")); void reload();
    } catch (e) { toast((e as Error).message, { bad: true }); }
    finally { setBusyMove(false); }
  };
  const pick = (rack: Rack, level?: Level) => (moving ? void moveTo(rack, level) : setSel({ rack: rack.id, level: level?.id || "", label: label(rack, level) }));
  const labels = useMemo(() => {
    const m = new Map<string, Sel>();
    (data?.racks || []).forEach((r) => { m.set(r.name.toLowerCase(), { rack: r.id, level: "", label: r.name }); r.levels.forEach((l) => m.set(label(r, l).toLowerCase(), { rack: r.id, level: l.id, label: label(r, l) })); });
    return m;
  }, [data]);
  // a Find screen can hand over the shelf it wants shown
  useEffect(() => {
    if (!data) return;
    let want = ""; try { want = sessionStorage.getItem(SHELF_FOCUS) || ""; sessionStorage.removeItem(SHELF_FOCUS); } catch { /* ignore */ }
    const ids = want.startsWith("id:") ? want.slice(3).split(":") : null;
    const rk = ids && data.racks.find((r) => r.id === ids[0]);
    const hit = rk ? { rack: rk.id, level: rk.levels.find((l) => l.id === ids![1])?.id || "", label: label(rk, rk.levels.find((l) => l.id === ids![1])) } : want && labels.get(want.toLowerCase());
    if (hit) setSel(hit);
  }, [data, labels]);
  const words = q.toLowerCase().split(/\s+/).filter(Boolean);
  const found = useMemo(() => (words.length === 0 ? [] : items.filter((p) => { const hay = [p.name, p.brand, p.part_number, p.sku, p.category].join(" ").toLowerCase(); return words.every((w) => hay.includes(w)); }).slice(0, 30)), [items, q]); // eslint-disable-line react-hooks/exhaustive-deps
  const lit = new Set(found.map((p) => (p.location || "").toLowerCase()).filter(Boolean));
  if (!data) return <Loading error={error} />;
    const shown = (r: Rack, l?: Level) => lit.has(label(r, l).toLowerCase());
  const old = data.racks.flatMap((r) => (r.levels.length ? r.levels.map((l) => ({ r, l })) : [{ r, l: undefined as Level | undefined }])).filter(({ r, l }) => (data.counts[r.id]?.[l?.id || ""] || 0) > 0 && !(Date.now() - new Date(data.counted?.[r.id]?.[l?.id || ""]?.at || 0).getTime() < STALE_DAYS * DAY));
  const staleRacks = new Set(old.map(({ r }) => r.id));
  const openRack = (r: Rack, wallName: string) => (moving || r.levels.length === 0 ? pick(r) : setLook(look?.rack.id === r.id ? null : { rack: r, wall: wallName }));
  const hasHit = (r: Rack) => (r.levels.length === 0 ? shown(r) : r.levels.some((l) => shown(r, l)));
  const tile = (r: Rack, wallName: string) => {
    const c = data.counts[r.id], on = sel?.rack === r.id;
    return (
      <div key={r.id} className={"sm-rack" + (total(c) === 0 ? " empty" : "") + (staleRacks.has(r.id) ? " stale" : "") + (attn ? (staleRacks.has(r.id) ? " flag" : " dim") : "") + (on || look?.rack.id === r.id ? " on" : "") + (hasHit(r) ? " lit" : "")}>
        <button className="sm-rack-head" aria-pressed={on && !sel?.level} disabled={!!moving && r.levels.length > 0} title={t("Quick look") + " · " + t(TYPE[r.type] || "Rack")} onClick={() => openRack(r, wallName)}>
          {r.photo_id && <Photo id={r.photo_id} className="sm-rack-ph" />}
          <b>{rackTitle(r.name)}</b>
          <span className="sm-rk-sub">{total(c) > 0 ? total(c) + " " + (total(c) === 1 ? t("part") : t("parts")) : t("Empty")}</span>
          <span className="sm-rk-bars" aria-hidden="true">{(r.levels.length ? r.levels.slice(0, 8) : [undefined]).map((l, i) => <i key={i} className={(c?.[l?.id || ""] || 0) > 0 ? "f" : ""} />)}</span>
        </button>
        {!!moving && r.levels.map((l) => (
          <button key={l.id} className={"sm-level" + (sel?.level === l.id ? " on" : "") + (shown(r, l) ? " lit" : "")} aria-pressed={sel?.level === l.id} onClick={() => pick(r, l)}>
            <span>{l.name}</span><span className="ws-count">{c?.[l.id] || 0}</span>
          </button>
        ))}
      </div>
    );
  };
  const CAP = 12;
  const WallBox = ({ pos, wall, racks }: { pos: string; wall: { id: string; name: string; pos?: string }; racks: Rack[] }) => {
    const key = wall.id || pos;
    const auto = racks.some((r) => hasHit(r) || look?.rack.id === r.id || (attn && staleRacks.has(r.id)));
    const open = !!openWalls[key] || auto || racks.length <= CAP;
    const parts = racks.reduce((n, r) => n + total(data.counts[r.id]), 0);
    return (
      <div className={"sm-wallbox sm-wall-" + pos.toLowerCase()}>
        <div className="sm-wall-head">
          <h3 className="sm-wall"><span className="sm-dir" aria-hidden="true">{{ N: "↑", S: "↓", W: "←", E: "→", X: "" }[pos]}</span> {wall.name}</h3>
          <small>{racks.length} {racks.length === 1 ? t("rack") : t("racks")} · {parts} {parts === 1 ? t("part") : t("parts")}</small>
        </div>
        <div className="sm-rgrid">{(open ? racks : racks.slice(0, CAP)).map((r) => tile(r, wall.name))}</div>
        {racks.length > CAP && !auto && <button type="button" className="sm-more" onClick={() => setOpenWalls({ ...openWalls, [key]: !openWalls[key] })}>{openWalls[key] ? t("Show fewer") : t("Show all {n} racks", { n: racks.length })}</button>}
      </div>
    );
  };
  const wallsList = (["N", "W", "E", "S"] as const).flatMap((pos) => { const w = data.areas.find((a) => a.pos === pos); const rs = w ? data.racks.filter((r) => r.area_id === w.id) : []; return w && rs.length > 0 ? [{ pos, wall: w, racks: rs }] : []; });
  const shownWalls = new Set(wallsList.map((x) => x.wall.id));
  const looseRacks = data.racks.filter((r) => !shownWalls.has(r.area_id || ""));
  const byPos = Object.fromEntries(wallsList.map((x) => [x.pos, x]));
  const view = moving ? "map" : layoutView;
  const roomView = (
    <div className={"sm-room" + (data.racks.length > 24 ? " dense" : "")} aria-label={t("Store room map")}>
      {byPos.N && <Fragment key="N">{WallBox(byPos.N)}</Fragment>}
      {(byPos.W || byPos.E) && <div className={"sm-sides" + (byPos.W && byPos.E ? " two" : "")}>{byPos.W && <Fragment key="W">{WallBox(byPos.W)}</Fragment>}{byPos.E && <Fragment key="E">{WallBox(byPos.E)}</Fragment>}</div>}
      {byPos.S && <Fragment key="S">{WallBox(byPos.S)}</Fragment>}
      {looseRacks.length > 0 && WallBox({ pos: "X", wall: { id: "", name: t("No wall"), pos: "X" }, racks: looseRacks })}
    </div>
  );
  const listGroups = [...wallsList.map((x) => ({ name: x.wall.name, racks: x.racks })), ...(looseRacks.length ? [{ name: t("No wall"), racks: looseRacks }] : [])];
  const listView = (
    <div className="sm-list" aria-label={t("Racks")}>
      {listGroups.map((g) => (
        <Fragment key={g.name}>
          <div className="sm-list-h">{g.name} <small>{g.racks.length}</small></div>
          {g.racks.map((r) => {
            const c = data.counts[r.id], newest = r.levels.map((l) => data.counted?.[r.id]?.[l.id]?.at).filter(Boolean).sort().pop();
            return (
              <button key={r.id} type="button" className={"sm-row" + (total(c) === 0 ? " empty" : "") + (look?.rack.id === r.id ? " on" : "") + (hasHit(r) ? " lit" : "")} onClick={() => openRack(r, g.name)}>
                <b>{rackTitle(r.name)}</b>
                <span>{r.levels.length} {r.levels.length === 1 ? t("shelf") : t("shelves")}</span>
                <span>{total(c)} {total(c) === 1 ? t("part") : t("parts")}</span>
                <span className={staleRacks.has(r.id) ? "old" : ""}>{staleRacks.has(r.id) ? <TriangleAlert size={12} aria-hidden="true" /> : null} {newest ? ago(newest as string) : t("Not counted yet")}</span>
              </button>
            );
          })}
        </Fragment>
      ))}
    </div>
  );
  return (
    <section className="ws" data-tour="store-map">
      <div className="sm-head">
        <div><h1 className="ws-large">{t("Store room")}</h1><p className="ws-hint">{t("Tap a rack to see its shelves and parts.")}</p></div>
        <div className="sm-head-actions">
          {(can("stock_in") || can("stock_out")) && !moving && (<>
            {can("stock_in") && <button type="button" className="button secondary small" onClick={() => window.dispatchEvent(new Event("lifta:batch-in"))}>{t("Batch receive")}</button>}
            {can("stock_out") && <button type="button" className="button secondary small" onClick={() => window.dispatchEvent(new Event("lifta:batch-out"))}>{t("Batch issue")}</button>}
          </>)}
          {can("lists") && data.racks.length > 0 && <button type="button" className="button secondary small" onClick={() => printLabels(data)}><Printer size={14} aria-hidden="true" /> {t("Print shelf labels")}</button>}
        </div>
      </div>
      <div className="sm-stats">
        <div className="sm-stat"><span className="sm-stat-ico g"><Boxes size={20} /></span><span><small>{t("Racks")}</small><b>{data.racks.length}</b></span></div>
        <div className="sm-stat"><span className="sm-stat-ico v"><Layers size={20} /></span><span><small>{t("Part types on shelves")}</small><b>{Object.values(data.counts).reduce((a, c) => a + total(c), 0)}</b></span></div>
        <button type="button" className={"sm-stat" + (sel?.rack === "none" ? " on" : "")} onClick={() => { setStart(""); setSel({ rack: "none", level: "", label: t("Not on a shelf yet") }); }}><span className="sm-stat-ico a"><TriangleAlert size={20} /></span><span><small>{t("Not on a shelf yet")}</small><b>{data.not_shelved}</b></span></button>
      </div>
      <div className={"sm-split" + (wide ? " wide" : "")}>
      <div className="sm-left">
      <div className="sm-bar">
      <label className="sm-search"><Search size={16} /><input value={q} onChange={(e) => setQ(e.target.value)} placeholder={t("Find a part: name or part number")} aria-label={t("Find a part")} /></label>
        {!moving && <div className="sm-seg" role="group" aria-label={t("View")}><button type="button" aria-pressed={view === "map"} onClick={() => chooseView("map")}><LayoutGrid size={15} aria-hidden="true" /> {t("Map")}</button><button type="button" aria-pressed={view === "list"} onClick={() => chooseView("list")}><List size={15} aria-hidden="true" /> {t("List")}</button></div>}
        {old.length > 0 && !moving && <button type="button" className={"sm-chip" + (attn ? " on" : "")} aria-pressed={attn} onClick={() => setAttn(!attn)}><TriangleAlert size={14} aria-hidden="true" /> {t("Not counted for 3 months")} ({old.length})</button>}
      </div>
      {attn && !moving && <p className="sm-stale-list">{old.map(({ r, l }) => <button key={r.id + (l?.id || "")} type="button" className="shelf-chip" onClick={() => setSel({ rack: r.id, level: l?.id || "", label: label(r, l) })}>{label(r, l)}</button>)}</p>}
      {words.length > 0 && (
        <div className="sm-found">
          {found.length === 0 ? <p className="muted">{t("No part like that.")}</p> : found.map((p) => {
            const at = labels.get((p.location || "").toLowerCase());
            return (
              <button key={p.id} className="sm-hit" disabled={!at} onClick={() => at && setSel(at)}>
                <span><b>{p.name}</b><small>{p.part_number || p.sku}</small></span>
                <span className={"shelf-chip" + (at ? "" : " none")}>{p.location || t("Shelf not set")}</span>
              </button>
            );
          })}
        </div>
      )}
      {moving && (
        <div className="sm-moving" role="status"><b>{t("Tap the shelf to move {n} parts to.", { n: moving.length })}</b> <button type="button" className="button secondary small" onClick={() => setMoving(null)}>{t("Cancel")}</button></div>
      )}
      {data.racks.length === 0 && <Empty>{t("The store room is not set up yet. The owner does it in Settings → Store room.")}</Empty>}
      {view === "list" ? listView : roomView}
      </div>
      {wide && (look ? <QuickLook fresh={items} docked key={look.rack.id} rack={look.rack} wall={look.wall} counts={data.counts[look.rack.id] || {}} counted={data.counted?.[look.rack.id]} onClose={() => setLook(null)} onOpen={(l, mode) => { setStart(mode || ""); setSel({ rack: look.rack.id, level: l?.id || "", label: label(look.rack, l) }); }} /> : <aside className="rk-panel docked rk-idle"><Boxes size={30} aria-hidden="true" /><p>{t("Tap a rack to see its shelves and parts.")}</p></aside>)}
      </div>
      {look && !wide && <QuickLook fresh={items} rack={look.rack} wall={look.wall} counts={data.counts[look.rack.id] || {}} counted={data.counted?.[look.rack.id]} onClose={() => setLook(null)} onOpen={(l, mode) => { setLook(null); setStart(mode || ""); setSel({ rack: look.rack.id, level: l?.id || "", label: label(look.rack, l) }); }} />}
      {sel && <ShelfPage key={sel.rack + "/" + sel.level + "/" + ver} fresh={items} start={start} sel={sel} rack={data.racks.find((r) => r.id === sel.rack)} onClose={() => { setSel(null); setMoving(null); setStart(""); }} onMove={can("shelf_move") ? (ids) => setMoving(ids) : undefined} canCount={can("stock_count")} counted={data.counted?.[sel.rack]?.[sel.level || ""]?.at} onCounted={() => { setVer((v) => v + 1); window.dispatchEvent(new Event("lifta:stock-changed")); void reload(); }} />}
    </section>
  );
}

/** Put a part in on a shelf: opens the counter's batch list with that shelf (and, if given, that part) ready. */
function putIn(shelfLabel: string, id?: string) {
  try { sessionStorage.setItem("lifta.putaway", shelfLabel); } catch { /* ignore */ }
  window.dispatchEvent(new CustomEvent("lifta:receive-here", { detail: id || "" }));
}
const noCamera = () => typeof window !== "undefined" && window.matchMedia("(min-width: 761px)").matches;

/** One shelf (or a whole rack, or the parts with no shelf): what is on it, and the photo of it if the owner took one. */
function ShelfPage({ sel, rack, start, fresh, onClose, onMove, canCount, counted, onCounted }: { sel: Sel; rack?: Rack; fresh?: unknown; start?: "" | "count" | "transfer"; onClose: () => void; onMove?: (ids: string[]) => void; canCount?: boolean; counted?: string; onCounted?: () => void }) {
  const [counting, setCounting] = useState(false), [vals, setVals] = useState<Record<string, string>>({}), [saving, setSaving] = useState(false);
  const [ticked, setTicked] = useState<string[]>([]);
  const topRef = useRef<HTMLDivElement>(null);
  useEffect(() => { topRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }); }, []);
  const tick = useCallback((id: string) => setTicked((x) => (x.includes(id) ? x.filter((y) => y !== id) : [...x, id])), []);
  const path = "/api/inventory/stores/shelf?rack=" + encodeURIComponent(sel.rack) + (sel.level ? "&level=" + encodeURIComponent(sel.level) : "");
  const { data, error, reload } = useLoad<{ parts: Part[] }>(path);
  const firstFresh = useRef(true);
  useEffect(() => { if (firstFresh.current) { firstFresh.current = false; return; } if (!counting) void reload(); }, [fresh]); // eslint-disable-line react-hooks/exhaustive-deps
  const startedRef = useRef(false);
  useEffect(() => {
    if (startedRef.current || !data) return;
    startedRef.current = true;
    if (start === "count" && canCount && data.parts.length > 0) { setVals({}); setCounting(true); }
  }, [data]); // eslint-disable-line react-hooks/exhaustive-deps
  const photo = rack?.levels.find((l) => l.id === sel.level)?.photo_id;
  const byLevel = (id?: string | null) => rack?.levels.find((l) => l.id === id)?.name || "";
  return (
    <div className="sm-shelf" ref={topRef} role="region" aria-label={sel.label} data-tour="shelf-page">
      <div className="sm-shelf-top">
        <div><h2>{sel.label}</h2><p className="muted sm-counted">{counted ? t("Last counted") + ": " + dayText(counted) : t("Not counted yet")}</p></div>
        <button className="rk-x" aria-label={t("Close")} onClick={onClose}><X size={18} /></button>
      </div>
      {photo && <Photo id={photo} size="full" className="sm-shelf-photo" />}
      {counting && data ? (
        <div className="sm-actions">
          <button type="button" className="button primary small" disabled={saving} onClick={async () => {
            const lines = data.parts.filter((p) => vals[p.id] !== undefined && vals[p.id] !== "").map((p) => ({ productId: p.id, counted: Number(vals[p.id]) })).filter((l) => Number.isFinite(l.counted) && l.counted >= 0);
            if (lines.length === 0) { toast(t("Type what you counted first."), { bad: true }); return; }
            setSaving(true);
            try {
              for (let i = 0; i < lines.length; i += 15) await api("/api/inventory/stores/count", { method: "POST", body: JSON.stringify({ rackId: sel.rack, ...(sel.level ? { levelId: sel.level } : {}), counts: lines.slice(i, i + 15) }) }, crypto.randomUUID());
              toast(t("Count saved.")); setCounting(false); onCounted?.();
            } catch (e) { toast((e as Error).message, { bad: true }); } finally { setSaving(false); }
          }}>{t("Save count")}</button>
          <button type="button" className="button secondary small" onClick={() => setCounting(false)}>{t("Cancel")}</button>
        </div>
      ) : (
        <div className="sm-actions">
          {sel.rack !== "none" && can("stock_in") && <button type="button" className="button primary small" onClick={() => putIn(sel.label)}><Plus size={14} aria-hidden="true" /> {t("Receive to {shelf}", { shelf: sel.label })}</button>}
          {canCount && data && data.parts.length > 0 && <button type="button" className="button secondary small" onClick={() => { setVals({}); setCounting(true); }}><ClipboardCheck size={14} aria-hidden="true" /> {t("Stock count")}</button>}
          {onMove && data && data.parts.length > 0 && (<>
            <button type="button" className="button secondary small" onClick={() => setTicked(ticked.length === data.parts.length ? [] : data.parts.slice(0, 15).map((p) => p.id))}>{t("Select all")}</button>
            <button type="button" className="button secondary small" disabled={!ticked.length} onClick={() => onMove(ticked)}><ArrowRightLeft size={14} aria-hidden="true" /> {t("Transfer")} {ticked.length > 0 ? "(" + ticked.length + ")" : ""}</button>
          </>)}
          {sel.rack !== "none" && can("lists") && <button type="button" className="button secondary small sm-print" onClick={() => printLabelsInPage([{ title: sel.label, sub: t("Shelf"), code: shelfCode(sel.rack, sel.level) }])}><Printer size={14} aria-hidden="true" /> {t("Print label")}</button>}
        </div>
      )}
      {start === "transfer" && !counting && ticked.length === 0 && <p className="muted sm-counted">{t("Tick the parts to transfer, then press Transfer.")}</p>}
      {!data ? <Loading error={error} /> : data.parts.length === 0 ? <Empty>{t("Nothing on this shelf.")}</Empty> : (
        <ul className="sm-parts">
          {data.parts.map((p) => (
            <li key={p.id} className={Number(p.quantity) <= Number(p.reorder_level ?? -1) ? "low" : ""}>
              {onMove && <input type="checkbox" className="sm-tick" aria-label={t("Transfer") + " " + p.name} checked={ticked.includes(p.id)} disabled={!ticked.includes(p.id) && ticked.length >= 15} onChange={() => tick(p.id)} />}
              <span className="sm-thumb"><ItemPhoto item={p as never} peek /></span>
              <span><b>{p.name}</b><small>{[p.part_number || p.sku, !sel.level && byLevel(p.level_id) ? t("Level") + " " + byLevel(p.level_id) : ""].filter(Boolean).join(" · ")}</small></span>
              {counting ? (
                <span className="sm-count"><input type="number" inputMode="decimal" min="0" step={p.unit === "LITRE" ? "0.1" : "1"} aria-label={t("Counted") + " " + p.name} value={vals[p.id] ?? ""} onChange={(e) => setVals({ ...vals, [p.id]: e.target.value })} placeholder={String(Number(p.quantity))} />
                  {vals[p.id] !== undefined && vals[p.id] !== "" && Number(vals[p.id]) !== Number(p.quantity) && <small className={Number(vals[p.id]) > Number(p.quantity) ? "up" : "down"}>{Number(vals[p.id]) - Number(p.quantity) > 0 ? "+" : ""}{Math.round((Number(vals[p.id]) - Number(p.quantity)) * 100) / 100}</small>}</span>
              ) : <span className="sm-qty">{Number(p.quantity)} <small>{p.unit === "LITRE" ? "L" : ""}</small>{can("stock_out") && Number(p.quantity) > 0 && <button type="button" className="button secondary small sm-out" onClick={() => window.dispatchEvent(new CustomEvent("lifta:take-out", { detail: p.id }))}>{t("Issue")}</button>}{can("stock_in") && sel.rack !== "none" && <button type="button" className="button secondary small sm-out" onClick={() => putIn(sel.label, p.id)}>{t("Receive")}</button>}</span>}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}


/** Tap a rack: its shelves as cards on the left, the parts of the chosen shelf (with photos) on the right, and the actions underneath. */
function QuickLook({ rack, wall, counts, counted, docked, fresh, onClose, onOpen }: { fresh?: unknown; docked?: boolean; rack: Rack; wall: string; counts: Record<string, number>; counted?: Record<string, { at: string; by?: string }>; onClose: () => void; onOpen: (l?: Level, mode?: "count" | "transfer") => void }) {
  const [lv, setLv] = useState(rack.levels.find((l) => (counts[l.id] || 0) > 0)?.id || rack.levels[0]?.id || "");
  const { data, error, reload } = useLoad<{ parts: Part[] }>("/api/inventory/stores/shelf?rack=" + encodeURIComponent(rack.id) + (lv ? "&level=" + encodeURIComponent(lv) : ""));
  const firstFresh = useRef(true);
  useEffect(() => { if (firstFresh.current) { firstFresh.current = false; return; } void reload(); }, [fresh]); // eslint-disable-line react-hooks/exhaustive-deps
  const [fq, setFq] = useState("");
  const [cards, setCards] = useState(() => { try { return localStorage.getItem("lifta.itemCards") === "1"; } catch { return false; } });
  const pickCards = (v: boolean) => { setCards(v); try { localStorage.setItem("lifta.itemCards", v ? "1" : "0"); } catch { /* ignore */ } };
  const lowFirst = (data?.parts || []).slice().sort((a, b) => Number(Number(b.quantity) <= Number(b.reorder_level ?? -1)) - Number(Number(a.quantity) <= Number(a.reorder_level ?? -1)) || a.name.localeCompare(b.name));
  const visible = fq.trim() ? lowFirst.filter((p) => [p.name, p.part_number, p.sku, p.brand].join(" ").toLowerCase().includes(fq.trim().toLowerCase())) : lowFirst;
  const level = rack.levels.find((l) => l.id === lv);
  const when = (l: Level) => { const at = counted?.[l.id]?.at; return { text: at ? t("Counted") + " " + dayText(at) : t("Not counted yet"), old: !at || Date.now() - new Date(at).getTime() >= STALE_DAYS * DAY }; };
  const shelf = label(rack, level);
  const after = () => { if (!docked) onClose(); };
  const newest = rack.levels.map((l) => counted?.[l.id]?.at).filter(Boolean).sort().pop();
  const wrap = (children: ReactNode) => docked
    ? <aside className="rk-panel docked" aria-label={rackTitle(rack.name)}>{children}</aside>
    : <div className="stock-modal-shade" onClick={onClose}><section className="stock-modal rk-panel" role="dialog" aria-modal="true" aria-label={rackTitle(rack.name)} onClick={(e) => e.stopPropagation()}>{children}</section></div>;
  return wrap(
    <>
        <header className="rk-head">
          <div className="rk-title"><span className="rk-ico">{rack.photo_id ? <Photo id={rack.photo_id} className="rk-rack-ph" /> : <Boxes size={22} />}</span><div><h2>{rackTitle(rack.name)}</h2><span className="sm-wallchip">{wall}</span></div></div>
          <button type="button" className="rk-x" aria-label={t("Close")} onClick={onClose}><X size={18} /></button>
        </header>
        <div className="rk-kpis">
          <div><Layers size={18} aria-hidden="true" /><span><small>{t("Shelves")}</small><b>{rack.levels.length}</b></span></div>
          <div><Boxes size={18} aria-hidden="true" /><span><small>{t("Part types")}</small><b>{total(counts)}</b></span></div>
          <div><CalendarDays size={18} aria-hidden="true" /><span><small>{t("Last counted")}</small><b>{ago(newest as string | undefined)}</b></span></div>
        </div>
        <div className="rk-body">
          <div className="rk-shelves">
            {rack.levels.map((l) => { const w = when(l), n = counts[l.id] || 0; return (
              <button key={l.id} type="button" className={"rk-shelf" + (lv === l.id ? " on" : "") + (w.old && n > 0 ? " old" : "")} aria-pressed={lv === l.id} onClick={() => setLv(l.id)}>
                {l.photo_id && <Photo id={l.photo_id} className="rk-shelf-ph" />}
                <span className="rk-shelf-top"><b>{label(rack, l)}</b><span className="rk-n">{n}</span></span>
                <small>{w.old && n > 0 ? <TriangleAlert size={12} aria-hidden="true" /> : null} {w.text}</small>
              </button>
            ); })}
          </div>
          <div className="rk-items">
            <div className="rk-items-head"><b>{shelf}</b>{data && <small>{data.parts.length} {data.parts.length === 1 ? t("part") : t("parts")}</small>}<span className="sm-seg sm-seg-s" role="group" aria-label={t("View")}><button type="button" aria-pressed={!cards} aria-label={t("List")} onClick={() => pickCards(false)}><List size={14} /></button><button type="button" aria-pressed={cards} aria-label={t("Cards")} onClick={() => pickCards(true)}><LayoutGrid size={14} /></button></span></div>
            {data && data.parts.length > 6 && <label className="rk-find"><Search size={14} aria-hidden="true" /><input value={fq} onChange={(e) => setFq(e.target.value)} placeholder={t("Find on this shelf")} aria-label={t("Find on this shelf")} /></label>}
            {!data ? <Loading error={error} /> : data.parts.length === 0 ? <p className="muted rk-empty">{t("Nothing on this shelf.")}</p> : visible.length === 0 ? <p className="muted rk-empty">{t("No part like that.")}</p> : (
              <ul className={"rk-list" + (cards ? " rk-cards" : "")}>{visible.map((p) => (
                <li key={p.id} className={Number(p.quantity) <= Number(p.reorder_level ?? -1) ? "low" : ""}>
                  <span className="sm-thumb"><ItemPhoto item={p as never} peek /></span>
                  <span className="rk-name"><b>{p.name}</b><small>{[p.part_number || p.sku, p.brand].filter(Boolean).join(" · ")}</small></span>
                  <span className={"rk-qty" + (Number(p.quantity) <= Number(p.reorder_level ?? -1) ? " low" : "")}>{Number(p.quantity)}{p.unit === "LITRE" ? " L" : ""}</span>
                  <span className="rk-row-actions">
                    {can("stock_out") && Number(p.quantity) > 0 && <button type="button" className="button secondary small" onClick={() => { after(); window.dispatchEvent(new CustomEvent("lifta:take-out", { detail: p.id })); }}>{t("Issue")}</button>}
                    {can("stock_in") && <button type="button" className="button secondary small" onClick={() => { after(); putIn(shelf, p.id); }}>{t("Receive")}</button>}
                  </span>
                </li>
              ))}</ul>
            )}
          </div>
        </div>
        <div className="rk-actions">
          {can("stock_in") && <button type="button" className="button primary small" onClick={() => { after(); putIn(shelf); }}><Plus size={14} aria-hidden="true" /> {t("Receive to {shelf}", { shelf })}</button>}
          {can("stock_count") && <button type="button" className="button secondary small" onClick={() => onOpen(level, "count")}><ClipboardCheck size={14} aria-hidden="true" /> {t("Stock count")}</button>}
          {can("shelf_move") && <button type="button" className="button secondary small" onClick={() => onOpen(level, "transfer")}><ArrowRightLeft size={14} aria-hidden="true" /> {t("Transfer")}</button>}
          <span className="rk-sp" />
          {can("lists") && <button type="button" className="button secondary small" onClick={() => printLabelsInPage([{ title: shelf, sub: t("Shelf"), code: shelfCode(rack.id, level?.id || "") }])}><Printer size={14} aria-hidden="true" /> {t("Print label")}</button>}
          <button type="button" className="button secondary small" onClick={() => onOpen(level)}>{t("Open shelf page")}</button>
        </div>
        {noCamera() && !docked && <p className="muted sm-nocam">{t("No camera here. Camera scan stays on the phone Counter.")}</p>}
    </>,
  );
}
