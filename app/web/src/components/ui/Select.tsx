import { useCallback, useState } from "react";
import { Check, ChevronDown } from "lucide-react";
import { useDismiss } from "@/lib/useDismiss";
import { cn } from "@/lib/utils";

/**
 * A dropdown that looks like the rest of the product.
 *
 * A native `<select>` is drawn by the operating system, so it carries the
 * platform's own font, corner radius and highlight colour into a form that has
 * neither — on macOS it renders a blue-tinted popup beside stone-grey inputs.
 * That is the one control on a page that cannot be styled, so where the list
 * is short and known this replaces it.
 *
 * Deliberately not a listbox with full keyboard semantics: this is four
 * options, and the trigger is a button, so Tab reaches it and Enter opens it.
 * Escape closes it without closing the pane behind it — see `useDismiss`.
 */
export function Select<T extends string | number>({
  value,
  options,
  onChange,
  label,
  className,
}: {
  value: T;
  options: { value: T; label: string; hint?: string }[];
  onChange: (value: T) => void;
  label: string;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const close = useCallback(() => setOpen(false), []);
  const box = useDismiss(open, close);
  const current = options.find((o) => o.value === value);

  return (
    <div ref={box} className={cn("relative", className)}>
      <button
        type="button"
        aria-label={label}
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        className="flex h-9 w-full items-center gap-2 rounded-lg border border-stone-200 bg-white px-2.5 text-left text-[13px] text-stone-800 hover:border-stone-300 focus:border-stone-400 focus:outline-none"
      >
        <span className="min-w-0 flex-1 truncate">{current?.label ?? String(value)}</span>
        <ChevronDown
          className={cn("size-3.5 shrink-0 text-stone-400 transition-transform", open && "rotate-180")}
          strokeWidth={2}
        />
      </button>

      {open && (
        // Capped and scrollable: the hours list is seven long today and the
        // pane is not tall enough to assume it always will be.
        <div className="absolute z-30 mt-1 max-h-[240px] w-full overflow-y-auto rounded-lg border border-stone-200 bg-white py-1 shadow-lg">
          {options.map((o) => (
            <button
              key={String(o.value)}
              type="button"
              onClick={() => {
                onChange(o.value);
                close();
              }}
              className="flex w-full items-center gap-2 px-2.5 py-1.5 text-left text-[12.5px] text-stone-700 hover:bg-stone-50"
            >
              <span className="min-w-0 flex-1 truncate">{o.label}</span>
              {o.hint && <span className="shrink-0 text-[11px] text-stone-400">{o.hint}</span>}
              {o.value === value && <Check className="size-3.5 shrink-0 text-stone-800" strokeWidth={2.4} />}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
