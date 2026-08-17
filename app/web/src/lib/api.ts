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
  /** True when this is the visitor's own connection, not the shared demo. */
  own: boolean;
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

/** Start the OAuth handshake. Composio issues the link; we only redirect. */
export async function connectGithub(): Promise<string> {
  const res = await fetch("/api/connect/github", { method: "POST" });
  const body = await res.json();
  if (!res.ok) throw new Error(body?.error ?? "could not start the connection");
  return body.redirectUrl;
}

export type Account = {
  id: string;
  status: string;
  label: string;
  login: string | null;
  createdAt: string;
};

export type AccountsResponse = { accounts: Account[]; activeId: string | null; repo: string | null };

export async function fetchAccounts(): Promise<AccountsResponse> {
  const res = await fetch("/api/accounts");
  if (!res.ok) return { accounts: [], activeId: null, repo: null };
  return await res.json();
}

export async function selectAccount(accountId: string): Promise<void> {
  const res = await fetch("/api/accounts/select", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ accountId }),
  });
  if (!res.ok) throw new Error("could not switch account");
}

export async function disconnectAccount(accountId: string): Promise<void> {
  const res = await fetch("/api/accounts/disconnect", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ accountId }),
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
