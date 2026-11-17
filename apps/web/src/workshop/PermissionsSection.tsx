import { useEffect, useState } from "react";
import { ShieldCheck } from "lucide-react";
import { t } from "../i18n";
import { toast, askConfirm } from "../ui";
import { api } from "../api";
import { isPractice } from "../practice";

type View = { permissions: { key: string; section: string; label: string }[]; roles: Record<string, string[]>; defaults: Record<string, string[]> };
const ROLES = ["ADMIN", "STOREKEEPER", "MECHANIC"] as const;
const NAME: Record<string, string> = { ADMIN: "Admin", STOREKEEPER: "Store keeper", MECHANIC: "Mechanic" };

/** Owner: tick what each role may do. The owner can always do everything. */
export function PermissionsSection() {
  const [v, setV] = useState<View | null>(null), [busy, setBusy] = useState(false), [dirty, setDirty] = useState(false);
  useEffect(() => { if (!isPractice()) api<View>("/api/workshop/permissions").then(setV).catch(() => setV(null)); }, []);
  if (!v) return null;
  const flip = (role: string, key: string) => {
    setDirty(true);
    setV((x) => x && ({ ...x, roles: { ...x.roles, [role]: x.roles[role].includes(key) ? x.roles[role].filter((k) => k !== key) : [...x.roles[role], key] } }));
  };
  const send = async (body: unknown, done: string) => {
    setBusy(true);
    try { setV(await api<View>("/api/workshop/permissions", { method: "PUT", body: JSON.stringify(body) }, crypto.randomUUID())); setDirty(false); toast(done); }
    catch (e) { toast((e as Error).message, { bad: true }); } finally { setBusy(false); }
  };
  const reset = async () => {
    if (await askConfirm(t("Every role goes back to what Lifta suggests."), { title: t("Reset permissions?"), confirm: t("Reset") })) await send({ reset: true }, t("Permissions reset"));
  };
  const sections = [...new Set(v.permissions.map((p) => p.section))];
  return (
    <section className="ws-sec ws-perms" data-tour="permissions">
      <h3><span className="ws-sec-ico"><ShieldCheck size={18} /></span>{t("Permissions")}</h3>
      <small className="ws-hint">{t("Tick what each role may do. The owner can always do everything. A person with two roles gets both.")}</small>
      <div className="ws-perm-scroll">
        <table className="ws-perm">
          <thead><tr><th></th>{ROLES.map((r) => <th key={r}>{t(NAME[r])}</th>)}</tr></thead>
          <tbody>
            {sections.map((s) => [
              <tr key={s} className="ws-perm-sec"><td colSpan={4}>{t(s)}</td></tr>,
              ...v.permissions.filter((p) => p.section === s).map((p) => (
                <tr key={p.key}>
                  <td>{t(p.label)}</td>
                  {ROLES.map((r) => <td key={r}><input type="checkbox" aria-label={t(NAME[r]) + ": " + t(p.label)} checked={v.roles[r].includes(p.key)} onChange={() => flip(r, p.key)} /></td>)}
                </tr>
              )),
            ])}
          </tbody>
        </table>
      </div>
      <small className="ws-hint">{t("A change reaches people within half a minute. They do not need to sign in again.")}</small>
      <button type="button" className="button small" disabled={busy || !dirty} onClick={() => void send({ roles: v.roles }, t("Permissions saved"))}>{busy ? t("Saving…") : t("Save permissions")}</button>{" "}
      <button type="button" className="button secondary small" disabled={busy} onClick={() => void reset()}>{t("Reset to suggested")}</button>
    </section>
  );
}
