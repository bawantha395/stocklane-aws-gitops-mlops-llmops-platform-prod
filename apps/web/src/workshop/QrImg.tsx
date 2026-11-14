import { useEffect, useState } from "react";
import QRCode from "qrcode";

/** A small QR code for a link. Shows nothing if the link cannot be encoded. */
export function QrImg({ text, size = 84 }: { text: string; size?: number }) {
  const [url, setUrl] = useState("");
  useEffect(() => { let live = true; QRCode.toDataURL(text, { margin: 1, width: size * 3, errorCorrectionLevel: "M" }).then((u) => live && setUrl(u)).catch(() => live && setUrl("")); return () => { live = false; }; }, [text, size]);
  return url ? <img className="ws-bill-qr" src={url} width={size} height={size} alt="QR code" /> : null;
}
