import { useEffect, useRef, useState } from "react";
import { Boxes, Camera } from "lucide-react";
import { t } from "../i18n";
import { toast } from "../ui";
import { api } from "../api";
import { uploadPhoto } from "../photo";
import { Photo } from "./Photos";
import { setModules } from "../modules";
import { counterStartIsAuto, getCounterStart, setCounterStart } from "../counterStart";

type Lv = { id?: string; name: string; photo_id?: string };
type Rk = { id?: string; name: string; area: string; type: "RACK" | "CUPBOARD" | "FLOOR"; levels: Lv[] };
type Ar = { id?: string; name: string; pos?: string };
type Layout = { areas: { id: string; name: string; pos?: string }[]; racks: { id: string; name: string; area_id: string | null; type: Rk["type"]; levels: Lv[] }[]; counts: Record<string, Record<string, number>>; not_shelved: number; revision: number };
const TYPE: Record<Rk["type"], string> = { RACK: "Rack", CUPBOARD: "Cupboard", FLOOR: "Floor" };
const move = <T,>(list: T[], i: number, d: number) => { const j = i + d; if (j < 0 || j >= list.length) return list; const c = [...list]; [c[i], c[j]] = [c[j], c[i]]; return c; };

/** Owner: the store room as it is in real life: walls (areas), the racks along each, and the levels of each rack. Ids never change, so a
 *  rename keeps the label and the shelf the same shelf. A shelf with parts on it cannot be removed. */
export function StoreRoomSection() {
  const [areas, setAreas] = useState<Ar[]>([]), [racks, setRacks] = useState<Rk[]>([]), [counts, setCounts] = useState<Layout["counts"]>({}), [loose, setLoose] = useState(0);
  const [revision, setRevision] = useState(0), [busy, setBusy] = useState(false), [error, setError] = useState(""), [loaded, setLoaded] = useState(false), [dirty, setDirty] = useState(false);
  const adopt = (l: Layout) => {
    setAreas(l.areas.map((a) => ({ id: a.id, name: a.name, pos: a.pos }))); setCounts(l.counts); setLoose(l.not_shelved); setRevision(l.revision); setDirty(false);
    setRacks(l.racks.map((r) => ({ id: r.id, name: r.name, area: r.area_id || "", type: r.type, levels: r.levels.map((x) => ({ ...x })) })));
  };
  const load = () => api<Layout>("/api/inventory/stores/layout").then((l) => { adopt(l); setLoaded(true); }).catch((e) => setError((e as Error).message));
  useEffect(() => { void load(); }, []);
  const edit = <T,>(set: (f: (x: T[]) => T[]) => void, f: (x: T[]) => T[]) => { set(f); setDirty(true); };
  const used = (r: Rk, l?: Lv) => (r.id ? (l ? counts[r.id]?.[l.id || ""] || 0 : Object.values(counts[r.id] || {}).reduce((a, b) => a + b, 0)) : 0);
  const save = async () => {
    setBusy(true); setError("");
    try {
      const body = { revision, areas: areas.map((a) => ({ ...(a.id ? { id: a.id } : {}), ...(a.pos ? { pos: a.pos } : {}), name: a.name.trim() })).filter((a) => a.name),
        racks: racks.filter((r) => r.name.trim()).map((r) => ({ ...(r.id ? { id: r.id } : {}), name: r.name.trim(), type: r.type, area_id: r.area ? (areas.find((a) => (a.id || a.name) === r.area)?.id || areas.find((a) => a.name === r.area)?.name || null) : null,
          levels: r.levels.filter((l) => l.name.trim()).map((l) => ({ ...(l.id ? { id: l.id } : {}), name: l.name.trim(), ...(l.photo_id ? { photo_id: l.photo_id } : { photo_id: "" }) })) })) };
      const res = await api<Layout & { moved: number }>("/api/inventory/stores/layout", { method: "PUT", body: JSON.stringify(body) }, crypto.randomUUID());
      adopt(res); window.dispatchEvent(new Event("lifta:stock-changed"));
      toast(res.moved ? t("Saved. {n} parts moved to the new names.", { n: res.moved }) : t("Store room saved"));
    } catch (e) {
      setError((e as Error).message); toast((e as Error).message, { bad: true });
    } finally { setBusy(false); }
  };
  const quick = async () => {
    setBusy(true); setError("");
    try { adopt(await api<Layout>("/api/inventory/stores/quick-start", { method: "POST", body: "{}" }, crypto.randomUUID())); toast(t("Starting layout made. Rename and trim it to match your store room.")); }
    catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  };
  const key = (a: Ar) => a.id || a.name;
  const WALL_TEXT: Record<string, string> = { W: "Left wall (west)", E: "Right wall (east)", N: "Top wall (north)", S: "Bottom wall (south)" };
  const groups: { area: Ar | null; racks: { r: Rk; i: number }[] }[] = [...areas.map((a) => ({ area: a as Ar | null, racks: racks.map((r, i) => ({ r, i })).filter(({ r }) => r.area === key(a)) })),
    { area: null, racks: racks.map((r, i) => ({ r, i })).filter(({ r }) => !r.area || !areas.some((a) => key(a) === r.area)) }];
  const setRack = (i: number, r: Rk) => edit(setRacks, (x) => x.map((v, k) => (k === i ? r : v)));
  const swapRack = (i: number, d: number) => edit(setRacks, (x) => { // move within the same wall only
    const here = x[i].area; let j = i + d; while (j >= 0 && j < x.length && x[j].area !== here) j += d;
    if (j < 0 || j >= x.length) return x; const c = [...x]; [c[i], c[j]] = [c[j], c[i]]; return c; });
  // Drag and drop (mouse and pen): a rack dropped on another rack goes before it, on that rack's wall; dropped on a wall heading it goes to the end of that wall.
  const [drag, setDrag] = useState<{ rack: number; level?: number } | null>(null);
  const dropRack = (target: number) => { if (!drag || drag.level !== undefined || drag.rack === target) return; edit(setRacks, (x) => { const c = [...x], [m] = c.splice(drag.rack, 1); const at = c.indexOf(x[target]); c.splice(at, 0, { ...m, area: x[target].area }); return c; }); setDrag(null); };
  const dropWall = (wall: Ar | null) => { if (!drag || drag.level !== undefined) return; const area = wall ? key(wall) : ""; edit(setRacks, (x) => { const c = [...x], [m] = c.splice(drag.rack, 1); let last = -1; c.forEach((r, k) => { if (r.area === area) last = k; }); c.splice(last + 1, 0, { ...m, area }); return c; }); setDrag(null); };
  const dropLevel = (i: number, to: number) => { if (!drag || drag.level === undefined || drag.rack !== i || drag.level === to) return; const r = racks[i]; const lv = [...r.levels], [m] = lv.splice(drag.level, 1); lv.splice(to, 0, m); setRack(i, { ...r, levels: lv }); setDrag(null); };
  const [adding, setAdding] = useState(""), [addN, setAddN] = useState("1"), [addL, setAddL] = useState("3");
  const addRacks = (wall: Ar) => {
    const n = Math.max(1, Math.min(30, Math.floor(Number(addN)) || 1)), l = Math.max(1, Math.min(12, Math.floor(Number(addL)) || 1));
    edit(setRacks, (x) => {
      let next = Number(nextNumber()); const out = [...x];
      for (let k = 0; k < n && out.length < 100; k++) out.push({ name: String(next++), area: key(wall), type: "RACK" as const, levels: Array.from({ length: l }, (_, v) => ({ name: String.fromCharCode(65 + v) })) });
      return out;
    });
    setAdding("");
  };
  const nextNumber = () => String(racks.reduce((n, r) => (/^\d+$/.test(r.name.trim()) ? Math.max(n, Number(r.name.trim())) : n), 0) + 1);
  return (
    <section className="ws-sec" data-tour="store-room">
      <h3><span className="ws-sec-ico"><Boxes size={18} /></span>{t("Store room")}</h3>
      <small className="ws-hint">{t("Four walls, as you stand in the middle. Rename the walls, racks and levels, and drag a rack to where it really is. Shelves are named like 1-A.")}</small>
      <ModulesBox />
      {loaded && racks.length === 0 && <button type="button" className="button secondary small" disabled={busy} onClick={() => void quick()}>{t("Quick start: racks 1 to 12, levels A B C")}</button>}
      {loose > 0 && <p className="ws-hint">{t("Parts not on a shelf yet")}: <b>{loose}</b></p>}
      {groups.map(({ area, racks: rs }) => (
        (area || rs.length > 0) && (
          <div className="ws-area" key={area ? key(area) : "none"} onDragOver={(e) => drag && e.preventDefault()} onDrop={(e) => { e.preventDefault(); dropWall(area); }}>
            {area ? (
              <div className="ws-list-row">
                <span className="ws-wallpos" title={t(WALL_TEXT[area.pos || ""] || "")}>{{ W: "←", E: "→", N: "↑", S: "↓" }[area.pos || ""]}</span>
                <input aria-label={t(WALL_TEXT[area.pos || ""] || "Wall name")} placeholder={t(WALL_TEXT[area.pos || ""] || "Wall name")} value={area.name} maxLength={40}
                  onChange={(e) => { const nm = e.target.value; edit(setAreas, (x) => x.map((v) => (v === area ? { ...v, name: nm } : v))); }} />
                <small className="ws-hint">{t(WALL_TEXT[area.pos || ""] || "")}</small>
              </div>
            ) : <div className="ws-hint">{t("Racks with no wall")}</div>}
            {rs.map(({ r, i }) => (
              <div className={"ws-rack" + (drag?.rack === i && drag.level === undefined ? " dragging" : "")} key={r.id || "n" + i} onDragOver={(e) => drag && drag.level === undefined && e.preventDefault()} onDrop={(e) => { e.preventDefault(); e.stopPropagation(); dropRack(i); }}>
                <div className="ws-list-row">
                  <span className="ws-grip" draggable aria-hidden="true" title={t("Drag to move")} onDragStart={() => setDrag({ rack: i })} onDragEnd={() => setDrag(null)}>⋮⋮</span>
                  <input aria-label={t("Rack name")} placeholder={t("Rack 1")} value={r.name} maxLength={40} onChange={(e) => setRack(i, { ...r, name: e.target.value })} />
                  <select aria-label={t("Type")} value={r.type} onChange={(e) => setRack(i, { ...r, type: e.target.value as Rk["type"] })}>{(Object.keys(TYPE) as Rk["type"][]).map((k) => <option key={k} value={k}>{t(TYPE[k])}</option>)}</select>
                  <select aria-label={t("Wall")} value={r.area} onChange={(e) => setRack(i, { ...r, area: e.target.value })}><option value="">{t("No wall")}</option>{areas.map((a) => <option key={key(a)} value={key(a)}>{a.name || t(WALL_TEXT[a.pos || ""] || "Wall")}</option>)}</select>
                  <button type="button" className="ws-l-del" aria-label={t("Move up")} onClick={() => swapRack(i, -1)}>↑</button>
                  <button type="button" className="ws-l-del" aria-label={t("Move down")} onClick={() => swapRack(i, 1)}>↓</button>
                  <button type="button" className="ws-l-del" aria-label={t("Remove")} disabled={used(r) > 0} title={used(r) ? t("Move parts first") : ""} onClick={() => edit(setRacks, (x) => x.filter((_, k) => k !== i))}>×</button>
                </div>
                <div className="ws-levels">
                  {r.levels.map((l, j) => (
                    <span className="ws-level" key={l.id || "n" + j} onDragOver={(e) => drag && drag.level !== undefined && drag.rack === i && e.preventDefault()} onDrop={(e) => { e.preventDefault(); e.stopPropagation(); dropLevel(i, j); }}>
                      <span className="ws-grip" draggable aria-hidden="true" title={t("Drag to move")} onDragStart={() => setDrag({ rack: i, level: j })} onDragEnd={() => setDrag(null)}>⋮⋮</span>
                      <input aria-label={t("Level")} value={l.name} maxLength={12} onChange={(e) => setRack(i, { ...r, levels: r.levels.map((v, k) => (k === j ? { ...v, name: e.target.value } : v)) })} />
                      {used(r, l) > 0 && <small className="ws-count" title={t("Parts on this level")}>{used(r, l)}</small>}
                      <ShelfPhoto id={l.photo_id} onId={(pid) => setRack(i, { ...r, levels: r.levels.map((v, k) => (k === j ? { ...v, photo_id: pid } : v)) })} />
                      <button type="button" className="ws-l-del" aria-label={t("Move up")} onClick={() => setRack(i, { ...r, levels: move(r.levels, j, -1) })}>↑</button>
                      <button type="button" className="ws-l-del" aria-label={t("Move down")} onClick={() => setRack(i, { ...r, levels: move(r.levels, j, 1) })}>↓</button>
                      <button type="button" className="ws-l-del" aria-label={t("Remove")} disabled={used(r, l) > 0} title={used(r, l) ? t("Move parts first") : ""} onClick={() => setRack(i, { ...r, levels: r.levels.filter((_, k) => k !== j) })}>×</button>
                    </span>
                  ))}
                  {r.levels.length < 20 && <button type="button" className="button secondary small" onClick={() => setRack(i, { ...r, levels: [...r.levels, { name: String.fromCharCode(65 + Math.min(r.levels.length, 25)) }] })}>{t("+ Level")}</button>}
                </div>
              </div>
            ))}
            {area && racks.length < 100 && (adding === key(area) ? (
              <div className="ws-addbox">
                <label>{t("Racks")}<input type="number" inputMode="numeric" min={1} max={30} value={addN} onChange={(e) => setAddN(e.target.value)} /></label>
                <label>{t("Levels each")}<input type="number" inputMode="numeric" min={1} max={12} value={addL} onChange={(e) => setAddL(e.target.value)} /></label>
                <small className="ws-hint">{t("Shelves are named like 1-A, 1-B, 2-A. You can rename them after.")}</small>
                <span className="ws-bar">
                  <button type="button" className="button primary small" onClick={() => addRacks(area)}>{t("Add")}</button>
                  <button type="button" className="button secondary small" onClick={() => setAdding("")}>{t("Cancel")}</button>
                </span>
              </div>
            ) : <button type="button" className="ws-addrack" aria-label={t("Add racks to this wall")} onClick={() => { setAdding(key(area)); setAddN("1"); setAddL("3"); }}><span aria-hidden="true">+</span> {t("Add racks")}</button>)}
          </div>
        )
      ))}
      {error && <p role="alert" className="ws-err">{error}</p>}
      <button type="button" className="button small" disabled={busy || !loaded || !dirty} onClick={() => void save()}>{busy ? t("Saving…") : t("Save store room")}</button>
      {dirty && <small className="ws-hint">{t("Not saved yet")}</small>}
    </section>
  );
}

/** Owner: switch the store room map and the parts counter on or off for this shop. */
export function ModulesBox() {
  const [s, setS] = useState<Record<string, unknown> | null>(null), [busy, setBusy] = useState(false), [start, setStart] = useState(getCounterStart());
  useEffect(() => { void api<Record<string, unknown>>("/api/workshop/settings").then(setS).catch(() => undefined); }, []);
  if (!s) return null;
  const flip = async (k: "store_room_on" | "counter_on", on: boolean) => {
    setBusy(true);
    try { const next = { ...s, [k]: on }; await api("/api/workshop/settings", { method: "PUT", body: JSON.stringify(next) }, crypto.randomUUID()); setS(next); setModules(next); toast(t("Saved")); }
    catch (e) { toast((e as Error).message, { bad: true }); } finally { setBusy(false); }
  };
  return (
    <div className="ws-modules">
      <label className="stock-check"><input type="checkbox" disabled={busy} checked={s.counter_on !== false} onChange={(e) => void flip("counter_on", e.target.checked)} /> {t("Use the parts counter")}</label>
      <label className="stock-check"><input type="checkbox" disabled={busy} checked={s.store_room_on !== false} onChange={(e) => void flip("store_room_on", e.target.checked)} /> {t("Use the store room map")}</label>
      <label className="ws-field">{t("When the parts counter opens on this device")}
        <select value={counterStartIsAuto() ? "auto" : start} onChange={(e) => { setCounterStart(e.target.value as "auto" | "camera" | "search"); setStart(getCounterStart()); toast(t("Saved")); }}>
          <option value="auto">{t("Automatic: camera on a phone, search on a computer")}</option>
          <option value="camera">{t("Camera first")}</option>
          <option value="search">{t("Search box first")}</option>
        </select>
      </label>
    </div>
  );
}

function ShelfPhoto({ id, onId }: { id?: string; onId: (id: string) => void }) {
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const send = async (file?: File) => {
    if (!file) return;
    setBusy(true);
    try { onId(await uploadPhoto(file)); } catch (e) { toast((e as Error).message, { bad: true }); } finally { setBusy(false); if (input.current) input.current.value = ""; }
  };
  return (
    <>
      {id && <button type="button" className="ws-shelf-ph" aria-label={t("Remove photo")} title={t("Remove photo")} onClick={() => onId("")}><Photo id={id} /></button>}
      <button type="button" className="ws-l-del" aria-label={t("Shelf photo")} disabled={busy} onClick={() => input.current?.click()}><Camera size={14} /></button>
      <input ref={input} type="file" accept="image/*" capture="environment" hidden onChange={(e) => void send(e.target.files?.[0])} />
    </>
  );
}
