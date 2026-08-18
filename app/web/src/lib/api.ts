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
  /** Excerpts with matches wrapped in <hi>…</hi>, Onyx's convention. */
  matchHighlights: string[];
  matchedTerms: string[];
  matchedInDiscussionOnly: boolean;
  /** The matched comment, fetched for the top few discussion-only rows. */
  discussion: { author: string; at: string; excerpt: string } | null;
  score: number;
  /** Gmail only — lets a row link through to the whole exchange. */
  threadId?: string | null;
  /** Drive only. */
  fileId?: string;
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
  resolvedQuery: string;
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
  id: string;
  label: string;
  connected: boolean;
  own: boolean;
  /** Whose account: a GitHub login, or the Google address behind Gmail/Drive. */
  account: string | null;
  /** GitHub only — the repository searches are scoped to. */
  repo: string | null;
  detail: string;
};

/** Whose data a search will read: their own, the shared demo, or nothing yet. */
export type SourceMode = "own" | "demo" | "none";

export type SourcesResponse = { mode: SourceMode; repo: string | null; sources: Source[] };

export type Repo = { slug: string; private: boolean; updatedAt: string };

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
  if (!res.ok) return { mode: "none", repo: null, sources: [] };
  return await res.json();
}

/** Which sources this visitor has connected. One connection per source. */
export type ConnectionSource = {
  id: "github" | "gmail" | "googledrive";
  label: string;
  connected: boolean;
  connectedAt: string | null;
};

export type ConnectionsResponse = {
  mode: SourceMode;
  repo: string | null;
  /** The GitHub login, once one is connected. */
  login: string | null;
  sources: ConnectionSource[];
};

export async function fetchConnections(): Promise<ConnectionsResponse> {
  const res = await fetch("/api/connections");
  if (!res.ok) return { mode: "none", repo: null, login: null, sources: [] };
  return await res.json();
}

/**
 * Start the OAuth handshake for one source. Composio issues the link; we only
 * redirect. Fails with 409 if that source is already connected — disconnect
 * first, because a second connection cannot be targeted.
 */
export async function connectSource(toolkit: ConnectionSource["id"]): Promise<string> {
  const res = await fetch("/api/connect", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ toolkit }),
  });
  const body = await res.json();
  if (!res.ok) throw new Error(body?.error ?? "could not start the connection");
  return body.redirectUrl;
}

export async function disconnectSource(toolkit: ConnectionSource["id"]): Promise<void> {
  const res = await fetch("/api/connections/disconnect", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ toolkit }),
  });
  if (!res.ok) throw new Error("could not disconnect");
}

export async function fetchRepos(): Promise<Repo[]> {
  const res = await fetch("/api/repos");
  const body = await res.json();
  if (!res.ok) throw new Error(body?.error ?? "could not list repositories");
  return body.repos ?? [];
}

export async function chooseRepo(repo: string): Promise<void> {
  const res = await fetch("/api/repos", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ repo }),
  });
  if (!res.ok) throw new Error("could not select that repository");
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
