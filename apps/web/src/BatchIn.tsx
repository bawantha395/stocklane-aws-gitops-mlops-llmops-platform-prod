import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Camera as CameraIcon, Check, Loader2, Minus, Plus, Trash2 } from "lucide-react";
import { t } from "./i18n";
import { toast } from "./ui";
import { can } from "./perms";
import { SupplierPick, useSuppliers } from "./Suppliers";
import { api, openPdf, shrink, type Match, type Product } from "./api";
import { printLabelSheet } from "./partsShared";
import { useLoad } from "./workshop/common";

const Camera = React.lazy(() => import("./Camera").then((m) => ({ default: m.Camera })));

type Item = Product & { part_number?: string; location?: string; archived?: boolean };
type Line = { id: string; productId: string; qty: number; cost: string; shelf: string };
type Pending = { key: string; body: string };
type Draft = { lines: Line[]; supplier: string; supplierId: string; reference: string; terms: "PAID" | "CREDIT"; pending: Pending | null };
type Note = { doc_no: string; id: string; lines: { id: string; product_id: string; name: string; quantity: number }[] };

export const BATCH_MAX = 15; // one note holds this many parts; more is saved as two notes, one after the other
const STORE = "lifta.batch.in";
const PART_QR = /^stocklane:v1:([0-9a-f-]{36})$/;
const uid = () => (typeof crypto.randomUUID === "function" ? crypto.randomUUID() : Date.now().toString(36) + Math.random().toString(36).slice(2));
const amount = (n: number) => new Intl.NumberFormat("en", { maximumFractionDigits: 3 }).format(n);
const empty = (): Draft => ({ lines: [], supplier: "", supplierId: "", reference: "", terms: "PAID", pending: null });
const load = (): Draft => { try { const d = JSON.parse(localStorage.getItem(STORE) || "null"); return d && Array.isArray(d.lines) ? { ...empty(), ...d } : empty(); } catch { return empty(); } };
export const batchSize = () => load().lines.length;
export const clearBatch = () => { try { localStorage.removeItem(STORE); } catch { /* ignore */ } };

/** Parts that came in on one delivery: scan or pick them one after another, check the list, save once. The list lives on this phone until it is saved. */
export function BatchIn({ items, picked, onNewItem, onChanged, photo, manual }: { manual?: boolean; items: Item[]; picked?: Item | null; onNewItem?: (imageId: string) => void | Promise<void>; onChanged: () => void; photo?: (item: Item) => React.ReactNode }) {
  const [d, setD] = useState<Draft>(load);
  const [camera, setCamera] = useState(false), [busy, setBusy] = useState(false), [error, setError] = useState(""), [lost, setLost] = useState<string[]>([]);
  const [search, setSearch] = useState(""), [which, setWhich] = useState<{ photoId: string; candidates: Item[] } | null>(null), [last, setLast] = useState("");
  const [notes, setNotes] = useState<Note[]>([]);
  // "Receive stock here" on the store room map: new lines go to that shelf
  const [here, setHere] = useState(() => { try { const v = sessionStorage.getItem("lifta.putaway") || ""; sessionStorage.removeItem("lifta.putaway"); return v; } catch { return ""; } });
  const { list: suppliers } = useSuppliers();
  const { data: stores } = useLoad<{ shelves: string[] }>("/api/inventory/stores");
  const seeCost = can("see_cost");
  const byId = useMemo(() => new Map(items.map((i) => [i.id, i])), [items]);
  useEffect(() => { try { if (d.lines.length || d.supplier || d.reference) localStorage.setItem(STORE, JSON.stringify(d)); else localStorage.removeItem(STORE); } catch { /* ignore */ } }, [d]);

  const lines = d.lines.filter((l) => byId.has(l.productId)); // a part archived since is left out
  const set = (patch: Partial<Draft>) => setD((x) => ({ ...x, ...patch, pending: null }));
  const buzz = () => { try { navigator.vibrate?.(40); } catch { /* ignore */ } };
  const addPart = useCallback((item: Item, n = 1) => {
    if (item.archived) { setError(t("{name} is archived. Restore it first.", { name: item.name })); return; }
    setError(""); setWhich(null); setSearch(""); buzz();
    setLast(item.name);
    setD((x) => {
      const at = x.lines.findIndex((l) => l.productId === item.id);
      const next = at >= 0 ? x.lines.map((l, i) => (i === at ? { ...l, qty: l.qty + n } : l)) : [...x.lines, { id: uid(), productId: item.id, qty: n, cost: "", shelf: here || item.location || "" }];
      return { ...x, lines: next, pending: null };
    });
  }, []);
  // a new item registered from this screen comes back as a line
  // parts registered during this delivery: remembered until their labels are printed
  const [fresh, setFresh] = useState<string[]>(() => { try { return JSON.parse(sessionStorage.getItem("lifta.batchfresh") || "[]"); } catch { return []; } });
  useEffect(() => { try { sessionStorage.setItem("lifta.batchfresh", JSON.stringify(fresh)); } catch { /* ignore */ } }, [fresh]);
  useEffect(() => { if (picked) { addPart(picked); setFresh((f) => (f.includes(picked.id) ? f : [...f, picked.id])); } }, [picked]); // eslint-disable-line react-hooks/exhaustive-deps

  // the camera stays on, so these two must never change identity: they read the latest list through a ref
  const itemsRef = useRef(items); itemsRef.current = items;
  const add = useRef(addPart); add.current = addPart;
  const onCode = useCallback((value: string, qr: boolean) => {
    const v = value.trim(), id = qr ? PART_QR.exec(v)?.[1] : undefined;
    const found = qr ? itemsRef.current.find((p) => p.id === id) : itemsRef.current.find((p) => p.barcode === v);
    if (found) add.current(found);
    else setLost((x) => (x.includes(v) ? x : [...x.slice(-4), v]));
  }, []);
  const onQR = useCallback((v: string) => onCode(v, true), [onCode]);
  const onBar = useCallback((v: string) => onCode(v, false), [onCode]);

  const identify = async (file: File) => {
    setCamera(false); setBusy(true); setError(""); setWhich(null);
    try {
      const form = new FormData(); form.append("file", await shrink(file));
      const qr = await api<{ value: string | null }>("/api/vision/qr", { method: "POST", body: form });
      if (qr.value) { onCode(qr.value, true); setCamera(true); return; }
      const match = await api<Match>("/api/vision/match", { method: "POST", body: form });
      const known = match.candidates.map((c) => items.find((i) => i.id === c.product.id)).filter((i): i is Item => !!i).slice(0, 3);
      setWhich({ photoId: match.imageId, candidates: known });
    } catch (e) { setError((e as Error).message); }
    finally { setBusy(false); }
  };

  const change = (id: string, patch: Partial<Line>) => set({ lines: d.lines.map((l) => (l.id === id ? { ...l, ...patch } : l)) });
  const matches = search.trim().length >= 2 ? items.filter((i) => !i.archived && (i.name + " " + i.sku + " " + i.brand + " " + (i.part_number || "")).toLowerCase().includes(search.trim().toLowerCase())).slice(0, 8) : [];
  const groups = Math.max(1, Math.ceil(lines.length / BATCH_MAX));
  const needCost = seeCost && !!d.supplierId && d.terms === "CREDIT" && lines.some((l) => !l.cost.trim());
  const shelves = stores?.shelves || [];

  const body = (chunk: Line[]) => JSON.stringify({
    kind: "RECEIPT", note: "Received at the counter (batch)", reference: d.reference.trim() || undefined,
    ...(d.supplierId ? { supplierId: d.supplierId, terms: d.terms } : { supplier: d.supplier.trim() || undefined }),
    lines: chunk.map((l) => ({ productId: l.productId, quantity: l.qty, ...(seeCost && l.cost.trim() ? { unitCost: l.cost.trim() } : {}), ...(l.shelf && l.shelf !== (byId.get(l.productId)?.location || "") ? { location: l.shelf } : {}) })),
  });
  // Save: one note per 15 parts, one after the other. A note that did not get an answer is sent again with the same key, so it is saved once.
  const save = async () => {
    if (!lines.length || busy) return;
    setBusy(true); setError("");
    const done: Note[] = [];
    try {
      let rest = lines;
      let pending = d.pending;
      while (rest.length) {
        const chunk = rest.slice(0, BATCH_MAX), b = body(chunk);
        const p = pending && pending.body === b ? pending : { key: uid(), body: b };
        pending = p; setD((x) => ({ ...x, pending: p }));
        const res = await api<Note>("/api/inventory/documents", { method: "POST", body: b }, p.key);
        done.push(res); pending = null;
        const gone = new Set(chunk.map((l) => l.id)); rest = rest.filter((l) => !gone.has(l.id));
        setD((x) => ({ ...x, lines: x.lines.filter((l) => !gone.has(l.id)), pending: null }));
      }
      try { if (d.supplier.trim()) { sessionStorage.setItem("lifta.supplier", d.supplier.trim()); sessionStorage.setItem("lifta.supplierId", d.supplierId); } } catch { /* ignore */ }
      setD((x) => ({ ...empty(), supplier: x.supplier, supplierId: x.supplierId, terms: x.terms })); // the supplier stays for the next delivery; the invoice no. does not
      setNotes(done); finished(done);
    } catch (e) {
      setError((e as Error).message + (done.length ? " " + t("{n} note(s) were saved. The rest of the list is still here: press Save to continue.", { n: done.length }) : " " + t("Nothing was saved. Press Save to try again.")));
      if (done.length) setNotes(done);
    } finally { setBusy(false); onChanged(); }
  };
  const finished = (done: Note[]) => {
    const parts = done.reduce((n, x) => n + x.lines.length, 0);
    toast(t("{n} parts added to stock.", { n: parts }), { ms: 8000, action: { label: t("Undo"), run: () => { void undo(done); } } });
  };
  const undo = async (done: Note[]) => {
    try {
      for (const note of done) for (const l of note.lines) await api("/api/inventory/movements", { method: "POST", body: JSON.stringify({ kind: "STOCK_OUT", productId: l.product_id, quantity: l.quantity, note: "Undo of a batch entry" }) }, uid());
      setNotes([]); onChanged(); toast(t("Undone."));
    } catch (e) { toast((e as Error).message, { bad: true }); }
  };

  return (
    <div className="bi" data-tour="batch-in">
      {error && <div className="stock-error stock-error-toast" role="alert"><strong>{t("Could not complete that action")}</strong><span>{error}</span><button className="toast-close" aria-label="Dismiss error" onClick={() => setError("")}>×</button></div>}
      {lines.length === 0 && notes.length > 0 && fresh.some((id) => byId.has(id)) && (
        <p><button type="button" className="button secondary" onClick={() => void printLabelSheet(fresh.map((id) => byId.get(id)).filter((x): x is Item => !!x)).then(() => setFresh([])).catch((e) => setError((e as Error).message))}>{t("Print labels for the {n} new parts", { n: fresh.filter((id) => byId.has(id)).length })}</button></p>
      )}
      {notes.length > 0 && lines.length === 0 && (
        <p className="counter-done" role="status"><Check size={20} /> {t("Saved.")} {notes.map((n) => <button key={n.id} type="button" className="doc-link" onClick={() => void openPdf("/api/inventory/movements/" + n.id + "/note.pdf", n.doc_no + ".pdf").catch((e) => toast((e as Error).message, { bad: true }))}>{n.doc_no} · {t("Print note")}</button>)}</p>
      )}
      <div className="counter-step">
        <h2><span>1</span> {t("This delivery")}</h2>
        <div className="ws-grid2">
          <SupplierPick id={d.supplierId} name={d.supplier} disabled={busy} onChange={(v) => { const s = (suppliers || []).find((x) => x.id === v.id); set({ supplierId: v.id, supplier: v.name, terms: s && s.credit_days > 0 ? "CREDIT" : "PAID" }); }} />
          <label className="ws-field">{t("Supplier invoice or delivery no.")}<input value={d.reference} maxLength={60} disabled={busy} placeholder="DN-1234" onChange={(e) => set({ reference: e.target.value })} /></label>
        </div>
        {d.supplierId && seeCost && (
          <div className="ws-field" role="group" aria-label={t("Payment")}>{t("Payment")}
            <div className="ws-seg">{([["PAID", t("Paid now")], ["CREDIT", t("On credit")]] as [string, string][]).map(([k, l]) => <button type="button" key={k} className={d.terms === k ? "on" : ""} aria-pressed={d.terms === k} disabled={busy} onClick={() => set({ terms: k as "PAID" | "CREDIT" })}>{l}</button>)}</div>
          </div>
        )}
      </div>

      <div className="counter-step">
        <h2><span>2</span> {t("Add the parts")}</h2>
        {!manual && <>
        <button className="counter-big wide" disabled={busy} onClick={() => setCamera(true)}><CameraIcon size={30} /> {busy ? t("Checking the photo…") : t("Scan the parts, one after another")}</button>
        <p className="stock-help">{t("The camera stays on. Each QR or barcode adds a part. Scan the same part again after a moment to add one more.")}</p>
        </>}
        {lost.length > 0 && (
          <div className="counter-candidates" role="status">
            <p>{t("Not recognised")}: {lost.join(", ")}</p>
            <button type="button" onClick={() => { setSearch(lost[lost.length - 1]); setLost([]); }}>{t("Search for it")}</button>
            <button type="button" onClick={() => setLost([])}>{t("Dismiss")}</button>
          </div>
        )}
        {which && (
          <div className="counter-candidates">
            <p>{which.candidates.length ? t("Which one?") : t("Not recognised")}</p>
            {which.candidates.map((c) => <button key={c.id} onClick={() => { addPart(c); setCamera(true); }}><strong>{c.name}</strong><small>{t("Part no.")} {c.part_number || t("Not set")} · {c.location || t("Shelf not set")}</small></button>)}
            {onNewItem && <button className="counter-new" onClick={() => void Promise.resolve(onNewItem(which.photoId))}><Plus size={18} /> {t("None of these: add as a new item")}</button>}
          </div>
        )}
        <label className="stock-field counter-search">{t("Or search")}<input value={search} placeholder={t("Oil filter")} onChange={(e) => setSearch(e.target.value)} /></label>
        {matches.length > 0 && <div className="counter-list">{matches.map((m) => <button key={m.id} className="counter-result" onClick={() => addPart(m)}>{photo && <span className="counter-result-photo">{photo(m)}</span>}<span className="counter-result-text">{m.name} <small>{t("Part no.")} {m.part_number || t("Not set")} · {t("In stock")} {amount(Number(m.quantity))}</small></span></button>)}</div>}
        {search.trim().length >= 2 && !matches.length && <p className="stock-help">{t("No part matches \"{q}\".", { q: search.trim() })}</p>}
      </div>

      <div className="counter-step">
        <h2><span>3</span> {t("The list")} <small>({lines.length})</small></h2>
        {here && <p className="bi-here" role="status">{t("Putting away on")} <b>{here}</b> <button type="button" className="stock-link" onClick={() => setHere("")}>{t("Stop")}</button></p>}
        {lines.length === 0 ? <p className="stock-help">{t("Nothing on the list yet.")}</p> : (
          <ul className="bi-lines">
            {lines.map((l) => {
              const p = byId.get(l.productId)!;
              return (
                <li key={l.id} className="bi-line">
                  <div className="bi-name"><strong>{p.name}</strong><small>{p.part_number || p.sku} · {t("in stock")} {amount(Number(p.quantity))}</small></div>
                  <div className="counter-stepper bi-qty">
                    <button type="button" aria-label="One less" disabled={busy || l.qty <= 1} onClick={() => change(l.id, { qty: Math.max(1, l.qty - 1) })}><Minus /></button>
                    <input aria-label="Quantity" type="number" inputMode="decimal" min={p.unit === "LITRE" ? 0.001 : 1} step={p.unit === "LITRE" ? 0.001 : 1} value={l.qty} disabled={busy} onChange={(e) => change(l.id, { qty: Number(e.target.value) })} />
                    <button type="button" aria-label="One more" disabled={busy} onClick={() => change(l.id, { qty: l.qty + 1 })}><Plus /></button>
                  </div>
                  {seeCost && <label className="bi-small bi-cost">{t("Cost (LKR)")}<input value={l.cost} inputMode="decimal" maxLength={12} disabled={busy} onChange={(e) => change(l.id, { cost: e.target.value.replace(/[^0-9.]/g, "") })} /></label>}
                  <label className="bi-small bi-shelf">{t("Shelf")}
                    {shelves.length ? (
                      <select value={l.shelf} disabled={busy} onChange={(e) => change(l.id, { shelf: e.target.value })}>
                        <option value="">{t("Shelf not set")}</option>
                        {l.shelf && !shelves.includes(l.shelf) && <option value={l.shelf}>{l.shelf}</option>}
                        {shelves.map((s) => <option key={s} value={s}>{s}</option>)}
                      </select>
                    ) : <input value={l.shelf} maxLength={60} disabled={busy} onChange={(e) => change(l.id, { shelf: e.target.value })} />}
                  </label>
                  <button type="button" className="bi-del" aria-label={t("Remove")} disabled={busy} onClick={() => set({ lines: d.lines.filter((x) => x.id !== l.id) })}><Trash2 size={18} /></button>
                </li>
              );
            })}
          </ul>
        )}
        {lines.length > BATCH_MAX && <p className="stock-help" role="status">{t("More than {n} parts: this saves as {g} notes, one after the other.", { n: BATCH_MAX, g: groups })}</p>}
        {needCost && <small className="stock-error">{t("Enter the cost price so we know how much is owed.")}</small>}
        <button className="button primary counter-confirm" disabled={busy || !lines.length || needCost || lines.some((l) => !(l.qty > 0))} onClick={() => void save()}>
          {busy ? <><Loader2 size={18} className="spin" /> {t("Saving…")}</> : t("Save {n} parts", { n: lines.length })}
        </button>
        {lines.length > 0 && !busy && <button type="button" className="stock-link" onClick={() => setD(empty())}>{t("Clear the list")}</button>}
      </div>

      {camera && (
        <React.Suspense fallback={null}>
          <Camera continuous status={last ? t("Added: {name} · {n} on the list", { name: last, n: lines.length }) : undefined} onQR={onQR} onBarcode={onBar} onPhoto={(f) => void identify(f)} onClose={() => setCamera(false)} />
        </React.Suspense>
      )}
    </div>
  );
}
