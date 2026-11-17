/** macOS Dock style magnification: the phone tab bar grows icons towards the finger; the laptop side menu grows the row under the pointer a little. */
export function dock(nav: HTMLElement) {
  const phone = window.matchMedia("(max-width: 760px)"), calm = window.matchMedia("(prefers-reduced-motion: reduce)");
  const buttons = () => Array.from(nav.querySelectorAll<HTMLElement>(":scope > button"));
  const reset = () => buttons().forEach((b) => b.style.removeProperty("--dock"));
  const move = (e: PointerEvent) => {
    if (calm.matches) return;
    const tall = !phone.matches;
    buttons().forEach((b) => {
      const r = b.getBoundingClientRect(), d = tall ? Math.abs(e.clientY - (r.top + r.height / 2)) : Math.abs(e.clientX - (r.left + r.width / 2));
      b.style.setProperty("--dock", (1 + (tall ? 0.07 : 0.5) * Math.pow(Math.max(0, 1 - d / (tall ? 90 : 96)), 2)).toFixed(3));
    });
  };
  const events: [string, (e: PointerEvent) => void][] = [["pointermove", move], ["pointerdown", move], ["pointerleave", reset], ["pointerup", reset], ["pointercancel", reset]];
  events.forEach(([n, f]) => nav.addEventListener(n, f as EventListener));
  return () => { events.forEach(([n, f]) => nav.removeEventListener(n, f as EventListener)); reset(); };
}
