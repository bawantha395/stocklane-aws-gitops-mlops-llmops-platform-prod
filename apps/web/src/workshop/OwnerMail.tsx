import { useEffect, useState } from "react";
import { Mail } from "lucide-react";
import { t } from "../i18n";
import { api } from "../api";
import { toast } from "../ui";
import { isPractice } from "../practice";

type Mail = { on: boolean; email: string; hour: number; state: "off" | "pending" | "confirmed" | "unavailable" };
const HOURS = Array.from({ length: 24 }, (_, h) => h);
const hourText = (h: number) => (h % 12 === 0 ? 12 : h % 12) + ":00 " + (h < 12 ? "AM" : "PM");

/** Owner: the day's totals by e-mail once a day. Off until the owner turns it on and confirms the address. */
export function OwnerMailSection() {
  const [m, setM] = useState<Mail | null>(null), [on, setOn] = useState(false), [email, setEmail] = useState(""), [hour, setHour] = useState(19), [busy, setBusy] = useState(false), [err, setErr] = useState("");
  const adopt = (v: Mail) => { setM(v); setOn(v.on); setEmail(v.email); setHour(v.hour); };
  useEffect(() => { if (!isPractice()) api<Mail>("/api/workshop/owner-mail").then(adopt).catch((e) => setErr((e as Error).message)); }, []);
  if (isPractice()) return null;
  const save = async () => {
    setBusy(true); setErr("");
    try { adopt(await api<Mail>("/api/workshop/owner-mail", { method: "PUT", body: JSON.stringify({ on, email: email.trim(), hour }) }, crypto.randomUUID())); toast(on ? t("Saved. Check your e-mail and press the confirm link.") : t("Saved")); }
    catch (e) { setErr((e as Error).message); } finally { setBusy(false); }
  };
  const test = async () => {
    setBusy(true); setErr("");
    try { await api("/api/workshop/owner-mail/test", { method: "POST", body: "{}" }, crypto.randomUUID()); toast(t("Test mail sent.")); }
    catch (e) { setErr((e as Error).message); } finally { setBusy(false); }
  };
  const changed = !m || m.on !== on || m.email !== email.trim() || m.hour !== hour;
  return (
    <section className="ws-sec">
      <h3><span className="ws-sec-ico"><Mail size={18} /></span>{t("Daily summary by e-mail")}</h3>
      <p className="muted">{t("One short mail a day: billed, money in, profit, what customers owe and what needs you. Off until you turn it on.")}</p>
      {m?.state === "unavailable" && <p className="ws-hint">{t("E-mail is not set up on this server yet.")}</p>}
      <label className="stock-check"><input type="checkbox" checked={on} disabled={busy || m?.state === "unavailable"} onChange={(e) => setOn(e.target.checked)} /> {t("Send me the daily summary")}</label>
      <label className="ws-field">{t("E-mail address")}<input type="email" inputMode="email" value={email} disabled={!on || busy} onChange={(e) => setEmail(e.target.value)} placeholder="owner@example.com" /></label>
      <label className="ws-field">{t("Send at (Sri Lanka time)")}<select value={hour} disabled={!on || busy} onChange={(e) => setHour(Number(e.target.value))}>{HOURS.map((h) => <option key={h} value={h}>{hourText(h)}</option>)}</select></label>
      {m?.state === "pending" && !changed && <p className="ws-hint" role="status">{t("Waiting for you to confirm. Open the mail from AWS Notifications and press Confirm subscription.")}</p>}
      {m?.state === "confirmed" && !changed && <p className="ws-hint" role="status">{t("Confirmed. The summary will arrive at this time every day.")}</p>}
      {err && <p role="alert" className="ws-err">{err}</p>}
      <span className="ws-bar">
        <button type="button" className="button primary small" disabled={busy || !changed} onClick={() => void save()}>{busy ? t("Saving…") : t("Save")}</button>
        {m?.state === "confirmed" && !changed && <button type="button" className="button secondary small" disabled={busy} onClick={() => void test()}>{t("Send a test mail")}</button>}
      </span>
    </section>
  );
}
