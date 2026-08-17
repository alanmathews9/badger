/**
 * GitHub's own icons and state colours.
 *
 * Paths are Octicons (github.com/primer/octicons), MIT licensed, copied here
 * rather than depended on. Five paths do not justify a package, and they must
 * not be hotlinked from GitHub: a strict CSP, an offline demo, or GitHub
 * changing a URL would each leave the results page with holes in it. So yes —
 * we maintain them. The upside is that they are exact rather than approximated,
 * so a GitHub user reads the state without being taught.
 *
 * Colours are GitHub's own:
 *   open    #1a7f37  green
 *   closed  #8250df  purple  (a merged PR, or an issue closed as completed)
 *
 * Every other source we add later — Drive, Gmail — brings its own mark and its
 * own brand rules, so a registry we own is unavoidable regardless.
 */

type IconProps = { size?: number; className?: string };

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

/** The GitHub mark. This is the *source* badge — which system a hit came from. */
export function GitHubMark({ size = 16, className }: IconProps) {
  return svg(
    size,
    <path d="M6.766 11.328c-2.063-.25-3.516-1.734-3.516-3.656 0-.781.281-1.625.75-2.188-.203-.515-.172-1.609.063-2.062.625-.078 1.468.25 1.968.703.594-.187 1.219-.281 1.985-.281.765 0 1.39.094 1.953.265.484-.437 1.344-.765 1.969-.687.218.422.25 1.515.046 2.047.5.593.766 1.39.766 2.203 0 1.922-1.453 3.375-3.547 3.64.531.344.89 1.094.89 1.954v1.625c0 .468.391.734.86.547C13.781 14.359 16 11.53 16 8.03 16 3.61 12.406 0 7.984 0 3.563 0 0 3.61 0 8.031a7.88 7.88 0 0 0 5.172 7.422c.422.156.828-.125.828-.547v-1.25c-.219.094-.5.156-.75.156-1.031 0-1.64-.562-2.078-1.609-.172-.422-.36-.672-.719-.719-.187-.015-.25-.093-.25-.187 0-.188.313-.328.625-.328.453 0 .844.281 1.25.86.313.452.64.655 1.031.655s.641-.14 1-.5c.266-.265.47-.5.657-.656" />,
    className,
  );
}

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
