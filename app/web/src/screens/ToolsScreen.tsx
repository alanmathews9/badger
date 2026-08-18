import { useState } from "react";
import { Settings2 } from "lucide-react";
import { BRAND_LOGOS } from "@/components/BrandLogos";
import { ManageConnections } from "@/components/ManageConnections";
import { Button } from "@/components/ui/button";
import type { SourcesResponse } from "@/lib/api";
import { cn } from "@/lib/utils";

/**
 * What Badger can reach.
 *
 * Every card is driven by `/api/sources`, which reports each source's real
 * connection state. Nothing here is special-cased by source.
 *
 * It used to be. GitHub rendered live while Drive and Gmail were hard-coded to
 * "not connected", greyed out, and wrapped in a "coming soon" tooltip — written
 * when GitHub was the only source and left in place after the other two were
 * wired up and seeded. So the page said two of the three sources were missing
 * while the agent was actively searching them, which is a worse failure than
 * showing nothing: a status display that is confidently wrong teaches you to
 * stop reading it.
 *
 * State is a dot — green connected, grey not — because the word "Connected"
 * beside a green dot says the same thing twice. Connecting lives behind one
 * Manage button in the header rather than one per card: the pane covers all
 * three sources, so three buttons opening the same dialog is three ways to
 * discover one thing.
 */

const CATALOGUE = [
  { id: "github", name: "GitHub", description: "Issues, pull requests, files and commits." },
  { id: "drive", name: "Google Drive", description: "Documents, spreadsheets and their comments." },
  { id: "gmail", name: "Gmail", description: "Threads and messages." },
];

export function ToolsScreen({
  sources,
  onRefresh,
}: {
  sources: SourcesResponse;
  onRefresh: () => void;
}) {
  const [managing, setManaging] = useState(false);

  return (
    <div className="flex h-dvh flex-col bg-white">
      <header className="flex h-14 shrink-0 items-center gap-3 border-b border-stone-200 px-4">
        <h1 className="text-[15px] font-semibold">Tools</h1>
        {sources.repo && (
          <span className="truncate font-mono text-[11px] text-stone-500">{sources.repo}</span>
        )}
        <Button
          variant="outline"
          size="sm"
          onClick={() => setManaging(true)}
          className="ml-auto h-7 shrink-0 gap-1.5 px-2.5 text-[11.5px]"
        >
          <Settings2 className="size-3" />
          Manage
        </Button>
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

                <div className="mt-4 flex items-center justify-between gap-2 border-t border-stone-100 pt-3">
                  <span className="truncate font-mono text-[10.5px] text-stone-500">
                    {source?.detail ?? "not connected"}
                  </span>
                </div>
              </div>
            );
          })}
        </div>
      </main>

      <ManageConnections open={managing} onOpenChange={setManaging} onChanged={onRefresh} />
    </div>
  );
}
