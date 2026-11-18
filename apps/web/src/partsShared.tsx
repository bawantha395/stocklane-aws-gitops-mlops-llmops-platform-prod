import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import QRCode from "qrcode";
import { Package, X } from "lucide-react";
import { api, config, headers, openPdf, type Product } from "./api";
import { t } from "./i18n";
import { isPractice, samplePhotoBlob } from "./practice";

// Small pieces every stock screen uses: the part type, photos, the QR label print, the save-once helper.
export type Item = Product & {
  part_number?: string;
  location?: string;
  archived?: boolean;
};
export const uid = () => crypto.randomUUID();
export function aiMessage(ai?: { status: string; code?: string; message?: string; detail?: string; provider?: string; model?: string }) {
  if (!ai || ai.status === "not_needed") return "";
  if (ai.status === "used") return "";
  if (ai.status === "not_configured") return "AI suggestions are switched off.";
  if (ai.status === "limit_reached") return "Today's AI suggestion limit is reached.";
  const why =
    ai.code === "AI_PROVIDER_QUOTA"
      ? " (the AWS Bedrock quota for this account is not approved yet)"
      : ai.code === "AI_ACCESS_DENIED"
        ? " (Bedrock model access is not enabled)"
        : ai.detail
          ? " (" + ai.detail + ")"
          : "";
  return "AI suggestions are not available right now" + why + ".";
}
export function prettyModel(ai?: { provider?: string; model?: string }) {
  if (ai?.provider === "bedrock") return "Amazon Bedrock";
  const m = (ai?.model || "").replace(/^models\//, "");
  if (!m) return ai?.provider === "gemini" ? "Gemini" : "AI";
  return m.split("-").map((w) => (/^\d/.test(w) ? w : w.charAt(0).toUpperCase() + w.slice(1))).join(" ");
}
export const number = (n: number) =>
  new Intl.NumberFormat("en", { maximumFractionDigits: 3 }).format(Number(n));
export const when = (s: string) =>
  new Date(s).toLocaleString("en-GB", { timeZone: "Asia/Colombo" });
export function useCommand() {
  const pending = useRef({ body: "", key: "" });
  return async <T,>(path: string, body: unknown, method = "POST") => {
    const fingerprint = path + method + JSON.stringify(body);
    if (pending.current.body !== fingerprint)
      pending.current = { body: fingerprint, key: uid() };
    const value = await api<T>(
      path,
      { method, body: JSON.stringify(body) },
      pending.current.key,
    );
    pending.current = { body: "", key: "" };
    return value;
  };
}
export async function printLabel(item: Item) {
  const popup = window.open("", "_blank");
  if (!popup) throw new Error("Allow a new window to print the label.");
  try {
    const data = await QRCode.toDataURL("stocklane:v1:" + item.id, {
      width: 260,
      margin: 2,
    });
    const doc = popup.document;
    doc.title = "Stock label — " + item.sku;
    const style = doc.createElement("style");
    style.textContent =
      "body{font:14px sans-serif;text-align:center;margin:12mm}img{width:90mm;height:90mm}h1{font-size:30px}p{margin:8px;font-size:20px}button{margin:20px;padding:12px}@media print{button{display:none}}";
    doc.head.append(style);
    const img = doc.createElement("img");
    img.src = data;
    img.alt = "Product QR";
    doc.body.append(img);
    for (const text of [
      item.name,
      item.brand,
      item.part_number || item.sku,
      item.location || "",
    ]) {
      const p = doc.createElement("p");
      p.textContent = text;
      doc.body.append(p);
    }
    const button = doc.createElement("button");
    button.textContent = "Print / Save as PDF";
    button.onclick = () => popup.print();
    doc.body.append(button);
  } catch (error) {
    popup.close();
    throw error;
  }
}
export function Photo({ id, zoom = false, peek = false, caption = "" }: { id: string; zoom?: boolean; peek?: boolean; caption?: string }) {
  const [url, setUrl] = useState("");
  const [open, setOpen] = useState(false);
  useEffect(() => {
    if (!open) return;
    const key = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, [open]);
  useEffect(() => {
    let active = true;
    let object = "";
    apiPhoto(id)
      .then((blob) => {
        object = URL.createObjectURL(blob);
        if (active) setUrl(object);
        else URL.revokeObjectURL(object);
      })
      .catch(() => {});
    return () => {
      active = false;
      if (object) URL.revokeObjectURL(object);
    };
  }, [id]);
  return url ? (
    peek ? (
      <>
        {/* quick look from inside a list row: a tap on the picture opens it large; a tap anywhere else still picks the row */}
        <span role="button" tabIndex={0} className="photo-peek" aria-label={t("Quick look")} onClick={(e) => { e.stopPropagation(); e.preventDefault(); setOpen(true); }}
          onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.stopPropagation(); e.preventDefault(); setOpen(true); } }}>
          <img className="item-photo" src={url} alt="" />
        </span>
        {open && createPortal(
          <div className="photo-viewer" role="dialog" aria-modal="true" aria-label={caption || "Photo"} onClick={(e) => { e.stopPropagation(); setOpen(false); }}>
            <button type="button" className="photo-viewer-close" aria-label="Close photo" onClick={(e) => { e.stopPropagation(); setOpen(false); }}><X /></button>
            <img src={url} alt={caption} onClick={(e) => e.stopPropagation()} />
            {caption && <p className="photo-viewer-cap">{caption}</p>}
          </div>, document.body)}
      </>
    ) : zoom ? (
      <>
        <button type="button" className="photo-zoom-btn" aria-label="View the photo full screen" onClick={() => setOpen(true)}>
          <img className="item-photo" src={url} alt="Uploaded photo" />
        </button>
        {open && createPortal(
          <div className="photo-viewer" role="dialog" aria-modal="true" aria-label="Photo" onClick={() => setOpen(false)}>
            <button type="button" className="photo-viewer-close" aria-label="Close photo" onClick={() => setOpen(false)}><X /></button>
            <img src={url} alt="Uploaded photo, full size" onClick={(e) => e.stopPropagation()} />
          </div>, document.body)}
      </>
    ) : (
      <img className="item-photo" src={url} alt="Approved item reference" />
    )
  ) : (
    <span className="photo-placeholder">
      <Package />
    </span>
  );
}
export async function apiPhoto(id: string) {
  if (isPractice()) { const b = samplePhotoBlob(); if (b) return b; throw new Error("Photo unavailable"); }
  const r = await fetch(
    (config.apiBase || "") + "/api/vision/images/" + encodeURIComponent(id),
    { headers: await headers() },
  );
  if (!r.ok) throw new Error("Photo unavailable");
  return r.blob();
}
/** Several parts on one A4 sheet: QR, name and shelf for each. Opens in a new tab and offers to print. */
/** The QR as "N:" plus N*N zeros and ones; the server draws it in the PDF (the same way the invoice QR is drawn). */
export function qrPacked(text: string) {
  const m = QRCode.create(text, { errorCorrectionLevel: "M" }).modules;
  let b = "";
  for (let r = 0; r < m.size; r++) for (let c = 0; c < m.size; c++) b += m.get(r, c) ? "1" : "0";
  return m.size + ":" + b;
}
/** Labels print the way bills do: a PDF opens in a new tab and the browser's own viewer prints it. */
export async function printLabelsPdf(labels: { title: string; sub?: string; code: string }[]) {
  for (let i = 0; i < labels.length; i += 150) {
    const part = labels.slice(i, i + 150).map((l) => ({ title: l.title, sub: l.sub || "", bits: qrPacked(l.code) }));
    await openPdf("/api/inventory/labels/pdf", "labels.pdf", { method: "POST", body: JSON.stringify({ labels: part }) });
  }
}

const escHtml = (v: string) => v.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c] as string));
function qrSvg(text: string) {
  const m = QRCode.create(text, { errorCorrectionLevel: "M" }).modules, n = m.size;
  let d = "";
  for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) if (m.get(r, c)) d += "M" + c + " " + r + "h1v1h-1z";
  return '<svg xmlns="http://www.w3.org/2000/svg" viewBox="-2 -2 ' + (n + 4) + " " + (n + 4) + '" shape-rendering="crispEdges"><path d="' + d + '"/></svg>';
}
/** Labels print the way a bill does: the sheet is drawn in this page and the browser's own print window opens (no new tab). Everything else is hidden while printing. */
export function printLabelsInPage(labels: { title: string; sub?: string; code: string }[]) {
  if (!labels.length) return;
  document.getElementById("label-print")?.remove();
  const host = document.createElement("div");
  host.id = "label-print";
  host.innerHTML = labels.map((l) => '<figure class="lp-cell">' + qrSvg(l.code) + "<b>" + escHtml(l.title) + "</b>" + (l.sub ? "<small>" + escHtml(l.sub) + "</small>" : "") + "</figure>").join("");
  document.body.appendChild(host);
  document.body.classList.add("printing-labels");
  const done = () => { document.body.classList.remove("printing-labels"); host.remove(); };
  window.addEventListener("afterprint", done, { once: true });
  setTimeout(() => window.print(), 60);
}
export async function printLabelSheet(items: Item[]) {
  printLabelsInPage(items.map((item) => ({ title: item.name, sub: [item.part_number || item.sku, item.location].filter(Boolean).join("  "), code: "stocklane:v1:" + item.id })));
}
