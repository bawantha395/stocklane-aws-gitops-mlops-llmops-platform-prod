import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Camera as CameraIcon, Check, Loader2, Minus, Plus, Trash2 } from "lucide-react";
import { t } from "./i18n";
import { toast } from "./ui";
import { can } from "./perms";
import { api, openPdf, type Product } from "./api";

const Camera = React.lazy(() => import("./Camera").then((m) => ({ default: m.Camera })));

type Item = Product & { part_number?: string; location?: string; archived?: boolean };
type Who = "JOB" | "PERSON" | "NONE";
type Line = { id: string; productId: string; qty: number };
type Draft = { who: Who; jobId: string; personId: string; lines: Line[]; pending: { key: string; body: string } | null };
type Job = { id: string; registration: string; customer: string; status: string };
type Person = { id: string; name: string; active?: boolean };
type Result = { kind: "JOB" | "NOTE"; jobId?: string; reg?: string; noteId?: string; docNo?: string; lines: { productId: string; qty: number }[] };

const STORE = "lifta.batch.out";
const JOB_MAX = 12, NOTE_MAX = 15; // a job holds 12 stock parts; one note holds 15
const PART_QR = /^stocklane:v1:([0-9a-f-]{36})$/;
const uid = () => (typeof crypto.randomUUID === "function" ? crypto.randomUUID() : Date.now().toString(36) + Math.random().toString(36).slice(2));
const amount = (n: number) => new Intl.NumberFormat("en", { maximumFractionDigits: 3 }).format(n);
const empty = (): Draft => ({ who: "JOB", jobId: "", personId: "", lines: [], pending: null });
const load = (): Draft => { try { const d = JSON.parse(localStorage.getItem(STORE) || "null"); return d && Array.isArray(d.lines) ? { ...empty(), ...d } : empty(); } catch { return empty(); } };
export const batchOutSize = () => load().lines.length;
export const clearBatchOut = () => { try { localStorage.removeItem(STORE); } catch { /* ignore */ } };

/** Parts that go out together: pick the job (or the person who takes them) first, scan the parts, check the list, save once. */
export function BatchOut({ items, onChanged, photo, manual }: { manual?: boolean; items: Item[]; onChanged: () => void; photo?: (item: Item) => React.ReactNode }) {
  const [d, setD] = useState<Draft>(load);
  const [jobs, setJobs] = useState<Job[]>([]), [people, setPeople] = useState<Person[]>([]);
  const [camera, setCamera] = useState(false), [busy, setBusy] = useState(false), [error, setError] = useState(""), [lost, setLost] = useState<string[]>([]);
  const [search, setSearch] = useState(""), [last, setLast] = useState(""), [result, setResult] = useState<Result[]>([]), [ordered, setOrdered] = useState<Record<string, boolean>>({});
  const byId = useMemo(() => new Map(items.map((i) => [i.id, i])), [items]);
  useEffect(() => { try { if (d.lines.length) localStorage.setItem(STORE, JSON.stringify(d)); else localStorage.removeItem(STORE); } catch { /* ignore */ } }, [d]);
  useEffect(() => {
    let live = true;
    api<Job[]>("/api/workshop/jobs").then((r) => live && setJobs(r.filter((x) => x.status === "OPEN"))).catch(() => live && setJobs([]));
    api<Person[]>("/api/inventory/people").then((r) => live && setPeople(r.filter((x) => x.active !== false))).catch(() => live && setPeople([]));
    return () => { live = false; };
  }, []);

  const lines = d.lines.filter((l) => byId.has(l.productId));
  const set = (patch: Partial<Draft>) => setD((x) => ({ ...x, ...patch, pending: null }));
  const buzz = () => { try { navigator.vibrate?.(40); } catch { /* ignore */ } };
  const addPart = useCallback((item: Item) => {
    if (item.archived) { setError(t("{name} is archived. Restore it first.", { name: item.name })); return; }
    setError(""); setSearch(""); setLast(item.name); buzz();
    setD((x) => {
      const at = x.lines.findIndex((l) => l.productId === item.id);
      return { ...x, pending: null, lines: at >= 0 ? x.lines.map((l, i) => (i === at ? { ...l, qty: l.qty + 1 } : l)) : [...x.lines, { id: uid(), productId: item.id, qty: 1 }] };
    });
  }, []);
  const itemsRef = useRef(items); itemsRef.current = items;
  const add = useRef(addPart); add.current = addPart;
  const onCode = useCallback((value: string, qr: boolean) => {
    const v = value.trim(), id = qr ? PART_QR.exec(v)?.[1] : undefined;
    const found = qr ? itemsRef.current.find((p) => p.id === id) : itemsRef.current.find((p) => p.barcode === v);
    if (found) add.current(found); else setLost((x) => (x.includes(v) ? x : [...x.slice(-4), v]));
  }, []);
  const onQR = useCallback((v: string) => onCode(v, true), [onCode]);
  const onBar = useCallback((v: string) => onCode(v, false), [onCode]);

  const change = (id: string, qty: number) => set({ lines: d.lines.map((l) => (l.id === id ? { ...l, qty } : l)) });
  const matches = search.trim().length >= 2 ? items.filter((i) => !i.archived && Number(i.quantity) > 0 && (i.name + " " + i.sku + " " + i.brand + " " + (i.part_number || "")).toLowerCase().includes(search.trim().toLowerCase())).slice(0, 8) : [];
  const short = (l: Line) => l.qty - Number(byId.get(l.productId)?.quantity ?? 0); // more than there is: the line goes red and Save waits
  const anyShort = lines.some((l) => short(l) > 0);
  const target = d.who === "JOB" ? !!d.jobId : d.who === "PERSON" ? !!d.personId : true;
  const per = d.who === "JOB" ? JOB_MAX : NOTE_MAX;
  const jobOf = (id: string) => jobs.find((j) => j.id === id);

  const orderThis = async (l: Line) => {
    try {
      await api("/api/inventory/wants", { method: "POST", body: JSON.stringify({ productId: l.productId, quantity: Math.max(1, short(l)), ...(d.who === "JOB" && d.jobId ? { jobId: d.jobId } : {}) }) }, uid());
      setOrdered((o) => ({ ...o, [l.productId]: true })); toast(t("Added to the To order list."));
    } catch (e) { setError((e as Error).message); }
  };

  const payload = (chunk: Line[]) => JSON.stringify(d.who === "JOB"
    ? { lines: chunk.map((l) => ({ productId: l.productId, quantity: l.qty })) }
    : { kind: "STOCK_OUT", note: "Issued at the storeroom counter (batch)", ...(d.who === "PERSON" ? { receiverId: d.personId } : {}), lines: chunk.map((l) => ({ productId: l.productId, quantity: l.qty })) });
  // Save: a job takes 12 parts per save, a note 15; several saves run one after the other. An unanswered save is sent again with the same key.
  const save = async () => {
    if (!lines.length || busy || anyShort || !target) return;
    setBusy(true); setError("");
    const done: Result[] = [];
    try {
      let rest = lines, pending = d.pending;
      while (rest.length) {
        const chunk = rest.slice(0, per), b = payload(chunk);
        const p = pending && pending.body === b ? pending : { key: uid(), body: b };
        pending = p; setD((x) => ({ ...x, pending: p }));
        const out = chunk.map((l) => ({ productId: l.productId, qty: l.qty }));
        if (d.who === "JOB") {
          await api("/api/workshop/jobs/" + d.jobId + "/stock-batch", { method: "POST", body: b }, p.key);
          done.push({ kind: "JOB", jobId: d.jobId, reg: jobOf(d.jobId)?.registration, lines: out });
        } else {
          const res = await api<{ id: string; doc_no: string }>("/api/inventory/documents", { method: "POST", body: b }, p.key);
          done.push({ kind: "NOTE", noteId: res.id, docNo: res.doc_no, lines: out });
        }
        pending = null;
        const gone = new Set(chunk.map((l) => l.id)); rest = rest.filter((l) => !gone.has(l.id));
        setD((x) => ({ ...x, lines: x.lines.filter((l) => !gone.has(l.id)), pending: null }));
      }
      setResult(done); setOrdered({});
      const parts = done.reduce((n, r) => n + r.lines.length, 0);
      toast(t("{n} parts taken out.", { n: parts }), { ms: 8000, action: { label: t("Undo"), run: () => { void undo(done); } } });
    } catch (e) {
      setError((e as Error).message + (done.length ? " " + t("{n} save(s) went through. The rest of the list is still here: press Save to continue.", { n: done.length }) : " " + t("Nothing was saved. Press Save to try again.")));
      if (done.length) setResult(done);
    } finally { setBusy(false); onChanged(); }
  };
  const undo = async (done: Result[]) => {
    try {
      for (const r of done) for (const l of r.lines) {
        if (r.kind === "JOB") await api("/api/workshop/jobs/" + r.jobId + "/stock", { method: "POST", body: JSON.stringify({ productId: l.productId, quantity: l.qty, op: "return" }) }, uid());
        else await api("/api/inventory/movements", { method: "POST", body: JSON.stringify({ kind: "RECEIPT", productId: l.productId, quantity: l.qty, note: "Undo of a batch entry" }) }, uid());
      }
      setResult([]); onChanged(); toast(t("Undone."));
    } catch (e) { toast((e as Error).message, { bad: true }); }
  };

  return (
    <div className="bi" data-tour="batch-out">
      {error && <div className="stock-error stock-error-toast" role="alert"><strong>{t("Could not complete that action")}</strong><span>{error}</span><button className="toast-close" aria-label="Dismiss error" onClick={() => setError("")}>×</button></div>}
      {result.length > 0 && lines.length === 0 && (
        <p className="counter-done" role="status"><Check size={20} /> {t("Saved.")} {result.map((r, i) => r.kind === "JOB"
          ? <span key={i}>{t("Added to the bill of {job}.", { job: r.reg || "" })} </span>
          : <button key={i} type="button" className="doc-link" onClick={() => void openPdf("/api/inventory/movements/" + r.noteId + "/note.pdf", r.docNo + ".pdf").catch((e) => toast((e as Error).message, { bad: true }))}>{r.docNo} · {t("Print note")}</button>)}</p>
      )}
      <div className="counter-step">
        <h2><span>1</span> {t("Who is it for?")}</h2>
        <div className="ws-seg" role="group" aria-label={t("Who is it for?")}>
          {([["JOB", t("A job")], ["PERSON", t("A person")], ["NONE", t("No one")]] as [Who, string][]).map(([k, l]) => <button type="button" key={k} className={d.who === k ? "on" : ""} aria-pressed={d.who === k} disabled={busy} onClick={() => set({ who: k })}>{l}</button>)}
        </div>
        {d.who === "JOB" && (
          <select aria-label={t("Which job is it for?")} value={d.jobId} disabled={busy} onChange={(e) => set({ jobId: e.target.value })}>
            <option value="">{t("Choose the job")}</option>
            {jobs.map((j) => <option key={j.id} value={j.id}>{j.registration} · {j.customer}</option>)}
          </select>
        )}
        {d.who === "PERSON" && (
          <select aria-label={t("Who takes the parts?")} value={d.personId} disabled={busy} onChange={(e) => set({ personId: e.target.value })}>
            <option value="">{t("Choose the person")}</option>
            {people.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
        )}
        <small className="stock-help">{d.who === "JOB" ? t("The parts go on this job's bill at their selling price.") : d.who === "PERSON" ? t("A note is made with this person's name.") : t("A note is made. No job and no person.")}</small>
      </div>

      <div className="counter-step">
        <h2><span>2</span> {t("Add the parts")}</h2>
        {!manual && <button className="counter-big wide" disabled={busy || !target} onClick={() => setCamera(true)}><CameraIcon size={30} /> {t("Scan the parts, one after another")}</button>}
        {!target && <p className="stock-help">{d.who === "JOB" ? t("Choose the job first.") : t("Choose the person first.")}</p>}
        {lost.length > 0 && (
          <div className="counter-candidates" role="status"><p>{t("Not recognised")}: {lost.join(", ")}</p><button type="button" onClick={() => { setSearch(lost[lost.length - 1]); setLost([]); }}>{t("Search for it")}</button><button type="button" onClick={() => setLost([])}>{t("Dismiss")}</button></div>
        )}
        <label className="stock-field counter-search">{t("Or search")}<input value={search} placeholder={t("Oil filter")} onChange={(e) => setSearch(e.target.value)} /></label>
        {matches.length > 0 && <div className="counter-list">{matches.map((m) => <button key={m.id} className="counter-result" onClick={() => addPart(m)}>{photo && <span className="counter-result-photo">{photo(m)}</span>}<span className="counter-result-text">{m.name} <small>{t("Part no.")} {m.part_number || t("Not set")} · {t("In stock")} {amount(Number(m.quantity))}</small></span></button>)}</div>}
        {search.trim().length >= 2 && !matches.length && <p className="stock-help">{t("No part in stock matches \"{q}\".", { q: search.trim() })}</p>}
      </div>

      <div className="counter-step">
        <h2><span>3</span> {t("The list")} <small>({lines.length})</small></h2>
        {lines.length === 0 ? <p className="stock-help">{t("Nothing on the list yet.")}</p> : (
          <ul className="bi-lines">
            {lines.map((l) => {
              const p = byId.get(l.productId)!, lack = short(l);
              return (
                <li key={l.id} className={"bi-line bo-line" + (lack > 0 ? " bo-short" : "")}>
                  <div className="bi-name"><strong>{p.name}</strong><small>{p.part_number || p.sku} · {t("in stock")} {amount(Number(p.quantity))}{p.location ? " · " + p.location : ""}</small></div>
                  <div className="counter-stepper bi-qty">
                    <button type="button" aria-label="One less" disabled={busy || l.qty <= 1} onClick={() => change(l.id, Math.max(1, l.qty - 1))}><Minus /></button>
                    <input aria-label="Quantity" type="number" inputMode="decimal" min={p.unit === "LITRE" ? 0.001 : 1} step={p.unit === "LITRE" ? 0.001 : 1} value={l.qty} disabled={busy} onChange={(e) => change(l.id, Number(e.target.value))} />
                    <button type="button" aria-label="One more" disabled={busy} onClick={() => change(l.id, l.qty + 1)}><Plus /></button>
                  </div>
                  <button type="button" className="bi-del" aria-label={t("Remove")} disabled={busy} onClick={() => set({ lines: d.lines.filter((x) => x.id !== l.id) })}><Trash2 size={18} /></button>
                  {lack > 0 && (
                    <p className="bo-warn" role="alert">{t("Only {n} in stock.", { n: amount(Number(p.quantity)) })} {can("job_stock") && (ordered[l.productId] ? <b>{t("On the To order list")}</b> : <button type="button" className="button secondary small" onClick={() => void orderThis(l)}>{t("Order this")}</button>)}</p>
                  )}
                </li>
              );
            })}
          </ul>
        )}
        {lines.length > per && <p className="stock-help" role="status">{d.who === "JOB" ? t("A job takes {n} parts at a time: this saves in {g} steps.", { n: per, g: Math.ceil(lines.length / per) }) : t("More than {n} parts: this saves as {g} notes, one after the other.", { n: per, g: Math.ceil(lines.length / per) })}</p>}
        <button className="button primary counter-confirm" disabled={busy || !lines.length || anyShort || !target || lines.some((l) => !(l.qty > 0))} onClick={() => void save()}>
          {busy ? <><Loader2 size={18} className="spin" /> {t("Saving…")}</> : t("Take out {n} parts", { n: lines.length })}
        </button>
        {lines.length > 0 && !busy && <button type="button" className="stock-link" onClick={() => setD(empty())}>{t("Clear the list")}</button>}
      </div>

      {camera && (
        <React.Suspense fallback={null}>
          <Camera continuous status={last ? t("Added: {name} · {n} on the list", { name: last, n: lines.length }) : undefined} onQR={onQR} onBarcode={onBar} onPhoto={() => { setCamera(false); setError(t("Use the QR or barcode, or search for the part.")); }} onClose={() => setCamera(false)} />
        </React.Suspense>
      )}
    </div>
  );
}
