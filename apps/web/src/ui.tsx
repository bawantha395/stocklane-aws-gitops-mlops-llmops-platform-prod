import { useEffect, useState, type ButtonHTMLAttributes, type ReactNode } from "react";
import { t } from "./i18n";

/** Button: variants + built-in "Saving…" state + haptic-like press. */
export function Button({ variant = "default", busy, busyText, children, onClick, ...rest }: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: "default" | "primary" | "danger" | "ghost"; busy?: boolean; busyText?: string }) {
  return (
    <button {...rest} disabled={rest.disabled || busy} className={"ui-btn " + (variant === "default" ? "" : variant) + " " + (rest.className || "")}
      onClick={(e) => { try { navigator.vibrate?.(8); } catch { /* not supported */ } onClick?.(e); }}>
      {busy ? (busyText ?? t("Saving…")) : children}
    </button>
  );
}
export function Chip({ chosen, children, ...rest }: ButtonHTMLAttributes<HTMLButtonElement> & { chosen?: boolean }) {
  return <button {...rest} className={"ui-chip " + (chosen ? "chosen" : "") + " " + (rest.className || "")}>{children}</button>;
}
export function Field({ label, hint, error, children }: { label: string; hint?: string; error?: string; children: ReactNode }) {
  return <label className={"ui-field" + (error ? " bad" : "")}><span>{label}</span>{children}{(error || hint) && <small role={error ? "alert" : undefined}>{error || hint}</small>}</label>;
}
/** Bottom sheet on phones, centred card on desktop. Esc and tap outside close it. */
export function Sheet({ title, onClose, children }: { title?: string; onClose: () => void; children: ReactNode }) {
  useEffect(() => { const k = (e: KeyboardEvent) => e.key === "Escape" && onClose(); window.addEventListener("keydown", k); return () => window.removeEventListener("keydown", k); }, [onClose]);
  return <div className="ui-sheet-back" onClick={onClose}><div className="ui-sheet" role="dialog" aria-modal="true" aria-label={title} onClick={(e) => e.stopPropagation()}><i className="ui-sheet-grip" />{title && <h3>{title}</h3>}{children}</div></div>;
}

type ToastItem = { id: number; text: string; bad?: boolean; action?: { label: string; run: () => void } };
let items: ToastItem[] = []; const subs = new Set<() => void>(); let seq = 0;
export function toast(text: string, opts: { bad?: boolean; action?: { label: string; run: () => void }; ms?: number } = {}) {
  const id = ++seq; items = [...items, { id, text, bad: opts.bad, action: opts.action }]; subs.forEach((f) => f());
  setTimeout(() => { items = items.filter((x) => x.id !== id); subs.forEach((f) => f()); }, opts.ms ?? (opts.action ? 6000 : 3500));
}
export function ToastHost() {
  const [, tick] = useState(0);
  useEffect(() => { const f = () => tick((n) => n + 1); subs.add(f); return () => { subs.delete(f); }; }, []);
  return <div className="ui-toasts" aria-live="polite">{items.map((x) => <div key={x.id} className={"ui-toast" + (x.bad ? " bad" : "")} role="status"><span>{x.text}</span>{x.action && <button onClick={() => { x.action!.run(); items = items.filter((i) => i.id !== x.id); subs.forEach((f) => f()); }}>{x.action.label}</button>}</div>)}</div>;
}

/** Light / dark, remembered on this device. */
export const getTheme = () => { try { return localStorage.getItem("lifta.theme") === "dark" ? "dark" : "light"; } catch { return "light"; } };
export const applyTheme = (m: "light" | "dark") => { document.documentElement.dataset.theme = m; try { localStorage.setItem("lifta.theme", m); } catch { /* ignore */ } };
