import { can } from "../perms";
import { t, useLang } from "../i18n";
import { useCallback, useEffect, useRef, useState } from "react";
import { flushSync } from "react-dom";
import "./workshop.css";
import { api } from "../api";
import { Archive } from "./Archive";
import { CustomerPage, Customers } from "./Customers";
import { Dashboard } from "./Dashboard";
import { InvoicePage, Invoices } from "./Invoices";
import { JobPage } from "./JobPage";
import { Jobs, NewJob } from "./Jobs";
import { QuotePage } from "./Quotes";
import { Reports } from "./Reports";
import { Settings } from "./Settings";
import { Due, VehiclePage, Vehicles } from "./Vehicles";
import { Messages } from "./Messages";
import { Alerts } from "./Alerts";
import { reconnectPrinter } from "./printer";
import { QuickBill } from "./QuickBill";
import { CashUp } from "./CashUp";
import { WsContext, useScrollFeel, type Business, type Page, type PageName } from "./common";

import { toast } from "../ui";
import { setSinhalaAllowed } from "../i18n";
import { getBusinessName, setBusinessName, setDefaultMarkup, setDefaultReorder } from "../businessName";
const HELP: Partial<Record<PageName, string>> = {
  home: "Today in your workshop.", jobs: "Every vehicle that came in, with its repairs and bill.", new: "Fill in the vehicle and what needs doing.",
  quotes: "Estimates (the price can still change, like an insurance repair) and quotations (a fixed price). Send a PDF, revise it, then make the job.", quote: "Fill in the vehicle, the damage and the work by section.",
  vehicles: "Every vehicle you have served, with owner and history.", customers: "Every customer, with their vehicles, jobs, bills and what they owe.", due: "Vehicles due for service soon. Call or message the owner.", alerts: "Things that can leak money in the last 30 days. Look at each, then tick Seen.", messages: "Customers to message today: ready vehicles, service, reminders, birthdays.",
  invoices: "Every bill. See who has paid and who still owes.", archive: "Deleted jobs are kept here. You can restore them.",
  report: "Sales, what is unpaid, and your best parts and work.", settings: "Your business details, tax and invoice header.",
};
const FALLBACK: Business = { name: "Workshop Suite", address: "", phone: "", email: "", reg_no: "", bank: "", footer: "", tax_name: "VAT", tax_rate: 0, mechanic_discount_pct: 10 };

export function Workshop({ owner, start }: { owner: boolean; start?: Page }) {
  useLang();
  const [page, setPage] = useState<Page>(start || { name: "home" });
  const [, setNotice] = useState("");
  const [business, setBusiness] = useState<Business>({ ...FALLBACK, name: getBusinessName() });
  const [bizLoaded, setBizLoaded] = useState(false);  // the Settings form copies the shop details once when it opens, so it waits for the real ones
  const reloadBusiness = useCallback(() => { api<Business>("/api/workshop/settings").then((b) => { setBusiness(b); setBizLoaded(true); setBusinessName(b.name); setDefaultReorder(b.default_reorder_level); setDefaultMarkup(b.default_markup_pct); setSinhalaAllowed(!!b.sinhala); }).catch(() => undefined); }, []);
  useEffect(reloadBusiness, [reloadBusiness]);
  useEffect(() => { void reconnectPrinter(); }, []);
  const go = useCallback((next: Page, message = "") => {
    const apply = () => { setPage(next); setNotice(message); };
    const vt = (document as Document & { startViewTransition?: (cb: () => void) => { finished: Promise<unknown> } }).startViewTransition;
    if (message) toast(message);
    if (vt && document.visibilityState === "visible" && !window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      // the tapped card's picture glides into the next page (shared element); everything else cross-fades and slides
      const src = (document.activeElement as HTMLElement | null)?.closest?.(".ws-tile")?.querySelector<HTMLElement>(".ws-hero") || null;
      if (src) src.style.viewTransitionName = "vt-hero";
      document.documentElement.classList.add("vt-go");
      const run = vt.call(document, () => { flushSync(apply); window.scrollTo({ top: 0 }); });
      void run.finished.finally(() => { document.documentElement.classList.remove("vt-go"); if (src) src.style.viewTransitionName = ""; });
    } else { apply(); window.scrollTo({ top: 0 }); }
  }, []);
  const tabs: [PageName, string][] = [["home", t("Home")], ["jobs", t("Jobs")], ["quotes", t("Quotes")], ["vehicles", t("Vehicles")], ["customers", t("Customers")], ["due", t("Service due")], ...(can("messages") ? ([["messages", t("Messages")]] as [PageName, string][]) : []), ...(can("alerts") ? ([["alerts", t("Alerts")]] as [PageName, string][]) : []), ["invoices", t("Invoices")], ...(business.cash_up_on && can("cash_up") ? ([["cashup", t("Cash-up")]] as [PageName, string][]) : []), ...(owner ? ([["archive", t("Archive")], ["report", t("Sales report")], ["settings", t("Settings")]] as [PageName, string][]) : [])];
  const [online, setOnline] = useState(typeof navigator === "undefined" ? true : navigator.onLine);
  useEffect(() => { const on = () => setOnline(true), off = () => setOnline(false); window.addEventListener("online", on); window.addEventListener("offline", off); return () => { window.removeEventListener("online", on); window.removeEventListener("offline", off); }; }, []);
  // Groups: each group opens its first page; pages inside a group show as small chips under the bar.
  const LABEL: Record<string, string> = Object.fromEntries(tabs);
  const GROUPS: { key: string; label: string; pages: PageName[] }[] = [
    { key: "home", label: t("Home"), pages: ["home"] },
    { key: "jobs", label: t("Jobs"), pages: ["jobs"] },
    { key: "vehicles", label: t("Vehicles"), pages: ["vehicles", ...(can("customers_view") ? ["customers"] : []), "due", ...(can("messages") ? ["messages"] : [])] as PageName[] },
    ...(can("bills_view") || can("reports") || can("alerts") || (business.cash_up_on && can("cash_up")) ? [{ key: "money", label: t("Bills"), pages: [...(can("bills_view") ? ["invoices"] : []), ...(can("reports") ? ["report"] : []), ...(business.cash_up_on && can("cash_up") ? ["cashup"] : []), ...(can("alerts") ? ["alerts"] : [])] as PageName[] }] : []),
    ...(owner ? [{ key: "setup", label: t("Setup"), pages: ["archive", "settings"] as PageName[] }] : []),
  ];
  const tab: PageName = page.name === "job" || page.name === "new" ? "jobs" : page.name === "quote" || page.name === "quotes" ? "jobs" : page.name === "vehicle" ? "vehicles" : page.name === "customer" ? "customers" : page.name === "invoice" || page.name === "quickbill" ? "invoices" : page.name;
  const TITLES: Partial<Record<PageName, string>> = { home: t("Today"), messages: t("Messages"), alerts: t("Alerts"), jobs: t("Jobs"), new: t("New job"), job: t("Job"), quotes: t("Estimates and quotations"), quote: t("Estimate or quotation"), vehicles: t("Vehicles"), vehicle: t("Vehicle"), customers: t("Customers"), customer: t("Customer"), due: t("Service due"), invoices: t("Invoices"), quickbill: t("Quick bill"), invoice: t("Invoice"), archive: t("Archive"), report: t("Sales report"), settings: t("Settings"), cashup: t("Cash-up") };
  const title = TITLES[page.name] || business.name;
  const headRef = useRef<HTMLHeadingElement>(null), pageRef = useRef<HTMLDivElement>(null), [shrunk, setShrunk] = useState(false);
  useEffect(() => { const h = headRef.current; if (!h || !("IntersectionObserver" in window)) return; const io = new IntersectionObserver((es) => setShrunk(!es[0]!.isIntersecting), { rootMargin: (window.innerWidth <= 760 ? "-150px" : "-10px") + " 0px 0px 0px" }); io.observe(h); return () => io.disconnect(); }, [page.name]);
  useEffect(() => {
    const el = pageRef.current; if (!el || !window.matchMedia("(hover: hover) and (pointer: fine)").matches || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const move = (e: PointerEvent) => { const tile = (e.target as HTMLElement).closest?.(".ws-tile:not(.static)") as HTMLElement | null; if (!tile) return; const r = tile.getBoundingClientRect(), x = (e.clientX - r.left) / r.width - 0.5, y = (e.clientY - r.top) / r.height - 0.5; tile.style.setProperty("--ry", (x * 7).toFixed(2) + "deg"); tile.style.setProperty("--rx", (-y * 7).toFixed(2) + "deg"); tile.classList.add("tilting"); };
    const leave = (e: PointerEvent) => { const tile = (e.target as HTMLElement).closest?.(".ws-tile") as HTMLElement | null; if (tile) { tile.classList.remove("tilting"); tile.style.removeProperty("--rx"); tile.style.removeProperty("--ry"); } };
    el.addEventListener("pointermove", move); el.addEventListener("pointerout", leave); return () => { el.removeEventListener("pointermove", move); el.removeEventListener("pointerout", leave); };
  }, [page.name]);
  useScrollFeel(pageRef, page.name + (page.id || ""));
  const group = GROUPS.find((g) => g.pages.includes(tab)) || GROUPS[0]!;
  // the side menu (main.tsx) shows which workshop page is open
  // on a laptop the side menu carries these tour targets, so the page tabs must not duplicate them
  const [desk, setDesk] = useState(() => window.matchMedia("(min-width: 761px)").matches);
  useEffect(() => { const mq = window.matchMedia("(min-width: 761px)"), on = () => setDesk(mq.matches); mq.addEventListener("change", on); return () => mq.removeEventListener("change", on); }, []);
  const shellPage = page.name === "quotes" || page.name === "quote" || (page.name === "jobs" && page.tab === "ESTIMATE") ? "estimates" : tab;
  useEffect(() => { window.dispatchEvent(new CustomEvent("lifta:ws-page", { detail: shellPage })); }, [shellPage]);
  const crumbs: { label: string; to: Page }[] = page.name === "job" ? [{ label: t("Jobs"), to: { name: "jobs" } }] : page.name === "new" ? [{ label: t("Jobs"), to: { name: "jobs" } }] : page.name === "quote" ? [{ label: t("Jobs"), to: { name: "jobs", tab: page.kind === "QUOTATION" ? "QUOTATION" : "ESTIMATE" } as Page }] : page.name === "vehicle" ? [{ label: t("Vehicles"), to: { name: "vehicles" } }] : page.name === "customer" ? [{ label: t("Customers"), to: { name: "customers" } }] : page.name === "invoice" || page.name === "quickbill" ? [{ label: t("Invoices"), to: { name: "invoices" } }] : [];
  return (
    <WsContext.Provider value={{ owner, business, go, reloadBusiness }}>
      <section className="ws" aria-label="Workshop">
        <div className="ws-top">
          <div><p className="eyebrow">{business.name}</p><h1 ref={headRef} className="ws-large">{title}</h1></div>
          <div className="ws-top-actions">{can("jobs") && page.name !== "settings" && <button className="button primary" onClick={() => go({ name: "new" })}>+ {t("New job")}</button>}</div>
        </div>
        {!online && <p className="ws-offline" role="alert">{t("You are offline. Changes will not save until the internet is back.")}</p>}
        <div className={"ws-sticky" + (shrunk ? " shrunk" : "")}>
        <p className="ws-mini" aria-hidden="true">{title}</p>
        <nav className="ws-groups" aria-label="Workshop sections">
          {GROUPS.map((g) => <button key={g.key} data-tour={desk ? undefined : "ws-tab-" + g.pages[0]} aria-current={group.key === g.key} className={group.key === g.key ? "chosen" : ""} onClick={() => go({ name: g.pages[0]! })}>{g.label}</button>)}
        </nav>
        </div>
        {group.pages.length > 1 && <nav className="ws-subs" aria-label="More pages">{group.pages.map((k) => <button key={k} data-tour={desk || k === group.pages[0] ? undefined : "ws-tab-" + k} className={tab === k ? "chosen" : ""} onClick={() => go({ name: k })}>{LABEL[k] || k}</button>)}</nav>}
        {can("jobs") && ["home", "jobs", "vehicles", "due", "invoices"].includes(page.name) && <button className="ws-fab" aria-label={t("New job")} onClick={() => go({ name: "new" })}>+</button>}
        {crumbs.length > 0 && <div className="ws-crumbs"><button onClick={() => go(crumbs[0]!.to)}>‹ {t("Back")}</button><span>{crumbs[0]!.label}</span></div>}
        {HELP[page.name] && <p className="ws-help">{t(HELP[page.name]!)}</p>}
        <div className="ws-page" ref={pageRef} key={page.name + (page.id || "")}>
        {page.name === "home" && <Dashboard />}
        {(page.name === "jobs" || page.name === "quotes") && <Jobs key={page.tab || page.name} tab={page.tab || (page.name === "quotes" ? "ESTIMATE" : undefined)} />}
        {page.name === "quote" && page.id && <QuotePage key={page.id + (page.kind || "") + (page.reg || "")} id={page.id} kind={page.kind} reg={page.reg} />}
        {page.name === "new" && <NewJob key={page.reg || "new"} reg={page.reg} />}
        {page.name === "job" && page.id && <JobPage key={page.id} id={page.id} />}
        {page.name === "vehicles" && <Vehicles />}
        {page.name === "vehicle" && page.id && <VehiclePage key={page.id} id={page.id} />}
        {page.name === "customers" && can("customers_view") && <Customers />}
        {page.name === "customer" && page.id && can("customers_view") && <CustomerPage key={page.id} id={page.id} />}
        {page.name === "due" && <Due />}
        {page.name === "messages" && can("messages") && <Messages />}
        {page.name === "alerts" && can("alerts") && <Alerts />}
        {page.name === "invoices" && <Invoices />}
        {page.name === "quickbill" && can("bill") && can("job_stock") && can("jobs") && <QuickBill />}
        {page.name === "invoice" && page.id && <InvoicePage key={page.id} id={page.id} />}
        {page.name === "archive" && owner && <Archive />}
        {page.name === "report" && can("reports") && <Reports />}
        {page.name === "cashup" && business.cash_up_on && can("cash_up") && <CashUp />}
        {page.name === "settings" && owner && (bizLoaded ? <Settings /> : <p className="muted" role="status">{t("Loading…")}</p>)}
        </div>
      </section>
    </WsContext.Provider>
  );
}
