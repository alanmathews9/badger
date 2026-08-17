import { useCallback, useEffect, useState } from "react";
import { Check, ExternalLink, Loader2, Lock, Plus, Trash2 } from "lucide-react";
import { GitHubLogo } from "./BrandLogos";
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
  connectGithub,
  disconnectAccount,
  fetchAccounts,
  fetchRepos,
  selectAccount,
  type Account,
  type Repo,
} from "@/lib/api";
import { cn } from "@/lib/utils";

/**
 * Manage connected GitHub accounts.
 *
 * A side pane rather than a page: connecting is something you do once and then
 * forget, and it should not cost you the search you were in the middle of.
 *
 * Several accounts are supported because people have several — a work GitHub
 * and a personal one. Composio holds each as its own connected account and
 * tool calls target one by id, so switching is a choice rather than a
 * disconnect-and-reconnect. The repository is remembered per account, since
 * each account sees a different set.
 */
export function ManageConnections({
  open,
  onOpenChange,
  onChanged,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onChanged: () => void;
}) {
  const [accounts, setAccounts] = useState<Account[] | null>(null);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [repo, setRepo] = useState<string | null>(null);
  const [repos, setRepos] = useState<Repo[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const data = await fetchAccounts();
      setAccounts(data.accounts);
      setActiveId(data.activeId);
      setRepo(data.repo);
      if (data.activeId) {
        fetchRepos()
          .then(setRepos)
          .catch(() => setRepos([]));
      } else {
        setRepos(null);
      }
    } catch {
      setError("could not read your connections");
    }
  }, []);

  useEffect(() => {
    if (open) load();
  }, [open, load]);

  const act = async (key: string, fn: () => Promise<unknown>) => {
    setBusy(key);
    setError(null);
    try {
      await fn();
      await load();
      onChanged();
    } catch (e) {
      setError(e instanceof Error ? e.message : "that did not work");
    } finally {
      setBusy(null);
    }
  };

  const connect = async () => {
    setBusy("connect");
    setError(null);
    try {
      // A full navigation: GitHub's consent screen refuses to be framed, and a
      // blocked popup is indistinguishable from a broken button.
      window.location.href = await connectGithub();
    } catch (e) {
      setError(e instanceof Error ? e.message : "could not start the connection");
      setBusy(null);
    }
  };

  const active = accounts?.find((a) => a.id === activeId) ?? null;

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="w-full gap-0 overflow-y-auto sm:max-w-md">
        <SheetHeader>
          <SheetTitle className="flex items-center gap-2">
            <GitHubLogo size={18} />
            GitHub connections
          </SheetTitle>
          <SheetDescription>
            Badger never receives your token. Composio holds it, and the connection belongs to this
            browser session.
          </SheetDescription>
        </SheetHeader>

        <div className="flex flex-col gap-6 px-4 pb-6">
          {error && (
            <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-[12.5px] text-amber-900">
              {error}
            </div>
          )}

          <section>
            <h3 className="font-mono text-[10px] tracking-[0.1em] text-stone-500 uppercase">
              Accounts
            </h3>

            {accounts === null ? (
              <p className="mt-3 flex items-center gap-2 text-[12.5px] text-stone-500">
                <Loader2 className="size-3.5 animate-spin" /> Loading…
              </p>
            ) : accounts.length === 0 ? (
              <p className="mt-3 text-[12.5px]/[1.7] text-stone-600">
                No GitHub account connected yet. Connect one to search your own repositories.
              </p>
            ) : (
              <ul className="mt-3 flex flex-col gap-1.5">
                {accounts.map((account) => {
                  const isActive = account.id === activeId;
                  const pending = account.status !== "ACTIVE";
                  return (
                    <li
                      key={account.id}
                      className={cn(
                        "flex items-center gap-2.5 rounded-lg border px-3 py-2.5",
                        isActive ? "border-stone-900 bg-stone-50" : "border-stone-200",
                      )}
                    >
                      <span className="inline-flex size-2 shrink-0 items-center justify-center">
                        <span
                          className={cn(
                            "size-2 rounded-full",
                            pending ? "bg-amber-400" : "bg-emerald-500",
                          )}
                        />
                      </span>

                      <div className="min-w-0 flex-1">
                        <div className="truncate text-[13px] font-medium">
                          {account.login ? `@${account.login}` : account.label}
                        </div>
                        <div className="truncate font-mono text-[10px] text-stone-500">
                          {pending ? "awaiting authorisation" : `connected ${account.createdAt}`}
                        </div>
                      </div>

                      {!isActive && !pending && (
                        <button
                          onClick={() => act(account.id, () => selectAccount(account.id))}
                          disabled={busy === account.id}
                          className="shrink-0 text-[11.5px] font-medium text-stone-500 hover:text-stone-900"
                        >
                          Use
                        </button>
                      )}
                      {isActive && (
                        <span className="inline-flex shrink-0 items-center gap-1 text-[10.5px] font-medium text-emerald-700">
                          <Check className="size-3" strokeWidth={2.5} />
                          in use
                        </span>
                      )}

                      <button
                        onClick={() => act(`x-${account.id}`, () => disconnectAccount(account.id))}
                        disabled={busy === `x-${account.id}`}
                        title="Disconnect"
                        aria-label={`Disconnect ${account.login ?? account.label}`}
                        className="shrink-0 text-stone-400 hover:text-red-600 disabled:opacity-50"
                      >
                        {busy === `x-${account.id}` ? (
                          <Loader2 className="size-3.5 animate-spin" />
                        ) : (
                          <Trash2 className="size-3.5" />
                        )}
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}

            <Button
              variant="outline"
              onClick={connect}
              disabled={busy === "connect"}
              className="mt-3 h-8 w-full gap-1.5 text-[12.5px]"
            >
              {busy === "connect" ? (
                <Loader2 className="size-3.5 animate-spin" />
              ) : accounts?.length ? (
                <Plus className="size-3.5" />
              ) : (
                <ExternalLink className="size-3.5" />
              )}
              {accounts?.length ? "Add another account" : "Connect GitHub"}
            </Button>
          </section>

          {active && (
            <section>
              <h3 className="font-mono text-[10px] tracking-[0.1em] text-stone-500 uppercase">
                Repository for {active.login ? `@${active.login}` : active.label}
              </h3>
              {repos === null ? (
                <p className="mt-3 flex items-center gap-2 text-[12.5px] text-stone-500">
                  <Loader2 className="size-3.5 animate-spin" /> Reading repositories…
                </p>
              ) : repos.length === 0 ? (
                <p className="mt-3 text-[12.5px] text-stone-500">
                  No repositories visible to this account.
                </p>
              ) : (
                <ul className="mt-3 flex max-h-[45vh] flex-col gap-1 overflow-y-auto pr-1">
                  {repos.map((r) => (
                    <li key={r.slug}>
                      <button
                        onClick={() => act(r.slug, () => chooseRepo(r.slug))}
                        disabled={busy === r.slug}
                        className={cn(
                          "flex w-full items-center gap-2 rounded-md border px-2.5 py-1.5 text-left",
                          repo === r.slug
                            ? "border-stone-900 bg-stone-50"
                            : "border-transparent hover:border-stone-200 hover:bg-stone-50",
                        )}
                      >
                        {r.private && <Lock className="size-3 shrink-0 text-stone-400" />}
                        <span className="truncate text-[12.5px] text-stone-800">{r.slug}</span>
                        {repo === r.slug && (
                          <Check className="ml-auto size-3.5 shrink-0 text-stone-900" />
                        )}
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}
