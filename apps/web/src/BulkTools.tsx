import { useEffect, useMemo, useRef, useState } from "react";
import { getDefaultMarkup, priceFromCost } from "./businessName";
import { api } from "./api";
import { t } from "./i18n";
import { can } from "./perms";
import { Sheet, toast } from "./ui";
import { IMPORT_COLUMNS, readCsvFile, rowsFromCsv, toCsv } from "./csv";
import { isPhone } from "./counterStart";
import { printLabelSheet, type Item } from "./partsShared";

type Tab = "import" | "price" | "qr";
type Check = { rows: number; ok: number; errors: { row: number; error: string }[] };

function download(name: string, text: string) {
  const a = document.createElement("a"); a.href = URL.createObjectURL(new Blob([text], { type: "text/csv;charset=utf-8" })); a.download = name; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}

export function BulkTools({ items, onClose, onChanged }: { items: Item[]; onClose: () => void; onChanged: () => void }) {
  const tabs: { id: Tab; label: string; show: boolean }[] = [
    { id: "import", label: t("Import from CSV"), show: can("item_add") && !isPhone() },
    { id: "price", label: t("Bulk price"), show: can("price_edit") && can("see_cost") },
    { id: "qr", label: t("QR sheet"), show: true },
  ];
  const first = tabs.find((x) => x.show)!.id;
  const [tab, setTab] = useState<Tab>(first);
  return (
    <Sheet title={t("Bulk tools")} onClose={onClose}>
      <div className="bulk-tabs" role="tablist">{tabs.filter((x) => x.show).map((x) => <button key={x.id} role="tab" aria-selected={tab === x.id} className={tab === x.id ? "on" : ""} onClick={() => setTab(x.id)}>{x.label}</button>)}</div>
      {tab === "import" && <ImportCsv items={items} onChanged={onChanged} />}
      {tab === "price" && <BulkPrice items={items} onChanged={onChanged} />}
      {tab === "qr" && <QrSheet items={items} />}
    </Sheet>
  );
}

type Stores = { categories: string[]; shelves: string[] };
const GRID = ["name", "brand", "partNumber", "category", "openingQuantity", "sellingPrice"] as const;

function ImportCsv({ items, onChanged }: { items: Item[]; onChanged: () => void }) {
  const [rows, setRows] = useState<Record<string, unknown>[]>([]), [check, setCheck] = useState<Check | null>(null), [note, setNote] = useState(""), [busy, setBusy] = useState(false), [file, setFile] = useState("");
  const [done, setDone] = useState(0), [created, setCreated] = useState<string[]>([]), [stores, setStores] = useState<Stores | null>(null), [good, setGood] = useState<Record<string, unknown>[]>([]);
  const keys = useRef<string[]>([]);
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => { api<Stores>("/api/inventory/stores").then(setStores).catch(() => setStores(null)); }, []);
  const verify = async (list: Record<string, unknown>[]) => {
    setBusy(true); setDone(0); setCreated([]); setGood([]); keys.current = [];
    try { const c = await api<Check>("/api/inventory/products/import", { method: "POST", body: JSON.stringify({ rows: list, dryRun: true }) }); setCheck(c); setRows(list); }
    catch (e) { setNote((e as Error).message); } finally { setBusy(false); }
  };
  const pick = async (f?: File) => {
    if (!f) return;
    setCheck(null); setNote(""); setFile(f.name); setDone(0); setCreated([]);
    const r = rowsFromCsv(await readCsvFile(f));
    if (r.missing.length) { setRows([]); setNote(t("These columns are missing:") + " " + r.missing.join(", ")); return; }
    if (r.rows.length > 300) { setRows([]); setNote(t("Up to 300 rows at a time. Split the file.")); return; }
    setRows(r.rows); await verify(r.rows);
    if (r.ignored.length) setNote(t("Not used:") + " " + r.ignored.join(", "));
  };
  // what the file uses that the shop's lists do not have yet
  const listed = new Set((stores?.categories || []).map((c) => c.toLowerCase()));
  const newCats = stores && stores.categories.length ? [...new Set(rows.map((r) => String(r.category || "").trim()).filter((c) => c && !listed.has(c.toLowerCase())))] : [];
  const shelfBad = !!check?.errors.some((e) => /shelf from the list/i.test(e.error));
  const addCats = async () => {
    if (!stores) return;
    setBusy(true);
    try { const next = await api<Stores>("/api/inventory/stores", { method: "PUT", body: JSON.stringify({ categories: [...stores.categories, ...newCats] }) }, crypto.randomUUID()); setStores(next); toast(t("Categories added.")); await verify(rows); }
    catch (e) { setNote((e as Error).message); setBusy(false); }
  };
  const dropShelves = async () => {
    const bad = new Set((check?.errors || []).filter((e) => /shelf from the list/i.test(e.error)).map((e) => e.row - 1));
    await verify(rows.map((r, i) => (bad.has(i) ? { ...r, location: "" } : r)));
  };
  const run = async () => {
    if (!check) return;
    const bad = new Set(check.errors.map((e) => e.row));
    const list = good.length ? good : rows.filter((_, i) => !bad.has(i + 1));
    if (!good.length) setGood(list);
    setBusy(true); let n = done;
    try {
      for (let i = n; i < list.length; i += 10) {
        const batch = Math.floor(i / 10);
        keys.current[batch] = keys.current[batch] || crypto.randomUUID();
        const res = await api<{ created: { id: string }[] }>("/api/inventory/products/import", { method: "POST", body: JSON.stringify({ rows: list.slice(i, i + 10) }) }, keys.current[batch]);
        n = Math.min(i + 10, list.length); setDone(n); setCreated((c) => [...c, ...res.created.map((x) => x.id)]);
      }
      toast(t("{n} parts added.", { n: list.length })); setNote(t("{n} parts added.", { n: list.length })); setRows([]); setCheck(null); setGood([]); onChanged();
    } catch (e) { setNote((e as Error).message + " " + t("{n} parts were added before this. Press Continue to carry on from there.", { n })); onChanged(); }
    finally { setBusy(false); }
  };
  const total = good.length || (check ? check.ok : 0);
  const fresh = items.filter((p) => created.includes(p.id));
  return (
    <div className="bulk-pane">
      <p className="muted">{t("1. Download the template, fill it in Excel, save as CSV. 2. Choose the file. Lifta checks every row before anything is saved.")}</p>
      <p><button type="button" className="button secondary small" onClick={() => download("lifta-parts-template.csv", toCsv([[...IMPORT_COLUMNS], ["Oil filter", "Bosch", "0 451 103 275", "Filters", "", "UNIT", "10", "1500", "3", "", "", "", "", "Lanka Parts", "1100"]]))}>{t("Download template")}</button>{" "}
        <button type="button" className="button primary small" disabled={busy} onClick={() => input.current?.click()}>{t("Choose CSV file")}</button>
        <input ref={input} type="file" accept=".csv,.txt,text/csv" hidden onChange={(e) => { void pick(e.target.files?.[0]); e.target.value = ""; }} /></p>
      <p className="muted">{t("A part with no part number gets NO-PN and its system number. Unit: UNIT, pcs or LITRE. Supplier and cost are optional.")}</p>
      {file && <p className="muted">{file}</p>}
      {note && <p role="status">{note}</p>}
      {rows.length > 0 && (
        <div className="bulk-scroll"><table className="bulk-table"><thead><tr>{GRID.map((g) => <th key={g}>{g}</th>)}</tr></thead><tbody>
          {rows.slice(0, 5).map((r, i) => <tr key={i}>{GRID.map((g) => <td key={g}>{String(r[g] ?? "")}</td>)}</tr>)}
        </tbody></table></div>
      )}
      {rows.length > 5 && <p className="muted">{t("First 5 of {n} rows", { n: rows.length })}</p>}
      {check && (
        <>
          <p><b>{check.ok}</b> {t("rows are fine.")} <b className={check.errors.length ? "bad" : ""}>{check.errors.length}</b> {t("rows have a problem.")}</p>
          {newCats.length > 0 && can("lists") && <p><button type="button" className="button secondary small" disabled={busy} onClick={() => void addCats()}>{t("Add {n} new categories from the file", { n: newCats.length })}</button> <small className="muted">{newCats.slice(0, 6).join(", ")}</small></p>}
          {shelfBad && <p><button type="button" className="button secondary small" disabled={busy} onClick={() => void dropShelves()}>{t("Leave the shelf empty where it is not in the list")}</button></p>}
          {check.errors.length > 0 && <ul className="bulk-errors">{check.errors.slice(0, 50).map((e) => <li key={e.row}>{t("Row")} {e.row + 1}: {e.error}</li>)}</ul>}
          {busy && total > 0 && <div className="start-bar" aria-hidden="true"><span style={{ width: Math.round((done / total) * 100) + "%" }} /></div>}
          <button type="button" className="button primary" disabled={busy || check.ok === 0} onClick={() => void run()}>{done > 0 ? t("Continue ({a} of {b} done)", { a: done, b: total }) : check.errors.length ? t("Import the {n} good rows", { n: check.ok }) : t("Import {n} parts", { n: check.ok })}</button>
        </>
      )}
      {created.length > 0 && !check && fresh.length > 0 && <p><button type="button" className="button secondary" onClick={() => void printLabelSheet(fresh).catch((e) => toast((e as Error).message, { bad: true }))}>{t("Print {n} labels", { n: fresh.length })}</button></p>}
    </div>
  );
}

function BulkPrice({ items, onChanged }: { items: Item[]; onChanged: () => void }) {
  const cats = useMemo(() => [...new Set(items.filter((p) => !p.archived).map((p) => p.category).filter(Boolean))].sort(), [items]);
  const [cat, setCat] = useState(""), [round, setRound] = useState("5"), [busy, setBusy] = useState(false), [msg, setMsg] = useState("");
  const markup = getDefaultMarkup(), step = Math.max(1, Number(round) || 1);
  const preview = useMemo(() => markup <= 0 ? [] : items.filter((p) => !p.archived && (!cat || p.category === cat) && Number(p.last_cost) > 0).map((p) => {
    const price = priceFromCost(Number(p.last_cost), markup, step);
    return { p, price };
  }).filter((r) => r.price !== Number(r.p.selling_price)), [items, cat, markup, step]);
  const noCost = items.filter((p) => !p.archived && (!cat || p.category === cat) && !(Number(p.last_cost) > 0)).length;
  const apply = async () => {
    setBusy(true); let done = 0;
    try {
      for (let i = 0; i < preview.length; i += 25) { await api("/api/inventory/price-review", { method: "POST", body: JSON.stringify({ items: preview.slice(i, i + 25).map((r) => ({ productId: r.p.id, price: r.price })) }) }, crypto.randomUUID()); done += Math.min(25, preview.length - i); }
      toast(t("{n} prices updated.", { n: done })); setMsg(t("{n} prices updated.", { n: done })); onChanged();
    } catch (e) { setMsg((e as Error).message + " " + t("{n} were changed before this.", { n: done })); onChanged(); } finally { setBusy(false); }
  };
  return (
    <div className="bulk-pane">
      <p className="muted">{markup > 0 ? t("New price = last cost + {n}% (the shop markup), rounded up. Nothing changes until you press Apply.", { n: markup }) : t("Set the Default markup in Settings first.")}</p>
      <div className="bulk-form">
        <label>{t("Category")}<select value={cat} onChange={(e) => setCat(e.target.value)}><option value="">{t("All categories")}</option>{cats.map((c) => <option key={c}>{c}</option>)}</select></label>
        <label>{t("Round up to")}<select value={round} onChange={(e) => setRound(e.target.value)}><option value="1">1</option><option value="5">5</option><option value="10">10</option><option value="50">50</option></select></label>
      </div>
      {noCost > 0 && <p className="muted">{t("{n} parts have no cost yet and are left out.", { n: noCost })}</p>}
      {msg && <p role="status">{msg}</p>}
      {preview.length === 0 ? <p className="muted">{t("No price would change.")}</p> : (
        <>
          <div className="bulk-scroll"><table className="bulk-table"><thead><tr><th>{t("Part")}</th><th>{t("Cost")}</th><th>{t("Now")}</th><th>{t("New")}</th></tr></thead><tbody>
            {preview.slice(0, 100).map(({ p, price }) => <tr key={p.id}><td>{p.name}</td><td>{Number(p.last_cost).toLocaleString()}</td><td>{Number(p.selling_price).toLocaleString()}</td><td><b>{price.toLocaleString()}</b></td></tr>)}
          </tbody></table></div>
          {preview.length > 100 && <p className="muted">+ {preview.length - 100}</p>}
          <button type="button" className="button primary" disabled={busy} onClick={() => void apply()}>{t("Apply to {n} parts", { n: preview.length })}</button>
        </>
      )}
    </div>
  );
}

function QrSheet({ items }: { items: Item[] }) {
  const [q, setQ] = useState(""), [pick, setPick] = useState<string[]>([]), [cat, setCat] = useState("");
  const cats = useMemo(() => [...new Set(items.filter((p) => !p.archived).map((p) => p.category).filter(Boolean))].sort(), [items]);
  const list = items.filter((p) => !p.archived && (!cat || p.category === cat) && (!q || [p.name, p.part_number, p.sku].join(" ").toLowerCase().includes(q.toLowerCase()))).slice(0, 80);
  const toggle = (id: string) => setPick((x) => (x.includes(id) ? x.filter((y) => y !== id) : [...x, id]));
  return (
    <div className="bulk-pane">
      <div className="bulk-form">
        <label>{t("Find")}<input value={q} onChange={(e) => setQ(e.target.value)} placeholder={t("Name or part number")} /></label>
        <label>{t("Category")}<select value={cat} onChange={(e) => setCat(e.target.value)}><option value="">{t("All categories")}</option>{cats.map((c) => <option key={c}>{c}</option>)}</select></label>
      </div>
      <p><button type="button" className="button secondary small" onClick={() => setPick([...new Set([...pick, ...list.map((p) => p.id)])])}>{t("Tick all shown")}</button> <button type="button" className="button secondary small" onClick={() => setPick([])}>{t("Clear")}</button></p>
      <ul className="bulk-pick">{list.map((p) => <li key={p.id}><label><input type="checkbox" checked={pick.includes(p.id)} onChange={() => toggle(p.id)} /> <b>{p.name}</b> <small>{p.part_number || p.sku} · {p.location || ""}</small></label></li>)}</ul>
      <button type="button" className="button primary" disabled={pick.length === 0} onClick={() => void printLabelSheet(items.filter((p) => pick.includes(p.id))).catch((e) => toast((e as Error).message, { bad: true }))}>{t("Print {n} labels", { n: pick.length })}</button>
    </div>
  );
}
