import { useEffect, useRef } from "react";

/**
 * Close on a click outside, or on Escape.
 *
 * Escape is handled in the CAPTURE phase and stopped immediately, so a menu
 * inside a pane closes the menu and leaves the pane open. Both parts are
 * load-bearing: `stopPropagation` alone was not enough, because the pane's own
 * Escape listener sits on `document` too and a listener on the same node still
 * runs. Measured in a browser — one Escape closed the dropdown and the pane
 * together, and there was no way to back out of the inner thing alone.
 *
 * Returns the ref to put on whatever counts as "inside".
 */
export function useDismiss(open: boolean, close: () => void) {
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (!box.current?.contains(e.target as Node)) close();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.stopImmediatePropagation();
      e.preventDefault();
      close();
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey, true);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey, true);
    };
  }, [open, close]);
  return box;
}
