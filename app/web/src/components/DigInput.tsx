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
  size = "large",
  busy = false,
  autoFocus = false,
  placeholder,
  actionLabel = "Dig",
  command = null,
  tone = "bold",
  icon,
  inputRef: externalRef,
  onKeyDown,
}: {
  value: string;
  onChange: (next: string) => void;
  onSubmit: () => void;
  size?: "large" | "compact";
  busy?: boolean;
  autoFocus?: boolean;
  /** Overrides the default wording. The two modes ask for different things. */
  placeholder?: string;
  /** The submit button's label — "Dig" for search, "Ask" for chat. */
  actionLabel?: string;
  /** A picked skill, drawn as a /slug token ahead of the text. */
  command?: string | null;
  /** `bold` is the box standing on its own. `plain` is for when it already
      sits inside a framed panel, where a second heavy border would be one
      edge too many. Large size only. */
  tone?: "bold" | "plain";
  /** Replaces the magnifier. A chat box under a magnifier says the wrong
      thing about what pressing Enter will do. */
  icon?: React.ReactNode;
  /** Handed in when the caller needs to focus the box itself, after picking
      a skill from the menu. */
  inputRef?: React.RefObject<HTMLInputElement | null>;
  /** Runs BEFORE the built-in Enter handling; call preventDefault to take
      over. That is how the skill menu claims the arrow keys and Enter without
      this component knowing a menu exists. */
  onKeyDown?: (event: React.KeyboardEvent<HTMLInputElement>) => void;
}) {
  const ownRef = useRef<HTMLInputElement>(null);
  const inputRef = externalRef ?? ownRef;
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
        large && tone === "bold"
          ? "h-[58px] gap-3 border-stone-900 pr-2.5 pl-[18px] ring-4 ring-stone-900/[0.06]"
          : large
          ? "h-[52px] gap-3 border-stone-200/80 pr-2 pl-[16px] shadow-sm"
          // No max-width on the compact size. It had 560px, which kept the
          // results bar narrower than the results underneath it — and a search
          // box has no reason to be narrower than what it returns, since what
          // you type is often longer than what comes back. The caller decides
          // the width now, and on the results screen that is the full frame.
          : "h-9 w-full gap-2.5 rounded-lg border-stone-300 px-3",
      )}
    >
      <span
        className={cn(
          "flex shrink-0 items-center justify-center",
          large ? "size-[19px] text-stone-900" : "size-4 text-stone-600",
        )}
      >
        {icon ?? <Search className="size-full" strokeWidth={1.9} />}
      </span>
      {command && (
        <span className="shrink-0 font-mono text-[13.5px] font-medium text-amber-700">
          /{command}
        </span>
      )}

      <input
        ref={inputRef}
        autoFocus={autoFocus}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={(e) => {
          onKeyDown?.(e);
          // A caller that handled the key owns it. Without this the menu's
          // Enter would pick a skill AND submit the half-typed "/fin".
          if (e.defaultPrevented) return;
          if (e.key === "Enter" && value.trim()) onSubmit();
        }}
        placeholder={
          placeholder ?? (large ? "Ask a question, or search for a doc, repo or person" : "Search")
        }
        className={cn(
          "min-w-0 flex-1 bg-transparent placeholder:text-stone-400 focus:outline-none",
          large ? "text-base" : "text-[13.5px]",
        )}
      />

      {!large && value && (
        <button
          onClick={() => onChange("")}
          aria-label="Clear search"
          className="shrink-0 text-stone-400 hover:text-stone-900"
        >
          <X className="size-3.5" strokeWidth={2} />
        </button>
      )}

      {large && (
        <Button
          // Wrapped, never passed directly: onClick would hand the Button's
          // MouseEvent to onSubmit, where it arrives as the query and throws.
          onClick={() => onSubmit()}
          disabled={busy || !value.trim()}
          className="h-10 gap-2 rounded-lg px-[15px] text-[13px]"
        >
          {busy ? "Digging…" : actionLabel}
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
