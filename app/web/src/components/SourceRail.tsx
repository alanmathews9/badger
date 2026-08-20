import { Search } from "lucide-react";
import { BRAND_LOGOS, DriveMark } from "./BrandLogos";
import { KINDS, kindGroupOf } from "./SearchFilters";
import type { SourceId, SearchResponse, SearchRow } from "@/lib/api";
import { cn } from "@/lib/utils";

/** Fixed order, so the rail does not reshuffle between searches. */
const ORDER: SourceId[] = ["github", "gmail", "drive"];
const LABEL: Record<SourceId, string> = { github: "GitHub", gmail: "Gmail", drive: "Drive" };

/** The Drive kinds a nested row can offer, in the order the dropdown lists them. */
const DRIVE_KINDS = KINDS.filter((k) =>
  k.id.some((id) => id === "doc" || id === "sheet" || id === "folder" || id === "pdf"),
);

/**
 * The sources a search reached, as a filter.
 *
 * A source that FAILED is still listed and says so. "Drive was not reached"
 * and "Drive found nothing" are different facts, and showing only the second
 * lies by omission. A failed source is not selectable: filtering to it would
 * show an empty list that looks like an answer.
 *
 * Drive nests by type, and only Drive does — its rows are genuinely different
 * things, where GitHub's four kinds all read as "the repository". The children
 * set the same filter the type dropdown does, with the same labels, so the two
 * controls are one filter with two ways in.
 *
 * The children are always visible rather than behind a drill-in: the counts
 * are the reason anyone looks at this rail, and a facet count nobody can read
 * is not a facet count.
 *
 * Those counts IGNORE the type filter on purpose. They are facet counts, so
 * picking Documents must not zero Spreadsheets and strand the reader. The line
 * at the top is the one number that counts what is on screen.
 */
export function SourceRail({
  data,
  rows,
  shownCount,
  active,
  onSelect,
  kind,
  onKind,
}: {
  data: SearchResponse;
  /** The rows after the time and author filters, so a count never contradicts
      the list beside it — narrowing to "Past week" has to move these numbers
      too — but NOT after source or type, which are what these rows offer. */
  rows: SearchRow[];
  /** What is actually rendered in the results column right now. */
  shownCount: number;
  active: SourceId | null;
  onSelect: (source: SourceId | null) => void;
  kind: string | null;
  onKind: (kind: string | null) => void;
}) {
  const counts = ORDER.map((id) => ({
    id,
    outcome: data.sources[id],
    count: rows.filter((r) => r.source === id).length,
  })).filter((entry) => entry.outcome);

  const driveRows = rows.filter((r) => r.source === "drive");
  // Documents and Spreadsheets are always listed, at zero if that is the
  // answer: dropped when empty, "no spreadsheets matched" cannot be told from
  // "this rail does not do spreadsheets".
  //
  // Folders and PDFs appear only when a search finds some — this corpus holds
  // no PDFs at all, so pinning them open would be a permanently dead row.
  const ALWAYS = ["Documents", "Spreadsheets"];
  const driveKinds = DRIVE_KINDS.map((k) => ({
    label: k.label,
    kind: k.id[0],
    count: driveRows.filter((r) => kindGroupOf(r) === k.label).length,
  })).filter((k) => k.count > 0 || ALWAYS.includes(k.label));

  return (
    <aside className="w-[240px] shrink-0">
      {/* Just the count of what is on screen. It read "20 of 29 results" for
          a while, which was two true numbers and one confusing sentence: the
          29 is what the three sources reported having, the 20 is what was
          fetched and ranked, and no reader needs to hold both. */}
      <div className="px-2.5 pb-2 text-[11px] text-stone-500">
        {shownCount} {shownCount === 1 ? "result" : "results"} found
      </div>

      <Row
        label="All"
        icon={<Search className="size-3.5 text-stone-500" strokeWidth={2} />}
        count={rows.length}
        selected={active === null}
        onClick={() => onSelect(null)}
      />

      {counts.map(({ id, outcome, count }) => {
        const Logo = BRAND_LOGOS[id];
        const failed = outcome?.ok === false;
        // Only Drive nests, and only when Drive actually found something —
        // a breakdown of nothing under a row already reading zero is noise.
        const open = id === "drive" && !failed && count > 0;
        return (
          <div key={id}>
            <Row
              label={LABEL[id]}
              count={failed ? null : count}
              note={failed ? "not reached" : undefined}
              icon={<Logo size={14} />}
              selected={active === id}
              disabled={failed || count === 0}
              onClick={() => onSelect(id)}
            />
            {open &&
              driveKinds.map((k) => (
                <Row
                  key={k.label}
                  label={k.label}
                  count={k.count}
                  // The row's own glyph, at rail size — the same mark it
                  // carries in the results, so the filter and the thing it
                  // filters to are recognisably the same.
                  icon={<DriveMark kind={k.kind} size={15} badge={false} />}
                  indent
                  disabled={k.count === 0}
                  selected={active === "drive" && kind === k.label}
                  // Clicking the selected one again returns to all of Drive,
                  // which is the only other place the reader could want to go
                  // and saves a trip up to the parent row.
                  onClick={() =>
                    onKind(active === "drive" && kind === k.label ? null : k.label)
                  }
                />
              ))}
          </div>
        );
      })}
    </aside>
  );
}

function Row({
  label,
  count,
  note,
  icon,
  selected,
  disabled,
  indent,
  onClick,
}: {
  label: string;
  count: number | null;
  note?: string;
  icon?: React.ReactNode;
  selected: boolean;
  disabled?: boolean;
  indent?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className={cn(
        "flex w-full items-center gap-2.5 rounded-lg py-2 pr-2.5 text-left text-[13px] transition-colors",
        indent ? "pl-7" : "pl-2.5",
        selected ? "bg-stone-100 font-medium text-stone-900" : "text-stone-600",
        !selected && !disabled && "hover:bg-stone-50",
        disabled && "cursor-default text-stone-400",
      )}
    >
      {icon ?? <span className="size-3.5" />}
      <span className="truncate">{label}</span>
      <span className="ml-auto shrink-0 font-mono text-[11px] text-stone-400">
        {note ?? count}
      </span>
    </button>
  );
}
