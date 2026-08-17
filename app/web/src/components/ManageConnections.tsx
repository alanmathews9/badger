import { useCallback, useEffect, useState } from "react";
import { Check, ExternalLink, Loader2, Trash2 } from "lucide-react";
import { DriveLogo, GitHubLogo, GmailLogo } from "./BrandLogos";
import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import {
  chooseRepo,
  connectSource,
  disconnectSource,
  fetchConnections,
  fetchRepos,
  type ConnectionSource,
  type Repo,
} from "@/lib/api";
import { cn } from "@/lib/utils";

/**
 * Connect and disconnect Badger's three sources.
 *
 * A side pane rather than a page: connecting is something you do once and then
 * forget, and it should not cost you the search you were in the middle of.
 *
 * **One connection per source.** This pane used to offer several accounts per
 * source with a picker, and the picker did nothing — Composio's per-call
 * account selection is disabled on this project, so every tool call went to
 * whichever connection it resolved, regardless of what was selected. Worse,
 * each account was labelled by asking "who are you?" through that same
 * resolution, so two accounts appeared under one name. Connecting a second
 * account is now refused rather than silently taking over; disconnect to
 * switch.
 */
const LOGOS: Record<ConnectionSource["id"], typeof GitHubLogo> = {
  github: GitHubLogo,
  gmail: GmailLogo,
  googledrive: DriveLogo,
};

export function ManageConnections({
  open,
  onOpenChange,
  onChanged,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onChanged: () => void;
}) {
  const [sources, setSources] = useState<ConnectionSource[] | null>(null);
  const [login, setLogin] = useState<string | null>(null);
  const [repo, setRepo] = useState<string | null>(null);
  const [repos, setRepos] = useState<Repo[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const data = await fetchConnections();
      setSources(data.sources);
      setLogin(data.login);
      setRepo(data.repo);
      if (data.sources.find((s) => s.id === "github")?.connected) {
        fetchRepos()
          .then(setRepos)
          .catch(() => setRepos([]));
      } else {
        setRepos(null);
      }
    } catch {
      setError("Could not read your connections.");
    }
  }, []);

  useEffect(() => {
    if (open) void load();
  }, [open, load]);

  async function onConnect(id: ConnectionSource["id"]) {
    setBusy(id);
    setError(null);
    try {
      window.location.href = await connectSource(id);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not start the connection.");
      setBusy(null);
    }
  }

  async function onDisconnect(id: ConnectionSource["id"]) {
    setBusy(id);
    setError(null);
    try {
      await disconnectSource(id);
      await load();
      onChanged();
    } catch {
      setError("Could not disconnect.");
    } finally {
      setBusy(null);
    }
  }

  async function onChooseRepo(slug: string) {
    setBusy(slug);
    try {
      await chooseRepo(slug);
      setRepo(slug);
      onChanged();
    } catch {
      setError("Could not select that repository.");
    } finally {
      setBusy(null);
    }
  }

  const githubConnected = sources?.find((s) => s.id === "github")?.connected ?? false;

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="w-full overflow-y-auto sm:max-w-md">
        <SheetHeader>
          <SheetTitle>Your connections</SheetTitle>
          <SheetDescription>
            Badger reads these as you, and never more than you can see. One account per
            source — disconnect to switch.
          </SheetDescription>
        </SheetHeader>

        <div className="flex flex-col gap-6 px-4 pb-8">
          {error && (
            <p className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-[13px] text-amber-900">
              {error}
            </p>
          )}

          <ul className="flex flex-col gap-2">
            {(sources ?? []).map((source) => {
              const Logo = LOGOS[source.id];
              const working = busy === source.id;
              return (
                <li
                  key={source.id}
                  className="flex items-center gap-3 rounded-lg border border-stone-200 px-3 py-2.5"
                >
                  <Logo size={18} />
                  <div className="min-w-0 flex-1">
                    <p className="text-[13.5px] font-medium">{source.label}</p>
                    <p className="truncate font-mono text-[11px] text-stone-500">
                      {source.connected
                        ? source.id === "github" && login
                          ? `@${login}`
                          : `connected ${source.connectedAt ?? ""}`.trim()
                        : "not connected"}
                    </p>
                  </div>
                  {source.connected ? (
                    <Button
                      variant="ghost"
                      size="sm"
                      disabled={working}
                      onClick={() => onDisconnect(source.id)}
                      aria-label={`Disconnect ${source.label}`}
                    >
                      {working ? (
                        <Loader2 className="size-3.5 animate-spin" />
                      ) : (
                        <Trash2 className="size-3.5" />
                      )}
                    </Button>
                  ) : (
                    <Button size="sm" disabled={working} onClick={() => onConnect(source.id)}>
                      {working ? (
                        <Loader2 className="size-3.5 animate-spin" />
                      ) : (
                        <>
                          Connect <ExternalLink className="size-3" />
                        </>
                      )}
                    </Button>
                  )}
                </li>
              );
            })}
            {sources === null && (
              <li className="flex items-center gap-2 px-1 py-3 text-[13px] text-stone-500">
                <Loader2 className="size-3.5 animate-spin" /> Reading your connections…
              </li>
            )}
          </ul>

          {/* A GitHub connection is not enough to search: we have to know which
              repository. Gmail and Drive need no equivalent — a mailbox and a
              Drive are already one thing each. */}
          {githubConnected && (
            <section className="flex flex-col gap-2">
              <h3 className="font-mono text-[10px] tracking-[0.1em] text-stone-500 uppercase">
                Repository to search
              </h3>
              {repos === null ? (
                <p className="flex items-center gap-2 text-[13px] text-stone-500">
                  <Loader2 className="size-3.5 animate-spin" /> Loading…
                </p>
              ) : repos.length === 0 ? (
                <p className="text-[13px] text-stone-600">
                  This account can see no repositories yet.
                </p>
              ) : (
                <ul className="flex max-h-72 flex-col gap-1 overflow-y-auto">
                  {repos.map((r) => (
                    <li key={r.slug}>
                      <button
                        onClick={() => onChooseRepo(r.slug)}
                        disabled={busy === r.slug}
                        className={cn(
                          "flex w-full items-center gap-2 rounded-md px-2.5 py-1.5 text-left text-[13px] transition-colors",
                          r.slug === repo ? "bg-stone-100 font-medium" : "hover:bg-stone-50",
                        )}
                      >
                        {r.slug === repo ? (
                          <Check className="size-3.5 shrink-0 text-emerald-600" />
                        ) : (
                          <span className="size-3.5 shrink-0" />
                        )}
                        <span className="truncate font-mono text-[12px]">{r.slug}</span>
                        {r.private && (
                          <span className="ml-auto font-mono text-[10px] text-stone-400">
                            private
                          </span>
                        )}
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          )}

          <p className="text-[12px] leading-relaxed text-stone-500">
            Badger never receives your tokens. Composio holds them and issues the sign-in
            link; we only ever learn whether a connection exists.
          </p>
        </div>
      </SheetContent>
    </Sheet>
  );
}
