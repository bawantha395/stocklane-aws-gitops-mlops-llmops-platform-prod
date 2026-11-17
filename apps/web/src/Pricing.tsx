import { useState } from "react";
import { api, type Product } from "./api";
import { can } from "./perms";
import { t } from "./i18n";
import { toast } from "./ui";
import { Empty, Loading, lkr, useCommand, useLoad } from "./workshop/common";

type Priced = Product & { suggested_price?: number | null; markup_used?: number | null; markup_pct?: number | null; margin_pct?: number | null };
type Change = { at: string; old: number; new: number; by?: string };

/** Selling price, the part's own markup and the price the markup suggests. Cost and markup are only for people who may see cost. */
export function PriceBox({ item, onChanged }: { item: Priced; onChanged?: (p: Priced) => void }) {
  const command = useCommand();
  const seeCost = can("see_cost");
  const [price, setPrice] = useState(String(item.selling_price ?? 0)), [markup, setMarkup] = useState(item.markup_pct == null ? "" : String(item.markup_pct)), [busy, setBusy] = useState(false), [cur, setCur] = useState<Priced>(item);
  const [log, setLog] = useState<Change[] | null>(null);
  const save = async (body: Record<string, unknown>) => {
    setBusy(true);
    try {
      const r = await command<Priced>("/api/inventory/products/" + item.id + "/price", body);
      setCur(r); setPrice(String(r.selling_price)); setMarkup(r.markup_pct == null ? "" : String(r.markup_pct)); setLog(null); onChanged?.(r); toast(t("Saved."));
    } catch (e) { toast((e as Error).message, { bad: true }); } finally { setBusy(false); }
  };
  const history = async () => { try { setLog(await api<Change[]>("/api/inventory/products/" + item.id + "/price-history")); } catch (e) { toast((e as Error).message, { bad: true }); } };
  return (
    <div className="price-box">
      <h3>{t("Selling price")}</h3>
      <div className="ws-grid2">
        <label className="stock-field">{t("Price (LKR)")}<input inputMode="decimal" value={price} disabled={busy} onChange={(e) => setPrice(e.target.value.replace(/[^0-9.]/g, ""))} /></label>
        {seeCost && <label className="stock-field">{t("Markup on cost (%)")} <small>({t("blank = shop default")})</small><input inputMode="decimal" value={markup} disabled={busy} onChange={(e) => setMarkup(e.target.value.replace(/[^0-9.]/g, ""))} /></label>}
      </div>
      {seeCost && (
        <p className="muted">
          {cur.last_cost != null ? t("Cost") + " LKR " + lkr(cur.last_cost) : t("Cost not entered")}
          {cur.margin_pct != null && " · " + t("Margin") + " " + cur.margin_pct + "%"}
          {cur.suggested_price != null && " · " + t("Suggested") + " LKR " + lkr(cur.suggested_price) + " (+" + cur.markup_used + "%)"}
        </p>
      )}
      <div className="ws-bar">
        <button type="button" className="button primary small" disabled={busy || !(Number(price) >= 0) || (Number(price) === cur.selling_price && (!seeCost || markup === (cur.markup_pct == null ? "" : String(cur.markup_pct))))}
          onClick={() => void save({ price, ...(seeCost ? { markupPct: markup } : {}) })}>{t("Save price")}</button>
        {seeCost && cur.suggested_price != null && cur.suggested_price !== cur.selling_price && <button type="button" className="button secondary small" disabled={busy} onClick={() => void save({ price: cur.suggested_price })}>{t("Use suggested price")}</button>}
        <button type="button" className="button secondary small" onClick={() => void history()}>{t("Price history")}</button>
      </div>
      {log && (log.length === 0 ? <small className="muted">{t("The price has not been changed yet.")}</small> : log.map((c) => <div className="ws-cust-line" key={c.at}><span>{new Date(c.at).toLocaleDateString("en-CA", { timeZone: "Asia/Colombo" })} <small>{c.by || ""}</small></span><span className="ws-cust-line-r">{lkr(c.old)} → <b>{lkr(c.new)}</b></span></div>))}
    </div>
  );
}

type Row = { id: string; sku: string; name: string; part_number?: string; quantity: number; last_cost: number; selling_price: number; suggested_price: number; markup_used: number; margin_pct: number | null; below: boolean };

/** Parts whose price is not cost plus markup. Tick the ones to change and set them all at once. */
export function PriceReview() {
  const { data, error, reload } = useLoad<{ items: Row[]; below: number }>("/api/inventory/price-review");
  const command = useCommand();
  const [off, setOff] = useState<Record<string, boolean>>({}), [edit, setEdit] = useState<Record<string, string>>({}), [busy, setBusy] = useState(false);
  if (!data) return <section className="ws"><h1 className="ws-large">{t("Price review")}</h1><Loading error={error} /></section>;
  const rows = data.items.slice(0, 25), chosen = rows.filter((r) => !off[r.id]);
  const apply = async () => {
    setBusy(true);
    try { const r = await command<{ updated: number }>("/api/inventory/price-review", { items: chosen.map((r) => ({ productId: r.id, price: edit[r.id] ?? String(r.suggested_price) })) }); toast(r.updated + " " + t("prices set.")); setOff({}); setEdit({}); await reload(); window.dispatchEvent(new Event("lifta:stock-changed")); }
    catch (e) { toast((e as Error).message, { bad: true }); } finally { setBusy(false); }
  };
  return (
    <section className="ws">
      <div className="ws-top"><div><h1 className="ws-large">{t("Price review")}</h1></div></div>
      <p className="ws-help">{t("Parts whose selling price is not their cost plus the markup. Lowest margin first. Set the shop markup in Settings, or a part's own markup on the part.")}</p>
      {data.items.length === 0 ? <Empty>{t("Every part with a cost and a markup is priced as suggested.")}</Empty> : (
        <div className="ws-card">
          {rows.map((r) => (
            <div className="ws-order-line" key={r.id}>
              <label className="ws-order-pick"><input type="checkbox" checked={!off[r.id]} onChange={(e) => setOff({ ...off, [r.id]: !e.target.checked })} />
                <span><b>{r.name}</b> <small>{r.part_number || r.sku}</small><br /><small className={r.below ? "ws-debt" : "muted"}>{t("Cost")} {lkr(r.last_cost)} · {t("Now")} {lkr(r.selling_price)}{r.margin_pct != null ? " (" + r.margin_pct + "%)" : ""} · +{r.markup_used}%</small></span></label>
              <span className="ws-order-ctl"><input className="ws-qty" aria-label={t("New price") + " " + r.name} inputMode="decimal" value={edit[r.id] ?? String(r.suggested_price)} onChange={(e) => setEdit({ ...edit, [r.id]: e.target.value.replace(/[^0-9.]/g, "") })} /></span>
            </div>
          ))}
          {data.items.length > rows.length && <small className="muted">{t("Showing the first 25. Apply them and the next ones appear.")}</small>}
          <div className="ws-bar"><button className="button primary small" disabled={busy || chosen.length === 0} onClick={() => void apply()}>{t("Set these prices")} ({chosen.length})</button></div>
        </div>
      )}
    </section>
  );
}
