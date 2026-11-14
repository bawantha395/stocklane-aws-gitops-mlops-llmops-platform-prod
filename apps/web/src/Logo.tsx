/** The Lifta mark: the brand artwork itself (backlit white L with an upward chevron on charcoal), used as supplied. */
export function Logo({ size = 36 }: { size?: number }) {
  return (
    <img
      className="lifta-logo"
      src="/lifta-mark.png"
      width={size}
      height={size}
      alt="Lifta"
      draggable={false}
      style={{ width: size, height: size, borderRadius: Math.round(size * 0.23), display: "block", flex: "none", objectFit: "cover" }}
    />
  );
}
