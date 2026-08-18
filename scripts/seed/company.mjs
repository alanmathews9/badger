// Arkind — the company the whole demo corpus is about, in one file.
//
// Every fact three sources have to agree on lives here: who works there, who
// the customers are, and the dates and numbers that GitHub, Drive and Gmail
// each tell a different half of. The corpus modules import from this and never
// restate a date of their own. A contradiction we did not author on purpose
// reads as a bug rather than as insight, and the only way to keep the authored
// ones authored is to have exactly one place where the truth is written down.
//
// Arkind is appointment booking for small clinics. Dentists, physios and vets
// use it so patients can book online, get a reminder and leave a deposit.
// Founded 2019, 40 people, Bengaluru and Lisbon, one product. The company and
// the product share a name so there is one fewer thing to hold in your head.
//
// It replaced a fictional consultancy, and the reason is legibility: a
// consultancy's work is scope and weeks and billing, so every answer needed a
// glossary and nobody could tell a good answer from a bad one. A reminder text
// arriving at 3am is wrong in a way anyone can judge in a second.
//
// ---------------------------------------------------------------------------
// Addresses are on reserved domains, and this is not fussiness.
//
// RFC 2606 reserves `.example` permanently, so no real person can ever hold one
// of these addresses. `brightsmile.com` is a real registered domain — checked —
// and the corpus this one replaces would have shown a real company being misled
// about a delivery date. Nothing is ever sent (GMAIL_IMPORT_MESSAGE writes to
// the mailbox without SMTP), but the addresses are visible to anyone reading
// the demo, and that is enough.
// ---------------------------------------------------------------------------

export const ARKIND = "arkind.example";

/** The Arkind mailbox everything is seeded into. See the note below PEOPLE. */
export const MAILBOX = "priya";

/** The support alias. Real address in the corpus, not a person. */
export const SUPPORT_ALIAS = {
  name: "Arkind Support",
  email: `support@${ARKIND}`,
  role: "Support alias — Marta, Rahul, and Priya since the alias was created",
};

// ------------------------------------------------------------------ people

/**
 * Forty people, of whom fifteen are named and appear in the corpus.
 *
 * The rest exist only as headcount in `Headcount & Org 2026`: a directory in
 * which every single row has a story attached is not a directory, and the
 * questions worth asking of an org sheet ("which teams are short?") need the
 * unnamed majority to be countable.
 */
export const DEPARTMENTS = [
  { name: "Leadership", size: 3, site: "both" },
  { name: "Engineering — Mobile", size: 5, site: "Bengaluru" },
  { name: "Engineering — Platform", size: 6, site: "Bengaluru" },
  { name: "Engineering — Payments", size: 3, site: "Lisbon" },
  { name: "Engineering — Infrastructure", size: 3, site: "Lisbon" },
  { name: "Product & Design", size: 4, site: "Lisbon" },
  { name: "Customer Success & Support", size: 8, site: "both" },
  { name: "Sales & Marketing", size: 5, site: "Lisbon" },
  { name: "People & Operations", size: 3, site: "Bengaluru" },
];

export const HEADCOUNT = DEPARTMENTS.reduce((n, d) => n + d.size, 0); // 40

/**
 * The named cast.
 *
 * `role` is what the corpus calls them and must match the org sheet and the
 * team pages in Drive word for word — "Lead, Mobile" in one place and "Mobile
 * lead" in another is the kind of drift that makes a directory answer look
 * uncertain when it is not.
 */
export const P = {
  // --- Leadership
  sam: {
    name: "Sam Whitfield",
    email: `sam.whitfield@${ARKIND}`,
    role: "CEO",
    dept: "Leadership",
    site: "Lisbon",
  },
  priya: {
    name: "Priya Raghunathan",
    email: `priya.raghunathan@${ARKIND}`,
    role: "VP Engineering",
    dept: "Leadership",
    site: "Bengaluru",
  },
  meera: {
    name: "Meera Iyer",
    email: `meera.iyer@${ARKIND}`,
    role: "Head of People",
    dept: "Leadership",
    site: "Bengaluru",
  },

  // --- Engineering
  tomas: {
    name: "Tomas Lindqvist",
    email: `tomas.lindqvist@${ARKIND}`,
    role: "Lead, Mobile",
    dept: "Engineering — Mobile",
    site: "Bengaluru",
  },
  nadia: {
    name: "Nadia Okonkwo",
    email: `nadia.okonkwo@${ARKIND}`,
    role: "Mobile Engineer",
    dept: "Engineering — Mobile",
    site: "Bengaluru",
    joined: "2026-06-15",
  },
  dev: {
    name: "Dev Bhattacharya",
    email: `dev.bhattacharya@${ARKIND}`,
    role: "Senior Engineer, Platform",
    dept: "Engineering — Platform",
    site: "Bengaluru",
  },
  wei: {
    name: "Wei Zhang",
    email: `wei.zhang@${ARKIND}`,
    role: "Engineer, Platform",
    dept: "Engineering — Platform",
    site: "Bengaluru",
  },
  karan: {
    name: "Karan Shah",
    email: `karan.shah@${ARKIND}`,
    role: "Engineer, Platform",
    dept: "Engineering — Platform",
    site: "Bengaluru",
  },
  ana: {
    name: "Ana Ferreira",
    email: `ana.ferreira@${ARKIND}`,
    role: "Lead, Payments",
    dept: "Engineering — Payments",
    site: "Lisbon",
  },
  sofia: {
    name: "Sofia Almeida",
    email: `sofia.almeida@${ARKIND}`,
    role: "Engineer, Infrastructure",
    dept: "Engineering — Infrastructure",
    site: "Lisbon",
  },
  ravi: {
    name: "Ravi Menon",
    email: `ravi.menon@${ARKIND}`,
    role: "IT and Access",
    dept: "Engineering — Infrastructure",
    site: "Bengaluru",
  },

  // --- Product
  luca: {
    name: "Luca Bianchi",
    email: `luca.bianchi@${ARKIND}`,
    role: "Head of Product",
    dept: "Product & Design",
    site: "Lisbon",
  },

  // --- Support
  marta: {
    name: "Marta Nowak",
    email: `marta.nowak@${ARKIND}`,
    role: "Lead, Customer Success & Support",
    dept: "Customer Success & Support",
    site: "Lisbon",
  },
  rahul: {
    name: "Rahul Desai",
    email: `rahul.desai@${ARKIND}`,
    role: "Support Engineer",
    dept: "Customer Success & Support",
    site: "Bengaluru",
  },

  // --- Commercial
  elena: {
    name: "Elena Duarte",
    email: `elena.duarte@${ARKIND}`,
    role: "Lead, Sales & Marketing",
    dept: "Sales & Marketing",
    site: "Lisbon",
  },
};

// The mailbox belongs to Priya, VP Engineering, and that choice is what makes
// the mail corpus coherent rather than a pile of unrelated messages in one
// account.
//
// She is on both sides of every argument the demo turns on: the customer
// promise and the internal thread that walked it back, the release-notes
// wording, the access request, the free-tier debate. Support mail reaches her
// because she is on `support@arkind.example` — a forty-person company runs one
// alias with the support team and an engineering sponsor on it, which is also
// why an escalation to Wei about 3am reminders appears in the same mailbox as a
// question about exporting a patient list.
//
// Messages she sends carry no label: SENT is immutable through the Gmail API
// ("Cannot modify immutable label(s): SENT") and only actually sending a
// message earns it. Unlabelled leaves them in All Mail and inside the thread,
// which is the better of the two available lies — labelling her own replies
// INBOX would put her words in her own inbox.

/** Everyone, as an array, for the org sheet and the directory document. */
export const STAFF = Object.values(P);

/** "Name <email>" — the form an RFC 2822 header wants. */
export const addr = (p) => `${p.name} <${p.email}>`;

// --------------------------------------------------------------- customers

/**
 * Four named customers, each earning its place.
 *
 * Brightsmile is the account every escalation runs through, so it is the one
 * that was promised a date. Clearview left, and the three sources disagree
 * about why. Northgate is small and happy, and supplies the mundane traffic
 * retrieval has to discriminate against. Meadow is in Australia, which is the
 * whole reason the 3am reminder bug was ever noticed.
 */
export const CUSTOMERS = {
  brightsmile: {
    name: "Brightsmile Dental Group",
    domain: "brightsmile.example",
    clinics: 40,
    plan: "Practice",
    since: "2021-04",
    country: "United Kingdom",
    timezone: "Europe/London",
  },
  clearview: {
    name: "Clearview Dental",
    domain: "clearviewdental.example",
    clinics: 6,
    plan: "Practice",
    since: "2023-09",
    country: "United Kingdom",
    timezone: "Europe/London",
    churned: true,
  },
  northgate: {
    name: "Northgate Physio",
    domain: "northgatephysio.example",
    clinics: 2,
    plan: "Starter",
    since: "2024-11",
    country: "United Kingdom",
    timezone: "Europe/London",
  },
  meadow: {
    name: "Meadow Veterinary",
    domain: "meadowvet.example",
    clinics: 3,
    plan: "Practice",
    since: "2025-02",
    country: "Australia",
    timezone: "Australia/Melbourne",
  },
};

/** The people at those customers who actually appear in mail. */
export const C = {
  joris: {
    name: "Joris van Dijk",
    email: `j.vandijk@${CUSTOMERS.brightsmile.domain}`,
    role: "Operations Director, Brightsmile Dental Group",
    customer: "brightsmile",
  },
  elke: {
    name: "Elke Sanders",
    email: `e.sanders@${CUSTOMERS.brightsmile.domain}`,
    role: "Practice Manager, Brightsmile Dental Group",
    customer: "brightsmile",
  },
  harriet: {
    name: "Harriet Cole",
    email: `h.cole@${CUSTOMERS.clearview.domain}`,
    role: "Practice Owner, Clearview Dental",
    customer: "clearview",
  },
  owen: {
    name: "Owen Pritchard",
    email: `o.pritchard@${CUSTOMERS.northgate.domain}`,
    role: "Clinic Manager, Northgate Physio",
    customer: "northgate",
  },
  bec: {
    name: "Bec Tran",
    email: `b.tran@${CUSTOMERS.meadow.domain}`,
    role: "Practice Manager, Meadow Veterinary",
    customer: "meadow",
  },
};

// ------------------------------------------------------------------- facts
//
// The dates and numbers the three sources are built to disagree about. Each
// entry below is quoted in at least two places; the point of naming them here
// is that the disagreement stays exactly where we put it.

export const FACTS = {
  /**
   * The central story. The Android app shipped five weeks late.
   *
   * Drive's release notes say App Store review. GitHub issue #8 says the sync
   * layer was rewritten twice and review took 4 of the 35 days. Gmail shows the
   * team choosing that wording. PR #30 sits closed and unmerged as hard
   * evidence of the first rewrite.
   */
  release42: {
    version: "4.2",
    platform: "Android",
    planned: "2026-03-06",
    actual: "2026-04-10",
    slipDays: 35,
    slipWeeks: 5,
    appStoreSubmitted: "2026-04-06",
    appStoreApproved: "2026-04-10",
    appStoreReviewDays: 4,
    /** The first rewrite: PR #30, abandoned. */
    syncAttemptOne: { opened: "2026-01-12", closedUnmerged: "2026-02-02", weeks: 3 },
    /** The second: PR #26, merged, shipped. */
    syncAttemptTwo: { opened: "2026-02-09", merged: "2026-04-01" },
  },

  /**
   * The promise nothing else records.
   *
   * Tomas told Brightsmile "early March" on 4 February, by which point the team
   * already expected April. Neither Drive nor GitHub knows this happened, so
   * "did we tell Brightsmile it would be ready in March?" is answerable from
   * mail alone.
   */
  brightsmilePromise: { date: "2026-02-04", wording: "early March", by: "tomas" },

  /**
   * The March outage — one incident, so that four threads point at one event.
   *
   * Booking and payments were down; some cards were charged twice on the
   * webhook retry (issue #3), and bookings made during the window were lost.
   * Brightsmile got a customer-facing incident review. Clearview got a double
   * charge, then a refund, then left.
   */
  marchOutage: {
    date: "2026-03-17",
    start: "09:12 UTC",
    durationMinutes: 194,
    cause: "payment webhook retry storm after a provider timeout",
    doubleCharges: 61,
    clinicsAffected: 340,
  },

  /**
   * The timezone bug. Meadow Veterinary in Melbourne, reminders sent on UTC.
   * Reported by the customer in their own words, fixed by PR #23.
   */
  timezoneBug: {
    reported: "2026-03-03",
    reporter: "bec",
    issue: 1,
    fixedBy: 23,
    shipped: "2026-03-24",
  },

  /**
   * Refund policy, and what the company actually does.
   *
   * Drive says deposits inside five working days and outages not refundable.
   * GitHub issue #7 measures nine days. Gmail shows support giving Clearview a
   * full month's credit for the March outage anyway.
   */
  refunds: {
    policyWorkingDays: 5,
    measuredDays: 9,
    outagesRefundable: false,
    clearviewGoodwill: "one month's credit",
    goodwillDate: "2026-04-02",
    goodwillBy: "marta",
  },

  /**
   * Clearview's churn. Three sources, three reasons, on purpose.
   *
   * Drive's Churn Review says price. Their notice says the March outage and how
   * it was handled. Issue #14 has the team split between the two, and the
   * health sheet shows the score falling from January — before either.
   */
  clearview: {
    noticeGiven: "2026-06-11",
    effective: "2026-08-31",
    driveReason: "price",
    customerReason: "the March outage and how it was handled",
    arrEur: 8400,
  },

  /**
   * Leave carry-over. Drive is current; the repo is stale and still reachable.
   * A search engine that returns only one of them is lying by omission.
   */
  leave: {
    driveCarryOverDays: 10,
    driveDeadline: "31 March",
    repoCarryOverDays: 5,
    repoDeadline: null,
    driveUpdated: "2026-01-08",
    repoLastTouched: "2024-11-19",
  },

  /** Support volume, so "did tickets spike after 4.2?" has a number. */
  support: {
    monthlyTickets: {
      "2026-01": 118,
      "2026-02": 124,
      "2026-03": 261,
      "2026-04": 402,
      "2026-05": 233,
      "2026-06": 176,
      "2026-07": 161,
    },
    spikeMonth: "2026-04",
    spikeCause: "4.2 login failures after the offline sync rewrite",
  },

  /** Pricing, the factual half of the deposit and free-tier arguments. */
  pricing: {
    tiers: [
      { name: "Starter", eurPerClinicMonth: 39, includes: "online booking, email reminders" },
      { name: "Practice", eurPerClinicMonth: 89, includes: "SMS reminders, deposits, reporting" },
      { name: "Group", eurPerClinicMonth: 149, includes: "multi-site, API, priority support" },
    ],
    depositModel: "10% of the appointment value, minimum EUR 5",
  },
};

/**
 * Who authors a commit, by path.
 *
 * GitHub attributes every *committer* to the single account holding the token,
 * but the **author** is free metadata and the API returns it — which is what
 * `github_commits` reads. So commits carry the name of the person who would
 * really have written them, and "who knows about payments?" has evidence
 * underneath it rather than one account's name on all 37 commits.
 *
 * First match wins; order matters.
 */
export const CODE_OWNERS = [
  [/^api\/src\/payments\//, P.ana],
  [/^api\/src\/reminders\//, P.wei],
  [/^api\/src\/booking\//, P.dev],
  [/^api\/src\/clinics\//, P.karan],
  [/^api\/src\/patients\//, P.karan],
  [/^mobile\//, P.tomas],
  [/^docs\//, P.dev],
  [/^handbook\/leave\.md$/, P.meera],
  [/^handbook\/expenses\.md$/, P.meera],
  [/^handbook\/security\.md$/, P.ravi],
  [/^handbook\/on-call\.md$/, P.priya],
  [/^playbooks\/support-escalation\.md$/, P.marta],
  [/^playbooks\//, P.priya],
  [/^README\.md$/, P.priya],
];

/** The author of a commit touching `path`. Falls back to the VP of Engineering. */
export const authorFor = (path) =>
  CODE_OWNERS.find(([re]) => re.test(path))?.[1] ?? P.priya;

/** Repository the GitHub half of the corpus is seeded into. */
export const REPO = { owner: "alan-arkind", name: "arkind", private: true };

/**
 * GitHub attributes every issue, comment and commit to the one account holding
 * the token, so authorship is carried in the text — "Tomas: ..." — exactly as
 * Drive comments do it, and for the same reason. Named here so both seeders
 * format it identically.
 */
export const says = (person, text) => `**${person.name}:** ${text}`;
