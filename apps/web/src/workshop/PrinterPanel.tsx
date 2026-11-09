import { useEffect, useState } from "react";
import { connectPrinter, disconnectPrinter, onPrinterChange, paperColumns, printerConnected, printerName, printerSupported, sendToPrinter, setPaperColumns, testBytes } from "./printer";

/** Small printer menu in the Workshop header: connect once, then receipts print by themselves. */
export function PrinterPanel() {
  const [, tick] = useState(0), [message, setMessage] = useState(""), [cols, setCols] = useState<32 | 48>(paperColumns());
  useEffect(() => onPrinterChange(() => tick((n) => n + 1)), []);
  const run = async (work: () => Promise<void>) => { setMessage(""); try { await work(); } catch (e) { setMessage((e as Error).message); } };
  if (!printerSupported()) return null;
  const connected = printerConnected();
  return (
    <details className="ws-printer">
      <summary className={connected ? "on" : ""}>{connected ? "Printer: " + printerName() : "Connect printer"}</summary>
      <div className="ws-printer-menu">
        {!connected ? (
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
        <small>Connect once. This browser remembers the printer, so receipts print by themselves with no dialog.</small>
        {message && <p role="alert" className="stock-error">{message}</p>}
      </div>
    </details>
  );
}
