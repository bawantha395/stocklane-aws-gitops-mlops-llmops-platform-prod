import { useCallback, useEffect, useState } from "react";
import "./workshop.css";
import { api } from "../api";
import { Dashboard } from "./Dashboard";
import { InvoicePage, Invoices } from "./Invoices";
import { JobPage } from "./JobPage";
import { Jobs, NewJob } from "./Jobs";
import { Reports } from "./Reports";
import { Settings } from "./Settings";
import { Due, VehiclePage, Vehicles } from "./Vehicles";
import { WsContext, type Business, type Page, type PageName } from "./common";

const FALLBACK: Business = { name: "Ganga Motors", address: "No 566, Anuradhapura 50000", phone: "", email: "", reg_no: "", bank: "", footer: "", tax_name: "VAT", tax_rate: 0 };

export function Workshop({ owner }: { owner: boolean }) {
  const [page, setPage] = useState<Page>({ name: "home" });
  const [notice, setNotice] = useState("");
  type Theme = "auto" | "light" | "dark";
  const [theme, setTheme] = useState<Theme>(() => { try { const t = localStorage.getItem("workshop.theme"); return t === "light" || t === "dark" ? t : "auto"; } catch { return "auto"; } });
  useEffect(() => {
    const media = window.matchMedia("(prefers-color-scheme: light)");
    const apply = () => { document.documentElement.dataset.wsTheme = theme === "auto" ? (media.matches ? "light" : "dark") : theme; };
    apply();
    try { localStorage.setItem("workshop.theme", theme); } catch { /* private mode: keep it for this visit only */ }
    media.addEventListener("change", apply);
    return () => { media.removeEventListener("change", apply); delete document.documentElement.dataset.wsTheme; };
  }, [theme]);
  const nextTheme: Theme = theme === "auto" ? "light" : theme === "light" ? "dark" : "auto";
  const [business, setBusiness] = useState<Business>(FALLBACK);
  const reloadBusiness = useCallback(() => { api<Business>("/api/workshop/settings").then(setBusiness).catch(() => undefined); }, []);
  useEffect(reloadBusiness, [reloadBusiness]);
  const go = useCallback((next: Page, message = "") => { setPage(next); setNotice(message); window.scrollTo({ top: 0 }); }, []);
  const tabs: [PageName, string][] = [["home", "Home"], ["jobs", "Jobs"], ["vehicles", "Vehicles"], ["due", "Service due"], ["invoices", "Invoices"], ...(owner ? ([["report", "Reports"], ["settings", "Settings"]] as [PageName, string][]) : [])];
  const tab: PageName = page.name === "job" || page.name === "new" ? "jobs" : page.name === "vehicle" ? "vehicles" : page.name === "invoice" ? "invoices" : page.name;
  return (
    <WsContext.Provider value={{ owner, business, go, reloadBusiness }}>
      <section className="ws" aria-label="Workshop">
        <div className="ws-top">
          <div><p className="eyebrow">WORKSHOP</p><h1>{business.name}</h1></div>
          <div className="ws-top-actions">
            <button className="ws-theme" aria-label={"Theme: " + theme + ". Change to " + nextTheme} onClick={() => setTheme(nextTheme)}>{theme === "auto" ? "Auto" : theme === "light" ? "Light" : "Dark"}</button>
            <button className="button primary" onClick={() => go({ name: "new" })}>+ New job</button>
          </div>
        </div>
        <nav className="ws-tabs" role="tablist" aria-label="Workshop sections">
          {tabs.map(([key, label]) => <button key={key} role="tab" aria-selected={tab === key} className={tab === key ? "chosen" : ""} onClick={() => go({ name: key })}>{label}</button>)}
        </nav>
        {notice && <p className="stock-notice ws-notice" role="status">{notice}</p>}
        {page.name === "home" && <Dashboard />}
        {page.name === "jobs" && <Jobs />}
        {page.name === "new" && <NewJob key={page.reg || "new"} reg={page.reg} />}
        {page.name === "job" && page.id && <JobPage key={page.id} id={page.id} />}
        {page.name === "vehicles" && <Vehicles />}
        {page.name === "vehicle" && page.id && <VehiclePage key={page.id} id={page.id} />}
        {page.name === "due" && <Due />}
        {page.name === "invoices" && <Invoices />}
        {page.name === "invoice" && page.id && <InvoicePage key={page.id} id={page.id} />}
        {page.name === "report" && owner && <Reports />}
        {page.name === "settings" && owner && <Settings />}
      </section>
    </WsContext.Provider>
  );
}
