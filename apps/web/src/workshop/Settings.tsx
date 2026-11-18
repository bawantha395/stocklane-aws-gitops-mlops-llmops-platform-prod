import { t } from "../i18n";
import { PrinterPanel } from "./PrinterPanel";
import { OwnerMailSection } from "./OwnerMail";
import { toast, askConfirm } from "../ui";
import { api } from "../api";
import { useState, useEffect, useRef } from "react";
import { logoFromFile, resetLogo } from "../logoStore";
import { useLogo } from "../BizLogo";
import { Banknote, MessageCircle, Boxes, Building2, FileText, Landmark, ListChecks, Percent, ShieldCheck, Users, Wrench, Database, Printer, Mail, X, type LucideIcon } from "lucide-react";
import QRCode from "qrcode";
import { BizLogo } from "../BizLogo";
import { StoresSection } from "./StoresSection";
import { MessageTemplatesSection } from "./MessageTemplatesSection";
import { StoreRoomSection } from "./StoreRoom";
import { PlatformSection } from "./PlatformSection";
import { PermissionsSection } from "./PermissionsSection";
import { StaffSection } from "./StaffSection";
import { hue } from "./Cards";
import { lkr, useCommand, useLoad, useWs, num, type Business } from "./common";

/** The QR as "N:" plus N*N zeros and ones, so the server can draw it in its PDF without a QR library. */
function qrBits(url?: string) {
  if (!url || !url.trim()) return "";
  try { const m = QRCode.create(url.trim(), { errorCorrectionLevel: "M" }).modules; let b = ""; for (let r = 0; r < m.size; r++) for (let c = 0; c < m.size; c++) b += m.get(r, c) ? "1" : "0"; return m.size + ":" + b; } catch { return ""; }
}

/** Jobs a workshop usually bills as labour. Only the names: every shop sets its own price. */
const COMMON_LABOUR = ["Engine oil and filter change", "Full service (labour)", "Brake pad replacement", "Brake disc skim or replace", "Wheel alignment", "Wheel balancing", "Tyre rotation", "Air filter replacement", "Spark plug replacement", "Battery replacement", "AC gas refill and service", "Gearbox oil change", "Coolant flush", "Suspension check and repair", "Clutch replacement", "Computer diagnostic scan", "Body wash and vacuum"];
type Sec = "mail" | "printer" | "biz" | "tax" | "pay" | "bill" | "data" | "workshop" | "staff" | "perms" | "store" | "lists" | "msgs";
const NAV: { group: string; items: { id: Sec; label: string; Icon: LucideIcon; owner?: boolean }[] }[] = [
  { group: "Stock", items: [{ id: "store", label: "Store room", Icon: Boxes }, { id: "lists", label: "Shelves and categories", Icon: ListChecks }] },
  { group: "Workshop", items: [{ id: "workshop", label: "Workshop", Icon: Wrench }, { id: "printer", label: "Receipt printer", Icon: Printer }, { id: "mail", label: "Daily summary", Icon: Mail, owner: true }, { id: "staff", label: "Staff", Icon: Users, owner: true }, { id: "perms", label: "Who can do what", Icon: ShieldCheck, owner: true }, { id: "msgs", label: "Customer messages", Icon: MessageCircle, owner: true }] },
  { group: "Business", items: [{ id: "biz", label: "Business details", Icon: Building2 }, { id: "tax", label: "Tax and discount", Icon: Percent }, { id: "pay", label: "Getting paid", Icon: Landmark }, { id: "bill", label: "Bill notes", Icon: FileText }, { id: "data", label: "Your data", Icon: Database, owner: true }] },
];
const OWN_SAVE: string[] = ["mail", "printer", "store", "lists", "staff", "perms", "data", "msgs"]; // these sections save themselves
const SEC_KEY = "lifta.settingsSec";

/** The store room / parts counter switches are saved from the Store room tab. This form was opened earlier, so its copy may be old: it must not send them. */
const SWITCHES = ["store_room_on", "counter_on", "store_room_phone", "counter_web", "cash_up_on", "day_lock_on"] as const;
function withoutSwitches<T extends Record<string, unknown>>(f: T): T { const o = { ...f }; for (const k of SWITCHES) delete (o as Record<string, unknown>)[k]; return o; }

/** One field: label, the input, and its hint underneath, always together. */
function Fld({ label, hint, children, req }: { label: string; hint?: string; children: React.ReactNode; req?: boolean }) {
  return (
    <label className="ws-fld"><span className="ws-fld-l">{label}{req ? " *" : ""}</span>{children}{hint && <small className="ws-hint">{hint}</small>}</label>
  );
}

/** A card in the settings pane: icon, title, one line of help, then its fields. */
function Card({ Icon, title, help, children, tour }: { Icon: LucideIcon; title: string; help?: string; children: React.ReactNode; tour?: string }) {
  return (
    <section className="ws-sec" data-tour={tour}>
      <header className="ws-sec-head"><span className="ws-sec-ico"><Icon size={18} /></span><span><h3>{title}</h3>{help && <p className="muted">{help}</p>}</span></header>
      {children}
    </section>
  );
}

/** A switch with its own explanation. */
function Switch({ on, onChange, title, hint }: { on: boolean; onChange: (v: boolean) => void; title: string; hint: string }) {
  return (
    <label className="ws-switch"><span className="ws-sw-t"><b>{title}</b><small>{hint}</small></span><input type="checkbox" role="switch" checked={on} onChange={(e) => onChange(e.target.checked)} /><span className="trk" aria-hidden="true" /></label>
  );
}

/** Cash-up and day lock: two optional switches. They save the moment they are flipped (the form below must not send them: its copy may be old). */
function DaySwitches() {
  const { business, reloadBusiness } = useWs(), [busy, setBusy] = useState(false);
  const flip = async (k: "cash_up_on" | "day_lock_on", on: boolean) => {
    if (busy) return;
    setBusy(true);
    try {
      const latest = await api<Record<string, unknown>>("/api/workshop/settings");
      await api("/api/workshop/settings", { method: "PUT", body: JSON.stringify({ ...latest, [k]: on, ...(k === "cash_up_on" && !on ? { day_lock_on: false } : {}) }) }, crypto.randomUUID());
      await reloadBusiness();
    } catch (e) { toast((e as Error).message, { bad: true }); } finally { setBusy(false); }
  };
  return (
    <Card Icon={Banknote} title={t("Close the day")} help={t("Optional. Off until you turn it on.")}>
      <Switch on={business.cash_up_on === true} onChange={(v) => void flip("cash_up_on", v)} title={t("Cash-up")} hint={t("Adds a Cash-up screen: the system adds up the day's money, someone counts the drawer and closes the day. A difference needs a short note.")} />
      {business.cash_up_on === true && <Switch on={business.day_lock_on === true} onChange={(v) => void flip("day_lock_on", v)} title={t("Lock closed days")} hint={t("After a day is closed, no payment, refund or void can change it. Only the owner can reopen it, with a reason.")} />}
    </Card>
  );
}

export function Settings() {
  const { business, reloadBusiness, owner } = useWs();
  const logo = useLogo(), fileRef = useRef<HTMLInputElement>(null), [logoBusy, setLogoBusy] = useState(false);
  const [f, setF] = useState({ ...business, qr_url: business.qr_url || "", tax_rate: String(business.tax_rate), mechanic_discount_pct: String(business.mechanic_discount_pct ?? 10), payment_terms_days: String(business.payment_terms_days ?? 0), warranty: business.warranty || "", invoice_prefix: business.invoice_prefix || "INV", default_reorder_level: String(business.default_reorder_level ?? 5), sinhala: !!business.sinhala, default_markup_pct: business.default_markup_pct == null ? "" : String(business.default_markup_pct), mechanics: [...(business.mechanics || [])], labour_items: (business.labour_items || []).map((l) => ({ description: l.description, amount: String(l.amount) })) });
  const [sec, setSec] = useState<Sec>(() => { try { const v = sessionStorage.getItem(SEC_KEY) as Sec | null; return v && NAV.some((g) => g.items.some((x) => x.id === v)) ? v : "biz"; } catch { return "biz"; } });
  const pickSec = async (id: Sec) => {
    if (dirty && OWN_SAVE.includes(id) && !(await askConfirm("The changes on this tab are not saved yet. They stay here until you come back and press Save changes.", { title: "Leave without saving?", confirm: "Leave" }))) return;
    setSec(id); try { sessionStorage.setItem(SEC_KEY, id); } catch { /* ignore */ } window.scrollTo({ top: 0 });
  };
  const [msg, setMsg] = useState(""), [error, setError] = useState(""), [busy, setBusy] = useState(false);
  const saved = useRef(JSON.stringify(f)), dirty = JSON.stringify(f) !== saved.current;
  useEffect(() => { const warn = (e: BeforeUnloadEvent) => { if (dirty) e.preventDefault(); }; window.addEventListener("beforeunload", warn); return () => window.removeEventListener("beforeunload", warn); }, [dirty]);
  useEffect(() => { if (msg) toast(msg); }, [msg]);
  const command = useCommand();
  const { data: dash } = useLoad<{ open_count: number; due_count: number; month: { billed: number; invoices: number } }>("/api/workshop/dashboard");
  const set = (k: keyof typeof f, v: string) => { setF((x) => ({ ...x, [k]: v })); setMsg(""); };
  const exportAll = async () => {
    setBusy(true); setError("");
    try {
      const data = await api("/api/workshop/export");
      const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 1)], { type: "application/json" }));
      const a = document.createElement("a"); a.href = url; a.download = "lifta-data-" + new Date().toISOString().slice(0, 10) + ".json"; document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 30000);
    } catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  };
  const save = async (e: React.FormEvent) => {
    e.preventDefault(); setBusy(true); setError("");
    try { await command<Business>("/api/workshop/settings", { ...withoutSwitches(f), qr_bits: qrBits(f.qr_url), tax_rate: num(f.tax_rate), mechanic_discount_pct: num(f.mechanic_discount_pct), payment_terms_days: num(f.payment_terms_days), default_reorder_level: num(f.default_reorder_level), sinhala: !!f.sinhala, ...(business.default_markup_pct !== undefined ? { default_markup_pct: f.default_markup_pct === "" ? 0 : num(f.default_markup_pct) } : {}), mechanics: f.mechanics.map((m) => m.trim()).filter(Boolean), labour_items: f.labour_items.filter((l) => l.description.trim()).map((l) => ({ description: l.description.trim(), amount: num(l.amount) })) }, "PUT"); saved.current = JSON.stringify(f); reloadBusiness(); setMsg(t("Saved. New invoices use these details; old invoices keep the details they were issued with.")); }
    catch (err) { setError((err as Error).message); } finally { setBusy(false); }
  };
  const uploadLogo = async (file: File) => {
    setLogoBusy(true); setError("");
    try { const image = await logoFromFile(file); await command("/api/workshop/logo", { image }, "PUT"); resetLogo(); reloadBusiness(); setMsg(t("Logo saved.")); }
    catch (err) { setError((err as Error).message); toast((err as Error).message, { bad: true }); } finally { setLogoBusy(false); }
  };
  const removeLogo = async () => {
    if (!(await askConfirm("Bills go back to the initials.", { title: "Remove the logo?", confirm: "Remove logo", danger: true }))) return;
    setLogoBusy(true); setError("");
    try { await command("/api/workshop/logo", {}, "DELETE"); resetLogo(); reloadBusiness(); setMsg(t("Logo removed.")); }
    catch (err) { setError((err as Error).message); } finally { setLogoBusy(false); }
  };
  const lines = (f.address || "").split("\n").filter(Boolean);
  return (
    <form className="ws-set" onSubmit={save}>
      <section className="ws-set-hero" style={{ ["--h" as string]: hue(f.name || "x") }}>
        <span className="ws-set-id">
          <span className="ws-set-logo"><BizLogo name={f.name || "Business"} size={64} /></span>
          <span className="ws-set-name"><strong>{f.name || t("Your business")}</strong><small>{[lines[0], f.phone].filter(Boolean).join(" · ") || t("Add your address and phone below")}</small></span>
        </span>
        <span className="ws-set-stats">
          <span><b>{dash ? dash.month.invoices : "-"}</b><small>{t("Invoices this month")}</small></span>
          <span><b>{dash ? "LKR " + lkr(dash.month.billed) : "-"}</b><small>{t("Billed this month")}</small></span>
          <span><b>{dash ? dash.open_count : "-"}</b><small>{t("Open jobs")}</small></span>
        </span>
      </section>

      <div className="ws-set-layout">
        <nav className="ws-set-nav" aria-label={t("Settings sections")}>
          {NAV.map((g) => (
            <div className="ws-set-navgroup" key={g.group}>
              <span className="ws-set-navhead">{t(g.group)}</span>
              {g.items.filter((x) => !x.owner || owner).map((x) => (
                <button type="button" key={x.id} className={sec === x.id ? "on" : ""} aria-current={sec === x.id ? "page" : undefined} onClick={() => pickSec(x.id)}><x.Icon size={16} /> {t(x.label)}</button>
              ))}
            </div>
          ))}
        </nav>
        <div className="ws-set-pane">
        <div hidden={sec !== "biz"}>
          <Card Icon={Building2} title={t("Business details")} help={t("Printed at the top of every invoice. English letters only.")}>
            <div className="ws-fld"><span className="ws-fld-l">{t("Logo")}</span>
              <div className="ws-logo-row">
                <BizLogo name={f.name || "Business"} size={56} />
                {owner && <span className="ws-bar">
                  <button type="button" className="button secondary small" disabled={logoBusy} onClick={() => fileRef.current?.click()}>{logo ? t("Change logo") : t("Upload logo")}</button>
                  {logo && <button type="button" className="button secondary small" disabled={logoBusy} onClick={() => void removeLogo()}>{t("Remove logo")}</button>}
                </span>}
                <input ref={fileRef} type="file" accept="image/*" hidden onChange={(e) => { const file = e.target.files?.[0]; e.target.value = ""; if (file) void uploadLogo(file); }} />
              </div>
              <small className="ws-hint">{t("Shows on the bill: top left, next to the business name. A square or wide picture works best.")}</small>
            </div>
            <Fld label={t("Business name")} req hint={t("Shows on the bill: top left, big.")}><input required value={f.name} onChange={(e) => set("name", e.target.value)} /></Fld>
            <Fld label={t("Address")} hint={t("Shows on the bill: under the business name.")}><textarea rows={2} value={f.address} onChange={(e) => set("address", e.target.value)} placeholder={"12 Galle Road\nColombo 03"} /></Fld>
            <div className="ws-grid2">
              <Fld label={t("Phone")}><input inputMode="tel" value={f.phone} onChange={(e) => set("phone", e.target.value)} /></Fld>
              <Fld label={t("Email")}><input type="email" value={f.email} onChange={(e) => set("email", e.target.value)} /></Fld>
            </div>
            <small className="ws-hint">{t("Shows on the bill: under the address.")}</small>
            <Fld label={t("Registration or tax number")} hint={t("Shows on the bill: under the phone number. Fill this if you are tax registered. Empty = bill says 'not a tax invoice'.")}><input value={f.reg_no} onChange={(e) => set("reg_no", e.target.value)} placeholder="VAT 123456789" /></Fld>
          </Card>
        </div>
        <div hidden={sec !== "tax"}>
          <Card Icon={Percent} title={t("Tax and discount")}>
            <div className="ws-grid2">
              <Fld label={t("Tax name")}><input value={f.tax_name} onChange={(e) => set("tax_name", e.target.value)} /></Fld>
              <Fld label={t("Tax rate %")}><input inputMode="decimal" value={f.tax_rate} onChange={(e) => set("tax_rate", e.target.value)} /></Fld>
            </div>
            <small className="ws-hint">{t("Shows on the bill: a tax line in the totals. Rate 0 = no tax line. A rate above 0 prints Tax invoice.")}</small>
            <Fld label={t("Mechanic discount limit (%)")} hint={t("Not printed. A mechanic can give a discount up to this percent of parts and labour (bill discount and line discounts together). More needs the owner. 0 = no discounts.")}><input inputMode="decimal" value={f.mechanic_discount_pct} onChange={(e) => set("mechanic_discount_pct", e.target.value)} /></Fld>
          </Card>
        </div>
        <div hidden={sec !== "printer"}>
          <Card Icon={Printer} title={t("Receipt printer")} help={t("Connect a receipt printer once. Bills then print straight to it, no dialog.")}>
            <PrinterPanel open />
          </Card>
        </div>
        <div hidden={sec !== "workshop"} className="ws-stack">
          <Card Icon={Wrench} title={t("Mechanics")} help={t("Shows on the bill: Mechanic name under the vehicle. A job's Mechanic becomes a pick list. Names you remove stay on old jobs. These are also the people parts can be issued to (Issue stock → Who is it for?).")}>
            <div className="ws-rows">
              {f.mechanics.map((m, i) => (
                <div className="ws-list-row" key={i}>
                  <input aria-label={t("Mechanic name")} placeholder={t("Mechanic name")} value={m} maxLength={60} onChange={(e) => setF((x) => ({ ...x, mechanics: x.mechanics.map((v, k) => (k === i ? e.target.value : v)) }))} />
                  <button type="button" className="ws-l-del" aria-label={t("Remove")} onClick={() => setF((x) => ({ ...x, mechanics: x.mechanics.filter((_, k) => k !== i) }))}><X size={16} /></button>
                </div>
              ))}
            </div>
            {f.mechanics.length < 20 && <button type="button" className="button secondary small ws-add" onClick={() => setF((x) => ({ ...x, mechanics: [...x.mechanics, ""] }))}>{t("+ Add mechanic")}</button>}
          </Card>
          <Card Icon={ListChecks} title={t("Quick labour list")} help={t("Shows on the bill: as the labour line when you tap it on a job. Tap-to-add buttons on every job page.")}>
            <div className="ws-rows">
              {f.labour_items.map((l, i) => (
                <div className="ws-list-row" key={i}>
                  <input aria-label={t("What was done")} placeholder={t("What was done")} value={l.description} maxLength={100} onChange={(e) => setF((x) => ({ ...x, labour_items: x.labour_items.map((v, k) => (k === i ? { ...v, description: e.target.value } : v)) }))} />
                  <input className="ws-lr-amt" aria-label={t("Amount")} placeholder={t("Amount")} inputMode="decimal" value={l.amount} onChange={(e) => setF((x) => ({ ...x, labour_items: x.labour_items.map((v, k) => (k === i ? { ...v, amount: e.target.value.replace(/[^0-9.]/g, "") } : v)) }))} />
                  <button type="button" className="ws-l-del" aria-label={t("Remove")} onClick={() => setF((x) => ({ ...x, labour_items: x.labour_items.filter((_, k) => k !== i) }))}><X size={16} /></button>
                </div>
              ))}
            </div>
            {f.labour_items.length < 30 && <button type="button" className="button secondary small ws-add" onClick={() => setF((x) => ({ ...x, labour_items: [...x.labour_items, { description: "", amount: "" }] }))}>{t("+ Add labour")}</button>}
            {f.labour_items.length < 30 && (() => {
              const have = new Set(f.labour_items.map((l) => l.description.trim().toLowerCase())), more = COMMON_LABOUR.filter((c) => !have.has(c.toLowerCase()));
              return more.length > 0 && (
                <details className="ws-common">
                  <summary>{t("Add common jobs")}</summary>
                  <div className="ws-chips">{more.map((c) => <button key={c} type="button" className="ws-chip" onClick={() => setF((x) => (x.labour_items.length >= 30 ? x : { ...x, labour_items: [...x.labour_items, { description: c, amount: "" }] }))}>+ {t(c)}</button>)}</div>
                  <small className="ws-hint">{t("The price is left empty: type your price on each one, then save.")}</small>
                </details>
              );
            })()}
          </Card>
          <Card Icon={Boxes} title={t("Workshop")}>
            <div className="ws-grid2">
              <Fld label={t("Default reorder level for new parts")} hint={t("Not printed. A new part shows in Running low when its stock is at or below this number. You can still change it per part.")}><input inputMode="decimal" value={f.default_reorder_level} onChange={(e) => set("default_reorder_level", e.target.value)} /></Fld>
              {business.default_markup_pct !== undefined && <Fld label={t("Default markup on cost (%)")} hint={t("Suggested selling price = cost + this %, rounded up to the next 5 rupees. Nothing changes by itself: you choose in Price review. A part can have its own markup.")}><input inputMode="decimal" value={f.default_markup_pct} onChange={(e) => set("default_markup_pct", e.target.value.replace(/[^0-9.]/g, ""))} /></Fld>}
            </div>
            <Switch on={!!f.sinhala} onChange={(v) => setF((x) => ({ ...x, sinhala: v }))} title={t("Allow Sinhala")} hint={t("Off: everyone sees English only. On: a language button (EN / සිං) shows for staff, and order messages can be sent in Sinhala.")} />
          </Card>
          <DaySwitches />
        </div>
        <div hidden={sec !== "store"}><StoreRoomSection /></div>
        <div hidden={sec !== "lists"}><StoresSection /></div>
        <div hidden={sec !== "staff"}><StaffSection /></div>
        <div hidden={sec !== "mail"}>{sec === "mail" && owner && <OwnerMailSection />}</div>
        <div hidden={sec !== "perms"}><PermissionsSection /></div>
        <div hidden={sec !== "msgs"}>{sec === "msgs" && <MessageTemplatesSection sinhala={!!business.sinhala} />}</div>
        <div hidden={sec !== "pay"}>
          <Card Icon={Landmark} title={t("Getting paid")}>
            <Fld label={t("Bank details for payments")} hint={t("Shows on the bill: in the How to pay box.")}><textarea rows={3} value={f.bank} onChange={(e) => set("bank", e.target.value)} placeholder={"Bank of Ceylon\nAccount 1234567"} /></Fld>
            <Fld label={t("Payment terms")} hint={t("Shows on the bill: the Due date at the top right.")}><select value={f.payment_terms_days} onChange={(e) => set("payment_terms_days", e.target.value)}><option value="0">{t("Due on receipt")}</option><option value="7">7 {t("days")}</option><option value="14">14 {t("days")}</option><option value="30">30 {t("days")}</option></select></Fld>
            <Fld label={t("QR on the bill (optional)")} hint={t("Shows on the bill: a QR next to How to pay. Customer scans to leave a review or open your payment page.")}><input inputMode="url" value={f.qr_url || ""} onChange={(e) => set("qr_url", e.target.value)} placeholder="https://share.google/your-link" /></Fld>
          </Card>
        </div>
        <div hidden={sec !== "bill"}>
          <Card Icon={FileText} title={t("Bill notes")}>
            <Fld label={t("Bill number prefix")} hint={t("Shows on the bill: the start of every new bill number, for example") + " " + (f.invoice_prefix || "INV") + "-0001. " + t("Old bills keep their numbers.")}><input value={f.invoice_prefix} maxLength={6} onChange={(e) => set("invoice_prefix", e.target.value.replace(/[^A-Za-z0-9]/g, "").toUpperCase())} /></Fld>
            <Fld label={t("Warranty note")} hint={t("Shows on the bill: at the bottom, under Warranty.")}><textarea rows={2} value={f.warranty} onChange={(e) => set("warranty", e.target.value)} placeholder="Parts warranty 30 days" /></Fld>
            <Fld label={t("Footer note")} hint={t("Shows on the bill: the last line, for example a thank you.")}><textarea rows={2} value={f.footer} onChange={(e) => set("footer", e.target.value)} /></Fld>
          </Card>
        </div>
        <div hidden={sec !== "data"} className="ws-stack">
          <PlatformSection />
          {owner && (
            <Card Icon={Database} title={t("Your data")} help={t("One file with every job, bill, vehicle, stock part and movement. Keep a copy somewhere safe now and then. Photos are not in it.")} tour="export-data">
              <button type="button" className="button secondary ws-add" disabled={busy} onClick={() => void exportAll()}>{t("Download all data")}</button>
            </Card>
          )}
        </div>
        </div>
      </div>

      {error && <p role="alert" className="stock-error">{error}</p>}
      
      <div className="ws-savebar" hidden={OWN_SAVE.includes(sec)}><button className="button primary" disabled={busy}>{busy ? t("Saving…") : t("Save changes")}</button></div>
    </form>
  );
}
