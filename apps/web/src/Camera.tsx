import { useEffect, useRef, useState } from "react";
import jsQR from "jsqr";
import { Camera as CameraIcon, X } from "lucide-react";
import { markNativePick, clearNativePick } from "./resume";
import { t, useLang } from "./i18n";
import { isPractice, samplePhoto } from "./practice";

/**
 * One live camera for everything at the counter: a Stocklane QR in view is read by itself,
 * and the big button takes a photo of the part. Frames never leave the device until a photo is taken.
 * Without a camera (or permission) the person can still choose a photo from the device.
 */
function LiveCamera({
  onQR,
  onBarcode,
  onPhoto,
  onClose,
}: {
  onQR: (value: string) => void;
  onBarcode?: (value: string) => void;
  onPhoto: (file: File) => void;
  onClose: () => void;
}) {
  useLang();
  const video = useRef<HTMLVideoElement>(null);
  const picker = useRef<HTMLInputElement>(null);
  const [error, setError] = useState("");
  const [ready, setReady] = useState(false);
  const [barcodeReady, setBarcodeReady] = useState(false);
  useEffect(() => {
    let disposed = false,
      stream: MediaStream | undefined,
      timer: ReturnType<typeof setTimeout>;
    const canvas = document.createElement("canvas");
    const barcodeDetector = "BarcodeDetector" in window
      ? new (window as Window & { BarcodeDetector: new (options: { formats: string[] }) => { detect: (source: HTMLVideoElement) => Promise<{ rawValue: string }[]> } }).BarcodeDetector({ formats: ["ean_8", "ean_13", "upc_a", "upc_e", "code_128"] })
      : null;
    setBarcodeReady(!!barcodeDetector);
    // iPhone Safari has no BarcodeDetector: load a small JavaScript reader (ZXing) only when it is needed.
    let soft: { decode: (canvas: HTMLCanvasElement) => string } | null = null;
    if (!barcodeDetector && onBarcode) {
      void import("@zxing/library").then((z) => {
        if (disposed) return;
        const reader = new z.MultiFormatReader();
        reader.setHints(new Map<unknown, unknown>([
          [z.DecodeHintType.POSSIBLE_FORMATS, [z.BarcodeFormat.EAN_13, z.BarcodeFormat.EAN_8, z.BarcodeFormat.UPC_A, z.BarcodeFormat.UPC_E, z.BarcodeFormat.CODE_128]],
          [z.DecodeHintType.TRY_HARDER, true],
        ]) as Map<never, never>);
        soft = {
          decode: (canvas) => {
            const source = new z.HTMLCanvasElementLuminanceSource(canvas);
            return reader.decode(new z.BinaryBitmap(new z.HybridBinarizer(source))).getText();
          },
        };
        setBarcodeReady(true);
      }).catch(() => {});
    }
    const wide = document.createElement("canvas");
    let tick = 0;
    const stop = () => stream?.getTracks().forEach((track) => track.stop());
    const read = () => {
      if (disposed) return;
      const v = video.current;
      if (v && v.readyState >= 2 && v.videoWidth) {
        canvas.width = Math.min(640, v.videoWidth);
        canvas.height = Math.round((v.videoHeight * canvas.width) / v.videoWidth);
        const context = canvas.getContext("2d", { willReadFrequently: true });
        if (context) {
          context.drawImage(v, 0, 0, canvas.width, canvas.height);
          const pixels = context.getImageData(0, 0, canvas.width, canvas.height);
          const code = jsQR(pixels.data, pixels.width, pixels.height, { inversionAttempts: "dontInvert" });
          if (code) {
            disposed = true;
            stop();
            onQR(code.data);
            return;
          }
        }
        if (barcodeDetector && onBarcode) {
          void barcodeDetector.detect(v).then((codes) => {
            const value = codes[0]?.rawValue;
            if (value && !disposed) {
              disposed = true;
              stop();
              onBarcode(value);
            }
          }).catch(() => {});
        }
      }
      if (soft && onBarcode && v && v.readyState >= 2 && v.videoWidth && ++tick % 2 === 0) {
        // A bigger frame than the QR check uses: thin barcode lines need the pixels.
        wide.width = Math.min(1280, v.videoWidth);
        wide.height = Math.round((v.videoHeight * wide.width) / v.videoWidth);
        wide.getContext("2d", { willReadFrequently: true })?.drawImage(v, 0, 0, wide.width, wide.height);
        try {
          const value = soft.decode(wide);
          if (value && !disposed) {
            disposed = true;
            stop();
            onBarcode(value);
            return;
          }
        } catch {
          /* no barcode in this frame */
        }
      }
      timer = setTimeout(read, 200);
    };
    (async () => {
      try {
        if (!navigator.mediaDevices?.getUserMedia) throw new Error("no camera API");
        stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: "environment" }, width: { ideal: 1600 } }, audio: false });
        if (disposed) return stop();
        if (video.current) {
          video.current.srcObject = stream;
          await video.current.play();
          setReady(true);
          read();
        }
      } catch {
        stop();
        if (!disposed) setError("The camera could not start. Allow camera access for this site, or choose a photo from this device.");
      }
    })();
    return () => {
      disposed = true;
      clearTimeout(timer);
      stop();
    };
  }, [onQR, onBarcode]);
  const shoot = () => {
    const v = video.current;
    if (!v || !v.videoWidth) return;
    const canvas = document.createElement("canvas");
    canvas.width = v.videoWidth;
    canvas.height = v.videoHeight;
    canvas.getContext("2d")?.drawImage(v, 0, 0);
    canvas.toBlob(
      (blob) => {
        if (!blob) return setError("The photo could not be taken. Try again.");
        (v.srcObject as MediaStream | null)?.getTracks().forEach((track) => track.stop());
        onPhoto(new File([blob], "part.jpg", { type: "image/jpeg" }));
      },
      "image/jpeg",
      0.92,
    );
  };
  return (
    <div className="stock-modal-shade">
      <section className="scanner-dialog" role="dialog" aria-modal="true" aria-labelledby="camera-title">
        <div className="section-heading">
          <div>
            <p className="eyebrow">{t("CAMERA")}</p>
            <h2 id="camera-title">{t("Scan a QR or product barcode")}</h2>
          </div>
          <button className="icon-button" aria-label={t("Close")} onClick={onClose}>
            <X />
          </button>
        </div>
        {!error && (
          <div className="live-video">
            <video ref={video} muted playsInline />
            <div className="scan-frame" />
            <span>
              <CameraIcon size={18} /> {t("QR and product barcodes are detected automatically.")}
            </span>
          </div>
        )}
        {!error && (
          <p className="camera-capability" role="status">
            {barcodeReady
              ? t("Barcode reader ready. Point at an EAN, UPC or Code 128 barcode.")
              : t("This browser does not support live barcodes. Use a QR label or take a photo.")}
          </p>
        )}
        {error && (
          <p className="stock-error" role="alert">
            {t(error)}
          </p>
        )}
        {!error && (
          <button className="button primary full camera-shutter" disabled={!ready} onClick={shoot}>
            <CameraIcon size={22} /> {t("Take photo")}
          </button>
        )}
        <input ref={picker} hidden type="file" accept="image/*" onChange={(e) => { clearNativePick(); if (e.target.files?.[0]) onPhoto(e.target.files[0]); }} />
        <button className="button secondary full" onClick={() => { markNativePick(); picker.current?.click(); }}>
          {t("Choose a photo from this device")}
        </button>
      </section>
    </div>
  );
}

type CameraProps = { onQR: (value: string) => void; onBarcode?: (value: string) => void; onPhoto: (file: File) => void; onClose: () => void };

/** Practice mode: no real camera, one drawn sample part to "photograph". */
function PracticeCamera({ onPhoto, onClose }: CameraProps) {
  useLang();
  const [url, setUrl] = useState("");
  useEffect(() => {
    let made = "";
    void samplePhoto().then((f) => { made = URL.createObjectURL(f); setUrl(made); });
    return () => { if (made) URL.revokeObjectURL(made); };
  }, []);
  return (
    <div className="stock-modal-shade">
      <section className="scanner-dialog" role="dialog" aria-modal="true" aria-labelledby="camera-title">
        <div className="section-heading">
          <div>
            <p className="eyebrow">{t("CAMERA")}</p>
            <h2 id="camera-title">{t("Practice camera")}</h2>
          </div>
          <button className="icon-button" aria-label={t("Close")} onClick={onClose}><X /></button>
        </div>
        <div className="live-video practice-photo">{url && <img src={url} alt="" />}</div>
        <p className="camera-capability" role="status">{t("In real use this is your phone camera. Here we use a sample oil bottle.")}</p>
        <button data-tour="sample-photo" className="button primary full camera-shutter" disabled={!url} onClick={() => void samplePhoto().then(onPhoto)}>
          <CameraIcon size={22} /> {t("Use sample photo")}
        </button>
      </section>
    </div>
  );
}

export function Camera(props: CameraProps) {
  return isPractice() ? <PracticeCamera {...props} /> : <LiveCamera {...props} />;
}
