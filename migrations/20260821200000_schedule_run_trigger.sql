-- What set this run going.
--
-- Scheduled runs and Run now runs live in ONE list with a column saying which,
-- rather than in two lists. That is what every comparable product does — n8n's
-- Executions has a Mode column, GitHub Actions tags each run with its event,
-- Airflow's DAG runs carry a Run Type — and the reason is the same everywhere:
-- when a scheduled run looks wrong the first thing anyone does is run it by
-- hand and compare the two, and separate lists make exactly that comparison
-- hard.
--
-- Note what does NOT belong here. A Playground conversation is not a run of
-- the schedule: it is a different question, with a conversation attached, that
-- you can carry on. Those stay in chat_session.
--
-- `trigger` is a reserved word in Postgres, so the column is spelt out. The
-- default backfills every row written before this column existed, all of
-- which came from the tick.
alter table schedule_run
  add column if not exists trigger_source text not null default 'schedule';
