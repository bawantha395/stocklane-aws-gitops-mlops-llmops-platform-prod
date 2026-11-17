/** How the parts counter opens on this device: the camera straight away, or the search box first. Phones default to camera, computers to search. */
export type CounterStart = "camera" | "search";
const KEY = "lifta.counter.start";
export const isPhone = () => typeof window !== "undefined" && window.matchMedia("(max-width: 760px)").matches;
export const getCounterStart = (): CounterStart => { try { const v = localStorage.getItem(KEY); if (v === "camera" || v === "search") return v; } catch { /* ignore */ } return isPhone() ? "camera" : "search"; };
export const setCounterStart = (v: CounterStart | "auto") => { try { if (v === "auto") localStorage.removeItem(KEY); else localStorage.setItem(KEY, v); } catch { /* ignore */ } };
export const counterStartIsAuto = () => { try { return !localStorage.getItem(KEY); } catch { return true; } };
