-- Store the run's result whole, rather than split across four columns.
--
-- 001 gave chat_message separate `cited`, `uncited`, `verification`,
-- `cost_usd` and `duration_ms` columns. That was a split made before looking
-- at what the client actually round-trips: the stream delivers one AskResult
-- object — answer, verification, toolCalls, cited, opened, uncited, tookMs,
-- costUsd, inputTokens, outputTokens — and the UI reads several of those.
-- Splitting out five of its ten fields meant the other five were silently
-- dropped on reload, so a restored conversation would have rendered blanks for
-- anything we later chose to show.
--
-- One jsonb column stores it losslessly, and loses no query power either:
-- `result->'verification'->>'ok'` is perfectly queryable if we ever want to
-- count how many answers verified clean. The columns were structure without
-- benefit.
--
-- Written as a second migration rather than by editing 001, which is already
-- applied. An applied migration is a record of what the database was told;
-- editing it in place makes the file and the database disagree with no way to
-- notice.
alter table chat_message
  drop column if exists cited,
  drop column if exists uncited,
  drop column if exists verification,
  drop column if exists cost_usd,
  drop column if exists duration_ms;

-- The whole AskResult, as the stream delivered it. Null on a user message and
-- on an assistant message that errored before producing one.
alter table chat_message
  add column if not exists result jsonb;
