import { t } from "./i18n";
import { Loading, useLoad } from "./workshop/common";

type Layout = { areas: { id: string; name: string }[]; racks: { id: string; name: string; area_id?: string | null; levels: { id: string; name: string }[] }[] };

/** Tap the shelf on the store room: walls, racks, levels. Gives back the shelf name the part is kept under. */
export function ShelfPicker({ value, onPick, onClose }: { value: string; onPick: (shelf: string) => void; onClose: () => void }) {
  const { data, error } = useLoad<Layout>("/api/inventory/stores/layout");
  const walls = data ? [...data.areas, ...(data.racks.some((r) => !r.area_id) ? [{ id: "", name: t("No wall") }] : [])] : [];
  return (
    <div className="stock-modal-shade">
      <section className="stock-modal shelf-picker" role="dialog" aria-modal="true" aria-label={t("Pick a shelf")}>
        <h2>{t("Pick a shelf")}</h2>
        {!data ? <Loading error={error} /> : data.racks.length === 0 ? <p className="muted">{t("No shelves yet.")}</p> : walls.map((w) => (
          <div key={w.id || "none"} className="sp-wall">
            <h3>{w.name}</h3>
            <div className="sp-racks">
              {data.racks.filter((r) => (r.area_id || "") === w.id).map((r) => (
                <div key={r.id} className="sp-rack">
                  <b>{r.name}</b>
                  {r.levels.length === 0 ? <button type="button" className={"shelf-chip" + (value === r.name ? " on" : "")} onClick={() => onPick(r.name)}>{r.name}</button>
                    : r.levels.map((l) => { const name = r.name + "-" + l.name; return <button key={l.id} type="button" className={"shelf-chip" + (value === name ? " on" : "")} onClick={() => onPick(name)}>{l.name}</button>; })}
                </div>
              ))}
            </div>
          </div>
        ))}
        <div className="stock-actions"><button type="button" className="button secondary" onClick={onClose}>{t("Close")}</button></div>
      </section>
    </div>
  );
}
