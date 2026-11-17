// A short beep and a buzz when a code is read, so you know without looking at the screen. Both quietly do nothing where the phone does not allow them.
let ctx: AudioContext | null = null;
export function scanFeedback() {
  try { navigator.vibrate?.(40); } catch { /* not supported */ }
  try {
    if (localStorage.getItem("lifta.sound") === "off") return;
    const AC = window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AC) return;
    ctx = ctx || new AC();
    const o = ctx.createOscillator(), g = ctx.createGain();
    o.frequency.value = 1100; g.gain.value = 0.08;
    o.connect(g); g.connect(ctx.destination);
    o.start(); o.stop(ctx.currentTime + 0.09);
  } catch { /* ignore */ }
}
