import { useEffect, useState } from "react";
import { t } from "../i18n";
import { toast } from "../ui";
import { Empty, Loading, Num, dateOnly, useCommand, useLoad } from "./common";

type Alert = { key: string; type: string; at: string; by: string; title: string; detail: string; amount: number | null; seen: boolean; seen_by: string };
type Data = { alerts: Alert[]; unseen: number };
const KIND: Record<string, string> = { BELOW_COST: "Sold below cost", DISCOUNT: "Big discount", VOID: "Bill voided", REFUND: "Money given back", COUNT: "Stock count changed", COST_EDIT: "Cost price changed", STOCK_RETURN: "Sent back to supplier" };

/** Owner: things that can leak money, from the last 30 days. Tick each off once you have looked. */
export function Alerts() {
  const { data, error, reload } = useLoad<Data>("/api/workshop/alerts");
  const command = useCommand();
  const [all, setAll] = useState(false), [busy, setBusy] = useState(false);
  if (!data) return <Loading error={error} />;
  const seen = async (body: unknown) => {
    setBusy(true);
    try { await command("/api/workshop/alerts/seen", body); await reload(); window.dispatchEvent(new Event("lifta:alerts-changed")); } catch (e) { toast((e as Error).message); } finally { setBusy(false); }
  };
  const rows = data.alerts.filter((a) => all || !a.seen);
  return (
    <>
      <div className="ws-contact">
        <button className={"button small " + (all ? "primary" : "secondary")} aria-pressed={all} onClick={() => setAll((v) => !v)}>{all ? t("Showing all") : t("Only new")}</button>
        {data.unseen > 0 && <button className="button secondary small" disabled={busy} onClick={() => void seen({ all: true })}>{t("Mark all seen")}</button>}
      </div>
      {rows.map((a) => (
        <section key={a.key} className={"ws-card ws-alert" + (a.seen ? " seen" : "")}>
          <div className="ws-msg-row">
            <div>
              <b>{t(KIND[a.type] || a.type)}</b> · {a.title.replace(/^[^:]*: /, "")}
              <div className="muted">{a.detail}{a.amount !== null && <> · <Num v={a.amount} /></>}</div>
              <small className="muted">{dateOnly(a.at)}{a.by ? " · " + a.by : ""}{a.seen ? " · " + t("Seen") + (a.seen_by ? " " + a.seen_by : "") : ""}</small>
            </div>
            {!a.seen && <button className="button secondary small" disabled={busy} onClick={() => void seen({ keys: [a.key] })}>{t("Seen")}</button>}
          </div>
        </section>
      ))}
      {!rows.length && <Empty>{t("No alerts. Nothing looks wrong in the last 30 days.")}</Empty>}
    </>
  );
}

type Cockpit = { today: { received: number; profit: number; profit_unknown: number }; month: { profit: number; profit_unknown: number }; owing: number; owing_count: number; overdue_count: number; to_order: number; approvals: number; messages: number; alerts: number };

/** The owner's morning glance: money in, what it earned, what is owed, what needs a decision. */
export function OwnerSummary({ go }: { go: (p: { name: "alerts" | "invoices" | "messages" }) => void }) {
  const { data, reload } = useLoad<Cockpit>("/api/workshop/cockpit");
  useWindowReload(reload);
  if (!data) return null;
  const tile = (label: string, value: React.ReactNode, sub: string, onClick?: () => void, warn?: boolean) => {
    const body = <><small>{label}</small><b>{value}</b><span>{sub}</span></>;
    return onClick ? <button className={"ws-kpi" + (warn ? " warn" : "")} onClick={onClick}>{body}</button> : <div className="ws-kpi">{body}</div>;
  };
  return (
    <section className="ws-card" aria-label={t("Owner summary")}>
      <h3>{t("Owner summary")}</h3>
      <div className="ws-kpis">
        {tile(t("Money in today"), <Num v={data.today.received} />, t("cash, card and bank"))}
        {tile(t("Profit today"), <Num v={data.today.profit} />, data.today.profit_unknown ? t("{n} parts without a cost are left out", { n: data.today.profit_unknown }) : t("after parts cost and discount"))}
        {tile(t("Profit this month"), <Num v={data.month.profit} />, data.month.profit_unknown ? t("{n} parts without a cost are left out", { n: data.month.profit_unknown }) : t("after parts cost and discount"))}
        {tile(t("Customers owe"), <Num v={data.owing} />, data.overdue_count ? t("{n} past terms", { n: data.overdue_count }) : t("{n} bills", { n: data.owing_count }), () => go({ name: "invoices" }), data.overdue_count > 0)}
        {tile(t("To order"), data.to_order, t("parts running low or wanted"), () => window.dispatchEvent(new Event("lifta:low")))}
        {tile(t("Approvals"), data.approvals, t("delete requests waiting"))}
        {tile(t("Messages"), data.messages, t("customers to message"), () => go({ name: "messages" }))}
        {tile(t("Alerts"), data.alerts, data.alerts ? t("to look at") : t("all clear"), () => go({ name: "alerts" }), data.alerts > 0)}
      </div>
    </section>
  );
}

function useWindowReload(reload: () => Promise<void>) {
  useEffect(() => {
    const f = () => void reload();
    window.addEventListener("lifta:alerts-changed", f); window.addEventListener("lifta:messages-changed", f);
    return () => { window.removeEventListener("lifta:alerts-changed", f); window.removeEventListener("lifta:messages-changed", f); };
  }, [reload]);
}
