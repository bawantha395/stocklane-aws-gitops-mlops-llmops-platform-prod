import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import QRCode from "qrcode";
import { Package, X } from "lucide-react";
import { api, config, headers, type Product } from "./api";
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
export async function printLabelSheet(items: Item[]) {
  const popup = window.open("", "_blank");
  if (!popup) throw new Error("Allow a new window to print the labels.");
  try {
    const esc = (v: string) => (v || "").replace(/[<&>"]/g, "");
    const cells: string[] = [];
    for (const item of items) {
      const qr = await QRCode.toDataURL("stocklane:v1:" + item.id, { width: 300, margin: 1 });
      cells.push('<div class="c"><img src="' + qr + '"><b>' + esc(item.name) + "</b><span>" + esc(item.part_number || item.sku) + "</span><span>" + esc(item.location || "") + "</span></div>");
    }
    popup.document.write("<!doctype html><title>Stock labels</title><style>body{font:12px sans-serif;margin:10mm}.g{display:grid;grid-template-columns:repeat(2,1fr);gap:6mm}.c{border:1px dashed #888;padding:5mm;text-align:center;break-inside:avoid}.c img{width:100%;max-width:68mm}.c b{display:block;font-size:20pt}.c span{display:block;font-size:15pt}button{margin:10px;padding:10px}@media print{button{display:none}}</style><button onclick='print()'>Print / Save as PDF</button><div class=g>" + cells.join("") + "</div>");
    popup.document.close();
  } catch (error) {
    popup.close();
    throw error;
  }
}
