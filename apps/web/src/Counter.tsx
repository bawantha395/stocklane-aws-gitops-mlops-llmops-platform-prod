import { SHELF_FOCUS, parseShelfCode } from "./StoreMap";
import React, { useCallback, useEffect, useRef, useState } from "react";
import { ArrowLeft, Camera as CameraIcon, Check, Loader2, Minus, Plus } from "lucide-react";
import { t, useLang } from "./i18n";
import { toast } from "./ui";
import { SupplierPick, useSuppliers } from "./Suppliers";
import { BatchIn, batchSize, clearBatch } from "./BatchIn";
import { BatchOut, batchOutSize, clearBatchOut } from "./BatchOut";
import { api, openPdf, shrink, type Match, type Product, type BarcodeLookup, type Movement } from "./api";

const Camera = React.lazy(() => import("./Camera").then((m) => ({ default: m.Camera })));

type Item = Product & { part_number?: string; location?: string; archived?: boolean };
export type Mode = "receive" | "give";
const PART_QR = /^stocklane:v1:([0-9a-f-]{36})$/;
const key = () => crypto.randomUUID();
const amount = (n: number) => new Intl.NumberFormat("en", { maximumFractionDigits: 3 }).format(n);

export function partFromCode(value: string, items: Item[]) {
  const id = PART_QR.exec(value.trim())?.[1];
  return items.find((p) => p.id === id) || null;
}

export function Counter({ moves = [], items, initialMode = "receive", picked = null, photo, onNewItem, onBarcodeSuggestion, onChanged }: { moves?: Movement[]; items: Item[]; initialMode?: Mode; picked?: Item | null; photo?: (item: Item) => React.ReactNode; onNewItem?: (imageId: string) => void | Promise<void>; onBarcodeSuggestion?: (barcode: string, suggestions: Record<string, string>) => void; onChanged: () => void }) {
  useLang();
  const [starting, setStarting] = useState(false);
  const [mode, setMode] = useState<Mode>(initialMode);
  // "Part came in" one by one, or a whole delivery as a batch. The batch list lives on this phone until it is saved.
  const [style, setStyleNow] = useState<"one" | "batch">(() => { try { return batchSize() > 0 || batchOutSize() > 0 || localStorage.getItem("lifta.counter.style") === "batch" ? "batch" : "one"; } catch { return "one"; } });
  const [leaving, setLeaving] = useState(false);
  const setStyle = (v: "one" | "batch") => { setStyleNow(v); setLeaving(false); try { localStorage.setItem("lifta.counter.style", v); } catch { /* ignore */ } };
  const chooseStyle = (v: "one" | "batch") => { if (v === style) return; if (v === "one" && (mode === "receive" ? batchSize() : batchOutSize()) > 0) { setLeaving(true); return; } setStyle(v); };
  const batching = style === "batch";
  const [part, setPart] = useState<Item | null>(null);
  const [candidates, setCandidates] = useState<Item[]>([]);
  const [photoId, setPhotoId] = useState("");
  const [quantity, setQuantity] = useState(1);
  const [search, setSearch] = useState(""), [listOpen, setListOpen] = useState(false);
  const comboRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!listOpen) return;
    const away = (e: PointerEvent) => { if (!comboRef.current?.contains(e.target as Node) && !(e.target as HTMLElement).closest?.(".photo-viewer")) setListOpen(false); };
    document.addEventListener("pointerdown", away); return () => document.removeEventListener("pointerdown", away);
  }, [listOpen]);
  const [camera, setCamera] = useState(false);
  const [busy, setBusy] = useState(false), [error, setError] = useState(""), [done, setDone] = useState("");
  // The note for the last entry (GRN for a part that came in, GIN for one that went out): print it from the confirmation.
  const [note, setNote] = useState<{ id: string; no: string } | null>(null);
  const [supplier, setSupplier] = useState(() => { try { return sessionStorage.getItem("lifta.supplier") || ""; } catch { return ""; } }), [supplierId, setSupplierId] = useState(() => { try { return sessionStorage.getItem("lifta.supplierId") || ""; } catch { return ""; } }), [reference, setReference] = useState(""), [cost, setCost] = useState("");
  const [terms, setTerms] = useState<"PAID" | "CREDIT">("PAID"), { list: supplierList } = useSuppliers();
  const pickSupplier = (v: { id: string; name: string }) => { setSupplierId(v.id); setSupplier(v.name); const s = (supplierList || []).find((x) => x.id === v.id); setTerms(s && s.credit_days > 0 ? "CREDIT" : "PAID"); };
  useEffect(() => { if (part?.supplier) { setSupplier(part.supplier); setSupplierId(part.supplier_id || ""); } }, [part?.id]); // eslint-disable-line react-hooks/exhaustive-deps
  const commandKey = useRef(key());
  // "Part went out" can put the part straight on an open repair job: the job's bill and the stock change together
  type OpenJob = { id: string; registration: string; customer: string };
  const [jobs, setJobs] = useState<OpenJob[]>([]), [jobId, setJobId] = useState("");
  useEffect(() => {
    if (mode !== "give") return;
    let live = true;
    api<(OpenJob & { status: string })[]>("/api/workshop/jobs").then((r) => {
      if (!live) return;
      const open = r.filter((x) => x.status === "OPEN"); setJobs(open);
      try { const last = JSON.parse(sessionStorage.getItem("lifta.counter.job") || "null"); if (last && Date.now() - last.at < 10 * 60 * 1000 && open.some((x) => x.id === last.id)) setJobId(last.id); } catch { /* ignore */ }
    }).catch(() => setJobs([]));
    return () => { live = false; };
  }, [mode]);

  useEffect(() => { setMode(initialMode); }, [initialMode]);
  // A new item registered from this screen comes back selected, ready for its quantity.
  useEffect(() => { if (picked && !batching) { setPart(picked); setCandidates([]); setPhotoId(""); setQuantity(1); setError(""); } }, [picked]);

  const reset = (message = "") => {
    setPart(null); setCandidates([]); setPhotoId("");
    setQuantity(1); setSearch(""); setError(""); setDone(message); commandKey.current = key(); if (!message) setNote(null);
  };
  const low = (p: Item, left: number) => p.reorder_level != null && Number(p.reorder_level) > 0 && left <= Number(p.reorder_level);
  // Every counter entry can be taken back for a few seconds: it records the opposite movement, so the history stays honest.
  const offerUndo = (label: string, run: () => Promise<unknown>) => toast(label, { ms: 8000, action: { label: t("Undo"), run: () => { run().then(() => { onChanged(); toast(t("Undone.")); }).catch((e) => toast((e as Error).message, { bad: true })); } } });
  const switchMode = (next: Mode) => { setMode(next); reset(); };

  const onQR = useCallback((value: string) => {
    setCamera(false);
    // a shelf label opens that shelf on the map
    const shelf = parseShelfCode(value);
    if (shelf) { try { sessionStorage.setItem(SHELF_FOCUS, "id:" + shelf.rack + ":" + shelf.level); } catch { /* ignore */ } window.dispatchEvent(new Event("lifta:open-shelf")); return; }
    const found = partFromCode(value, items);
    if (found) { setPart(found); setCandidates([]); setPhotoId(""); setError(""); }
    else setError(t("This QR is not a stock item. Take a photo of the part instead."));
  }, [items]);
  const identifyPhoto = async (file?: File) => {
    if (!file) return;
    setCamera(false);
    setBusy(true); setError(""); setDone(""); setPart(null); setCandidates([]);
    try {
      const form = new FormData(); form.append("file", await shrink(file));
      const qr = await api<{ value: string | null }>("/api/vision/qr", { method: "POST", body: form });
      if (qr.value) { onQR(qr.value); return; }
      const match = await api<Match>("/api/vision/match", { method: "POST", body: form });
      const known = match.candidates.map((c) => items.find((i) => i.id === c.product.id)).filter((i): i is Item => !!i).slice(0, 3);
      setPhotoId(match.imageId); setCandidates(known);
      if (!known.length) setError(mode === "receive" ? t("No match from the photo. Search below, or add it as a new item.") : t("No match from the photo. Search for the part below."));
    } catch (e) { setError((e as Error).message); }
    finally { setBusy(false); }
  };
  const step = (delta: number, max?: number) => setQuantity((q) => Math.max(1, Math.min(max ?? 9999, q + delta)));

  const give = async () => {
    if (!part) return;
    setBusy(true); setError("");
    try {
      const job = jobs.find((x) => x.id === jobId);
      if (job) await api("/api/workshop/jobs/" + job.id + "/stock", { method: "POST", body: JSON.stringify({ productId: part.id, quantity, op: "use" }) }, commandKey.current);
      else {
        const out = await api<{ id: string; doc_no?: string }>("/api/inventory/movements", { method: "POST", body: JSON.stringify({ kind: "STOCK_OUT", productId: part.id, quantity, note: "Issued at the storeroom counter" }) }, commandKey.current);
        if (out?.doc_no) setNote({ id: out.id, no: out.doc_no });
      }
      try { if (job) sessionStorage.setItem("lifta.counter.job", JSON.stringify({ id: job.id, at: Date.now() })); else sessionStorage.removeItem("lifta.counter.job"); } catch { /* ignore */ }
      if (photoId) {
        // A confirmed photo becomes a reference and future training data for the photo model.
        try { await api("/api/vision/references", { method: "POST", body: JSON.stringify({ productId: part.id, imageId: photoId }) }); } catch { /* the movement is already recorded */ }
      }
      const left = Number(part.quantity) - quantity, undoQty = quantity, undoPart = part;
      onChanged(); reset(t("Recorded: {q} × {name} taken out.", { q: amount(quantity), name: part.name }) + (job ? " " + t("Added to the bill of {job}.", { job: job.registration }) : "") + (low(part, left) ? " " + t("Running low: {n} left.", { n: amount(Math.max(0, left)) }) : ""));
      offerUndo(t("{q} × {name} taken out.", { q: amount(undoQty), name: undoPart.name }), () => job
        ? api("/api/workshop/jobs/" + job.id + "/stock", { method: "POST", body: JSON.stringify({ productId: undoPart.id, quantity: undoQty, op: "return" }) }, key())
        : api("/api/inventory/movements", { method: "POST", body: JSON.stringify({ kind: "RECEIPT", productId: undoPart.id, quantity: undoQty, note: "Undo of a counter entry" }) }, key()));
    } catch (e) { setError((e as Error).message); commandKey.current = key(); }
    finally { setBusy(false); }
  };
  const onBarcode = async (value: string) => {
    setCamera(false); setBusy(true); setError(""); setDone("");
    const found = items.find((item) => item.barcode === value);
    if (found) {
      setPart(found); setCandidates([]); setPhotoId(""); setBusy(false); return;
    }
    try {
      const result = await api<BarcodeLookup>("/api/vision/barcodes/" + encodeURIComponent(value));
      setDone(result.found
        ? t("Barcode found externally. Review the suggested details manually before registering.")
        : t("Barcode {code} is not in the catalogue. Enter the item details manually.", { code: value }));
      if (mode === "receive" && onBarcodeSuggestion) {
        onBarcodeSuggestion(value, result.suggestions);
      }
      setSearch(value);
    } catch (e) { setError((e as Error).message); }
    finally { setBusy(false); }
  };
  const receive = async () => {
    if (!part) return;
    setBusy(true); setError("");
    try {
      const res = await api<{ id: string; doc_no?: string }>("/api/inventory/movements", { method: "POST", body: JSON.stringify({ kind: "RECEIPT", productId: part.id, quantity, note: "Received at the counter", ...(supplierId ? { supplierId } : { supplier: supplier.trim() || undefined }), reference: reference.trim() || undefined, unitCost: cost.trim() || undefined, ...(supplierId ? { terms } : {}) }) }, commandKey.current);
      if (res?.doc_no) setNote({ id: res.id, no: res.doc_no });
      try { if (supplier.trim()) sessionStorage.setItem("lifta.supplier", supplier.trim()); sessionStorage.setItem("lifta.supplierId", supplierId); } catch { /* ignore */ }
      setReference(""); setCost("");
      if (photoId) {
        try { await api("/api/vision/references", { method: "POST", body: JSON.stringify({ productId: part.id, imageId: photoId }) }); } catch { /* the receipt is already recorded */ }
      }
      const undoQty = quantity, undoPart = part;
      onChanged(); reset(t("Recorded: {q} × {name} added to stock.", { q: amount(quantity), name: part.name }));
      offerUndo(t("{q} × {name} added.", { q: amount(undoQty), name: undoPart.name }), () => api("/api/inventory/movements", { method: "POST", body: JSON.stringify({ kind: "STOCK_OUT", productId: undoPart.id, quantity: undoQty, note: "Undo of a counter entry" }) }, key()));
    } catch (e) { setError((e as Error).message); commandKey.current = key(); }
    finally { setBusy(false); }
  };
  const matches = search.trim().length >= 2 ? items.filter((i) => (i.name + " " + i.sku + " " + i.brand + " " + (i.part_number || "")).toLowerCase().includes(search.trim().toLowerCase())).slice(0, 20) : [];
  // Parts that moved lately in this direction, newest first: the quickest way back to what the shop handles every day.
  const recent = (() => {
    const kinds = mode === "receive" ? ["RECEIPT", "RETURN", "OPENING"] : ["ISSUE", "STOCK_OUT"];
    const seen = new Set<string>(), out: { item: Item; qty: number }[] = [];
    for (const m of [...moves].filter((x) => kinds.includes(x.kind)).sort((a, b) => (a.created_at < b.created_at ? 1 : -1))) {
      if (seen.has(m.product_id)) continue;
      const item = items.find((i) => i.id === m.product_id && !i.archived);
      if (!item) continue;
      seen.add(m.product_id); out.push({ item, qty: Number(m.quantity) });
      if (out.length >= 6) break;
    }
    return out;
  })();
  // With nothing typed, the dropdown lists the parts that moved lately first, then the rest A to Z, each with its photo.
  const browse = (() => {
    const first = recent.map((r) => r.item), seen = new Set(first.map((i) => i.id));
    const rest = items.filter((i) => !i.archived && !seen.has(i.id) && (mode === "receive" || Number(i.quantity) > 0)).sort((a, b) => a.name.localeCompare(b.name));
    return [...first, ...rest].slice(0, 30);
  })();
  const shownList = search.trim().length >= 2 ? matches : listOpen ? browse : [];
  const choosePart = (item: Item) => { setListOpen(false); setSearch(""); setPart(item); setCandidates([]); setPhotoId(""); setError(""); };
  return (
    <section className="counter-screen" aria-label={t("Parts counter")}>
      <div className="counter-modes" role="tablist">
        {(([["receive", t("Part came in")], ["give", t("Part went out")]]) as [Mode, string][]).map(([m, label]) => (
          <button key={m} data-tour={"tab-" + m} role="tab" aria-selected={mode === m} className={mode === m ? "chosen " + m : m} onClick={() => switchMode(m)}>{label}</button>
        ))}
      </div>
      {done && <p className="counter-done" role="status"><Check size={20} /> {done}{note && <> <button type="button" className="doc-link" data-tour="counter-note" onClick={() => void openPdf("/api/inventory/movements/" + note.id + "/note.pdf", note.no + ".pdf").catch((e) => toast((e as Error).message, { bad: true }))}>{note.no} · {t("Print note")}</button></>}</p>}
      {error && (
        <div className="stock-error stock-error-toast" role="alert">
          <strong>{t("Could not complete that action")}</strong>
          <span>{error}</span>
          <button className="toast-close" aria-label="Dismiss error" onClick={() => setError("")}>×</button>
        </div>
      )}
      {(
        <div className="ws-seg counter-style" role="group" aria-label={t("How parts come in")} data-tour="counter-style">
          {([["one", t("One by one")], ["batch", t("Batch")]] as ["one" | "batch", string][]).map(([k, l]) => <button type="button" key={k} className={style === k ? "on" : ""} aria-pressed={style === k} onClick={() => chooseStyle(k)}>{l}</button>)}
        </div>
      )}
      {leaving && (
        <div className="counter-candidates" role="alert">
          <p>{t("Your batch list has {n} parts that are not saved yet.", { n: mode === "receive" ? batchSize() : batchOutSize() })}</p>
          <button type="button" onClick={() => setStyle("one")}>{t("Keep the list and switch")}</button>
          <button type="button" onClick={() => { if (mode === "receive") clearBatch(); else clearBatchOut(); setStyle("one"); }}>{t("Throw the list away")}</button>
          <button type="button" onClick={() => setLeaving(false)}>{t("Stay on the batch")}</button>
        </div>
      )}
      {batching && mode === "receive" && <BatchIn items={items} picked={picked} photo={photo} onNewItem={onNewItem} onChanged={onChanged} />}
      {batching && mode === "give" && <BatchOut items={items} photo={photo} onChanged={onChanged} />}
      {!batching && (
        <>
          <div className="counter-step">
            <h2><span>1</span> {mode === "receive" ? t("Which part came in?") : t("Which part?")}</h2>
            {part ? (
              <div className="counter-chosen"><strong>{part.name}{low(part, Number(part.quantity)) && <span className="counter-lowchip" data-testid="counter-low">{t("Running low")}</span>}</strong><small>{t("Part no.")} {part.part_number || t("Not set")} · {t("System no.")} {part.sku} · {amount(Number(part.quantity))} {t("in stock")}{part.location ? " · " + part.location : ""}</small><button onClick={() => { setPart(null); setPhotoId(""); }}>{t("Change")}</button></div>
            ) : (
              <>
                <button data-tour="open-camera" className="counter-big wide" disabled={busy} onClick={() => setCamera(true)}><CameraIcon size={30} /> {busy ? t("Checking the photo…") : t("Open camera")}</button>
                <p className="stock-help">{t("Scan a Lifta QR or original product barcode. You can also take a photo or search manually.")}</p>
                {candidates.length > 0 && (
                  <div className="counter-candidates">
                    <p>{t("Is it one of these?")}</p>
                    {candidates.map((c) => <button key={c.id} onClick={() => choosePart(c)}><strong>{c.name}</strong><small>{t("Part no.")} {c.part_number || t("Not set")} · {t("System no.")} {c.sku}{c.location ? " · " + c.location : ""}</small></button>)}
                  </div>
                )}
                {mode === "receive" && photoId && onNewItem && (
                  <button data-tour="add-new" className="counter-new" disabled={starting} aria-busy={starting} onClick={() => { setStarting(true); void Promise.resolve(onNewItem(photoId)).finally(() => setStarting(false)); }}>{starting ? <Loader2 size={20} className="spin" /> : <Plus size={20} />} {starting ? t("Reading the label…") : candidates.length ? t("None of these: add as a new item") : t("Add as a new item (reads the label)")}</button>
                )}
                {recent.length > 0 && !search.trim() && (
                  <div className="counter-recent" data-testid="counter-recent">
                    <p>{mode === "receive" ? t("Recently added") : t("Recently taken out")}</p>
                    <div>
                      {recent.map((r) => (
                        <button key={r.item.id} type="button" className="counter-recent-chip" disabled={busy} onClick={() => choosePart(r.item)}>
                          <strong>{r.item.name}</strong>
                          <small>{[r.item.brand, r.item.part_number].filter(Boolean).join(" · ") || r.item.sku} · {t("last")} {amount(r.qty)}</small>
                        </button>
                      ))}
                    </div>
                  </div>
                )}
                <div className="counter-combo" ref={comboRef}>
                <label data-tour="counter-search" className="stock-field counter-search">{t("Or search")}<input value={search} placeholder={t("Oil filter") + " (" + t("or tap to see all parts") + ")"} onFocus={() => setListOpen(true)} onChange={(e) => { setSearch(e.target.value); setListOpen(true); }} /></label>
                <div className="counter-list">
                  {shownList.map((m) => <button key={m.id} className="counter-result" onClick={() => choosePart(m)}>{photo && <span className="counter-result-photo">{photo(m)}</span>}<span className="counter-result-text">{m.name} <small>{t("Part no.")} {m.part_number || t("Not set")} · {t("In stock")} {amount(Number(m.quantity))}</small></span></button>)}
                </div>
                </div>
                {search.trim().length >= 2 && !matches.length && <p className="stock-help">{t("No part matches \"{q}\".", { q: search.trim() })}</p>}
              </>
            )}
          </div>
          {part && (
            <div className="counter-step">
              <h2><span>2</span> {t("How many?")}</h2>
              <div className="counter-stepper">
                <button aria-label="One less" onClick={() => step(-1)}><Minus /></button>
                <input aria-label="Quantity" type="number" min={part.unit === "LITRE" ? 0.001 : 1} step={part.unit === "LITRE" ? 0.001 : 1} value={quantity} onChange={(e) => setQuantity(Number(e.target.value))} />
                <button aria-label="One more" onClick={() => step(1)}><Plus /></button>
                <span>{part.unit === "LITRE" ? t("litres") : t("pieces")}</span>
              </div>
              {part.unit !== "LITRE" && (
                <div className="counter-qtyquick">
                  {[5, 10, 20].map((n) => <button key={n} type="button" onClick={() => step(n)}>+{n}</button>)}
                </div>
              )}
            </div>
          )}
          {part && mode === "give" && (
            <div className="counter-step counter-job">
              <h2><span>3</span> {t("Which job is it for?")} <small>({t("optional")})</small></h2>
              <select aria-label={t("Which job is it for?")} value={jobId} disabled={busy} onChange={(e) => setJobId(e.target.value)}>
                <option value="">{t("No job, just take it out of stock")}</option>
                {jobs.map((j) => <option key={j.id} value={j.id}>{j.registration} · {j.customer}</option>)}
              </select>
              <small className="stock-help">{jobId ? t("The part goes on this job's bill at its selling price.") : t("No recipient details are required. Confirm the quantity leaving the storeroom.")}</small>
            </div>
          )}
          {part && mode === "receive" && (
            <div className="counter-step counter-grn" data-tour="counter-grn">
              <h2><span>3</span> {t("Goods received note")} <small>({t("optional")})</small></h2>
              <div className="ws-grid2">
                <SupplierPick id={supplierId} name={supplier} disabled={busy} onChange={pickSupplier} />
                <label className="ws-field">{t("Supplier invoice or delivery no.")}<input value={reference} maxLength={60} disabled={busy} onChange={(e) => setReference(e.target.value)} placeholder="DN-1234" /></label>
              </div>
              <label className="ws-field">{t("Cost price per unit (LKR)")} <small>({t("optional")})</small><input value={cost} inputMode="decimal" maxLength={12} disabled={busy} onChange={(e) => setCost(e.target.value.replace(/[^0-9.]/g, ""))} placeholder="1350.00" /></label>
              {supplierId && (
                <div className="ws-field" role="group" aria-label={t("Payment")}>{t("Payment")}
                  <div className="ws-seg">{([["PAID", t("Paid now")], ["CREDIT", t("On credit")]] as [string, string][]).map(([k, l]) => <button type="button" key={k} className={terms === k ? "on" : ""} aria-pressed={terms === k} disabled={busy} onClick={() => setTerms(k as "PAID" | "CREDIT")}>{l}</button>)}</div>
                  {terms === "CREDIT" && !cost.trim() && <small className="stock-error">{t("Enter the cost price so we know how much is owed.")}</small>}
                </div>
              )}
              <small className="stock-help">{t("What the supplier charged for one. Only the owner can see this price later.")} {t("A GRN number is made for this entry. You can print the note after saving.")}</small>
            </div>
          )}
          {part && mode === "receive" && (
            <button className="button primary counter-confirm" disabled={busy || !(quantity > 0) || (mode === "receive" && !!supplierId && terms === "CREDIT" && !cost.trim())} onClick={() => void receive()}>
              {busy ? t("Saving…") : t("Add {q} × {name} to stock", { q: amount(quantity), name: part.name })}
            </button>
          )}
          {part && mode === "give" && (
            <button className="button primary counter-confirm" disabled={busy || !(quantity > 0)} onClick={() => void give()}>
              {busy ? t("Saving…") : jobId ? t("Put {q} × {name} on the job", { q: amount(quantity), name: part.name }) : t("Record {q} × {name} leaving stock", { q: amount(quantity), name: part.name })}
            </button>
          )}
        </>
      )}

      {camera && (
        <React.Suspense fallback={null}>
          <Camera onQR={onQR} onBarcode={(value) => void onBarcode(value)} onPhoto={(f) => void identifyPhoto(f)} onClose={() => setCamera(false)} />
        </React.Suspense>
      )}
      {part && <button className="counter-restart" onClick={() => reset()}><ArrowLeft size={16} /> {t("Scan another item")}</button>}
    </section>
  );
}
