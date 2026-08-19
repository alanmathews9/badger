/**
 * How long ago, in the shortest form that is still unambiguous.
 *
 * Recent things get relative time because that is how people hold them —
 * "3d ago" is immediately useful, "2026-08-16" needs arithmetic. Older things
 * get a date, because "47d ago" needs the same arithmetic back again.
 *
 * The year is omitted when it is this year, which is the common case and the
 * one that adds no information. It appears when it does not, because "8
 * August" spanning two years would be a lie by omission.
 */
export function whenLabel(iso: string): string {
  if (!iso) return "";
  const then = new Date(iso);
  if (Number.isNaN(then.getTime())) return iso;

  const now = new Date();
  const days = Math.floor((now.getTime() - then.getTime()) / 86_400_000);

  if (days < 0) return format(then, now);
  if (days === 0) {
    const hours = Math.floor((now.getTime() - then.getTime()) / 3_600_000);
    if (hours < 1) return "just now";
    return `${hours}h ago`;
  }
  if (days === 1) return "yesterday";
  if (days < 7) return `${days}d ago`;
  return format(then, now);
}

/** "8 August", or "8 August 2025" when the year is not the current one. */
function format(date: Date, now: Date): string {
  const sameYear = date.getFullYear() === now.getFullYear();
  return date.toLocaleDateString("en-GB", {
    day: "numeric",
    month: "long",
    ...(sameYear ? {} : { year: "numeric" }),
  });
}
