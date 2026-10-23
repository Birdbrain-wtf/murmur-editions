/**
 * "What are you looking for?": the demo, reshaped around one visitor's group.
 *
 * At the end of the walkthrough in an invented demo edition (`showcase`, Huxley),
 * a visitor says in a sentence what their group is and what it needs. A sketch
 * of their own app comes back (`Shape`): a name, the plugins it would carry and
 * in what order, a first issue of its publication, the initiatives it might
 * raise for, its regular call, who can do what, the stage it is at and the next
 * one, and a plugin or two made just for it. The window then reloads as that
 * organisation, with sample data throughout, and walks them through it.
 *
 * The sketch is written by our own model on www.decent.partners
 * (infra/services/app-updates/shape.ts) and always passes through
 * `normaliseShape` here, which clamps every field to what the app can draw.
 * When the model is slow, busy or unreachable, `composeShape` makes one from
 * templates, so the visitor always gets an answer.
 *
 * This file is shared by the app and the server, so it imports nothing.
 */

export type Level = "none" | "see" | "join" | "run";
export type OrgKind = "community" | "company" | "charity" | "co-operative" | "collective";
export type Form = "none" | "association" | "charity" | "co-operative" | "cic" | "company";
export type IconName =
  | "calendar"
  | "briefcase"
  | "users"
  | "package"
  | "map-pin"
  | "clipboard"
  | "film"
  | "heart"
  | "store"
  | "sprout"
  | "book"
  | "wrench"
  | "tv";

/** Plugins a sketch may carry, besides the agent (always first). */
export const SHAPE_PLUGINS = ["magazine", "fundraise", "meet", "chat", "operations", "structure"] as const;
export const ICONS: IconName[] = [
  "calendar",
  "briefcase",
  "users",
  "package",
  "map-pin",
  "clipboard",
  "film",
  "heart",
  "store",
  "sprout",
  "book",
  "wrench",
  "tv",
];
const KINDS: OrgKind[] = ["community", "company", "charity", "co-operative", "collective"];
const FORMS: Form[] = ["none", "association", "charity", "co-operative", "cic", "company"];
const LEVELS: Level[] = ["none", "see", "join", "run"];

export interface Piece {
  title: string;
  dek: string;
  body: string;
  by: string;
  /** the initiative this piece makes the case for (index into `initiatives`) */
  initiative?: number;
  /** a pack only: the piece's picture, and a line from the body to set large */
  art?: Art;
  pull?: string;
}

/** A pack only: a picture under `public/packs/<edition>/`, who made it and what it shows. */
export interface Art {
  src: string;
  by: string;
  alt: string;
  /** the caption, when it is not "Drawn by <by>, a member": whose photograph, or that it was made for the sketch */
  credit?: string;
}

/** A pack only: the group's own paper and three inks, laid over the Riso the demo prints in. */
export interface Look {
  paper: string;
  inks: [string, string, string];
  /** the colours each section wears in its header and rail button, in rail order */
  palette?: string[];
}

export interface Initiative {
  title: string;
  ask: string;
  target: number;
  raised: number;
  status: "open" | "funded" | "proposed";
}

export interface Made {
  title: string;
  tagline: string;
  icon: IconName;
  sections: { label: string; items: { title: string; detail: string; status?: string }[] }[];
  /** a pack only: the picture at the top of the plugin */
  hero?: Art;
  /** a pack only: a live experiment on one of our own sites, played inside the plugin */
  live?: Live;
  /** a pack only: artist pages, each with its films, photographs, records and events */
  profiles?: Profile[];
}

export interface Live {
  src: string;
  /** what it is, under the frame */
  label: string;
}

/** Where a pack's films play from: Four To The Floor's own Cloudflare Stream account
 *  (the same host its site plays from). A film is its 32-character id there. */
export const FILM_HOST = "https://customer-i2rk13nwwjpeip2z.cloudflarestream.com";
export interface Film {
  id: string;
  /** what it is, under the player */
  label?: string;
}
export const filmSrc = (f: Film) => `${FILM_HOST}/${f.id}/iframe?preload=metadata&letterboxColor=transparent`;

/** One thing on an artist's page: a film, a photograph, a record or an event. */
export type ReleaseKind = "film" | "photograph" | "record" | "event";
export interface Release {
  kind: ReleaseKind;
  title: string;
  line: string;
  /** when it is, or was: a date, "pre-order", "out now" */
  when?: string;
  status?: string;
  /** a sample price, for records and tickets */
  price?: string;
  art?: Art;
  /** a film plays in the page's player */
  film?: Film;
}

/** A pack only: an artist's page inside a made plugin. The film and the record live
 *  in one place, with the credits, so the person the film moves buys it in one tap. */
export interface Profile {
  slug: string;
  name: string;
  line: string;
  about: string;
  hero?: Art;
  /** the film at the top of the page */
  film?: Film;
  /** short facts: members, home, since */
  facts?: [string, string][];
  releases: Release[];
}

export interface Shape {
  /** what the visitor typed; kept on their computer, never on ours */
  asked: string;
  /** who wrote it: our model, the templates when the model was not there, or
   *  Decent, for a group we are onboarding (a pack, `demo/packs/<edition>.json`) */
  source: "model" | "template" | "pack";
  name: string;
  kind: OrgKind;
  summary: string;
  /** roughly how many people */
  size: number;
  /** the rail, top to bottom, after the agent: ids from SHAPE_PLUGINS and `made-<n>` */
  plugins: string[];
  publication: { name: string; pieces: Piece[]; issue?: string; line?: string; cover?: Art };
  /** a pack only: the group's own colours for the publication and the walkthrough */
  look?: Look;
  initiatives: Initiative[];
  call: { name: string; cadence: string; line: string; weekday: number; hour: number };
  rooms: string[];
  roles: { name: string; who: string; line: string; levels: Record<string, Level> }[];
  made: Made[];
  /** where it is on the ladder (0 to 3, `STAGES`), and the form it would take next */
  stage: { now: number; next: Form; why: string };
  /** questions a member might ask the agent, with the answers it would give */
  answers: { q: string; a: string }[];
  /** set when this is one of the sample member's other groups (`demo/groups.ts`), not a visitor's sketch */
  alice?: string;
  /** a pack only: the agent's read in "How you'll use it" (a line, and up to three jobs it does when asked);
   *  drawn from the call, publication and initiatives when missing */
  brief?: { read?: string; jobs?: { ask: string; done: string; place: string }[] };
  /** a pack only: what Alice is in this group, for Profile → Her groups */
  member?: { kind: string; role: string; line: string };
}

/** The ladder an organisation climbs, from nothing. Each rung is a plugin's worth of work. */
export const STAGES = [
  {
    title: "Some people and an idea",
    line: "A name, a place to talk and write. Nothing to file.",
  },
  {
    title: "A group",
    line: "Members, roles, a regular call and a shared record. Still nothing to file.",
  },
  {
    title: "A legal form",
    line: "For a bank account, a grant, a lease or investment, pick the form that fits.",
  },
  {
    title: "Running it",
    line: "Books, filings and meetings kept up as you go.",
  },
] as const;

/** The forms a group can take, in plain words. All of them are UK forms. */
export const FORM_INFO: Record<Exclude<Form, "none">, { title: string; line: string; steps: { who: Who; what: string }[] }> = {
  association: {
    title: "An association",
    line: "The lightest form: a written constitution. Members can be personally liable.",
    steps: [
      { who: "agent", what: "Drafts a constitution from how the group works" },
      { who: "members", what: "Adopt it with a vote" },
      { who: "expert", what: "Helps open a bank account in the group's name" },
      { who: "agent", what: "Keeps the members' list and minutes" },
    ],
  },
  charity: {
    title: "A charity (CIO)",
    line: "Its own legal person, run by trustees. Can apply for most grants.",
    steps: [
      { who: "agent", what: "Writes down the purposes and who benefits" },
      { who: "expert", what: "Checks the purposes and picks a constitution" },
      { who: "members", what: "Agree who the first trustees are" },
      { who: "expert", what: "Applies to the Charity Commission with the trustees" },
      { who: "agent", what: "Keeps minutes and annual returns" },
    ],
  },
  "co-operative": {
    title: "A co-operative",
    line: "Owned by its members, one member one vote. Can raise money with community shares.",
    steps: [
      { who: "agent", what: "Drafts the rules from how the group decides" },
      { who: "members", what: "Agree the rules and first directors" },
      { who: "expert", what: "Registers the society with the FCA" },
      { who: "agent", what: "Moves shares and votes into the record" },
    ],
  },
  cic: {
    title: "A community interest company",
    line: "A company for a community, with its assets locked to that purpose.",
    steps: [
      { who: "agent", what: "Drafts the community interest statement" },
      { who: "expert", what: "Prepares the articles with an asset lock" },
      { who: "members", what: "Agree the first directors" },
      { who: "expert", what: "Registers it at Companies House" },
      { who: "agent", what: "Keeps the annual report and filings" },
    ],
  },
  company: {
    title: "A company",
    line: "Limited by shares. The form for trading and investment.",
    steps: [
      { who: "agent", what: "Drafts the articles and a first share register" },
      { who: "members", what: "Agree who holds what and who directs" },
      { who: "expert", what: "Registers it at Companies House" },
      { who: "agent", what: "Sets up the books in Operations" },
    ],
  },
};

export type Who = "agent" | "expert" | "members";

/** What an access level means, for the copy around the table. */
export const LEVEL_LINES: Record<Level, string> = {
  none: "doesn't see it",
  see: "reads, can't change anything",
  join: "posts, joins, contributes",
  run: "sets it up and approves",
};

// ── storage ─────────────────────────────────────────────────────────────────

/** Kept under the home collective's own key (the invented demo is always home). */
export const SHAPE_KEY = "murmur.shape.v1";

export function readShape(): Shape | null {
  try {
    const raw = typeof localStorage !== "undefined" ? localStorage.getItem(SHAPE_KEY) : null;
    return raw ? (JSON.parse(raw) as Shape) : null;
  } catch {
    return null;
  }
}

/** Keys that hold what the demo looked like, cleared whenever its shape changes. */
export const RESET = ["murmur.installed.v2", "murmur.installed.seen.v1", "murmur.tour.v1", "murmur.agent.v1", "murmur.skin.v1"];

/** Become the sketched organisation: save it and reload, so every surface reads it. */
export function applyShape(s: Shape) {
  localStorage.setItem(SHAPE_KEY, JSON.stringify(s));
  for (const k of RESET) localStorage.removeItem(k);
  location.reload();
}

/** Back to the invented demo as it ships. */
export function clearShape() {
  localStorage.removeItem(SHAPE_KEY);
  for (const k of RESET) localStorage.removeItem(k);
  location.reload();
}

// ── checking what comes back ────────────────────────────────────────────────

const str = (v: unknown, max: number, fallback = ""): string => {
  const s = typeof v === "string" ? v.replace(/\s+/g, " ").trim() : "";
  // Sentence copy follows the house style: no long dashes and no semicolons.
  const clean = s.replace(/\s*[—–]\s*/g, ", ").replace(/;\s*/g, ". ");
  return (clean || fallback).slice(0, max);
};
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
/** Role names read as groups of people ("Founders run things"). */
const plural = (s: string) => (/(s|staff|crew|team|people|folk|committee)$/i.test(s) ? s : `${s}s`);
const num = (v: unknown, lo: number, hi: number, fallback: number) => {
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? Math.min(hi, Math.max(lo, Math.round(n))) : fallback;
};
const pick = <T extends string>(v: unknown, list: readonly T[], fallback: T): T =>
  list.includes(v as T) ? (v as T) : fallback;
const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
const obj = (v: unknown): Record<string, unknown> => (v && typeof v === "object" ? (v as Record<string, unknown>) : {});

/** Sample people are always Alice, Bob and Carol. */
const PEOPLE = ["Alice", "Bob", "Carol"];
const person = (v: unknown, i: number) => pick(v, PEOPLE, PEOPLE[i % 3]);

/** Clamp anything (the model's answer, a stored sketch) into a Shape the app can draw. */
export function normaliseShape(raw: unknown, asked: string, base: Shape): Shape {
  const r = obj(raw);
  // Up to four: a pack may carry an artist pages plugin beside the three it had.
  const madeRaw = arr(r.made).slice(0, 4).map(obj);
  const made: Made[] = madeRaw
    .map((m) => ({
      title: str(m.title, 22),
      tagline: str(m.tagline, 90),
      icon: pick(m.icon, ICONS, "clipboard"),
      sections: arr(m.sections)
        .slice(0, 3)
        .map(obj)
        .map((s) => ({
          label: str(s.label, 40, "Coming up"),
          items: arr(s.items)
            .slice(0, 5)
            .map(obj)
            .map((it) => ({ title: str(it.title, 70), detail: str(it.detail, 180), status: str(it.status, 20) || undefined }))
            .filter((it) => it.title),
        }))
        .filter((s) => s.items.length),
    }))
    .filter((m) => m.title && m.sections.length);

  const initiatives: Initiative[] = arr(r.initiatives)
    .slice(0, 4)
    .map(obj)
    .map((i, n) => {
      const target = num(i.target, 200, 500000, 5000);
      const status = pick(i.status, ["open", "funded", "proposed"] as const, n === 0 ? "open" : "proposed");
      const raised =
        status === "funded" ? Math.round(target * 1.04) : status === "open" ? num(i.raised, 0, target, Math.round(target * 0.45)) : 0;
      return { title: str(i.title, 70), ask: str(i.ask, 220), target, raised, status };
    })
    .filter((i) => i.title);

  const pieces: Piece[] = arr(obj(r.publication).pieces)
    .slice(0, 4)
    .map(obj)
    .map((p, n) => {
      const ini = typeof p.initiative === "number" ? p.initiative : -1;
      return {
        title: str(p.title, 80),
        dek: str(p.dek, 180),
        body: str(p.body, 900),
        by: person(p.by, n),
        initiative: ini >= 0 && ini < initiatives.length ? ini : undefined,
      };
    })
    .filter((p) => p.title && p.body);

  // Each initiative should have the piece that argued for it. Where the model
  // left the link out, pair it with the piece that shares most words with it.
  const words = (t: string) => new Set(t.toLowerCase().match(/[a-z]{4,}/g) ?? []);
  initiatives.forEach((ini, n) => {
    if (pieces.some((p) => p.initiative === n)) return;
    const want = words(`${ini.title} ${ini.ask}`);
    let best = -1;
    let score = 0;
    pieces.forEach((p, k) => {
      if (p.initiative !== undefined) return;
      const have = words(`${p.title} ${p.dek} ${p.body}`);
      const hits = [...want].filter((w) => have.has(w)).length;
      if (hits > score) [best, score] = [k, hits];
    });
    if (best >= 0) pieces[best].initiative = n;
  });

  const wanted = arr(r.plugins).filter((p): p is string => typeof p === "string");
  const madeIds = made.map((_, i) => `made-${i + 1}`);
  // Keep the visitor's order, but the publication always comes before the money.
  let plugins = [...new Set(wanted.filter((p) => (SHAPE_PLUGINS as readonly string[]).includes(p)))];
  if (!plugins.includes("chat")) plugins.push("chat");
  // Every sketch has a regular call, so it has somewhere to be held.
  if (!plugins.includes("meet")) plugins.splice(plugins.indexOf("chat"), 0, "meet");
  if (!plugins.includes("structure")) plugins.push("structure");
  if (!initiatives.length) plugins = plugins.filter((p) => p !== "fundraise");
  if (!pieces.length) plugins = plugins.filter((p) => p !== "magazine");
  if (plugins.includes("magazine") && plugins.includes("fundraise")) {
    plugins = plugins.filter((p) => p !== "fundraise");
    plugins.splice(plugins.indexOf("magazine") + 1, 0, "fundraise");
  }
  // What was made for them sits near the top, under the agent.
  plugins = [...madeIds, ...plugins];

  const ids = [...plugins, "agent"];
  const roles = arr(r.roles)
    .slice(0, 4)
    .map(obj)
    .map((x, n) => {
      const given = obj(x.levels);
      const levels: Record<string, Level> = {};
      // The most trusted people can always run everything.
      for (const id of ids) levels[id] = n === 0 ? "run" : pick(given[id], LEVELS, defaultLevel(id, n));
      return {
        name: plural(cap(str(x.name, 24))),
        who: n === 0 ? "Alice and 2 others" : n === 1 ? `Bob and ${Math.max(2, Math.round(num(r.size, 2, 5000, 20) * 0.6))} others` : n === 2 ? "Carol and 3 others" : "invited one at a time",
        line: str(x.line, 70),
        levels,
      };
    })
    .filter((x) => x.name);

  const call = obj(r.call);
  const stage = obj(r.stage);
  const answers = arr(r.answers)
    .slice(0, 3)
    .map(obj)
    .map((a) => ({ q: str(a.q, 80), a: str(a.a, 600) }))
    .filter((a) => a.q && a.a);

  const out: Shape = {
    asked: str(asked, 600),
    source: "model",
    name: str(r.name, 32, base.name),
    kind: pick(r.kind, KINDS, base.kind),
    summary: str(r.summary, 200, base.summary),
    size: num(r.size, 2, 5000, base.size),
    plugins: plugins.length > 2 ? plugins : base.plugins,
    publication: pieces.length
      ? { name: str(obj(r.publication).name, 32, base.publication.name), pieces }
      : base.publication,
    // An empty list is an answer (a company streamlining its work raises nothing).
    initiatives: Array.isArray(r.initiatives) ? initiatives : base.initiatives,
    call: {
      name: str(call.name, 32, base.call.name),
      cadence: str(call.cadence, 32, base.call.cadence),
      line: str(call.line, 120, base.call.line),
      weekday: num(call.weekday, 0, 6, base.call.weekday),
      hour: num(call.hour, 7, 21, base.call.hour),
    },
    rooms: arr(r.rooms).map((x) => cap(str(x, 28).replace(/^#/, "").replace(/[-_]/g, " "))).filter(Boolean).slice(0, 3),
    roles: roles.length >= 2 ? roles : base.roles,
    made: made.length ? made : base.made,
    stage: {
      now: num(stage.now, 0, 3, base.stage.now),
      next: pick(stage.next, FORMS, base.stage.next),
      why: str(stage.why, 220, base.stage.why),
    },
    answers: answers.length ? answers : base.answers,
  };
  if (!out.rooms.length) out.rooms = base.rooms;
  // Already the form it would take next: it has arrived.
  const same: Partial<Record<OrgKind, Form>> = { company: "company", charity: "charity", "co-operative": "co-operative" };
  if (out.stage.now >= 2 && same[out.kind] === out.stage.next) out.stage = { ...out.stage, now: 3, next: "none" };
  // Anything the model left out comes from the template, so the rail and the rest agree.
  if (!made.length) out.plugins = [...base.made.map((_, i) => `made-${i + 1}`), ...out.plugins.filter((p) => !p.startsWith("made-"))];
  for (const role of out.roles) for (const id of out.plugins) role.levels[id] ??= defaultLevel(id, out.roles.indexOf(role));
  return out;
}

/** A sensible level when none is given: the first role runs things, the last only looks. */
function defaultLevel(id: string, roleIndex: number): Level {
  if (roleIndex === 0) return "run";
  if (id === "operations" || id === "structure") return roleIndex === 1 ? "see" : "none";
  if (roleIndex >= 3) return id === "chat" || id === "meet" ? "join" : id === "magazine" || id === "fundraise" ? "see" : "none";
  return "join";
}

// ── the templates ───────────────────────────────────────────────────────────

type Archetype = Omit<Shape, "asked" | "source">;

const ARTISTS: Archetype = {
  name: "The Kiln",
  kind: "collective",
  summary: "Painters, potters and printmakers who share a workshop and want to fund work they choose themselves.",
  size: 24,
  plugins: ["made-1", "magazine", "fundraise", "meet", "chat", "structure", "operations"],
  publication: {
    name: "Kiln Notes",
    pieces: [
      {
        title: "Why we want a second kiln",
        dek: "Firing slots are booked six weeks out. Here's what a second kiln would change, and what it costs.",
        body: "Every month someone's work waits for a slot. A second kiln, second-hand and serviced, halves the wait and lets us run a weekend class that pays for its own clay. Carol has priced three. This piece sets out the case so members can say yes, no or not yet before anything is raised for.",
        by: "Carol",
        initiative: 0,
      },
      {
        title: "The open studio weekend, counted",
        dek: "Four hundred visitors, eleven sales and a list of who wants a class.",
        body: "We said we'd write down what the open weekend actually did. Here it is: who came, what sold, what it cost to open the doors, and what visitors asked for. The short version is that people want to learn, not only buy.",
        by: "Bob",
      },
      {
        title: "A grant for the print room",
        dek: "Alice on the arts council application, and what we would promise in return.",
        body: "Alice has drafted an application for the print room. It asks for a press and a year of open sessions. If members agree the promises in it, it goes in next month. Read it and say what you would change.",
        by: "Alice",
        initiative: 1,
      },
    ],
  },
  initiatives: [
    { title: "A second kiln", ask: "A serviced second-hand kiln, wiring and the first year's maintenance.", target: 6500, raised: 2900, status: "open" },
    { title: "A press for the print room", ask: "An etching press and a year of open sessions for people who can't afford studio time.", target: 12000, raised: 0, status: "proposed" },
    { title: "Glaze library", ask: "Test tiles and shelving so every glaze we've made is there to see.", target: 900, raised: 940, status: "funded" },
  ],
  call: { name: "Studio meeting", cadence: "First Monday, 19:00", line: "What we're making, what we need and what we decide.", weekday: 1, hour: 19 },
  rooms: ["Workshop", "Firing rota", "Shows and sales"],
  roles: [
    { name: "Stewards", who: "", line: "keep the books and the building", levels: {} },
    { name: "Members", who: "", line: "pay studio rent and vote", levels: {} },
    { name: "Associates", who: "", line: "book time, no vote", levels: {} },
    { name: "Visitors", who: "", line: "see what they're invited to", levels: {} },
  ],
  made: [
    {
      title: "Firing rota",
      tagline: "Book the kiln, see what's going in and when it comes out",
      icon: "calendar",
      sections: [
        {
          label: "This week",
          items: [
            { title: "Bisque firing, Tuesday", detail: "Bob and Carol. Full.", status: "booked" },
            { title: "Glaze firing, Thursday", detail: "Two shelves free.", status: "open" },
            { title: "Raku, Saturday", detail: "Outside, weather permitting. Alice leads.", status: "open" },
          ],
        },
        {
          label: "Waiting for a slot",
          items: [{ title: "Six pieces for the winter show", detail: "Alice. The first free slot is in two weeks." }],
        },
      ],
    },
  ],
  stage: { now: 1, next: "co-operative", why: "Members already decide together and want to own the workshop lease together, so a co-operative fits what they do." },
  answers: [
    { q: "How do I book the kiln?", a: "Open the firing rota. Pick a free slot and say what's going in. Members can book straight away, and associates' bookings are confirmed by a steward." },
    { q: "How do we raise money for something?", a: "Write it up in Kiln Notes first, so everyone sees the case. If members agree, it becomes an initiative and you raise for it there, and what's given is reported back in the record." },
  ],
};

const PRODUCTION: Archetype = {
  name: "Halfmoon Pictures",
  kind: "company",
  summary: "A production company of around forty people making documentaries and branded films, trying to spend less time on admin.",
  size: 40,
  plugins: ["made-1", "made-2", "chat", "meet", "operations", "magazine", "structure"],
  publication: {
    name: "Halfmoon Weekly",
    pieces: [
      {
        title: "What changed in how we sign off a cut",
        dek: "One place for notes, one approval, and the edit suite stops waiting.",
        body: "Notes used to arrive in four places and the edit waited for all of them. From this week every cut goes into Projects, notes are left on it, and the producer approves it there. This piece explains the change and what it saves.",
        by: "Bob",
      },
      {
        title: "Freelancers, paid in fourteen days",
        dek: "How invoices now go from a crew member to the books without anyone retyping them.",
        body: "Crew send an invoice, it lands in Operations, the line producer checks it against the call sheet and it's paid. Carol explains what a freelancer sees and what we promise.",
        by: "Carol",
      },
    ],
  },
  initiatives: [],
  call: { name: "Monday slate", cadence: "Mondays, 09:30", line: "Every live project, what's blocked and who's on what this week.", weekday: 1, hour: 9 },
  rooms: ["Whole company", "Edit suite", "Bookings"],
  roles: [
    { name: "Partners", who: "", line: "own the company and approve spend", levels: {} },
    { name: "Producers", who: "", line: "run projects and budgets", levels: {} },
    { name: "Crew", who: "", line: "staff and freelancers on a project", levels: {} },
    { name: "Clients", who: "", line: "see their own project only", levels: {} },
  ],
  made: [
    {
      title: "Projects",
      tagline: "Every production, its stage, its budget and what's waiting on whom",
      icon: "film",
      sections: [
        {
          label: "In production",
          items: [
            { title: "River people (documentary)", detail: "Shooting week 3 of 5. Budget on track.", status: "shooting" },
            { title: "Winter campaign (branded)", detail: "Rough cut with the client. Notes due Thursday.", status: "client notes" },
          ],
        },
        {
          label: "Waiting on someone",
          items: [
            { title: "Music licence, River people", detail: "Bob, chasing the publisher." },
            { title: "Location release, Winter campaign", detail: "Carol, signed copy needed before the grade." },
          ],
        },
      ],
    },
    {
      title: "Crew",
      tagline: "Who's free, what they've worked on and their paperwork, in one place",
      icon: "users",
      sections: [
        {
          label: "Booked this month",
          items: [
            { title: "Alice, director of photography", detail: "River people, to the 24th." },
            { title: "Bob, editor", detail: "Winter campaign, then free from the 20th." },
          ],
        },
      ],
    },
  ],
  stage: { now: 3, next: "none", why: "Already a company. What it needs now is less admin, so the agents take on invoices, sign-offs and filings." },
  answers: [
    { q: "Where are the notes on the latest cut?", a: "On the project, in Projects. Every note is left on the cut it's about, and the producer approves it there, so nobody has to gather them from email." },
    { q: "How do freelancers get paid?", a: "They send an invoice, it lands in Operations, the line producer checks it against the call sheet and approves it with a passkey. Then it's paid and it's in the books." },
  ],
};

const LOCAL: Archetype = {
  name: "Northside Commons",
  kind: "community",
  summary: "Neighbours with a hall to run, starting a local community that puts on events for the whole street.",
  size: 60,
  plugins: ["made-1", "chat", "magazine", "fundraise", "meet", "structure"],
  publication: {
    name: "The Northsider",
    pieces: [
      {
        title: "The hall is ours on Saturdays",
        dek: "What we can use it for, what it costs and how to book it.",
        body: "The council has agreed we can use the hall every Saturday. Bob has the keys and the rules. This piece sets out what's allowed, who to ask and how bookings work in the app.",
        by: "Bob",
      },
      {
        title: "A kitchen everyone can cook in",
        dek: "Carol on why the hall needs a proper kitchen before the winter suppers.",
        body: "We want to run suppers through the winter, but the kitchen has one ring and no fridge. Carol has asked around for prices. If enough of us agree, this becomes our first thing to raise for.",
        by: "Carol",
        initiative: 0,
      },
    ],
  },
  initiatives: [
    { title: "A kitchen for the hall", ask: "A cooker, a fridge and a hand-wash sink so we can run suppers all winter.", target: 4500, raised: 1700, status: "open" },
    { title: "Chairs that don't wobble", ask: "Sixty stackable chairs.", target: 1800, raised: 0, status: "proposed" },
  ],
  call: { name: "Neighbours' meeting", cadence: "Last Wednesday, 19:30", line: "What's on, what needs doing, and anything new.", weekday: 3, hour: 19 },
  rooms: ["Everyone", "Volunteers", "Swaps and lends"],
  roles: [
    { name: "Organisers", who: "", line: "hold the keys and the money", levels: {} },
    { name: "Members", who: "", line: "signed up and can vote", levels: {} },
    { name: "Volunteers", who: "", line: "help at events", levels: {} },
    { name: "Neighbours", who: "", line: "see what's on", levels: {} },
  ],
  made: [
    {
      title: "Events",
      tagline: "What's on in the hall, who's running it and who's coming",
      icon: "calendar",
      sections: [
        {
          label: "Coming up",
          items: [
            { title: "Repair café, Saturday 10:00", detail: "Bring something broken. Bob runs the bench.", status: "18 coming" },
            { title: "Winter supper, Friday 19:00", detail: "Bring a dish. Carol is looking for two helpers.", status: "needs help" },
            { title: "Kids' film morning", detail: "Alice. Free, donations to the kitchen fund.", status: "32 coming" },
          ],
        },
        {
          label: "Ideas",
          items: [{ title: "A tool library", detail: "Several people have ladders and drills they'd lend." }],
        },
      ],
    },
  ],
  stage: { now: 0, next: "association", why: "It starts as neighbours with a shared room. A simple association is enough to open a bank account and hold the hall booking, and it can become a charity later." },
  answers: [
    { q: "How do I book the hall?", a: "Open Events and add yours. Organisers confirm it, and it shows for everyone once it's confirmed." },
    { q: "Do we need to be a charity?", a: "Not to start. Open Structure: an association is enough to hold a bank account and the hall booking. When you want bigger grants, the same place walks you to a charity." },
  ],
};

const CHARITY: Archetype = {
  name: "Open Door",
  kind: "charity",
  summary: "A small charity of volunteers and two staff, running a drop-in and wanting to show funders what it achieves.",
  size: 35,
  plugins: ["made-1", "magazine", "fundraise", "chat", "meet", "operations", "structure"],
  publication: {
    name: "Open Door News",
    pieces: [
      {
        title: "A year at the drop-in",
        dek: "What happened, in numbers and in people's own words, with their agreement.",
        body: "This is the report we'll send to funders, written so the people who use the drop-in recognise it too. Every quote is here with the agreement of the person who said it, and the numbers come from the record.",
        by: "Alice",
        initiative: 0,
      },
      {
        title: "Why Thursdays need a second room",
        dek: "Carol on the queue, and what a second room would mean.",
        body: "Thursdays have a queue out of the door. A second room means advice and the food bank can run at the same time. This sets out the cost so trustees can decide.",
        by: "Carol",
        initiative: 1,
      },
    ],
  },
  initiatives: [
    { title: "Keep the drop-in open five days", ask: "Staff time and heating for a fifth day through winter.", target: 22000, raised: 13400, status: "open" },
    { title: "A second room on Thursdays", ask: "Rent for the room next door, one day a week for a year.", target: 5200, raised: 0, status: "proposed" },
  ],
  call: { name: "Volunteers' huddle", cadence: "Tuesdays, 10:00", line: "Who's on this week and anything we need to know.", weekday: 2, hour: 10 },
  rooms: ["Volunteers", "Trustees", "Rota swaps"],
  roles: [
    { name: "Trustees", who: "", line: "responsible in law, approve spending", levels: {} },
    { name: "Staff", who: "", line: "run the drop-in day to day", levels: {} },
    { name: "Volunteers", who: "", line: "on the rota", levels: {} },
    { name: "Funders", who: "", line: "see the reports they paid for", levels: {} },
  ],
  made: [
    {
      title: "Rota",
      tagline: "Who's on each day, and the gaps that need filling",
      icon: "users",
      sections: [
        {
          label: "This week",
          items: [
            { title: "Monday", detail: "Alice and Bob.", status: "full" },
            { title: "Thursday", detail: "Carol. One more needed for the food bank.", status: "gap" },
          ],
        },
      ],
    },
  ],
  stage: { now: 2, next: "charity", why: "Running as an association, but bigger grants ask for a charity that is its own legal person, so a CIO is next." },
  answers: [
    { q: "What do I tell a funder about last year?", a: "Point them to the year's report in Open Door News. The figures come from the record, and every quote in it was shared with the person's agreement." },
  ],
};

const COOP: Archetype = {
  name: "Common Loaf",
  kind: "co-operative",
  summary: "A food co-operative owned by its members, buying together and running a small shop.",
  size: 120,
  plugins: ["made-1", "magazine", "fundraise", "meet", "chat", "operations", "structure"],
  publication: {
    name: "The Loaf",
    pieces: [
      {
        title: "Community shares for the new shop",
        dek: "Why members can invest, what they get back and how the vote works.",
        body: "We've found a shop on the high street. Members can buy community shares to fit it out, with a modest interest rate and one vote each whatever they put in. This piece sets out the offer before anyone is asked for money.",
        by: "Alice",
        initiative: 0,
      },
      {
        title: "What members bought this month",
        dek: "The order, the suppliers and what we saved together.",
        body: "Bob's monthly round-up of the bulk order: what came in, who supplied it and how the prices compare with the supermarket.",
        by: "Bob",
      },
    ],
  },
  initiatives: [
    { title: "Fit out the high street shop", ask: "Shelving, a till and a cold cabinet, raised as community shares from members.", target: 40000, raised: 23500, status: "open" },
    { title: "A delivery bike", ask: "So members who can't get to the shop still get their order.", target: 3200, raised: 3300, status: "funded" },
  ],
  call: { name: "Members' meeting", cadence: "Second Thursday, 19:00", line: "The order, the shop and anything to vote on.", weekday: 4, hour: 19 },
  rooms: ["All members", "Shop shifts", "Suppliers"],
  roles: [
    { name: "Directors", who: "", line: "elected by members", levels: {} },
    { name: "Members", who: "", line: "own a share, one vote", levels: {} },
    { name: "Shift workers", who: "", line: "run the shop", levels: {} },
    { name: "Customers", who: "", line: "not members yet", levels: {} },
  ],
  made: [
    {
      title: "Orders",
      tagline: "The monthly bulk order: what's in it and who's having what",
      icon: "package",
      sections: [
        {
          label: "This month's order",
          items: [
            { title: "Oats, 25kg", detail: "Split eight ways.", status: "full" },
            { title: "Olive oil, 5l tins", detail: "Two more members needed to make the case.", status: "open" },
          ],
        },
      ],
    },
  ],
  stage: { now: 3, next: "none", why: "Already a registered society. Structure keeps the share register, the votes and the annual return in step." },
  answers: [
    { q: "How do community shares work?", a: "Members invest in the co-op and can withdraw later on the terms in the rules. Everyone has one vote whatever they put in. The offer is written up in The Loaf before anyone is asked for money." },
  ],
};

const GENERIC: Archetype = {
  ...LOCAL,
  name: "Fieldwork",
  kind: "community",
  summary: "A new group getting organised: people with a shared purpose and nothing set up yet.",
  size: 20,
  stage: { now: 0, next: "association", why: "It starts with people and an idea. When it needs a bank account or a grant, the next step is chosen then." },
};

const ARCHETYPES: { test: RegExp; shape: Archetype }[] = [
  { test: /\bco-?op|co-?operative|member[- ]owned|community shares|food (hub|shop)/i, shape: COOP },
  { test: /\bcharit|trustee|drop-?in|volunteer|food ?bank|non-?profit|not for profit/i, shape: CHARITY },
  { test: /\bproduction|agency|clients?\b|workflow|streamline|admin|freelanc|employees|staff|startup|business/i, shape: PRODUCTION },
  { test: /\bartist|collective|studio|musician|band|maker|potter|painter|gallery|creative|writers?\b|raise money|fund/i, shape: ARTISTS },
  { test: /\bcommunity|local|neighbour|street|village|hall|events?\b|venue|space|club|residents/i, shape: LOCAL },
];

/** A name the visitor gave ("called X", "named X", or in quotes), if any. */
function givenName(asked: string): string | null {
  const m =
    asked.match(/["“']([^"”']{2,32})["”']/) ??
    asked.match(/\b(?:called|named)\s+([A-Z][\w'&-]*(?:\s+[A-Z][\w'&-]*){0,3})/);
  return m ? m[1].trim() : null;
}

/** One of the templates as it stands, under its own name: the sample member's other groups. */
const BY_KIND = { artists: () => ARTISTS, local: () => LOCAL, production: () => PRODUCTION, charity: () => CHARITY, coop: () => COOP };
export type ArchetypeKey = keyof typeof BY_KIND;
export function archetypeShape(key: ArchetypeKey, extra: Partial<Shape>): Shape {
  const s: Shape = JSON.parse(JSON.stringify({ ...BY_KIND[key](), asked: "", source: "template" }));
  return { ...normaliseShape(s, "", s), source: "template", ...extra };
}

/**
 * A group we are onboarding, written by Decent rather than typed by a visitor
 * (`demo/packs/<edition>.json`, baked into that edition's build only). It goes
 * through the same checks as everything else, so a pack can never draw what a
 * sketch could not.
 */
export function normalisePack(raw: unknown): Shape {
  const r = obj(raw);
  const asked = str(r.asked, 600);
  const base = composeShape(`${str(r.summary, 200)} ${asked}`);
  const m = obj(r.member);
  const out: Shape = {
    ...normaliseShape(raw, asked, base),
    source: "pack",
    member: { kind: str(m.kind, 28, "Member"), role: str(m.role, 40, "a member"), line: str(m.line, 120) },
  };
  // Pictures and colours: a pack's own, never a sketch's. Matched by title, since
  // normaliseShape may drop or reorder what it cannot draw.
  const pub = obj(r.publication);
  const rawPieces = arr(pub.pieces).map(obj);
  out.publication.pieces.forEach((p) => {
    const rp = rawPieces.find((x) => str(x.title, 80) === p.title);
    if (!rp) return;
    p.art = art(rp.art);
    const pull = str(rp.pull, 140);
    if (pull) p.pull = pull;
  });
  if (pub.issue) out.publication.issue = str(pub.issue, 40);
  if (pub.line) out.publication.line = str(pub.line, 120);
  out.publication.cover = art(pub.cover);
  const rawMade = arr(r.made).map(obj);
  out.made.forEach((md) => {
    const rm = rawMade.find((x) => str(x.title, 22) === md.title);
    md.hero = art(rm?.hero);
    md.live = live(rm?.live);
    const pages = arr(rm?.profiles).slice(0, 6).map(profile).filter((p): p is Profile => !!p);
    if (pages.length) md.profiles = pages;
  });
  const brief = obj(r.brief);
  const jobs = arr(brief.jobs)
    .map(obj)
    .map((j) => ({ ask: str(j.ask, 60), done: str(j.done, 200), place: str(j.place, 20) }))
    .filter((j) => j.ask && j.done && out.plugins.includes(j.place))
    .slice(0, 3);
  if (brief.read || jobs.length) out.brief = { read: str(brief.read, 160) || undefined, jobs: jobs.length ? jobs : undefined };
  const look = obj(r.look);
  const hex = (v: unknown) => (typeof v === "string" && /^#[0-9a-f]{6}$/i.test(v) ? v : "");
  const inks = arr(look.inks).map(hex);
  if (hex(look.paper) && inks.length === 3 && inks.every(Boolean)) {
    out.look = { paper: hex(look.paper), inks: inks as Look["inks"] };
    const palette = arr(look.palette).map(hex).filter(Boolean).slice(0, 8);
    if (palette.length) out.look.palette = palette;
  }
  return out;
}

/** A pack's live experiment, only ever a page on a host we own. */
function live(v: unknown): Live | undefined {
  const l = obj(v);
  const src = typeof l.src === "string" && /^https:\/\/([a-z0-9-]+\.)?(decent\.partners|birdbrain\.wtf)\/[a-z0-9/_.-]*$/i.test(l.src) ? l.src : "";
  if (!src) return undefined;
  return { src, label: str(l.label, 140) };
}

/** A pack's film: an id on Four To The Floor's own Stream account, nothing else. */
function film(v: unknown): Film | undefined {
  const f = obj(v);
  const id = typeof f.id === "string" && /^[0-9a-f]{32}$/.test(f.id) ? f.id : "";
  if (!id) return undefined;
  return { id, label: str(f.label, 140) || undefined };
}
const RELEASE_KINDS: ReleaseKind[] = ["film", "photograph", "record", "event"];
function release(v: unknown): Release | undefined {
  const x = obj(v);
  const title = str(x.title, 70);
  if (!title) return undefined;
  const out: Release = { kind: pick(x.kind, RELEASE_KINDS, "film"), title, line: str(x.line, 180) };
  const when = str(x.when, 40);
  const status = str(x.status, 20);
  const price = str(x.price, 12);
  if (when) out.when = when;
  if (status) out.status = status;
  if (price) out.price = price;
  const a = art(x.art);
  const f = film(x.film);
  if (a) out.art = a;
  if (f) out.film = f;
  return out;
}
/** An artist's page in a pack: its name, its line, its film and what it has to show and sell. */
function profile(v: unknown): Profile | undefined {
  const p = obj(v);
  const slug = typeof p.slug === "string" && /^[a-z0-9-]{2,32}$/.test(p.slug) ? p.slug : "";
  const name = str(p.name, 40);
  if (!slug || !name) return undefined;
  const out: Profile = {
    slug,
    name,
    line: str(p.line, 120),
    about: str(p.about, 600),
    releases: arr(p.releases).slice(0, 16).map(release).filter((r): r is Release => !!r),
  };
  const hero = art(p.hero);
  const lead = film(p.film);
  if (hero) out.hero = hero;
  if (lead) out.film = lead;
  const facts = arr(p.facts)
    .filter((f): f is [unknown, unknown] => Array.isArray(f) && f.length === 2)
    .map(([k, val]) => [str(k, 20), str(val, 60)] as [string, string])
    .filter(([k, val]) => k && val)
    .slice(0, 4);
  if (facts.length) out.facts = facts;
  return out;
}

/** A pack's picture, only ever a file it ships with (`/packs/<id>/<name>`). */
function art(v: unknown): Art | undefined {
  const a = obj(v);
  const src = typeof a.src === "string" && /^\/packs\/[a-z0-9]+\/[a-z0-9-]+\.(webp|jpg|png)$/.test(a.src) ? a.src : "";
  if (!src) return undefined;
  return { src, by: str(a.by, 30, "a member"), alt: str(a.alt, 140), credit: str(a.credit, 80) || undefined };
}

/** A sketch from the templates: instant, and always there. */
export function composeShape(asked: string): Shape {
  const a = ARCHETYPES.find((x) => x.test.test(asked))?.shape ?? GENERIC;
  const name = givenName(asked) ?? a.name;
  const s: Shape = JSON.parse(JSON.stringify({ ...a, name, asked: asked.slice(0, 600), source: "template" }));
  return { ...normaliseShape(s, asked, s), source: "template" };
}

// ── what the model is asked ─────────────────────────────────────────────────

const string = { type: "string" };
const levels = {
  type: "object",
  properties: Object.fromEntries(["agent", ...SHAPE_PLUGINS, "made-1", "made-2"].map((id) => [id, { type: "string", enum: LEVELS }])),
};

/** The JSON the model must return (Ollama's structured output). */
export const SHAPE_SCHEMA = {
  type: "object",
  required: ["name", "kind", "summary", "size", "plugins", "publication", "initiatives", "call", "rooms", "roles", "made", "stage", "answers"],
  properties: {
    name: string,
    kind: { type: "string", enum: KINDS },
    summary: string,
    size: { type: "integer" },
    plugins: { type: "array", items: { type: "string", enum: SHAPE_PLUGINS } },
    publication: {
      type: "object",
      required: ["name", "pieces"],
      properties: {
        name: string,
        pieces: {
          type: "array",
          items: {
            type: "object",
            required: ["title", "dek", "body", "by"],
            properties: { title: string, dek: string, body: string, by: { type: "string", enum: PEOPLE }, initiative: { type: "integer" } },
          },
        },
      },
    },
    initiatives: {
      type: "array",
      items: {
        type: "object",
        required: ["title", "ask", "target", "status"],
        properties: { title: string, ask: string, target: { type: "integer" }, raised: { type: "integer" }, status: { type: "string", enum: ["open", "funded", "proposed"] } },
      },
    },
    call: {
      type: "object",
      required: ["name", "cadence", "line"],
      properties: { name: string, cadence: string, line: string, weekday: { type: "integer" }, hour: { type: "integer" } },
    },
    rooms: { type: "array", items: string },
    roles: {
      type: "array",
      items: { type: "object", required: ["name", "line", "levels"], properties: { name: string, line: string, levels } },
    },
    made: {
      type: "array",
      items: {
        type: "object",
        required: ["title", "tagline", "icon", "sections"],
        properties: {
          title: string,
          tagline: string,
          icon: { type: "string", enum: ICONS },
          sections: {
            type: "array",
            items: {
              type: "object",
              required: ["label", "items"],
              properties: {
                label: string,
                items: {
                  type: "array",
                  items: { type: "object", required: ["title", "detail"], properties: { title: string, detail: string, status: string } },
                },
              },
            },
          },
        },
      },
    },
    stage: {
      type: "object",
      required: ["now", "next", "why"],
      properties: { now: { type: "integer" }, next: { type: "string", enum: FORMS }, why: string },
    },
    answers: { type: "array", items: { type: "object", required: ["q", "a"], properties: { q: string, a: string } } },
  },
};

/** What the model is told. The visitor's words go in as data, after this. */
export const SHAPE_SYSTEM = `You sketch how one organisation would use a members' app, from a sentence it gives about itself. The app works for any organisation: a community, a company, a charity, a co-operative or a collective, and it flexes to how they already work. Everything you write is sample data for a demo, so invent freely but plausibly, and keep it small and concrete.

Reply with JSON only, matching the schema. Field by field:
- name: the organisation's name if they gave one, otherwise invent a short, warm one. Never use a real organisation's name.
- kind: the closest of community, company, charity, co-operative, collective.
- summary: one sentence, what they are and what they want, in plain words.
- size: roughly how many people.
- plugins: the order the rail should show them in, choosing only what they need from: magazine (their own publication, where ideas and news are written up), fundraise (initiatives and the money each needs, which always comes after magazine), meet (their regular call), chat (rooms and messages), operations (the books, shares and filings, for anyone with money to manage), structure (growing from a group to a legal form, in stages). A group raising money needs magazine then fundraise. A company streamlining work needs operations and chat, and usually no fundraise.
- publication: a name for their own publication and two or three pieces. Each piece has a title, a one-line dek, a body of two to four plain sentences, and by: Alice, Bob or Carol. Every initiative should have a piece that makes its case, and that piece carries initiative: the initiative's index (0, 1 or 2).
- initiatives: zero to three things they might raise money for, each with a title, an ask (what the money buys), a target in pounds and a status (open, funded or proposed). Leave it empty if they are not raising money.
- call: their regular meeting: a name, a cadence like "Tuesdays, 19:00", a one-line purpose, weekday (0 Sunday to 6 Saturday) and hour.
- rooms: two or three chat room names.
- roles: exactly four kinds of people, named in the plural (Members, not Member), most trusted first, the last being outsiders such as guests, clients or funders, each with a short line on who they are and a level for each plugin id they carry (agent, made-1, made-2 and the plugin ids above): none, see, join or run.
- made: one or two plugins made just for this organisation's own work (for example Events for a venue, Projects for a production company, a Rota for volunteers). Each has a short title, a tagline, an icon, and one or two sections of two or three sample items with a title, a detail and a short status.
- stage: now is where they are (0 people and an idea, 1 a group, 2 a legal form, 3 running it), next is the legal form that would fit them next (none, association, charity, co-operative, cic, company), and why is one sentence.
- answers: two questions a member of theirs might ask the app's agent, with short, helpful answers that point to a part of the app.

Write in British English, plain and warm. Don't mention years or dates. No em-dashes, no semicolons, no exclamation marks. Sample people are only Alice, Bob and Carol. Never promise that anyone is paid, and never name a real person.`;
