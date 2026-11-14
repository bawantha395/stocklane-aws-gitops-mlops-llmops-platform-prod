import { useId } from "react";

/** The Lifta mark: a blue-to-green tile with a brushed-silver L and a mint chevron lifting out of it. Pure vector. */
export function Logo({ size = 40 }: { size?: number }) {
  const u = useId().replace(/:/g, "");
  return (
    <svg className="lifta-logo" width={size} height={size} viewBox="0 0 64 64" role="img" aria-label="Lifta" style={{ flex: "none", display: "block" }}>
      <defs>
        <linearGradient id={"t" + u} x1="0" y1="0" x2="1" y2="1"><stop offset="0" stopColor="#1b4fa8" /><stop offset="1" stopColor="#0b3d30" /></linearGradient>
        <linearGradient id={"m" + u} x1="0" y1="0" x2="1" y2=".2">
          <stop offset="0" stopColor="#8d99a6" /><stop offset=".22" stopColor="#f6f9fc" /><stop offset=".45" stopColor="#b6c0ca" /><stop offset=".7" stopColor="#fff" /><stop offset="1" stopColor="#9aa6b3" />
        </linearGradient>
      </defs>
      <rect width="64" height="64" rx="16" fill={"url(#t" + u + ")"} />
      <path d="M22 13v31a4 4 0 0 0 4 4h20" fill="none" stroke={"url(#m" + u + ")"} strokeWidth="8" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M34 28l7-7 7 7" fill="none" stroke="#7be0b4" strokeWidth="5.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
