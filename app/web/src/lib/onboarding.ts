// The onboarding tour: what it says, what it points at, and whether it has
// been seen.
//
// Kept apart from the overlay that draws it so the copy can be read and edited
// without reading any positioning code.

/**
 * A step's id is also the value of the `data-tour` attribute it looks for, so
 * the two cannot drift: `Tour.tsx` queries `[data-tour="${step.target}"]` and
 * `target` is this union.
 */
export type TourTarget = "search" | "ask" | "agents" | "tools" | "skills";

export type TourStep = {
  target: TourTarget;
  title: string;
  body: string;
  /** Which side of the target the tooltip sits on. */
  side: "bottom" | "right";
  /**
   * The page this step opens behind the spotlight.
   *
   * A step describing a destination shows that destination: reading about
   * Agents over an empty search screen is a description, and reading it over
   * the actual grid of Mini Badgers is the thing itself.
   */
  route: string;
};

/** The welcome dialog. No target — it is centred and highlights nothing. */
export const WELCOME = {
  title: "Hello, I'm Badger.",
  body:
    "I dig into your company data to find out exactly what you're looking for, " +
    "answer your questions along the way, and find treasures for you (only from " +
    "what you have given me access to).",
  button: "Continue",
};

export const STEPS: TourStep[] = [
  {
    target: "search",
    route: "/search",
    title: "The search bar",
    side: "bottom",
    body: "Search for anything and we'll give you direct links, just like Google Search.",
  },
  {
    target: "ask",
    route: "/chat",
    title: "Ask",
    side: "right",
    body: "Ask any question here and Badger answers from the data you have given it, with its sources.",
  },
  {
    target: "agents",
    route: "/agents",
    title: "Agents",
    side: "right",
    body:
      "Create Mini Badgers to do specific jobs for you. Each one has its own " +
      "tools and skills, you can talk to it on its own, and you can schedule it " +
      "to run when you want.",
  },
  {
    target: "tools",
    route: "/tools",
    title: "Tools",
    side: "right",
    body: "The sources Badger can reach: GitHub, Gmail and Drive. All read-only, so it can look but never change anything.",
  },
  {
    target: "skills",
    route: "/skills",
    title: "Skills",
    side: "right",
    body: "The procedures Badger follows. Each one is a file you can open, edit, or write yourself.",
  },
];

/**
 * The steps whose targets are actually on the page, in order.
 *
 * Decided ONCE when the tour starts rather than by skipping a step when its
 * target turns out to be missing. Lazy skipping produced two visible faults:
 * opening on `/agents`, where there is no home search box, the counter read
 * "2 of 5" for the first thing shown, and Back was a dead button — it moved to
 * the search step, which immediately advanced again, so pressing it did
 * nothing at all.
 *
 * Deciding up front is safe because the overlay captures clicks, so the page
 * underneath cannot change while the tour is running.
 */
export function planSteps(has: (target: TourTarget) => boolean): TourStep[] {
  return STEPS.filter((s) => has(s.target));
}

/**
 * How a step moves. Explicit, and bounded by the plan's own length rather than
 * by arithmetic over the full list, so neither end can be walked off.
 */
export function nextIndex(i: number, total: number): number | null {
  return i + 1 < total ? i + 1 : null;
}

export function prevIndex(i: number): number | null {
  return i > 0 ? i - 1 : null;
}

// Versioned, so adding a step later can be made to re-show the tour by
// bumping the key rather than by inventing a migration.
const KEY = "badger.tour.v1";

/**
 * Whether this browser has already seen the tour.
 *
 * Per browser, NOT per session: the cookie's `uid` is `randomBytes(9)` minted
 * on every sign-in (`app/server/auth.mjs`), so keying to it would replay the
 * tour every time someone entered the passphrase.
 *
 * A throw counts as seen. localStorage throws rather than returning null in
 * Safari private browsing, and a browser that cannot remember is better served
 * by never seeing the tour than by seeing it on every page load.
 */
export function tourSeen(): boolean {
  try {
    return localStorage.getItem(KEY) === "done";
  } catch {
    return true;
  }
}

/**
 * Record that the tour is over.
 *
 * `how` is not stored today — both endings write the same flag. It is a
 * parameter because reaching the end and giving up halfway are different facts
 * about the reader, and having the call sites already distinguish them means
 * recording that later is a change to this function alone.
 */
export function markTourSeen(_how: "finished" | "skipped"): void {
  try {
    localStorage.setItem(KEY, "done");
  } catch {
    // Nothing to do. `tourSeen` treats the same failure as "seen".
  }
}

/** For putting the tour back, from a console or a future menu item. */
export function resetTour(): void {
  try {
    localStorage.removeItem(KEY);
  } catch {
    // As above.
  }
}
