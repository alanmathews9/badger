-- Every scheduled run, and what came back.
--
-- **Not a chat_session.** An execution is a record you open and read, not a
-- conversation you continue: nothing appends to it, there is no follow-up, and
-- a run that failed before producing a single word still needs a row. Filing
-- them as conversations would mean every other list — /chat and the
-- Playground both — would have to filter them out forever, and a failed run
-- would have no honest shape at all.
--
-- No uid column. A schedule belongs to the AGENT, not to the browser that
-- created it: it fires while nobody is signed in, so scoping its output to one
-- browser's random cookie id would hide the runs from everyone including the
-- person who scheduled them.
create table if not exists schedule_run (
  id           bigserial primary key,
  -- The sub-agent's slug. Not a foreign key: agents are directories in the
  -- git repo, not rows, which is the thesis this whole project rests on.
  -- A deleted agent orphans its runs, exactly as it already orphans its
  -- chat_session rows, and the fix for both is the same one whenever it comes.
  agent        text        not null,
  -- Which schedule, for the day one-per-agent stops being true. Written now
  -- so that day is a UI change rather than a migration.
  schedule_id  text        not null,
  -- When the tick decided this was due, not when the answer arrived.
  triggered_at timestamptz not null default now(),
  finished_at  timestamptz,
  -- 'running' while it is in flight, so a run that dies with the instance is
  -- visible as one that never finished rather than absent.
  status       text        not null default 'running',
  -- The prompt as it actually ran. Stored per run rather than read back from
  -- the YAML: editing the question must not rewrite the history of what was
  -- asked before it changed.
  input        text        not null,
  -- The answer, the step trail, the citations and the cost — the same shape
  -- chat_message.result holds, so the execution detail view reuses the answer
  -- and step-trail components rather than growing a second renderer.
  result       jsonb,
  error        text
);

-- The Executions tab's only query: one agent's runs, newest first.
create index if not exists schedule_run_agent_triggered_idx
  on schedule_run (agent, triggered_at desc);
