import { useCallback, useEffect, useLayoutEffect, useState } from "react";
import { ArrowLeft, ArrowRight } from "lucide-react";
import { useLocation, useNavigate } from "react-router-dom";
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
 * search bar and the real sidebar rows, opening each destination as it goes.
 *
 * **It highlights live elements rather than pictures of them.** Every target is
 * on screen at once — the rail carries Ask, Agents, Tools and Skills, and the
 * home search box sits beside it — so a spotlight needs no scrolling and no
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
  const navigate = useNavigate();
  const { pathname } = useLocation();

  // "hidden" until we know; "planning" is the one frame spent on /search
  // deciding the itinerary. See `start`.
  const [phase, setPhase] = useState<"hidden" | "welcome" | "planning" | "walking">("hidden");
  const [plan, setPlan] = useState<TourStep[]>([]);
  const [at, setAt] = useState(0);
  const [rect, setRect] = useState<DOMRect | null>(null);

  useEffect(() => {
    if (!tourSeen()) setPhase("welcome");
  }, []);

  const close = useCallback(
    (how: "finished" | "skipped") => {
      markTourSeen(how);
      setPhase("hidden");
      if (how === "finished") {
        // End with the cursor where the reader can act, which is the whole
        // point of "Start digging". No text is put in the box: a query they
        // did not type is a fake.
        //
        // The walk ends on /skills, so this has to come home first — and focus
        // only after the frame that renders it, or there is no box yet.
        // A timer rather than a frame, for the same reason as `start`: rAF
        // does not fire in a background tab, and this must not be the one
        // thing that silently does not happen.
        navigate("/search", { replace: true });
        setTimeout(
          () => document.querySelector<HTMLElement>('[data-tour="search"] input')?.focus(),
          0,
        );
      }
    },
    [navigate],
  );

  /**
   * Leave the welcome dialog for the walk, fixing the itinerary as we go.
   *
   * Goes to /search first because that is where the first step's target lives,
   * and counts the plan only after that frame has rendered — the plan has to
   * be counted against the page the walk actually starts on, or the counter
   * lies. The welcome card stays up for that one frame.
   *
   * The frame is scheduled HERE rather than from an effect keyed on the phase.
   * As an effect it depended on `close`, whose identity moves with `navigate`,
   * so every re-render cancelled the pending frame and rescheduled it: the
   * callback never ran and the tour sat on the welcome card forever.
   *
   * Fixing the itinerary once, rather than skipping a step whose target turns
   * out to be missing, is itself a fix. Lazy skipping produced two faults
   * visible in the browser: starting anywhere without a home search box, the
   * counter read "2 of 5" for the first thing shown, and Back was a dead
   * button — it moved to the search step, which immediately advanced again, so
   * pressing it did nothing at all. `[data-tour="search"]` is missing when a
   * search has already run, because the home box is replaced by the compact
   * one in the header. Then the walk is genuinely four steps and says so.
   */
  const start = useCallback(() => {
    navigate("/search", { replace: true });
    setPhase("planning");
  }, [navigate]);

  // Counted in an effect, NOT from a requestAnimationFrame.
  //
  // rAF is starved in a tab that is not foreground, so a reader who pressed
  // Continue and switched tabs came back to a welcome card that never
  // advanced. An effect runs after the commit whatever the tab is doing, and
  // by then the route `start` pushed has rendered, which is the only reason
  // the frame was wanted.
  useEffect(() => {
    if (phase !== "planning") return;
    const steps = planSteps((t) => Boolean(document.querySelector(`[data-tour="${t}"]`)));
    if (steps.length === 0) {
      markTourSeen("finished");
      setPhase("hidden");
      return;
    }
    setPlan(steps);
    setAt(0);
    setPhase("walking");
  }, [phase]);

  const step = phase === "walking" ? plan[at] : undefined;

  // Open the step's page, then measure its target. `pathname` is a dependency
  // so the measure runs on the pass after the route changes rather than
  // against the page being left.
  useLayoutEffect(() => {
    if (!step) {
      setRect(null);
      return;
    }
    if (pathname !== step.route) {
      // `replace`, because this is the tour moving and not the reader. Pushing
      // would leave five tour stops in the back button afterwards.
      navigate(step.route, { replace: true });
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
  }, [step, pathname, navigate]);

  const go = useCallback(
    (delta: 1 | -1) => {
      const to = delta === 1 ? nextIndex(at, plan.length) : prevIndex(at);
      if (to !== null) setAt(to);
    },
    [at, plan.length],
  );

  // The arrows are the controls, so the arrow keys are too.
  useEffect(() => {
    if (phase === "hidden") return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") close("skipped");
      if (phase !== "walking") return;
      if (e.key === "ArrowRight") go(1);
      if (e.key === "ArrowLeft") go(-1);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [phase, close, go]);

  if (phase === "hidden") return null;

  if (phase === "welcome" || phase === "planning") {
    return (
      <Backdrop onSkip={() => close("skipped")}>
        <div
          role="dialog"
          aria-modal="true"
          aria-label="Welcome to Badger"
          className="w-[min(600px,calc(100vw-32px))] rounded-3xl border border-stone-200 bg-white px-12 py-11 text-center shadow-2xl"
        >
          {/* `mark.svg` rather than the favicon: it is the same drawing as ink
              on nothing, with no tile behind it. Large, because at this size
              the badger is the picture rather than an icon beside a heading. */}
          <img src="/mark.svg" alt="" className="mx-auto h-[104px] w-auto" />
          <h2 className="mt-8 text-[27px] font-semibold tracking-[-0.025em] text-stone-900">
            {WELCOME.title}
          </h2>
          <p className="mx-auto mt-4 max-w-[440px] text-[15px]/[1.65] text-stone-600">
            {WELCOME.body}
          </p>
          {/* No Skip here. Escape and a click on the ground both leave, and a
              dismiss control on the first thing a new reader sees competes
              with the one action worth taking. */}
          <button
            type="button"
            autoFocus
            onClick={start}
            className="mt-9 h-11 rounded-xl bg-stone-900 px-7 text-[14.5px] font-medium text-stone-50 hover:bg-stone-800"
          >
            {WELCOME.button}
          </button>
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
    // while its tooltip still points at where it used to be.
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
            {/* Arrows rather than the words. The step is a position in a
                sequence, which is what an arrow says and what "Back" only
                implies. Rendered disabled rather than hidden on the first
                step, so the pair does not reflow as the walk moves. */}
            <button
              type="button"
              aria-label="Previous step"
              disabled={back === null}
              onClick={() => go(-1)}
              className="grid size-8 place-items-center rounded-lg border border-stone-200 text-stone-700 hover:bg-stone-50 disabled:opacity-35 disabled:hover:bg-transparent"
            >
              <ArrowLeft className="size-4" />
            </button>
            {next === null ? (
              <button
                type="button"
                autoFocus
                onClick={() => close("finished")}
                className="h-8 rounded-lg bg-stone-900 px-3.5 text-[12.5px] font-medium text-stone-50 hover:bg-stone-800"
              >
                Start digging!
              </button>
            ) : (
              <button
                type="button"
                autoFocus
                aria-label="Next step"
                onClick={() => go(1)}
                className="grid size-8 place-items-center rounded-lg bg-stone-900 text-stone-50 hover:bg-stone-800"
              >
                <ArrowRight className="size-4" />
              </button>
            )}
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
