import { useState } from "react";

/** The business's own mark: /shop-logo.png when the deployment has one, otherwise the business's initials on a tile. */
export function BizLogo({ name, size = 46 }: { name: string; size?: number }) {
  const [failed, setFailed] = useState(false);
  if (!failed) return <img className="bl bl-img" style={{ height: size }} src="/shop-logo.png" alt={name} onError={() => setFailed(true)} />;
  const hue = Array.from(name).reduce((h, c) => (h * 31 + c.charCodeAt(0)) % 360, 7);
  const color = `hsl(${hue} 55% 38%)`;
  const initials = name.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]).join("").toUpperCase() || "•";
  return (
    <span className="bl bl-mono" style={{ width: size, height: size, fontSize: size * 0.4, background: `linear-gradient(145deg, ${color}, color-mix(in srgb, ${color} 55%, #000))` }} role="img" aria-label={name}>{initials}</span>
  );
}
