/** The Lifta mark, flat and vector: an L with an upward chevron. Ink follows the text colour, the chevron takes the brand accent, so it is crisp at any size and in dark mode. */
export function Logo({ size = 30 }: { size?: number }) {
  return (
    <svg className="lifta-mark" width={size} height={size} viewBox="-10 -10 82 100" role="img" aria-label="Lifta" fill="none" strokeLinecap="round" strokeLinejoin="round">
      <path d="M0 0V74H54" stroke="currentColor" strokeWidth="16" />
      <path className="lifta-chev" d="M24 41L38 27L52 41" stroke="currentColor" strokeWidth="10" />
    </svg>
  );
}

/** The mark on the dark charcoal tile: for the sign-in card and other hero places, using the brand artwork as supplied. */
export function LogoTile({ size = 56 }: { size?: number }) {
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
