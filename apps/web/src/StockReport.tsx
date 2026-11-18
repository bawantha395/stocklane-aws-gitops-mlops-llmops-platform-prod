import { t } from "./i18n";
import { useEffect, useMemo, useState } from "react";
import { api, csv, download, type Product } from "./api";
import { hasForecast, levelOrder, whole, type Row } from "./reorder";

const colomboToday = () => new Date(Date.now() + 330 * 60000).toISOString().slice(0, 10);

type Item = Product & { location?: string | null };
type Forecast = { status: string; products: Row[] };
type Level = "out" | "low" | "ok";
type Line = { id: string; name: string; sku: string; shelf: string; stock: number; unit: string; level: Level; lasts: string; order: number; price: number; cost: number | null; prev: number | null; supplier: string };

const money = (n: number) => n.toLocaleString("en", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const unitName = (u: string) => (u === "LITRE" ? "litres" : "pieces");

/** One plain verdict per item, from live stock and the nightly forecast. */
export function buildLines(items: Item[], forecast: Row[]): Line[] {
  const byId = new Map(forecast.map((r) => [r.id, r]));
  const lines = items.map((p): Line => {
    const f = byId.get(p.id);
    const stock = Number(p.quantity), usable = hasForecast(f);
    const perDay = usable ? (f!.next7 || 0) / 7 : 0;
    const days = perDay > 0 ? stock / perDay : Infinity;
    const order = usable ? f!.suggestedTopUp7 || 0 : levelOrder({ ...(f || { id: p.id, sku: p.sku, name: p.name, unit: p.unit, status: "no_forecast" }), availableNow: stock, reorderLevel: Number(p.reorder_level) });
    const level: Level = stock <= 0 ? "out" : stock <= Number(p.reorder_level) || days <= 3 || order > 0 ? "low" : "ok";
    const lasts = stock <= 0 ? "Finished" : !usable ? "Still learning" : !Number.isFinite(days) ? "Not being used" : days > 90 ? "More than 3 months" : "About " + Math.max(1, Math.round(days)) + (Math.round(days) <= 1 ? " day" : " days");
    return { id: p.id, name: p.name, sku: p.sku, shelf: p.location || "", stock, unit: p.unit, level, lasts, order, price: Number(p.selling_price), cost: p.last_cost == null ? null : Number(p.last_cost), prev: p.prev_cost == null ? null : Number(p.prev_cost), supplier: p.supplier || "" };
  });
  const rank = { out: 0, low: 1, ok: 2 };
  return lines.sort((a, b) => rank[a.level] - rank[b.level] || a.name.localeCompare(b.name));
}

const LABEL: Record<Level, string> = { out: "Finished", low: "Order soon", ok: "Fine" };

const dayPlus = (iso: string, n: number) => new Date(Date.parse(iso + "T00:00:00Z") + n * 86400000).toISOString().slice(0, 10);

/** Owner: what happened to every item between two dates (came in, went out, returned), as a PDF. */
export function MovementPdf({ range }: { range?: { from: string; to: string } }) {
  const end = colomboToday();
  const [from, setFrom] = useState(dayPlus(end, -30)), [to, setTo] = useState(end), [busy, setBusy] = useState(false), [err, setErr] = useState("");
  // follow the date buttons on the History page when the owner picks a month or a custom range there
  useEffect(() => { if (range?.from && range?.to) { setFrom(range.from); setTo(range.to > end ? end : range.to); } }, [range?.from, range?.to, end]);
  const go = async () => {
    if (!from || !to || from > to) { setErr("Pick a start date that is not after the end date"); return; }
    setBusy(true); setErr("");
    try { await download("/api/inventory/analysis.pdf?from=" + encodeURIComponent(from + "T00:00:00+05:30") + "&until=" + encodeURIComponent(dayPlus(to, 1) + "T00:00:00+05:30"), "stock-movement-" + from + "_" + to + ".pdf"); }
    catch (e) { setErr((e as Error).message); } finally { setBusy(false); }
  };
  return (
    <div className="report-move" data-tour="stock-movement-pdf">
      <div><strong>{t("Stock movement PDF")}</strong><p className="stock-help">For the dates you pick: every item, how many were received, issued and returned, with the opening and closing stock.</p></div>
      <label>{t("From")} <input type="date" value={from} max={to} onChange={(e) => setFrom(e.target.value)} /></label>
      <label>To <input type="date" value={to} min={from} max={end} onChange={(e) => setTo(e.target.value)} /></label>
      <button className="button primary" disabled={busy} onClick={() => void go()}>{busy ? "Preparing…" : "Download PDF"}</button>
      {err && <p role="alert" className="stock-error">{err}</p>}
    </div>
  );
}

export function StockReport() {
  const [items, setItems] = useState<Item[] | null>(null), [forecast, setForecast] = useState<Row[]>([]);
  const [error, setError] = useState(""), [search, setSearch] = useState(""), [filter, setFilter] = useState<Level | "all">("all"), [sup, setSup] = useState("");
  const load = async () => {
    try {
      setItems(await api<Item[]>("/api/inventory/products"));
      try { setForecast((await api<Forecast>("/api/forecast")).products || []); } catch { setForecast([]); }
    } catch (e) { setError((e as Error).message); }
  };
  useEffect(() => { void load(); }, []);
  const lines = useMemo(() => buildLines(items || [], forecast), [items, forecast]);
  const counts = { out: lines.filter((l) => l.level === "out").length, low: lines.filter((l) => l.level === "low").length, ok: lines.filter((l) => l.level === "ok").length };
  const suppliers = [...new Set(lines.map((l) => l.supplier).filter(Boolean))].sort();
  const shown = lines.filter((l) => (filter === "all" || l.level === filter) && (!sup || l.supplier === sup) && (l.name + " " + l.sku + " " + l.shelf + " " + l.supplier).toLowerCase().includes(search.trim().toLowerCase()));
  const today = colomboToday();
  if (!items) return <section className="stock-panel report"><p className="stock-help">{error || "Loading your stock…"}</p></section>;
  return (
    <section className="report" aria-label="Stock report">
      <div className="report-head">
        <div><p className="eyebrow">OWNER</p><h1>{t("Stock report")}</h1><p className="stock-help">{t("What you have, what is running out, and what to order. It updates by itself every night.")}</p></div>
        <button className="button secondary" onClick={() => csv("stock-" + today + ".csv", shown.map((l) => ({ Item: l.name, Code: l.sku, Shelf: l.shelf, "In stock": l.stock, Status: LABEL[l.level], "Will last": l.lasts, "Order this week": l.order || "", Supplier: l.supplier, "Last cost": l.cost ?? "", "Selling price": l.price, "Profit each": l.cost == null ? "" : l.price - l.cost })))}>{t("Download list")}</button>
      </div>
      {error && <p role="alert" className="stock-error">{error}</p>}
      <div className="report-filters" role="group" aria-label="Show">
        {([["all", "All", lines.length], ["out", "Finished", counts.out], ["low", "Order soon", counts.low], ["ok", "Fine", counts.ok]] as [Level | "all", string, number][]).map(([key, label, n]) => (
          <button key={key} className={"report-chip " + key + (filter === key ? " chosen" : "")} onClick={() => setFilter(key)}><b>{n}</b> {label}</button>
        ))}
        {suppliers.length > 0 && <select className="report-search" aria-label="Supplier" value={sup} onChange={(e) => setSup(e.target.value)}><option value="">{t("All suppliers")}</option>{suppliers.map((s) => <option key={s} value={s}>{s}</option>)}</select>}
        <input className="report-search" aria-label="Search items" placeholder="Search an item" value={search} onChange={(e) => setSearch(e.target.value)} />
      </div>
      <div className="stock-table-wrap">
        <table className="stock-table">
          <thead><tr><th>Item</th><th>{t("In stock")}</th><th>{t("Status")}</th><th>{t("Will last")}</th><th>{t("Supplier")}</th><th>{t("Order this week")}</th><th>{t("Cost and profit")}</th></tr></thead>
          <tbody>
            {shown.map((l) => (
              <tr key={l.id}>
                <td><strong>{l.name}</strong>{l.shelf && <small>{l.shelf}</small>}</td>
                <td>{whole(l.stock)} <small>{unitName(l.unit)}</small></td>
                <td><span className={"status-pill " + l.level}>{LABEL[l.level]}</span></td>
                <td>{l.lasts}</td>
                <td>{l.supplier || <small>—</small>}</td>
                <td>{l.order > 0 ? <strong>{whole(l.order)}</strong> : "—"}</td>
                <td>{l.cost == null ? <small>{t("No cost yet")}</small> : (
                  <>
                    <strong>{money(l.price - l.cost)}</strong> <small>profit each</small>
                    <small>Cost {money(l.cost)} · sells {money(l.price)}{l.prev != null && l.prev !== l.cost ? " · was " + money(l.prev) + (l.cost > l.prev ? " (up)" : " (down)") : ""}</small>
                  </>
                )}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {!shown.length && <div className="stock-empty">{lines.length ? "No items match." : "No parts yet. Add your first part at Receive & Issue, then this report fills itself."}</div>}
      </div>
    </section>
  );
}
