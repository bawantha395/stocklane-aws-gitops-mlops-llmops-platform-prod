import { useRef, useState } from "react";
import { Camera, Car, X } from "lucide-react";
import { api } from "../api";
import { t } from "../i18n";
import { usePhoto, uploadPhoto } from "../photo";
import { isPractice, demoShot } from "../practice";

export function Photo({ id, size = "thumb", className = "", onClick }: { id: string; size?: "thumb" | "full"; className?: string; onClick?: () => void }) {
  const { url, failed } = usePhoto(id, size);
  if (failed) return <span className={"ws-photo-missing " + className}><Car size={18} /></span>;
  if (!url) return <span className={"ws-photo-wait " + className} aria-busy="true" />;
  return <img className={className} src={url} alt="" onClick={onClick} draggable={false} />;
}

/** A small round-cornered face for lists: the vehicle's front photo, or a plain car when there is none. */
export function Face({ id }: { id?: string }) {
  return id ? <Photo id={id} className="ws-face" /> : <span className="ws-face none"><Car size={20} /></span>;
}

function Lightbox({ id, onClose }: { id: string; onClose: () => void }) {
  return (
    <div className="ws-lightbox" role="dialog" aria-modal="true" onClick={onClose}>
      <button className="icon-button" aria-label={t("Close")} onClick={onClose}><X size={20} /></button>
      <Photo id={id} size="full" />
    </div>
  );
}

/** Takes one photo: the phone camera (or a file on a computer). In practice mode it uses a drawn sample instead. */
function Take({ kind, label, onId, disabled, className = "button secondary small" }: { kind: "plate" | "front" | "damage"; label: string; onId: (id: string) => void; disabled?: boolean; className?: string }) {
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false), [error, setError] = useState("");
  const send = async (file: Blob | undefined) => {
    if (!file) return;
    setBusy(true); setError("");
    try { onId(await uploadPhoto(file)); } catch (e) { setError((e as Error).message); } finally { setBusy(false); if (input.current) input.current.value = ""; }
  };
  return (
    <>
      <button type="button" className={className} disabled={disabled || busy} onClick={() => (isPractice() ? void demoShot(kind).then(send) : input.current?.click())}>
        <Camera size={16} /> {busy ? t("Uploading…") : label}
      </button>
      <input ref={input} type="file" accept="image/*" capture="environment" hidden onChange={(e) => void send(e.target.files?.[0])} />
      {error && <small role="alert" className="stock-error">{error}</small>}
    </>
  );
}

/** One photo with a fixed meaning (plate or front): shows the picture with a retake and remove, or a button. */
export function PhotoSlot({ kind, label, id, onId, disabled, saved }: { kind: "plate" | "front"; label: string; id: string; onId: (id: string) => void; disabled?: boolean; saved?: boolean }) {
  const [open, setOpen] = useState(false);
  return (
    <div className={"ws-photo-slot" + (id ? " has" : "")}>
      <span className="ws-photo-label">{label}{saved && id ? " · " + t("saved") : ""}</span>
      {id ? (
        <>
          <button type="button" className="ws-photo-pic" onClick={() => setOpen(true)} aria-label={label}><Photo id={id} /></button>
          {!disabled && <button type="button" className="ws-photo-x" aria-label={t("Remove")} onClick={() => onId("")}><X size={14} /></button>}
        </>
      ) : <Take kind={kind} label={t("Take photo")} onId={onId} disabled={disabled} />}
      {open && <Lightbox id={id} onClose={() => setOpen(false)} />}
    </div>
  );
}

/** Several photos (condition before fixing): thumbnails to open and remove, plus an Add button. */
export function PhotoStrip({ ids, onAdd, onRemove, max = 6, disabled }: { ids: string[]; onAdd: (id: string) => void; onRemove: (id: string) => void; max?: number; disabled?: boolean }) {
  const [open, setOpen] = useState("");
  return (
    <div className="ws-photo-strip">
      {ids.map((id) => (
        <span className="ws-thumb" key={id}>
          <button type="button" aria-label={t("Open photo")} onClick={() => setOpen(id)}><Photo id={id} /></button>
          {!disabled && <button type="button" className="ws-photo-x" aria-label={t("Remove")} onClick={() => onRemove(id)}><X size={14} /></button>}
        </span>
      ))}
      {!disabled && ids.length < max && <Take kind="damage" label={ids.length ? t("Add") : t("Add condition photo")} onId={onAdd} />}
      {open && <Lightbox id={open} onClose={() => setOpen("")} />}
    </div>
  );
}

/** The Photos card on a job page. Saved at once, apart from the bill, so it never clashes with someone editing the lines. */
export function JobPhotos({ id, start, locked }: { id: string; start: { before_photos?: string[]; front_photo?: string; plate_photo?: string }; locked: boolean }) {
  const [before, setBefore] = useState(start.before_photos || []), [front, setFront] = useState(start.front_photo || ""), [plate, setPlate] = useState(start.plate_photo || "");
  const [error, setError] = useState("");
  const send = async (body: Record<string, unknown>) => {
    setError("");
    try {
      const r = await api<{ before_photos: string[] }>("/api/workshop/jobs/" + id + "/photos", { method: "POST", body: JSON.stringify(body) }, newKey());
      setBefore(r.before_photos);
    } catch (e) { setError((e as Error).message); }
  };
  if (locked && !before.length && !front && !plate) return null;
  return (
    <section className="ws-card ws-photos">
      <h3>Photos <small>(optional)</small></h3>
      <div className="ws-photo-grid">
        <PhotoSlot kind="plate" label="Number plate" id={plate} disabled={locked} onId={(p) => { setPlate(p); void send({ plate_photo: p }); }} />
        <PhotoSlot kind="front" label="Front of the vehicle" id={front} disabled={locked} onId={(p) => { setFront(p); void send({ front_photo: p }); }} />
      </div>
      <span className="ws-photo-label">Condition when it arrived (before fixing)</span>
      <PhotoStrip ids={before} disabled={locked} onAdd={(p) => void send({ add: [p] })} onRemove={(p) => void send({ remove: [p] })} />
      {error && <p role="alert" className="stock-error">{error}</p>}
    </section>
  );
}
const newKey = () => (typeof crypto.randomUUID === "function" ? crypto.randomUUID() : Date.now().toString(36) + Math.random().toString(36).slice(2) + Math.random().toString(36).slice(2));
