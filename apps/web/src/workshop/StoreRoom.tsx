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
type Rk = { id?: string; photo_id?: string; row?: number; col?: number; name: string; area: string; type: "RACK" | "CUPBOARD" | "FLOOR"; levels: Lv[] };
type Mk = { id?: string; kind: "IN" | "OUT" | "STAGING"; row: number; col: number };
type Ar = { id?: string; name: string; pos?: string };
type Layout = { marks?: Mk[]; areas: { id: string; name: string; pos?: string }[]; racks: { id: string; photo_id?: string; row?: number; col?: number; name: string; area_id: string | null; type: Rk["type"]; levels: Lv[] }[]; counts: Record<string, Record<string, number>>; not_shelved: number; revision: number };
const MARK_TEXT: Record<Mk["kind"], string> = { IN: "IN", OUT: "OUT", STAGING: "Staging" };
const TYPE: Record<Rk["type"], string> = { RACK: "Rack", CUPBOARD: "Cupboard", FLOOR: "Floor" };
const move = <T,>(list: T[], i: number, d: number) => { const j = i + d; if (j < 0 || j >= list.length) return list; const c = [...list]; [c[i], c[j]] = [c[j], c[i]]; return c; };

/** Owner: the store room as it is in real life: walls (areas), the racks along each, and the levels of each rack. Ids never change, so a
 *  rename keeps the label and the shelf the same shelf. A shelf with parts on it cannot be removed. */
export function StoreRoomSection() {
  const [areas, setAreas] = useState<Ar[]>([]), [racks, setRacks] = useState<Rk[]>([]), [counts, setCounts] = useState<Layout["counts"]>({}), [loose, setLoose] = useState(0);
  const [marks, setMarks] = useState<Mk[]>([]), [grid, setGrid] = useState({ rows: 4, cols: 6 }), [put, setPut] = useState<Mk["kind"] | null>(null), [selMark, setSelMark] = useState<number | null>(null);
  const [revision, setRevision] = useState(0), [busy, setBusy] = useState(false), [error, setError] = useState(""), [loaded, setLoaded] = useState(false), [dirty, setDirty] = useState(false);
  const adopt = (l: Layout) => {
    setAreas(l.areas.map((a) => ({ id: a.id, name: a.name, pos: a.pos }))); setCounts(l.counts); setLoose(l.not_shelved); setRevision(l.revision); setDirty(false);
    setMarks(l.marks || []); setGrid({ rows: Math.max(4, ...l.racks.map((r) => (r.row ?? -1) + 2), ...(l.marks || []).map((m) => m.row + 2)), cols: Math.max(6, ...l.racks.map((r) => (r.col ?? -1) + 2), ...(l.marks || []).map((m) => m.col + 2)) });
    setRacks(l.racks.map((r) => ({ id: r.id, photo_id: r.photo_id, row: r.row, col: r.col, name: r.name, area: r.area_id || "", type: r.type, levels: r.levels.map((x) => ({ ...x })) })));
  };
  const load = () => api<Layout>("/api/inventory/stores/layout").then((l) => { adopt(l); setLoaded(true); }).catch((e) => setError((e as Error).message));
  useEffect(() => { void load(); }, []);
  const edit = <T,>(set: (f: (x: T[]) => T[]) => void, f: (x: T[]) => T[]) => { set(f); setDirty(true); };
  const used = (r: Rk, l?: Lv) => (r.id ? (l ? counts[r.id]?.[l.id || ""] || 0 : Object.values(counts[r.id] || {}).reduce((a, b) => a + b, 0)) : 0);
  const save = async () => {
    setBusy(true); setError("");
    try {
      const body = { revision, marks: marks.map((m) => ({ ...(m.id ? { id: m.id } : {}), kind: m.kind, row: m.row, col: m.col })), areas: areas.map((a) => ({ ...(a.id ? { id: a.id } : {}), ...(a.pos ? { pos: a.pos } : {}), name: a.name.trim() })).filter((a) => a.name),
        racks: racks.filter((r) => r.name.trim()).map((r) => ({ ...(r.id ? { id: r.id } : {}), name: r.name.trim(), type: r.type, photo_id: r.photo_id || "", row: r.row ?? null, col: r.col ?? null, area_id: r.area ? (areas.find((a) => (a.id || a.name) === r.area)?.id || areas.find((a) => a.name === r.area)?.name || null) : null,
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
  const setRack = (i: number, r: Rk) => edit(setRacks, (x) => x.map((v, k) => (k === i ? r : v)));
  const swapRack = (i: number, d: number) => edit(setRacks, (x) => { // move within the same wall only
    const here = x[i].area; let j = i + d; while (j >= 0 && j < x.length && x[j].area !== here) j += d;
    if (j < 0 || j >= x.length) return x; const c = [...x]; [c[i], c[j]] = [c[j], c[i]]; return c; });
  const [sel, setSel] = useState<number | null>(null);
  const nextNumber = () => String(racks.reduce((n, r) => (/^\d+$/.test(r.name.trim()) ? Math.max(n, Number(r.name.trim())) : n), 0) + 1);
  const taken = () => new Set([...racks.filter((r) => r.row !== undefined).map((r) => r.row + "," + r.col), ...marks.map((m) => m.row + "," + m.col)]);
  /** The first empty square, reading left to right, top to bottom; a new row is added when the plan is full. */
  const freeSquare = () => {
    const used = taken();
    for (let r = 0; r < grid.rows; r++) for (let c = 0; c < grid.cols; c++) if (!used.has(r + "," + c)) return { row: r, col: c };
    if (grid.rows < 40) setGrid({ ...grid, rows: grid.rows + 1 });
    return { row: grid.rows, col: 0 };
  };
  const tapSquare = (r: number, c: number) => {
    const rk = racks.findIndex((x) => x.row === r && x.col === c), mk = marks.findIndex((m) => m.row === r && m.col === c);
    if (rk >= 0) { setSel(rk); setSelMark(null); setPut(null); return; }
    if (mk >= 0) { setSelMark(mk); setSel(null); setPut(null); return; }
    if (put) { edit(setMarks, (x) => (x.length >= 30 ? x : [...x, { kind: put, row: r, col: c }])); setPut(null); return; }
    if (selMark !== null) { edit(setMarks, (x) => x.map((m, k) => (k === selMark ? { ...m, row: r, col: c } : m))); return; }
    if (sel !== null) setRack(sel, { ...racks[sel], row: r, col: c });
  };
  const unplace = () => {
    if (selMark !== null) { edit(setMarks, (x) => x.filter((_, k) => k !== selMark)); setSelMark(null); }
    else if (sel !== null) edit(setRacks, (x) => x.map((v, k) => { if (k !== sel) return v; const { row: _r, col: _c, ...rest } = v; void _r; void _c; return rest; }));
  };
  const arrange = () => { // every rack without a square goes to the next empty one, wall by wall
    const used = taken(); const order = ["N", "W", "E", "S"].flatMap((p) => areas.filter((a) => a.pos === p));
    const rank = (r: Rk) => { const k = order.findIndex((a) => key(a) === r.area); return k < 0 ? 99 : k; };
    const todo = racks.map((r, i) => ({ r, i })).filter(({ r }) => r.row === undefined).sort((a, b) => rank(a.r) - rank(b.r) || a.i - b.i);
    let rows = grid.rows; const put2: Record<number, { row: number; col: number }> = {}; let r0 = 0, c0 = 0;
    for (const { i } of todo) {
      while (used.has(r0 + "," + c0)) { c0++; if (c0 >= grid.cols) { c0 = 0; r0++; } }
      put2[i] = { row: r0, col: c0 }; used.add(r0 + "," + c0); rows = Math.max(rows, r0 + 2);
    }
    if (todo.length) { edit(setRacks, (x) => x.map((v, k) => (put2[k] ? { ...v, ...put2[k] } : v))); setGrid({ ...grid, rows: Math.min(40, rows) }); }
  };
  const addRack = (wall: Ar) => {
    if (racks.length >= 100) return;
    const at = freeSquare();
    edit(setRacks, (x) => [...x, { name: nextNumber(), area: key(wall), type: "RACK" as const, row: at.row, col: at.col, levels: ["A", "B", "C"].map((name) => ({ name })) }]);
    setSel(racks.length); setSelMark(null);
  };
  const removeRack = (i: number) => { edit(setRacks, (x) => x.filter((_, k) => k !== i)); setSel(null); };
  const wall = (pos: string) => areas.find((a) => a.pos === pos);
  const Wall = ({ pos }: { pos: "N" | "W" | "E" | "S" }) => {
    const a = wall(pos);
    if (!a) return <div className={"sr-wall sr-" + pos} />;
    return (
      <div className={"sr-wall sr-" + pos}>
        <input className="sr-wallname" aria-label={t(WALL_TEXT[pos])} title={t(WALL_TEXT[pos])} value={a.name} maxLength={40} onChange={(e) => { const nm = e.target.value; edit(setAreas, (x) => x.map((v) => (v === a ? { ...v, name: nm } : v))); }} />
        <div className="sr-boxes">
          {racks.map((r, i) => (r.area === key(a) ? <button key={r.id || "n" + i} type="button" className={"sr-box" + (sel === i ? " on" : "")} aria-pressed={sel === i} onClick={() => setSel(sel === i ? null : i)}>{r.name || "?"}</button> : null))}
          {racks.length < 100 && <button type="button" className="sr-box sr-plus" aria-label={t("Add a rack to this wall")} onClick={() => addRack(a)}>+</button>}
        </div>
      </div>
    );
  };
  const loneRacks = racks.map((r, i) => ({ r, i })).filter(({ r }) => !r.area || !areas.some((a) => key(a) === r.area));
  const cur = sel !== null ? racks[sel] : undefined;
  return (
    <section className="ws-sec" data-tour="store-room">
      <h3><span className="ws-sec-ico"><Boxes size={18} /></span>{t("Store room")}</h3>
      <small className="ws-hint">{t("Draw the room as you stand in the middle. Tap + on a wall to add a rack. Tap a rack to set its columns (1-A, 1-B).")}</small>
      <ModulesBox />
      {loaded && racks.length === 0 && <button type="button" className="button secondary small" disabled={busy} onClick={() => void quick()}>{t("Quick start: racks 1 to 12, levels A B C")}</button>}
      {loose > 0 && <p className="ws-hint">{t("Parts not on a shelf yet")}: <b>{loose}</b></p>}
      <div className="sr-room" role="group" aria-label={t("Store room map")}>
        <Wall pos="N" /><Wall pos="W" />
        <div className="sr-floor"><span>{t("Floor / parts counter")}</span></div>
        <Wall pos="E" /><Wall pos="S" />
      </div>
      {loneRacks.length > 0 && (
        <div className="sr-wall sr-lone"><b className="sr-wallname">{t("Racks with no wall")}</b>
          <div className="sr-boxes">{loneRacks.map(({ r, i }) => <button key={r.id || "n" + i} type="button" className={"sr-box" + (sel === i ? " on" : "")} aria-pressed={sel === i} onClick={() => setSel(sel === i ? null : i)}>{r.name || "?"}</button>)}</div></div>
      )}
      <div className="fp-ed" role="group" aria-label={t("Floor plan")}>
        <div className="fp-bar">
          <b>{t("Floor plan")}</b>
          <button type="button" className={"button secondary small" + (put === "IN" ? " on" : "")} onClick={() => { setPut(put === "IN" ? null : "IN"); setSel(null); setSelMark(null); }}>+ {t("IN")}</button>
          <button type="button" className={"button secondary small" + (put === "OUT" ? " on" : "")} onClick={() => { setPut(put === "OUT" ? null : "OUT"); setSel(null); setSelMark(null); }}>+ {t("OUT")}</button>
          <button type="button" className={"button secondary small" + (put === "STAGING" ? " on" : "")} onClick={() => { setPut(put === "STAGING" ? null : "STAGING"); setSel(null); setSelMark(null); }}>+ {t("Staging")}</button>
          <button type="button" className="button secondary small" disabled={grid.rows >= 40} onClick={() => setGrid({ ...grid, rows: grid.rows + 1 })}>+ {t("Row")}</button>
          <button type="button" className="button secondary small" disabled={grid.cols >= 12} onClick={() => setGrid({ ...grid, cols: grid.cols + 1 })}>+ {t("Column")}</button>
          {racks.some((r) => r.row === undefined) && <button type="button" className="button secondary small" onClick={arrange}>{t("Place all racks")}</button>}
          {((sel !== null && racks[sel]?.row !== undefined) || selMark !== null) && <button type="button" className="button secondary small" onClick={unplace}>{selMark !== null ? t("Remove") : t("Take off the plan")}</button>}
        </div>
        <small className="ws-hint">{put ? t("Tap an empty square to put it there.") : selMark !== null || sel !== null ? t("Tap an empty square to move the selected one there.") : t("Tap a rack, then an empty square, to place it. Empty squares are aisles.")}</small>
        <div className="fp-scroll"><div className="fp-grid" style={{ gridTemplateColumns: "repeat(" + grid.cols + ", minmax(58px, 1fr))" }}>
          {Array.from({ length: grid.rows * grid.cols }, (_, n) => {
            const r = Math.floor(n / grid.cols), c = n % grid.cols;
            const ri = racks.findIndex((x) => x.row === r && x.col === c), mi = marks.findIndex((m) => m.row === r && m.col === c);
            if (ri >= 0) { const zi = areas.findIndex((a) => key(a) === racks[ri].area); return <button key={n} type="button" className={"fp-cell rack z" + (zi < 0 ? "x" : zi) + (sel === ri ? " on" : "")} aria-pressed={sel === ri} onClick={() => tapSquare(r, c)}>{racks[ri].name || "?"}</button>; }
            if (mi >= 0) return <button key={n} type="button" className={"fp-cell mark" + (selMark === mi ? " on" : "")} aria-pressed={selMark === mi} onClick={() => tapSquare(r, c)}>{t(MARK_TEXT[marks[mi].kind])}</button>;
            return <button key={n} type="button" className={"fp-cell empty" + (put || sel !== null || selMark !== null ? " target" : "")} aria-label={t("Empty square")} onClick={() => tapSquare(r, c)} />;
          })}
        </div></div>
        {racks.some((r) => r.row === undefined) && <p className="fp-unplaced">{t("Not on the plan yet")}: {racks.map((r, i) => (r.row === undefined ? <button key={r.id || "n" + i} type="button" className={"sr-box" + (sel === i ? " on" : "")} onClick={() => { setSel(sel === i ? null : i); setSelMark(null); setPut(null); }}>{r.name || "?"}</button> : null))}</p>}
      </div>
      {cur && sel !== null && (
        <div className="sr-panel">
          <div className="sr-panel-head">
            <b>{t("Rack")}</b>
            <input aria-label={t("Rack name")} className="sr-name" value={cur.name} maxLength={40} onChange={(e) => setRack(sel, { ...cur, name: e.target.value })} />
            <select aria-label={t("Type")} value={cur.type} onChange={(e) => setRack(sel, { ...cur, type: e.target.value as Rk["type"] })}>{(Object.keys(TYPE) as Rk["type"][]).map((k) => <option key={k} value={k}>{t(TYPE[k])}</option>)}</select>
            <select aria-label={t("Wall")} value={cur.area} onChange={(e) => setRack(sel, { ...cur, area: e.target.value })}><option value="">{t("No wall")}</option>{areas.map((a) => <option key={key(a)} value={key(a)}>{a.name || t(WALL_TEXT[a.pos || ""] || "Wall")}</option>)}</select>
            <ShelfPhoto label={t("Rack photo")} id={cur.photo_id} onId={(pid) => setRack(sel, { ...cur, photo_id: pid })} />
            <button type="button" className="ws-l-del" aria-label={t("Move up")} title={t("Earlier on the wall")} onClick={() => swapRack(sel, -1)}>←</button>
            <button type="button" className="ws-l-del" aria-label={t("Move down")} title={t("Later on the wall")} onClick={() => swapRack(sel, 1)}>→</button>
            <button type="button" className="ws-l-del" aria-label={t("Remove")} disabled={used(cur) > 0} title={used(cur) ? t("Transfer parts first") : t("Remove this rack")} onClick={() => removeRack(sel)}>×</button>
          </div>
          <div className="sr-cols"><span>{t("Columns")}:</span>
            {cur.levels.map((l, j) => (
              <span className="sr-col" key={l.id || "n" + j}>
                <input aria-label={t("Level")} value={l.name} maxLength={12} onChange={(e) => setRack(sel, { ...cur, levels: cur.levels.map((v, k) => (k === j ? { ...v, name: e.target.value } : v)) })} />
                {used(cur, l) > 0 && <small className="ws-count" title={t("Parts on this level")}>{used(cur, l)}</small>}
                <ShelfPhoto id={l.photo_id} onId={(pid) => setRack(sel, { ...cur, levels: cur.levels.map((v, k) => (k === j ? { ...v, photo_id: pid } : v)) })} />
                <button type="button" className="ws-l-del" aria-label={t("Move up")} onClick={() => setRack(sel, { ...cur, levels: move(cur.levels, j, -1) })}>‹</button>
                <button type="button" className="ws-l-del" aria-label={t("Move down")} onClick={() => setRack(sel, { ...cur, levels: move(cur.levels, j, 1) })}>›</button>
                <button type="button" className="ws-l-del" aria-label={t("Remove")} disabled={used(cur, l) > 0} title={used(cur, l) ? t("Transfer parts first") : ""} onClick={() => setRack(sel, { ...cur, levels: cur.levels.filter((_, k) => k !== j) })}>×</button>
              </span>
            ))}
            {cur.levels.length < 20 && <button type="button" className="sr-col sr-addcol" onClick={() => setRack(sel, { ...cur, levels: [...cur.levels, { name: String.fromCharCode(65 + Math.min(cur.levels.length, 25)) }] })}>+ {t("column")}</button>}
          </div>
          <small className="ws-hint">{t("Labels made")}: {cur.levels.length ? cur.levels.map((l) => (cur.name || "?") + "-" + (l.name || "?")).join(", ") : cur.name}</small>
        </div>
      )}
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
  const flip = async (k: "store_room_on" | "counter_on" | "store_room_phone" | "counter_web", on: boolean) => {
    setBusy(true);
    try { const latest = await api<Record<string, unknown>>("/api/workshop/settings"); const next = { ...latest, [k]: on }; await api("/api/workshop/settings", { method: "PUT", body: JSON.stringify(next) }, crypto.randomUUID()); setS(next); setModules(next); toast(t("Saved")); }
    catch (e) { toast((e as Error).message, { bad: true }); } finally { setBusy(false); }
  };
  return (
    <div className="ws-modules">
      <label className="stock-check"><input type="checkbox" disabled={busy} checked={s.counter_on !== false} onChange={(e) => void flip("counter_on", e.target.checked)} /> {t("Use the parts counter")}</label>
      {s.counter_on !== false && <label className="stock-check ws-sub"><input type="checkbox" disabled={busy} checked={s.counter_web === true} onChange={(e) => void flip("counter_web", e.target.checked)} /> {t("Also show the parts counter on the computer")} <small>({t("phones always have it")})</small></label>}
      <label className="stock-check"><input type="checkbox" disabled={busy} checked={s.store_room_on !== false} onChange={(e) => void flip("store_room_on", e.target.checked)} /> {t("Use the store room map")}</label>
      {s.store_room_on !== false && <label className="stock-check ws-sub"><input type="checkbox" disabled={busy} checked={s.store_room_phone === true} onChange={(e) => void flip("store_room_phone", e.target.checked)} /> {t("Also show the store room on phones")} <small>({t("computers always have it")})</small></label>}
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

function ShelfPhoto({ id, onId, label }: { id?: string; onId: (id: string) => void; label?: string }) {
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
      <button type="button" className="ws-l-del" aria-label={label || t("Shelf photo")} title={label || t("Shelf photo")} disabled={busy} onClick={() => input.current?.click()}><Camera size={14} /></button>
      <input ref={input} type="file" accept="image/*" capture="environment" hidden onChange={(e) => void send(e.target.files?.[0])} />
    </>
  );
}
