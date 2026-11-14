import { api } from "./api";

export type ShopLogo = { data: string; w: number; h: number; c: number; v: string };
let cached: ShopLogo | null | undefined;
let loading: Promise<ShopLogo | null> | null = null;
const listeners = new Set<() => void>();

/** The owner's uploaded logo (a small JPEG), loaded once and shared by the header, the bill and the PDF. null = none or unreadable: callers fall back to the monogram. */
export function getLogo(): Promise<ShopLogo | null> {
  if (cached !== undefined) return Promise.resolve(cached);
  loading ??= api<ShopLogo>("/api/workshop/logo").then((l) => (l && l.data ? l : null)).catch(() => null).then((l) => { cached = l; loading = null; return l; });
  return loading;
}
export const peekLogo = () => cached;
export function resetLogo() { cached = undefined; loading = null; listeners.forEach((f) => f()); }
export function onLogoChange(f: () => void) { listeners.add(f); return () => { listeners.delete(f); }; }

/** Shrink any picture to a small JPEG (max 400 px, white behind transparency) the server and the PDF can use; returns base64 without the data: prefix. */
export async function logoFromFile(file: File): Promise<string> {
  if (!/^image\//.test(file.type)) throw new Error("Choose a picture (JPG or PNG)");
  let bitmap: ImageBitmap;
  try { bitmap = await createImageBitmap(file, { imageOrientation: "from-image" }); } catch { throw new Error("That picture could not be read. Try a JPG or PNG."); }
  const scale = Math.min(1, 400 / Math.max(bitmap.width, bitmap.height));
  const w = Math.max(32, Math.round(bitmap.width * scale)), h = Math.max(32, Math.round(bitmap.height * scale));
  const canvas = document.createElement("canvas"); canvas.width = w; canvas.height = h;
  const ctx = canvas.getContext("2d"); if (!ctx) throw new Error("This browser cannot prepare the picture");
  ctx.fillStyle = "#fff"; ctx.fillRect(0, 0, w, h); ctx.drawImage(bitmap, 0, 0, w, h); bitmap.close();
  const blob = await new Promise<Blob | null>((done) => canvas.toBlob(done, "image/jpeg", 0.88));
  if (!blob) throw new Error("This browser cannot prepare the picture");
  const url = await new Promise<string>((ok, no) => { const r = new FileReader(); r.onload = () => ok(String(r.result)); r.onerror = () => no(new Error("Could not read the picture")); r.readAsDataURL(blob); });
  return url.slice(url.indexOf(",") + 1);
}
