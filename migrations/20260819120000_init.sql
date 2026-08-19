-- Badger's initial schema.
--
-- Five tables, and the reasoning behind the shape is in CLAUDE.md under
-- "The database". The short version: this holds PRODUCT data — conversations,
-- search history, and a searchable copy of the corpus. It deliberately does
-- not hold the AGENT: agent.yaml, SOUL.md, RULES.md, skills/ and memory/ stay
-- as files in the git repo, because "the agent is a git repo" is the thesis
-- this project is built to demonstrate.
--
-- Read alongside Onyx's backend/onyx/db/models.py, which several choices here
-- follow and two deliberately depart from (noted in place).

-- Extensions first, and in the migration rather than as a dashboard step: a
-- schema that only applies after someone remembers to click something is not
-- reproducible, and this file is the whole record of how the database is
-- built. Supabase keeps extensions in the `extensions` schema, which is
-- already on the search_path.
create extension if not exists pg_trgm with schema extensions;

-- ── conversations ─────────────────────────────────────────────────────────

create table if not exists chat_session (
  -- Short opaque base36, minted in the browser, and it is a URL path segment
  -- (/chat/<id>). Not a uuid: 36 characters of hyphenated hex in every chat
  -- link buys nothing when the id is already unguessable at this scale.
  id          text primary key,
  -- The session cookie's uid. NOT a foreign key and there is no user table:
  -- the uid is randomBytes(9) minted per sign-in with no account behind it,
  -- so history is per browser. Modelling it as a user would be a claim the
  -- product cannot honour.
  uid         text        not null,
  -- The first question. How a person recognises a conversation, and what
  -- Onyx calls `description`.
  title       text        not null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  -- Soft delete, as Onyx does: a deleted conversation stays recoverable and
  -- its messages are not orphaned mid-request.
  deleted     boolean     not null default false
);

-- The history pane's only query: this browser's live conversations, newest
-- first. Onyx's equivalent index carries a comment naming the query it backs,
-- which is a habit worth stealing — an index nobody can name the caller for
-- is an index nobody can safely drop.
create index if not exists chat_session_uid_updated_idx
  on chat_session (uid, updated_at desc)
  where not deleted;

create table if not exists chat_message (
  id           bigserial primary key,
  session_id   text        not null references chat_session (id) on delete cascade,
  role         text        not null check (role in ('user', 'assistant')),
  body         text        not null default '',
  -- The run's work, as the UI already models it: the step trail, the cited and
  -- opened-but-uncited items, and the citation verification result. JSONB
  -- rather than columns because these are display payloads we render whole and
  -- never query across.
  steps        jsonb,
  cited        jsonb,
  uncited      jsonb,
  verification jsonb,
  cost_usd     numeric(10, 6),
  duration_ms  integer,
  error        text,
  created_at   timestamptz not null default now()
);

-- Onyx carries parent_message_id / latest_child_message_id here, a tree that
-- exists so a user can edit a message and branch the conversation. Badger has
-- no message editing, so the tree is omitted rather than carried unused.
-- Messages are ordered by id; a conversation is rewritten wholesale on save,
-- which is correct at a few messages per chat and avoids a position column
-- that could disagree with the ids.
create index if not exists chat_message_session_idx on chat_message (session_id);

-- ── search history ────────────────────────────────────────────────────────

-- The query and the facts we already display, and NOT the results. That is
-- Onyx's rule, and their search_query table states the reason outright: less
-- is stored "because the reply functionality is simply to rerun the search
-- query again as things may have changed". Retrieval costs no model call, so
-- re-running is both cheap and fresher than a replay would be.
create table if not exists search_query (
  id           bigserial primary key,
  uid          text        not null,
  query        text        not null,
  result_count integer,
  -- Which engine answered: 'index' or 'live'. Kept because the two disagree
  -- between refreshes and a stored history that hid which one answered would
  -- be another status display nobody can see be wrong.
  path         text,
  took_ms      integer,
  api_calls    integer,
  created_at   timestamptz not null default now()
);

create index if not exists search_query_uid_created_idx
  on search_query (uid, created_at desc);

-- ── the search index ──────────────────────────────────────────────────────

-- Onyx's `document` table holds NO text — ids, owners, permissions and sync
-- state only, because their searchable text lives in OpenSearch. We keep the
-- text here on purpose: the corpus is ~178 documents, and running a search
-- cluster for that would be theatre. Same reason the JSON index exists at all.
create table if not exists document (
  -- Stable across rebuilds: "issue-8", "mail-<id>". Matches IndexDoc.id, so a
  -- row and a JSON-index entry are the same document by the same name.
  id         text primary key,
  source     text not null check (source in ('github', 'gmail', 'drive')),
  type       text not null,
  title      text not null default '',
  -- Full text, discussion folded in — the thing federation cannot hold and
  -- the reason every retrieval technique worth having was unavailable before.
  body       text not null default '',
  author     text,
  doc_date   date,
  url        text,
  -- Per-source extras the result row needs: issue number, state, comment count.
  meta       jsonb not null default '{}'::jsonb,
  indexed_at timestamptz not null default now(),
  -- Title weighted above body, matching the local ranker's 3x title bias.
  tsv        tsvector generated always as (
               setweight(to_tsvector('english', coalesce(title, '')), 'A') ||
               setweight(to_tsvector('english', coalesce(body, '')), 'B')
             ) stored
);

-- Candidate retrieval only. Ranking stays in tools/scripts/_index.mjs, which
-- implements BM25 with real IDF — Postgres's ts_rank has no IDF at all, and
-- adopting it would undo the document-frequency fix that stopped a term
-- present in every row from deciding the order.
create index if not exists document_tsv_idx on document using gin (tsv);

-- Typo tolerance, against titles. pg_trgm is what makes "brigthsmile" reach
-- "brightsmile" without holding a query log to learn from.
create index if not exists document_title_trgm_idx
  on document using gin (title gin_trgm_ops);

create index if not exists document_source_idx on document (source);

-- No embedding column yet, deliberately. Its type is vector(N) and N is fixed
-- by the model we have not chosen; adding the column with the model is one
-- migration, guessing N now is a rebuild.

-- When the copy was last refreshed, and whether it worked. Replaces reading
-- the mtime of a JSON file to say "index is 38m old" — a fact the UI shows on
-- every search, so it deserves to be recorded rather than inferred.
create table if not exists index_run (
  id          bigserial primary key,
  started_at  timestamptz not null default now(),
  finished_at timestamptz,
  doc_count   integer,
  ok          boolean,
  error       text
);
