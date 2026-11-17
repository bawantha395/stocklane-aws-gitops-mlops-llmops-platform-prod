import { useEffect, useState } from "react";
import { MapPin } from "lucide-react";
import { t } from "../i18n";
import { toast } from "../ui";
import { api } from "../api";

// `was` is the name the server knows; when it differs from what is typed now, saving renames it (the parts follow)
type Level = { name: string; was: string };
type Rack = { name: string; was: string; levels: Level[] };
type Cat = { name: string; was: string };
type Stores = { racks: { name: string; levels: string[] }[]; categories: string[] };
const post = <T,>(path: string, body: unknown) => api<T>(path, { method: "POST", body: JSON.stringify(body) }, crypto.randomUUID());

/** Owner: the shop's racks (with levels) and part categories. Item forms pick from these. */
export function StoresSection() {
  const [racks, setRacks] = useState<Rack[]>([]), [cats, setCats] = useState<Cat[]>([]);
  const [busy, setBusy] = useState(false), [error, setError] = useState(""), [loaded, setLoaded] = useState(false);
  const adopt = (s: Stores) => {
    setRacks(s.racks.map((r) => ({ name: r.name, was: r.name, levels: r.levels.map((l) => ({ name: l, was: l })) })));
    setCats(s.categories.map((c) => ({ name: c, was: c })));
  };
  useEffect(() => { api<Stores>("/api/inventory/stores").then((s) => { adopt(s); setLoaded(true); }).catch((e) => setError((e as Error).message)); }, []);
  const setRack = (i: number, r: Rack) => setRacks((x) => x.map((v, k) => (k === i ? r : v)));
  const save = async () => {
    setBusy(true); setError("");
    try {
      // renames first, one at a time, so every part moves to the new name before the list is saved
      let moved = 0;
      for (const r of racks) {
        const name = r.name.trim();
        if (r.was && name && name !== r.was) moved += (await post<{ moved: number }>("/api/inventory/stores/rename", { kind: "rack", from: r.was, to: name })).moved;
        for (const l of r.levels) {
          const level = l.name.trim();
          if (r.was && l.was && level && level !== l.was) moved += (await post<{ moved: number }>("/api/inventory/stores/rename", { kind: "level", rack: name || r.was, from: l.was, to: level })).moved;
        }
      }
      for (const c of cats) {
        const name = c.name.trim();
        if (c.was && name && name !== c.was) moved += (await post<{ moved: number }>("/api/inventory/stores/rename", { kind: "category", from: c.was, to: name })).moved;
      }
      const clean = racks.map((r) => ({ name: r.name.trim(), levels: r.levels.map((l) => l.name.trim()).filter(Boolean) })).filter((r) => r.name);
      adopt(await api<Stores>("/api/inventory/stores", { method: "PUT", body: JSON.stringify({ racks: clean, categories: cats.map((c) => c.name.trim()).filter(Boolean) }) }, crypto.randomUUID()));
      toast(moved ? t("Saved. {n} parts moved to the new names.", { n: moved }) : t("Shelves and categories saved"));
    } catch (e) {
      setError((e as Error).message); toast((e as Error).message, { bad: true });
      api<Stores>("/api/inventory/stores").then(adopt).catch(() => { /* keep what is on screen */ });  // show what was really saved
    } finally { setBusy(false); }
  };
  const standard = async () => {
    setBusy(true); setError("");
    try { adopt(await post<Stores>("/api/inventory/stores/standard", {})); toast(t("Standard categories added")); }
    catch (e) { setError((e as Error).message); toast((e as Error).message, { bad: true }); } finally { setBusy(false); }
  };
  return (
    <section className="ws-sec" data-tour="stores">
      <h3><span className="ws-sec-ico"><MapPin size={18} /></span>{t("Shelves and categories")}</h3>
      <label className="ws-field">{t("Racks")}</label>
      {racks.map((r, i) => (
        <div className="ws-rack" key={i}>
          <div className="ws-list-row">
            <input aria-label={t("Rack name")} placeholder={t("Rack 1")} value={r.name} maxLength={40} onChange={(e) => setRack(i, { ...r, name: e.target.value })} />
            <button type="button" className="ws-l-del" aria-label={t("Remove")} onClick={() => setRacks((x) => x.filter((_, k) => k !== i))}>×</button>
          </div>
          <div className="ws-levels">
            {r.levels.map((l, j) => (
              <span className="ws-level" key={j}>
                <input aria-label={t("Level")} value={l.name} maxLength={12} onChange={(e) => setRack(i, { ...r, levels: r.levels.map((v, k) => (k === j ? { ...v, name: e.target.value } : v)) })} />
                <button type="button" className="ws-l-del" aria-label={t("Remove")} onClick={() => setRack(i, { ...r, levels: r.levels.filter((_, k) => k !== j) })}>×</button>
              </span>
            ))}
            {r.levels.length < 20 && <button type="button" className="button secondary small" onClick={() => setRack(i, { ...r, levels: [...r.levels, { name: String.fromCharCode(65 + Math.min(r.levels.length, 25)), was: "" }] })}>{t("+ Level")}</button>}
          </div>
        </div>
      ))}
      {racks.length < 100 && <button type="button" className="button secondary small" onClick={() => setRacks((x) => [...x, { name: "Rack " + (x.length + 1), was: "", levels: ["A", "B", "C"].map((n) => ({ name: n, was: "" })) }])}>{t("+ Add rack")}</button>}
      <small className="ws-hint">{t("A part's shelf is written like Rack 1-A. A rack with no levels is one shelf. Mechanics pick from this list when they register a part.")}</small>
      <label className="ws-field">{t("Categories")}</label>
      {cats.map((c, i) => (
        <div className="ws-list-row" key={i}>
          <input aria-label={t("Category")} placeholder={t("Category name")} value={c.name} maxLength={80} onChange={(e) => setCats((x) => x.map((v, k) => (k === i ? { ...v, name: e.target.value } : v)))} />
          <button type="button" className="ws-l-del" aria-label={t("Remove")} onClick={() => setCats((x) => x.filter((_, k) => k !== i))}>×</button>
        </div>
      ))}
      {cats.length < 150 && <button type="button" className="button secondary small" onClick={() => setCats((x) => [...x, { name: "", was: "" }])}>{t("+ Add category")}</button>}{" "}
      <button type="button" className="button secondary small" disabled={busy || !loaded} onClick={() => void standard()}>{t("Add the standard list")}</button>
      <small className="ws-hint">{t("Renaming moves the parts to the new name. A shelf or category that parts still use cannot be removed. Move those parts first.")}</small>
      {error && <p role="alert" className="ws-err">{error}</p>}
      <button type="button" className="button small" disabled={busy || !loaded} onClick={() => void save()}>{busy ? t("Saving…") : t("Save shelves and categories")}</button>
    </section>
  );
}
