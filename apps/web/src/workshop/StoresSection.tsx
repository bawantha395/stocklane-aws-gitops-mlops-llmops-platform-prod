import { useEffect, useState } from "react";
import { MapPin } from "lucide-react";
import { t } from "../i18n";
import { toast } from "../ui";
import { api } from "../api";

type Rack = { name: string; levels: string[] };

/** Owner: the shop's racks (with levels) and part categories. Item forms pick from these. */
export function StoresSection() {
  const [racks, setRacks] = useState<Rack[]>([]), [cats, setCats] = useState<string[]>([]);
  const [busy, setBusy] = useState(false), [error, setError] = useState(""), [loaded, setLoaded] = useState(false);
  useEffect(() => { api<{ racks: Rack[]; categories: string[] }>("/api/inventory/stores").then((s) => { setRacks(s.racks); setCats(s.categories); setLoaded(true); }).catch((e) => setError((e as Error).message)); }, []);
  const setRack = (i: number, r: Rack) => setRacks((x) => x.map((v, k) => (k === i ? r : v)));
  const save = async () => {
    setBusy(true); setError("");
    try {
      const clean = racks.map((r) => ({ name: r.name.trim(), levels: r.levels.map((l) => l.trim()).filter(Boolean) })).filter((r) => r.name);
      const s = await api<{ racks: Rack[]; categories: string[] }>("/api/inventory/stores", { method: "PUT", body: JSON.stringify({ racks: clean, categories: cats.map((c) => c.trim()).filter(Boolean) }) }, crypto.randomUUID());
      setRacks(s.racks); setCats(s.categories); toast(t("Shelves and categories saved"));
    } catch (e) { setError((e as Error).message); toast((e as Error).message, { bad: true }); } finally { setBusy(false); }
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
                <input aria-label={t("Level")} value={l} maxLength={12} onChange={(e) => setRack(i, { ...r, levels: r.levels.map((v, k) => (k === j ? e.target.value : v)) })} />
                <button type="button" className="ws-l-del" aria-label={t("Remove")} onClick={() => setRack(i, { ...r, levels: r.levels.filter((_, k) => k !== j) })}>×</button>
              </span>
            ))}
            {r.levels.length < 20 && <button type="button" className="button secondary small" onClick={() => setRack(i, { ...r, levels: [...r.levels, String.fromCharCode(65 + Math.min(r.levels.length, 25))] })}>{t("+ Level")}</button>}
          </div>
        </div>
      ))}
      {racks.length < 100 && <button type="button" className="button secondary small" onClick={() => setRacks((x) => [...x, { name: "Rack " + (x.length + 1), levels: ["A", "B", "C"] }])}>{t("+ Add rack")}</button>}
      <small className="ws-hint">{t("A part's shelf is written like Rack 1-A. A rack with no levels is one shelf. Mechanics pick from this list when they register a part.")}</small>
      <label className="ws-field">{t("Categories")}</label>
      {cats.map((c, i) => (
        <div className="ws-list-row" key={i}>
          <input aria-label={t("Category")} value={c} maxLength={80} onChange={(e) => setCats((x) => x.map((v, k) => (k === i ? e.target.value : v)))} />
          <button type="button" className="ws-l-del" aria-label={t("Remove")} onClick={() => setCats((x) => x.filter((_, k) => k !== i))}>×</button>
        </div>
      ))}
      {cats.length < 150 && <button type="button" className="button secondary small" onClick={() => setCats((x) => [...x, ""])}>{t("+ Add category")}</button>}
      <small className="ws-hint">{t("A shelf or category that parts still use cannot be removed. Move those parts first.")}</small>
      {error && <p role="alert" className="ws-err">{error}</p>}
      <button type="button" className="button small" disabled={busy || !loaded} onClick={() => void save()}>{busy ? t("Saving…") : t("Save shelves and categories")}</button>
    </section>
  );
}
