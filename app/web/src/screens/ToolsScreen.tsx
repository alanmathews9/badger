import { useEffect, useState } from "react";
import { Check, ExternalLink, Loader2, Lock } from "lucide-react";
import { BRAND_LOGOS } from "@/components/BrandLogos";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import {
  chooseRepo,
  connectGithub,
  disconnectGithub,
  fetchRepos,
  type Repo,
  type SourcesResponse,
} from "@/lib/api";
import { cn } from "@/lib/utils";

/**
 * What Badger can reach, and whose account it reads.
 *
 * Connecting is the real Composio flow: we ask for a Connect Link, hand the
 * browser to GitHub, and Composio holds the resulting token. Badger never sees
 * a GitHub credential — which is the reason the integration layer exists, and
 * the reason this page can exist at all without becoming a place that stores
 * other people's secrets.
 *
 * Unbuilt integrations render disabled with a "coming soon" tooltip rather than
 * hidden: the roadmap is part of the pitch, and a missing card reads as an
 * oversight rather than a decision.
 */

const CATALOGUE = [
  { id: "github", name: "GitHub", description: "Issues, pull requests, files and commits." },
  { id: "drive", name: "Google Drive", description: "Docs, sheets and slides." },
  { id: "gmail", name: "Gmail", description: "Threads and attachments." },
];

export function ToolsScreen({
  sources,
  onRefresh,
}: {
  sources: SourcesResponse;
  onRefresh: () => void;
}) {
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [repos, setRepos] = useState<Repo[] | null>(null);

  const own = sources.mode === "own";

  // Only a visitor with their own connection needs to pick a repository — the
  // demo corpus is a single known repo.
  useEffect(() => {
    if (!own) return;
    fetchRepos()
      .then(setRepos)
      .catch((e) => setError(e.message));
  }, [own]);

  const connect = async () => {
    setBusy("connect");
    setError(null);
    try {
      // A full navigation, not a popup: GitHub's consent screen refuses to be
      // framed, and a blocked popup is indistinguishable from a broken button.
      window.location.href = await connectGithub();
    } catch (e) {
      setError(e instanceof Error ? e.message : "could not connect");
      setBusy(null);
    }
  };

  const disconnect = async () => {
    setBusy("disconnect");
    setError(null);
    try {
      await disconnectGithub();
      setRepos(null);
      onRefresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "could not disconnect");
    } finally {
      setBusy(null);
    }
  };

  const pick = async (slug: string) => {
    setBusy(slug);
    try {
      await chooseRepo(slug);
      onRefresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "could not select");
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="flex h-dvh flex-col bg-white">
      <header className="flex h-14 shrink-0 items-center gap-3 border-b border-stone-200 px-4">
        <h1 className="text-[15px] font-semibold">Tools</h1>
        <span className="font-mono text-[11px] text-stone-500">
          {sources.mode === "own"
            ? "your GitHub"
            : sources.mode === "demo"
              ? "shared demo corpus"
              : "nothing connected"}
        </span>
      </header>

      <main className="min-h-0 flex-1 overflow-y-auto px-6 py-6">
        <div className="max-w-[1100px]">
          {error && (
            <div className="mb-4 rounded-lg border border-amber-200 bg-amber-50 px-3.5 py-2.5 text-[12.5px] text-amber-900">
              {error}
            </div>
          )}

          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {CATALOGUE.map((tool) => {
              const source = sources.sources.find((s) => s.id === tool.id);
              const isGithub = tool.id === "github";
              const connected = Boolean(source?.connected);
              const Logo = BRAND_LOGOS[tool.id];

              const card = (
                <div
                  className={cn(
                    "flex h-full flex-col rounded-xl border border-stone-200 p-4",
                    isGithub ? "bg-white" : "bg-stone-50/60",
                  )}
                >
                  <div className="flex items-start justify-between">
                    <span
                      className={cn(
                        "inline-flex size-10 items-center justify-center rounded-lg border border-stone-200 bg-white",
                        !isGithub && "opacity-45 grayscale",
                      )}
                    >
                      <Logo size={22} />
                    </span>
                    {isGithub ? (
                      own ? (
                        <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2 py-0.5 text-[10.5px] font-medium text-emerald-700">
                          <Check className="size-3" strokeWidth={2.5} />
                          Your account
                        </span>
                      ) : (
                        <span className="rounded-full border border-stone-200 px-2 py-0.5 font-mono text-[10px] text-stone-500">
                          {connected ? "demo" : "not connected"}
                        </span>
                      )
                    ) : (
                      <span className="rounded-full border border-stone-200 px-2 py-0.5 font-mono text-[10px] text-stone-400">
                        soon
                      </span>
                    )}
                  </div>

                  <h2
                    className={cn(
                      "mt-3 text-[15px] font-semibold",
                      isGithub ? "text-stone-900" : "text-stone-500",
                    )}
                  >
                    {tool.name}
                  </h2>
                  <p
                    className={cn(
                      "mt-1.5 flex-1 text-[12.5px]/[1.6]",
                      isGithub ? "text-stone-600" : "text-stone-400",
                    )}
                  >
                    {tool.description}
                  </p>

                  <div className="mt-4 border-t border-stone-100 pt-3">
                    {isGithub ? (
                      own ? (
                        <div className="flex items-center justify-between gap-2">
                          <span className="truncate font-mono text-[10.5px] text-stone-500">
                            {sources.repo ?? "choose a repository below"}
                          </span>
                          <button
                            onClick={disconnect}
                            disabled={busy === "disconnect"}
                            className="shrink-0 text-[11.5px] font-medium text-stone-500 hover:text-stone-900 disabled:opacity-50"
                          >
                            {busy === "disconnect" ? "Disconnecting…" : "Disconnect"}
                          </button>
                        </div>
                      ) : (
                        <div className="flex items-center justify-between gap-2">
                          <span className="truncate font-mono text-[10.5px] text-stone-500">
                            {connected ? sources.repo : "read-only"}
                          </span>
                          <Button
                            size="sm"
                            onClick={connect}
                            disabled={busy === "connect"}
                            className="h-7 shrink-0 gap-1.5 px-2.5 text-[11.5px]"
                          >
                            {busy === "connect" ? (
                              <Loader2 className="size-3 animate-spin" />
                            ) : (
                              <ExternalLink className="size-3" />
                            )}
                            Connect yours
                          </Button>
                        </div>
                      )
                    ) : (
                      <span className="font-mono text-[10.5px] text-stone-400">not connected</span>
                    )}
                  </div>
                </div>
              );

              return isGithub ? (
                <div key={tool.id}>{card}</div>
              ) : (
                <Tooltip key={tool.id}>
                  <TooltipTrigger asChild>
                    <div className="cursor-not-allowed">{card}</div>
                  </TooltipTrigger>
                  <TooltipContent>Coming soon</TooltipContent>
                </Tooltip>
              );
            })}
          </div>

          {sources.mode === "demo" && (
            <p className="mt-5 max-w-[620px] text-[12.5px]/[1.7] text-stone-500">
              You are searching a shared demo corpus — a fictional consultancy's private repo.
              Connect your own GitHub to search yours instead. Badger never receives your token;
              Composio holds it, and the connection is scoped to this browser session.
            </p>
          )}

          {own && (
            <section className="mt-8">
              <h2 className="font-mono text-[10px] tracking-[0.1em] text-stone-500 uppercase">
                Repository to search
              </h2>
              {repos === null ? (
                <p className="mt-3 flex items-center gap-2 text-[12.5px] text-stone-500">
                  <Loader2 className="size-3.5 animate-spin" />
                  Reading your repositories…
                </p>
              ) : repos.length === 0 ? (
                <p className="mt-3 text-[12.5px] text-stone-500">
                  No repositories visible to this connection.
                </p>
              ) : (
                <div className="mt-3 grid max-w-[820px] gap-1.5 sm:grid-cols-2">
                  {repos.map((repo) => (
                    <button
                      key={repo.slug}
                      onClick={() => pick(repo.slug)}
                      disabled={busy === repo.slug}
                      className={cn(
                        "flex items-center gap-2 rounded-lg border px-3 py-2 text-left transition-colors",
                        sources.repo === repo.slug
                          ? "border-stone-900 bg-stone-50"
                          : "border-stone-200 hover:border-stone-300",
                      )}
                    >
                      {repo.private && <Lock className="size-3 shrink-0 text-stone-400" />}
                      <span className="truncate text-[12.5px] text-stone-800">{repo.slug}</span>
                      <span className="ml-auto shrink-0 font-mono text-[10px] text-stone-400">
                        {repo.updatedAt}
                      </span>
                    </button>
                  ))}
                </div>
              )}
            </section>
          )}
        </div>
      </main>
    </div>
  );
}
