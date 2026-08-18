// The GitHub half of the Arkind corpus.
//
// Split across three files because it is large and each part has a different
// shape, but this is the entry point and `scripts/seed-github.mjs` imports only
// from here.
//
//   corpus-github-files.mjs   21 files committed to `main`, backdated
//   corpus-github-issues.mjs  22 issues, 91 comments — where the argument lives
//   corpus-github-pulls.mjs   8 pull requests, 5 merged, 2 open, 1 abandoned
//
// The division of labour between the three sources, restated here because this
// is the file someone reads first:
//
//   GitHub  the argument. What the team said to each other, including the
//           things nobody would put in a document.
//   Drive   the written-down version, and the customer-facing one. Which is
//           exactly why it is the source most often wrong.
//   Gmail   what was actually said to whom, and when. The only record of the
//           promise, and the thing that catches the other two out.
//
// The central story: the Android app shipped five weeks late. Drive's release
// notes blame App Store review. Issue #8 does the arithmetic and finds review
// took 4 of the 35 days, the rest being a sync layer written twice. PR #30 sits
// closed and unmerged as proof of the first attempt. Gmail shows the team
// choosing the wording. No single source answers the question.

export { FILES } from "./corpus-github-files.mjs";
export { ISSUES } from "./corpus-github-issues.mjs";
export { PULLS } from "./corpus-github-pulls.mjs";
export { REPO } from "./company.mjs";
