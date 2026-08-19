/**
 * The chat transcript: conversation history in, one agent prompt out.
 *
 * The runtime keeps no conversation state — dist/sdk.js never loads prior
 * messages — so every follow-up re-sends the conversation as text. Two rules
 * keep that honest and affordable: prior answers are re-fed without their
 * Sources/Coverage boilerplate (the model would only be quoting itself), and
 * the whole transcript lives under a character budget where the oldest turns
 * fall off first, because the newest turn is the one a follow-up usually
 * leans on.
 */

const QUESTION_MAX = 500;
const TURNS_MAX = 20;
const BUDGET_DEFAULT = 8000;
// A single answer may not eat the whole budget: an oversize one is truncated
// so its own question — and the turns after it — survive.
const ANSWER_SHARE = 0.6;

/** Drop the model's trailing **Sources** / **Coverage** sections. */
function stripSections(answer) {
  const source = String(answer ?? "");
  const cuts = ["Sources", "Coverage"]
    .map((h) => source.match(new RegExp(`^\\s*\\*\\*${h}\\b.*?\\*\\*:?`, "im"))?.index)
    .filter((i) => i != null && i >= 0);
  return (cuts.length ? source.slice(0, Math.min(...cuts)) : source).trim();
}

/**
 * Build the prompt: prior turns as a labelled transcript, newest kept when
 * the budget forces a choice, the new question last.
 */
export function buildPrompt(
  history,
  question,
  { budget = BUDGET_DEFAULT, skill = null, procedure = null } = {},
) {
  // A skill becomes an explicit instruction, and — when we have it — the
  // procedure itself travels with the question.
  //
  // **The procedure has to be sent.** This comment used to say the skill's
  // text was "already in the system prompt (the runtime loads every
  // SKILL.md)". It is not. `loader.js:203` injects `formatSkillsForPrompt`,
  // which emits each skill's name, description and file location and never
  // its body; loading the body is a `read` call the model has to decide to
  // make, and the runtime's own matcher tells it not to bother. So naming the
  // skill named something the model could not see.
  //
  // Same fix as memory, for the same reason: data the run depends on goes in
  // the prompt, where it cannot be skipped.
  const ask = skill
    ? procedure
      ? `Use your "${skill}" skill to answer this: ${question}\n\n` +
        `Its full instructions follow. Follow them exactly — this is the ` +
        `procedure, not background reading. Do not call a tool named ` +
        `"${skill}"; there is no such tool, and there is nothing further to ` +
        `load.\n\n<skill name="${skill}">\n${procedure}\n</skill>`
      : `Use your "${skill}" skill to answer this: ${question}`
    : question;
  if (!history?.length) return ask;

  const answerMax = Math.floor(budget * ANSWER_SHARE);
  const blocks = [];
  let used = 0;
  // Walk newest-first so the budget spends itself on the turns a follow-up
  // actually refers to; reverse at the end to restore conversation order.
  for (const turn of [...history].reverse()) {
    let answer = stripSections(turn.answer);
    if (answer.length > answerMax) answer = answer.slice(0, answerMax) + " […]";
    const block = `You were asked: "${turn.question}"\n\nYou answered:\n${answer}`;
    if (used + block.length > budget && blocks.length > 0) break;
    blocks.push(block);
    used += block.length;
    if (used > budget) break;
  }
  blocks.reverse();

  return (
    "Earlier in this conversation:\n\n" +
    blocks.join("\n\n---\n\n") +
    `\n\nFollow-up question: ${ask}`
  );
}

/**
 * Validate a POST /api/ask body. Returns { question, history } or { error }.
 *
 * Malformed history turns are dropped rather than failing the request — the
 * client is ours, but a stale tab mid-deploy should degrade to a shallower
 * conversation, not a dead one. Only the question is load-bearing.
 */
export function parseAskBody(body) {
  const question = typeof body?.question === "string" ? body.question.trim() : "";
  if (!question) return { error: "question is required" };
  if (question.length > QUESTION_MAX) return { error: "that question is too long" };

  const raw = Array.isArray(body.history) ? body.history : [];
  const history = raw
    .filter(
      (turn) =>
        turn &&
        typeof turn === "object" &&
        typeof turn.question === "string" &&
        typeof turn.answer === "string",
    )
    .slice(-TURNS_MAX)
    .map((turn) => ({ question: turn.question, answer: turn.answer }));

  // The picked skill travels as a slug and is only ever used if it names a
  // skill that actually exists on disk — the server checks; here we check the
  // shape so nothing slug-unlike reaches a prompt.
  const skill =
    typeof body?.skill === "string" && /^[a-z0-9]+(-[a-z0-9]+)*$/.test(body.skill) && body.skill.length <= 60
      ? body.skill
      : null;

  return { question, history, skill };
}
