import { ClayBars, DigInput } from "@/components/DigInput";
import { SourceFooter } from "@/components/SourceFooter";
import { TopBar } from "@/components/TopBar";
import { relativeTime, type Dig } from "@/lib/recentDigs";

const TICKS = ["bg-amber-600", "bg-amber-700", "bg-amber-900"];

/**
 * One question, one input. The content column sits slightly above centre —
 * `pb-20` — so the eye lands on the question rather than the middle of the
 * viewport.
 */
export function Home({
  query,
  onQueryChange,
  onSubmit,
  busy,
  digs,
}: {
  query: string;
  onQueryChange: (next: string) => void;
  /** Takes the query explicitly: a recent dig submits a value that has not
      been through a render yet, so reading it back from state would be one
      keystroke stale. */
  onSubmit: (query?: string) => void;
  busy: boolean;
  digs: Dig[];
}) {
  return (
    <div className="flex h-dvh flex-col bg-white text-stone-900">
      <TopBar />

      <main className="flex flex-1 flex-col items-center justify-center px-6 pb-20">
        <div className="w-full max-w-[640px]">
          <h1 className="text-[34px]/[1.25] font-semibold tracking-[-0.03em] text-pretty">
            What do you want to dig into today?
          </h1>
          <ClayBars />

          <div className="mt-6">
            <DigInput
              value={query}
              onChange={onQueryChange}
              onSubmit={onSubmit}
              busy={busy}
              autoFocus
            />
          </div>

          <div className="mt-3.5 flex items-center gap-2.5">
            <span className="text-[11.5px] text-stone-500">
              Searches issues, pull requests and the discussion underneath them
            </span>
            <span className="ml-auto font-mono text-[11.5px] text-stone-500">⌘K anywhere</span>
          </div>

          {digs.length > 0 && (
            <section className="mt-13">
              <h2 className="font-mono text-[10px] tracking-[0.1em] text-stone-500 uppercase">
                Pick up a recent dig
              </h2>
              <ul className="mt-2.5 flex flex-col">
                {digs.map((dig, i) => (
                  <li key={dig.query}>
                    <button
                      onClick={() => {
                        onQueryChange(dig.query);
                        onSubmit(dig.query);
                      }}
                      className="flex w-full items-center gap-3 border-b border-stone-100 px-0.5 py-2.5 text-left hover:bg-stone-50"
                    >
                      <span
                        className={`h-4 w-[3px] shrink-0 rounded-sm ${TICKS[i % TICKS.length]}`}
                      />
                      <span className="flex-1 truncate text-sm text-stone-800">{dig.query}</span>
                      <span className="shrink-0 font-mono text-[11.5px] text-stone-500">
                        {dig.found} found · {relativeTime(dig.at)}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            </section>
          )}
        </div>
      </main>

      <SourceFooter />
    </div>
  );
}
