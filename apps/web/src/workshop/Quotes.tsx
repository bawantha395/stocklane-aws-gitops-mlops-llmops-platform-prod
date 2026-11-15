import { t } from "../i18n";
import { toast, askConfirm } from "../ui";
import { useEffect, useMemo, useRef, useState } from "react";
import { PhotoStrip } from "./Photos";
import { downloadQuotePdf, shareQuotePdf } from "./quotePdf";
import { Empty, Loading, Pill, dateOnly, lkr, num, regKey, useCommand, waLink, useDebounced, useLoad, useWs, type Quote, type QuoteWork, type Vehicle } from "./common";

const SECTIONS: QuoteWork["section"][] = ["Rem/Refit", "Repaint", "Other"];
const SECTION_LABEL: Record<string, string> = { "Rem/Refit": "Rem / Refit", Repaint: "Repaint", Other: "Other work" };

export function Quotes() {
  const { go } = useWs();
  const { data, error } = useLoad<Quote[]>("/api/workshop/quotes");
  const [filter, setFilter] = useState("ALL"), [q, setQ] = useState("");
  if (!data) return <Loading error={error} />;
  const needle = q.trim().toLowerCase();
  const shown = data.filter((x) => (filter === "ALL" || x.status === filter) && (!needle || [x.registration, x.insurer, x.claim_no, x.customer, x.number].join(" ").toLowerCase().includes(needle)));
  const count = (s: string) => data.filter((x) => x.status === s).length;
  return (
    <>
      <div className="ws-toolbar">
        <button className="button primary small ws-newq" onClick={() => go({ name: "quote", id: "new" })}>+ {t("New quotation")}</button>
        <div className="ws-chips">
          {([["ALL", t("All"), data.length], ["DRAFT", t("Draft"), count("DRAFT")], ["SENT", t("Sent"), count("SENT")], ["APPROVED", t("Approved"), count("APPROVED")]] as [string, string, number][]).map(([k, label, n]) => (
            <button key={k} className={"ws-chip" + (filter === k ? " chosen" : "")} onClick={() => setFilter(k)}><b>{n}</b> {label}</button>
          ))}
        </div>
        <input aria-label="Search quotations" placeholder={t("Search vehicle, insurer or claim")} value={q} onChange={(e) => setQ(e.target.value)} />
      </div>
      <div className="ws-qlist">
        {shown.map((x) => (
          <button key={x.id} className="ws-qitem" onClick={() => go({ name: "quote", id: x.id })}>
            <span className="ws-qmain"><b className="ws-qplate">{x.registration}</b><small>{[x.insurer, x.claim_no].filter(Boolean).join(" · ") || x.customer || x.vehicle || ""}</small><small className="muted">{x.number} · {dateOnly(x.updated_at || x.created_at)}{(x.rev_count || 1) > 1 ? " · v" + x.rev_count : ""}</small></span>
            <span className="ws-qside"><Pill s={x.status} /><b>LKR {lkr(x.total)}</b>{x.parts_unpriced > 0 && <small className="muted">{x.parts_unpriced} {t("parts TBC")}</small>}</span>
          </button>
        ))}
      </div>
      {!shown.length && <div className="ws-cards"><Empty action={{ label: "+ " + t("New quotation"), onClick: () => go({ name: "quote", id: "new" }) }}>{data.length ? "No quotations match." : "No quotations yet. Make the first one for an insurance claim."}</Empty></div>}
    </>
  );
}

export function QuotePage({ id }: { id: string }) {
  const isNew = id === "new";
  const { data, error } = useLoad<Quote>(isNew ? null : "/api/workshop/quotes/" + id);
  if (!isNew && !data) return <Loading error={error} />;
  return <QuoteForm key={data?.id || "new"} start={data} />;
}

type PartRow = { name: string; quantity: string; unit_price: string };
type WorkRow = { description: string; amount: string; section: QuoteWork["section"] };
const FIELDS = ["registration", "insurer", "insurer_branch", "claim_no", "policy_no", "customer", "phone", "vehicle", "issue", "valid_until"] as const;

function QuoteForm({ start }: { start?: Quote | null }) {
  const { go, business, owner } = useWs();
  const command = useCommand();
  const known = useLoad<Quote[]>("/api/workshop/quotes").data;
  const [quote, setQuote] = useState<Quote | null>(start || null);
  const take = (q: Quote | null) => ({ f: Object.fromEntries(FIELDS.map((k) => [k, (q?.[k] as string | undefined) || ""])) as Record<string, string>,
    parts: (q?.parts || []).map((p) => ({ name: p.name, quantity: String(p.quantity), unit_price: p.unit_price ? String(p.unit_price) : "" })) as PartRow[],
    work: (q?.labour || []).map((l) => ({ description: l.description, amount: String(l.amount), section: l.section || "Other" })) as WorkRow[], photos: q?.photos || [] });
  const first = useMemo(() => take(start || null), []); // eslint-disable-line react-hooks/exhaustive-deps
  const [f, setF] = useState(first.f), [parts, setParts] = useState(first.parts), [work, setWork] = useState(first.work), [photos, setPhotos] = useState(first.photos);
  const [dirty, setDirty] = useState(false), [busy, setBusy] = useState(false), [editing, setEditing] = useState(!start), [more, setMore] = useState(false), [error, setError] = useState("");
  const [need, setNeed] = useState("");
  const partsRef = useRef<HTMLElement>(null);
  const locked = quote?.status === "CONVERTED";
  const adopt = (q: Quote) => { const n = take(q); setQuote(q); setF(n.f); setParts(n.parts); setWork(n.work); setPhotos(n.photos); setDirty(false); };
  const set = (k: string, v: string) => { setF((x) => ({ ...x, [k]: v })); setDirty(true); };
  useEffect(() => {
    const warn = (e: BeforeUnloadEvent) => { if (dirty) e.preventDefault(); };
    window.addEventListener("beforeunload", warn); return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);
  // A known vehicle fills the empty customer fields (new quotations only).
  const key = useDebounced(regKey(f.registration || ""), 300);
  const car = useLoad<Vehicle>(!start && key.length >= 2 ? "/api/workshop/vehicles/" + key : null).data;
  useEffect(() => { if (car && !start) setF((x) => ({ ...x, customer: x.customer || car.owner || "", phone: x.phone || car.phone || "", vehicle: x.vehicle || car.make || "" })); }, [car?.id]); // eslint-disable-line react-hooks/exhaustive-deps
  const insurers = useMemo(() => Array.from(new Set((known || []).map((x) => x.insurer).filter(Boolean) as string[])), [known]);

  const lines = useMemo(() => ({
    parts: parts.filter((p) => p.name.trim()).map((p) => ({ name: p.name.trim(), quantity: num(p.quantity) || 1, unit_price: num(p.unit_price) })),
    labour: work.filter((w) => w.description.trim()).map((w) => ({ description: w.description.trim(), amount: num(w.amount), section: w.section })),
  }), [parts, work]);
  const by = (s: string) => lines.labour.filter((l) => l.section === s).reduce((a, l) => a + l.amount, 0);
  const partsTotal = lines.parts.reduce((a, p) => a + Math.round(p.quantity * p.unit_price * 100) / 100, 0);
  const total = lines.labour.reduce((a, l) => a + l.amount, 0) + partsTotal, unpriced = lines.parts.filter((p) => !p.unit_price).length;
  useEffect(() => { if (lines.parts.length || lines.labour.length) setNeed(""); }, [lines]);

  const body = () => ({ ...Object.fromEntries(FIELDS.map((k) => [k, f[k] || ""])), photos, parts: lines.parts, labour: lines.labour });
  const save = async (): Promise<Quote> => {
    const q = quote ? await command<Quote>("/api/workshop/quotes/" + quote.id, { ...body(), revision: quote.revision }, "PATCH") : await command<Quote>("/api/workshop/quotes", body());
    adopt(q); return q;
  };
  const run = async (work: () => Promise<void>) => { setBusy(true); setError(""); try { await work(); } catch (e) { setError((e as Error).message); toast((e as Error).message, { bad: true }); } finally { setBusy(false); } };
  const ready = () => { if (!f.registration.trim()) { setEditing(true); setError(t("Enter the vehicle number")); return false; } return true; };
  const onSave = () => { if (!ready()) return; void run(async () => { const was = !quote; const q = await save(); toast(t("Saved.")); if (was) go({ name: "quote", id: q.id }); }); };
  const status = (next: string) => run(async () => { const q = dirty || !quote ? await save() : quote; adopt(await command<Quote>("/api/workshop/quotes/" + q.id + "/status", { status: next, revision: q.revision })); toast(t("Saved.")); });
  const advance = () => {
    if (!ready()) return;
    if (!lines.parts.length && !lines.labour.length) { setNeed(t("Add at least one part or work line first.")); partsRef.current?.scrollIntoView({ block: "center", behavior: "smooth" }); return; }
    if (quote?.status === "APPROVED") return void convert();
    void status(!quote || quote.status === "DRAFT" || quote.status === "REJECTED" ? "SENT" : "APPROVED");
  };
  const convert = async () => {
    if (!(await askConfirm(t("A new job is made with these lines and photos. This quotation is kept on record."), { title: t("Make a job from this quotation?"), confirm: t("Make job") }))) return;
    void run(async () => {
      const q = dirty ? await save() : quote!;
      const r = await command<{ job_id: string }>("/api/workshop/quotes/" + q.id + "/convert", { revision: q.revision });
      go({ name: "job", id: r.job_id }, t("Job created. Add the parts and labour."));
    });
  };
  const revise = () => void run(async () => {
    const q = dirty ? await save() : quote!;
    adopt(await command<Quote>("/api/workshop/quotes/" + q.id + "/revise", { revision: q.revision, note: "" })); toast(t("New version started."));
  });
  const remove = async () => {
    if (!quote || !(await askConfirm(t("The quotation is deleted for good."), { title: t("Delete this quotation?"), confirm: t("Delete"), danger: true }))) return;
    void run(async () => { await command("/api/workshop/quotes/" + quote.id, {}, "DELETE"); go({ name: "quotes" }, t("Quotation deleted.")); });
  };
  const withSaved = async (use: (q: Quote) => void | Promise<void>) => { if (!ready()) return; await run(async () => { const q = dirty || !quote ? await save() : quote; await use(q); }); };
  const download = () => void withSaved((q) => downloadQuotePdf(q, business));
  const share = () => void withSaved(async (q) => {
    const text = (business.name || "") + " - " + t("Quotation") + " " + q.number + (q.insurer ? " - " + q.insurer : "") + " - " + q.registration;
    // Phones with a share sheet send the PDF itself (pick WhatsApp there); otherwise WhatsApp opens with the message and the PDF is saved to attach.
    if (!(await shareQuotePdf(q, business, text))) { downloadQuotePdf(q, business); toast(t("PDF saved. Send it from your files.")); window.open(waLink(q.phone || "", text), "_blank", "noopener"); }
  });

  const part = (i: number, p: Partial<PartRow>) => { setParts(parts.map((x, k) => (k === i ? { ...x, ...p } : x))); setDirty(true); };
  const line = (i: number, p: Partial<WorkRow>) => { setWork(work.map((x, k) => (k === i ? { ...x, ...p } : x))); setDirty(true); };
  const st = quote?.status || "DRAFT";
  const primary = locked ? null : st === "APPROVED" ? t("Make job") : st === "SENT" ? t("Mark approved") : t("Mark as sent");
  const summary: [string, string | undefined][] = [[t("Insurer"), [f.insurer, f.insurer_branch].filter(Boolean).join(", ")], [t("Claim number"), f.claim_no], [t("Policy number"), f.policy_no], [t("Customer"), f.customer], [t("Phone"), f.phone], [t("Make and model"), f.vehicle], [t("Valid until"), f.valid_until], [t("Damage / work details"), f.issue]];
  const moreItems: { label: string; run: () => void }[] = [];
  if (quote && !locked) moreItems.push({ label: t("Start a new version"), run: revise });
  if (quote && owner && !locked && st !== "REJECTED") moreItems.push({ label: t("Mark rejected"), run: () => void status("REJECTED") });
  if (quote && owner && !locked && st !== "DRAFT") moreItems.push({ label: t("Back to draft"), run: () => void status("DRAFT") });
  if (quote && owner && !locked) moreItems.push({ label: t("Delete"), run: () => void remove() });

  return (
    <div className="ws-job ws-quote">
      <div className="ws-job-head">
        <div><h2>{f.registration || t("New quotation")}</h2><p className="muted">{quote ? quote.number + " · " + t("version") + " " + quote.rev_no : t("Not saved yet")}</p></div>
        {quote && <Pill s={st} />}
      </div>
      {locked && quote?.job_id && <p className="ws-warn" role="status">{t("This quotation was made into a job.")} <button type="button" className="button secondary small" onClick={() => go({ name: "job", id: quote.job_id! })}>{t("Open job")}</button></p>}
      {!!quote?.history.length && (
        <details className="ws-card ws-versions"><summary>{t("Earlier versions")} ({quote.history.length})</summary>
          <ul>{quote.history.map((h) => <li key={h.rev_no}><b>v{h.rev_no}</b> · {dateOnly(h.at)} · LKR {lkr(h.total)}{h.note ? " · " + h.note : ""}</li>)}</ul>
        </details>
      )}
      <datalist id="ws-insurers">{insurers.map((n) => <option key={n} value={n} />)}</datalist>
      <section className="ws-card ws-cust">
        <div className="ws-cust-head"><h3>{t("Insurer and vehicle")}</h3>{!locked && quote && <button type="button" className="button secondary small" onClick={() => setEditing(!editing)}>{editing ? t("Done") : t("Edit")}</button>}</div>
        {editing && !locked ? (
          <div className="ws-grid2">
            <label className="ws-field">{t("Vehicle number")} *<input autoFocus={!start} autoCapitalize="characters" value={f.registration} onChange={(e) => set("registration", e.target.value)} placeholder="CAB-1234" /></label>
            <label className="ws-field">{t("Make and model")}<input value={f.vehicle} onChange={(e) => set("vehicle", e.target.value)} placeholder="Toyota Aqua" /></label>
            <label className="ws-field">{t("Insurer")}<input list="ws-insurers" value={f.insurer} onChange={(e) => set("insurer", e.target.value)} placeholder="Allianz Motor Insurance Lanka Limited" /></label>
            <label className="ws-field">{t("Branch")}<input value={f.insurer_branch} onChange={(e) => set("insurer_branch", e.target.value)} placeholder="Anuradhapura" /></label>
            <label className="ws-field">{t("Claim number")}<input value={f.claim_no} onChange={(e) => set("claim_no", e.target.value)} /></label>
            <label className="ws-field">{t("Policy number")}<input value={f.policy_no} onChange={(e) => set("policy_no", e.target.value)} /></label>
            <label className="ws-field">{t("Customer name")}<input value={f.customer} onChange={(e) => set("customer", e.target.value)} /></label>
            <label className="ws-field">{t("Contact number")}<input inputMode="tel" value={f.phone} onChange={(e) => set("phone", e.target.value)} /></label>
            <label className="ws-field">{t("Valid until")}<input type="date" value={f.valid_until} onChange={(e) => set("valid_until", e.target.value)} /></label>
            <label className="ws-field ws-wide">{t("Damage / work details")}<textarea rows={3} value={f.issue} onChange={(e) => set("issue", e.target.value)} placeholder="Front bumper and body kit damaged" /></label>
          </div>
        ) : (
          <dl className="ws-c-rows ws-cust-sum">{summary.filter(([, v]) => v).map(([k, v]) => <div className="ws-c-row" key={k}><dt>{k}</dt><dd>{v}</dd></div>)}</dl>
        )}
      </section>
      <section className="ws-card ws-photos">
        <h3>{t("Damage photos")} <small>({t("optional")})</small></h3>
        <PhotoStrip ids={photos} disabled={locked} onAdd={(p) => { setPhotos((x) => [...x, p]); setDirty(true); }} onRemove={(p) => { setPhotos((x) => x.filter((y) => y !== p)); setDirty(true); }} />
      </section>
      {SECTIONS.map((s) => (
        <section className="ws-card" key={s}>
          <h3>{t(SECTION_LABEL[s]!)}</h3>
          {work.map((w, i) => w.section !== s ? null : (
            <div className="ws-line labour" key={i}>
              <input className="ws-l-name" disabled={locked} aria-label={t("Work description")} placeholder={t("What needs to be done")} value={w.description} onChange={(e) => line(i, { description: e.target.value })} />
              <input className="ws-l-price" disabled={locked} aria-label={t("Amount")} inputMode="decimal" placeholder={t("Amount")} value={w.amount} onChange={(e) => line(i, { amount: e.target.value.replace(/[^0-9.]/g, "") })} />
              {!locked && <button className="ws-l-del" aria-label={t("Remove")} onClick={() => { setWork(work.filter((_, k) => k !== i)); setDirty(true); }}>×</button>}
            </div>
          ))}
          {!locked && <div className="ws-add"><button className="button secondary small" onClick={() => { setWork([...work, { description: "", amount: "", section: s }]); setDirty(true); }}>+ {t("Add line")}</button></div>}
        </section>
      ))}
      <section className="ws-card" ref={partsRef}>
        <h3>{t("Spare parts")}</h3>
        {parts.map((p, i) => (
          <div className="ws-line" key={i}>
            <input className="ws-l-name" disabled={locked} aria-label={t("Part name")} placeholder={t("Part name")} value={p.name} onChange={(e) => part(i, { name: e.target.value })} />
            <input className="ws-l-qty" disabled={locked} aria-label="Quantity" inputMode="decimal" placeholder={t("Qty")} value={p.quantity} onChange={(e) => part(i, { quantity: e.target.value })} />
            <input className="ws-l-price" disabled={locked} aria-label="Unit price" inputMode="decimal" placeholder="TBC" value={p.unit_price} onChange={(e) => part(i, { unit_price: e.target.value.replace(/[^0-9.]/g, "") })} />
            <output className="ws-l-total">{num(p.unit_price) ? lkr(num(p.quantity || "1") * num(p.unit_price)) : "TBC"}</output>
            {!locked && <button className="ws-l-del" aria-label={t("Remove")} onClick={() => { setParts(parts.filter((_, k) => k !== i)); setDirty(true); }}>×</button>}
          </div>
        ))}
        {!locked && <div className="ws-add"><button className="button secondary small" onClick={() => { setParts([...parts, { name: "", quantity: "1", unit_price: "" }]); setDirty(true); }}>+ {t("Add part")}</button></div>}
        {unpriced > 0 && <p className="muted ws-tbc">{unpriced} {unpriced === 1 ? t("part has no price yet (TBC). Start a new version when you know it.") : t("parts have no price yet (TBC). Start a new version when you know the prices.")}</p>}
        <dl className="ws-sum">
          {SECTIONS.filter((s) => by(s) > 0 || s !== "Other").map((s) => <div key={s}><dt>{t(SECTION_LABEL[s]!)}</dt><dd>{lkr(by(s))}</dd></div>)}
          <div><dt>{t("Spare parts")}</dt><dd>{lkr(partsTotal)}</dd></div>
          <div className="grand"><dt>{t("Total (LKR)")}</dt><dd>{lkr(total)}</dd></div>
        </dl>
      </section>
      <section className="ws-card ws-send">
        <h3>{t("Send to the insurer")}</h3>
        <div className="ws-actions">
          <button className="button secondary" disabled={busy} onClick={download}>{t("Download PDF")}</button>
          <button className="button secondary" disabled={busy} onClick={share}>{t("Share on WhatsApp")}</button>
        </div>
      </section>
      {error && <p role="alert" className="stock-error">{error}</p>}
      <div className="ws-actionbar">
        {need && <p className="ws-need" role="status">{need}</p>}
        <span className="ws-actionbar-total"><small>{dirty ? t("Unsaved changes") : t("Total")}</small><b>LKR {lkr(total)}</b></span>
        <span className="ws-actionbar-btns">
          {moreItems.length > 0 && (
            <span className="ws-more">
              <button type="button" className="button secondary" aria-label={t("More")} aria-expanded={more} disabled={busy} onClick={() => setMore(!more)}>⋯</button>
              {more && <div className="ws-more-menu" role="menu">{moreItems.map((m) => <button key={m.label} type="button" role="menuitem" onClick={() => { setMore(false); m.run(); }}>{m.label}</button>)}</div>}
            </span>
          )}
          {!locked && <button className="button secondary" disabled={busy || (!dirty && !!quote)} onClick={onSave}>{t("Save")}</button>}
          {primary && owner && <button className="button primary" disabled={busy} onClick={advance}>{primary}</button>}
        </span>
      </div>
    </div>
  );
}
