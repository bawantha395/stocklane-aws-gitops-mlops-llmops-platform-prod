import { useEffect, useState } from "react";
import { api } from "./api";

/** Vehicle photos: shrink on the phone (about 1280 px plus a small thumbnail), upload through the API, read back through the API. */
const base64 = (blob: Blob) => new Promise<string>((done, fail) => {
  const r = new FileReader();
  r.onload = () => done(String(r.result).split(",")[1] || "");
  r.onerror = () => fail(new Error("Could not read the photo"));
  r.readAsDataURL(blob);
});

async function draw(bmp: ImageBitmap, max: number, quality: number): Promise<Blob> {
  const scale = Math.min(1, max / Math.max(bmp.width, bmp.height));
  const c = document.createElement("canvas");
  c.width = Math.max(1, Math.round(bmp.width * scale)); c.height = Math.max(1, Math.round(bmp.height * scale));
  c.getContext("2d")!.drawImage(bmp, 0, 0, c.width, c.height);
  const blob = await new Promise<Blob | null>((done) => c.toBlob(done, "image/jpeg", quality));
  if (!blob) throw new Error("This photo could not be used. Try another one.");
  return blob;
}

export async function shrinkPhoto(file: Blob): Promise<{ image: string; thumb: string }> {
  let bmp: ImageBitmap;
  try { bmp = await createImageBitmap(file); } catch { throw new Error("This photo could not be opened. Try another one."); }
  try {
    let q = 0.72, full = await draw(bmp, 1280, q);
    while (full.size > 800_000 && q > 0.4) { q -= 0.12; full = await draw(bmp, 1280, q); }
    const thumb = await draw(bmp, 240, 0.7);
    return { image: await base64(full), thumb: await base64(thumb) };
  } finally { bmp.close(); }
}

export async function uploadPhoto(file: Blob): Promise<string> {
  const body = await shrinkPhoto(file);
  const { id } = await api<{ id: string }>("/api/workshop/photos", { method: "POST", body: JSON.stringify(body) });
  return id;
}

const cache = new Map<string, Promise<string>>();
export function photoSrc(id: string, size: "thumb" | "full"): Promise<string> {
  const key = id + ":" + size;
  let hit = cache.get(key);
  if (!hit) {
    hit = api<{ data: string }>("/api/workshop/photos/" + id + "?size=" + size).then(({ data }) => {
      const bytes = Uint8Array.from(atob(data), (c) => c.charCodeAt(0));
      return URL.createObjectURL(new Blob([bytes], { type: "image/jpeg" }));
    });
    hit.catch(() => cache.delete(key));
    cache.set(key, hit);
  }
  return hit;
}

export function usePhoto(id: string | undefined, size: "thumb" | "full" = "thumb") {
  const [url, setUrl] = useState(""), [failed, setFailed] = useState(false);
  useEffect(() => {
    let live = true;
    setUrl(""); setFailed(false);
    if (id) photoSrc(id, size).then((u) => { if (live) setUrl(u); }, () => { if (live) setFailed(true); });
    return () => { live = false; };
  }, [id, size]);
  return { url, failed };
}
