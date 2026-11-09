import { dateOnly, kmText, lkr, num, round2, type Business, type Labour, type Part, type Payment } from "./common";

export type BillData = {
  business: Business; number?: string; date: string; status?: string; draft?: boolean; customer: string; phone?: string; registration: string;
  vehicle?: string; odometer?: number | null; mechanic?: string; summary?: string; parts: Part[]; labour: Labour[]; discount: number;
  tax_name?: string; tax_rate: number; payments?: Payment[]; paid?: number; next_service_date?: string; next_service_km?: number | null;
};

export function billTotals(b: Pick<BillData, "parts" | "labour" | "discount" | "tax_rate">) {
  const parts = b.parts.reduce((s, p) => s + round2(num(p.quantity) * num(p.unit_price)), 0);
  const labour = b.labour.reduce((s, l) => s + num(l.amount), 0);
  const subtotal = parts + labour - num(b.discount);
  const tax = subtotal > 0 ? round2((subtotal * num(b.tax_rate)) / 100) : 0;
  return { parts, labour, subtotal, tax, total: subtotal + tax };
}

/** The bill as it prints: also used on screen as the preview. */
export function Bill({ d }: { d: BillData }) {
  const t = billTotals(d), b = d.business, paid = d.paid || 0;
  const title = d.status === "VOID" ? "VOID" : d.draft ? "DRAFT BILL" : d.tax_rate ? "TAX INVOICE" : "INVOICE";
  return (
    <article className="ws-bill" aria-label="Bill">
      <header className="ws-bill-head">
        <div>
          <h2>{b.name}</h2>
          {b.address && <p className="ws-pre">{b.address}</p>}
          <p>{[b.phone, b.email].filter(Boolean).join("  |  ")}</p>
          {b.reg_no && <p>{b.reg_no}</p>}
        </div>
        <div className="ws-bill-title">
          <strong>{title}</strong>
          {d.number && <b>{d.number}</b>}
          <span>Date: {d.date}</span>
          {d.status && !d.draft && <span>Status: {{ UNPAID: "Unpaid", PARTIAL: "Part paid", PAID: "Paid", VOID: "Void" }[d.status] || d.status}</span>}
        </div>
      </header>
      <section className="ws-bill-parties">
        <div><small>BILL TO</small><b>{d.customer}</b><span>{d.phone}</span></div>
        <div><small>VEHICLE</small><b className="ws-bill-reg">{d.registration}</b><span>{d.vehicle}</span><span>{d.odometer != null ? kmText(d.odometer) : ""}</span>{d.mechanic && <span>Mechanic: {d.mechanic}</span>}</div>
      </section>
      {d.summary && <section><small>WORK REQUESTED</small><p>{d.summary}</p></section>}
      <div className="ws-bill-scroll">
        <table className="ws-bill-table">
          <thead><tr><th>#</th><th>Parts</th><th className="r">Qty</th><th className="r">Unit price</th><th className="r">Amount (LKR)</th></tr></thead>
          <tbody>
            {d.parts.map((p, i) => <tr key={i}><td>{i + 1}</td><td>{p.name}</td><td className="r">{num(p.quantity)}</td><td className="r">{lkr(p.unit_price)}</td><td className="r">{lkr(round2(num(p.quantity) * num(p.unit_price)))}</td></tr>)}
            {!d.parts.length && <tr><td colSpan={5} className="muted">No parts</td></tr>}
          </tbody>
          <thead><tr><th>#</th><th colSpan={3}>Labour</th><th className="r">Amount (LKR)</th></tr></thead>
          <tbody>
            {d.labour.map((l, i) => <tr key={i}><td>{i + 1}</td><td colSpan={3}>{l.description}</td><td className="r">{lkr(l.amount)}</td></tr>)}
            {!d.labour.length && <tr><td colSpan={5} className="muted">No labour</td></tr>}
          </tbody>
        </table>
      </div>
      <dl className="ws-bill-totals">
        <div><dt>Parts</dt><dd>{lkr(t.parts)}</dd></div>
        <div><dt>Labour</dt><dd>{lkr(t.labour)}</dd></div>
        {num(d.discount) > 0 && <div><dt>Discount</dt><dd>-{lkr(d.discount)}</dd></div>}
        {t.tax > 0 && <div><dt>{d.tax_name || "VAT"} ({num(d.tax_rate)}%)</dt><dd>{lkr(t.tax)}</dd></div>}
        <div className="grand"><dt>TOTAL (LKR)</dt><dd>{lkr(t.total)}</dd></div>
        {paid > 0 && <div><dt>Paid</dt><dd>{lkr(paid)}</dd></div>}
        {!d.draft && d.status !== "VOID" && <div className="due"><dt>Balance due</dt><dd>{lkr(t.total - paid)}</dd></div>}
      </dl>
      {!!d.payments?.length && (
        <section><small>PAYMENTS RECEIVED</small>
          {d.payments.map((p) => <div className="ws-bill-pay" key={p.id}><span>{dateOnly(p.at)}  {p.method.charAt(0) + p.method.slice(1).toLowerCase()}{p.note ? "  " + p.note : ""}</span><b>{lkr(p.amount)}</b></div>)}
        </section>
      )}
      {(d.next_service_date || d.next_service_km) && (
        <p className="ws-bill-next">Next service due {[d.next_service_date && "on " + d.next_service_date, d.next_service_km && "at " + kmText(d.next_service_km)].filter(Boolean).join(" and ")}</p>
      )}
      {(b.bank || b.footer) && <footer>{b.bank && <><small>PAYMENT DETAILS</small><p className="ws-pre">{b.bank}</p></>}{b.footer && <p className="ws-pre muted">{b.footer}</p>}</footer>}
      <div className="ws-bill-sign"><span>Authorised signature</span></div>
    </article>
  );
}

export function PrintButton() {
  return <button className="button secondary small" onClick={() => window.print()}>Print</button>;
}

/** Per device: print the receipt by itself after an invoice is created or a payment is taken. */
export const autoPrintOn = () => { try { return localStorage.getItem("ws.autoprint") !== "off"; } catch { return true; } };
