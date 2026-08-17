/**
 * The three source glyphs, lifted from the design.
 *
 * Not from lucide: it dropped brand icons at v1, and the mockup draws its own
 * anyway — a GitHub cat-tail circle, the Drive triangle, the Gmail envelope.
 * `currentColor` throughout, so a disconnected source just gets a grey parent.
 */
export function SourceGlyph({ id, size = 14 }: { id: string; size?: number }) {
  const common = {
    width: size,
    height: size,
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 1.8,
    "aria-hidden": true,
  } as const;

  if (id === "drive") {
    return (
      <svg {...common} strokeLinejoin="round">
        <path d="M12 3.5 20.5 19H3.5z" />
      </svg>
    );
  }
  if (id === "gmail") {
    return (
      <svg {...common} strokeLinejoin="round">
        <rect x="2.5" y="5" width="19" height="14" rx="2" />
        <polyline points="3 6.5 12 13 21 6.5" />
      </svg>
    );
  }
  return (
    <svg {...common} strokeLinecap="round">
      <circle cx="12" cy="12" r="9" />
      <path d="M9 20c0-3 .3-4-1-5 3 .4 5 0 5-4" />
    </svg>
  );
}
