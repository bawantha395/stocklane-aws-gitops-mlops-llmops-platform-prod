import { useSyncExternalStore } from "react";

/** Which parts of the app this shop uses: the store room map and the parts counter. The owner switches them in Settings; both start on. */
type Modules = { storeRoom: boolean; counter: boolean };
let now: Modules = (() => { try { const v = JSON.parse(localStorage.getItem("lifta.modules") || "null"); if (v) return { storeRoom: v.storeRoom !== false, counter: v.counter !== false }; } catch { /* ignore */ } return { storeRoom: true, counter: true }; })();
const subs = new Set<() => void>();
export function setModules(next: Partial<{ store_room_on: unknown; counter_on: unknown }>) {
  const m = { storeRoom: next.store_room_on !== false, counter: next.counter_on !== false };
  if (m.storeRoom === now.storeRoom && m.counter === now.counter) return;
  now = m; try { localStorage.setItem("lifta.modules", JSON.stringify(m)); } catch { /* ignore */ }
  subs.forEach((f) => f());
}
export const useModules = () => useSyncExternalStore((f) => { subs.add(f); return () => { subs.delete(f); }; }, () => now);
