-- Which sub-agent a conversation belongs to.
--
-- The Playground on an agent's own page is a normal conversation that always
-- runs as that agent, so its sessions have to be listable on their own. Null
-- is the ordinary case: a thread in /chat belongs to Badger, and the agent
-- there is still chosen per question.
--
-- A column rather than encoding the slug into the chat id. The id is a URL
-- path segment minted in the browser and validated by shape on the way in;
-- packing a second fact into it would make every reader parse it, and a
-- "special category of id" is the same bug generator that skill origins were.
alter table chat_session
  add column if not exists agent text;

-- The Playground's only query: this browser's conversations with one agent,
-- newest first.
create index if not exists chat_session_uid_agent_updated_idx
  on chat_session (uid, agent, updated_at desc)
  where not deleted;
