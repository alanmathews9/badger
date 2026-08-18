import { useCallback, useEffect, useState } from "react";

export type Dig = { query: string; at: number };

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

  const record = useCallback((query: string) => {
    setDigs((current) => {
      const next = [
        { query, at: Date.now() },
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
