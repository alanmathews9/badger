import { useEffect, useRef } from "react";
import { Search, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/**
 * The one input in the product, in its two sizes: `large` on Home, `compact`
 * in the top bar once there are results. Same component either way, because
 * the compact one has to keep the query as typed — a search box that forgets
 * what you asked is the classic enterprise-search annoyance.
 */
export function DigInput({
  value,
  onChange,
  onSubmit,
  onClear,
  size = "large",
  busy = false,
  autoFocus = false,
}: {
  value: string;
  onChange: (next: string) => void;
  onSubmit: () => void;
  onClear?: () => void;
  size?: "large" | "compact";
  busy?: boolean;
  autoFocus?: boolean;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const large = size === "large";

  // ⌘K focuses the input from anywhere, which is the shortcut the design
  // advertises on Home. Deliberately focus-only: no palette to open yet, and
  // promising one in the hint would be a lie.
  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.key === "k" && (event.metaKey || event.ctrlKey)) {
        event.preventDefault();
        inputRef.current?.focus();
        inputRef.current?.select();
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  return (
    <div
      className={cn(
        "flex items-center rounded-[10px] border bg-white",
        large
          ? "h-[58px] gap-3 border-stone-900 pr-2.5 pl-[18px] ring-4 ring-stone-900/[0.06]"
          : "h-9 w-full max-w-[560px] gap-2.5 rounded-lg border-stone-300 px-3",
      )}
    >
      <Search
        className={cn("shrink-0", large ? "size-[19px] text-stone-900" : "size-4 text-stone-600")}
        strokeWidth={1.9}
      />
      <input
        ref={inputRef}
        autoFocus={autoFocus}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && value.trim()) onSubmit();
        }}
        placeholder={
          large ? "Ask a question, or search for a doc, repo or person" : "Search"
        }
        className={cn(
          "min-w-0 flex-1 bg-transparent placeholder:text-stone-400 focus:outline-none",
          large ? "text-base" : "text-[13.5px]",
        )}
      />

      {!large && value && (
        <button
          onClick={() => (onClear ? onClear() : onChange(""))}
          aria-label="Clear search"
          className="shrink-0 text-stone-400 hover:text-stone-900"
        >
          <X className="size-3.5" strokeWidth={2} />
        </button>
      )}

      {large && (
        <Button
          onClick={onSubmit}
          disabled={busy || !value.trim()}
          className="h-10 gap-2 rounded-lg px-[15px] text-[13px]"
        >
          {busy ? "Digging…" : "Dig"}
          <span className="font-mono text-[10.5px] text-stone-400">↵</span>
        </Button>
      )}
    </div>
  );
}

/** The three clay bars under the question — the app's only ornament. */
export function ClayBars() {
  return (
    <div className="mt-4 flex gap-1">
      <span className="h-[3px] w-10 rounded-sm bg-amber-600" />
      <span className="h-[3px] w-10 rounded-sm bg-amber-700" />
      <span className="h-[3px] w-10 rounded-sm bg-amber-900" />
    </div>
  );
}
