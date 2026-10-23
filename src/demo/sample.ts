import { edition, shaped } from "../edition";
import type { OpsMe } from "../lib/ops";

/**
 * Sample data for a demo edition (`edition.demo`), so a collective can see how
 * the app works before its members have logins. Every figure and name here is
 * invented: the people are Alice, Bob and Carol, the company is the
 * collective's name with "(template)" after it, and every screen that shows
 * this data says it is a sample.
 *
 * The shapes match what the operations console serves
 * (infra/services/ops-console), so the Operations plugin draws them unchanged.
 */

const name = edition.instance.name;
/** Huxley's own story (the showcase, not a visitor's sketch): a collective whose
 *  travelling studio became a company, so Operations shows that company. */
const HUXLEY = !!edition.showcase && !shaped;
export const SAMPLE_COMPANY = HUXLEY ? "Huxley Sessions Ltd" : `${name} (template)`;

const iso = (d: Date) => d.toISOString().slice(0, 10);
const day = (from: string, n: number) => {
  const d = new Date(`${from}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return iso(d);
};

// ── operations ──────────────────────────────────────────────────────────────

export const sampleMe: OpsMe = {
  signedIn: true,
  who: { handle: "alice", name: "Alice" },
  brand: edition.productName,
  company: SAMPLE_COMPANY,
  views: { accounts: true, position: true, shares: true, raise: true, incubation: false, files: false },
};

const LEDGER: [number, string, string, number, string][] = [
  [1, "Bob Studio Ltd", "Sales", 4200, "reconciled"],
  [2, "Office rent", "Premises", -1250, "reconciled"],
  [4, "Cloud hosting", "Software", -86.4, "reconciled"],
  [6, "Carol & Co", "Sales", 2750, "reconciled"],
  [9, "Train tickets", "Travel", -142.8, "receipt"],
  [11, "Accountant", "Professional fees", -600, "reconciled"],
  [13, "Payroll", "Wages", -5400, "reconciled"],
  [16, "Grant instalment", "Grants", 8000, "open"],
  [18, "Design tools", "Software", -54, "receipt"],
  [21, "Card payment, unknown", "", -312.5, "problem"],
  [23, "Alice (expenses)", "Director's loan", -230, "open"],
  [26, "Event tickets", "Sales", 1180, "open"],
];

// Huxley Sessions Ltd: a few months old, selling recording sessions to schools
// and care homes, and renting its desks and storage from the collective.
const HUXLEY_LEDGER: [number, string, string, number, string][] = [
  [1, "Elm Street Primary", "Sessions", 1450, "reconciled"],
  [3, "Kit insurance", "Insurance", -64, "reconciled"],
  [5, "Riverside care home", "Sessions", 900, "reconciled"],
  [8, "Van hire", "Travel", -185, "receipt"],
  [10, "Council music service", "Sessions", 3200, "open"],
  [12, "Accountant", "Professional fees", -350, "reconciled"],
  [14, "Payroll", "Wages", -2900, "reconciled"],
  [17, "Huxley (desks and storage)", "Premises", -400, "reconciled"],
  [19, "Cables and stands", "Equipment", -212.4, "receipt"],
  [21, "Card payment, unknown", "", -48.5, "problem"],
  [23, "Alice (expenses)", "Director's loan", -96, "open"],
  [26, "Northgate Academy", "Sessions", 1150, "open"],
];

/** When Huxley Sessions Ltd was registered: about ten weeks ago, whenever the demo is opened. */
const incorporated = (() => {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - 75);
  return iso(d);
})();
export const sampleIncorporated = incorporated;

function accounts(from: string) {
  const start = new Date(`${from}T00:00:00Z`);
  const now = new Date();
  // Nothing before the company existed.
  if (HUXLEY && from < incorporated.slice(0, 8) + "01")
    return { rows: [], count: 0, money_in: 0, money_out: 0, tally: { open: 0, receipt: 0, problem: 0, reconciled: 0 }, vat: null };
  const thisMonth = start.getUTCFullYear() === now.getUTCFullYear() && start.getUTCMonth() === now.getUTCMonth();
  if (start > now) return { rows: [], count: 0, money_in: 0, money_out: 0, tally: { open: 0, receipt: 0, problem: 0, reconciled: 0 }, vat: null };
  // The month so far: the sample spreads across the days that have happened, so
  // the current month always shows a few open items, as a real one would.
  const days = thisMonth ? now.getUTCDate() : new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + 1, 0)).getUTCDate();
  const rows = (HUXLEY ? HUXLEY_LEDGER : LEDGER).map(([d, who, cat, amount, state], i) => ({
    id: `${from}-${i}`,
    date: day(from, Math.min(days, Math.max(1, Math.round((d / 26) * days))) - 1),
    who,
    category_name: cat,
    amount,
    // earlier months are closed
    state: thisMonth || state === "reconciled" ? state : "reconciled",
  })).reverse();
  const money_in = rows.filter((r) => r.amount > 0).reduce((a, r) => a + r.amount, 0);
  const money_out = -rows.filter((r) => r.amount < 0).reduce((a, r) => a + r.amount, 0);
  const tally: Record<string, number> = { open: 0, receipt: 0, problem: 0, reconciled: 0 };
  for (const r of rows) tally[r.state]++;
  return {
    rows,
    count: rows.length,
    money_in,
    money_out,
    tally,
    vat: HUXLEY ? null : { to_pay: Math.round((money_in - money_out) * 0.2 * 100) / 100, final: tally.open === 0 },
  };
}

const lastYear = new Date().getUTCFullYear() - 1;

const position = {
  basis:
    "A template: the last filed balance sheet, then everything since. In your own app, these come from your company's real accounts.",
  filed: {
    last: {
      period_end: `${lastYear}-03-31`,
      approved: `${lastYear}-11-14`,
      fixed_assets: 3200,
      current_assets: 48600,
      creditors_within_one_year: 12400,
      net_current_assets: 36200,
      total_assets_less_current_liabilities: 39400,
      creditors_after_one_year: 10000,
      net_assets: 29400,
    },
    prior: {
      period_end: `${lastYear - 1}-03-31`,
      fixed_assets: 1800,
      current_assets: 22100,
      creditors_within_one_year: 9300,
      net_current_assets: 12800,
      total_assets_less_current_liabilities: 14600,
      creditors_after_one_year: 0,
      net_assets: 14600,
    },
  },
  since: `1 April ${lastYear}`,
  cash: { gbp: 61842.17, other: [] as { balance: string; currency: string }[] },
  movements: [
    { label: "Sales", currency: "GBP", amount: 84300, count: 41, firm: true },
    { label: "Grants", currency: "GBP", amount: 24000, count: 3, firm: true },
    { label: "Wages", currency: "GBP", amount: -54000, count: 10, firm: true },
    { label: "Software and hosting", currency: "GBP", amount: -3870, count: 58, firm: false },
  ],
  results: { income: 108300, expenses: 71400, note: "Before tax and depreciation." },
  directors_loan: {
    reading: "Alice is owed £230 for expenses paid personally this month.",
    caveat: "A template reading. Your own app works this out and says what it is unsure of.",
  },
  cannot: [
    "Corporation tax for this year, until the year closes.",
    "Two card payments with no receipt.",
  ],
};

const shares = {
  company: SAMPLE_COMPANY,
  number: "00000000",
  incorporated: `${lastYear - 2}-06-01`,
  issued: 1000,
  members: [
    { name: "Alice", shares: 450, class: "ordinary", pct: 0.45 },
    { name: "Bob", shares: 450, class: "ordinary", pct: 0.45 },
    { name: "Carol", shares: 100, class: "ordinary", pct: 0.1 },
  ],
  psc: [
    { name: "Alice", since: `${lastYear - 2}-06-01`, nature: ["Holds more than 25% but not more than 50% of the shares"] },
    { name: "Bob", since: `${lastYear - 2}-06-01`, nature: ["Holds more than 25% but not more than 50% of the shares"] },
  ],
  convertibles: [
    { holder: "Angel investor A", principal_gbp: 25000, cap_gbp: 1000000, discount_pct: 20, status: "signed", firm: true },
  ],
  proForma: {
    rows: [
      { holder: "Alice", shares: 450, kind: "ordinary", pct: 0.4389 },
      { holder: "Bob", shares: 450, kind: "ordinary", pct: 0.4389 },
      { holder: "Carol", shares: 100, kind: "ordinary", pct: 0.0975 },
      { holder: "Angel investor A", shares: 25, kind: "on conversion", pct: 0.0247 },
    ],
    warnings: [],
    left_out: [],
  },
  events: [
    { date: `${lastYear - 2}-06-01`, type: "incorporation", shares: 900, status: "filed" },
    { date: `${lastYear - 1}-02-10`, type: "allotment", shares: 100, to: "Carol", status: "filed" },
  ],
  open: ["Confirmation statement due next month."],
};

const raise = {
  rounds: [
    {
      id: "seed",
      name: "Seed round",
      status: "open",
      terms: { cap: 2000000, discount: 20 },
      committed: 85000,
      preconditions: [
        { id: "deck", what: "Deck and one-page summary agreed", applies: true, done: true },
        { id: "seis", what: "SEIS advance assurance received", applies: true, done: true },
        { id: "terms", what: "Template agreement checked by a lawyer", applies: true, done: false },
      ],
      investors: [
        { id: "a", name: "Angel investor A", stage: "committed", amount: 50000, open: [], last: { at: "last week", what: "Agreed the terms on a call." }, next: { label: "Send the agreement" } },
        { id: "b", name: "Angel investor B", stage: "talking", amount: 35000, open: ["Wants to see this year's figures"], last: { at: "yesterday", what: "Asked for the accounts." }, next: { label: "Share the accounts" } },
        { id: "c", name: "Fund C", stage: "first call", amount: null, open: ["Book a second meeting"], last: null, next: null },
      ],
    },
  ],
};

const longDate = (d: string) =>
  new Date(`${d}T00:00:00Z`).toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" });

const huxleyPosition = {
  basis:
    "A sample. Huxley Sessions Ltd is new, so nothing is filed yet. This is everything since it was registered. In your own app, these come from your company's real accounts.",
  since: longDate(incorporated),
  cash: { gbp: 9842.17, other: [] as { balance: string; currency: string }[] },
  movements: [
    { label: "Sessions", currency: "GBP", amount: 14650, count: 19, firm: true },
    { label: "Wages", currency: "GBP", amount: -5800, count: 2, firm: true },
    { label: "Equipment", currency: "GBP", amount: -3120, count: 9, firm: false },
    { label: "Desks and storage from Huxley", currency: "GBP", amount: -1200, count: 3, firm: true },
  ],
  results: { income: 14650, expenses: 10640, note: "Before tax and depreciation." },
  directors_loan: {
    reading: "Alice is owed £96 for expenses paid personally this month.",
    caveat: "A sample reading. Your own app works this out and says what it is unsure of.",
  },
  cannot: [
    "Corporation tax, until the first year closes.",
    "Whether the pilot kit passes to the company as a gift or at cost. Members vote on Thursday.",
  ],
};

const huxleyShares = {
  company: SAMPLE_COMPANY,
  number: "00000000",
  incorporated,
  issued: 10000,
  members: [
    { name: "Alice", shares: 4000, class: "ordinary", pct: 0.4 },
    { name: "Bob", shares: 3000, class: "ordinary", pct: 0.3 },
    { name: "Carol", shares: 2000, class: "ordinary", pct: 0.2 },
    { name: "Huxley, held in trust for its members", shares: 1000, class: "ordinary", pct: 0.1 },
  ],
  psc: [
    { name: "Alice", since: incorporated, nature: ["Holds more than 25% but not more than 50% of the shares"] },
    { name: "Bob", since: incorporated, nature: ["Holds more than 25% but not more than 50% of the shares"] },
  ],
  proForma: {
    rows: [
      { holder: "Alice", shares: 4000, kind: "ordinary", pct: 0.32 },
      { holder: "Bob", shares: 3000, kind: "ordinary", pct: 0.24 },
      { holder: "Carol", shares: 2000, kind: "ordinary", pct: 0.16 },
      { holder: "Huxley, in trust", shares: 1000, kind: "ordinary", pct: 0.08 },
      { holder: "Seed investors", shares: 2500, kind: "if the round closes", pct: 0.2 },
    ],
    warnings: [],
    left_out: [],
  },
  events: [
    { date: incorporated, type: "incorporation", shares: 9000, status: "filed" },
    { date: incorporated, type: "allotment", shares: 1000, to: "Huxley, in trust", status: "filed" },
  ],
  open: ["The seed round's shares, when it closes."],
};

const huxleyRaise = {
  rounds: [
    {
      id: "seed",
      name: "Seed round",
      status: "open",
      terms: { price: 60, premoney: 600000 },
      target: 150000,
      relief: "SEIS, advance assurance received",
      committed: 68000,
      preconditions: [
        { id: "vote", what: "Members agreed to the company, in Huxley's record", applies: true, done: true },
        { id: "deck", what: "Deck and one-page summary agreed", applies: true, done: true },
        { id: "seis", what: "SEIS advance assurance from HMRC", applies: true, done: true },
        { id: "terms", what: "Subscription agreement checked by a lawyer", applies: true, done: false },
      ],
      investors: [
        { id: "a", name: "Angel investor A", stage: "committed", amount: 50000, open: [], last: { at: "last week", what: "Agreed the price on a call." }, next: { label: "Send the agreement" } },
        {
          id: "m",
          name: "Huxley members, together",
          stage: "committed",
          amount: 18000,
          open: ["Fourteen members, from £250 each, on the same terms as anyone else"],
          last: { at: "Thursday", what: "Pledged at Work in progress. Some gave to the roof." },
          next: { label: "Send the members' offer" },
        },
        { id: "b", name: "Angel investor B", stage: "talking", amount: 35000, open: ["Wants to see next term's bookings"], last: { at: "yesterday", what: "Asked for the bookings." }, next: { label: "Share the bookings" } },
        { id: "c", name: "Music fund C", stage: "first call", amount: null, open: ["Book a second meeting"], last: null, next: null },
      ],
    },
  ],
};

/** What the console would answer for `path`, from the template. */
export function sampleOps(path: string): unknown {
  const url = new URL(path, "https://demo.invalid");
  switch (url.pathname) {
    case "/api/ops/me":
      return sampleMe;
    case "/api/ops/accounts":
      return accounts(url.searchParams.get("from") ?? iso(new Date()));
    case "/api/ops/position":
      return HUXLEY ? huxleyPosition : position;
    case "/api/ops/shares":
      return HUXLEY ? huxleyShares : shares;
    case "/api/ops/raise":
      return HUXLEY ? huxleyRaise : raise;
    default:
      throw new Error("The template has nothing here.");
  }
}

// ── chat ────────────────────────────────────────────────────────────────────

export interface SampleMessage {
  from: string;
  body: string;
  /** minutes before now */
  ago: number;
}

export interface SampleRoom {
  id: string;
  name: string;
  unread?: boolean;
  messages: SampleMessage[];
}

const HUXLEY_ROOMS: SampleRoom[] = [
  {
    id: "members",
    name: `${name} members`,
    messages: [
      { from: "Bob", body: `Morning all. Notes from yesterday's meeting are in the shared notes.`, ago: 190 },
      { from: "Carol", body: "Thanks Bob. I've added the two dates we talked about.", ago: 172 },
      { from: "Alice", body: "Quick call at 3 to agree next month's plan?", ago: 64 },
      { from: "Bob", body: "Works for me. I'll start it from this room.", ago: 58 },
    ],
  },
  {
    id: "announcements",
    name: "Announcements",
    unread: true,
    messages: [
      { from: "Carol", body: `Welcome to ${name}'s own app. Chat, calls, notes and the books, in one window.`, ago: 1440 },
      { from: "Carol", body: "The magazine has a new issue out this week.", ago: 30 },
    ],
  },
  {
    id: "bob",
    name: "Bob",
    messages: [
      { from: "Bob", body: "Have you got a minute to look at the budget before Friday?", ago: 12 },
    ],
  },
];

/** Rooms for a visitor's own sketch: their room names, the same small talk. */
function shapedRooms(sh: NonNullable<typeof shaped>): SampleRoom[] {
  const [a, b, c] = [...sh.rooms, "Announcements", "Planning"];
  return [
    {
      id: "members",
      name: a,
      messages: [
        { from: "Bob", body: `Notes from ${sh.call.name} are in the shared notes.`, ago: 190 },
        { from: "Carol", body: "Thanks Bob. I've added the two dates we talked about.", ago: 172 },
        { from: "Alice", body: "Quick call at 3 to agree next month's plan?", ago: 64 },
        { from: "Bob", body: "Works for me. I'll start it from this room.", ago: 58 },
      ],
    },
    {
      id: "announcements",
      name: b,
      unread: true,
      messages: [
        { from: "Carol", body: `Welcome to ${name}'s own app. Everything we do together, in one window.`, ago: 1440 },
        sh.plugins.includes("magazine")
          ? { from: "Carol", body: `${sh.publication.name} is out, with a piece from Alice.`, ago: 30 }
          : { from: "Carol", body: `${sh.call.name} is on ${sh.call.cadence}.`, ago: 30 },
      ],
    },
    { id: "third", name: c, messages: [{ from: "Alice", body: "I've put the list in the shared notes.", ago: 300 }] },
    { id: "bob", name: "Bob", messages: [{ from: "Bob", body: "Have you got a minute to look at this before Friday?", ago: 12 }] },
  ];
}

export const sampleRooms: SampleRoom[] = shaped ? shapedRooms(shaped) : HUXLEY_ROOMS;

// ── the agent ───────────────────────────────────────────────────────────────

/** Scripted answers for the demo agent; `places` become buttons into the app,
 *  and `ask` (when set) is offered as a question to try. */
export interface SampleAnswer {
  match: (q: string) => boolean;
  a: string;
  places: string[];
  ask?: string;
}

const rx = (r: RegExp) => (q: string) => r.test(q);
/** A sketched question matches when two of its longer words are in what was asked. */
const like = (question: string) => {
  const words = question.toLowerCase().match(/[a-z]{4,}/g) ?? [];
  return (q: string) => words.filter((w) => q.toLowerCase().includes(w)).length >= Math.min(2, words.length);
};

/** Where a sketched answer should send someone: the plugins it names. */
function placesIn(text: string): string[] {
  const t = text.toLowerCase();
  const out: string[] = [];
  if (shaped) shaped.made.forEach((m, i) => t.includes(m.title.toLowerCase()) && out.push(`made-${i + 1}`));
  if (shaped && t.includes(shaped.publication.name.toLowerCase())) out.push("magazine");
  for (const [id, words] of [
    ["fundraise", /initiative|raise|fund/],
    ["operations", /operations|books|invoice|accounts/],
    ["structure", /structure|charity|co-operative|association|legal/],
    ["chat", /chat|room/],
    ["meet", /call|meeting/],
  ] as const)
    if (words.test(t)) out.push(id);
  return [...new Set(out)].slice(0, 3);
}

// Huxley's own story: gifts as a group, then a company for the part that earns.
const HUXLEY_ANSWERS: SampleAnswer[] = [
  {
    match: rx(/spend|card|receipt|pay for/i),
    a: "Huxley has its own debit card, and the stewards can give a member a card for one job, with a budget and an end date. Bob's spends only from the bursaries pocket, up to £300 a month. Every payment shows what it was for, whose card paid and its receipt, and anything over £500 needs a second steward's passkey. Huxley Sessions Ltd has its own account and cards, kept apart from the collective's.",
    places: ["spend", "fundraise"],
    ask: "Who can spend Huxley's money?",
  },
  {
    match: rx(/\bseis\b|\beis\b|tax relief/i),
    a: "SEIS, the Seed Enterprise Investment Scheme, gives people who buy new shares in a young UK company income tax relief, which makes a small, early investment worth the risk. The company has to be under three years old with under £350,000 in assets, and it can raise up to £250,000 this way in all. Huxley Sessions has HMRC's advance assurance, which says its round should qualify. EIS works the same way for later, larger rounds.",
    places: ["operations"],
  },
  {
    match: rx(/(became|become|becoming) a company|startup|huxley sessions|invest/i),
    a: "Huxley raised its first money as a group with no legal form: gifts for the roof, bursaries and a recording kit that travels. The kit started earning, and growing it needed about £150,000, which is investment rather than gifts. Investors need a company to own a share of, so the sessions became Huxley Sessions Ltd. The collective stays a group and holds a tenth for its members.",
    places: ["fundraise", "structure", "operations"],
    ask: "How did Huxley become a company?",
  },
];

export const sampleAnswers: SampleAnswer[] = [
  ...(shaped?.answers ?? []).map((x) => ({ match: like(x.q), a: x.a, places: placesIn(x.a), ask: x.q })),
  ...(HUXLEY ? HUXLEY_ANSWERS : []),
  {
    match: rx(/new|start/i),
    a: `Start in Profile and sign in with a passkey. Then Chat puts you in the room with everyone. Operations shows the books if you run the ${shaped?.kind === "company" ? "company" : "organisation"}.`,
    places: ["identity", "chat", "operations"],
  },
  {
    match: rx(/what can|do\?|app do/i),
    a: `Everything ${name} does together, in one window: ${
      shaped
        ? "the plugins down the side, chosen for how you work"
        : "chat, calls, your publication, initiatives and the books"
    }. Add more from Plugins as you grow.`,
    places: ["chat", "notes"],
  },
  {
    match: rx(/organi[sz]ation|charit|co-?op|compan|community|kind of group|any group|who is it for/i),
    a: `Any group: a community, company, charity, co-op, or one that hasn't decided. Start with nothing set up and add plugins as you need them. When you need a legal form, Structure walks you through it.`,
    places: ["structure"],
    ask: "Is this only for collectives?",
  },
  {
    match: rx(/cost|price|pay for|how much|charge/i),
    a: `It depends on use, and you can always see it in Settings, under Billing. Every line shows as it happens, from my answers to an expert's hours on your set-up.`,
    places: [],
    ask: "What does it cost?",
  },
  {
    match: rx(/structure|legal|incorporat|register|constitution|bank account/i),
    a: `Open Structure to see where ${name} is now and the next form that fits. I draft the papers, someone from Decent checks them, and members approve them.`,
    places: ["structure"],
  },
  {
    match: rx(/what is|who/i),
    a: `In the real app I answer from ${name}'s own documents, with sources. In this demo I read from a script.`,
    places: [],
  },
];

export const sampleFallback = {
  a: `In this demo I answer from a script. Once members have logins, I answer from ${name}'s own documents.`,
  places: ["identity"],
};

// ── the publication ─────────────────────────────────────────────────────────

export interface SamplePiece {
  id: string;
  title: string;
  dek: string;
  by: string;
  minutes: number;
  body: string[];
  /** the initiative this piece makes the case for (`sampleInitiatives`) */
  initiative?: string;
  /** a step it made the case for that lives in another plugin (Huxley's company, in Structure) */
  leads?: { plugin: string; title: string; status: string; button: string };
  /** an illustration under `public/`, and the member who made it (a pack may say whose photograph it is) */
  art?: { src: string; by: string; alt: string; credit?: string };
  /** the piece's own ink, so the issue reads as many hands rather than one */
  ink?: string;
  /** a line pulled from the body to set large */
  pull?: string;
  /** what members said back, kept beside the piece */
  replies?: { by: string; text: string }[];
}

export interface SamplePublication {
  name: string;
  issue: string;
  line: string;
  /** the issue's cover illustration and who drew it */
  cover?: { src: string; by: string; alt: string; credit?: string };
  pieces: SamplePiece[];
}

// The Review is printed the way a studio prints a zine: three inks on off-white paper.
// A group's pack may bring its own paper and inks (`look`), and then every page
// printed in Riso prints in those instead. The names stay as slots.
const LOOK = shaped?.look;
export const RISO = LOOK
  ? { pink: LOOK.inks[0], blue: LOOK.inks[1], yellow: LOOK.inks[2], paper: LOOK.paper }
  : { pink: "#ff48b0", blue: "#0078bf", yellow: "#ffd400", paper: "#fbf7ee" };
const INKS = [RISO.pink, RISO.blue, RISO.yellow];

const HUXLEY_REVIEW: SamplePublication = {
  name: "The Huxley Review",
  issue: "The story so far",
  line: "Written and drawn by members, for everyone in the building.",
  cover: { src: "/huxley/review/cover.webp", by: "Erin", alt: "Huxley's building cut open, every room busy" },
  pieces: [
    {
      id: "roof",
      art: { src: "/huxley/review/roof.webp", by: "Dave", alt: "Rain falling into buckets in the big room" },
      ink: RISO.pink,
      pull: "Patching it again buys one more winter at most.",
      replies: [
        { by: "Bob", text: "I'll move the piano back once it's done. Count me in for £50." },
        { by: "Erin", text: "Put the survey up in the hall too, for people not on the app?" },
      ],
      title: "The big room needs a roof",
      dek: "From Nº 1. Huxley's first initiative, before it had a bank account.",
      by: "Carol",
      minutes: 4,
      initiative: "roof",
      body: [
        "Every winter since we moved in, the big room has leaked in the same two places. We put buckets out, move the piano and lose a month of bookings. In September I asked a roofer to survey it properly, and the survey is in the shared notes.",
        "The short version: patching it again buys one more winter at most. A new covering on the flat section, with new flashing where it meets the wall, costs about £18,000 and should last twenty-five years. That's the figure we would raise for.",
        "The money is everyone's business, so I'm writing this first. Read the survey, ask me anything in Chat, and say at Work in progress on Thursday whether this should be our first initiative.",
      ],
    },
    {
      id: "kit",
      art: { src: "/huxley/review/kit.webp", by: "Erin", alt: "A recording session at a care home kitchen table" },
      ink: RISO.blue,
      pull: "I'll run it for a year and report back here.",
      replies: [
        { by: "Carol", text: "The care home asked again yesterday. I'll take the first session." },
        { by: "Bob", text: "Make it two cases, not one. Things break." },
      ],
      title: "A studio that travels",
      dek: "From Nº 4. The piece that started Huxley Sessions.",
      by: "Alice",
      minutes: 3,
      initiative: "kit",
      body: [
        "Half the people who ask to record with us can't get here: carers, people without a car, the care home round the corner. Two mics, an interface and a case would let a session happen in a school hall or a kitchen.",
        "It would cost about £3,200. If members agree, we raise it the way we raised the roof, and I'll run it for a year and report back here.",
      ],
    },
    {
      id: "bursaries",
      art: { src: "/huxley/review/bursaries.webp", by: "Dave", alt: "Six young members at work in the studio" },
      ink: RISO.yellow,
      pull: "One found it wasn't for her and told us why, which changed how we pair mentors.",
      replies: [
        { by: "Alice", text: "I'll mentor again. It was the best part of my year." },
      ],
      title: "The bursary six, one year in",
      dek: "Bob asks last year's six how it went, and makes the case for six more.",
      by: "Bob",
      minutes: 5,
      initiative: "bursaries",
      body: [
        "A year ago a hundred and twelve people gave £9,350 so that six people under twenty-one could have a year's membership, studio time and a mentor. This is what they did with it, in their words and with their agreement.",
        "Two of them released their first records. One now runs the Tuesday print session. One found it wasn't for her and told us why, which changed how we pair mentors. Every pound is accounted for in the record, and every giver can see where it went.",
        "Members agreed to do it again, so six more places are raising now. It stays a gift, not an investment. The bursaries belong to the collective, not the company.",
      ],
    },
    {
      id: "open-day",
      art: { src: "/huxley/review/openday.webp", by: "Dave", alt: "The doors open onto the street on a Saturday" },
      ink: RISO.pink,
      replies: [
        { by: "Carol", text: "Tea's sorted. Who does the sound?" },
        { by: "Dave", text: "I'll print the posters." },
      ],
      title: "Open the doors",
      dek: "Most of the street has never been inside. Bob makes the case for one Saturday a year.",
      by: "Bob",
      minutes: 2,
      initiative: "open-day",
      body: [
        "One Saturday a year with the doors open, tea, and short sets in every room. It costs little and it's how the street gets to know what happens in here.",
        "It's an idea until someone takes it on. Carol has offered to run the tea.",
      ],
    },
    {
      id: "sessions",
      art: { src: "/huxley/review/sessions.webp", by: "Erin", alt: "Loading cases of recording kit into a van outside a school" },
      ink: RISO.blue,
      pull: "The collective stays exactly as it is.",
      replies: [
        { by: "Bob", text: "I voted against. I'm glad the tenth keeps a say, and that's in the record too." },
        { by: "Carol", text: "Investing £500. Same terms as anyone, which is the point." },
      ],
      title: "Why Huxley Sessions became a company",
      dek: "Nº 7. A £3,410 idea that schools now book every week. Alice on why it needed investors.",
      by: "Alice",
      minutes: 4,
      leads: {
        plugin: "structure",
        title: "Huxley Sessions Ltd, a new company",
        status: "agreed by members · registered · raising its first round",
        button: "See it in Structure",
      },
      body: [
        "Two winters ago forty-seven people gave £3,410 for one recording kit that could travel. It was meant for the care home round the corner. Since then fourteen schools and three care homes have booked it, and the council's music service pays for a session every week.",
        "Donations got us here, but can't take us further. Ten kits and two producers cost about £150,000 over two years. The sessions now earn money, so it's fair to ask people to invest rather than give.",
        "Investors need something to own, and SEIS tax relief only applies to shares in a young UK company. So the sessions became Huxley Sessions Ltd. The collective stays exactly as it is. It holds a tenth of the company for its members and rents it desks and storage. Any member can invest on the same terms as anyone else.",
        "Members voted for it at Work in progress, fifteen to two, with their reasons in the record. Structure shows how the company was set up. Operations shows its books and the round.",
      ],
    },
    {
      id: "wip",
      art: { src: "/huxley/review/wip.webp", by: "Dave", alt: "An evening of showing work in a circle of chairs" },
      ink: RISO.yellow,
      replies: [
        { by: "Erin", text: "Bring the zine proofs next week?" },
      ],
      title: "What we heard at Work in progress",
      dek: "Notes from the last three Thursdays, agreed by the people who spoke.",
      by: "Bob",
      minutes: 2,
      body: [
        "Eleven people showed work in three weeks: two albums in progress, a zine, posters for the open day and Alice's plan for Huxley Sessions. The two who voted against the company wanted the collective's tenth to keep a say, and it does.",
        "Two ideas came up more than once: six more bursaries, and an open studio day for the street. The bursaries are raising now. The open day is waiting for someone to run it.",
      ],
    }
  ],
};

/** The publication of a visitor's own sketch: their name for it, their pieces. */
function shapedPublication(sh: NonNullable<typeof shaped>): SamplePublication {
  return {
    name: sh.publication.name,
    issue: sh.publication.issue || "Nº 1",
    line: sh.publication.line || `Written by members, for everyone in ${name}.`,
    cover: sh.publication.cover,
    pieces: sh.publication.pieces.map((p, i) => ({
      id: `p${i}`,
      title: p.title,
      dek: p.dek,
      by: p.by,
      minutes: Math.max(1, Math.round(p.body.split(" ").length / 120) + 1),
      body: p.body.split(/(?<=[.?])\s+(?=[A-Z])/).reduce<string[]>((paras, sentence, n) => {
        // two sentences to a paragraph reads better on a phone
        if (n % 2 === 0) paras.push(sentence);
        else paras[paras.length - 1] += ` ${sentence}`;
        return paras;
      }, []),
      initiative: p.initiative !== undefined ? `i${p.initiative}` : undefined,
      ink: INKS[i % INKS.length],
      art: p.art,
      pull: p.pull,
    })),
  };
}

/** The demo's own publication: an invented organisation's, never Decent's magazine.
 *  Null in a partner's demo, which shows Decent Magazine live instead. */
export const samplePublication: SamplePublication | null = shaped
  ? shapedPublication(shaped)
  : edition.showcase
    ? HUXLEY_REVIEW
    : null;

// ── fundraise ───────────────────────────────────────────────────────────────

export interface SampleInitiative {
  id: string;
  title: string;
  status: string;
  need?: string;
  ask?: string;
  target?: number;
  raised?: number;
  donations?: number;
  currency?: string;
  opened?: string;
  closed?: string;
  url?: string;
  rail?: string;
  sparks?: { text: string; by?: string }[];
  /** the piece in the publication that made the case for it */
  story?: string;
}

const today = iso(new Date());

/** What a demo edition with no shared record shows in Fundraise. Invented, like
 *  everything here: no campaign page exists, so the give button says so. */
const HUXLEY_INITIATIVES: SampleInitiative[] = [
  {
    id: "bursaries",
    title: "Six more bursaries for young members",
    status: "open",
    ask: "A year's membership, studio time and a mentor for six more people under 21. A gift, not an investment.",
    target: 9000,
    raised: 5120,
    donations: 61,
    currency: "GBP",
    opened: day(today, -25),
    url: "https://demo.invalid/give/bursaries",
    rail: "the campaign page",
    story: "bursaries",
  },
  {
    id: "roof",
    title: "A new roof for the studio",
    status: "funded",
    ask: "The big room leaked every winter. Huxley's first initiative, raised before it had any legal form.",
    target: 18000,
    raised: 18420,
    donations: 204,
    currency: "GBP",
    opened: day(today, -760),
    closed: day(today, -700),
    url: "https://demo.invalid/give/roof",
    story: "roof",
  },
  {
    id: "kit",
    title: "A recording kit that travels",
    status: "funded",
    ask: "Two mics, an interface and a case for sessions in school halls and kitchens. It grew into Huxley Sessions.",
    target: 3200,
    raised: 3410,
    donations: 47,
    currency: "GBP",
    opened: day(today, -560),
    closed: day(today, -530),
    url: "https://demo.invalid/give/kit",
    story: "kit",
  },
  {
    id: "bursaries-1",
    title: "Six bursaries for young members",
    status: "funded",
    ask: "A year's membership, studio time and a mentor for six people under 21.",
    target: 9000,
    raised: 9350,
    donations: 112,
    currency: "GBP",
    opened: day(today, -410),
    closed: day(today, -350),
    url: "https://demo.invalid/give/bursaries-1",
    story: "bursaries",
  },
  {
    id: "open-day",
    title: "An open studio day",
    status: "proposed",
    need: "Most of the street has never been inside.",
    ask: "One Saturday a year with the doors open, tea, and short sets in every room.",
    sparks: [{ text: "I'll run the tea if someone runs the sound.", by: "Carol" }],
    story: "open-day",
  },
];

function shapedInitiatives(sh: NonNullable<typeof shaped>): SampleInitiative[] {
  return sh.initiatives.map((x, n) => {
    const story = sh.publication.pieces.findIndex((p) => p.initiative === n);
    const base = { id: `i${n}`, title: x.title, status: x.status, story: story >= 0 ? `p${story}` : undefined };
    if (x.status === "proposed") return { ...base, ask: x.ask, sparks: [{ text: "I'd help run this.", by: "Carol" }] };
    return {
      ...base,
      ask: x.ask,
      target: x.target,
      raised: x.raised,
      donations: Math.max(3, Math.round(x.raised / 120)),
      currency: "GBP",
      opened: day(today, x.status === "funded" ? -200 : -30),
      closed: x.status === "funded" ? day(today, -110) : undefined,
      url: `https://demo.invalid/give/i${n}`,
      rail: x.status === "open" ? "the campaign page" : undefined,
    };
  });
}

export const sampleInitiatives: SampleInitiative[] = shaped ? shapedInitiatives(shaped) : HUXLEY_INITIATIVES;
