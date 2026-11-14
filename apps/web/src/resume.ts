/** Android can unload the browser tab while the phone's camera app is open. These helpers put the person back on the same screen and say why a photo did not arrive. */
const NAV = "lifta.nav", PICK = "lifta.nativepick";
export function saveNav(view: string, mode: string) {
  try { sessionStorage.setItem(NAV, JSON.stringify({ view, mode })); } catch { /* private mode */ }
}
export function loadNav(): { view?: string; mode?: string } {
  try { return JSON.parse(sessionStorage.getItem(NAV) || "{}") || {}; } catch { return {}; }
}
export function markNativePick() {
  try { sessionStorage.setItem(PICK, String(Date.now())); } catch { /* private mode */ }
}
export function clearNativePick() {
  try { sessionStorage.removeItem(PICK); } catch { /* private mode */ }
}
/** True once if the page was reloaded while the phone camera app was open. */
export function lostNativePick(): boolean {
  try { const t = sessionStorage.getItem(PICK); sessionStorage.removeItem(PICK); return !!t && Date.now() - Number(t) < 10 * 60_000; } catch { return false; }
}
