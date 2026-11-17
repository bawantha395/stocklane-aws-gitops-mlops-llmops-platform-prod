import { useEffect, useRef, useState } from "react";
import { Boxes, Camera } from "lucide-react";
import { t } from "../i18n";
import { toast } from "../ui";
import { api } from "../api";
import { uploadPhoto } from "../photo";
import { Photo } from "./Photos";

type Lv = { id?: string; name: string; photo_id?: string };
type Rk = { id?: string; name: string; area: string; type: "RACK" | "CUPBOARD" | "FLOOR"; levels: Lv[] };
type Ar = { id?: string; name: string };
type Layout = { areas: { id: string; name: string }[]; racks: { id: string; name: string; area_id: string | null; type: Rk["type"]; levels: Lv[] }[]; counts: Record<string, Record<string, number>>; not_shelved: number; revision: number };
const TYPE: Record<Rk["type"], string> = { RACK: "Rack", CUPBOARD: "Cupboard", FLOOR: "Floor" };
const move = <T,>(list: T[], i: number, d: number) => { const j = i + d; if (j < 0 || j >= list.length) return list; const c = [...list]; [c[i], c[j]] = [c[j], c[i]]; return c; };

/** Owner: the store room as it is in real life: walls (areas), the racks along each, and the levels of each rack. Ids never change, so a
 *  rename keeps the label and the shelf the same shelf. A shelf with parts on it cannot be removed. */
export function StoreRoomSection() {
  const [areas, setAreas] = useState<Ar[]>([]), [racks, setRacks] = useState<Rk[]>([]), [counts, setCounts] = useState<Layout["counts"]>({}), [loose, setLoose] = useState(0);
  const [revision, setRevision] = useState(0), [busy, setBusy] = useState(false), [error, setError] = useState(""), [loaded, setLoaded] = useState(false), [dirty, setDirty] = useState(false);
  const adopt = (l: Layout) => {
    setAreas(l.areas.map((a) => ({ id: a.id, name: a.name }))); setCounts(l.counts); setLoose(l.not_shelved); setRevision(l.revision); setDirty(false);
    setRacks(l.racks.map((r) => ({ id: r.id, name: r.name, area: r.area_id || "", type: r.type, levels: r.levels.map((x) => ({ ...x })) })));
  };
  const load = () => api<Layout>("/api/inventory/stores/layout").then((l) => { adopt(l); setLoaded(true); }).catch((e) => setError((e as Error).message));
  useEffect(() => { void load(); }, []);
  const edit = <T,>(set: (f: (x: T[]) => T[]) => void, f: (x: T[]) => T[]) => { set(f); setDirty(true); };
  const used = (r: Rk, l?: Lv) => (r.id ? (l ? counts[r.id]?.[l.id || ""] || 0 : Object.values(counts[r.id] || {}).reduce((a, b) => a + b, 0)) : 0);
  const save = async () => {
    setBusy(true); setError("");
    try {
      const body = { revision, areas: areas.map((a) => ({ ...(a.id ? { id: a.id } : {}), name: a.name.trim() })).filter((a) => a.name),
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
  const groups: { area: Ar | null; racks: { r: Rk; i: number }[] }[] = [...areas.map((a) => ({ area: a as Ar | null, racks: racks.map((r, i) => ({ r, i })).filter(({ r }) => r.area === key(a)) })),
    { area: null, racks: racks.map((r, i) => ({ r, i })).filter(({ r }) => !r.area || !areas.some((a) => key(a) === r.area)) }];
  const setRack = (i: number, r: Rk) => edit(setRacks, (x) => x.map((v, k) => (k === i ? r : v)));
  const swapRack = (i: number, d: number) => edit(setRacks, (x) => { // move within the same area only
    const here = x[i].area; let j = i + d; while (j >= 0 && j < x.length && x[j].area !== here) j += d;
    if (j < 0 || j >= x.length) return x; const c = [...x]; [c[i], c[j]] = [c[j], c[i]]; return c; });
  return (
    <section className="ws-sec" data-tour="store-room">
      <h3><span className="ws-sec-ico"><Boxes size={18} /></span>{t("Store room")}</h3>
      <small className="ws-hint">{t("Make this look like your real store room: walls, the racks along each wall, and the levels of each rack. Parts are shelved like Rack 1-A.")}</small>
      {loaded && racks.length === 0 && areas.length === 0 && <button type="button" className="button secondary small" disabled={busy} onClick={() => void quick()}>{t("Quick start: 4 walls, 3 racks each")}</button>}
      {loose > 0 && <p className="ws-hint">{t("Parts not on a shelf yet")}: <b>{loose}</b></p>}
      {groups.map(({ area, racks: rs }) => (
        (area || rs.length > 0) && (
          <div className="ws-area" key={area ? key(area) : "none"}>
            {area ? (
              <div className="ws-list-row">
                <input aria-label={t("Area name")} placeholder={t("Wall A")} value={area.name} maxLength={40}
                  onChange={(e) => { const old = key(area); const nm = e.target.value; edit(setAreas, (x) => x.map((v) => (v === area ? { ...v, name: nm } : v))); if (!area.id) setRacks((x) => x.map((r) => (r.area === old ? { ...r, area: nm } : r))); }} />
                <button type="button" className="ws-l-del" aria-label={t("Move up")} onClick={() => edit(setAreas, (x) => move(x, x.indexOf(area), -1))}>↑</button>
                <button type="button" className="ws-l-del" aria-label={t("Move down")} onClick={() => edit(setAreas, (x) => move(x, x.indexOf(area), 1))}>↓</button>
                <button type="button" className="ws-l-del" aria-label={t("Remove")} disabled={rs.length > 0} title={rs.length ? t("Remove or move its racks first") : ""} onClick={() => edit(setAreas, (x) => x.filter((v) => v !== area))}>×</button>
              </div>
            ) : <div className="ws-hint">{t("Racks with no area")}</div>}
            {rs.map(({ r, i }) => (
              <div className="ws-rack" key={r.id || "n" + i}>
                <div className="ws-list-row">
                  <input aria-label={t("Rack name")} placeholder={t("Rack 1")} value={r.name} maxLength={40} onChange={(e) => setRack(i, { ...r, name: e.target.value })} />
                  <select aria-label={t("Type")} value={r.type} onChange={(e) => setRack(i, { ...r, type: e.target.value as Rk["type"] })}>{(Object.keys(TYPE) as Rk["type"][]).map((k) => <option key={k} value={k}>{t(TYPE[k])}</option>)}</select>
                  <select aria-label={t("Area")} value={r.area} onChange={(e) => setRack(i, { ...r, area: e.target.value })}><option value="">{t("No area")}</option>{areas.map((a) => <option key={key(a)} value={key(a)}>{a.name || "…"}</option>)}</select>
                  <button type="button" className="ws-l-del" aria-label={t("Move left")} onClick={() => swapRack(i, -1)}>↑</button>
                  <button type="button" className="ws-l-del" aria-label={t("Move right")} onClick={() => swapRack(i, 1)}>↓</button>
                  <button type="button" className="ws-l-del" aria-label={t("Remove")} disabled={used(r) > 0} title={used(r) ? t("Move parts first") : ""} onClick={() => edit(setRacks, (x) => x.filter((_, k) => k !== i))}>×</button>
                </div>
                <div className="ws-levels">
                  {r.levels.map((l, j) => (
                    <span className="ws-level" key={l.id || "n" + j}>
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
            {area && racks.length < 100 && <button type="button" className="button secondary small" onClick={() => edit(setRacks, (x) => [...x, { name: "Rack " + (x.length + 1), area: key(area), type: "RACK" as const, levels: ["A", "B", "C"].map((n) => ({ name: n })) }])}>{t("+ Add rack")}</button>}
          </div>
        )
      ))}
      {areas.length < 8 && <button type="button" className="button secondary small" onClick={() => edit(setAreas, (x) => [...x, { name: "Wall " + String.fromCharCode(65 + Math.min(x.length, 25)) }])}>{t("+ Add area")}</button>}
      {error && <p role="alert" className="ws-err">{error}</p>}
      <button type="button" className="button small" disabled={busy || !loaded || !dirty} onClick={() => void save()}>{busy ? t("Saving…") : t("Save store room")}</button>
      {dirty && <small className="ws-hint">{t("Not saved yet")}</small>}
    </section>
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
