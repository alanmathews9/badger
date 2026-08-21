import { useCallback, useEffect, useLayoutEffect, useState } from "react";
import {
  WELCOME,
  markTourSeen,
  nextIndex,
  planSteps,
  prevIndex,
  tourSeen,
  type TourStep,
} from "@/lib/onboarding";

/**
 * The first-run tour: a welcome dialog, then a spotlight walked over the real
 * search bar and the real sidebar rows.
 *
 * **It highlights live elements rather than pictures of them.** Every target is
 * on screen at once — the rail carries Ask, Agents, Tools and Skills, and the
 * home search box sits beside it — so a spotlight needs no route change and no
 * illustrations. Illustrations would be a fifth copy of the navigation to keep
 * in step with the other four, which is the class of display this repository
 * keeps finding stale. A rectangle read off the element itself cannot drift.
 *
 * Targets are found by `data-tour` attribute rather than by refs threaded down
 * through props: `AppSidebar` and `SearchScreen` care about neither the tour
 * nor each other, and the attribute values come from the same union the steps
 * do (`TourTarget`), so the lookup is generated from a typed source.
 */
export function Tour() {
  // `null` while we have not decided, so nothing flashes on a browser that has
  // already seen it. "welcome" is the centred dialog; a plan is the walk.
  const [phase, setPhase] = useState<"hidden" | "welcome" | "walking">("hidden");
  const [plan, setPlan] = useState<TourStep[]>([]);
  const [at, setAt] = useState(0);
  const [rect, setRect] = useState<DOMRect | null>(null);

  useEffect(() => {
    if (!tourSeen()) setPhase("welcome");
  }, []);

  const close = useCallback((how: "finished" | "skipped") => {
    markTourSeen(how);
    setPhase("hidden");
    if (how === "finished") {
      // End with the cursor where the reader can act, which is the whole point
      // of "Start digging". No text is put in the box: a query they did not
      // type is a fake.
      document.querySelector<HTMLElement>('[data-tour="search"] input')?.focus();
    }
  }, []);

  /**
   * Leave the welcome dialog for the walk, fixing the itinerary as we go.
   *
   * `[data-tour="search"]` only exists on the home state of /search — once a
   * search has run the home box is replaced by the compact one in the header —
   * so on any other route the walk is genuinely four steps, and it says so.
   */
  const start = useCallback(() => {
    const steps = planSteps((t) => Boolean(document.querySelector(`[data-tour="${t}"]`)));
    if (steps.length === 0) return close("finished");
    setPlan(steps);
    setAt(0);
    setPhase("walking");
  }, [close]);

  const step = phase === "walking" ? plan[at] : undefined;

  useLayoutEffect(() => {
    if (!step) {
      setRect(null);
      return;
    }
    const el = document.querySelector(`[data-tour="${step.target}"]`);
    if (!el) return;

    const measure = () => setRect(el.getBoundingClientRect());
    measure();
    // Once more after the frame lands: the rail animates its width, so a rect
    // read during that transition is the old one.
    const frame = requestAnimationFrame(measure);
    window.addEventListener("resize", measure);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener("resize", measure);
    };
  }, [step]);

  useEffect(() => {
    if (phase === "hidden") return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") close("skipped");
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [phase, close]);

  if (phase === "hidden") return null;

  if (phase === "welcome") {
    return (
      <Backdrop onSkip={() => close("skipped")}>
        <div
          role="dialog"
          aria-modal="true"
          aria-label="Welcome to Badger"
          className="w-[min(440px,calc(100vw-32px))] rounded-2xl border border-stone-200 bg-white p-7 shadow-2xl"
        >
          <img src="/favicon.svg" alt="" className="size-11 rounded-xl" />
          <h2 className="mt-4 text-[21px] font-semibold tracking-[-0.02em] text-stone-900">
            {WELCOME.title}
          </h2>
          <p className="mt-2.5 text-[14px]/[1.6] text-stone-600">{WELCOME.body}</p>
          <div className="mt-6 flex items-center justify-between">
            <button
              type="button"
              onClick={() => close("skipped")}
              className="text-[13px] text-stone-500 hover:text-stone-800"
            >
              Skip
            </button>
            <button
              type="button"
              autoFocus
              onClick={start}
              className="h-10 rounded-lg bg-stone-900 px-5 text-[14px] font-medium text-stone-50 hover:bg-stone-800"
            >
              {WELCOME.button}
            </button>
          </div>
        </div>
      </Backdrop>
    );
  }

  // A step whose rect has not been measured yet renders nothing rather than a
  // tooltip parked at 0,0 that then jumps into place.
  if (!step || !rect) return null;

  const PAD = 6;
  const hole = {
    top: rect.top - PAD,
    left: rect.left - PAD,
    width: rect.width + PAD * 2,
    height: rect.height + PAD * 2,
  };

  const CARD = 320;
  const GAP = 14;
  const clamp = (v: number, max: number) => Math.max(12, Math.min(v, max));
  const pos =
    step.side === "bottom"
      ? {
          top: hole.top + hole.height + GAP,
          left: clamp(hole.left, window.innerWidth - CARD - 12),
        }
      : {
          top: clamp(hole.top - 6, window.innerHeight - 190),
          left: clamp(hole.left + hole.width + GAP, window.innerWidth - CARD - 12),
        };

  const next = nextIndex(at, plan.length);
  const back = prevIndex(at);

  return (
    // Fixed and click-capturing: during the tour the page underneath must not
    // be operable, or the element being described can be navigated away from
    // while its tooltip still points at where it used to be. It is also what
    // makes fixing the itinerary in `start` safe.
    <div className="fixed inset-0 z-50" onClick={(e) => e.stopPropagation()}>
      {/* The dim is one element's shadow rather than four rectangles around a
          gap, so the cut-out follows the same radius for free. */}
      <div
        className="pointer-events-none absolute rounded-[10px] ring-2 ring-white/70 transition-all duration-200"
        style={{
          top: hole.top,
          left: hole.left,
          width: hole.width,
          height: hole.height,
          boxShadow: "0 0 0 9999px rgba(28,25,23,0.55)",
        }}
      />

      <div
        role="dialog"
        aria-modal="true"
        aria-label={step.title}
        style={{ top: pos.top, left: pos.left, width: CARD }}
        className="absolute rounded-xl border border-stone-200 bg-white p-4 shadow-2xl"
      >
        <h3 className="text-[14.5px] font-semibold text-stone-900">{step.title}</h3>
        <p className="mt-1.5 text-[13px]/[1.6] text-stone-600">{step.body}</p>

        <div className="mt-4 flex items-center justify-between gap-3">
          <span className="font-mono text-[11px] text-stone-400">
            {at + 1} of {plan.length}
          </span>
          <div className="flex items-center gap-1.5">
            <button
              type="button"
              onClick={() => close("skipped")}
              className="rounded-lg px-2.5 py-1.5 text-[12.5px] text-stone-500 hover:text-stone-800"
            >
              Skip
            </button>
            {back !== null && (
              <button
                type="button"
                onClick={() => setAt(back)}
                className="rounded-lg border border-stone-200 px-3 py-1.5 text-[12.5px] font-medium text-stone-700 hover:bg-stone-50"
              >
                Back
              </button>
            )}
            <button
              type="button"
              autoFocus
              onClick={() => (next === null ? close("finished") : setAt(next))}
              className="rounded-lg bg-stone-900 px-3.5 py-1.5 text-[12.5px] font-medium text-stone-50 hover:bg-stone-800"
            >
              {next === null ? "Start digging!" : "Next"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

/** The welcome dialog's ground: dim everything, centre one card. */
function Backdrop({ children, onSkip }: { children: React.ReactNode; onSkip: () => void }) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-stone-900/55 p-4"
      onClick={(e) => {
        // Only a click on the ground itself, so a click inside the card does
        // not dismiss it.
        if (e.target === e.currentTarget) onSkip();
      }}
    >
      {children}
    </div>
  );
}
