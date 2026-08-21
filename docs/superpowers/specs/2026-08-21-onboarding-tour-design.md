# Onboarding tour — design

**Date:** 2026-08-21
**Status:** approved, building on branch `onboarding`

## What this is

A five-step spotlight tour, opened by a welcome dialog, shown the first time
someone reaches the app in a given browser. It points at the real search bar
and the real sidebar rows for Ask, Agents, Tools and Skills.

## Research: nobody to copy

Three products were checked for a reference implementation.

- **Onyx** (`onyx-dot-app/onyx`) is the only one with onboarding, at
  `web/src/sections/onboarding/`. It is a **setup wizard** — name, then LLM
  provider, then done — rendered inline on the page. Not a tour.
- **LlamaIndex** (`run-llama`) has none.
- **Lyzr** (`LyzrCore`) has none in open source.
- No `react-joyride`, `driver.js` or `intro.js` in any of them.

Three things are taken from Onyx anyway:

1. Completion is a **namespaced versioned key**, not a bare boolean.
2. Navigation is an explicit `{next, prev}` map per step, not index arithmetic
   over an array, so a skipped step cannot walk off the end.
3. **Hide and finish are separate actions.** Both write the flag; only one is
   the reader saying they read it. Keeping them apart means the distinction is
   available later without a migration.

## Why a spotlight and not a modal carousel

Every target is on screen at the same time: the sidebar carries Ask, Agents,
Tools and Skills, and the home search bar sits beside it. So a spotlight needs
no scrolling and no illustrations, and every target stays put while the page
behind it changes.

A carousel would need five drawings of the UI. Those go stale the moment the
sidebar changes, and this repository has already been bitten four times by an
indicator that was written once and never seen wrong (the hardcoded
"not connected" marks, the "coming soon" tooltip, the green dot that could not
turn another colour, the citation verifier that could not fail). A spotlight
cannot drift, because it reads the element's own rectangle.

## Scope

**Nothing on the server changes.** `/api/login` already answers 303 to `/`,
which redirects to `/search`. The flag is per browser. So `splash.mjs`,
`auth.mjs` and `server.mjs` are untouched, and the feature cannot break the
gate.

New:

- `app/web/src/lib/onboarding.ts` — the step list, the storage flag.
- `app/web/src/components/onboarding/Tour.tsx` — the overlay.

Touched:

- `App.tsx` — mounts `<Tour/>` once, above the routes.
- `AppSidebar.tsx`, `SearchScreen.tsx` — one `data-tour` attribute per target.

## Targets

Targets are found by `data-tour` attribute, not by refs threaded through props.
Refs would add a prop to `AppSidebar` and `SearchScreen` for something neither
component cares about, and every intermediate component would have to forward
it. The attribute values and the step ids come from the same const, so the
stringly-typed lookup is generated from a typed source.

**The itinerary is fixed once, when the tour starts, rather than by skipping a
step whose target turns out to be missing.** Lazy skipping was written first
and produced two faults visible in the browser: starting anywhere without a
home search box, the counter read "2 of 5" for the first thing shown, and Back
was a dead button — it moved to the search step, which immediately advanced
again, so pressing it did nothing at all.

The case is real rather than defensive: `[data-tour="search"]` only exists on
the home state of `/search`, and once a search has run the home box is replaced
by the compact one in the header. Then the walk is genuinely four steps and
says so. Fixing the plan up front is safe because the overlay captures clicks,
so the page underneath cannot change except where the tour changes it.

## Each step opens its own page

A step describing a destination shows that destination: reading about Agents
over an empty search screen is a description, reading it over the actual grid
of Mini Badgers is the thing itself. Each step carries a `route`, and entering
it navigates there with `replace: true` — this is the tour moving, not the
reader, so it has no business in the back button.

**The itinerary is counted in an effect, never from a
`requestAnimationFrame`.** rAF is starved in a tab that is not foreground, so
an intermediate version froze on the welcome card for anyone who pressed
Continue and switched tabs. An effect runs after the commit whatever the tab is
doing, and by then the route has rendered, which is the only reason a frame was
wanted. Reproduced with `document.hidden === true` before and after.

## The overlay

One fixed-position element. A transparent rounded box is positioned at the
target's `getBoundingClientRect()`, and `box-shadow: 0 0 0 9999px rgba(...)`
does the dimming, so the cut-out is free and follows the same border radius.

- The rect is measured in a layout effect, on step change and on resize.
- The overlay captures clicks, so nothing behind it can be pressed mid-tour.
- Escape dismisses.
- The tooltip is positioned from the rect and clamped to the viewport.

## Steps

| # | Target | Gist |
|---|---|---|
| — | none | Welcome dialog, large, the mark on nothing. Button: Continue |
| 1 | search box | direct links, like Google Search |
| 2 | Ask | questions answered from your data |
| 3 | Agents | Mini Badgers, talk to each alone, schedule them |
| 4 | Tools | the sources it can reach, all read-only |
| 5 | Skills | the procedures it follows, each one a file |

Every step carries a `n of 5` counter, a quiet Skip, and a pair of **arrows**
rather than the words Back and Next — a step is a position in a sequence, which
is what an arrow says and what "Back" only implies. The left arrow is rendered
disabled rather than hidden on the first step, so the pair does not reflow as
the walk moves, and the arrow KEYS do the same thing.

The welcome dialog has **no Skip**. Escape and a click on the ground both leave,
and a dismiss control on the first thing a new reader sees competes with the one
action worth taking.

The last step's button reads **Start digging!** — it returns to /search and
focuses the box. It deliberately does **not** prefill a question: a query the
reader did not type, sitting in their box, is a fake. The return is necessary
now that steps navigate: the walk ends on /skills, where there is no search box
to focus.

## Storage

`badger.tour.v1` in `localStorage`, holding `"done"`. Not keyed to the session
cookie's `uid`: that is `randomBytes(9)` minted per sign-in, so keying to it
would replay the tour on every login.

Reads and writes are wrapped, because `localStorage` throws rather than
returning null in Safari private browsing. A throw is treated as "seen" so a
browser that cannot remember does not show the tour on every page load.

## Verification

The web app has no test runner. Verification is `tsc -b`, `oxlint`, and a real
browser against a server this session starts itself on a free port — checking
that each of the five targets is actually lit, that Escape and Skip both end
it, and that a reload does not replay it.
