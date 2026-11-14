import { useId } from "react";

/** The Lifta mark: a glass L with an upward chevron, on a dark blue to dark green tile. */
export function Logo({ size = 36 }: { size?: number }) {
  // Unique ids: the mark is on the page twice (sidebar and phone header), and a hidden copy must not own the gradients.
  const u = useId().replace(/:/g, "");
  const id = (n: string) => n + u;
  return (
    <svg className="lifta-logo" width={size} height={size} viewBox="0 0 64 64" role="img" aria-label="Lifta">
      <defs>
        <linearGradient id={id("lg-t")} x1="0" y1="0" x2="1" y2="1"><stop offset="0" stopColor="#1b4fa8" /><stop offset="1" stopColor="#0b3d30" /></linearGradient>
        <linearGradient id={id("lg-rim")} x1="0" y1="0" x2="1" y2="1"><stop offset="0" stopColor="#fff" stopOpacity=".95" /><stop offset=".5" stopColor="#cfe6ff" stopOpacity=".55" /><stop offset="1" stopColor="#9ff0cf" stopOpacity=".8" /></linearGradient>
        <linearGradient id={id("lg-body")} x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#fff" stopOpacity=".42" /><stop offset=".6" stopColor="#cfe6ff" stopOpacity=".14" /><stop offset="1" stopColor="#9ff0cf" stopOpacity=".28" /></linearGradient>
        <linearGradient id={id("lg-spec")} x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#fff" stopOpacity=".95" /><stop offset="1" stopColor="#fff" stopOpacity="0" /></linearGradient>
        <linearGradient id={id("lg-gl")} x1="0" y1="0" x2="1" y2="1"><stop offset="0" stopColor="#fff" stopOpacity=".22" /><stop offset=".5" stopColor="#fff" stopOpacity="0" /></linearGradient>
        <filter id={id("lg-blur")}><feGaussianBlur stdDeviation="1.2" /></filter>
      </defs>
      <rect width="64" height="64" rx="16" fill={"url(#" + id("lg-t") + ")"} />
      <path d="M0 0h64v30C40 22 18 26 0 20z" fill={"url(#" + id("lg-gl") + ")"} />
      <path d="M22 15v30a4 4 0 0 0 4 4h20" fill="none" stroke="#000" strokeOpacity=".25" strokeWidth="9" strokeLinecap="round" strokeLinejoin="round" transform="translate(0 1.6)" filter={"url(#" + id("lg-blur") + ")"} />
      <path d="M22 14v30a4 4 0 0 0 4 4h20" fill="none" stroke={"url(#" + id("lg-rim") + ")"} strokeWidth="9.5" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M22 14v30a4 4 0 0 0 4 4h20" fill="none" stroke={"url(#" + id("lg-body") + ")"} strokeWidth="6.8" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M19.6 18v24" fill="none" stroke={"url(#" + id("lg-spec") + ")"} strokeWidth="1.7" strokeLinecap="round" />
      <path d="M27 46.2h17" fill="none" stroke="#fff" strokeOpacity=".5" strokeWidth="1.2" strokeLinecap="round" />
      <path d="M34 28l7-7 7 7" fill="none" stroke="#7be0b4" strokeWidth="5.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
