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
