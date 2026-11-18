import { useState } from "react";
import { Banknote, Lock, LockOpen } from "lucide-react";
import { t } from "../i18n";
import { toast } from "../ui";
import { Loading, addDays, dateOnly, lkr, today, useCommand, useLoad, useWs } from "./common";

type Day = {
  date: string; expected_cash: number; payments: number; locking: boolean; was_reopened: boolean;
  by_method: { method: string; amount: number }[];
  row: { counted: number; variance: number; note?: string; closed_by: string; closed_at: string } | null;
};
type Past = { date: string; status: string; expected_cash: number; counted: number; variance: number; closed_by: string; note?: string; reopened_by?: string; reopen_reason?: string };

const METHOD: Record<string, string> = { CASH: "Cash", CARD: "Card", BANK: "Bank transfer", OTHER: "Other" };

/** Optional: the owner turns this on in Settings. The day's money is added up for you; you count the drawer and close the day. */
export function CashUp() {
  const { owner } = useWs(), command = useCommand();
  const [date, setDate] = useState(today()), [counted, setCounted] = useState(""), [note, setNote] = useState(""), [why, setWhy] = useState(""), [busy, setBusy] = useState(false), [tick, setTick] = useState(0);
  const day = useLoad<Day>("/api/workshop/cashup?date=" + date + "&v=" + tick);
  const past = useLoad<Past[]>("/api/workshop/cashup/history?v=" + tick);
  const d = day.data;
  const diff = d && counted !== "" ? Number(counted) - Number(d.expected_cash) : null;
  const run = async (fn: () => Promise<unknown>, done: string) => {
    setBusy(true);
    try { await fn(); toast(done); setCounted(""); setNote(""); setWhy(""); setTick((x) => x + 1); } catch (e) { toast((e as Error).message, { bad: true }); } finally { setBusy(false); }
  };
  if (day.error) return <Loading error={day.error} />;
  if (!d) return <Loading />;
  return (
    <div className="ws-cashup">
      <div className="ws-toolbar">
        <div className="ws-dates">
          <button className="button secondary small" onClick={() => setDate(addDays(date, -1))}>{"‹"} {t("Previous day")}</button>
          <label>{t("Day")}<input type="date" value={date} max={today()} onChange={(e) => e.target.value && setDate(e.target.value)} /></label>
          <button className="button secondary small" disabled={date >= today()} onClick={() => setDate(addDays(date, 1))}>{t("Next day")} {"›"}</button>
        </div>
      </div>

      <section className="ws-card">
        <div className="ws-card-head"><h3><Banknote size={18} /> {t("Taken on")} {date}</h3>{d.row ? <span className="ws-pill ok"><Lock size={14} /> {t("Closed")}</span> : <span className="ws-pill">{t("Open")}</span>}</div>
        {d.by_method.length === 0 ? <p className="muted">{t("No money was taken on this day.")}</p> : (
          <table className="ws-table"><tbody>
            {d.by_method.map((m) => <tr key={m.method}><td>{t(METHOD[m.method] || m.method)}</td><td className="num">{lkr(m.amount)}</td></tr>)}
          </tbody></table>
        )}
        <p className="ws-cash-expect"><span>{t("Cash that should be in the drawer")}</span><b>LKR {lkr(d.expected_cash)}</b></p>
        <p className="muted">{t("Refunds are already taken off. Card and bank money is not counted here.")}</p>
      </section>

      {d.row ? (
        <section className="ws-card">
          <div className="ws-card-head"><h3>{t("Closed by")} {d.row.closed_by}</h3></div>
          <table className="ws-table"><tbody>
            <tr><td>{t("Cash counted")}</td><td className="num">{lkr(d.row.counted)}</td></tr>
            <tr><td>{t("Difference")}</td><td className={"num " + (Number(d.row.variance) === 0 ? "" : "bad")}>{Number(d.row.variance) > 0 ? "+" : ""}{lkr(d.row.variance)}</td></tr>
          </tbody></table>
          {d.row.note && <p className="muted">{d.row.note}</p>}
          {d.locking && <p className="muted"><Lock size={14} /> {t("Payments, refunds and voids can no longer change this day.")}</p>}
          {owner && (
            <div className="ws-cash-reopen">
              <label className="ws-field">{t("Reason to reopen")}<input value={why} maxLength={200} onChange={(e) => setWhy(e.target.value)} /></label>
              <button className="button secondary" disabled={busy || !why.trim()} onClick={() => void run(() => command("/api/workshop/cashup/reopen", { date, reason: why.trim() }), t("Day reopened"))}><LockOpen size={16} /> {t("Reopen this day")}</button>
            </div>
          )}
        </section>
      ) : (
        <section className="ws-card">
          <div className="ws-card-head"><h3>{t("Count the drawer")}</h3></div>
          {d.was_reopened && <p className="muted">{t("This day was reopened. Count again and close it.")}</p>}
          <label className="ws-field">{t("Cash counted (LKR)")}<input inputMode="decimal" value={counted} onChange={(e) => setCounted(e.target.value.replace(/[^0-9.]/g, ""))} /></label>
          {diff !== null && <p className={"ws-cash-diff" + (diff === 0 ? " ok" : " bad")}>{diff === 0 ? t("The cash matches.") : (diff > 0 ? t("More than expected by") : t("Less than expected by")) + " LKR " + lkr(Math.abs(diff))}</p>}
          <label className="ws-field">{diff !== null && diff !== 0 ? t("Why is it different? (needed)") : t("Note (optional)")}<input value={note} maxLength={200} onChange={(e) => setNote(e.target.value)} /></label>
          <button className="button primary" disabled={busy || counted === "" || (diff !== 0 && !note.trim())} onClick={() => void run(() => command("/api/workshop/cashup", { date, counted, note: note.trim() }), t("Day closed"))}>{t("Close the day")}</button>
        </section>
      )}

      {past.data && past.data.length > 0 && (
        <section className="ws-card">
          <div className="ws-card-head"><h3>{t("Recent days")}</h3></div>
          <table className="ws-table">
            <thead><tr><th>{t("Day")}</th><th className="num">{t("Expected")}</th><th className="num">{t("Counted")}</th><th className="num">{t("Difference")}</th><th>{t("By")}</th></tr></thead>
            <tbody>{past.data.map((r) => (
              <tr key={r.date} onClick={() => setDate(r.date)} style={{ cursor: "pointer" }}>
                <td>{dateOnly(r.date + "T12:00:00+05:30")}{r.status === "REOPENED" && <small> · {t("reopened")}</small>}</td>
                <td className="num">{r.status === "CLOSED" ? lkr(r.expected_cash) : "-"}</td><td className="num">{r.status === "CLOSED" ? lkr(r.counted) : "-"}</td>
                <td className={"num " + (Number(r.variance) === 0 ? "" : "bad")}>{r.status === "CLOSED" ? lkr(r.variance) : "-"}</td><td>{r.closed_by}</td>
              </tr>
            ))}</tbody>
          </table>
        </section>
      )}
    </div>
  );
}
