import { useEffect, useState } from "react";
import { SourceGlyph } from "./SourceGlyph";
import { fetchSources, type Source } from "@/lib/api";
import { cn } from "@/lib/utils";

/**
 * The one line of index health in the product.
 *
 * The mockup reads "GitHub, Drive and Gmail connected · 2.4M items dug".
 * Badger searches one repository, live, and has no Drive or Gmail credential
 * at all — so this reports what /api/sources actually says, and says
 * "not connected" where that is the truth. An unconnected source is greyed
 * and not clickable rather than hidden, because the roadmap is part of the
 * pitch and a missing row reads as an oversight.
 */
export function SourceFooter() {
  const [sources, setSources] = useState<Source[]>([]);

  useEffect(() => {
    fetchSources().then(setSources).catch(() => setSources([]));
  }, []);

  const connected = sources.filter((s) => s.connected);
  const pending = sources.filter((s) => !s.connected);

  return (
    <footer className="flex shrink-0 items-center gap-2.5 border-t border-stone-100 px-6 py-3.5">
      {sources.map((source) => (
        <span
          key={source.id}
          title={`${source.label} — ${source.detail}`}
          className={cn(
            "inline-flex items-center",
            source.connected ? "text-stone-900" : "text-stone-300",
          )}
        >
          <SourceGlyph id={source.id} />
        </span>
      ))}
      <span className="text-[11.5px] text-stone-500">
        {sources.length === 0
          ? "checking sources…"
          : connected.length === 0
            ? "No source connected — search will fail"
            : `${connected.map((s) => s.label).join(", ")} connected, searched live${
                pending.length ? ` · ${pending.map((s) => s.label).join(" and ")} not connected yet` : ""
              }`}
      </span>
      {connected[0] && (
        <span className="ml-auto font-mono text-[11px] text-stone-500">{connected[0].detail}</span>
      )}
    </footer>
  );
}
