import { useState } from "react";
import { t } from "../i18n";
import { toast } from "../ui";
import { isPractice } from "../practice";
import { Empty, Loading, useCommand, useLoad, waLink } from "./common";

type Item = { type: string; ref: string; detail: string; line: string; registration: string };
type Row = { key: string; customer_id: string; name: string; phone: string; message: string; types: string[]; items: Item[] };
type Data = { rows: Row[]; count: number; counts: Record<string, number> };

const KIND: Record<string, string> = { READY: "Vehicle ready", SERVICE: "Service due", PAYMENT: "Payment reminder", THANKS: "Thank you", BIRTHDAY: "Birthday", WINBACK: "We miss you" };
const ORDER = ["READY", "SERVICE", "PAYMENT", "THANKS", "BIRTHDAY", "WINBACK"];

/** Who to message today, grouped by reason. Nothing is sent from here: WhatsApp opens with the words ready, then mark it Sent, Skip or Later. */
export function Messages() {
  const { data, error, reload } = useLoad<Data>("/api/workshop/messages?origin=" + encodeURIComponent(location.origin));
  const hist = useLoad<{ type: string; status: string; by: string; at: string; name: string }[]>("/api/workshop/messages/history");
  const command = useCommand();
  const [busy, setBusy] = useState("");
  if (!data) return <Loading error={error} />;
  const mark = async (r: Row, status: "SENT" | "SKIPPED" | "LATER") => {
    setBusy(r.key);
    try { await command("/api/workshop/messages/log", { status, items: r.items.map((i) => ({ type: i.type, ref: i.ref, name: r.name })) }); await reload(); await hist.reload(); window.dispatchEvent(new Event("lifta:messages-changed")); }
    catch (e) { toast((e as Error).message); } finally { setBusy(""); }
  };
  const groups = ORDER.map((k) => [k, data.rows.filter((r) => r.types[0] === k)] as const).filter(([, rows]) => rows.length);
  return (
    <>
      <p className="muted">{t("Press WhatsApp, send the message, then come back and press Sent. Skip drops it for good; Later brings it back tomorrow.")}</p>
      {groups.map(([kind, rows]) => (
        <section key={kind} className="ws-card" aria-label={t(KIND[kind]!)}>
          <h3>{t(KIND[kind]!)} ({rows.length})</h3>
          {rows.map((r) => (
            <div key={r.key} className="ws-msg-row">
              <div>
                <b>{r.name || t("Customer")}</b>{" "}
                <span className="muted">{r.items.map((i) => i.detail).filter(Boolean).join(" · ")}{r.types.length > 1 ? " · " + r.types.slice(1).map((k) => t(KIND[k]!)).join(", ") : ""}</span>
                {!r.phone && <small className="stock-error"> {t("No phone number. Add one on the customer page, or Skip.")}</small>}
              </div>
              <span className="ws-contact">
                {r.phone && <a className="button primary small" target="_blank" rel="noreferrer" href={waLink(r.phone, r.message)} onClick={(e) => { if (isPractice()) { e.preventDefault(); toast(t("Practice: WhatsApp would open here with the message ready.")); } }}>WhatsApp</a>}
                {r.phone && <button className="button secondary small" disabled={busy === r.key} onClick={() => void mark(r, "SENT")}>{t("Sent")}</button>}
                <button className="button secondary small" disabled={busy === r.key} onClick={() => void mark(r, "SKIPPED")}>{t("Skip")}</button>
                <button className="button secondary small" disabled={busy === r.key} onClick={() => void mark(r, "LATER")}>{t("Later")}</button>
              </span>
            </div>
          ))}
        </section>
      ))}
      {!data.rows.length && <Empty>{t("No messages to send today.")}</Empty>}
      {!!hist.data?.length && (
        <details className="ws-card">
          <summary>{t("Recently dealt with")} ({hist.data.length})</summary>
          {hist.data.slice(0, 30).map((h, i) => <p key={i} className="muted">{h.at.slice(0, 16).replace("T", " ")} · {h.name || "-"} · {t(KIND[h.type] || h.type)} · {t(h.status === "SENT" ? "Sent" : h.status === "SKIPPED" ? "Skip" : "Later")} · {h.by}</p>)}
        </details>
      )}
    </>
  );
}
