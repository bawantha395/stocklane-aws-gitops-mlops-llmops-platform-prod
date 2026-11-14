import { useState } from "react";
import { t } from "../i18n";
import { csv } from "../api";
import { addDays, dateOnly, today } from "./common";

export type Range = { k: "all" | "month" | "last" | "custom"; from: string; to: string };
export const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
export const ALL: Range = { k: "all", from: "", to: "" };

/** Like useState, but the value is remembered on this device (so a filter is still there next time). */
export function useSaved<T>(key: string, init: T): [T, (v: T) => void] {
  const [v, setV] = useState<T>(() => { try { const s = localStorage.getItem("ws.f." + key); if (s != null) return JSON.parse(s) as T; } catch { /* ignore */ } return init; });
  return [v, (n: T) => { setV(n); try { localStorage.setItem("ws.f." + key, JSON.stringify(n)); } catch { /* ignore */ } }];
}

/** First and last day (inclusive, Colombo dates) of the chosen range; empty string means open-ended. */
export function bounds(r: Range, now = today()): { from: string; to: string } {
  if (r.k === "month") return { from: now.slice(0, 8) + "01", to: now };
  if (r.k === "last") { const first = now.slice(0, 8) + "01", to = addDays(first, -1); return { from: to.slice(0, 8) + "01", to }; }
  if (r.k === "custom") return { from: r.from, to: r.to };
  return { from: "", to: "" };
}
export const inRange = (iso: string | undefined, r: Range) => {
  if (r.k === "all") return true;
  if (!iso) return false;
  const { from, to } = bounds(r), d = dateOnly(iso);
  return (!from || d >= from) && (!to || d <= to);
};

/** All dates · This month · Last month · Custom (two date boxes). */
export function DateChips({ value, onChange }: { value: Range; onChange: (r: Range) => void }) {
  const [open, setOpen] = useState(value.k === "custom");
  const pick = (k: Range["k"]) => { setOpen(k === "custom"); onChange({ k, from: k === "custom" ? value.from : "", to: k === "custom" ? value.to : "" }); };
  return (
    <div className="ws-dates" role="group" aria-label={t("Date range")}>
      <div className="ws-dates-row">
      {([["all", t("All dates")], ["month", t("This month")], ["last", t("Last month")], ["custom", t("Custom")]] as [Range["k"], string][]).map(([k, label]) => (
        <button type="button" key={k} className={"ws-chip" + (value.k === k ? " chosen" : "")} aria-pressed={value.k === k} onClick={() => pick(k)}>{label}</button>
      ))}
      </div>
      {open && value.k === "custom" && (
        <span className="ws-dates-custom">
          <label>{t("From")}<input type="date" value={value.from} max={value.to || undefined} onChange={(e) => onChange({ ...value, from: e.target.value })} /></label>
          <label>{t("To")}<input type="date" value={value.to} min={value.from || undefined} onChange={(e) => onChange({ ...value, to: e.target.value })} /></label>
        </span>
      )}
    </div>
  );
}

/** "12 bills · LKR 84,000" on the left, Export CSV on the right. */
export function SummaryBar({ text, rows, file }: { text: string; rows: Record<string, unknown>[]; file: string }) {
  return (
    <div className="ws-summary">
      <span>{text}</span>
      {rows.length > 0 && <button type="button" className="button secondary small" onClick={() => csv(file + "-" + today() + ".csv", rows)}>{t("Export CSV")}</button>}
    </div>
  );
}
