import { useState } from "react";
import { csv } from "../api";
import { t } from "../i18n";
import { Empty, Loading, Num, dateOnly, useLoad } from "./common";

type Item = { id: string; name: string; sku: string; category: string; quantity: number; unit: string; location: string; last_sold: string | null; days: number; value: number | null };
type Data = { days: number; items: Item[]; count: number; value: number; unknown_cost: number; categories: { category: string; items: number; value: number }[] };

/** Owner: parts on the shelf that have not moved for a while, with the money tied up in them. Opens only when asked, so Reports stays quick. */
export function SlowStock() {
  const [open, setOpen] = useState(false), [days, setDays] = useState(90), [cat, setCat] = useState("");
  const { data, error } = useLoad<Data>(open ? "/api/workshop/slow-stock?days=" + days + (cat ? "&category=" + encodeURIComponent(cat) : "") : null);
  return (
    <details className="ws-card" onToggle={(e) => setOpen((e.target as HTMLDetailsElement).open)}>
      <summary><b>{t("Slow stock")}</b> <span className="muted">{t("Parts that have not sold for a long time")}</span></summary>
      {open && (
        <>
          <div className="ws-contact">
            {[60, 90, 180, 365].map((d) => <button key={d} className={"ws-chip" + (days === d ? " chosen" : "")} onClick={() => setDays(d)}>{d} {t("days")}</button>)}
            {data && <button className="button secondary small" onClick={() => csv("slow-stock-" + days + "d.csv", data.items.map((i) => ({ Part: i.name, SKU: i.sku, Category: i.category, Qty: i.quantity, "Last sold": i.last_sold || "", Days: i.days, "Value (LKR)": i.value ?? "" })))}>CSV</button>}
          </div>
          {error && <Loading error={error} />}
          {!data ? !error && <Loading /> : (
            <>
              <p><b><Num v={data.value} /></b> {t("tied up in {n} parts", { n: data.count })}{data.unknown_cost ? " · " + t("{n} parts have no cost entered", { n: data.unknown_cost }) : ""}</p>
              {data.categories.length > 1 && (
                <div className="ws-contact">
                  <button className={"ws-chip" + (!cat ? " chosen" : "")} onClick={() => setCat("")}>{t("All")}</button>
                  {data.categories.map((c) => <button key={c.category} className={"ws-chip" + (cat === c.category ? " chosen" : "")} onClick={() => setCat(c.category)}>{c.category || t("No category")} ({c.items})</button>)}
                </div>
              )}
              {data.items.map((i) => (
                <div key={i.id} className="ws-msg-row">
                  <div><b>{i.name}</b> <span className="muted">{i.sku}{i.location ? " · " + i.location : ""}</span>
                    <div className="muted">{i.quantity} {i.unit} · {i.last_sold ? t("last sold") + " " + dateOnly(i.last_sold) : t("never sold")} · {i.days} {t("days")}</div></div>
                  <b>{i.value === null ? "-" : <Num v={i.value} />}</b>
                </div>
              ))}
              {!data.items.length && <Empty>{t("Nothing is sitting still. Every part with stock has sold recently.")}</Empty>}
            </>
          )}
        </>
      )}
    </details>
  );
}
