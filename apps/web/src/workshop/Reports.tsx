import { useEffect, useRef, useState } from "react";
import { csv, download } from "../api";
import { t } from "../i18n";
import { Loading, addDays, lkr, today, useLoad, useWs } from "./common";

type Rep = {
  from: string; until: string; invoices: number; vehicles: number; parts_total: number; labour_total: number; discount: number; tax: number; total: number; received: number;
  unpaid: number; average: number; outstanding_all_time: number; ageing: { d0_7: number; d8_30: number; d31_60: number; d60_plus: number };
  by_day: { date: string; billed: number }[]; by_mechanic: { mechanic: string; jobs: number; total: number }[]; by_method: { method: string; amount: number }[];
  top_parts: { name: string; quantity: number; amount: number }[]; top_labour: { name: string; times: number; amount: number }[];
  unpaid_list: { id: string; invoice_number: string; registration: string; customer: string; days: number; balance: number }[];
};

const niceMax = (v: number) => { if (v <= 0) return 1; const p = Math.pow(10, Math.floor(Math.log10(v))); const n = v / p; return (n <= 1 ? 1 : n <= 2 ? 2 : n <= 5 ? 5 : 10) * p; };
const compact = (v: number) => (v >= 1e6 ? +(v / 1e6).toFixed(1) + "M" : v >= 1e4 ? Math.round(v / 1e3) + "K" : v.toLocaleString("en"));

/** One series, one colour: billed per day. Columns are thin with a rounded top; the baseline is a hairline. */
function DayChart({ days }: { days: Rep["by_day"] }) {
  const box = useRef<HTMLDivElement>(null);
  const [w, setW] = useState(320), [hover, setHover] = useState<number | null>(null), [table, setTable] = useState(false);
  useEffect(() => {
    const el = box.current; if (!el) return;
    const ro = new ResizeObserver(() => setW(Math.max(240, el.clientWidth)));
    ro.observe(el); setW(Math.max(240, el.clientWidth));
    return () => ro.disconnect();
  }, []);
  const H = 210, L = 44, B = 24, T = 14, R = 6, iw = w - L - R, ih = H - B - T;
  const top = niceMax(Math.max(...days.map((d) => d.billed), 0)), slot = iw / days.length, bar = Math.max(2, Math.min(24, slot * 0.62));
  const every = Math.max(1, Math.ceil(days.length / Math.max(2, Math.floor(iw / 54))));
  const peak = days.reduce((m, d, i) => (d.billed > days[m].billed ? i : m), 0);
  const y = (v: number) => T + ih - (v / top) * ih;
  const col = (i: number) => L + i * slot + (slot - bar) / 2;
  return (
    <section className="ws-card" aria-label="Billed per day">
      <div className="ws-card-head"><h3>Billed per day <small>LKR</small></h3><button className="button secondary small" onClick={() => setTable(!table)}>{table ? "Show chart" : "Show table"}</button></div>
      {table ? (
        <div className="ws-table-wrap"><table className="ws-table"><thead><tr><th>Date</th><th className="r">Billed</th></tr></thead><tbody>{days.map((d) => <tr key={d.date}><td>{d.date}</td><td className="r">{lkr(d.billed)}</td></tr>)}</tbody></table></div>
      ) : (
        <div ref={box} className="ws-chart">
          <svg width={w} height={H} role="img" aria-label={"Billed per day, highest " + lkr(days[peak]?.billed) + " on " + days[peak]?.date}>
            {[0, 0.5, 1].map((t) => <g key={t}><line x1={L} x2={w - R} y1={y(top * t)} y2={y(top * t)} className={t === 0 ? "ws-axis" : "ws-grid"} /><text x={L - 6} y={y(top * t) + 3} textAnchor="end" className="ws-tick">{compact(top * t)}</text></g>)}
            {days.map((d, i) => {
              const h = (d.billed / top) * ih;
              return (
                <g key={d.date}>
                  {h > 0 && <path className={"ws-col" + (hover === i ? " on" : "")} d={`M${col(i)},${y(0)} v${-Math.max(0, h - 4)} a4,4 0 0 1 4,-4 h${bar - 8} a4,4 0 0 1 4,4 v${Math.max(0, h - 4)} z`} />}
                  {i % every === 0 && <text x={col(i) + bar / 2} y={H - 7} textAnchor="middle" className="ws-tick">{d.date.slice(5)}</text>}
                  <rect x={L + i * slot} y={T} width={slot} height={ih} fill="transparent" tabIndex={0} aria-label={d.date + ": " + lkr(d.billed)} onMouseEnter={() => setHover(i)} onFocus={() => setHover(i)} onMouseLeave={() => setHover(null)} onBlur={() => setHover(null)} onClick={() => setHover(i)} />
                </g>
              );
            })}
            {days[peak]?.billed > 0 && <text x={Math.min(Math.max(col(peak) + bar / 2, L + 28), w - R - 28)} y={y(days[peak].billed) - 5} textAnchor="middle" className="ws-peak">{compact(days[peak].billed)}</text>}
          </svg>
          {hover != null && <div className="ws-tip" style={{ left: Math.min(Math.max(col(hover) + bar / 2, 70), w - 70) }}><b>{lkr(days[hover].billed)}</b><span>{days[hover].date}</span></div>}
        </div>
      )}
    </section>
  );
}

/** Payment methods as a donut; every slice is also written out in the legend, never colour alone. */
const METHOD_COL = ["#0f5a43", "#1d4ed8", "#b45309", "#7c3aed", "#52525b"];
function Donut({ title, rows }: { title: string; rows: { label: string; value: number }[] }) {
  const total = rows.reduce((a, r) => a + r.value, 0); if (!total) return null;
  const R = 52, C = 2 * Math.PI * R; let acc = 0;
  return (
    <section className="ws-card ws-donut" aria-label={title}>
      <h3>{title}</h3>
      <div className="ws-donut-row">
        <svg viewBox="0 0 140 140" width="140" height="140" role="img" aria-label={rows.map((r) => r.label + " " + Math.round((r.value / total) * 100) + "%").join(", ")}>
          <circle cx="70" cy="70" r={R} fill="none" stroke="#eee" strokeWidth="18" />
          {rows.map((r, i) => { const len = (r.value / total) * C, off = acc; acc += len; return <circle key={r.label} className="ws-arc" cx="70" cy="70" r={R} fill="none" stroke={METHOD_COL[i % METHOD_COL.length]} strokeWidth="18" strokeDasharray={Math.max(0, len - 2) + " " + C} strokeDashoffset={-off} transform="rotate(-90 70 70)" style={{ animationDelay: i * 120 + "ms", ["--len" as string]: len }} />; })}
          <text x="70" y="66" textAnchor="middle" className="ws-donut-n">{compact(total)}</text><text x="70" y="84" textAnchor="middle" className="ws-tick">LKR</text>
        </svg>
        <ul className="ws-legend">{rows.map((r, i) => <li key={r.label}><i style={{ background: METHOD_COL[i % METHOD_COL.length] }} /><span>{r.label}</span><b>{Math.round((r.value / total) * 100)}%</b><small>{lkr(r.value)}</small></li>)}</ul>
      </div>
    </section>
  );
}
/** Ranked horizontal bars (top parts, top work, who owes). One colour, value written at the end of each bar. */
function Bars({ title, rows }: { title: string; rows: { label: string; value: number; note?: string }[] }) {
  if (!rows.length) return null;
  const max = Math.max(...rows.map((r) => r.value), 1);
  return (
    <section className="ws-card ws-bars" aria-label={title}>
      <h3>{title}</h3>
      <ol>{rows.map((r, i) => <li key={r.label + i}><span className="ws-bar-l">{r.label}{r.note && <small>{r.note}</small>}</span><span className="ws-bar-t"><i style={{ width: Math.max(3, (r.value / max) * 100) + "%", animationDelay: i * 70 + "ms" }} /></span><b>{lkr(r.value)}</b></li>)}</ol>
    </section>
  );
}

function Block({ title, rows, head }: { title: string; head: [string, string, string?]; rows: [string, string, string?][] }) {
  if (!rows.length) return null;
  return (
    <section className="ws-card">
      <h3>{title}</h3>
      <div className="ws-table-wrap"><table className="ws-table"><thead><tr><th>{head[0]}</th><th className="r">{head[1]}</th>{head[2] && <th className="r">{head[2]}</th>}</tr></thead>
        <tbody>{rows.map((r, i) => <tr key={i}><td>{r[0]}</td><td className="r">{r[1]}</td>{r[2] != null && <td className="r">{r[2]}</td>}</tr>)}</tbody></table></div>
    </section>
  );
}

const ranges = () => {
  const t = today(), first = t.slice(0, 8) + "01", lastEnd = addDays(first, -1), lastFirst = lastEnd.slice(0, 8) + "01";
  return [["Today", t, t], ["Last 7 days", addDays(t, -6), t], ["This month", first, t], ["Last month", lastFirst, lastEnd], ["This year", t.slice(0, 4) + "-01-01", t]] as [string, string, string][];
};

export function Reports() {
  const { go } = useWs();
  const [from, setFrom] = useState(today().slice(0, 8) + "01"), [until, setUntil] = useState(today()), [err, setErr] = useState("");
  const { data, error } = useLoad<Rep>("/api/workshop/report?from=" + from + "&until=" + until);
  return (
    <div>
      <div className="ws-toolbar">
        <div className="ws-chips">{ranges().map(([label, a, b]) => <button key={label} className={"ws-chip" + (from === a && until === b ? " chosen" : "")} onClick={() => { setFrom(a); setUntil(b); }}>{label}</button>)}</div>
        <div className="ws-dates">
          <label>From<input type="date" value={from} max={until} onChange={(e) => e.target.value && setFrom(e.target.value)} /></label>
          <label>Until<input type="date" value={until} min={from} onChange={(e) => e.target.value && setUntil(e.target.value)} /></label>
          <button className="button secondary small" onClick={() => void download("/api/workshop/report.pdf?from=" + from + "&until=" + until, "workshop-report-" + from + "_" + until + ".pdf").catch((e) => setErr(e.message))}>PDF</button>
          {data && <button className="button secondary small" onClick={() => csv("billed-per-day-" + from + "_" + until + ".csv", data.by_day.map((d) => ({ Date: d.date, "Billed (LKR)": d.billed })))}>CSV</button>}
        </div>
      </div>
      {(error || err) && <Loading error={error || err} />}
      {!data ? !error && <Loading /> : (
        <>
          <div className="ws-kpis">
            <div className="ws-kpi"><small>Billed</small><b>{lkr(data.total)}</b><span>{data.invoices} invoice{data.invoices === 1 ? "" : "s"}, {data.vehicles} vehicle{data.vehicles === 1 ? "" : "s"}</span></div>
            <div className="ws-kpi"><small>Money received</small><b>{lkr(data.received)}</b><span>payments in this period</span></div>
            <div className="ws-kpi"><small>Parts</small><b>{lkr(data.parts_total)}</b><span>Labour {lkr(data.labour_total)}</span></div>
            <div className="ws-kpi"><small>Average invoice</small><b>{lkr(data.average)}</b><span>{data.discount > 0 ? "Discounts " + lkr(data.discount) : "no discounts"}{data.tax > 0 ? ", tax " + lkr(data.tax) : ""}</span></div>
            <div className="ws-kpi warn"><small>Unpaid (this period)</small><b>{lkr(data.unpaid)}</b><span>of the invoices above</span></div>
            <div className="ws-kpi warn"><small>Unpaid (all time)</small><b>{lkr(data.outstanding_all_time)}</b><span>every customer</span></div>
          </div>
          <DayChart days={data.by_day} />
          <div className="ws-two">
            <Block title="By mechanic" head={["Mechanic", "Jobs", "Billed"]} rows={data.by_mechanic.map((m) => [m.mechanic, String(m.jobs), lkr(m.total)])} />
            <Donut title={t("Payments by method")} rows={data.by_method.map((m) => ({ label: m.method.charAt(0) + m.method.slice(1).toLowerCase(), value: m.amount }))} />
            <Bars title={t("Top parts")} rows={data.top_parts.map((p) => ({ label: p.name, value: p.amount, note: "×" + p.quantity }))} />
            <Bars title={t("Top labour")} rows={data.top_labour.map((p) => ({ label: p.name, value: p.amount, note: "×" + p.times }))} />
            <Bars title={t("Unpaid by age")} rows={[{ label: "0 to 7 days", value: data.ageing.d0_7 }, { label: "8 to 30 days", value: data.ageing.d8_30 }, { label: "31 to 60 days", value: data.ageing.d31_60 }, { label: "Over 60 days", value: data.ageing.d60_plus }].filter((r) => r.value > 0)} />
          </div>
          {!!data.unpaid_list.length && (
            <section className="ws-card"><h3>Unpaid invoices, oldest first</h3>
              <div className="ws-list">{data.unpaid_list.map((u) => (
                <button className="ws-item" key={u.id} onClick={() => go({ name: "invoice", id: u.id })}>
                  <span className="ws-item-main"><strong>{u.registration}</strong><span>{u.customer}</span><small>{u.invoice_number}</small></span>
                  <span className="ws-item-side"><b>{lkr(u.balance)}</b><small>{u.days} day{u.days === 1 ? "" : "s"}</small></span>
                </button>))}</div>
            </section>
          )}
        </>
      )}
    </div>
  );
}
