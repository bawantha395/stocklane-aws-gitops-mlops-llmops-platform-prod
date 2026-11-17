import { useEffect, useRef, useState } from "react";
import { Delete } from "lucide-react";
import { t } from "./i18n";

const QTY = 'input[aria-label*="uantity" i], input.ws-qty, input.ws-l-qty';
const onPhone = () => window.matchMedia("(max-width: 760px)").matches && window.matchMedia("(pointer: coarse)").matches;

/** A big number pad for quantity boxes on a phone, so the long keyboard does not cover the screen. Laptops keep the normal keyboard. */
export function NumPadHost() {
  const [el, setEl] = useState<HTMLInputElement | null>(null), [buf, setBuf] = useState(""), fresh = useRef(true);
  useEffect(() => {
    const isQty = (n: EventTarget | null): n is HTMLInputElement => n instanceof HTMLInputElement && n.matches(QTY) && !n.disabled && !n.readOnly;
    const before = (e: Event) => { if (onPhone() && isQty(e.target)) e.target.setAttribute("inputmode", "none"); }; // stops the phone keyboard from opening
    const focus = (e: FocusEvent) => {
      if (isQty(e.target) && onPhone()) { e.target.setAttribute("inputmode", "none"); fresh.current = true; setBuf(e.target.value); setEl(e.target); setTimeout(() => (e.target as HTMLElement).scrollIntoView({ block: "center", behavior: "smooth" }), 60); }
      else if (!(e.target as HTMLElement)?.closest?.(".numpad")) setEl(null);
    };
    document.addEventListener("pointerdown", before, true); document.addEventListener("focusin", focus);
    return () => { document.removeEventListener("pointerdown", before, true); document.removeEventListener("focusin", focus); };
  }, []);
  if (!el || !el.isConnected) return null;
  const write = (v: string) => {
    setBuf(v);
    const clean = v.endsWith(".") ? v.slice(0, -1) : v; // a number box drops "5." until a digit follows
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(el, clean);
    el.dispatchEvent(new Event("input", { bubbles: true }));
  };
  const key = (k: string) => {
    let v = fresh.current && k !== "back" ? "" : buf; fresh.current = false;
    if (k === "back") v = v.slice(0, -1);
    else if (k === ".") { if (!v.includes(".")) v = (v || "0") + "."; }
    else if (v.replace(".", "").length < 9) v = (v === "0" ? "" : v) + k;
    write(v);
  };
  const label = (el.getAttribute("aria-label") || t("Quantity")).replace(/^Quantity$/, t("Quantity"));
  return (
    <div className="numpad" role="group" aria-label={t("Number pad")} onPointerDown={(e) => e.preventDefault()}>
      <div className="numpad-top"><span>{label}</span><b>{buf || "0"}</b><button type="button" className="numpad-done" onClick={() => setEl(null)}>{t("Done")}</button></div>
      <div className="numpad-grid">
        {["1", "2", "3", "4", "5", "6", "7", "8", "9", ".", "0"].map((k) => <button type="button" key={k} onClick={() => key(k)}>{k}</button>)}
        <button type="button" aria-label={t("Delete")} onClick={() => key("back")}><Delete size={24} /></button>
      </div>
    </div>
  );
}
