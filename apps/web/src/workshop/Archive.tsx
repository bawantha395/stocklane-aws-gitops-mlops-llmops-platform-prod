import { t } from "../i18n";
import { useState } from "react";
import { askConfirm } from "../ui";
import { Empty, Loading, dateOnly, lkr, useCommand, useLoad, useWs, type Job } from "./common";

type Entry = { sk: string; action: string; job_id: string; registration: string; customer: string; actor: string; actor_email?: string | null; reason?: string };
const ACTION: Record<string, string> = {
  ARCHIVED: "Deleted", RESTORED: "Restored", UNDONE: "Undone", CANCELLED: "Cancelled", DELETE_REQUESTED: "Delete requested", REQUEST_REJECTED: "Request rejected", INVOICE_VOIDED: "Invoice voided", INVOICE_REFUND: "Invoice refunded",
};

/** Owner only: jobs that were deleted (kept, never destroyed), with a restore button, and the log of who did what. */
export function Archive() {
  const { go } = useWs();
  const { data, error, reload } = useLoad<{ jobs: Job[]; log: Entry[] }>("/api/workshop/archive");
  const [busy, setBusy] = useState(""), [problem, setProblem] = useState("");
  const command = useCommand();
  if (!data) return <Loading error={error} />;
  const restore = async (j: Job) => {
    if (!(await askConfirm("It comes back to the jobs list and the vehicle history.", { title: "Restore " + j.registration + "?", confirm: "Restore" }))) return;
    setBusy(j.id); setProblem("");
    try { await command("/api/workshop/jobs/" + j.id + "/restore", {}); await reload(); } catch (e) { setProblem((e as Error).message); } finally { setBusy(""); }
  };
  return (
    <div className="ws-archive">
      <div className="ws-section-head"><h3>Deleted jobs ({data.jobs.length})</h3></div>
      <p className="muted">{t("Deleted jobs are kept here, hidden from jobs, the vehicle history and reports. Restore one if it was a mistake.")}</p>
      {problem && <p role="alert" className="stock-error">{problem}</p>}
      <div className="ws-list">
        {data.jobs.map((j) => (
          <div className="ws-request" key={j.id}>
            <button className="ws-item" onClick={() => go({ name: "job", id: j.id })}>
              <span className="ws-item-main"><strong>{j.registration}</strong><span>{j.customer}{j.vehicle ? " · " + j.vehicle : ""}</span><small>{j.archive_reason || "No reason noted"}</small></span>
              <span className="ws-item-side"><b>{lkr(j.total)}</b><small>{j.archived_by} · {j.archived_at ? dateOnly(j.archived_at) : ""}</small></span>
            </button>
            <span className="ws-request-actions"><button className="button secondary small" disabled={busy === j.id} onClick={() => void restore(j)}>{t("Restore")}</button></span>
          </div>
        ))}
        {!data.jobs.length && <Empty>{t("Nothing deleted. Deleted jobs appear here.")}</Empty>}
      </div>
      <div className="ws-section-head"><h3>Log</h3></div>
      <div className="ws-card ws-logcard">
        {data.log.map((a, i) => (
          <div className="ws-log" key={a.sk || i}>
            <small className="ws-log-date">{a.sk ? new Date(a.sk.split("#")[0]!).toLocaleString("en-GB", { timeZone: "Asia/Colombo", dateStyle: "medium", timeStyle: "short" }) : "—"}</small>
            <span><b>{ACTION[a.action] || a.action}</b>{" "}<button className="ws-log-ref" onClick={() => go({ name: "job", id: a.job_id })}>{a.registration}</button>{" "}<em>{a.customer}</em></span>
            <small>{a.actor_email || a.actor}{a.reason ? ": " + a.reason : ""}</small>
          </div>
        ))}
        {!data.log.length && <Empty>{t("No entries yet.")}</Empty>}
      </div>
    </div>
  );
}
