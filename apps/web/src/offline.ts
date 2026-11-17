import { useSyncExternalStore } from "react";
import { api, ApiError } from "./api";
import { isPractice } from "./practice";

/** Two actions may be written down on this phone when there is no internet: starting a job and taking a part out. They are sent, in order, when the
 *  connection is back. Each keeps the Idempotency-Key it was first sent with, so a request that did reach the server is never done twice. */
export type Queued = { key: string; kind: "job" | "takeout"; label: string; path: string; body: string; at: number; error?: string };
const STORE = "lifta.offline.queue";
const read = (): Queued[] => { try { const v = JSON.parse(localStorage.getItem(STORE) || "[]"); return Array.isArray(v) ? v : []; } catch { return []; } };
let list: Queued[] = read();
const subs = new Set<() => void>();
const write = (next: Queued[]) => { list = next; try { localStorage.setItem(STORE, JSON.stringify(next)); } catch { /* storage full or private mode: keep it in memory */ } subs.forEach((f) => f()); };

export const isOfflineError = (e: unknown) => e instanceof ApiError && e.status === 0;
export const enqueue = (q: Omit<Queued, "at" | "error">) => { if (!list.some((x) => x.key === q.key)) write([...list, { ...q, at: Date.now() }]); };
export const discard = (key: string) => write(list.filter((x) => x.key !== key));
export const useQueue = () => useSyncExternalStore((f) => { subs.add(f); return () => { subs.delete(f); }; }, () => list);

let flushing = false;
/** Send what is waiting, oldest first. No connection: stop and try later. A refusal from the server (not enough stock, a rule) stays in the list with its reason. */
export async function flush(): Promise<{ sent: number; left: number }> {
  if (flushing || isPractice()) return { sent: 0, left: list.length };
  flushing = true; let sent = 0;
  try {
    for (const q of [...list]) {
      if (q.error) continue;
      try {
        await api(q.path, { method: "POST", body: q.body }, q.key);
        write(list.filter((x) => x.key !== q.key)); sent++;
      } catch (e) {
        if (isOfflineError(e)) break;
        write(list.map((x) => (x.key === q.key ? { ...x, error: (e as Error).message } : x)));
      }
    }
  } finally { flushing = false; }
  if (sent) window.dispatchEvent(new Event("lifta:stock-changed"));
  return { sent, left: list.length };
}
export const retryAll = () => { write(list.map((x) => ({ ...x, error: undefined }))); return flush(); };
if (typeof window !== "undefined") {
  window.addEventListener("online", () => void flush());
  setInterval(() => { if (list.length && navigator.onLine) void flush(); }, 30000);
}
