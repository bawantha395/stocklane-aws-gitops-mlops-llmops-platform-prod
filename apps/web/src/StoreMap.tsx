import { Fragment, type ReactNode, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ArrowRightLeft, Boxes, ClipboardCheck, DoorOpen, Layers, LayoutGrid, List, MoreHorizontal, Plus, Printer, Search, TriangleAlert, X } from "lucide-react";
import { can } from "./perms";
import { toast } from "./ui";
import { api } from "./api";
import { printLabelsInPage } from "./partsShared";
import { ItemPhoto } from "./LabelDialog";
import { t } from "./i18n";
import { Empty, Loading, useLoad } from "./workshop/common";
import { Photo } from "./workshop/Photos";

type Level = { id: string; name: string; photo_id?: string };
type Rack = { id: string; photo_id?: string; row?: number; col?: number; name: string; area_id?: string | null; type: "RACK" | "CUPBOARD" | "FLOOR"; levels: Level[] };
type Layout = { marks?: { id: string; kind: "IN" | "OUT" | "STAGING"; row: number; col: number }[]; counted?: Record<string, Record<string, { at: string; by?: string }>>; areas: { id: string; name: string; pos?: string }[]; racks: Rack[]; counts: Record<string, Record<string, number>>; not_shelved: number };
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
  const [attn, setAttn] = useState(false);
  const searchRef = useRef<HTMLInputElement>(null);
  useEffect(() => { const f = (e: KeyboardEvent) => { const el = e.target as HTMLElement | null; if (e.key === "/" && !e.ctrlKey && !e.metaKey && !/^(INPUT|TEXTAREA|SELECT)$/.test(el?.tagName || "") && !el?.isContentEditable) { e.preventDefault(); searchRef.current?.focus(); } }; window.addEventListener("keydown", f); return () => window.removeEventListener("keydown", f); }, []);
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
    const zi = data.areas.findIndex((a) => a.id === r.area_id), used = r.levels.length ? r.levels.filter((l) => (c?.[l.id] || 0) > 0).length : total(c) > 0 ? 1 : 0, pct = Math.round((used / (r.levels.length || 1)) * 100);
    return (
      <div key={r.id} className={"sm-rack z" + (zi < 0 ? "x" : zi) + (total(c) === 0 ? " empty" : "") + (staleRacks.has(r.id) ? " stale" : "") + (attn ? (staleRacks.has(r.id) ? " flag" : " dim") : "") + (on || look?.rack.id === r.id ? " on" : "") + (hasHit(r) ? " lit" : "")}>
        <button className="sm-rack-head" aria-pressed={on && !sel?.level} disabled={!!moving && r.levels.length > 0} title={t("Quick look") + " · " + t(TYPE[r.type] || "Rack")} onClick={() => openRack(r, wallName)}>
          <span className="sm-rk-top"><Boxes size={15} aria-hidden="true" /><b>{rackTitle(r.name)}</b><i className={"sm-dot " + (total(c) === 0 ? "empty" : staleRacks.has(r.id) ? "stale" : "ok")} title={total(c) === 0 ? t("Empty") : staleRacks.has(r.id) ? t("Not counted for 3 months") : ""} aria-hidden="true" /></span>
          <span className="sm-rk-sub">{total(c) > 0 ? total(c) + " " + (total(c) === 1 ? t("part") : t("parts")) : t("Empty")}</span>
          <span className="sm-util" title={pct + "% " + t("of shelves in use")}><span className="sm-track"><i className={pct > 85 ? "r" : pct > 60 ? "a" : "g"} style={{ width: pct + "%" }} /></span><em>{pct}%</em></span>
        </button>
        {!!moving && r.levels.map((l) => (
          <button key={l.id} className={"sm-level" + (sel?.level === l.id ? " on" : "") + (shown(r, l) ? " lit" : "")} aria-pressed={sel?.level === l.id} onClick={() => pick(r, l)}>
            <span>{l.name}</span><span className="ws-count">{c?.[l.id] || 0}</span>
          </button>
        ))}
      </div>
    );
  };
  const wallsList = (["N", "W", "E", "S"] as const).flatMap((pos) => { const w = data.areas.find((a) => a.pos === pos); return w ? [w] : []; });
  const wallOf = (r: Rack) => data.areas.find((a) => a.id === r.area_id)?.name || "";
  const flatRacks = [...wallsList.flatMap((w) => data.racks.filter((r) => r.area_id === w.id)), ...data.racks.filter((r) => !wallsList.some((w) => w.id === r.area_id))];
  const view = moving ? "map" : layoutView;
  const placed = flatRacks.filter((r) => r.row !== undefined), marks = data.marks || [];
  const planned = (placed.length > 0 || marks.length > 0) && !moving;
  const rows = Math.max(0, ...placed.map((r) => (r.row as number) + 1), ...marks.map((m) => m.row + 1)), cols = Math.max(0, ...placed.map((r) => (r.col as number) + 1), ...marks.map((m) => m.col + 1));
  const unplaced = flatRacks.filter((r) => r.row === undefined);
  const zoneUse = data.areas.map((a, i) => ({ a, i })).filter(({ a }) => placed.some((r) => r.area_id === a.id));
  const planView = (
    <div className="sm-plan">
      {zoneUse.length > 1 && <p className="sm-legend" aria-label={t("Walls")}>{zoneUse.map(({ a, i }) => <span key={a.id}><i className={"z" + i} aria-hidden="true" /> {a.name}</span>)}</p>}
      <div className="sm-scroll"><div className={"sm-fp" + (data.racks.length > 24 ? " dense" : "")} style={{ gridTemplateColumns: "repeat(" + cols + ", minmax(0, 1fr))" }} aria-label={t("Store room map")}>
        {Array.from({ length: rows * cols }, (_, n) => {
          const r = Math.floor(n / cols), c = n % cols;
          const rk = placed.find((x) => x.row === r && x.col === c), mk = marks.find((m) => m.row === r && m.col === c);
          if (rk) return <Fragment key={n}>{tile(rk, wallOf(rk))}</Fragment>;
          if (mk) return <div key={n} className={"sm-mark " + mk.kind.toLowerCase()}>{mk.kind === "STAGING" ? <Layers size={14} aria-hidden="true" /> : <DoorOpen size={14} aria-hidden="true" />}<b>{mk.kind === "STAGING" ? t("Staging") : t(mk.kind)}</b></div>;
          return <span key={n} className="sm-aisle" aria-hidden="true" />;
        })}
      </div></div>
      {unplaced.length > 0 && <><p className="sm-unplaced">{t("Not on the floor plan yet")}</p><div className={"sm-flat" + (data.racks.length > 24 ? " dense" : "")}>{unplaced.map((r) => tile(r, wallOf(r)))}</div></>}
    </div>
  );
  const roomView = planned ? planView : <div className={"sm-flat" + (data.racks.length > 24 ? " dense" : "")} aria-label={t("Store room map")}>{flatRacks.map((r) => tile(r, wallOf(r)))}</div>;
  const listView = (
    <div className="sm-list" aria-label={t("Racks")}>
      {flatRacks.map((r) => {
        const c = data.counts[r.id], newest = r.levels.map((l) => data.counted?.[r.id]?.[l.id]?.at).filter(Boolean).sort().pop();
        return (
          <button key={r.id} type="button" className={"sm-row" + (total(c) === 0 ? " empty" : "") + (look?.rack.id === r.id ? " on" : "") + (hasHit(r) ? " lit" : "")} onClick={() => openRack(r, wallOf(r))}>
            <b>{rackTitle(r.name)}</b>
            <span>{r.levels.length} {r.levels.length === 1 ? t("shelf") : t("shelves")}</span>
            <span>{total(c)} {total(c) === 1 ? t("part") : t("parts")}</span>
            <span className={staleRacks.has(r.id) ? "old" : ""}>{staleRacks.has(r.id) ? <TriangleAlert size={12} aria-hidden="true" /> : null} {newest ? ago(newest as string) : t("Not counted yet")}</span>
          </button>
        );
      })}
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
      <p className="sm-sum" aria-label={t("Summary")}>
        <span><b>{data.racks.length}</b> {data.racks.length === 1 ? t("rack") : t("racks")}</span>
        <span><b>{Object.values(data.counts).reduce((a, c) => a + total(c), 0)}</b> {t("Part types on shelves")}</span>
        <button type="button" className={"sm-sum-b" + (sel?.rack === "none" ? " on" : "") + (data.not_shelved > 0 ? " warn" : "")} onClick={() => { setStart(""); setSel({ rack: "none", level: "", label: t("Not on a shelf yet") }); }}><b>{data.not_shelved}</b> {t("Not on a shelf yet")}</button>
        {old.length > 0 && !moving && <button type="button" className={"sm-sum-b warn" + (attn ? " on" : "")} aria-pressed={attn} onClick={() => setAttn(!attn)}><TriangleAlert size={13} aria-hidden="true" /> <b>{old.length}</b> {t("Not counted for 3 months")}</button>}
      </p>
      <div className={"sm-split" + (wide ? " wide" : "")}>
      <div className="sm-left">
      <div className="sm-bar">
      <label className="sm-search"><Search size={16} /><input ref={searchRef} value={q} onChange={(e) => setQ(e.target.value)} placeholder={t("Find a part: name or part number") + "  ( / )"} aria-label={t("Find a part")} /></label>
        {!moving && <div className="sm-seg" role="group" aria-label={t("View")}><button type="button" aria-pressed={view === "map"} onClick={() => chooseView("map")}><LayoutGrid size={15} aria-hidden="true" /> {t("Map")}</button><button type="button" aria-pressed={view === "list"} onClick={() => chooseView("list")}><List size={15} aria-hidden="true" /> {t("List")}</button></div>}
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
  const [fq, setFq] = useState(""), [more, setMore] = useState(false);
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
          <div className="rk-title"><div><h2>{rackTitle(rack.name)}</h2><span className="rk-sum">{[wall, rack.levels.length + " " + (rack.levels.length === 1 ? t("shelf") : t("shelves")), total(counts) + " " + t("Part types"), t("Last counted") + " " + ago(newest as string | undefined)].filter(Boolean).join(" · ")}</span></div></div>
          <button type="button" className="rk-x" aria-label={t("Close")} onClick={onClose}><X size={18} /></button>
        </header>
        {rack.photo_id && total(counts) > 0 && <Photo id={rack.photo_id} size="full" className="rk-rack-photo" />}
        <div className="rk-body rk-body2">
          <div className="rk-tabs" role="tablist" aria-label={t("Shelves")}>
            {rack.levels.map((l) => { const w = when(l), n = counts[l.id] || 0; return (
              <button key={l.id} type="button" role="tab" className={"rk-tab" + (lv === l.id ? " on" : "") + (w.old && n > 0 ? " old" : "")} aria-selected={lv === l.id} title={w.text} onClick={() => setLv(l.id)}>
                {w.old && n > 0 ? <TriangleAlert size={12} aria-hidden="true" /> : null}<b>{l.name}</b><span className="rk-n">{n}</span>
              </button>
            ); })}
          </div>
          <div className="rk-items">
            {level && <p className={"rk-counted" + (when(level).old && (counts[level.id] || 0) > 0 ? " old" : "")}>{when(level).text}</p>}
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
          <span className="rk-more">
            <button type="button" className="button secondary small" aria-haspopup="menu" aria-expanded={more} aria-label={t("More")} onClick={() => setMore(!more)}><MoreHorizontal size={16} aria-hidden="true" /></button>
            {more && <span className="rk-menu" role="menu">
              {can("lists") && <button type="button" role="menuitem" onClick={() => { setMore(false); printLabelsInPage([{ title: shelf, sub: t("Shelf"), code: shelfCode(rack.id, level?.id || "") }]); }}><Printer size={14} aria-hidden="true" /> {t("Print label")}</button>}
              <button type="button" role="menuitem" onClick={() => { setMore(false); onOpen(level); }}>{t("Open shelf page")}</button>
            </span>}
          </span>
        </div>
        {noCamera() && !docked && <p className="muted sm-nocam">{t("No camera here. Camera scan stays on the phone Counter.")}</p>}
    </>,
  );
}
