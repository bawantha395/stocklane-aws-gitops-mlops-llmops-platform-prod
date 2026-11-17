import { useEffect, useState } from "react";
import { Building2 } from "lucide-react";
import { t } from "../i18n";
import { toast, askConfirm } from "../ui";
import { api } from "../api";
import { isPractice } from "../practice";

type Shop = { id: string; name: string; owner_email: string; suspended: boolean; invited: boolean; created_at: string };

/** Only for the person who runs this deployment (group PLATFORM): open a new workshop, close or reopen one. Shows nothing to anyone else. */
export function PlatformSection() {
  const [shops, setShops] = useState<Shop[] | null>(null);
  const [f, setF] = useState({ id: "", name: "", owner_email: "" }), [busy, setBusy] = useState(false), [error, setError] = useState("");
  const load = () => api<Shop[]>("/api/platform/shops").then(setShops).catch(() => setShops(null));
  useEffect(() => { if (!isPractice()) void load(); }, []);
  if (!shops) return null;
  const add = async () => {
    setBusy(true); setError("");
    try {
      const made = await api<Shop>("/api/platform/shops", { method: "POST", body: JSON.stringify(f) });
      toast(made.invited ? t("Workshop opened. The owner gets an e-mail with a temporary password.") : t("Workshop opened. Add its owner to the groups OWNER and SHOP_{id} in Cognito.", { id: made.id }));
      setF({ id: "", name: "", owner_email: "" }); await load();
    } catch (e) { setError((e as Error).message); toast((e as Error).message, { bad: true }); } finally { setBusy(false); }
  };
  const flip = async (s: Shop) => {
    if (!s.suspended && !(await askConfirm(t("Nobody in this workshop can use Lifta until you reopen it. Its data stays."), { title: t("Close {name}?", { name: s.name }), confirm: t("Close workshop"), danger: true }))) return;
    try { await api("/api/platform/shops/" + s.id + "/suspend", { method: "POST", body: JSON.stringify({ suspended: !s.suspended }) }); await load(); }
    catch (e) { toast((e as Error).message, { bad: true }); }
  };
  return (
    <section className="ws-sec">
      <h3><span className="ws-sec-ico"><Building2 size={18} /></span>{t("Workshops on this system")}</h3>
      {shops.length === 0 && <small className="ws-hint">{t("No workshops registered yet. Sign-ins without a workshop use the first one.")}</small>}
      {shops.map((s) => (
        <div className="ws-list-row" key={s.id}>
          <span style={{ flex: 1, minWidth: 0 }}><strong>{s.name}</strong> <small>{s.id}{s.owner_email ? " · " + s.owner_email : ""}{s.suspended ? " · " + t("Closed") : ""}</small></span>
          <button type="button" className="button secondary small" onClick={() => void flip(s)}>{s.suspended ? t("Reopen") : t("Close")}</button>
        </div>
      ))}
      <label className="ws-field">{t("Workshop name")}<input value={f.name} maxLength={80} onChange={(e) => setF((x) => ({ ...x, name: e.target.value, id: x.id || "" }))} /></label>
      <label className="ws-field">{t("Workshop ID")}<input value={f.id} maxLength={31} placeholder="ganga-motors" onChange={(e) => setF((x) => ({ ...x, id: e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, "") }))} /></label>
      <small className="ws-hint">{t("Small letters, numbers and dashes. It cannot be changed later.")}</small>
      <label className="ws-field">{t("Owner e-mail")}<input type="email" value={f.owner_email} maxLength={180} onChange={(e) => setF((x) => ({ ...x, owner_email: e.target.value }))} /></label>
      {error && <p role="alert" className="ws-err">{error}</p>}
      <button type="button" className="button small" disabled={busy || !f.id || !f.name} onClick={() => void add()}>{busy ? t("Saving…") : t("Open workshop")}</button>
    </section>
  );
}
