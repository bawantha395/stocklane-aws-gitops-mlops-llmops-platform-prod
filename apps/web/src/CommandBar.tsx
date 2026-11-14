import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Car, ClipboardList, Package, Receipt, Search } from "lucide-react";
import { api } from "./api";
import { t, useLang } from "./i18n";
import { Sheet } from "./ui";
import type { Page } from "./workshop/common";

type Hit = { key: string; icon: ReactNode; title: string; sub: string; run: () => void };
type Data = { jobs: any[]; invoices: any[]; vehicles: any[]; parts: any[] };
const norm = (s: unknown) => String(s ?? "").toLowerCase().replace(/[^a-z0-9]/g, "");

/** Search anything: vehicle number, customer, part, invoice. Ctrl/Cmd+K on desktop. */
export function CommandBar({ open, onClose, workshop, openWorkshop, openPart }: { open: boolean; onClose: () => void; workshop: boolean; openWorkshop: (p: Page) => void; openPart: (q: string) => void }) {
  useLang();
  const [q, setQ] = useState(""), [data, setData] = useState<Data | null>(null), [sel, setSel] = useState(0);
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (!open) return; setQ(""); setSel(0); setTimeout(() => input.current?.focus(), 50);
    const safe = <T,>(p: string) => api<T[]>(p).then((r) => (Array.isArray(r) ? r : ([] as T[]))).catch(() => [] as T[]);
    void Promise.all([workshop ? safe("/api/workshop/jobs") : [], workshop ? safe("/api/workshop/invoices") : [], workshop ? safe("/api/workshop/vehicles?search=") : [], safe("/api/inventory/products")]).then(([jobs, invoices, vehicles, parts]) => setData({ jobs: jobs as any[], invoices: invoices as any[], vehicles: vehicles as any[], parts: parts as any[] }));
  }, [open, workshop]);
  const hits = useMemo<Hit[]>(() => {
    const n = norm(q); if (!data || n.length < 2) return [];
    const has = (...f: unknown[]) => f.some((x) => norm(x).includes(n));
    const out: Hit[] = [];
    data.vehicles.filter((v) => has(v.registration, v.owner, v.phone, v.make)).slice(0, 5).forEach((v) => out.push({ key: "v" + v.id, icon: <Car size={18} />, title: v.registration, sub: [v.owner, v.make].filter(Boolean).join(" · ") || t("Vehicle"), run: () => openWorkshop({ name: "vehicle", id: v.id }) }));
    data.jobs.filter((j) => has(j.registration, j.customer, j.phone, j.summary)).slice(0, 5).forEach((j) => out.push({ key: "j" + j.id, icon: <ClipboardList size={18} />, title: j.registration + " · " + (j.customer || ""), sub: t("Job") + " · " + (j.summary || ""), run: () => openWorkshop({ name: "job", id: j.id }) }));
    data.invoices.filter((i) => has(i.invoice_number, i.registration, i.customer)).slice(0, 5).forEach((i) => out.push({ key: "i" + i.id, icon: <Receipt size={18} />, title: i.invoice_number + " · " + i.registration, sub: t("Invoice") + " · " + (i.customer || ""), run: () => openWorkshop({ name: "invoice", id: i.id }) }));
    data.parts.filter((p) => has(p.name, p.sku, p.barcode, p.brand)).slice(0, 5).forEach((p) => out.push({ key: "p" + p.id, icon: <Package size={18} />, title: p.name, sub: t("Part") + " · " + p.sku + " · " + p.quantity + " " + (p.unit || ""), run: () => openPart(p.name) }));
    return out;
  }, [q, data, openWorkshop, openPart]);
  if (!open) return null;
  const choose = (h?: Hit) => { if (!h) return; onClose(); h.run(); };
  return (
    <Sheet title={t("Search anything")} onClose={onClose}>
      <div className="cmd-input"><Search size={18} /><input ref={input} value={q} onChange={(e) => { setQ(e.target.value); setSel(0); }} placeholder={t("Vehicle number, customer, part or invoice")} inputMode="search" aria-label={t("Search anything")}
        onKeyDown={(e) => { if (e.key === "ArrowDown") { e.preventDefault(); setSel((s) => Math.min(s + 1, hits.length - 1)); } else if (e.key === "ArrowUp") { e.preventDefault(); setSel((s) => Math.max(s - 1, 0)); } else if (e.key === "Enter") choose(hits[sel]); }} /></div>
      <div className="cmd-list" role="listbox">
        {!data && <p className="muted">{t("Loading…")}</p>}
        {data && q.trim().length < 2 && <p className="muted">{t("Type at least 2 letters.")}</p>}
        {data && q.trim().length >= 2 && !hits.length && <p className="muted">{t("Nothing found.")}</p>}
        {hits.map((h, i) => <button key={h.key} role="option" aria-selected={i === sel} className={"cmd-hit" + (i === sel ? " on" : "")} onClick={() => choose(h)}><span className="cmd-ic">{h.icon}</span><span><b>{h.title}</b><small>{h.sub}</small></span></button>)}
      </div>
    </Sheet>
  );
}
