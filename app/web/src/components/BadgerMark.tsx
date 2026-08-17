/**
 * The badger's head, from the design. Two-tone by construction: the face is
 * `fill` and the stripe and eyes are `ground`, so the mark inverts cleanly
 * when it sits on a dark surface.
 */
export function BadgerMark({
  size = 19,
  fill = "#f5f5f4",
  ground = "#1c1917",
}: {
  size?: number;
  fill?: string;
  ground?: string;
}) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true">
      <circle cx="6.4" cy="5.6" r="1.9" fill={fill} />
      <circle cx="17.6" cy="5.6" r="1.9" fill={fill} />
      <path d="M12 2.4 L19.1 6.3 C19.1 13.2 16 19.6 12 21.6 C8 19.6 4.9 13.2 4.9 6.3 Z" fill={fill} />
      <path d="M12 4.9 L14.3 7 C14.3 12.3 13.3 16.8 12 18.6 C10.7 16.8 9.7 12.3 9.7 7 Z" fill={ground} />
      <circle cx="8.4" cy="9.2" r="1.05" fill={ground} />
      <circle cx="15.6" cy="9.2" r="1.05" fill={ground} />
    </svg>
  );
}

/** The mark in its dark rounded tile, as it appears in the top bar. */
export function BadgerBadge({ size = 26 }: { size?: number }) {
  return (
    <span
      className="inline-flex shrink-0 items-center justify-center rounded-[7px] bg-stone-900"
      style={{ width: size, height: size }}
    >
      <BadgerMark size={Math.round(size * 0.73)} />
    </span>
  );
}
