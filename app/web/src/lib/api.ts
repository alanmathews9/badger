/** The shape src/search.mjs returns. Kept in step with it by hand. */
export type SearchRow = {
  id: string;
  kind: "issue" | "pr";
  number: number;
  title: string;
  state: string;
  author: string;
  updatedAt: string;
  comments: number;
  url: string;
  snippet: string;
  /** Excerpts with matches wrapped in <hi>…</hi>, Onyx's convention. */
  matchHighlights: string[];
  matchedTerms: string[];
  matchedInDiscussionOnly: boolean;
  /** The matched comment, fetched for the top few discussion-only rows. */
  discussion: { author: string; at: string; excerpt: string } | null;
  score: number;
};

export type SearchResponse = {
  query: string;
  resolvedQuery: string;
  repo: string;
  terms: string[];
  droppedTerms: string[];
  total: number;
  tookMs: number;
  apiCalls: number;
  results: SearchRow[];
};

export type Source = {
  id: string;
  label: string;
  connected: boolean;
  detail: string;
};

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

export async function fetchSources(): Promise<Source[]> {
  const res = await fetch("/api/sources");
  if (!res.ok) return [];
  return (await res.json()).sources ?? [];
}
