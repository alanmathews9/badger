import { Search } from "lucide-react";
import { BRAND_LOGOS } from "./BrandLogos";
import type { SourceId, SearchResponse, SearchRow } from "@/lib/api";
import { cn } from "@/lib/utils";

/** Fixed order, so the rail does not reshuffle between searches. */
const ORDER: SourceId[] = ["github", "gmail", "drive"];
const LABEL: Record<SourceId, string> = { github: "GitHub", gmail: "Gmail", drive: "Drive" };

/**
 * The sources a search reached, as a filter.
 *
 * This replaces the coverage strip that sat above the results. That strip said
 * the same things — which sources answered, how many each found, which failed
 * — but said them in a place where they were a caption rather than a control,
 * and it pushed the first result below the fold. Glean puts the same
 * information in a right-hand rail where each row filters, and that is the
 * better home for it: the counts are the reason you would want to filter.
 *
 * **A source that FAILED is still listed, and says so.** "Drive was not
 * reached" and "Drive found nothing" are different facts, and a search UI that
 * shows only the second is lying by omission. A failed source is not
 * selectable, because filtering to it would show an empty list that looks like
 * an answer.
 */
export function SourceRail({
  data,
  rows,
  active,
  onSelect,
}: {
  data: SearchResponse;
  /** The rows after the OTHER filters, so a count never contradicts the list
      beside it — narrowing to "Past week" has to move these numbers too. */
  rows: SearchRow[];
  active: SourceId | null;
  onSelect: (source: SourceId | null) => void;
}) {
  const counts = ORDER.map((id) => ({
    id,
    outcome: data.sources[id],
    count: rows.filter((r) => r.source === id).length,
  })).filter((entry) => entry.outcome);

  return (
    <aside className="w-[196px] shrink-0">
      {/* Just the count of what is on screen. It read "20 of 29 results" for
          a while, which was two true numbers and one confusing sentence: the
          29 is what the three sources reported having, the 20 is what was
          fetched and ranked, and no reader needs to hold both. */}
      <div className="px-2.5 pb-2 text-[11px] text-stone-500">
        {rows.length} {rows.length === 1 ? "result" : "results"} found
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
        return (
          <Row
            key={id}
            label={LABEL[id]}
            count={failed ? null : count}
            note={failed ? "not reached" : undefined}
            icon={<Logo size={14} />}
            selected={active === id}
            disabled={failed || count === 0}
            onClick={() => onSelect(id)}
          />
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
  onClick,
}: {
  label: string;
  count: number | null;
  note?: string;
  icon?: React.ReactNode;
  selected: boolean;
  disabled?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className={cn(
        "flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-[13px] transition-colors",
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
