/** Which system a row came from. */
export type SourceId = "github" | "gmail" | "drive";

/** The shape app/server/search.mjs returns. Kept in step with it by hand. */
export type SearchRow = {
  id: string;
  source: SourceId;
  /** issue/pr from GitHub, mail from Gmail, doc/sheet from Drive. */
  kind: "issue" | "pr" | "mail" | "doc" | "sheet" | "file";
  /** GitHub only — mail and documents have no number. */
  number: number | null;
  title: string;
  state: string;
  author: string;
  updatedAt: string;
  comments: number;
  url: string;
  snippet: string;
  /** The title with matches wrapped in <hi>…</hi>, marked server-side. */
  titleMarked: string;
  /** Excerpts with matches wrapped in <hi>…</hi>, Onyx's convention. */
  matchHighlights: string[];
  matchedInDiscussionOnly: boolean;
  /** The matched comment, fetched for the top few discussion-only rows. */
  discussion: { author: string; at: string; excerpt: string } | null;
  /** The locally computed rank. Ordering only — never rendered. */
  score: number;
};

/**
 * Per-source outcome. A source that failed is reported rather than omitted:
 * "Drive was not reached" and "Drive found nothing" are different facts, and a
 * search UI that conflates them is lying by omission.
 */
export type SourceOutcome = {
  ok: boolean;
  count: number;
  total?: number;
  resolvedQuery?: string;
  error?: string;
};

export type SearchResponse = {
  query: string;
  repo: string;
  terms: string[];
  droppedTerms: string[];
  total: number;
  tookMs: number;
  apiCalls: number;
  /** Keyed by source id. Always present for every source attempted. */
  sources: Partial<Record<SourceId, SourceOutcome>>;
  results: SearchRow[];
};

export type Source = {
  id: SourceId;
  label: string;
  connected: boolean;
  /** Whose account: a GitHub login, or the Google address behind Gmail/Drive. */
  account: string | null;
};

/** Whose data a search reads. "none" only when the demo fallback is off. */
export type SourceMode = "demo" | "none";

export type SourcesResponse = { mode: SourceMode; sources: Source[] };

export async function search(query: string, limit = 20): Promise<SearchResponse> {
  const res = await fetch("/api/search", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ query, limit }),
  });
  const body = await res.json();
  // The server distinguishes "we looked and found nothing" from "we could not
  // look" — a rate limit arrives as 429 with a message saying so. Surfacing
  // that text is the whole point of it existing.
  if (!res.ok) throw new Error(body?.error ?? `search failed (${res.status})`);
  return body;
}

export async function fetchSources(): Promise<SourcesResponse> {
  const res = await fetch("/api/sources");
  if (!res.ok) return { mode: "none", sources: [] };
  return await res.json();
}

export type Budget = { answersToday: number; answersRemaining: number; running: number };

/** The live answer budget, shown in the sidebar. Public and carries no data. */
export async function fetchBudget(): Promise<Budget | null> {
  try {
    const res = await fetch("/api/health");
    if (!res.ok) return null;
    const body = await res.json();
    return {
      answersToday: body.answersToday ?? 0,
      answersRemaining: body.answersRemaining ?? 0,
      running: body.running ?? 0,
    };
  } catch {
    return null;
  }
}
