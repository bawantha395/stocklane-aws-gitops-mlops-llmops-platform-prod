import { useMemo, useRef, useState } from "react";
import { Plus } from "lucide-react";
import { t } from "./i18n";

/**
 * A text box with the shop's own list under it (shelves, categories). Typing narrows the list; tapping a row fills the box.
 * Something that is not on the list can be added when `onAdd` is given (the owner); everyone else is told to ask the owner.
 */
export function ListPick({ value, options, onChange, onAdd, placeholder, required, maxLength, label }: {
  value: string; options: string[]; onChange: (v: string) => void; onAdd?: (v: string) => Promise<string>;
  placeholder?: string; required?: boolean; maxLength?: number; label: string;
}) {
  const [open, setOpen] = useState(false), [busy, setBusy] = useState(false), [error, setError] = useState("");
  const box = useRef<HTMLDivElement>(null);
  const q = value.trim().toLowerCase();
  const shown = useMemo(() => options.filter((o) => !q || o.toLowerCase().includes(q)).slice(0, 60), [options, q]);
  const exact = options.some((o) => o.toLowerCase() === q);
  const pick = (v: string) => { onChange(v); setOpen(false); setError(""); };
  const add = async () => {
    if (!onAdd || busy) return;
    setBusy(true); setError("");
    try { pick(await onAdd(value.trim())); } catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  };
  return (
    <div className="listpick" ref={box} onBlur={(e) => { if (!box.current?.contains(e.relatedTarget as Node)) setOpen(false); }}>
      <input aria-label={label} required={required} maxLength={maxLength} autoComplete="off" placeholder={placeholder} value={value}
        aria-invalid={!!value.trim() && !exact} onFocus={() => setOpen(true)} onChange={(e) => { onChange(e.target.value); setOpen(true); setError(""); }} />
      {open && (
        <div className="listpick-menu" role="listbox">
          {shown.map((o) => <button type="button" role="option" aria-selected={o.toLowerCase() === q} key={o} className={"listpick-row" + (o.toLowerCase() === q ? " on" : "")} onMouseDown={(e) => e.preventDefault()} onClick={() => pick(o)}>{o}</button>)}
          {!shown.length && !value.trim() && <p className="listpick-note">{t("The list is empty.")}</p>}
          {!!value.trim() && !exact && onAdd && <button type="button" className="listpick-row add" disabled={busy} onMouseDown={(e) => e.preventDefault()} onClick={() => void add()}><Plus size={15} /> {t("Add")} “{value.trim()}”</button>}
          {!!value.trim() && !exact && !onAdd && <p className="listpick-note">{t("Not on the list. Pick one above, or ask the owner to add it in Settings.")}</p>}
        </div>
      )}
      {error && <small role="alert" className="listpick-err">{error}</small>}
    </div>
  );
}
