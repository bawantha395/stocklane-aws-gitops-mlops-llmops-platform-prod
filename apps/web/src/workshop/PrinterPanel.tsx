import { useEffect, useState } from "react";
import { autoPrintOn } from "./Bill";
import { connectPrinter, disconnectPrinter, onPrinterChange, paperColumns, printerConnected, printerName, printerSupported, sendToPrinter, setPaperColumns, testBytes } from "./printer";

/** The one printer control in the Workshop header: connect once, set paper, choose auto-print. Without a connected printer, Print opens the browser print preview. */
export function PrinterPanel() {
  const [, tick] = useState(0), [message, setMessage] = useState(""), [cols, setCols] = useState<32 | 48>(paperColumns());
  useEffect(() => onPrinterChange(() => tick((n) => n + 1)), []);
  const run = async (work: () => Promise<void>) => { setMessage(""); try { await work(); } catch (e) { setMessage((e as Error).message); } };
  const [auto, setAuto] = useState(autoPrintOn);
  const supported = printerSupported(), connected = printerConnected();
  return (
    <details className="ws-printer">
      <summary className={connected ? "on" : ""}>{connected ? "Printer: " + printerName() : "Printer"}</summary>
      <div className="ws-printer-menu">
        {!supported ? <small>This browser prints through the normal print preview. For direct receipt printing use Chrome or Edge.</small> : !connected ? (
          <>
            <button className="button secondary small" onClick={() => void run(() => connectPrinter("usb"))}>USB printer</button>
            <button className="button secondary small" onClick={() => void run(() => connectPrinter("serial"))}>Serial or Bluetooth</button>
          </>
        ) : (
          <>
            <button className="button secondary small" onClick={() => void run(() => sendToPrinter(testBytes(cols)))}>Test print</button>
            <button className="button secondary small" onClick={() => void disconnectPrinter()}>Disconnect</button>
          </>
        )}
        <label>Paper
          <select value={cols} onChange={(e) => { const n = Number(e.target.value) === 32 ? 32 : 48; setCols(n); setPaperColumns(n); }}>
            <option value={48}>80 mm</option><option value={32}>58 mm</option>
          </select>
        </label>
        <label className="ws-autoprint"><input type="checkbox" checked={auto} onChange={(e) => { setAuto(e.target.checked); try { localStorage.setItem("ws.autoprint", e.target.checked ? "on" : "off"); } catch { /* keep for this visit */ } }} /> Print after an invoice or payment</label>
        <small>{connected ? "Receipts print straight to this printer, no dialog." : "No printer connected: Print opens the print preview and fits the paper you pick there (A4 or receipt roll)."}</small>
        {message && <p role="alert" className="stock-error">{message}</p>}
      </div>
    </details>
  );
}
