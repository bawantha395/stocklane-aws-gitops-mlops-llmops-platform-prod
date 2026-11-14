import { t } from "../i18n";
import { Banknote, CalendarClock, ClipboardCheck, Receipt, TrendingUp, Wrench } from "lucide-react";
import { JobCard } from "./Cards";
import { useState } from "react";
import { Num, Empty, Loading, ReasonDialog, dateOnly, useCommand, useDebounced, useLoad, useWs, type DeleteRequest, type Job, type Vehicle } from "./common";

type Dash = {
  today: { date: string; invoices: number; billed: number; received: number }; month: { from: string; invoices: number; billed: number; received: number };
  open_jobs: Job[]; open_count: number; unpaid_count: number; unpaid_total: number; oldest_unpaid_days: number; due_count: number; delete_requests?: DeleteRequest[];
};

export const JobItem = JobCard;

export function Dashboard() {
  const { go, owner } = useWs();
  const { data, error, reload } = useLoad<Dash>("/api/workshop/dashboard");
  const [q, setQ] = useState("");
  const [ask, setAsk] = useState<{ r: DeleteRequest; reject: boolean } | null>(null), [problem, setProblem] = useState("");
  const command = useCommand();
  const term = useDebounced(q.trim());
  const found = useLoad<Vehicle[]>(term.length >= 2 ? "/api/workshop/vehicles?search=" + encodeURIComponent(term) : null);
  return (
    <div className="ws-home">
      <div className="ws-search">
        <input aria-label="Find a vehicle" placeholder={t("Find a vehicle: number, name or phone")} value={q} onChange={(e) => setQ(e.target.value)} />
        {q.trim().length >= 2 && (
          <div className="ws-search-results">
            {(found.data || []).slice(0, 6).map((v) => (
              <button className="ws-item" key={v.id} onClick={() => go({ name: "vehicle", id: v.id })}>
                <span className="ws-item-main"><strong>{v.registration}</strong><span>{v.owner}{v.make ? " · " + v.make : ""}</span><small>{v.phone}</small></span>
                <span className="ws-item-side"><small>Vehicle file</small></span>
              </button>
            ))}
            <button className="ws-item ws-item-new" onClick={() => go({ name: "new", reg: q.trim().toUpperCase() })}>+ New job for {q.trim().toUpperCase()}</button>
          </div>
        )}
      </div>
      {!data ? <Loading error={error} /> : (
        <>
          <div className="ws-kpis">
            <button className="ws-kpi" onClick={() => go({ name: "jobs" })}><small><Wrench size={15} /> {t("Open jobs")}</small><b>{data.open_count}</b><span>{t("in the workshop now")}</span></button>
            <div className="ws-kpi"><small><Receipt size={15} /> {t("Billed today")}</small><b><Num v={data.today.billed} /></b><span>{data.today.invoices} invoice{data.today.invoices === 1 ? "" : "s"}</span></div>
            <div className="ws-kpi"><small><Banknote size={15} /> {t("Received today")}</small><b><Num v={data.today.received} /></b><span>{t("cash, card and bank")}</span></div>
            <button className="ws-kpi warn" onClick={() => go({ name: "invoices" })}><small><ClipboardCheck size={15} /> {t("Customers owe")}</small><b><Num v={data.unpaid_total} /></b><span>{data.unpaid_count} invoice{data.unpaid_count === 1 ? "" : "s"}{data.oldest_unpaid_days > 7 ? ", oldest " + data.oldest_unpaid_days + " days" : ""}</span></button>
            <button className="ws-kpi" onClick={() => go({ name: "due" })}><small><CalendarClock size={15} /> {t("Service due")}</small><b>{data.due_count}</b><span>{t("vehicles to call")}</span></button>
            {owner && <div className="ws-kpi"><small><TrendingUp size={15} /> {t("Billed this month")}</small><b><Num v={data.month.billed} /></b><span>{data.month.invoices} invoice{data.month.invoices === 1 ? "" : "s"}</span></div>}
          </div>
          {owner && !!data.delete_requests?.length && (
            <section className="ws-card ws-requests" aria-label="Delete requests">
              <h3>Delete requests ({data.delete_requests.length})</h3>
              {problem && <p role="alert" className="stock-error">{problem}</p>}
              {data.delete_requests.map((r) => (
                <div className="ws-request" key={r.job_id}>
                  <button className="ws-item" onClick={() => go({ name: "job", id: r.job_id })}>
                    <span className="ws-item-main"><strong>{r.registration}</strong><span>{r.customer}</span><small>{r.requested_by}: {r.reason}</small></span>
                    <span className="ws-item-side"><small>{dateOnly(r.requested_at)}</small></span>
                  </button>
                  <span className="ws-request-actions"><button className="button primary small" onClick={() => setAsk({ r, reject: false })}>Approve</button><button className="button secondary small" onClick={() => setAsk({ r, reject: true })}>Reject</button></span>
                </div>
              ))}
            </section>
          )}
          <div className="ws-section-head"><h3>{t("Open jobs")}</h3><button className="button primary small" onClick={() => go({ name: "new" })}>+ {t("New job")}</button></div>
          <div className="ws-cards">
            {data.open_jobs.map((j) => <JobItem key={j.id} j={j} onOpen={() => go({ name: "job", id: j.id })} />)}
            {!data.open_jobs.length && <Empty action={{ label: "+ " + t("New job"), onClick: () => go({ name: "new" }) }}>No open jobs. Press New job when a vehicle comes in.</Empty>}
          </div>
        </>
      )}
      {ask && (
        <ReasonDialog title={ask.reject ? "Reject the delete request" : "Delete " + ask.r.registration + "?"} help={ask.reject ? undefined : "Approving moves the job to the Archive. You can restore it later."}
          label={ask.reject ? "Note for the mechanic (optional)" : "Note (optional)"} confirm={ask.reject ? "Reject" : "Approve and delete"} required={false} onClose={() => setAsk(null)}
          onDone={async (note) => {
            const { r, reject } = ask;
            try {
              if (reject) await command("/api/workshop/jobs/" + r.job_id + "/delete-request/reject", { note });
              else await command("/api/workshop/jobs/" + r.job_id + "/archive", { reason: ("Approved: " + (note || r.reason)).slice(0, 200) });
              setAsk(null); setProblem(""); await reload();
            } catch (e) { setProblem((e as Error).message); setAsk(null); }
          }} />
      )}
    </div>
  );
}
