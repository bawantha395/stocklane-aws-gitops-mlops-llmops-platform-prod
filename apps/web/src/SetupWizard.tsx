import { useEffect, useState } from "react";
import { Check } from "lucide-react";
import { api } from "./api";
import { setBusinessName } from "./businessName";
import { t, useLang } from "./i18n";

type Biz = { name: string; address: string; phone: string; email: string; reg_no: string; bank: string; footer: string; tax_name: string; tax_rate: number; mechanic_discount_pct?: number };
const FLAG = "lifta.setup";
export const setupDone = () => { try { return localStorage.getItem(FLAG) === "done"; } catch { return true; } };
const finish = () => { try { localStorage.setItem(FLAG, "done"); } catch { /* private mode */ } };

/** First sign-in of a new owner: name the business, then offer practice or the first part. Shown once. */
export function SetupWizard({ onClose, onPractice, onFirstPart }: { onClose: () => void; onPractice: () => void; onFirstPart: () => void }) {
  useLang();
  const [biz, setBiz] = useState<Biz | null>(null);
  const [step, setStep] = useState(0);
  const [f, setF] = useState({ name: "", phone: "", address: "" });
  const [busy, setBusy] = useState(false), [error, setError] = useState("");

  useEffect(() => {
    let live = true;
    api<Biz>("/api/workshop/settings").then((b) => {
      if (!live) return;
      // A business that already has a real name has been set up: never show this again.
      if (b.name && b.name !== "Workshop Suite") { finish(); onClose(); return; }
      setBiz(b); setF({ name: "", phone: b.phone || "", address: b.address || "" });
    }).catch(() => { if (live) onClose(); });
    return () => { live = false; };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  if (!biz) return null;
  const skip = () => { finish(); onClose(); };
  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!f.name.trim()) { setError(t("Enter your business name")); return; }
    setBusy(true); setError("");
    try {
      await api("/api/workshop/settings", { method: "PUT", body: JSON.stringify({ ...biz, name: f.name.trim(), phone: f.phone.trim(), address: f.address.trim() }) }, crypto.randomUUID());
      setBusinessName(f.name.trim()); setStep(1);
    } catch (err) { setError((err as Error).message); } finally { setBusy(false); }
  };

  return (
    <div className="sw-back">
      <section className="sw" role="dialog" aria-modal="true" aria-label={t("Set up your workshop")}>
        <div className="sw-dots" aria-hidden="true"><i className={step === 0 ? "on" : "done"} /><i className={step === 1 ? "on" : ""} /></div>
        {step === 0 ? (
          <form onSubmit={save}>
            <p className="eyebrow">{t("WELCOME TO LIFTA")}</p>
            <h2>{t("Set up your workshop")}</h2>
            <p className="sw-sub">{t("This is printed at the top of every invoice. You can change it later in Settings.")}</p>
            <label className="sw-field">{t("Business name")} *<input autoFocus value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} placeholder="Ganga Motors" /></label>
            <label className="sw-field">{t("Phone")}<input inputMode="tel" value={f.phone} onChange={(e) => setF({ ...f, phone: e.target.value })} placeholder="011 234 5678" /></label>
            <label className="sw-field">{t("Address")}<input value={f.address} onChange={(e) => setF({ ...f, address: e.target.value })} placeholder="12 Galle Road, Colombo 03" /></label>
            {error && <p role="alert" className="stock-error">{error}</p>}
            <div className="sw-actions">
              <button type="button" className="button secondary" onClick={skip}>{t("Skip for now")}</button>
              <button className="button primary" disabled={busy}>{busy ? t("Saving…") : t("Continue")}</button>
            </div>
          </form>
        ) : (
          <div>
            <span className="sw-check"><Check size={26} /></span>
            <h2>{t("You are set up")}</h2>
            <p className="sw-sub">{t("What would you like to do first?")}</p>
            <button className="sw-opt primary" onClick={() => { finish(); onClose(); onPractice(); }}><strong>{t("Try practice (2 minutes)")}</strong><small>{t("Short missions with dummy data. Nothing is saved.")}</small></button>
            <button className="sw-opt" onClick={() => { finish(); onClose(); onFirstPart(); }}><strong>{t("Add my first part")}</strong><small>{t("Take a photo of a part. Lifta reads the label.")}</small></button>
            <button className="sw-link" onClick={skip}>{t("I will look around myself")}</button>
          </div>
        )}
      </section>
    </div>
  );
}
