// Chat and search history, behind one interface.
//
// One interface for both, so moving the data is a swap of one module rather
// than an edit to every caller.
//
// ASYNC ON PURPOSE even where the implementation is synchronous: an interface
// that returns values today and promises tomorrow is a rewrite of every call
// site. The cost of being early is a handful of `await`s.
//
// The store is per browser. The session cookie's `uid` is random with no
// account behind it (`auth.mjs`), so "your history" means "this browser's
// history" and the UI must not imply otherwise.
import type { ChatTurn } from "@/screens/ChatScreen";

/** Enough to list a conversation without loading its turns. */
export type ChatSummary = {
  id: string;
  /** The first question — how a person recognises a conversation. */
  title: string;
  /**
   * The sub-agent whose Playground this conversation belongs to, or null for
   * a thread in /chat. Fixed when the conversation starts.
   */
  agent?: string | null;
  updatedAt: number;
};

export type StoredChat = ChatSummary & { turns: ChatTurn[] };

/** One past search, as the sidebar lists it. */
export type SearchEntry = { query: string; at: number };

/**
 * What a search turned out to cost, recorded alongside the query.
 *
 * Not stored so it can be replayed — re-running is the reply, which is why no
 * results are kept. Stored because `path` in particular is the one fact that
 * makes a history entry judgeable later: the index and the live sources
 * disagree between refreshes, and a record that hid which one answered would
 * be another indicator nobody can see be wrong.
 */
export type SearchFacts = {
  resultCount?: number;
  path?: "index" | "live";
  tookMs?: number;
  apiCalls?: number;
};

export interface HistoryStore {
  /** `agent` partitions the list: null is /chat, a slug is that Playground. */
  listChats(agent?: string | null): Promise<ChatSummary[]>;
  getChat(id: string): Promise<StoredChat | null>;
  saveChat(chat: StoredChat): Promise<void>;
  listSearches(): Promise<SearchEntry[]>;
  recordSearch(query: string, facts?: SearchFacts): Promise<void>;
}

const CHATS_KEY = "badger.chats.v1";
const SEARCHES_KEY = "badger.recentDigs";
const KEEP_CHATS = 20;
const KEEP_SEARCHES = 8;

function read<T>(key: string): T[] {
  try {
    const parsed = JSON.parse(localStorage.getItem(key) ?? "[]");
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function write(key: string, value: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Quota, or private browsing. Losing history is never worth breaking the
    // thing that produced it.
  }
}

/**
 * The browser-local store. Everything lives in this one module, so the server
 * implementation replaces it without touching a component.
 */
export const localHistory: HistoryStore = {
  async listChats(agent = null) {
    return read<StoredChat>(CHATS_KEY)
      .filter((c) => (c.agent ?? null) === agent)
      .map(({ id, title, updatedAt }) => ({ id, title, agent, updatedAt }));
  },

  async getChat(id) {
    return read<StoredChat>(CHATS_KEY).find((c) => c.id === id) ?? null;
  },

  async saveChat(chat) {
    const rest = read<StoredChat>(CHATS_KEY).filter((c) => c.id !== chat.id);
    write(CHATS_KEY, [chat, ...rest].slice(0, KEEP_CHATS));
  },

  async listSearches() {
    return read<SearchEntry>(SEARCHES_KEY).slice(0, KEEP_SEARCHES);
  },

  // The browser store keeps the query alone: the facts exist to be queried
  // across many searches, which localStorage cannot do anyway.
  async recordSearch(query) {
    const rest = read<SearchEntry>(SEARCHES_KEY).filter(
      (entry) => entry.query.toLowerCase() !== query.toLowerCase(),
    );
    write(SEARCHES_KEY, [{ query, at: Date.now() }, ...rest].slice(0, KEEP_SEARCHES));
  },
};

/**
 * The server-backed store.
 *
 * Every method is written so a failure degrades rather than throws: the
 * conversation you are having matters more than the record of it. A network
 * blip loses a save, not the answer on screen.
 */
const serverHistory: HistoryStore = {
  async listChats(agent = null) {
    const query = agent ? `?agent=${encodeURIComponent(agent)}` : "";
    const body = await get<{ chats: ChatSummary[] }>(`/api/chats${query}`);
    return body?.chats ?? [];
  },

  async getChat(id) {
    const body = await get<{ chat: StoredChat | null }>(`/api/chats/${id}`);
    return body?.chat ?? null;
  },

  async saveChat(chat) {
    await send(`/api/chats/${chat.id}`, "PUT", {
      title: chat.title,
      turns: chat.turns,
      agent: chat.agent ?? null,
    });
  },

  async listSearches() {
    const body = await get<{ searches: SearchEntry[] }>("/api/searches");
    return body?.searches ?? [];
  },

  async recordSearch(query, facts) {
    await send("/api/searches", "POST", { query, ...facts });
  },
};

async function get<T>(url: string): Promise<T | null> {
  try {
    const response = await fetch(url);
    return response.ok ? ((await response.json()) as T) : null;
  } catch {
    return null;
  }
}

async function send(url: string, method: string, body: unknown) {
  try {
    await fetch(url, {
      method,
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
  } catch {
    // See above: a lost write must never surface as a broken screen.
  }
}

/**
 * Which store is in play, decided once by asking the server.
 *
 * The server answers `persisted: false` when it has no database — the
 * localhost case, and any clone of this repo running with nothing but a
 * Composio key. That is a supported configuration rather than a degraded one,
 * so the client silently keeps its history in the browser instead.
 *
 * Probed with the request we were going to make anyway, and memoised, so this
 * costs nothing beyond the first call.
 */
let chosen: Promise<HistoryStore> | null = null;

function store(): Promise<HistoryStore> {
  chosen ??= fetch("/api/chats")
    .then(async (response) => {
      if (!response.ok) return localHistory;
      const body = (await response.json()) as { persisted?: boolean };
      return body.persisted ? serverHistory : localHistory;
    })
    .catch(() => localHistory);
  return chosen;
}

/** The store the app uses. Resolves to the server's when there is one. */
export const history: HistoryStore = {
  listChats: async (agent = null) => (await store()).listChats(agent),
  getChat: async (id) => (await store()).getChat(id),
  saveChat: async (chat) => (await store()).saveChat(chat),
  listSearches: async () => (await store()).listSearches(),
  recordSearch: async (query, facts) => (await store()).recordSearch(query, facts),
};

/** Ids are URL path segments (`/chat/<id>`), so keep them short and opaque. */
export function newChatId(): string {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}
