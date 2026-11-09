/** macOS Dock style magnification for the bottom tab bar (phones). Icons grow towards the finger or pointer. */
export function dock(nav: HTMLElement) {
  const phone = window.matchMedia("(max-width: 760px)"), calm = window.matchMedia("(prefers-reduced-motion: reduce)");
  const buttons = () => Array.from(nav.querySelectorAll<HTMLElement>(":scope > button"));
  const reset = () => buttons().forEach((b) => b.style.removeProperty("--dock"));
  const move = (e: PointerEvent) => {
    if (!phone.matches || calm.matches) return;
    buttons().forEach((b) => {
      const r = b.getBoundingClientRect(), d = Math.abs(e.clientX - (r.left + r.width / 2));
      b.style.setProperty("--dock", (1 + 0.5 * Math.pow(Math.max(0, 1 - d / 96), 2)).toFixed(3));
    });
  };
  const events: [string, (e: PointerEvent) => void][] = [["pointermove", move], ["pointerdown", move], ["pointerleave", reset], ["pointerup", reset], ["pointercancel", reset]];
  events.forEach(([n, f]) => nav.addEventListener(n, f as EventListener));
  return () => { events.forEach(([n, f]) => nav.removeEventListener(n, f as EventListener)); reset(); };
}
