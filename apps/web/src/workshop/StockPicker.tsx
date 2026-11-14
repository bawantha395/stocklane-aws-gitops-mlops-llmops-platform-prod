import { useMemo, useState } from "react";
import { t } from "../i18n";
import { Loading, lkr, useLoad } from "./common";

type Stock = { id: string; name: string; sku: string; part_number?: string; brand?: string; location?: string; unit: string; quantity: number; selling_price: number; archived?: boolean };

/** Search the parts list and choose a quantity. The caller takes the part from stock and puts it on the job. */
export function StockPicker({ taken, onPick, onClose }: { taken: Record<string, number>; onPick: (p: Stock, qty: number) => Promise<void>; onClose: () => void }) {
  const { data, error } = useLoad<Stock[]>("/api/inventory/products");
  const [q, setQ] = useState(""), [chosen, setChosen] = useState<Stock | null>(null), [qty, setQty] = useState("1"), [busy, setBusy] = useState(false), [err, setErr] = useState("");
  const hits = useMemo(() => {
    const words = q.toLowerCase().split(/\s+/).filter(Boolean), flat = (s: string) => s.toLowerCase().replace(/[\s-]+/g, "");
    return (data || []).filter((p) => !p.archived).filter((p) => {
      const hay = [p.name, p.sku, p.part_number, p.brand, p.location].filter(Boolean).join(" ").toLowerCase();
      return words.every((w) => hay.includes(w) || flat(hay).includes(flat(w)));
    }).sort((a, b) => Number(b.quantity > 0) - Number(a.quantity > 0) || a.name.localeCompare(b.name)).slice(0, 40);
  }, [data, q]);
  const n = Number(qty), whole = chosen?.unit === "UNIT";
  const valid = !!chosen && Number.isFinite(n) && n > 0 && (!whole || Number.isInteger(n)) && Math.round(n * 1000) === n * 1000 && n <= Number(chosen.quantity);
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!chosen || !valid || busy) return;
    setBusy(true); setErr("");
    try { await onPick(chosen, n); } catch (x) { setErr((x as Error).message); setBusy(false); }
  };
  return (
    <div className="ws-dialog-back" role="dialog" aria-modal="true" aria-label={t("Pick from stock")} onClick={(e) => { if (e.target === e.currentTarget && !busy) onClose(); }}>
      <form className="ws-dialog stock-pick" onSubmit={submit}>
        <h3>{t("Pick from stock")}</h3>
        {!chosen ? (
          <>
            <input autoFocus className="stock-pick-search" aria-label={t("Search parts")} placeholder={t("Name, part number or shelf")} value={q} onChange={(e) => setQ(e.target.value)} />
            {!data && !error && <Loading />}
            {error && <p role="alert" className="stock-error">{error}</p>}
            <div className="stock-pick-list">
              {hits.map((p) => (
                <button type="button" key={p.id} className="stock-pick-row" disabled={Number(p.quantity) <= 0} onClick={() => { setChosen(p); setQty("1"); setErr(""); }}>
                  <span><strong>{p.name}</strong><small>{[p.brand, p.part_number || p.sku, p.location].filter(Boolean).join(" · ")}</small></span>
                  <b>{Number(p.quantity) > 0 ? <>{lkr(p.selling_price)}<small>{Number(p.quantity)} {t("in stock")}</small></> : <small>{t("Out of stock")}</small>}</b>
                </button>
              ))}
              {data && !hits.length && <p className="muted">{t("No part found. Use + Add part for something not in stock.")}</p>}
            </div>
          </>
        ) : (
          <>
            <div className="stock-pick-chosen"><strong>{chosen.name}</strong><small>{[chosen.brand, chosen.part_number || chosen.sku, chosen.location].filter(Boolean).join(" · ")}</small></div>
            <p className="muted">{t("Price")}: LKR {lkr(chosen.selling_price)} · {t("In stock")}: {Number(chosen.quantity)}{taken[chosen.id] ? " · " + t("Already on this job") + ": " + taken[chosen.id] : ""}</p>
            {Number(chosen.selling_price) <= 0 && <p className="stock-warn">{t("This part has no selling price. Set the price on the line after adding it.")}</p>}
            <label className="stock-field">{t("Quantity")}
              <input autoFocus className="count-qty" inputMode={whole ? "numeric" : "decimal"} value={qty} onChange={(e) => setQty(e.target.value)} />
            </label>
            {Number.isFinite(n) && n > Number(chosen.quantity) && <p role="alert" className="stock-error">{t("Only")} {Number(chosen.quantity)} {t("in stock")}.</p>}
            {err && <p role="alert" className="stock-error">{err}</p>}
          </>
        )}
        <div className="ws-actions">
          <button type="button" className="button secondary" disabled={busy} onClick={() => (chosen ? setChosen(null) : onClose())}>{chosen ? t("Back") : t("Cancel")}</button>
          {chosen && <button className="button primary" disabled={!valid || busy}>{busy ? t("Saving…") : t("Add to job")}</button>}
        </div>
      </form>
    </div>
  );
}
