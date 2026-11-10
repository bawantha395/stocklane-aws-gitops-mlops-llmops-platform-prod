/**
 * Direct thermal printing (ESC/POS) from Chrome or Edge, no print dialog.
 * One click on "Connect printer" gives the browser permission; it remembers the printer, so after that the page finds it again
 * by itself. USB printers use WebUSB, serial and Bluetooth printers use Web Serial. Anything else falls back to window.print().
 */
import { billTotals } from "./Bill";
import type { Business, Invoice } from "./common";

/* The Web USB and Web Serial types are not in the default TypeScript library, so they are kept loose here. */
type Link = { kind: "usb"; device: any; endpoint: number } | { kind: "serial"; port: any };
let link: Link | null = null;
let listeners: Array<() => void> = [];
const changed = () => listeners.forEach((f) => f());
export const onPrinterChange = (f: () => void) => { listeners.push(f); return () => { listeners = listeners.filter((x) => x !== f); }; };
export const printerName = () => (link ? (link.kind === "usb" ? link.device.productName || "USB printer" : "Serial printer") : "");
export const printerConnected = () => link !== null;
export const printerSupported = () => typeof navigator !== "undefined" && ("usb" in navigator || "serial" in navigator);

export const paperColumns = () => { try { return Number(localStorage.getItem("ws.cols")) === 32 ? 32 : 48; } catch { return 48; } };
export const setPaperColumns = (n: 32 | 48) => { try { localStorage.setItem("ws.cols", String(n)); } catch { /* per visit */ } };

/* ---------- the receipt bytes ---------- */
const ESC = 0x1b, GS = 0x1d;
const ascii = (s: string) => Array.from(String(s ?? "")).map((c) => { const n = c.charCodeAt(0); return n >= 32 && n < 127 ? n : 63; });
const money = (v: number | string) => Number(v).toLocaleString("en", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export function wrapText(text: string, width: number): string[] {
  const out: string[] = [];
  for (const raw of String(text ?? "").split("\n")) {
    let line = "";
    for (const word of raw.split(/\s+/).filter(Boolean)) {
      let w = word;
      while (w.length > width) { if (line) { out.push(line); line = ""; } out.push(w.slice(0, width)); w = w.slice(width); }
      if (!line) line = w; else if ((line + " " + w).length <= width) line += " " + w; else { out.push(line); line = w; }
    }
    if (line || !raw.trim()) out.push(line);
  }
  return out.filter((l, i, a) => l || (i > 0 && a[i - 1]));
}
const pair = (left: string, right: string, width: number) => {
  const space = Math.max(1, width - left.length - right.length);
  return left.length + right.length + 1 > width ? wrapText(left, width - right.length - 1).map((l, i, a) => (i === a.length - 1 ? l + " ".repeat(Math.max(1, width - l.length - right.length)) + right : l)) : [left + " ".repeat(space) + right];
};

export function receiptBytes(inv: Invoice, shop: Business, width = paperColumns()): Uint8Array {
  const out: number[] = [];
  const raw = (...b: number[]) => out.push(...b);
  const line = (s: string) => { out.push(...ascii(s), 0x0a); };
  const align = (n: 0 | 1 | 2) => raw(ESC, 0x61, n);
  const bold = (on: boolean) => raw(ESC, 0x45, on ? 1 : 0);
  const size = (n: 0 | 0x11) => raw(GS, 0x21, n);
  const rule = (c = "-") => line(c.repeat(width));
  const wrapped = (s: string) => wrapText(s, width).forEach(line);
  const t = billTotals({ parts: inv.parts, labour: inv.labour, discount: inv.discount, tax_rate: inv.tax_rate });
  const paid = Number(inv.paid || 0);

  raw(ESC, 0x40); // initialise
  align(1); bold(true); size(0x11); wrapText(shop.name, Math.floor(width / 2)).forEach(line); size(0); bold(false);
  wrapText(shop.address, width).forEach(line);
  if (shop.phone) line(shop.phone);
  if (shop.reg_no) line(shop.reg_no);
  rule("=");
  bold(true); line(inv.tax_rate ? "TAX INVOICE" : "INVOICE"); bold(false);
  wrapped(inv.invoice_number);
  line("Date: " + inv.created_at.slice(0, 10) + (inv.status === "VOID" ? "  VOID" : ""));
  rule();
  align(0);
  wrapped("Customer: " + inv.customer);
  if (inv.phone) wrapped("Phone: " + inv.phone);
  bold(true); wrapped("Vehicle: " + inv.registration); bold(false);
  if (inv.vehicle) wrapText(inv.vehicle, width).forEach(line);
  if (inv.odometer != null) wrapped("Odometer: " + Number(inv.odometer).toLocaleString("en") + " km");
  if (inv.mechanic) wrapped("Mechanic: " + inv.mechanic);
  rule();
  if (inv.parts.length) {
    bold(true); line("PARTS"); bold(false);
    for (const p of inv.parts) {
      wrapText(p.name, width).forEach(line);
      pair("  " + Number(p.quantity) + " x " + money(p.unit_price), money(Number(p.quantity) * Number(p.unit_price)), width).forEach(line);
    }
  }
  if (inv.labour.length) {
    bold(true); line("LABOUR"); bold(false);
    for (const l of inv.labour) pair(l.description.slice(0, width - 12), money(l.amount), width).forEach(line);
  }
  rule();
  pair("Parts", money(t.parts), width).forEach(line);
  pair("Labour", money(t.labour), width).forEach(line);
  if (Number(inv.discount) > 0) pair("Discount", "-" + money(inv.discount), width).forEach(line);
  if (t.tax > 0) pair((inv.tax_name || "VAT") + " " + Number(inv.tax_rate) + "%", money(t.tax), width).forEach(line);
  rule("=");
  bold(true); size(0x11); pair("TOTAL", money(t.total), Math.floor(width / 2)).forEach(line); size(0); bold(false);
  if (paid > 0) pair("Paid", money(paid), width).forEach(line);
  if (inv.status !== "VOID") { bold(true); pair("Balance due", money(t.total - paid), width).forEach(line); bold(false); }
  for (const p of inv.payments || []) line(("  " + p.at.slice(0, 10) + " " + p.method.charAt(0) + p.method.slice(1).toLowerCase()).slice(0, width));
  if (inv.next_service_date || inv.next_service_km) {
    rule();
    wrapped("Next service: " + [inv.next_service_date, inv.next_service_km ? Number(inv.next_service_km).toLocaleString("en") + " km" : ""].filter(Boolean).join(" / "));
  }
  rule();
  align(1);
  wrapText(shop.footer || "Thank you for your business.", width).forEach(line);
  raw(0x0a, 0x0a, 0x0a, 0x0a);
  raw(GS, 0x56, 0x42, 0x00); // feed and cut (printers without a cutter ignore it)
  return Uint8Array.from(out);
}

export function testBytes(width = paperColumns()): Uint8Array {
  const out: number[] = [ESC, 0x40, ESC, 0x61, 1, ESC, 0x45, 1];
  out.push(...ascii("PRINTER OK"), 0x0a, ESC, 0x45, 0, ...ascii("Lifta workshop suite"), 0x0a, ...ascii("-".repeat(width)), 0x0a, ...ascii("1234567890".repeat(5).slice(0, width)), 0x0a, 0x0a, 0x0a, 0x0a, GS, 0x56, 0x42, 0x00);
  return Uint8Array.from(out);
}

/* ---------- connecting ---------- */
async function openUsb(device: any): Promise<Link> {
  await device.open();
  if (device.configuration === null) await device.selectConfiguration(1);
  for (const iface of device.configuration.interfaces) {
    for (const alt of iface.alternates) {
      const out = alt.endpoints.find((e: any) => e.direction === "out" && e.type === "bulk");
      if (out) { await device.claimInterface(iface.interfaceNumber); if (alt.alternateSetting) await device.selectAlternateInterface(iface.interfaceNumber, alt.alternateSetting); return { kind: "usb", device, endpoint: out.endpointNumber }; }
    }
  }
  throw new Error("This USB device has no printing endpoint.");
}
async function openSerial(port: any): Promise<Link> {
  if (!port.readable) await port.open({ baudRate: 9600 });
  return { kind: "serial", port };
}

/** Ask the browser for permission (needs a click). USB first, then serial or Bluetooth. */
export async function connectPrinter(kind: "usb" | "serial"): Promise<void> {
  const nav = navigator as any;
  if (kind === "usb") {
    if (!nav.usb) throw new Error("This browser cannot use USB printers. Use Chrome or Edge.");
    let device: any;
    try { device = await nav.usb.requestDevice({ filters: [] }); } catch { throw new Error("No printer was chosen."); }
    try { link = await openUsb(device); } catch (e) { throw new Error("Could not open the USB printer. On Windows it needs the WinUSB driver (Zadig), on a Mac the system may hold it. Try Serial or Bluetooth, or the Chrome print switch in the README. " + (e as Error).message); }
  } else {
    if (!nav.serial) throw new Error("This browser cannot use serial printers. Use Chrome or Edge.");
    let port: any;
    try { port = await nav.serial.requestPort(); } catch { throw new Error("No printer was chosen."); }
    try { link = await openSerial(port); } catch (e) { throw new Error("Could not open the serial printer: " + (e as Error).message); }
  }
  changed();
}

/** On page load: reconnect to a printer the browser already has permission for. No click needed. */
export async function reconnectPrinter(): Promise<void> {
  if (link) return;
  const nav = navigator as any;
  try {
    const usb: any[] = nav.usb ? await nav.usb.getDevices() : [];
    for (const d of usb) { try { link = await openUsb(d); changed(); return; } catch { /* try the next one */ } }
    const serial: any[] = nav.serial ? await nav.serial.getPorts() : [];
    for (const p of serial) { try { link = await openSerial(p); changed(); return; } catch { /* try the next one */ } }
  } catch { /* no permission yet */ }
}

export async function disconnectPrinter(): Promise<void> {
  const l = link; link = null; changed();
  try { if (l?.kind === "usb") await l.device.close(); else if (l?.kind === "serial") await l.port.close(); } catch { /* already gone */ }
}

export async function sendToPrinter(bytes: Uint8Array): Promise<void> {
  if (!link) throw new Error("No printer is connected.");
  try {
    if (link.kind === "usb") {
      for (let i = 0; i < bytes.length; i += 4096) await link.device.transferOut(link.endpoint, bytes.slice(i, i + 4096));
    } else {
      const writer = link.port.writable.getWriter();
      try { await writer.write(bytes); } finally { writer.releaseLock(); }
    }
  } catch (e) {
    link = null; changed();
    throw new Error("The printer did not answer. Check the cable and power, then connect it again. " + (e as Error).message);
  }
}

if (typeof navigator !== "undefined") {
  const nav = navigator as any;
  nav.usb?.addEventListener?.("disconnect", () => { link = null; changed(); });
  nav.usb?.addEventListener?.("connect", () => { void reconnectPrinter(); });
  nav.serial?.addEventListener?.("disconnect", () => { link = null; changed(); });
  nav.serial?.addEventListener?.("connect", () => { void reconnectPrinter(); });
}
