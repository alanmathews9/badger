// The Arkind cast, shared by the Drive and Gmail corpora.
//
// Names and facts here must agree with the GitHub corpus in
// alanmathews9/arkind-internal, because the whole point of the demo is that
// one question is answered differently by three sources. Contradictions we did
// not author on purpose read as bugs, not as insight.
//
// From the GitHub repo, and not to be changed here:
//   Tomas Lindqvist    Lead, Data & Platform — ran Halden, filed the retro
//   Priya Raghunathan  the one who says the uncomfortable thing out loud
//   Dev Bhattacharya   Senior — found the 340-table problem in week 2
//   Ana Ferreira       Consultant, 60% on Halden
//   Sam Whitfield      Principal — approved the compressed discovery
//   Joris van Dijk     Halden, main contact
//   Elke Sanders       Halden, owed the Oracle read replica
//
// The rest exist only in Drive and Gmail. They carry the parts of a company
// that a code repository never holds: who runs payroll, who grants access,
// who just joined.

export const ARKIND = "arkind.dev";
export const HALDEN = "haldenlogistics.nl";

export const P = {
  // The mailbox this corpus is seeded into. Priya rather than Tomas, because
  // she sits on both sides of the Halden argument — the client thread and the
  // internal one — which is what makes crossing sources necessary.
  priya: { name: "Priya Raghunathan", email: `priya.raghunathan@${ARKIND}`, role: "Delivery Principal" },

  tomas: { name: "Tomas Lindqvist", email: `tomas.lindqvist@${ARKIND}`, role: "Lead, Data & Platform" },
  dev: { name: "Dev Bhattacharya", email: `dev.bhattacharya@${ARKIND}`, role: "Senior Engineer" },
  ana: { name: "Ana Ferreira", email: `ana.ferreira@${ARKIND}`, role: "Consultant" },
  sam: { name: "Sam Whitfield", email: `sam.whitfield@${ARKIND}`, role: "Principal" },
  meera: { name: "Meera Iyer", email: `meera.iyer@${ARKIND}`, role: "Head of People" },
  ravi: { name: "Ravi Menon", email: `ravi.menon@${ARKIND}`, role: "IT and Systems" },
  luca: { name: "Luca Bianchi", email: `luca.bianchi@${ARKIND}`, role: "Lead, Product Engineering" },
  nadia: { name: "Nadia Okonkwo", email: `nadia.okonkwo@${ARKIND}`, role: "Consultant, joined June 2026" },

  joris: { name: "Joris van Dijk", email: `j.vandijk@${HALDEN}`, role: "Halden — Head of Platform" },
  elke: { name: "Elke Sanders", email: `e.sanders@${HALDEN}`, role: "Halden — DBA" },
};

/** "Name <email>" — the form an RFC 2822 header wants. */
export const addr = (p) => `${p.name} <${p.email}>`;
