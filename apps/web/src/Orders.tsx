import { useEffect, useState } from "react";
import { can } from "./perms";
import { t, useSinhalaAllowed } from "./i18n";
import { toast } from "./ui";
import { useSuppliers } from "./Suppliers";
import { Empty, Loading, dateOnly, useCommand, useLoad } from "./workshop/common";

type Item = { key: string; want_id: string | null; product_id?: string | null; name: string; part_no: string; unit: string; quantity: number; stock?: number; reorder_level?: number; supplier_id?: string | null; supplier: string; source: "LOW" | "MARKED" | "JOB"; job_no?: string; registration?: string; note?: string; status: "OPEN" | "ORDERED"; order_no?: string };
type Order = { id: string; order_no: string; supplier_id: string; supplier: string; status: "SENT" | "RECEIVED" | "CANCELLED"; created_at: string; message?: string; lines: { name: string; part_no?: string; quantity: number; received: number; unit?: string }[]; contact?: { phone: string; whatsapp: string } };

const waNumber = (n: string) => { const d = n.replace(/\D/g, ""); return d.startsWith("94") ? d : d.replace(/^0/, "94"); };
const SOURCE: Record<string, string> = { LOW: "Low stock", MARKED: "Marked", JOB: "Needed for a job" };

export function Orders() {
  const [tab, setTab] = useState<"list" | "log">("list");
  return (
    <section className="ws">
      <div className="ws-top"><div><h1 className="ws-large">{t("To order")}</h1></div></div>
      <div className="ws-seg">{([["list", t("To order")], ["log", t("Orders sent")]] as ["list" | "log", string][]).map(([k, l]) => <button key={k} className={tab === k ? "on" : ""} aria-pressed={tab === k} onClick={() => setTab(k)}>{l}</button>)}</div>
      {tab === "list" ? <ToOrder onSent={() => setTab("log")} /> : <Log />}
    </section>
  );
}

function ToOrder({ onSent }: { onSent: () => void }) {
  const { data, error, reload } = useLoad<{ items: Item[]; open: number }>("/api/inventory/to-order");
  const { list: suppliers } = useSuppliers(), sinhalaOn = useSinhalaAllowed();
  const command = useCommand();
  const [qty, setQty] = useState<Record<string, string>>({}), [pick, setPick] = useState<Record<string, string>>({}), [off, setOff] = useState<Record<string, boolean>>({});
  const [lang, setLangNow] = useState<"en" | "si">(() => { try { return localStorage.getItem("lifta.orderLang") === "si" ? "si" : "en"; } catch { return "en"; } }), [busy, setBusy] = useState(""), [sent, setSent] = useState<Order | null>(null);
  const setLang = (l: "en" | "si") => { setLangNow(l); try { localStorage.setItem("lifta.orderLang", l); } catch { /* ignore */ } };
  useEffect(() => { const f = () => void reload(); window.addEventListener("lifta:stock-changed", f); return () => window.removeEventListener("lifta:stock-changed", f); }, [reload]);
  if (!data) return <Loading error={error} />;
  const open = data.items.filter((i) => i.status === "OPEN");
  const waiting = data.items.filter((i) => i.status === "ORDERED");
  // a part goes to the supplier picked here, else its usual one; a part with neither is left for the person to choose
  const where = (i: Item) => pick[i.key] ?? i.supplier_id ?? "";
  const groups = new Map<string, Item[]>();
  open.forEach((i) => groups.set(where(i), [...(groups.get(where(i)) || []), i]));
  const nameOf = (id: string) => (suppliers || []).find((s) => s.id === id)?.name || open.find((i) => i.supplier_id === id)?.supplier || "";
  const make = async (sid: string, items: Item[]) => {
    const chosen = items.filter((i) => !off[i.key]);
    if (!chosen.length) return;
    setBusy(sid);
    try {
      const o = await command<Order>("/api/inventory/orders", { supplierId: sid, lang: sinhalaOn ? lang : "en", items: chosen.map((i) => ({ ...(i.want_id ? { wantId: i.want_id } : { productId: i.product_id }), quantity: qty[i.key] ?? String(i.quantity) })) });
      setSent(o); await reload();
    } catch (e) { toast((e as Error).message, { bad: true }); } finally { setBusy(""); }
  };
  const cancel = async (i: Item) => { try { await command("/api/inventory/wants/" + i.want_id + "/cancel", {}); await reload(); } catch (e) { toast((e as Error).message, { bad: true }); } };
  if (sent) return <Sent order={sent} onDone={() => { setSent(null); onSent(); }} />;
  return (
    <>
      {sinhalaOn && <div className="ws-field"><span>{t("Message language")}</span><div className="ws-seg">{([["si", "සිංහල"], ["en", "English"]] as ["si" | "en", string][]).map(([k, l]) => <button key={k} className={lang === k ? "on" : ""} aria-pressed={lang === k} onClick={() => setLang(k)}>{l}</button>)}</div></div>}
      {open.length === 0 ? <Empty>{t("Nothing to order. Parts below their reorder level, parts you mark and parts a job needs show up here.")}</Empty> : [...groups.entries()].map(([sid, items]) => (
        <div className="ws-card" key={sid || "none"}>
          <div className="ws-section-head"><h3>{sid ? nameOf(sid) : t("No supplier chosen")}</h3></div>
          {!sid && <p className="stock-error">{t("Choose a supplier for these parts before you send the order.")}</p>}
          {items.map((i) => (
            <div className="ws-order-line" key={i.key}>
              <label className="ws-order-pick"><input type="checkbox" checked={!off[i.key]} onChange={(e) => setOff({ ...off, [i.key]: !e.target.checked })} />
                <span><b>{i.name}</b> <small>{i.part_no}</small><br /><small className="muted">{t(SOURCE[i.source])}{i.source === "LOW" ? " · " + t("in stock") + " " + i.stock : ""}{i.job_no ? " · " + i.job_no + (i.registration ? " " + i.registration : "") : ""}{i.note ? " · " + i.note : ""}</small></span></label>
              <span className="ws-order-ctl">
                <input className="ws-qty" aria-label={t("Quantity") + " " + i.name} inputMode="decimal" value={qty[i.key] ?? String(i.quantity)} onChange={(e) => setQty({ ...qty, [i.key]: e.target.value.replace(/[^0-9.]/g, "") })} />
                <select aria-label={t("Supplier") + " " + i.name} value={where(i)} onChange={(e) => setPick({ ...pick, [i.key]: e.target.value })}><option value="">{t("Not chosen")}</option>{(suppliers || []).filter((s) => s.active).map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select>
                {i.want_id && <button className="doc-link" onClick={() => void cancel(i)}>{t("Remove")}</button>}
              </span>
            </div>
          ))}
          <div className="ws-bar"><button className="button primary small" disabled={!sid || busy === sid || items.every((i) => off[i.key])} onClick={() => void make(sid, items)}>{t("Make order message")}</button></div>
        </div>
      ))}
      {waiting.length > 0 && (
        <div className="ws-card"><div className="ws-section-head"><h3>{t("Ordered, waiting")}</h3></div>
          {waiting.map((i) => <div className="ws-cust-line" key={i.key}><span><b>{i.name}</b> <small>{i.part_no}</small></span><span className="ws-cust-line-r"><span>{i.quantity}</span><small>{i.order_no}</small></span></div>)}
        </div>
      )}
    </>
  );
}

function Sent({ order, onDone }: { order: Order; onDone: () => void }) {
  const phone = order.contact?.whatsapp || order.contact?.phone || "";
  const copy = async () => { try { await navigator.clipboard.writeText(order.message || ""); toast(t("Copied.")); } catch { toast(t("Could not copy. Select the text and copy it."), { bad: true }); } };
  return (
    <div className="ws-card">
      <div className="ws-section-head"><h3>{order.order_no} · {order.supplier}</h3></div>
      <pre className="ws-order-msg">{order.message}</pre>
      {!phone && <p className="stock-error">{t("This supplier has no WhatsApp number. Copy the text and send it another way.")}</p>}
      <div className="ws-bar">
        {phone && <a className="button primary small" target="_blank" rel="noreferrer" href={"https://wa.me/" + waNumber(phone) + "?text=" + encodeURIComponent(order.message || "")}>{t("Send on WhatsApp")}</a>}
        <button className="button secondary small" onClick={() => void copy()}>{t("Copy text")}</button>
        <button className="button secondary small" onClick={onDone}>{t("Done")}</button>
      </div>
    </div>
  );
}

function Log() {
  const { data, error, reload } = useLoad<Order[]>("/api/inventory/orders");
  const command = useCommand();
  const [open, setOpen] = useState<Order | null>(null);
  if (!data) return <Loading error={error} />;
  const act = async (o: Order, action: "received" | "cancel") => { try { await command("/api/inventory/orders/" + o.id + "/close", { action }); await reload(); } catch (e) { toast((e as Error).message, { bad: true }); } };
  const show = async (o: Order) => { try { const { api } = await import("./api"); setOpen(await api<Order>("/api/inventory/orders/" + o.id)); } catch (e) { toast((e as Error).message, { bad: true }); } };
  if (open) return <Sent order={open} onDone={() => setOpen(null)} />;
  if (!data.length) return <Empty>{t("No orders yet.")}</Empty>;
  const tag = (s: Order["status"]) => (s === "SENT" ? t("Ordered") : s === "RECEIVED" ? t("Received") : t("Cancelled"));
  return (
    <div className="ws-card">
      {data.map((o) => {
        const got = o.lines.filter((l) => l.received >= l.quantity).length;
        return (
          <div className="ws-cust-line" key={o.id}>
            <span><b>{o.order_no}</b> <small>{dateOnly(o.created_at)} · {o.supplier}</small><br /><small>{o.lines.map((l) => l.name + " x " + l.quantity + (l.received ? " (" + l.received + " " + t("received") + ")" : "")).join(", ")}</small></span>
            <span className="ws-cust-line-r"><span className={"ws-pill " + o.status.toLowerCase()}>{tag(o.status)}</span>{o.status === "SENT" && <small>{got}/{o.lines.length} {t("lines received")}</small>}
              <button className="doc-link" onClick={() => void show(o)}>{t("Message")}</button>
              {o.status === "SENT" && can("orders") && <><button className="doc-link" onClick={() => void act(o, "received")}>{t("Mark received")}</button><button className="doc-link" onClick={() => void act(o, "cancel")}>{t("Cancel order")}</button></>}</span>
          </div>
        );
      })}
    </div>
  );
}
