import { useSyncExternalStore } from "react";

/** The workshop's business name, shared by the sidebar, header and Workshop pages. Cached so it shows at once on the next visit. */
const KEY = "lifta.business";
let name = (() => { try { return localStorage.getItem(KEY) || "Workshop Suite"; } catch { return "Workshop Suite"; } })();
const subscribers = new Set<() => void>();

export function setBusinessName(next: string) {
  const clean = next.trim();
  if (!clean || clean === name) return;
  name = clean;
  try { localStorage.setItem(KEY, clean); } catch { /* private mode */ }
  subscribers.forEach((notify) => notify());
}

export function getBusinessName(): string { return name; }

export function useBusinessName(): string {
  return useSyncExternalStore(
    (notify) => { subscribers.add(notify); return () => { subscribers.delete(notify); }; },
    () => name,
  );
}

/** The shop's default reorder level for a new part (a Settings value), kept here so the part form can start from it. */
let reorder = 5;
export const setDefaultReorder = (n: unknown) => { const v = Number(n); if (Number.isFinite(v) && v >= 0) reorder = v; };
export const getDefaultReorder = () => reorder;

/** The shop's default markup on cost (a Settings value, owner and people who see cost only). The part form and the bulk price tool start from it,
 *  so a price worked out anywhere uses the same percentage as Price review. 0 means the shop has not set one. */
let markup = 0;
export const setDefaultMarkup = (n: unknown) => { const v = Number(n); markup = Number.isFinite(v) && v > 0 ? v : 0; };
export const getDefaultMarkup = () => markup;

/** Cost plus markup %, rounded UP to the next `step` rupees (5 by default). The same rule as the server's suggested price in Price review. */
export const priceFromCost = (cost: number, markupPct: number, step = 5) => {
  const raw = Math.round(cost * (1 + markupPct / 100) * 10000) / 10000;  // 4 decimals first, so 1300.0000000000002 is not pushed up to 1305
  return Math.ceil(raw / step - 1e-9) * step;
};
