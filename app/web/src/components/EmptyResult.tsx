/**
 * Nothing to show, said once.
 *
 * There were two of these and they disagreed: a real empty result explained
 * itself at length ("Nothing in GitHub, Gmail or Drive matches … this is a
 * real empty result, not an error"), which is the machine's account of its own
 * plumbing rather than anything the reader asked, and a filtered-to-zero list
 * got a different sentence again. A reader who searched and got nothing wants
 * one line and a way forward, so both cases now land here.
 *
 * The badger is the way forward's other half: an empty column with a line of
 * grey text in it reads as a fault, and the same column with the mark asleep
 * in the middle of it reads as "there is nothing here", which is what
 * happened.
 */
export function EmptyResult({ query, action }: { query: string; action?: React.ReactNode }) {
  return (
    <div className="flex flex-col items-center px-6 py-16 text-center">
      <img src="/badger-asleep.svg" alt="" aria-hidden="true" className="h-[78px] w-auto opacity-90" />
      <p className="mt-5 text-sm text-stone-600">
        Your search for <span className="font-medium text-stone-900">{query}</span> did not match
        anything.
      </p>
      {action ? <div className="mt-4">{action}</div> : null}
    </div>
  );
}
