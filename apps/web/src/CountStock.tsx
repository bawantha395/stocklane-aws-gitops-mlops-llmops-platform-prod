import { useEffect, useRef, useState, type ReactNode } from "react";
import { ArrowRight, Check, ClipboardCheck, ScanLine, Search } from "lucide-react";
import { api, csv, type Product } from "./api";

type P = Product & { part_number?: string; location?: string };
import { t } from "./i18n";
import { toast } from "./ui";

type Row = { id: string; name: string; sku: string; shelf: string; recorded: number; counted: number; fixed: boolean; at: string };
const KEY = "lifta.count.log";
const num = (n: number) => new Intl.NumberFormat("en", { maximumFractionDigits: 3 }).format(n);
const load = (): Row[] => { try { return JSON.parse(sessionStorage.getItem(KEY) || "[]") as Row[]; } catch { return []; } };

/**
 * Count stock: scan or search a part, type what is on the shelf, and the screen says if it matches.
 * The owner can correct the stock in one tap; a mechanic notes the difference for the owner.
 * Every count in this session is listed below, with an Export CSV for the owner.
 */
export function CountStock({ items, countId, setCountId, find, openScanner, owner, photo, onChanged }: {
  items: P[]; countId: string; setCountId: (id: string) => void; find: (q: string) => P[];
  openScanner: () => void; owner: boolean; photo: (p: P) => ReactNode; onChanged: () => void;
}) {
  const [physical, setPhysical] = useState(""), [search, setSearch] = useState(""), [busy, setBusy] = useState(false), [error, setError] = useState("");
  const [log, setLog] = useState<Row[]>(load);
  const qty = useRef<HTMLInputElement>(null), item = items.find((p) => p.id === countId);
  const fromScan = useRef(false), keyRef = useRef<{ id: string; c: number; k: string } | null>(null);
  useEffect(() => { setPhysical(""); setError(""); if (countId) setTimeout(() => qty.current?.focus(), 60); }, [countId]);
  const save = (next: Row[]) => { setLog(next); try { sessionStorage.setItem(KEY, JSON.stringify(next)); } catch { /* ignore */ } };

  const recorded = item ? Number(item.quantity) : 0, counted = Number(physical);
  const whole = item?.unit === "UNIT";
  const valid = !!item && physical.trim() !== "" && Number.isFinite(counted) && counted >= 0 && (whole ? Number.isInteger(counted) : Math.round(counted * 1000) === counted * 1000);
  const diff = counted - recorded, match = valid && diff === 0;

  const finish = (fixed: boolean) => {
    if (!item) return;
    const row: Row = { id: item.id, name: item.name, sku: item.sku, shelf: item.location || "", recorded, counted, fixed, at: new Date().toISOString() };
    save([row, ...log.filter((r) => r.id !== item.id)]);
    const wasScan = fromScan.current;
    setCountId(""); setPhysical(""); setSearch("");
    if (wasScan) openScanner();
  };
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!valid || busy) return;
    if (match) { finish(false); return; }
    if (!owner) { finish(false); toast(t("Difference noted. Ask the owner to correct the stock.")); return; }
    setBusy(true); setError("");
    // The same key is reused when the person taps again after a slow or dropped connection, so a count is never applied twice.
    if (!keyRef.current || keyRef.current.id !== item!.id || keyRef.current.c !== counted) keyRef.current = { id: item!.id, c: counted, k: crypto.randomUUID() };
    try {
      await api("/api/inventory/movements", { method: "POST", body: JSON.stringify({ kind: "COUNT", productId: item!.id, quantity: counted, note: "Count correction" }) }, keyRef.current.k);
      onChanged(); toast(t("Stock corrected to") + " " + num(counted));
      finish(true);
    } catch (x) {
      const m = (x as Error).message || "";
      // The stock already equals this count (an earlier tap got through): treat as done.
      if (/already matches/i.test(m)) { onChanged(); finish(true); }
      else setError(m);
    } finally { setBusy(false); }
  };

  const matches = search.trim() ? find(search).slice(0, 12) : [];
  const diffs = log.filter((r) => r.counted !== r.recorded);
  return (
    <section className="stock-panel count-panel">
      {!item && (
        <>
          <div className="find-bar">
            <label className="search-box">
              <Search size={19} />
              <input aria-label="Search count items" value={search} onChange={(e) => setSearch(e.target.value)} placeholder={t("Name, part number or shelf")} />
            </label>
            <button type="button" className="button primary find-scan" onClick={() => { fromScan.current = true; openScanner(); }} aria-label={t("Scan item QR")}><ScanLine size={20} /> <span>{t("Scan")}</span></button>
          </div>
          {search && (
            <div className="lookup-results">
              {matches.map((p) => (
                <button className="lookup-row" key={p.id} onClick={() => { fromScan.current = false; setCountId(p.id); }}>
                  {photo(p)}
                  <span><strong>{p.name}</strong><small>{t("Part no.")} {p.part_number || "—"} · {p.location || t("Shelf not set")}</small></span>
                  <b>{num(Number(p.quantity))}<small>{p.unit === "LITRE" ? "L" : ""}</small></b>
                </button>
              ))}
              {!matches.length && <p className="stock-help">{t("No item found. Check the part number.")}</p>}
            </div>
          )}
          {!search && <p className="stock-help">{t("Scan the part's QR, then type what you count on the shelf. Scan, type, Enter, next.")}</p>}
        </>
      )}
      {item && (
        <form onSubmit={submit}>
          <div className="identified-item">
            {photo(item)}
            <div>
              <h2>{item.name}</h2>
              <p>{item.brand} · {item.part_number || item.sku}</p>
              <span className="shelf-chip">{item.location || t("Shelf not set")}</span>
            </div>
          </div>
          <label className="stock-field">{t("How many are on the shelf?")}
            <input ref={qty} className="count-qty" aria-label="Counted quantity" type="number" inputMode={whole ? "numeric" : "decimal"} min="0" step={whole ? 1 : 0.001} value={physical} onChange={(e) => setPhysical(e.target.value)} placeholder="0" />
          </label>
          {valid && (
            <div className={"count-result " + (match ? "balanced" : "difference")} role="status">
              <h3>{match ? t("The count matches") : t("There is a difference")}</h3>
              <p>{t("Recorded")}: <b>{num(recorded)}</b> · {t("Counted")}: <b>{num(counted)}</b> · {t("Difference")}: <b>{(diff > 0 ? "+" : "") + num(diff)}</b></p>
            </div>
          )}
          {error && <p role="alert" className="stock-error">{error}</p>}
          <div className="count-actions">
            <button className={"button " + (match || !valid || owner ? "primary" : "secondary")} disabled={!valid || busy}>
              {busy ? t("Saving…") : match ? <><Check size={18} /> {t("Matches, next")}</> : !valid ? t("Type the count") : owner ? t("Correct stock to") + " " + num(counted) : t("Note the difference")}
            </button>
            {valid && !match && owner && <button type="button" className="button secondary" disabled={busy} onClick={() => { finish(false); }}>{t("Note only, do not change stock")}</button>}
            <button type="button" className="button secondary" disabled={busy} onClick={() => { setCountId(""); }}>{t("Pick another item")}</button>
          </div>
          {!owner && valid && !match && <p className="stock-help">{t("Only the owner can change the stock. Your count is noted below.")}</p>}
        </form>
      )}
      {log.length > 0 && (
        <div className="count-log">
          <div className="count-log-head">
            <h3><ClipboardCheck size={18} /> {t("This session")}: {log.length} {t("counted")} · {log.length - diffs.length} {t("match")} · {diffs.length} {t("differ")}</h3>
            <span>
              <button type="button" className="button secondary small" onClick={() => csv("stock-count-" + new Date().toISOString().slice(0, 10) + ".csv", log.map((r) => ({ Part: r.name, SKU: r.sku, Shelf: r.shelf, Recorded: r.recorded, Counted: r.counted, Difference: r.counted - r.recorded, "Stock corrected": r.fixed ? "Yes" : "No", Time: r.at })))}>{t("Export CSV")}</button>
              <button type="button" className="button secondary small" onClick={() => save([])}>{t("Clear")}</button>
            </span>
          </div>
          <ul>
            {log.slice(0, 30).map((r) => (
              <li key={r.id + r.at} className={r.counted === r.recorded ? "ok" : "bad"}>
                <span><strong>{r.name}</strong><small>{r.shelf || r.sku}</small></span>
                <b>{num(r.recorded)} <ArrowRight size={13} /> {num(r.counted)}</b>
                <em>{r.counted === r.recorded ? t("Matches") : (r.counted > r.recorded ? "+" : "") + num(r.counted - r.recorded) + (r.fixed ? " · " + t("corrected") : " · " + t("noted"))}</em>
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}
