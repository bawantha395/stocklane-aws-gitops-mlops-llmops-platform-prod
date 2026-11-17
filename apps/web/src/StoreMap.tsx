import { Fragment, useCallback, useEffect, useMemo, useState } from "react";
import { Search, User } from "lucide-react";
import { can } from "./perms";
import { toast } from "./ui";
import { api } from "./api";
import QRCode from "qrcode";
import { t } from "./i18n";
import { Empty, Loading, useLoad } from "./workshop/common";
import { Photo } from "./workshop/Photos";

type Level = { id: string; name: string; photo_id?: string };
type Rack = { id: string; name: string; area_id?: string | null; type: "RACK" | "CUPBOARD" | "FLOOR"; levels: Level[] };
type Layout = { counted?: Record<string, Record<string, { at: string; by?: string }>>; areas: { id: string; name: string; pos?: string }[]; racks: Rack[]; counts: Record<string, Record<string, number>>; not_shelved: number };
type Part = { id: string; sku: string; name: string; brand?: string; part_number?: string; unit: string; quantity: number; reorder_level?: number; location?: string; level_id?: string | null };
type Item = { id: string; sku: string; name: string; brand?: string; part_number?: string; location?: string; quantity: number; unit: string; category?: string };
type Sel = { rack: string; level: string; label: string };

const TYPE: Record<string, string> = { RACK: "Rack", CUPBOARD: "Cupboard", FLOOR: "Floor" };
export const SHELF_FOCUS = "lifta.shelfFocus";
/** What a shelf QR label holds. It uses ids, so renaming a rack never breaks a printed label. */
export const shelfCode = (rack: string, level = "") => "lifta:shelf:" + rack + ":" + level;
export const parseShelfCode = (v: string) => { const m = /^lifta:shelf:([^:]+):(.*)$/.exec((v || "").trim()); return m ? { rack: m[1], level: m[2] } : null; };
const DAY = 86400000, STALE_DAYS = 90;
const dayText = (iso?: string) => (iso ? new Date(iso).toLocaleDateString() : "");

/** One A4 sheet: a QR and the shelf name in big letters for every shelf. Opens in a new tab to print. */
async function printLabels(data: Layout) {
  const cells: string[] = [];
  for (const r of data.racks) for (const l of r.levels.length ? r.levels : [undefined]) {
    const name = label(r, l), qr = await QRCode.toDataURL(shelfCode(r.id, l?.id || ""), { margin: 1, width: 360 });
    cells.push('<div class="c"><img src="' + qr + '"><b>' + name.replace(/[<&>]/g, "") + "</b></div>");
  }
  const w = window.open("", "_blank");
  if (!w) { toast(t("Allow pop-ups to print the labels."), { bad: true }); return; }
  w.document.write("<!doctype html><title>" + t("Shelf labels") + "</title><style>body{font-family:sans-serif;margin:10mm}.g{display:grid;grid-template-columns:repeat(3,1fr);gap:6mm}.c{border:1px dashed #888;padding:4mm;text-align:center;break-inside:avoid}.c img{width:100%;max-width:48mm}.c b{display:block;font-size:26pt}</style><div class=g>" + cells.join("") + "</div><script>setTimeout(function(){print()},400)</script>");
  w.document.close();
}
/** A rack named just "3" reads as "Rack 3"; any other name is shown as the owner wrote it. */
export const rackTitle = (n: string) => (/^\d+$/.test(n.trim()) ? t("Rack") + " " + n.trim() : n);
const label = (r: Rack, l?: Level) => (l ? r.name + "-" + l.name : r.name);
const total = (c: Record<string, number> | undefined) => Object.values(c || {}).reduce((a, b) => a + b, 0);

/** The store room as the owner drew it: walls, racks, levels. Tap a shelf to see its parts; search a part to see where it is. */
export function StoreMap({ items }: { items: Item[] }) {
  const { data, error, reload } = useLoad<Layout>("/api/inventory/stores/layout");
  const [sel, setSel] = useState<Sel | null>(null), [q, setQ] = useState(""), [look, setLook] = useState<{ rack: Rack; wall: string } | null>(null);
  // Move: parts ticked on a shelf page, then the shelf they go to is tapped on the map
  const [moving, setMoving] = useState<string[] | null>(null), [ver, setVer] = useState(0), [busyMove, setBusyMove] = useState(false);
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
  const WallBox = ({ pos, wall, racks }: { pos: string; wall: { id: string; name: string; pos?: string }; racks: Rack[] }) => (
    <div className={"sm-pos sm-wallbox " + pos.toLowerCase()}>
      <h3 className="sm-wall"><span className="sm-dir" aria-hidden="true">{{ N: "↑", S: "↓", W: "←", E: "→", X: "" }[pos]}</span> {wall.name}</h3>
      <div className="sm-racks">
        {racks.length === 0 && <small className="muted">{t("No racks on this wall yet.")}</small>}
        {racks.map((r) => {
          const c = data.counts[r.id], on = sel?.rack === r.id;
          return (
            <div key={r.id} className={"sm-rack" + (on ? " on" : "") + ((r.levels.length === 0 ? shown(r) : r.levels.some((l) => shown(r, l))) ? " lit" : "")}>
              <button className="sm-rack-head" aria-pressed={on && !sel?.level} disabled={!!moving && r.levels.length > 0} title={t("Quick look")} onClick={() => (moving || r.levels.length === 0 ? pick(r) : setLook({ rack: r, wall: wall.name }))}>
                <b>{rackTitle(r.name)}</b><small>{t(TYPE[r.type] || "Rack")}</small><span className="ws-count" aria-label={t("Parts")}>{total(c)}</span>
              </button>
              {!!moving && r.levels.map((l) => (
                <button key={l.id} className={"sm-level" + (sel?.level === l.id ? " on" : "") + (shown(r, l) ? " lit" : "")} aria-pressed={sel?.level === l.id} onClick={() => pick(r, l)}>
                  <span>{l.name}</span><span className="ws-count">{c?.[l.id] || 0}</span>
                </button>
              ))}
            </div>
          );
        })}
      </div>
    </div>
  );
  return (
    <section className="ws" data-tour="store-map">
      <div className="ws-top"><div><h1 className="ws-large">{t("Store room")}</h1><p className="ws-hint">{t("Tap a shelf to see its parts.")}</p></div></div>
      {can("lists") && data.racks.length > 0 && <div className="sm-tools"><button type="button" className="button secondary small" onClick={() => void printLabels(data)}>{t("Print shelf labels")}</button></div>}
      <label className="sm-search"><Search size={16} /><input value={q} onChange={(e) => setQ(e.target.value)} placeholder={t("Find a part: name or part number")} aria-label={t("Find a part")} /></label>
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
      {(() => {
        const old = data.racks.flatMap((r) => (r.levels.length ? r.levels.map((l) => ({ r, l })) : [{ r, l: undefined as Level | undefined }])).filter(({ r, l }) => (data.counts[r.id]?.[l?.id || ""] || 0) > 0 && !(Date.now() - new Date(data.counted?.[r.id]?.[l?.id || ""]?.at || 0).getTime() < STALE_DAYS * DAY));
        return old.length > 0 && !moving ? (
          <details className="sm-stale"><summary>{t("Not counted for 3 months")} ({old.length})</summary>
            <p>{old.map(({ r, l }) => <button key={r.id + (l?.id || "")} type="button" className="shelf-chip" onClick={() => setSel({ rack: r.id, level: l?.id || "", label: label(r, l) })}>{label(r, l)}</button>)}</p>
          </details>
        ) : null;
      })()}
      {moving && (
        <div className="sm-moving" role="status"><b>{t("Tap the shelf to move {n} parts to.", { n: moving.length })}</b> <button type="button" className="button secondary small" onClick={() => setMoving(null)}>{t("Cancel")}</button></div>
      )}
      {data.racks.length === 0 && <Empty>{t("The store room is not set up yet. The owner does it in Settings → Store room.")}</Empty>}
      {(can("stock_in") || can("stock_out")) && !moving && (
        <div className="sm-tools sm-batch">
          {can("stock_in") && <button type="button" className="button secondary small" onClick={() => window.dispatchEvent(new Event("lifta:batch-in"))}>{t("Several came in")}</button>}
          {can("stock_out") && <button type="button" className="button secondary small" onClick={() => window.dispatchEvent(new Event("lifta:batch-out"))}>{t("Take out several")}</button>}
        </div>
      )}
      <div className="sm-compass" aria-label={t("Store room map")}>
        {(["N", "W", "C", "E", "S"] as const).map((pos) => {
          if (pos === "C") return <div key="c" className="sm-pos c"><span className="sm-keeper"><User size={26} /></span><small>{t("Storekeeper")}</small></div>;
          const wall = data.areas.find((w) => w.pos === pos);
          return wall ? <Fragment key={pos}>{WallBox({ pos, wall, racks: data.racks.filter((r) => r.area_id === wall.id) })}</Fragment> : null;
        })}
      </div>
      {data.racks.some((r) => !r.area_id || !data.areas.some((w) => w.id === r.area_id)) && WallBox({ pos: "X", wall: { id: "", name: t("No wall"), pos: "X" }, racks: data.racks.filter((r) => !r.area_id || !data.areas.some((w) => w.id === r.area_id)) })}
      <button className={"sm-loose" + (sel?.rack === "none" ? " on" : "")} onClick={() => setSel({ rack: "none", level: "", label: t("Not on a shelf yet") })}>
        {t("Not on a shelf yet")} <span className="ws-count">{data.not_shelved}</span>
      </button>
      {look && <QuickLook rack={look.rack} wall={look.wall} counts={data.counts[look.rack.id] || {}} onClose={() => setLook(null)} onOpen={(l) => { setLook(null); setSel({ rack: look.rack.id, level: l?.id || "", label: label(look.rack, l) }); }} />}
      {sel && <ShelfPage key={sel.rack + "/" + sel.level + "/" + ver} sel={sel} rack={data.racks.find((r) => r.id === sel.rack)} onClose={() => { setSel(null); setMoving(null); }} onMove={can("shelf_move") ? (ids) => setMoving(ids) : undefined} canCount={can("stock_count")} counted={data.counted?.[sel.rack]?.[sel.level || ""]?.at} onCounted={() => { setVer((v) => v + 1); window.dispatchEvent(new Event("lifta:stock-changed")); void reload(); }} />}
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
function ShelfPage({ sel, rack, onClose, onMove, canCount, counted, onCounted }: { sel: Sel; rack?: Rack; onClose: () => void; onMove?: (ids: string[]) => void; canCount?: boolean; counted?: string; onCounted?: () => void }) {
  const [counting, setCounting] = useState(false), [vals, setVals] = useState<Record<string, string>>({}), [saving, setSaving] = useState(false);
  const [ticked, setTicked] = useState<string[]>([]);
  const tick = useCallback((id: string) => setTicked((x) => (x.includes(id) ? x.filter((y) => y !== id) : [...x, id])), []);
  const path = "/api/inventory/stores/shelf?rack=" + encodeURIComponent(sel.rack) + (sel.level ? "&level=" + encodeURIComponent(sel.level) : "");
  const { data, error } = useLoad<{ parts: Part[] }>(path);
  const photo = rack?.levels.find((l) => l.id === sel.level)?.photo_id;
  const byLevel = (id?: string | null) => rack?.levels.find((l) => l.id === id)?.name || "";
  return (
    <div className="sm-shelf" role="region" aria-label={sel.label} data-tour="shelf-page">
      <div className="sm-shelf-top"><h2>{sel.label}</h2><button className="button secondary small" onClick={onClose}>{t("Close")}</button></div>
      {photo && <Photo id={photo} size="full" className="sm-shelf-photo" />}
      <p className="muted sm-counted">{counted ? t("Last counted") + ": " + dayText(counted) : t("Not counted yet")}</p>
      {sel.rack !== "none" && !counting && (can("stock_in") || can("stock_out")) && (
        <div className="sm-tools">
          {can("stock_in") && <button type="button" className="button primary small" onClick={() => putIn(sel.label)}>{t("Put in")}</button>}
        </div>
      )}
      {canCount && data && data.parts.length > 0 && !counting && <div className="sm-tools"><button type="button" className="button secondary small" onClick={() => { setVals({}); setCounting(true); }}>{t("Count this shelf")}</button></div>}
      {counting && data && (
        <div className="sm-tools">
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
      )}
      {onMove && !counting && data && data.parts.length > 0 && (
        <div className="sm-tools">
          <button type="button" className="button secondary small" onClick={() => setTicked(ticked.length === data.parts.length ? [] : data.parts.slice(0, 15).map((p) => p.id))}>{t("Select all")}</button>
          <button type="button" className="button primary small" disabled={!ticked.length} onClick={() => onMove(ticked)}>{t("Move")} {ticked.length > 0 ? "(" + ticked.length + ")" : ""}</button>
        </div>
      )}
      {!data ? <Loading error={error} /> : data.parts.length === 0 ? <Empty>{t("Nothing on this shelf.")}</Empty> : (
        <ul className="sm-parts">
          {data.parts.map((p) => (
            <li key={p.id} className={Number(p.quantity) <= Number(p.reorder_level ?? -1) ? "low" : ""}>
              {onMove && <input type="checkbox" className="sm-tick" aria-label={t("Move") + " " + p.name} checked={ticked.includes(p.id)} disabled={!ticked.includes(p.id) && ticked.length >= 15} onChange={() => tick(p.id)} />}
              <span><b>{p.name}</b><small>{[p.part_number || p.sku, !sel.level && byLevel(p.level_id) ? t("Level") + " " + byLevel(p.level_id) : ""].filter(Boolean).join(" · ")}</small></span>
              {counting ? (
                <span className="sm-count"><input type="number" inputMode="decimal" min="0" step={p.unit === "LITRE" ? "0.1" : "1"} aria-label={t("Counted") + " " + p.name} value={vals[p.id] ?? ""} onChange={(e) => setVals({ ...vals, [p.id]: e.target.value })} placeholder={String(Number(p.quantity))} />
                  {vals[p.id] !== undefined && vals[p.id] !== "" && Number(vals[p.id]) !== Number(p.quantity) && <small className={Number(vals[p.id]) > Number(p.quantity) ? "up" : "down"}>{Number(vals[p.id]) - Number(p.quantity) > 0 ? "+" : ""}{Math.round((Number(vals[p.id]) - Number(p.quantity)) * 100) / 100}</small>}</span>
              ) : <span className="sm-qty">{Number(p.quantity)} <small>{p.unit === "LITRE" ? "L" : ""}</small>{can("stock_out") && Number(p.quantity) > 0 && <button type="button" className="button secondary small sm-out" onClick={() => window.dispatchEvent(new CustomEvent("lifta:take-out", { detail: p.id }))}>{t("Take out")}</button>}{can("stock_in") && sel.rack !== "none" && <button type="button" className="button secondary small sm-out" onClick={() => putIn(sel.label, p.id)}>{t("Put in")}</button>}</span>}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}


/** Tap a rack: its levels big on the left (with the wall it stands on), the parts of the chosen level on the right. */
function QuickLook({ rack, wall, counts, onClose, onOpen }: { rack: Rack; wall: string; counts: Record<string, number>; onClose: () => void; onOpen: (l?: Level) => void }) {
  const [lv, setLv] = useState(rack.levels.find((l) => (counts[l.id] || 0) > 0)?.id || rack.levels[0]?.id || "");
  const { data, error } = useLoad<{ parts: Part[] }>("/api/inventory/stores/shelf?rack=" + encodeURIComponent(rack.id) + (lv ? "&level=" + encodeURIComponent(lv) : ""));
  const level = rack.levels.find((l) => l.id === lv);
  return (
    <div className="stock-modal-shade" onClick={onClose}>
      <section className="stock-modal sm-look" role="dialog" aria-modal="true" aria-label={rackTitle(rack.name)} onClick={(e) => e.stopPropagation()}>
        <header className="sm-look-top"><span className="sm-wallchip">{wall}</span><h2>{rackTitle(rack.name)}</h2><button type="button" className="button secondary small" onClick={onClose}>{t("Close")}</button></header>
        <div className="sm-look-body">
          <div className="sm-look-levels">
            {rack.levels.map((l) => <button key={l.id} type="button" className={lv === l.id ? "on" : ""} aria-pressed={lv === l.id} onClick={() => setLv(l.id)}><b>{label(rack, l)}</b><span className="ws-count">{counts[l.id] || 0}</span></button>)}
          </div>
          <div className="sm-look-items">
            <h3>{label(rack, level)}{data && <small> {data.parts.length} {data.parts.length === 1 ? t("part") : t("parts")}</small>}</h3>
            {!data ? <Loading error={error} /> : data.parts.length === 0 ? <p className="muted">{t("Nothing on this shelf.")}</p> : (
              <ul className="sm-parts">{data.parts.map((p) => <li key={p.id} className={Number(p.quantity) <= Number(p.reorder_level ?? -1) ? "low" : ""}><span><b>{p.name}</b><small>{p.part_number || p.sku}</small></span><span className="sm-qty">{Number(p.quantity)}{can("stock_out") && Number(p.quantity) > 0 && <button type="button" className="button secondary small" onClick={() => { onClose(); window.dispatchEvent(new CustomEvent("lifta:take-out", { detail: p.id })); }}>{t("Take out")}</button>}{can("stock_in") && <button type="button" className="button secondary small sm-out" onClick={() => { onClose(); putIn(label(rack, level), p.id); }}>{t("Put in")}</button>}</span></li>)}</ul>
            )}
            {noCamera() && <p className="muted sm-nocam">{t("No camera here. Camera scan stays on the phone Counter.")}</p>}
            <div className="sm-tools">
              <button type="button" className="button primary small" onClick={() => onOpen(level)}>{t("Open this shelf")}</button>
              {can("stock_in") && <button type="button" className="button secondary small" onClick={() => putIn(label(rack, level))}>{t("Part came in here")}</button>}
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}
