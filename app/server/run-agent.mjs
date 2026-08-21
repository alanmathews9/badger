// One agent run, with the transport taken out of it.
//
// This was the body of /api/ask. It was extracted when schedules landed,
// because a scheduled run is the same question asked with nobody watching:
// same retrieval, same skill matching, same citation verification, same
// budget. Two copies of it would have drifted the first time either changed,
// and the half that drifts is always the one nobody is looking at.
//
// The only thing the caller supplies is `emit`. /api/ask writes SSE frames
// with it; the scheduler collects them into the step trail it stores. Nothing
// in here knows which.
import { query } from "@open-gitagent/gitagent";
import { join } from "node:path";
import { openAuditLog } from "./audit.mjs";
import { accountFor, resolveContext } from "./connections.mjs";
import { buildSystemSuffix } from "./system-suffix.mjs";
import { buildPrompt } from "./transcript.mjs";
import { listSkills } from "./skills-store.mjs";
import { listAgents } from "./agents-store.mjs";
import { annotateUnverified, extractCitations, mentions, verifyCitations } from "./verify-citations.mjs";
import { attachSourceUrls } from "./source-links.mjs";
import { parseToolResults } from "./tool-results.mjs";
import { matchSkill, readProcedure } from "./skill-match.mjs";
import { redact } from "./agent-repo.mjs";
import { guardRuntimeTool } from "./tool-guard.mjs";

// Appended for a sub-agent whose output format is JSON. Instruction rather
// than schema enforcement: the runtime offers no structured-output mode, so
// the honest version says what is wanted and the reader can see whether it
// arrived.
const JSON_OUTPUT_SUFFIX =
  "\n\n# Output Format\n\nReturn your answer as a single JSON object and nothing else. " +
  "No prose before or after it, no code fence. Cite sources in a `sources` array.";

/** Thrown when there is nothing to answer from, or the run itself failed. */
export class RunError extends Error {}

/**
 * The learning loop's task id, out of the `begin` result that announced it.
 *
 * The runtime prints it once and then expects the model to type all 36
 * characters back on every later call (dist/tools/task-tracker.js). Flash
 * does not reliably manage that: a production run mistyped one character,
 * got "Task not found" three times in a row, and spent its last turn
 * apologising for it instead of answering the question.
 */
export function taskIdFrom(text) {
  return String(text ?? "").match(/Task started:\s*(\S+)/)?.[1] ?? null;
}

/**
 * A call that files the run's own paperwork rather than doing the work.
 *
 * `begin` is excluded because it opens the task before any retrieval; every
 * other call to either tool happens after the work, which is the ordering
 * SYSTEM_SUFFIX asks for and the reason nothing written after one of these
 * can be the answer.
 */
export function isLoggingCall(name, args = {}) {
  return name === "skill_learner" || (name === "task_tracker" && args?.action !== "begin");
}

/**
 * Ask the agent one question and return everything the answer card needs.
 *
 * Claims no budget slot and applies no rate limit: both belong to the caller,
 * because a scheduled run and a typed one are limited for different reasons
 * and only one of them has an IP.
 *
 * @param {object} opts
 * @param {string} opts.question
 * @param {{question:string,answer:string}[]} [opts.history]
 * @param {string|null} [opts.skill] a slug chosen in the composer
 * @param {string|null} [opts.agent] which sub-agent answers
 * @param {(event:string,data:object)=>void} [opts.emit] every step, as it happens
 * @param {(run:object)=>void} [opts.onRun] the run handle, for aborting
 * @param {{root:string, agentDir:string, agentsDir:string, skillsDir:string, repo:object}} opts.paths
 */
export async function runAgent({
  question,
  history = [],
  skill: wanted = null,
  agent: wantedAgent = null,
  emit = () => {},
  onRun = () => {},
  paths,
}) {
  const { root: ROOT, agentsDir: AGENTS_DIR, skillsDir: SKILLS_DIR, repo: AGENT } = paths;
  // Only a skill that exists on disk reaches the prompt; a stale or invented
  // slug degrades to a plain question rather than an error.
  const skill = wanted && listSkills(SKILLS_DIR).some((s) => s.slug === wanted) ? wanted : null;

  // Which agent answers. Same rule as the skill above: only a slug that names
  // a directory on disk is honoured, and an unknown one degrades to Badger
  // rather than erroring — a stale tab should still get an answer.
  const picked =
    wantedAgent ? (listAgents(AGENTS_DIR).find((a) => a.slug === wantedAgent) ?? null) : null;

  // Which skill this question needs, and its procedure. A skill picked from
  // the composer wins outright; otherwise we choose, because the runtime's own
  // matcher matches nothing here. See skill-match.mjs.
  //
  // Skipped entirely when a sub-agent answers: it carries its own skills/ and
  // the runtime loads them from its folder, so matching Badger's here would
  // hand it the body of a skill it does not have.
  const matched = picked
    ? null
    : skill
      ? { slug: skill, procedure: readProcedure(SKILLS_DIR, skill) }
      : matchSkill(SKILLS_DIR, question);
  const chosen = matched?.slug ?? null;

  const prompt = buildPrompt(history, question, {
    skill: chosen,
    procedure: matched?.procedure ?? matched?.body ?? null,
  });

  // The skill in play, announced as the run's first step. GAP emits no event
  // Who is answering, and with what, announced as the run's first steps. GAP
  // emits no event for either choice, so both are sent as `tool` frames and
  // the trail treats them like any other step.
  if (picked) emit("tool", { index: -2, name: "agent", args: { agent: picked.slug } });
  if (chosen) emit("tool", { index: -1, name: "skill", args: { skill: chosen } });

  const startedAt = Date.now();
  const toolOutputs = [];
  const toolCalls = [];
  // The runtime's tool-call id -> the step index it was announced as.
  const callIndex = new Map();
  const opened = [];
  let answer = "";
  // The learning loop's id, so the model never has to retype it. See taskIdFrom.
  let taskId = null;
  // Whether the run has started filing its own paperwork. See isLoggingCall.
  let logging = false;
  // The runtime's own account of a failure, kept for the message we throw.
  let systemError = null;

  const ctx = await resolveContext();
  if (ctx.mode === "none") {
    throw new RunError("No sources are configured, so there is nothing to answer from.");
  }

  // One private copy of the agent repo for this run, or ROOT in dir mode.
  // Awaited before query() because the runtime does its own git work inside
  // initLocalSession and needs the directory to already be there.
  const target = await AGENT.queryTarget(picked?.slug);

  // Which directory the runtime loads the agent from. A sub-agent is a full
  // agent folder one level down (spec §13), so pointing `dir` at it gives that
  // folder's own SOUL.md, tools/, skills/ and memory/ — and only those tools.
  //
  // `repo` is deliberately NOT passed for a sub-agent: sdk.js:98-112 forces the
  // agent directory to the clone root when it is present, which would run
  // Badger instead. The run copy is already on the learning branch, and
  // agent-repo's release() commits what the sub-agent wrote.
  const runDir = target.repo ? target.repo.dir : target.dir;
  const agentDir = picked ? join(runDir, "agents", picked.slug) : null;

  // maxTurns bounds a runaway loop, which is the failure mode that costs money
  // rather than time.
  const run = query({
    prompt,
    // `repo` and `dir` are alternatives, not a pair — sdk.js:98-112 takes
    // repo.dir when repo is present and ignores dir. Spreading exactly one of
    // them keeps that explicit rather than passing both and relying on which
    // one the runtime happens to prefer.
    ...(agentDir ? { dir: agentDir } : target.repo ? { repo: target.repo } : { dir: target.dir }),
    // The agent's own directory, so memory is read from where the agent
    // writes it rather than from the image's frozen copy — see system-suffix.
    // For a sub-agent that is its own folder, so it reads its own memory.
    systemPromptSuffix:
      buildSystemSuffix(picked ? join(AGENT.agentDir, "agents", picked.slug) : AGENT.agentDir) +
      (picked?.outputFormat === "json" ? JSON_OUTPUT_SUFFIX : ""),
    // 18, not 12: the learning loop spends five or six turns of the same
    // budget as retrieval, and at 12 the eval fell to 9/15 from 14/15. The
    // bound exists to stop a runaway loop, not to ration reading.
    maxTurns: 18,
    // The shell and the two write tools, removed from the model's schema.
    // hooks/allowed-tools.txt blocks them too, but this filter runs first
    // (dist/sdk.js:179) and, unlike the hook, cannot fail open.
    disallowedTools: ["cli", "write", "edit"],
    // Whose GitHub this run reads. Declarative tools are spawned with a
    // snapshot of process.env, so an env var would race between concurrent
    // visitors; a preToolUse closure puts the identity in the call's own
    // arguments instead — per request, and invisible to the model.
    hooks: {
      preToolUse: (hookCtx) => {
        const blocked = guardRuntimeTool(hookCtx.toolName, hookCtx.args);
        if (blocked) return { action: "block", reason: blocked };

        const args = {
          ...hookCtx.args,
          _badger_user: ctx.userId,
          _badger_repo: ctx.repo,
        };

        // The runtime builds its memory commit with
        // `git commit -m "${message}"` through a shell and escapes only the
        // quote (dist/tools/memory.js:120), so `$`, a backtick or a backslash
        // in a model-supplied message executes as a command inside the
        // container. Stripping them rather than blocking: a legitimate commit
        // message never needs one, so this changes nothing the agent does and
        // costs it no turn.
        if (hookCtx.toolName === "memory" && typeof args.message === "string") {
          args.message = args.message.replace(/[$`\\]/g, "");
        }

        // Tell the learning loop which skill was used, because the model
        // often will not. `task_tracker end` fires reinforcement only if handed
        // `skill_used` (dist/tools/task-tracker.js:227); without it no counter
        // moves and nothing is committed.
        //
        // `outcome` is still the model's, so whether it worked remains its
        // call. Only WHICH skill is filled in, and this server chose it.
        // Lower-case the loop's enum arguments before validation. `action`
        // and `outcome` are literal constants, so "Success" is a hard
        // validation failure that leaves the task active and makes the
        // following skill_learner call refuse. Every legal value is already
        // lower-case, so this can only turn an invalid argument into the
        // valid one meant.
        if (hookCtx.toolName === "task_tracker" || hookCtx.toolName === "skill_learner") {
          for (const field of ["action", "outcome"]) {
            if (typeof args[field] === "string") args[field] = args[field].toLowerCase();
          }
        }

        if (
          hookCtx.toolName === "task_tracker" &&
          args.action === "end" &&
          chosen &&
          !args.skill_used
        ) {
          args.skill_used = chosen;
        }

        // And which task, for the same reason and with more force: the id is
        // ours to know rather than the model's to remember, and a mistyped
        // one fails the call, which the model then reports to the reader in
        // place of the answer. Overwritten rather than filled in — a wrong id
        // is exactly the case this exists for.
        if (taskId && isLoggingCall(hookCtx.toolName, args)) args.task_id = taskId;

        return { action: "modify", args };
      },
    },
  });

  // The audit trail the runtime keeps only on its CLI path — see audit.mjs.
  const audit = openAuditLog(ROOT);

  // Handed to the caller so /api/ask can abort on a client disconnect. It is
  // called there and does nothing — gitagent 2.1.0 passes the AbortController's
  // signal to nothing (docs/UPSTREAM.md finding 4) — and stays so this is
  // correct the day the runtime wires it up. The bounds that hold are maxTurns
  // and the daily ceiling.
  onRun(run);

  try {
    for await (const msg of run) {
      audit.record(msg);
      switch (msg.type) {
        case "tool_use": {
          toolCalls.push(msg.toolName);
          // Text the model wrote and then kept working after is narration, not
          // an answer — the same rule the composer already applies to the text
          // on screen. Without it a run that never answers shows its last
          // "Next, I will search GitHub…" as the answer, which is worse than
          // showing nothing: it reads as complete and it is not.
          //
          // A LOGGING call does not clear it. SYSTEM_SUFFIX asks the model to
          // file its paperwork after the work, so an answer followed by
          // task_tracker end is the ordinary shape of a good run.
          if (isLoggingCall(msg.toolName, msg.args)) logging = true;
          else answer = "";
          recordOpened(opened, msg);
          const index = toolCalls.length - 1;
          // By the runtime's own id — see tool_result for why position fails.
          if (msg.toolCallId != null) callIndex.set(msg.toolCallId, index);
          emit("tool", { index, name: msg.toolName, args: msg.args ?? {} });
          break;
        }
        case "tool_result": {
          // Everything Badger actually retrieved. This is the corpus a
          // citation has to appear in to count as verified.
          const content =
            typeof msg.content === "string" ? msg.content : JSON.stringify(msg.content);
          toolOutputs.push(content);
          if (msg.toolName === "task_tracker") taskId = taskIdFrom(content) ?? taskId;
          // …and, for a search, the documents it found.
          //
          // Attached by the runtime's `toolCallId`, which rides both frames
          // (dist/sdk.js:376,385). Position does NOT work: the model issues
          // several calls per turn, so frames arrive use,use,use then
          // result,result,result and every result lands on the last step.
          const from = msg.toolName ?? toolCalls.at(-1);
          const results = parseToolResults(from, content);
          if (results.length) {
            const index = callIndex.has(msg.toolCallId)
              ? callIndex.get(msg.toolCallId)
              : toolCalls.length - 1;
            emit("results", { index, results });
          }
          break;
        }
        case "delta":
          if (msg.deltaType === "text" && msg.content) emit("delta", { text: msg.content });
          break;
        case "assistant":
          // The answer is what the model wrote before it began filing its
          // paperwork. Anything after that is a report ON the paperwork, and
          // a run that ended "My apologies, it seems I made a mistake in the
          // task_id again" is what this guard exists to stop replacing a
          // finished answer with.
          if (msg.content && (!answer || !logging)) answer = msg.content;
          break;
        case "system":
          // Redacted: the runtime authenticates git with the token in the URL
          // (session.js:8), so a failed clone or push produces an error
          // message carrying the credential, and this goes to the browser.
          if (msg.subtype === "error") {
            // Logged as well as forwarded. The browser drops warning frames on
            // purpose, and for a run that failed outright that left the only
            // account of the failure nowhere: a manifest that would not parse
            // showed up as a blank answer with an empty step trail, in the
            // product and in Cloud Logging both.
            const message = redact(msg.content);
            systemError ??= message;
            console.error("[ask] runtime error:", message);
            emit("warning", { message });
          }
          break;
      }
    }
  } catch (err) {
    // As above: an error out of query() can carry the git URL, and this goes
    // to Cloud Logging.
    console.error("[ask]", redact(err?.stack || err?.message || err));
    throw new RunError("Badger could not finish that answer.");
  } finally {
    audit.end();
    // finalize() has already committed and pushed on both the success and the
    // error path, so the copy is done with. Best-effort and not awaited: a
    // failed cleanup must not turn a good answer into an error.
    target.release();
    AGENT.sync();
  }

  // An empty answer is a failed run, not a short one. Returning it produces a
  // card with an empty body and a step trail reading "Answered without
  // searching", which is indistinguishable from a question the agent chose not
  // to search for — so it is raised here, where both callers already report it.
  if (!answer.trim()) {
    throw new RunError(
      systemError
        ? `The run failed before it could answer: ${systemError.slice(0, 200)}`
        : "The run finished without writing an answer.",
    );
  }

  const verification = verifyCitations(answer, toolOutputs);
  const cited = extractCitations(answer);
  labelOpened(opened, toolOutputs);
  const costs = typeof run.costs === "function" ? run.costs() : null;

  return {
    // Bad citations are marked inline rather than withholding the answer: the
    // reader needs to know which claim to distrust, not that something
    // somewhere is wrong.
    answer: annotateUnverified(answer, verification),
    verification,
    toolCalls,
    // From what the answer cites, not what was opened: an answer can
    // legitimately cite an issue it only saw in search results.
    cited: attachSourceUrls(
      resolveCitations(cited, toolOutputs),
      opened,
      process.env.BADGER_GITHUB_REPO ?? null,
      // The mailbox we actually indexed, so a mail citation can be addressed
      // by identity rather than by position. Cached after the first lookup.
      { mailbox: await accountFor(ctx.userId, "gmail").catch(() => null) },
    ),
    // Opened in full and not cited — the honesty signal. Deliberately not
    // everything that appeared in a search result: those were listed, not
    // read.
    opened,
    uncited: opened.filter((item) => !isCited(item, cited)),
    tookMs: Date.now() - startedAt,
    costUsd: costs?.totalCostUsd ?? null,
    inputTokens: costs?.totalInputTokens ?? null,
    outputTokens: costs?.totalOutputTokens ?? null,
    // Which skill and which agent answered. The browser already saw both as
    // steps; a stored execution has no step stream to have seen them in.
    skill: chosen,
    agent: picked?.slug ?? null,
  };
}

/**
 * Note what a tool call opened, so the answer can be compared against it.
 *
 * Drives "N items were opened but not cited" and the follow-up chips.
 *
 * Mail and Drive are opened by opaque id, so there is no label to record here;
 * `labelOpened` recovers one from the tool's own output.
 */
function recordOpened(opened, msg) {
  const args = msg.args ?? {};
  const add = (kind, ref, label) => {
    if (ref == null || opened.some((o) => o.kind === kind && o.ref === String(ref))) return;
    opened.push({ kind, ref: String(ref), label: label ?? String(ref) });
  };
  switch (msg.toolName) {
    case "github_issue": return add("issue", args.number, `issue #${args.number}`);
    case "github_pr": return add("pr", args.number, `PR #${args.number}`);
    case "github_file": return add("file", args.path, args.path);
    case "gmail_thread": return add("mail", args.thread_id);
    // Both Drive reads name the same document, so they collapse to one entry.
    case "drive_file":
    case "drive_comments": return add("doc", args.file_id);
  }
}

/**
 * Give the mail and document opens a human label.
 *
 * The tools print an id-to-name line at the top of their output —
 * `thread <id> — "<subject>"` and `<name>  [doc]` above `id: <file_id>` — so
 * the name costs no extra call. An unresolvable id keeps the id.
 */
function labelOpened(opened, toolOutputs) {
  const corpus = toolOutputs.join("\n");
  for (const item of opened) {
    if (item.kind === "mail") {
      const m = corpus.match(new RegExp(`thread ${escapeRe(item.ref)} — "([^"]+)"`));
      if (m) item.label = m[1];
    } else if (item.kind === "doc") {
      const m = corpus.match(new RegExp(`(.+)\\s+\\[(doc|sheet)\\]\\nid: ${escapeRe(item.ref)}`));
      if (m) {
        item.label = m[1].trim();
        item.detail = m[2] === "sheet" ? "spreadsheet" : "document";
      }
    }
  }
}

const escapeRe = (v) => String(v).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * Turn the answer's citations into source cards, recovering each one's title
 * from the tool output that produced it.
 *
 * The tools print issues as "#12 [issue, open] Title", so the title needs no
 * further API call. Unrecoverable falls back to the bare reference.
 */
function resolveCitations(cited, toolOutputs) {
  const corpus = toolOutputs.join("\n");
  const items = [];

  for (const number of cited.numbers) {
    const match = corpus.match(new RegExp(`#${number} \\[(issue|PR), ([^\\]]*)\\] (.+)`));
    items.push({
      kind: match?.[1] === "PR" ? "pr" : "issue",
      ref: number,
      label: match?.[3]?.trim() || `#${number}`,
      detail: match ? `${match[1] === "PR" ? "pull request" : "issue"} #${number}, ${match[2]}` : `#${number}`,
    });
  }

  for (const path of cited.paths) {
    items.push({ kind: "file", ref: path, label: path, detail: "file" });
  }

  // Mail and documents are cited by subject and by name rather than by id —
  // the format RULES.md asks for — so the citation is its own reference.
  for (const m of cited.mail) {
    items.push({ kind: "mail", ref: m.subject, label: m.subject, detail: `mail, ${m.sender}` });
  }

  for (const name of cited.documents) {
    items.push({ kind: "doc", ref: name, label: name, detail: "document" });
  }

  return items;
}

/**
 * Did the answer actually cite this opened item?
 *
 * GitHub items match literally. Mail and documents are compared against the
 * label recovered from the tool output, with the verifier's forgiving match:
 * the target is invention, not transcription.
 */
function isCited(item, cited) {
  if (item.kind === "file") return cited.paths.includes(item.ref);
  if (item.kind === "mail") return cited.mail.some((m) => mentions(item.label, m.subject));
  if (item.kind === "doc") return cited.documents.some((d) => mentions(item.label, d));
  return cited.numbers.includes(item.ref);
}
