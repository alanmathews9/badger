import { BRAND_LOGOS } from "@/components/BrandLogos";
import type { SourceId, SourcesResponse } from "@/lib/api";
import { cn } from "@/lib/utils";

/**
 * What Badger can reach, and whose account it reaches it as.
 *
 * Every card is driven by `/api/sources`, which reports each source's real
 * connection state and the identity behind it.
 *
 * It used not to be. GitHub rendered live while Drive and Gmail were hard-coded
 * to "not connected", greyed out and wrapped in a "coming soon" tooltip —
 * written when GitHub was the only source and left in place after the other two
 * were wired up and seeded. A status display that is confidently wrong is worse
 * than one that says nothing: it teaches you to stop reading it.
 *
 * **The account is the useful line, not the connection state.** "Connected"
 * does not tell you whether Badger is reading the right mailbox, so each card
 * names the account it is connected as. Only the one-line description is local
 * copy; the name, the state and the account all come from the server.
 *
 * There is no Manage pane. This build searches a seeded corpus by design, so a
 * button offering to reconnect it was offering to break it.
 */

/** What each source contributes. UI copy, and the only thing hardcoded here. */
const DESCRIPTIONS: Record<SourceId, string> = {
  github: "Issues, pull requests, files and commits.",
  drive: "Documents, spreadsheets and their comments.",
  gmail: "Threads and messages.",
};

/** Fixed order, so the cards do not reshuffle when a source reconnects. */
const ORDER: SourceId[] = ["github", "drive", "gmail"];

export function ToolsScreen({ sources }: { sources: SourcesResponse }) {
  const cards = ORDER.map((id) => sources.sources.find((s) => s.id === id)).filter(
    (s): s is NonNullable<typeof s> => Boolean(s),
  );

  return (
    <div className="flex h-dvh flex-col bg-white">
      <header className="flex h-14 shrink-0 items-center gap-3 border-b border-stone-200 px-6">
        <h1 className="text-[15px] font-semibold">Tools</h1>
      </header>

      <main className="min-h-0 flex-1 overflow-y-auto px-6 py-6">
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {cards.map((source) => {
            const Logo = BRAND_LOGOS[source.id];
            return (
              <div
                key={source.id}
                className="flex h-full flex-col rounded-xl border border-stone-200 bg-white p-4"
              >
                <div className="flex items-start justify-between">
                  <span className="inline-flex size-10 items-center justify-center rounded-lg border border-stone-200 bg-white">
                    <Logo size={22} />
                  </span>
                  <span
                    className={cn(
                      "mt-1 size-2 rounded-full",
                      source.connected ? "bg-emerald-500" : "bg-stone-300",
                    )}
                    title={source.connected ? "Connected" : "Not connected"}
                  />
                </div>

                <h2 className="mt-3 text-[15px] font-semibold text-stone-900">{source.label}</h2>
                <p className="mt-1.5 flex-1 text-[12.5px]/[1.6] text-stone-600">
                  {DESCRIPTIONS[source.id]}
                </p>

                <div className="mt-4 border-t border-stone-100 pt-3">
                  <div className="truncate font-mono text-[10.5px] text-stone-600">
                    {/* GitHub logins are written with an @ everywhere GitHub
                        writes them; the Google addresses are already
                        unambiguous and are left alone. */}
                    {source.account
                      ? source.id === "github"
                        ? `@${source.account}`
                        : source.account
                      : "not connected"}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </main>
    </div>
  );
}
