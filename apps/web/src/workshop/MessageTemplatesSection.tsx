import { useEffect, useRef, useState } from "react";
import { MessageCircle } from "lucide-react";
import { t } from "../i18n";
import { toast } from "../ui";
import { api } from "../api";

type View = { templates: Record<string, { en: string; si: string }>; defaults: Record<string, { en: string; si: string }>; variables: string[] };
const KIND: [string, string][] = [["READY", "Vehicle ready"], ["SERVICE", "Service due"], ["PAYMENT", "Payment reminder"], ["THANKS", "Thank you"], ["BIRTHDAY", "Birthday"], ["WINBACK", "We miss you"]];
const SAMPLE: Record<string, string> = { name: "Nimal", shop: "Your Shop", vehicle: "CAB-1234", bill: "INV-0012", amount: "5,490.00", date: "on 2027-02-14", review: "", link: "https://your-site/t/…" };
const preview = (s: string) => s.replace(/\{(\w+)\}/g, (m, k: string) => (k in SAMPLE ? SAMPLE[k]! : m)).replace(/\s+/g, " ").trim();

/** Owner: the words of each WhatsApp message, English and Sinhala. {name} {vehicle} ... are filled in per customer. */
export function MessageTemplatesSection({ sinhala }: { sinhala: boolean }) {
  const [view, setView] = useState<View | null>(null), [text, setText] = useState<Record<string, { en: string; si: string }>>({});
  const [busy, setBusy] = useState(false), [error, setError] = useState(""), [focus, setFocus] = useState<{ k: string; l: "en" | "si" } | null>(null);
  const refs = useRef<Record<string, HTMLTextAreaElement | null>>({});
  useEffect(() => { api<View>("/api/workshop/messages/templates").then((v) => { setView(v); setText(v.templates); }).catch((e) => setError((e as Error).message)); }, []);
  if (!view) return error ? <p className="stock-error" role="alert">{error}</p> : null;
  const langs: ("en" | "si")[] = sinhala ? ["en", "si"] : ["en"];
  const edit = (k: string, l: "en" | "si", v: string) => setText((x) => ({ ...x, [k]: { ...x[k]!, [l]: v } }));
  const insert = (v: string) => {
    if (!focus) { toast(t("Tap the message first.")); return; }
    const el = refs.current[focus.k + focus.l], cur = text[focus.k]![focus.l], at = el ? el.selectionStart : cur.length;
    edit(focus.k, focus.l, cur.slice(0, at) + "{" + v + "}" + cur.slice(at));
  };
  const save = async () => {
    setBusy(true); setError("");
    try { await api("/api/workshop/messages/templates", { method: "PUT", body: JSON.stringify({ templates: text }) }, crypto.randomUUID()); toast(t("Messages saved")); }
    catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  };
  return (
    <section className="ws-sec">
      <h3><span className="ws-sec-ico"><MessageCircle size={18} /></span>{t("Customer messages")}</h3>
      <small className="ws-hint">{t("The words of each WhatsApp message. Tap a word below to add it where the cursor is; it is filled in for each customer.")}</small>
      <div className="ws-contact">{view.variables.map((v) => <button key={v} type="button" className="button secondary small" onClick={() => insert(v)}>{"{" + v + "}"}</button>)}</div>
      {KIND.map(([k, label]) => (
        <div key={k} className="ws-field">
          <b>{t(label)}</b>
          {langs.map((l) => (
            <div key={l}>
              <textarea ref={(el) => { refs.current[k + l] = el; }} rows={3} maxLength={600} aria-label={t(label) + (l === "si" ? " (සිං)" : " (EN)")} value={text[k]?.[l] || ""} onFocus={() => setFocus({ k, l })} onChange={(e) => edit(k, l, e.target.value)} />
              <small className="ws-hint">{preview(text[k]?.[l] || "")}</small>
              {text[k]?.[l] !== view.defaults[k]![l] && <button type="button" className="button secondary small" onClick={() => edit(k, l, view.defaults[k]![l])}>{t("Use the standard words")}</button>}
            </div>
          ))}
        </div>
      ))}
      {error && <p className="stock-error" role="alert">{error}</p>}
      <button type="button" className="button primary" disabled={busy} onClick={() => void save()}>{busy ? t("Saving…") : t("Save messages")}</button>
    </section>
  );
}
