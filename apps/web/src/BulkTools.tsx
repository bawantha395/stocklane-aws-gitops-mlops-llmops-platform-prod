import { useMemo, useRef, useState } from "react";
import { api } from "./api";
import { t } from "./i18n";
import { can } from "./perms";
import { Sheet, toast } from "./ui";
import { IMPORT_COLUMNS, rowsFromCsv, toCsv } from "./csv";
import { printLabelSheet, type Item } from "./partsShared";

type Tab = "import" | "price" | "qr";
type Check = { rows: number; ok: number; errors: { row: number; error: string }[] };

function download(name: string, text: string) {
  const a = document.createElement("a"); a.href = URL.createObjectURL(new Blob([text], { type: "text/csv;charset=utf-8" })); a.download = name; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}

export function BulkTools({ items, onClose, onChanged }: { items: Item[]; onClose: () => void; onChanged: () => void }) {
  const tabs: { id: Tab; label: string; show: boolean }[] = [
    { id: "import", label: t("Import from CSV"), show: can("item_add") },
    { id: "price", label: t("Bulk price"), show: can("price_edit") && can("see_cost") },
    { id: "qr", label: t("QR sheet"), show: true },
  ];
  const first = tabs.find((x) => x.show)!.id;
  const [tab, setTab] = useState<Tab>(first);
  return (
    <Sheet title={t("Bulk tools")} onClose={onClose}>
      <div className="bulk-tabs" role="tablist">{tabs.filter((x) => x.show).map((x) => <button key={x.id} role="tab" aria-selected={tab === x.id} className={tab === x.id ? "on" : ""} onClick={() => setTab(x.id)}>{x.label}</button>)}</div>
      {tab === "import" && <ImportCsv onChanged={onChanged} />}
      {tab === "price" && <BulkPrice items={items} onChanged={onChanged} />}
      {tab === "qr" && <QrSheet items={items} />}
    </Sheet>
  );
}

function ImportCsv({ onChanged }: { onChanged: () => void }) {
  const [rows, setRows] = useState<Record<string, unknown>[]>([]), [check, setCheck] = useState<Check | null>(null), [note, setNote] = useState(""), [busy, setBusy] = useState(false), [file, setFile] = useState("");
  const input = useRef<HTMLInputElement>(null);
  const pick = async (f?: File) => {
    if (!f) return;
    setCheck(null); setNote(""); setFile(f.name);
    const r = rowsFromCsv(await f.text());
    if (r.missing.length) { setRows([]); setNote(t("These columns are missing:") + " " + r.missing.join(", ")); return; }
    if (r.rows.length > 300) { setRows([]); setNote(t("Up to 300 rows at a time. Split the file.")); return; }
    setRows(r.rows); setBusy(true);
    try { setCheck(await api<Check>("/api/inventory/products/import", { method: "POST", body: JSON.stringify({ rows: r.rows, dryRun: true }) })); if (r.ignored.length) setNote(t("Not used:") + " " + r.ignored.join(", ")); }
    catch (e) { setNote((e as Error).message); } finally { setBusy(false); }
  };
  const run = async () => {
    if (!check) return;
    const bad = new Set(check.errors.map((e) => e.row));
    const good = rows.filter((_, i) => !bad.has(i + 1));
    setBusy(true); let done = 0;
    try {
      for (let i = 0; i < good.length; i += 10) {
        await api("/api/inventory/products/import", { method: "POST", body: JSON.stringify({ rows: good.slice(i, i + 10) }) }, crypto.randomUUID());
        done += Math.min(10, good.length - i); setNote(t("{n} parts added so far…", { n: done }));
      }
      toast(t("{n} parts added.", { n: done })); setRows([]); setCheck(null); setNote(t("{n} parts added.", { n: done })); onChanged();
    } catch (e) { setNote((e as Error).message + " " + t("{n} parts were added before this. Check the Parts list, then import the file again.", { n: done })); onChanged(); }
    finally { setBusy(false); }
  };
  return (
    <div className="bulk-pane">
      <p className="muted">{t("1. Download the template, fill it in Excel, save as CSV. 2. Choose the file. Lifta checks every row before anything is saved.")}</p>
      <p><button type="button" className="button secondary small" onClick={() => download("lifta-parts-template.csv", toCsv([[...IMPORT_COLUMNS], ["Oil filter", "Bosch", "0 451 103 275", "Filters", "", "UNIT", "10", "1500", "3", "", "", "", ""]]))}>{t("Download template")}</button>{" "}
        <button type="button" className="button primary small" disabled={busy} onClick={() => input.current?.click()}>{t("Choose CSV file")}</button>
        <input ref={input} type="file" accept=".csv,text/csv" hidden onChange={(e) => { void pick(e.target.files?.[0]); e.target.value = ""; }} /></p>
      {file && <p className="muted">{file}</p>}
      {note && <p role="status">{note}</p>}
      {check && (
        <>
          <p><b>{check.ok}</b> {t("rows are fine.")} <b className={check.errors.length ? "bad" : ""}>{check.errors.length}</b> {t("rows have a problem.")}</p>
          {check.errors.length > 0 && <ul className="bulk-errors">{check.errors.slice(0, 50).map((e) => <li key={e.row}>{t("Row")} {e.row + 1}: {e.error}</li>)}</ul>}
          <button type="button" className="button primary" disabled={busy || check.ok === 0} onClick={() => void run()}>{check.errors.length ? t("Import the {n} good rows", { n: check.ok }) : t("Import {n} parts", { n: check.ok })}</button>
        </>
      )}
    </div>
  );
}

function BulkPrice({ items, onChanged }: { items: Item[]; onChanged: () => void }) {
  const cats = useMemo(() => [...new Set(items.filter((p) => !p.archived).map((p) => p.category).filter(Boolean))].sort(), [items]);
  const [cat, setCat] = useState(""), [markup, setMarkup] = useState("30"), [round, setRound] = useState("1"), [busy, setBusy] = useState(false), [msg, setMsg] = useState("");
  const step = Math.max(1, Number(round) || 1);
  const preview = useMemo(() => items.filter((p) => !p.archived && (!cat || p.category === cat) && Number(p.last_cost) > 0).map((p) => {
    const price = Math.ceil((Number(p.last_cost) * (1 + Number(markup || 0) / 100)) / step) * step;
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
      <p className="muted">{t("New price = last cost + markup, rounded up. Nothing changes until you press Apply.")}</p>
      <div className="bulk-form">
        <label>{t("Category")}<select value={cat} onChange={(e) => setCat(e.target.value)}><option value="">{t("All categories")}</option>{cats.map((c) => <option key={c}>{c}</option>)}</select></label>
        <label>{t("Markup %")}<input type="number" inputMode="decimal" min="0" value={markup} onChange={(e) => setMarkup(e.target.value)} /></label>
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
