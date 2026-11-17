import { useEffect, useState } from "react";
import { Users } from "lucide-react";
import { t } from "../i18n";
import { toast, askConfirm } from "../ui";
import { api } from "../api";
import { isPractice } from "../practice";

type Person = { id: string; email: string; roles: string[]; active: boolean; pending: boolean };
const ROLES = ["OWNER", "ADMIN", "STOREKEEPER", "MECHANIC"];
const NAME: Record<string, string> = { OWNER: "Owner", ADMIN: "Admin", STOREKEEPER: "Store keeper", MECHANIC: "Mechanic" };

/** Owner: who can sign in to this workshop and in which role. */
export function StaffSection() {
  const [people, setPeople] = useState<Person[] | null>(null), [note, setNote] = useState("");
  const [f, setF] = useState({ email: "", role: "MECHANIC" }), [busy, setBusy] = useState(false);
  useEffect(() => { if (!isPractice()) api<Person[]>("/api/workshop/staff").then(setPeople).catch((e) => setNote((e as Error).message)); }, []);
  if (isPractice()) return null;
  const run = async (work: () => Promise<Person[]>, done: string) => {
    setBusy(true);
    try { setPeople(await work()); toast(done); return true; } catch (e) { toast((e as Error).message, { bad: true }); return false; } finally { setBusy(false); }
  };
  const invite = async () => { if (await run(() => api<Person[]>("/api/workshop/staff", { method: "POST", body: JSON.stringify(f) }), t("Added. They get an e-mail with a temporary password."))) setF({ email: "", role: "MECHANIC" }); };
  const role = (p: Person, r: string) => run(() => api<Person[]>("/api/workshop/staff/" + encodeURIComponent(p.id) + "/role", { method: "POST", body: JSON.stringify({ role: r }) }), t("Role changed"));
  const remove = async (p: Person) => {
    if (!(await askConfirm(t("They are signed out and cannot sign in again. Their name stays on old jobs and bills. You can add them back later."), { title: t("Remove {name}?", { name: p.email }), confirm: t("Remove"), danger: true }))) return;
    await run(() => api<Person[]>("/api/workshop/staff/" + encodeURIComponent(p.id), { method: "DELETE" }), t("Removed"));
  };
  return (
    <section className="ws-sec" data-tour="staff">
      <h3><span className="ws-sec-ico"><Users size={18} /></span>{t("Staff sign-ins")}</h3>
      {note && <small className="ws-hint">{note}</small>}
      {people?.map((p) => (
        <div className={"ws-staff" + (p.active ? "" : " off")} key={p.id}>
          <span className="ws-staff-who"><strong>{p.email}</strong><small>{!p.active ? t("Removed") : p.pending ? t("Invited, has not signed in yet") : ""}</small></span>
          {p.active ? (
            <>
              <select aria-label={t("Role")} disabled={busy} value={p.roles[0]} onChange={(e) => void role(p, e.target.value)}>{ROLES.map((r) => <option key={r} value={r}>{t(NAME[r])}</option>)}</select>
              <button type="button" className="ws-l-del" aria-label={t("Remove")} disabled={busy} onClick={() => void remove(p)}>×</button>
            </>
          ) : <button type="button" className="button secondary small" disabled={busy} onClick={() => void run(() => api<Person[]>("/api/workshop/staff", { method: "POST", body: JSON.stringify({ email: p.email, role: p.roles[0] }) }), t("Added back"))}>{t("Add back")}</button>}
        </div>
      ))}
      {people && (
        <>
          <label className="ws-field">{t("Add a person")}</label>
          <div className="ws-staff">
            <input type="email" aria-label={t("E-mail")} placeholder="name@example.com" value={f.email} maxLength={180} onChange={(e) => setF((x) => ({ ...x, email: e.target.value }))} />
            <select aria-label={t("Role")} value={f.role} onChange={(e) => setF((x) => ({ ...x, role: e.target.value }))}>{ROLES.map((r) => <option key={r} value={r}>{t(NAME[r])}</option>)}</select>
          </div>
          <button type="button" className="button small" disabled={busy || !f.email.includes("@")} onClick={() => void invite()}>{busy ? t("Saving…") : t("Send invite")}</button>
          <small className="ws-hint">{t("What each role may do is set under Permissions. A removed person is signed out within the hour.")}</small>
        </>
      )}
    </section>
  );
}
