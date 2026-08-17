import { useCallback, useEffect, useState } from "react";

export type Dig = {
  query: string;
  found: number;
  at: number;
};

const KEY = "badger.recentDigs";
const MAX = 5;

/**
 * "Pick up a recent dig" on Home.
 *
 * localStorage, deliberately. Real saved burrows need a per-user store, and
 * Badger has no user accounts yet — a shared demo password is the honest login
 * story for now. Anything that looks per-user before that exists would be
 * pretending. This is one browser's history and nothing more.
 */
export function useRecentDigs() {
  const [digs, setDigs] = useState<Dig[]>([]);

  useEffect(() => {
    setDigs(read());
  }, []);

  const record = useCallback((query: string, found: number) => {
    setDigs((current) => {
      const next = [
        { query, found, at: Date.now() },
        ...current.filter((d) => d.query.toLowerCase() !== query.toLowerCase()),
      ].slice(0, MAX);
      try {
        localStorage.setItem(KEY, JSON.stringify(next));
      } catch {
        // Private browsing, or a full quota. Losing search history is not
        // worth breaking the search over.
      }
      return next;
    });
  }, []);

  return { digs, record };
}

function read(): Dig[] {
  try {
    const parsed = JSON.parse(localStorage.getItem(KEY) ?? "[]");
    return Array.isArray(parsed) ? parsed.slice(0, MAX) : [];
  } catch {
    return [];
  }
}

/** "2h ago", "yesterday" — the mono timestamps from the design. */
export function relativeTime(at: number): string {
  const mins = Math.max(0, Math.round((Date.now() - at) / 60000));
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  return days === 1 ? "yesterday" : `${days}d ago`;
}
