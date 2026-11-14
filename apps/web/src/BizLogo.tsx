import { useEffect, useState } from "react";
import { getLogo, onLogoChange, peekLogo, type ShopLogo } from "./logoStore";

/** The uploaded logo (undefined while loading, null when there is none), kept current when Settings changes it. */
export function useLogo() {
  const [logo, setLogo] = useState<ShopLogo | null | undefined>(peekLogo());
  useEffect(() => {
    let live = true;
    const pull = () => { void getLogo().then((l) => { if (live) setLogo(l); }); };
    pull();
    const off = onLogoChange(() => { setLogo(undefined); pull(); });
    return () => { live = false; off(); };
  }, []);
  return logo;
}

/** The business's own mark: the logo the owner uploaded in Settings, else /shop-logo.png when the deployment has one, else the initials on a tile. */
export function BizLogo({ name, size = 46 }: { name: string; size?: number }) {
  const [failed, setFailed] = useState(false);
  const [logo, setLogo] = useState<ShopLogo | null | undefined>(peekLogo());
  useEffect(() => {
    let live = true;
    const pull = () => { void getLogo().then((l) => { if (live) setLogo(l); }); };
    pull();
    const off = onLogoChange(() => { setLogo(undefined); setFailed(false); pull(); });
    return () => { live = false; off(); };
  }, []);
  if (logo) return <img className="bl bl-img" style={{ height: size }} src={"data:image/jpeg;base64," + logo.data} alt={name} />;
  if (logo === null && !failed) return <img className="bl bl-img" style={{ height: size }} src="/shop-logo.png" alt={name} onError={() => setFailed(true)} />;
  if (logo === undefined) return <span className="bl" style={{ width: size, height: size }} />;
  const hue = Array.from(name).reduce((h, c) => (h * 31 + c.charCodeAt(0)) % 360, 7);
  const color = `hsl(${hue} 55% 38%)`;
  const initials = name.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]).join("").toUpperCase() || "•";
  return (
    <span className="bl bl-mono" style={{ width: size, height: size, fontSize: size * 0.4, background: `linear-gradient(145deg, ${color}, color-mix(in srgb, ${color} 55%, #000))` }} role="img" aria-label={name}>{initials}</span>
  );
}
