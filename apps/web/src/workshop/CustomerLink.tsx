import { useEffect, useState } from "react";
import { t } from "../i18n";
import { isPractice } from "../practice";
import { toast, askConfirm } from "../ui";
import { QrImg } from "./QrImg";
import { useCommand, useLoad, waLink } from "./common";

type Link = { token: string; expires: string; views: number } | null;

/** A private page for the customer: where the job is, the price, and the bill. Make it, send it on WhatsApp, or switch it off. */
export function CustomerLink({ jobId, phone, name, shop, kind = "job" }: { jobId: string; phone: string; name: string; shop: string; kind?: "job" | "quote" }) {
  const base = (kind === "quote" ? "/api/workshop/quotes/" : "/api/workshop/jobs/") + jobId + "/link";
  const { data, reload } = useLoad<{ link: Link }>(base);
  const command = useCommand();
  const [link, setLink] = useState<Link>(null), [busy, setBusy] = useState(false);
  useEffect(() => { if (data) setLink(data.link); }, [data]);
  const url = link ? location.origin + "/t/" + link.token : "";
  const make = async () => { setBusy(true); try { const r = await command<{ link: Link }>(base, {}); setLink(r.link); } catch (e) { toast((e as Error).message); } finally { setBusy(false); } };
  const stop = async () => {
    if (!(await askConfirm(t("Switch off this link? The customer will no longer be able to open it."), { confirm: t("Switch off") }))) return;
    setBusy(true); try { await command(base + "/revoke", {}); setLink(null); await reload(); } catch (e) { toast((e as Error).message); } finally { setBusy(false); }
  };
  const copy = async () => { try { await navigator.clipboard.writeText(url); toast(t("Link copied")); } catch { toast(url); } };
  const msg = "Hello " + (name || "") + ", " + (kind === "quote" ? "your estimate is here, you can approve it on this page: " : "you can follow your vehicle here: ") + url + " - " + shop;
  return (
    <section className="ws-card" aria-label={t("Customer link")}>
      <h3>{t("Customer link")}</h3>
      {!link ? (
        <>
          <small className="muted">{kind === "quote" ? t("A private page for the customer to see this estimate and approve or decline it. No sign-in needed.") : t("A private page for the customer: where the job is, the price and the bill. No sign-in needed.")}</small>
          <div><button type="button" className="button secondary small" disabled={busy} onClick={() => void make()}>{t("Make customer link")}</button></div>
        </>
      ) : (
        <>
          <input readOnly value={url} aria-label={t("Customer link")} onFocus={(e) => e.currentTarget.select()} />
          <div className="ws-contact">
            {phone && <a className="button primary small" target="_blank" rel="noopener noreferrer" href={waLink(phone, msg)} onClick={(e) => { if (isPractice()) { e.preventDefault(); toast(t("Practice: WhatsApp would open here with the message ready.")); } }}>WhatsApp</a>}
            <button type="button" className="button secondary small" onClick={() => void copy()}>{t("Copy")}</button>
            <button type="button" className="button secondary small" disabled={busy} onClick={() => void stop()}>{t("Switch off")}</button>
          </div>
          <QrImg text={url} size={96} />
          <small className="muted">{t("Works until {d}. Opened {n} times.", { d: link.expires, n: link.views })}</small>
        </>
      )}
    </section>
  );
}
