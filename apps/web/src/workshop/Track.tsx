import { useEffect, useState } from "react";
import { config } from "../api";
import { t } from "../i18n";
import { QrImg } from "./QrImg";

type Groups = { before: string[]; after: string[]; old: string[] };
type Quote = { number: string; type: string; registration: string; vehicle: string; customer: string; status: string; valid_until: string; expired: boolean; parts: { name: string; quantity: number; amount: number }[]; labour: { description: string; amount: number }[]; total: number; can_decide: boolean; decision: null | { decision: string; name: string; at: string } };
type Page = {
  kind: "job" | "quote"; quote?: Quote;
  shop: { name: string; address: string; phone: string };
  job: { job_no: string; registration: string; vehicle: string; summary: string; status: string; stage: string; created_at: string; customer: string };
  work: { parts: { name: string; quantity: number; amount: number }[]; labour: { description: string; amount: number }[]; discount: number; total: number };
  photos: Groups; expires: string;
  invoice: null | { number: string; status: string; total: number; paid: number; balance: number; bank: string; qr_url: string };
};
const STEPS: [string, string][] = [["WAITING", "Received"], ["IN_PROGRESS", "In progress"], ["PARTS", "Waiting for parts"], ["READY", "Ready for pickup"]];
const money = (n: number) => "LKR " + Number(n).toLocaleString("en-LK", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const base = () => (config.apiBase || "") + "/api/public/track/";

/** What the customer sees from their private link. No sign-in; it asks the server for this one job only. */
export function Track() {
  const token = decodeURIComponent(location.pathname.replace(/^\/t\//, "").split("/")[0] || "");
  const [page, setPage] = useState<Page | null>(null), [state, setState] = useState<"load" | "gone" | "wait" | "ok">("load");
  const [pics, setPics] = useState<{ id: string; kind: keyof Groups; src: string }[]>([]);
  const [name, setName] = useState(""), [answer, setAnswer] = useState<{ ok: boolean; text: string } | null>(null), [sending, setSending] = useState(false);
  useEffect(() => {
    let live = true;
    fetch(base() + encodeURIComponent(token), { headers: { Accept: "application/json" } })
      .then(async (r) => { if (!live) return; if (r.status === 429) { setState("wait"); return; } if (!r.ok) { setState("gone"); return; } setPage(await r.json()); setState("ok"); })
      .catch(() => live && setState("gone"));
    return () => { live = false; };
  }, [token]);
  useEffect(() => {
    if (!page) return;
    let live = true;
    const all = (Object.keys(page.photos) as (keyof Groups)[]).flatMap((k) => page.photos[k].map((id) => ({ id, kind: k })));
    void Promise.all(all.map((x) => fetch(base() + encodeURIComponent(token) + "/photo/" + x.id).then((r) => r.ok ? r.json() : null).then((j) => j ? { ...x, src: "data:image/jpeg;base64," + j.data } : null).catch(() => null)))
      .then((got) => live && setPics(got.filter((x): x is { id: string; kind: keyof Groups; src: string } => !!x)));
    return () => { live = false; };
  }, [page, token]);
  if (state === "load") return <main className="track"><p aria-busy="true">{t("Loading…")}</p></main>;
  if (state === "wait") return <main className="track"><h1>{t("Please wait a few minutes")}</h1><p>{t("Too many tries. Open the link again in a little while.")}</p></main>;
  if (state === "gone" || !page) return <main className="track"><h1>{t("This link is not working")}</h1><p>{t("It may have expired or been switched off. Please ask the workshop for a new one.")}</p></main>;
  const decide = async (decision: "APPROVE" | "DECLINE") => {
    setSending(true); setAnswer(null);
    try {
      const r = await fetch(base() + encodeURIComponent(token) + "/decision", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ decision, name }) });
      const j = await r.json().catch(() => ({}));
      if (r.ok) { setAnswer({ ok: true, text: decision === "APPROVE" ? t("Thank you. You approved this estimate.") : t("Thank you. You declined this estimate.") }); setPage({ ...page, quote: { ...page.quote!, can_decide: false, status: decision === "APPROVE" ? "APPROVED" : "REJECTED", decision: { decision, name, at: new Date().toISOString() } } }); }
      else setAnswer({ ok: false, text: (j as { message?: string }).message || t("This did not work. Please try again.") });
    } catch { setAnswer({ ok: false, text: t("No connection. Please try again.") }); } finally { setSending(false); }
  };
  const gallery = (
    <>{(["before", "after", "old"] as (keyof Groups)[]).map((k) => { const mine = pics.filter((p) => p.kind === k); return mine.length ? <section key={k} className="track-card"><h2>{t(k === "before" ? "Photos" : k === "after" ? "After the work" : "Old parts")}</h2><div className="track-photos">{mine.map((p) => <img key={p.id} src={p.src} alt={t("Vehicle photo")} />)}</div></section> : null; })}</>
  );
  if (page.kind === "quote" && page.quote) {
    const q = page.quote;
    return (
      <main className="track">
        <header><p className="eyebrow">{page.shop.name}</p><h1>{q.registration}</h1><p className="muted">{[q.type === "QUOTATION" ? t("Quotation") : t("Estimate"), q.number, q.vehicle].filter(Boolean).join(" · ")}</p></header>
        {q.customer && <p>{t("Hello")} {q.customer}.</p>}
        <section className="track-card">
          <h2>{t("Work and price")}</h2>
          {q.parts.map((p, i) => <div key={"p" + i} className="track-row"><span>{p.quantity} × {p.name}</span><b>{p.amount > 0 ? money(p.amount) : t("to be confirmed")}</b></div>)}
          {q.labour.map((l, i) => <div key={"l" + i} className="track-row"><span>{l.description}</span><b>{money(l.amount)}</b></div>)}
          <div className="track-row total"><span>{t("Total")}</span><b>{money(q.total)}</b></div>
          {q.valid_until && <small className="muted">{q.expired ? t("This offer ran out on {d}.", { d: q.valid_until }) : t("Valid until {d}.", { d: q.valid_until })}</small>}
        </section>
        {gallery}
        {q.decision ? <section className="track-card"><h2>{q.decision.decision === "APPROVE" ? t("Approved") : t("Declined")}</h2><p>{q.decision.name}</p></section>
          : q.can_decide ? (
            <section className="track-card">
              <h2>{t("Your answer")}</h2>
              <label className="ws-field">{t("Your name")}<input value={name} maxLength={60} autoComplete="name" onChange={(e) => setName(e.target.value)} /></label>
              <div className="ws-contact">
                <button className="button primary" disabled={sending || name.trim().length < 2} onClick={() => void decide("APPROVE")}>{t("Approve")}</button>
                <button className="button secondary" disabled={sending || name.trim().length < 2} onClick={() => void decide("DECLINE")}>{t("Decline")}</button>
              </div>
              <small className="muted">{t("You can answer once. Your name and the time are saved.")}</small>
            </section>
          ) : <section className="track-card"><p>{q.expired ? t("This offer has run out. Please contact the workshop.") : t("The workshop is still preparing this. Please check again later.")}</p></section>}
        {answer && <p role="status" className={answer.ok ? "" : "stock-error"}>{answer.text}</p>}
        <footer className="muted"><p>{[page.shop.address, page.shop.phone].filter(Boolean).join(" · ")}</p><p>{t("This page works until {d}.", { d: page.expires })}</p></footer>
      </main>
    );
  }
  const at = Math.max(0, STEPS.findIndex(([k]) => k === page.job.stage));
  const inv = page.invoice;
  return (
    <main className="track">
      <header><p className="eyebrow">{page.shop.name}</p><h1>{page.job.registration}</h1><p className="muted">{[page.job.vehicle, page.job.summary].filter(Boolean).join(" · ")}</p></header>
      {page.job.customer && <p>{t("Hello")} {page.job.customer}.</p>}
      <section className="track-card" aria-label={t("Where is your vehicle?")}>
        <ol className="track-steps">
          {STEPS.map(([k, label], i) => <li key={k} className={i < at ? "done" : i === at ? "now" : ""} aria-current={i === at ? "step" : undefined}><span aria-hidden="true">{i < at ? "✓" : i + 1}</span>{t(label)}</li>)}
        </ol>
        {inv && <p><b>{t("Your bill is ready.")}</b></p>}
      </section>
      {gallery}
      <section className="track-card">
        <h2>{inv ? t("Bill") + " " + inv.number : t("Work and price so far")}</h2>
        {page.work.parts.map((p, i) => <div key={"p" + i} className="track-row"><span>{p.quantity} × {p.name}</span><b>{money(p.amount)}</b></div>)}
        {page.work.labour.map((l, i) => <div key={"l" + i} className="track-row"><span>{l.description}</span><b>{money(l.amount)}</b></div>)}
        {page.work.discount > 0 && <div className="track-row"><span>{t("Discount")}</span><b>- {money(page.work.discount)}</b></div>}
        <div className="track-row total"><span>{t("Total")}</span><b>{money(page.work.total)}</b></div>
        {!inv && <small className="muted">{t("This price can still change until the bill is made.")}</small>}
      </section>
      {inv && (
        <section className="track-card">
          <h2>{inv.status === "PAID" ? t("Paid. Thank you!") : t("To pay")}</h2>
          <div className="track-row"><span>{t("Paid so far")}</span><b>{money(inv.paid)}</b></div>
          {inv.balance > 0 && <div className="track-row total"><span>{t("Balance")}</span><b>{money(inv.balance)}</b></div>}
          {inv.balance > 0 && inv.bank && <p className="muted">{inv.bank}</p>}
          {inv.balance > 0 && inv.qr_url && <QrImg text={inv.qr_url} size={140} />}
        </section>
      )}
      <footer className="muted"><p>{[page.shop.address, page.shop.phone].filter(Boolean).join(" · ")}</p><p>{t("This page works until {d}.", { d: page.expires })}</p></footer>
    </main>
  );
}
