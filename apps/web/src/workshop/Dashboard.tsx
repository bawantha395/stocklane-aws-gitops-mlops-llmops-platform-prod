import { useState } from "react";
import { Empty, Loading, Pill, ReasonDialog, dateOnly, lkr, useCommand, useDebounced, useLoad, useWs, type DeleteRequest, type Job, type Vehicle } from "./common";

type Dash = {
  today: { date: string; invoices: number; billed: number; received: number }; month: { from: string; invoices: number; billed: number; received: number };
  open_jobs: Job[]; open_count: number; unpaid_count: number; unpaid_total: number; oldest_unpaid_days: number; due_count: number; delete_requests?: DeleteRequest[];
};

export function JobItem({ j, onOpen }: { j: Job; onOpen: () => void }) {
  return (
    <button className="ws-item" onClick={onOpen}>
      <span className="ws-item-main"><strong>{j.registration}</strong><span>{j.customer}{j.vehicle ? " · " + j.vehicle : ""}</span><small>{j.summary || "No complaint noted"}</small>{j.delete_requested && <small className="ws-flag">Delete requested</small>}</span>
      <span className="ws-item-side"><b>{lkr(j.total)}</b><Pill s={j.status} /><small>{j.status === "OPEN" && j.age_days != null ? (j.age_days === 0 ? "Today" : j.age_days + " d open") : dateOnly(j.created_at)}</small></span>
    </button>
  );
}

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
        <input aria-label="Find a vehicle" placeholder="Find a vehicle: number, name or phone" value={q} onChange={(e) => setQ(e.target.value)} />
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
            <button className="ws-kpi" onClick={() => go({ name: "jobs" })}><small>Open jobs</small><b>{data.open_count}</b><span>in the workshop now</span></button>
            <div className="ws-kpi"><small>Billed today</small><b>{lkr(data.today.billed)}</b><span>{data.today.invoices} invoice{data.today.invoices === 1 ? "" : "s"}</span></div>
            <div className="ws-kpi"><small>Received today</small><b>{lkr(data.today.received)}</b><span>cash, card and bank</span></div>
            <button className="ws-kpi warn" onClick={() => go({ name: "invoices" })}><small>Customers owe</small><b>{lkr(data.unpaid_total)}</b><span>{data.unpaid_count} invoice{data.unpaid_count === 1 ? "" : "s"}{data.oldest_unpaid_days > 7 ? ", oldest " + data.oldest_unpaid_days + " days" : ""}</span></button>
            <button className="ws-kpi" onClick={() => go({ name: "due" })}><small>Service due</small><b>{data.due_count}</b><span>vehicles to call</span></button>
            {owner && <div className="ws-kpi"><small>Billed this month</small><b>{lkr(data.month.billed)}</b><span>{data.month.invoices} invoice{data.month.invoices === 1 ? "" : "s"}</span></div>}
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
          <div className="ws-section-head"><h3>Open jobs</h3><button className="button primary small" onClick={() => go({ name: "new" })}>+ New job</button></div>
          <div className="ws-list">
            {data.open_jobs.map((j) => <JobItem key={j.id} j={j} onOpen={() => go({ name: "job", id: j.id })} />)}
            {!data.open_jobs.length && <Empty>No open jobs. Press New job when a vehicle comes in.</Empty>}
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
