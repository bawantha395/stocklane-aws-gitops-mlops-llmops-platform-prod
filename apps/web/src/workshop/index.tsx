import { t, useLang } from "../i18n";
import { useCallback, useEffect, useState } from "react";
import "./workshop.css";
import { api } from "../api";
import { Archive } from "./Archive";
import { Dashboard } from "./Dashboard";
import { InvoicePage, Invoices } from "./Invoices";
import { JobPage } from "./JobPage";
import { Jobs, NewJob } from "./Jobs";
import { Reports } from "./Reports";
import { Settings } from "./Settings";
import { Due, VehiclePage, Vehicles } from "./Vehicles";
import { PrinterPanel } from "./PrinterPanel";
import { reconnectPrinter } from "./printer";
import { WsContext, type Business, type Page, type PageName } from "./common";

import { toast } from "../ui";
import { getBusinessName, setBusinessName } from "../businessName";
const HELP: Partial<Record<PageName, string>> = {
  home: "Today in your workshop.", jobs: "Every vehicle that came in, with its repairs and bill.", new: "Fill in the vehicle and what needs doing.",
  vehicles: "Every vehicle you have served, with owner and history.", due: "Vehicles due for service soon. Call or message the owner.",
  invoices: "Every bill. See who has paid and who still owes.", archive: "Deleted jobs are kept here. You can restore them.",
  report: "Sales, what is unpaid, and your best parts and work.", settings: "Your business details, tax and invoice header.",
};
const FALLBACK: Business = { name: "Workshop Suite", address: "", phone: "", email: "", reg_no: "", bank: "", footer: "", tax_name: "VAT", tax_rate: 0, mechanic_discount_pct: 10 };

export function Workshop({ owner, start }: { owner: boolean; start?: Page }) {
  useLang();
  const [page, setPage] = useState<Page>(start || { name: "home" });
  const [, setNotice] = useState("");
  const [business, setBusiness] = useState<Business>({ ...FALLBACK, name: getBusinessName() });
  const reloadBusiness = useCallback(() => { api<Business>("/api/workshop/settings").then((b) => { setBusiness(b); setBusinessName(b.name); }).catch(() => undefined); }, []);
  useEffect(reloadBusiness, [reloadBusiness]);
  useEffect(() => { void reconnectPrinter(); }, []);
  const go = useCallback((next: Page, message = "") => { setPage(next); setNotice(message); if (message) toast(message); window.scrollTo({ top: 0 }); }, []);
  const tabs: [PageName, string][] = [["home", t("Home")], ["jobs", t("Jobs")], ["vehicles", t("Vehicles")], ["due", t("Service due")], ["invoices", t("Invoices")], ...(owner ? ([["archive", t("Archive")], ["report", t("Reports")], ["settings", t("Settings")]] as [PageName, string][]) : [])];
  const [online, setOnline] = useState(typeof navigator === "undefined" ? true : navigator.onLine);
  useEffect(() => { const on = () => setOnline(true), off = () => setOnline(false); window.addEventListener("online", on); window.addEventListener("offline", off); return () => { window.removeEventListener("online", on); window.removeEventListener("offline", off); }; }, []);
  // Groups: each group opens its first page; pages inside a group show as small chips under the bar.
  const LABEL: Record<string, string> = Object.fromEntries(tabs);
  const GROUPS: { key: string; label: string; pages: PageName[] }[] = [
    { key: "home", label: t("Home"), pages: ["home"] },
    { key: "jobs", label: t("Jobs"), pages: ["jobs"] },
    { key: "vehicles", label: t("Vehicles"), pages: ["vehicles", "due"] },
    { key: "money", label: t("Money"), pages: owner ? ["invoices", "report"] : ["invoices"] },
    ...(owner ? [{ key: "setup", label: t("Setup"), pages: ["archive", "settings"] as PageName[] }] : []),
  ];
  const tab: PageName = page.name === "job" || page.name === "new" ? "jobs" : page.name === "vehicle" ? "vehicles" : page.name === "invoice" ? "invoices" : page.name;
  const group = GROUPS.find((g) => g.pages.includes(tab)) || GROUPS[0]!;
  const crumbs: { label: string; to: Page }[] = page.name === "job" ? [{ label: t("Jobs"), to: { name: "jobs" } }] : page.name === "new" ? [{ label: t("Jobs"), to: { name: "jobs" } }] : page.name === "vehicle" ? [{ label: t("Vehicles"), to: { name: "vehicles" } }] : page.name === "invoice" ? [{ label: t("Invoices"), to: { name: "invoices" } }] : [];
  return (
    <WsContext.Provider value={{ owner, business, go, reloadBusiness }}>
      <section className="ws" aria-label="Workshop">
        <div className="ws-top">
          <div><p className="eyebrow">{t("WORKSHOP")}</p><h1>{business.name}</h1></div>
          <div className="ws-top-actions"><PrinterPanel /><button className="button primary" onClick={() => go({ name: "new" })}>+ {t("New job")}</button></div>
        </div>
        {!online && <p className="ws-offline" role="alert">{t("You are offline. Changes will not save until the internet is back.")}</p>}
        <nav className="ws-groups" aria-label="Workshop sections">
          {GROUPS.map((g) => <button key={g.key} data-tour={"ws-tab-" + g.pages[0]} aria-current={group.key === g.key} className={group.key === g.key ? "chosen" : ""} onClick={() => go({ name: g.pages[0]! })}>{g.label}</button>)}
        </nav>
        {group.pages.length > 1 && <nav className="ws-subs" aria-label="More pages">{group.pages.map((k) => <button key={k} data-tour={k === group.pages[0] ? undefined : "ws-tab-" + k} className={tab === k ? "chosen" : ""} onClick={() => go({ name: k })}>{LABEL[k] || k}</button>)}</nav>}
        {["home", "jobs", "vehicles", "due", "invoices"].includes(page.name) && <button className="ws-fab" aria-label={t("New job")} onClick={() => go({ name: "new" })}>+</button>}
        {crumbs.length > 0 && <div className="ws-crumbs"><button onClick={() => go(crumbs[0]!.to)}>‹ {t("Back")}</button><span>{crumbs[0]!.label}</span></div>}
        {HELP[page.name] && <p className="ws-help">{t(HELP[page.name]!)}</p>}
        <div className="ws-page" key={page.name + (page.id || "")}>
        {page.name === "home" && <Dashboard />}
        {page.name === "jobs" && <Jobs />}
        {page.name === "new" && <NewJob key={page.reg || "new"} reg={page.reg} />}
        {page.name === "job" && page.id && <JobPage key={page.id} id={page.id} />}
        {page.name === "vehicles" && <Vehicles />}
        {page.name === "vehicle" && page.id && <VehiclePage key={page.id} id={page.id} />}
        {page.name === "due" && <Due />}
        {page.name === "invoices" && <Invoices />}
        {page.name === "invoice" && page.id && <InvoicePage key={page.id} id={page.id} />}
        {page.name === "archive" && owner && <Archive />}
        {page.name === "report" && owner && <Reports />}
        {page.name === "settings" && owner && <Settings />}
        </div>
      </section>
    </WsContext.Provider>
  );
}
