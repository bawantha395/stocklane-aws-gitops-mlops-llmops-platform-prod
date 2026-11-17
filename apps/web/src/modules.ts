import { useSyncExternalStore } from "react";

/** Which parts of the app this shop uses: the store room map and the parts counter. The owner switches them in Settings; both start on. */
type Modules = { storeRoom: boolean; counter: boolean; roomPhone: boolean; counterWeb: boolean };
const read = (v: Record<string, unknown> | null): Modules => ({ storeRoom: v?.storeRoom !== false, counter: v?.counter !== false, roomPhone: v?.roomPhone === true, counterWeb: v?.counterWeb === true });
let now: Modules = (() => { try { return read(JSON.parse(localStorage.getItem("lifta.modules") || "null")); } catch { return read(null); } })();
const subs = new Set<() => void>();
export function setModules(next: Partial<{ store_room_on: unknown; counter_on: unknown; store_room_phone: unknown; counter_web: unknown }>) {
  const m = read({ storeRoom: next.store_room_on, counter: next.counter_on, roomPhone: next.store_room_phone, counterWeb: next.counter_web });
  if (m.storeRoom === now.storeRoom && m.counter === now.counter && m.roomPhone === now.roomPhone && m.counterWeb === now.counterWeb) return;
  now = m; try { localStorage.setItem("lifta.modules", JSON.stringify(m)); } catch { /* ignore */ }
  subs.forEach((f) => f());
}
export const useModules = () => useSyncExternalStore((f) => { subs.add(f); return () => { subs.delete(f); }; }, () => now);
