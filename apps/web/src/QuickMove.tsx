import { useEffect, useRef, useState } from "react";
import { Check, Minus, Plus } from "lucide-react";
import { t, useLang } from "./i18n";
import { toast } from "./ui";
import { SupplierPick, useSuppliers } from "./Suppliers";
import { can } from "./perms";
import { api, type Product } from "./api";

type Item = Product & { part_number?: string; location?: string };
const key = () => crypto.randomUUID();
const amount = (n: number) => new Intl.NumberFormat("en", { maximumFractionDigits: 3 }).format(n);

/** One small box to put a part in or take it out: how many, (the job), save. No counter screen, no steps in between. */
export function QuickMove({ part, mode, onClose, onChanged }: { part: Item; mode: "give" | "receive"; onClose: () => void; onChanged: () => void }) {
  useLang();
  const litre = part.unit === "LITRE";
  const [qty, setQty] = useState("1"), [busy, setBusy] = useState(false), [error, setError] = useState("");
  const q = Number(qty), ok = Number.isFinite(q) && q > 0 && (mode === "receive" || q <= Number(part.quantity));
  const cmd = useRef(key()), inRef = useRef<HTMLInputElement>(null);
  useEffect(() => { inRef.current?.focus(); inRef.current?.select(); }, []);
  useEffect(() => { const esc = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); }; window.addEventListener("keydown", esc); return () => window.removeEventListener("keydown", esc); }, [onClose]);
  const bump = (n: number) => setQty(String(Math.max(litre ? 0.1 : 1, Math.round((q + n) * 1000) / 1000)));
  // take out: can go straight onto an open job's bill
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
  // put in: supplier and cost are there if wanted, folded away if not
  const [supplier, setSupplier] = useState(part.supplier || ""), [supplierId, setSupplierId] = useState(part.supplier_id || ""), [reference, setReference] = useState(""), [cost, setCost] = useState(""), [terms, setTerms] = useState<"PAID" | "CREDIT">("PAID");
  const { list: supplierList } = useSuppliers();
  const seeCost = can("see_cost");
  const pick = (v: { id: string; name: string }) => { setSupplierId(v.id); setSupplier(v.name); const s = (supplierList || []).find((x) => x.id === v.id); setTerms(s && s.credit_days > 0 ? "CREDIT" : "PAID"); };
  const needCost = mode === "receive" && seeCost && !!supplierId && terms === "CREDIT" && !cost.trim();

  const save = async () => {
    if (!ok || busy || needCost) return;
    setBusy(true); setError("");
    try {
      let noteNo = "", jobName = "";
      if (mode === "give") {
        const job = jobs.find((x) => x.id === jobId);
        if (job) { await api("/api/workshop/jobs/" + job.id + "/stock", { method: "POST", body: JSON.stringify({ productId: part.id, quantity: q, op: "use" }) }, cmd.current); jobName = job.registration; try { sessionStorage.setItem("lifta.counter.job", JSON.stringify({ id: job.id, at: Date.now() })); } catch { /* ignore */ } }
        else {
          const out = await api<{ id: string; doc_no?: string }>("/api/inventory/movements", { method: "POST", body: JSON.stringify({ kind: "STOCK_OUT", productId: part.id, quantity: q, note: "Issued from the parts list" }) }, cmd.current);
          noteNo = out?.doc_no || "";
          try { sessionStorage.removeItem("lifta.counter.job"); } catch { /* ignore */ }
        }
      } else {
        const res = await api<{ id: string; doc_no?: string }>("/api/inventory/movements", { method: "POST", body: JSON.stringify({ kind: "RECEIPT", productId: part.id, quantity: q, note: "Received from the parts list", ...(supplierId ? { supplierId, terms } : { supplier: supplier.trim() || undefined }), reference: reference.trim() || undefined, unitCost: seeCost ? cost.trim() || undefined : undefined }) }, cmd.current);
        noteNo = res?.doc_no || "";
        try { if (supplier.trim()) { sessionStorage.setItem("lifta.supplier", supplier.trim()); sessionStorage.setItem("lifta.supplierId", supplierId); } } catch { /* ignore */ }
      }
      onChanged();
      const undo = () => (mode === "give"
        ? (jobId ? api("/api/workshop/jobs/" + jobId + "/stock", { method: "POST", body: JSON.stringify({ productId: part.id, quantity: q, op: "return" }) }, key()) : api("/api/inventory/movements", { method: "POST", body: JSON.stringify({ kind: "RECEIPT", productId: part.id, quantity: q, note: "Undo of a stock-out" }) }, key()))
        : api("/api/inventory/movements", { method: "POST", body: JSON.stringify({ kind: "STOCK_OUT", productId: part.id, quantity: q, note: "Undo of a receipt" }) }, key()));
      toast((mode === "give" ? t("{q} × {name} taken out.", { q: amount(q), name: part.name }) : t("{q} × {name} added.", { q: amount(q), name: part.name })) + (jobName ? " " + t("Added to the bill of {job}.", { job: jobName }) : "") + (noteNo ? " " + noteNo : ""), { ms: 8000, action: { label: t("Undo"), run: () => { undo().then(() => { onChanged(); toast(t("Undone.")); }).catch((e) => toast((e as Error).message, { bad: true })); } } });
      onClose();
    } catch (e) { setError((e as Error).message); cmd.current = key(); } finally { setBusy(false); }
  };

  return (
    <div className="stock-modal-shade" onClick={onClose}>
      <section className="stock-modal quick-move" role="dialog" aria-modal="true" aria-label={mode === "give" ? t("Take out") : t("Put in")} onClick={(e) => e.stopPropagation()} onKeyDown={(e) => { if (e.key === "Enter" && (e.target as HTMLElement).tagName !== "SELECT" && (e.target as HTMLElement).tagName !== "BUTTON") { e.preventDefault(); void save(); } }}>
        <header className="sm-look-top"><h2>{mode === "give" ? t("Take out") : t("Put in")}</h2><button type="button" className="button secondary small" onClick={onClose}>{t("Close")}</button></header>
        <p className="quick-move-part"><b>{part.name}</b><small>{[part.part_number || part.sku, t("In stock") + " " + amount(Number(part.quantity))].filter(Boolean).join(" · ")}</small></p>
        <div className="counter-stepper">
          <button type="button" aria-label={t("One less")} onClick={() => bump(litre ? -0.5 : -1)}><Minus /></button>
          <input ref={inRef} aria-label={t("Quantity")} type="number" inputMode="decimal" min={litre ? 0.001 : 1} step={litre ? 0.001 : 1} value={qty} onChange={(e) => setQty(e.target.value)} />
          <button type="button" aria-label={t("One more")} onClick={() => bump(litre ? 0.5 : 1)}><Plus /></button>
          <span>{litre ? t("litres") : t("pieces")}</span>
        </div>
        {!litre && <div className="counter-qtyquick">{[5, 10, 20].map((n) => <button key={n} type="button" onClick={() => bump(n)}>+{n}</button>)}</div>}
        {mode === "give" && Number.isFinite(q) && q > Number(part.quantity) && <small className="stock-error">{t("Only {n} in stock.", { n: amount(Number(part.quantity)) })}</small>}
        {mode === "give" && jobs.length > 0 && (
          <label className="ws-field">{t("Which job is it for?")} <small>({t("optional")})</small>
            <select value={jobId} disabled={busy} onChange={(e) => setJobId(e.target.value)}>
              <option value="">{t("No job, just take it out of stock")}</option>
              {jobs.map((j) => <option key={j.id} value={j.id}>{j.registration} · {j.customer}</option>)}
            </select>
          </label>
        )}
        {mode === "receive" && (
          <details className="quick-move-more">
            <summary>{t("Supplier and cost")} ({t("optional")})</summary>
            <div className="ws-grid2">
              <SupplierPick id={supplierId} name={supplier} disabled={busy} onChange={pick} />
              <label className="ws-field">{t("Supplier invoice or delivery no.")}<input value={reference} maxLength={60} disabled={busy} onChange={(e) => setReference(e.target.value)} placeholder="DN-1234" /></label>
            </div>
            {seeCost && <label className="ws-field">{t("Cost price per unit (LKR)")}<input value={cost} inputMode="decimal" maxLength={12} disabled={busy} onChange={(e) => setCost(e.target.value.replace(/[^0-9.]/g, ""))} placeholder="1350.00" /></label>}
            {supplierId && seeCost && (
              <div className="ws-field" role="group" aria-label={t("Payment")}>{t("Payment")}
                <div className="ws-seg">{([["PAID", t("Paid now")], ["CREDIT", t("On credit")]] as [string, string][]).map(([k, l]) => <button type="button" key={k} className={terms === k ? "on" : ""} aria-pressed={terms === k} onClick={() => setTerms(k as "PAID" | "CREDIT")}>{l}</button>)}</div>
                {needCost && <small className="stock-error">{t("Enter the cost price so we know how much is owed.")}</small>}
              </div>
            )}
          </details>
        )}
        {error && <p className="stock-error" role="alert">{error}</p>}
        <button type="button" className="button primary counter-confirm" disabled={!ok || busy || needCost} onClick={() => void save()}>
          <Check size={18} /> {busy ? t("Saving…") : mode === "give" ? t("Take out {q} × {name}", { q: amount(q || 0), name: part.name }) : t("Add {q} × {name} to stock", { q: amount(q || 0), name: part.name })}
        </button>
      </section>
    </div>
  );
}
