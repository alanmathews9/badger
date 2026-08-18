/**
 * GitHub's issue and pull-request state icons.
 *
 * Paths are Octicons (github.com/primer/octicons), MIT licensed, copied here
 * rather than depended on. Four paths do not justify a package, and they must
 * not be hotlinked from GitHub: a strict CSP, an offline demo, or GitHub
 * changing a URL would each leave the results page with holes in it. The
 * upside is that they are exact rather than approximated, so a GitHub user
 * reads the state without being taught.
 *
 * Colours are GitHub's own:
 *   open    #1a7f37  green
 *   closed  #8250df  purple  (a merged PR, or an issue closed as completed)
 *
 * This file is *only* about state. Which system a row came from is answered by
 * BrandLogos, which every surface now uses — there were three overlapping icon
 * sets for those three sources, and a GitHub row was drawn from a different one
 * than the Gmail row beside it.
 */

const svg = (size: number, children: React.ReactNode, className?: string) => (
  <svg
    width={size}
    height={size}
    viewBox="0 0 16 16"
    fill="currentColor"
    aria-hidden="true"
    className={className}
  >
    {children}
  </svg>
);

const ISSUE_OPENED = (
  <>
    <path d="M8 9.5a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3Z" />
    <path d="M8 0a8 8 0 1 1 0 16A8 8 0 0 1 8 0ZM1.5 8a6.5 6.5 0 1 0 13 0 6.5 6.5 0 0 0-13 0Z" />
  </>
);

const ISSUE_CLOSED = (
  <>
    <path d="M11.28 6.78a.75.75 0 0 0-1.06-1.06L7.25 8.69 5.78 7.22a.75.75 0 0 0-1.06 1.06l2 2a.75.75 0 0 0 1.06 0l3.5-3.5Z" />
    <path d="M16 8A8 8 0 1 1 0 8a8 8 0 0 1 16 0Zm-1.5 0a6.5 6.5 0 1 0-13 0 6.5 6.5 0 0 0 13 0Z" />
  </>
);

const PR_OPEN = (
  <path d="M1.5 3.25a2.25 2.25 0 1 1 3 2.122v5.256a2.251 2.251 0 1 1-1.5 0V5.372A2.25 2.25 0 0 1 1.5 3.25Zm5.677-.177L9.573.677A.25.25 0 0 1 10 .854V2.5h1A2.5 2.5 0 0 1 13.5 5v5.628a2.251 2.251 0 1 1-1.5 0V5a1 1 0 0 0-1-1h-1v1.646a.25.25 0 0 1-.427.177L7.177 3.427a.25.25 0 0 1 0-.354ZM3.75 2.5a.75.75 0 1 0 0 1.5.75.75 0 0 0 0-1.5Zm0 9.5a.75.75 0 1 0 0 1.5.75.75 0 0 0 0-1.5Zm8.25.75a.75.75 0 1 0 1.5 0 .75.75 0 0 0-1.5 0Z" />
);

const PR_MERGED = (
  <path d="M5.45 5.154A4.25 4.25 0 0 0 9.25 7.5h1.378a2.251 2.251 0 1 1 0 1.5H9.25A5.734 5.734 0 0 1 5 7.123v3.505a2.25 2.25 0 1 1-1.5 0V5.372a2.25 2.25 0 1 1 1.95-.218ZM4.25 13.5a.75.75 0 1 0 0-1.5.75.75 0 0 0 0 1.5Zm8.5-4.5a.75.75 0 1 0 0-1.5.75.75 0 0 0 0 1.5ZM5 3.25a.75.75 0 1 0 0 .005V3.25Z" />
);

export type ItemKind = "issue" | "pr";

/** The state icon at the start of a title, in GitHub's own colours. */
export function StateIcon({
  kind,
  state,
  size = 16,
}: {
  kind: ItemKind;
  state: string;
  size?: number;
}) {
  const closed = state === "closed";
  const pr = kind === "pr";

  // Green open, purple closed. GitHub's search API reports a merged PR as
  // plain "closed" and does not distinguish it from a declined one, so a
  // closed PR gets the merge icon — right for every PR in this corpus, and the
  // distinction would cost one API call per row to recover.
  const icon = pr ? (closed ? PR_MERGED : PR_OPEN) : closed ? ISSUE_CLOSED : ISSUE_OPENED;
  const color = closed ? "#8250df" : "#1a7f37";

  return (
    <span style={{ color }} className="inline-flex shrink-0 items-center">
      {svg(size, icon)}
    </span>
  );
}
