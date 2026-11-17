import { useState } from "react";
import { can } from "./perms";
import { t } from "./i18n";
import { toast } from "./ui";
import { Empty, Loading, dateOnly, lkr, useCommand, useLoad } from "./workshop/common";

type Claim = { id: string; claim_no: string; name: string; sku: string; supplier: string; supplier_id?: string; quantity: number; reason: string; ref?: string; status: string; credit?: number; revision: number; created_at: string;
  timeline: { at: string; by?: string; status: string; note?: string; credit?: number }[] };
type List = { claims: Claim[]; open: number };
type Part = { id: string; name: string; sku: string };

const LABEL: Record<string, string> = { OPEN: "Open", SENT: "With the supplier", CREDITED: "Credit received", REPLACED: "Replaced", REJECTED: "Rejected" };
const ENDED = ["CREDITED", "REPLACED", "REJECTED"];

/** Warranty claims on a part that failed. For one supplier (with its parts) or for all of them. */
export function ClaimsPanel({ supplierId, parts }: { supplierId?: string; parts?: Part[] }) {
  const [all, setAll] = useState(false), [adding, setAdding] = useState(false);
  const { data, error, reload } = useLoad<List>("/api/inventory/claims?status=" + (all ? "" : "ACTIVE") + (supplierId ? "&supplier=" + supplierId : ""));
  const edit = can("supplier_return");
  return (
    <div className="ws-card ws-claims">
      <div className="ws-section-head"><h3>{t("Warranty claims")}{data && data.open > 0 ? " (" + data.open + " " + t("open") + ")" : ""}</h3>
        {edit && supplierId && parts && <button className="button secondary small" onClick={() => setAdding(!adding)}>{adding ? t("Close") : "+ " + t("New claim")}</button>}</div>
      {adding && supplierId && parts && <NewClaim supplierId={supplierId} parts={parts} onDone={() => { setAdding(false); void reload(); }} />}
      <label className="ws-check"><input type="checkbox" checked={all} onChange={(e) => setAll(e.target.checked)} /> {t("Show finished claims too")}</label>
      {!data ? <Loading error={error} /> : data.claims.length === 0 ? <Empty>{all ? "No claims yet." : "No open claims."}</Empty> : data.claims.map((c) => <ClaimRow key={c.id} c={c} edit={edit} onChange={() => void reload()} />)}
    </div>
  );
}

function NewClaim({ supplierId, parts, onDone }: { supplierId: string; parts: Part[]; onDone: () => void }) {
  const command = useCommand();
  const [f, setF] = useState({ productId: "", quantity: "1", reason: "", ref: "" }), [msg, setMsg] = useState("");
  const save = async () => {
    setMsg("");
    try { await command("/api/inventory/claims", { ...f, supplierId }); toast(t("Claim saved.")); onDone(); } catch (e) { setMsg((e as Error).message); }
  };
  return (
    <div className="ws-form">
      <label className="ws-field">{t("Part")} *<select value={f.productId} onChange={(e) => setF({ ...f, productId: e.target.value })}><option value="">{t("Choose the part")}</option>{parts.map((p) => <option key={p.id} value={p.id}>{p.name} · {p.sku}</option>)}</select></label>
      <label className="ws-field">{t("How many")}<input inputMode="decimal" value={f.quantity} onChange={(e) => setF({ ...f, quantity: e.target.value.replace(/[^\d.]/g, "") })} /></label>
      <label className="ws-field">{t("What is wrong")} *<input maxLength={300} value={f.reason} onChange={(e) => setF({ ...f, reason: e.target.value })} placeholder={t("Leaks, stopped working after a week, ...")} /></label>
      <label className="ws-field">{t("Bill, job or delivery no.")} <small>({t("optional")})</small><input maxLength={60} value={f.ref} onChange={(e) => setF({ ...f, ref: e.target.value })} /></label>
      {msg && <p className="stock-error" role="alert">{msg}</p>}
      <div className="ws-bar"><button className="button primary small" disabled={!f.productId || !f.reason.trim()} onClick={() => void save()}>{t("Save claim")}</button></div>
      <p className="ws-help">{t("To send the part back and update stock, use Return parts to supplier. This only follows the claim.")}</p>
    </div>
  );
}

function ClaimRow({ c, edit, onChange }: { c: Claim; edit: boolean; onChange: () => void }) {
  const command = useCommand();
  const [open, setOpen] = useState(false), [ask, setAsk] = useState<"" | "CREDITED" | "REJECTED" | "REPLACED" | "SENT">(""), [credit, setCredit] = useState(""), [note, setNote] = useState(""), [msg, setMsg] = useState("");
  const ended = ENDED.includes(c.status);
  const move = async () => {
    setMsg("");
    try { await command("/api/inventory/claims/" + c.id + "/status", { status: ask, revision: c.revision, note, ...(ask === "CREDITED" ? { credit } : {}) }); setAsk(""); setCredit(""); setNote(""); onChange(); } catch (e) { setMsg((e as Error).message); }
  };
  return (
    <div className="ws-claim">
      <button className="ws-cust" onClick={() => setOpen(!open)} aria-expanded={open}>
        <span className="ws-cust-main"><strong>{c.name}</strong><small>{c.claim_no} · {c.supplier} · {c.quantity} · {dateOnly(c.created_at)}</small></span>
        <span className="ws-cust-side"><small className={ended ? "" : "ws-debt"}>{t(LABEL[c.status] || c.status)}{c.status === "CREDITED" && c.credit ? " · LKR " + lkr(c.credit) : ""}</small></span>
      </button>
      {open && (
        <div className="ws-claim-body">
          <p>{c.reason}{c.ref ? " · " + c.ref : ""}</p>
          {c.timeline.map((x, i) => <div className="ws-cust-line" key={i}><span><b>{t(LABEL[x.status] || x.status)}</b> <small>{dateOnly(x.at)}{x.by ? " · " + x.by : ""}{x.note ? " · " + x.note : ""}</small></span>{x.credit ? <b>LKR {lkr(x.credit)}</b> : null}</div>)}
          {edit && !ended && !ask && (
            <div className="ws-bar">
              {c.status === "OPEN" && <button className="button secondary small" onClick={() => setAsk("SENT")}>{t("Given to the supplier")}</button>}
              <button className="button secondary small" onClick={() => setAsk("CREDITED")}>{t("Got credit")}</button>
              <button className="button secondary small" onClick={() => setAsk("REPLACED")}>{t("Got a new part")}</button>
              <button className="button secondary small" onClick={() => setAsk("REJECTED")}>{t("Supplier said no")}</button>
            </div>
          )}
          {ask && (
            <div className="ws-form">
              {ask === "CREDITED" && <label className="ws-field">{t("Credit amount (LKR)")} *<input inputMode="decimal" value={credit} onChange={(e) => setCredit(e.target.value.replace(/[^\d.]/g, ""))} /></label>}
              <label className="ws-field">{ask === "REJECTED" ? t("Why did they refuse") + " *" : t("Note")}<input maxLength={300} value={note} onChange={(e) => setNote(e.target.value)} /></label>
              {msg && <p className="stock-error" role="alert">{msg}</p>}
              <div className="ws-bar"><button className="button primary small" disabled={(ask === "CREDITED" && !Number(credit)) || (ask === "REJECTED" && !note.trim())} onClick={() => void move()}>{t("Save")}</button><button className="button secondary small" onClick={() => setAsk("")}>{t("Cancel")}</button></div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
