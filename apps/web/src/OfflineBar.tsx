import { useState } from "react";
import { CloudOff } from "lucide-react";
import { t } from "./i18n";
import { toast } from "./ui";
import { discard, flush, retryAll, useQueue } from "./offline";

/** Shows what is saved on this phone and not sent yet (a job, a part taken out), and what the server refused. */
export function OfflineBar() {
  const q = useQueue(), [busy, setBusy] = useState(false), [open, setOpen] = useState(false);
  if (q.length === 0) return null;
  const failed = q.filter((x) => x.error).length, waiting = q.length - failed;
  const send = async () => {
    setBusy(true);
    try { const r = await retryAll(); toast(r.sent ? t("{n} sent.", { n: r.sent }) : t("Still no connection. They stay saved on this phone."), { bad: !r.sent }); } finally { setBusy(false); }
  };
  return (
    <section className="offline-bar" role="status" aria-live="polite">
      <div className="offline-head">
        <CloudOff size={18} aria-hidden="true" />
        <span>{waiting > 0 ? t("{n} waiting to send", { n: waiting }) : ""}{waiting > 0 && failed > 0 ? " · " : ""}{failed > 0 ? t("{n} refused", { n: failed }) : ""}</span>
        <button type="button" className="button secondary small" disabled={busy} onClick={() => void send()}>{busy ? t("Sending…") : t("Send now")}</button>
        <button type="button" className="stock-link" onClick={() => setOpen((v) => !v)}>{open ? t("Hide") : t("Show")}</button>
      </div>
      {open && (
        <ul className="offline-list">
          {q.map((x) => (
            <li key={x.key}>
              <span><b>{x.label}</b><small>{new Date(x.at).toLocaleString()}{x.error ? " · " + x.error : ""}</small></span>
              <button type="button" className="button secondary small" onClick={() => { discard(x.key); void flush(); }}>{t("Discard")}</button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
