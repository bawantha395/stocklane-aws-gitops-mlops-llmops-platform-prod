import { useEffect, useMemo, useState } from "react";
import { Search } from "lucide-react";
import { t } from "./i18n";
import { Empty, Loading, useLoad } from "./workshop/common";
import { Photo } from "./workshop/Photos";

type Level = { id: string; name: string; photo_id?: string };
type Rack = { id: string; name: string; area_id?: string | null; type: "RACK" | "CUPBOARD" | "FLOOR"; levels: Level[] };
type Layout = { areas: { id: string; name: string }[]; racks: Rack[]; counts: Record<string, Record<string, number>>; not_shelved: number };
type Part = { id: string; sku: string; name: string; brand?: string; part_number?: string; unit: string; quantity: number; reorder_level?: number; location?: string; level_id?: string | null };
type Item = { id: string; sku: string; name: string; brand?: string; part_number?: string; location?: string; quantity: number; unit: string; category?: string };
type Sel = { rack: string; level: string; label: string };

const TYPE: Record<string, string> = { RACK: "Rack", CUPBOARD: "Cupboard", FLOOR: "Floor" };
export const SHELF_FOCUS = "lifta.shelfFocus";
const label = (r: Rack, l?: Level) => (l ? r.name + "-" + l.name : r.name);
const total = (c: Record<string, number> | undefined) => Object.values(c || {}).reduce((a, b) => a + b, 0);

/** The store room as the owner drew it: walls, racks, levels. Tap a shelf to see its parts; search a part to see where it is. */
export function StoreMap({ items }: { items: Item[] }) {
  const { data, error } = useLoad<Layout>("/api/inventory/stores/layout");
  const [sel, setSel] = useState<Sel | null>(null), [q, setQ] = useState("");
  const labels = useMemo(() => {
    const m = new Map<string, Sel>();
    (data?.racks || []).forEach((r) => { m.set(r.name.toLowerCase(), { rack: r.id, level: "", label: r.name }); r.levels.forEach((l) => m.set(label(r, l).toLowerCase(), { rack: r.id, level: l.id, label: label(r, l) })); });
    return m;
  }, [data]);
  // a Find screen can hand over the shelf it wants shown
  useEffect(() => {
    if (!data) return;
    let want = ""; try { want = sessionStorage.getItem(SHELF_FOCUS) || ""; sessionStorage.removeItem(SHELF_FOCUS); } catch { /* ignore */ }
    const hit = want && labels.get(want.toLowerCase());
    if (hit) setSel(hit);
  }, [data, labels]);
  const words = q.toLowerCase().split(/\s+/).filter(Boolean);
  const found = useMemo(() => (words.length === 0 ? [] : items.filter((p) => { const hay = [p.name, p.brand, p.part_number, p.sku, p.category].join(" ").toLowerCase(); return words.every((w) => hay.includes(w)); }).slice(0, 30)), [items, q]); // eslint-disable-line react-hooks/exhaustive-deps
  const lit = new Set(found.map((p) => (p.location || "").toLowerCase()).filter(Boolean));
  if (!data) return <Loading error={error} />;
  const areas = [...data.areas, ...(data.racks.some((r) => !r.area_id) ? [{ id: "", name: t("No wall") }] : [])];
  const shown = (r: Rack, l?: Level) => lit.has(label(r, l).toLowerCase());
  return (
    <section className="ws" data-tour="store-map">
      <div className="ws-top"><div><h1 className="ws-large">{t("Store room")}</h1><p className="ws-hint">{t("Tap a shelf to see its parts.")}</p></div></div>
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
      {data.racks.length === 0 && <Empty>{t("The store room is not set up yet. The owner does it in Setup → Settings → Store room.")}</Empty>}
      {areas.map((a) => {
        const racks = data.racks.filter((r) => (r.area_id || "") === a.id);
        if (!racks.length) return null;
        return (
          <div className="ws-area" key={a.id || "none"}>
            <h3 className="sm-wall">{a.name}</h3>
            <div className="sm-racks">
              {racks.map((r) => {
                const c = data.counts[r.id], on = sel?.rack === r.id;
                return (
                  <div key={r.id} className={"sm-rack" + (on ? " on" : "") + (r.levels.length === 0 && shown(r) ? " lit" : "")}>
                    <button className="sm-rack-head" aria-pressed={on && !sel?.level} onClick={() => setSel({ rack: r.id, level: "", label: r.name })}>
                      <b>{r.name}</b><small>{t(TYPE[r.type] || "Rack")}</small><span className="ws-count" aria-label={t("Parts")}>{total(c)}</span>
                    </button>
                    {r.levels.map((l) => (
                      <button key={l.id} className={"sm-level" + (sel?.level === l.id ? " on" : "") + (shown(r, l) ? " lit" : "")} aria-pressed={sel?.level === l.id} onClick={() => setSel({ rack: r.id, level: l.id, label: label(r, l) })}>
                        <span>{l.name}</span><span className="ws-count">{c?.[l.id] || 0}</span>
                      </button>
                    ))}
                  </div>
                );
              })}
            </div>
          </div>
        );
      })}
      <button className={"sm-loose" + (sel?.rack === "none" ? " on" : "")} onClick={() => setSel({ rack: "none", level: "", label: t("Not on a shelf yet") })}>
        {t("Not on a shelf yet")} <span className="ws-count">{data.not_shelved}</span>
      </button>
      {sel && <ShelfPage key={sel.rack + "/" + sel.level} sel={sel} rack={data.racks.find((r) => r.id === sel.rack)} onClose={() => setSel(null)} />}
    </section>
  );
}

/** One shelf (or a whole rack, or the parts with no shelf): what is on it, and the photo of it if the owner took one. */
function ShelfPage({ sel, rack, onClose }: { sel: Sel; rack?: Rack; onClose: () => void }) {
  const path = "/api/inventory/stores/shelf?rack=" + encodeURIComponent(sel.rack) + (sel.level ? "&level=" + encodeURIComponent(sel.level) : "");
  const { data, error } = useLoad<{ parts: Part[] }>(path);
  const photo = rack?.levels.find((l) => l.id === sel.level)?.photo_id;
  const byLevel = (id?: string | null) => rack?.levels.find((l) => l.id === id)?.name || "";
  return (
    <div className="sm-shelf" role="region" aria-label={sel.label} data-tour="shelf-page">
      <div className="sm-shelf-top"><h2>{sel.label}</h2><button className="button secondary small" onClick={onClose}>{t("Close")}</button></div>
      {photo && <Photo id={photo} size="full" className="sm-shelf-photo" />}
      {!data ? <Loading error={error} /> : data.parts.length === 0 ? <Empty>{t("Nothing on this shelf.")}</Empty> : (
        <ul className="sm-parts">
          {data.parts.map((p) => (
            <li key={p.id} className={Number(p.quantity) <= Number(p.reorder_level ?? -1) ? "low" : ""}>
              <span><b>{p.name}</b><small>{[p.part_number || p.sku, !sel.level && byLevel(p.level_id) ? t("Level") + " " + byLevel(p.level_id) : ""].filter(Boolean).join(" · ")}</small></span>
              <span className="sm-qty">{Number(p.quantity)} <small>{p.unit === "LITRE" ? "L" : ""}</small></span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
