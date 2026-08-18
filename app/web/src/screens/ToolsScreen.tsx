import { BRAND_LOGOS } from "@/components/BrandLogos";
import type { SourcesResponse } from "@/lib/api";
import { cn } from "@/lib/utils";

/**
 * What Badger can reach, and whose account it reaches it as.
 *
 * Every card is driven by `/api/sources`, which reports each source's real
 * connection state and the identity behind it. Nothing is special-cased by
 * source.
 *
 * It used to be. GitHub rendered live while Drive and Gmail were hard-coded to
 * "not connected", greyed out and wrapped in a "coming soon" tooltip — written
 * when GitHub was the only source and left in place after the other two were
 * wired up and seeded. A status display that is confidently wrong is worse than
 * one that says nothing: it teaches you to stop reading it.
 *
 * **The account is the useful line, not the connection state.** "Connected"
 * does not tell you whether Badger is reading the right mailbox. So each card
 * names the account it is connected as, and nothing else: a repository slug is
 * a scope rather than an identity, and one account reaches many repositories.
 *
 * GitHub logins are prefixed with @ because that is how GitHub writes them
 * everywhere else; the Google addresses are already unambiguous and are left
 * alone. Both come from /api/sources — nothing here is hard-coded.
 *
 * There is no Manage pane. Connecting your own accounts is a real capability
 * and the endpoints are still there, but this build searches a seeded corpus by
 * design, so a button offering to reconnect it was offering to break it.
 */

const CATALOGUE = [
  { id: "github", name: "GitHub", description: "Issues, pull requests, files and commits." },
  { id: "drive", name: "Google Drive", description: "Documents, spreadsheets and their comments." },
  { id: "gmail", name: "Gmail", description: "Threads and messages." },
];

export function ToolsScreen({ sources }: { sources: SourcesResponse }) {
  return (
    <div className="flex h-dvh flex-col bg-white">
      <header className="flex h-14 shrink-0 items-center gap-3 border-b border-stone-200 px-4">
        <h1 className="text-[15px] font-semibold">Tools</h1>
      </header>

      <main className="min-h-0 flex-1 overflow-y-auto px-6 py-6">
        <div className="grid max-w-[1100px] gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {CATALOGUE.map((tool) => {
            const source = sources.sources.find((s) => s.id === tool.id);
            const connected = Boolean(source?.connected);
            const Logo = BRAND_LOGOS[tool.id];

            return (
              <div
                key={tool.id}
                className="flex h-full flex-col rounded-xl border border-stone-200 bg-white p-4"
              >
                <div className="flex items-start justify-between">
                  <span className="inline-flex size-10 items-center justify-center rounded-lg border border-stone-200 bg-white">
                    <Logo size={22} />
                  </span>
                  <span
                    className={cn(
                      "mt-1 size-2 rounded-full",
                      connected ? "bg-emerald-500" : "bg-stone-300",
                    )}
                    title={connected ? "Connected" : "Not connected"}
                  />
                </div>

                <h2 className="mt-3 text-[15px] font-semibold text-stone-900">{tool.name}</h2>
                <p className="mt-1.5 flex-1 text-[12.5px]/[1.6] text-stone-600">
                  {tool.description}
                </p>

                <div className="mt-4 border-t border-stone-100 pt-3">
                  <div className="truncate font-mono text-[10.5px] text-stone-600">
                    {source?.account
                      ? tool.id === "github"
                        ? `@${source.account}`
                        : source.account
                      : connected
                        ? "connected"
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
