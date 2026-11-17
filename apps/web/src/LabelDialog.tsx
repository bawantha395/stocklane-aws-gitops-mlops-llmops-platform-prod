import { useEffect, useState } from "react";
import QRCode from "qrcode";
import { Package, Printer, X } from "lucide-react";
import { t } from "./i18n";
import { Item, printLabel, Photo } from "./partsShared";

export function ItemPhoto({ item, peek = false }: { item: Item; peek?: boolean }) {
  return item.image_id ? (
    <Photo id={item.image_id} peek={peek} caption={item.name} />
  ) : (
    <span className="photo-placeholder">
      <Package size={28} />
    </span>
  );
}
export function LabelDialog({ item, onClose }: { item: Item; onClose: () => void }) {
  const [data, setData] = useState("");
  const [error, setError] = useState("");
  useEffect(() => {
    let active = true;
    QRCode.toDataURL("stocklane:v1:" + item.id, { width: 360, margin: 3 })
      .then((value) => {
        if (active) setData(value);
      })
      .catch(() => setError("QR generation failed. Reopen Print QR to retry."));
    return () => {
      active = false;
    };
  }, [item.id]);
  return (
    <div className="stock-modal-shade">
      <section
        className="stock-modal stock-label-dialog"
        role="dialog"
        aria-modal="true"
        aria-label="Printable QR label"
      >
        <button
          className="stock-close"
          aria-label="Close label"
          onClick={onClose}
        >
          <X />
        </button>
        <h2>{t("Product QR label")}</h2>
        <p>{t("Print and attach this label to the item or its storage bin.")}</p>
        {data && (
          <img
            className="stock-qr-preview"
            src={data}
            alt="Generated Lifta product QR"
          />
        )}
        <h3>{item.name}</h3>
        <p>
          {item.brand} · Part no. {item.part_number || "Not set"} · System no. {item.sku}
          <br />
          {item.location}
        </p>
        {error && <p role="alert">{error}</p>}
        <div className="stock-form-actions">
          <a
            className="button secondary"
            href={data}
            download={item.sku + "-qr.png"}
          >
            Download PNG
          </a>
          <button
            className="button primary"
            disabled={!data}
            onClick={() =>
              void printLabel(item).catch((e) => setError(e.message))
            }
          >
            <Printer size={18} /> Print / Save PDF
          </button>
        </div>
      </section>
    </div>
  );
}