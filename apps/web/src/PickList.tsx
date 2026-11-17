import { useMemo, useState } from "react";
import { t } from "./i18n";
import { Loading, useLoad } from "./workshop/common";
import { routeIndex, shelfRoute, type RouteLayout } from "./shelfRoute";

type Prod = { id: string; name: string; location?: string; quantity: number | string; reorder_level?: number | string | null };
export type PickLine = { product_id: string; name: string; quantity: number | string };

/** The parts of one job in the order you walk the store room (wall, rack, level). Tick each as it is taken. */
export default function PickList({ lines, onClose }: { lines: PickLine[]; onClose: () => void }) {
  const prods = useLoad<Prod[]>("/api/inventory/products");
  const layout = useLoad<RouteLayout>("/api/inventory/stores/layout");
  const [done, setDone] = useState<string[]>([]);
  const rows = useMemo(() => {
    const order = shelfRoute(layout.data);
    const by = new Map((prods.data || []).map((p) => [p.id, p]));
    return lines.map((l) => ({ l, p: by.get(l.product_id) })).sort((a, b) => routeIndex(order, a.p?.location) - routeIndex(order, b.p?.location));
  }, [lines, prods.data, layout.data]);
  const all = rows.length > 0 && rows.every((r) => done.includes(r.l.product_id));
  return (
    <div className="modal-back" role="dialog" aria-modal="true" aria-label={t("Pick list")}>
      <div className="modal pick-list">
        <h3>{t("Pick list")}</h3>
        <p className="muted">{t("Pick the parts in this order. Tick each one as you take it.")}</p>
        {!prods.data || !layout.data ? <Loading error={prods.error || layout.error} /> : (
          <ul className="pl-rows">
            {rows.map(({ l, p }) => {
              const low = !!p && p.reorder_level != null && Number(p.quantity) <= Number(p.reorder_level);
              const on = done.includes(l.product_id);
              return (
                <li key={l.product_id} className={(low ? "low " : "") + (on ? "done" : "")}>
                  <label>
                    <input type="checkbox" checked={on} onChange={() => setDone(on ? done.filter((x) => x !== l.product_id) : [...done, l.product_id])} />
                    <span className="pl-shelf">{p?.location || "—"}</span>
                    <span className="pl-name"><b>{l.name}</b> × {l.quantity}</span>
                  </label>
                  {low && <span className="pl-low">{t("Order this")} · {t("In stock")}: {p!.quantity}</span>}
                </li>
              );
            })}
          </ul>
        )}
        <div className="modal-actions">
          <button type="button" className="button primary" onClick={onClose}>{all ? t("Got it") : t("Close")}</button>
        </div>
      </div>
    </div>
  );
}
