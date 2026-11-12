import { useMemo, useState } from "react";
import { UserPlus, Network, Droplets, Ban, Gift, Layers3, Eye, Lock } from "lucide-react";
import { edition } from "../edition";
import { Card, Section } from "../ui";
import { demoNote } from "./note";
import { RISO } from "./sample";

/**
 * Invites on the sample Profile (invented demo only): the people Alice brought
 * into the network, the people they brought in, and what comes back to her when
 * any of them earn by answering questions.
 *
 * The shares follow ADR 0058 (core/state/decisions/0058-*.md): they come out of
 * the 10% Network Rate already taken from each answer, never on top of it, so
 * the person answering keeps 90% however deep they sit. Within the 10%, the
 * working proposal is 5 points to the invite line, 3 to shared running and 2 to
 * the group's own fund. The line's 5 points halve at each step up and stop after
 * three, and what the line doesn't use goes to the fund. Nothing is ever earned
 * for signing someone up, only from answers they give. The split is not settled,
 * so the section says these are sample figures; change `LINE` to change it.
 */

/** Share of each answer to the inviter one, two and three steps up. */
export const LINE = [0.025, 0.0125, 0.00625];
const RATE = 0.1;
const RUNNING = 0.03;
const FUND = RATE - RUNNING - LINE.reduce((a, b) => a + b, 0);

const INK = [RISO.blue, RISO.pink, "#e0a800"];
const NAMES = ["Bob", "Carol", "Dave", "Erin", "Frank", "Grace"];
const WHERE = ["Huxley", "Halfmoon Pictures", "Northside Commons", "Common Loaf"];

const gbp = (n: number, pence = n < 10) =>
  new Intl.NumberFormat("en-GB", {
    style: "currency",
    currency: "GBP",
    minimumFractionDigits: pence ? 2 : 0,
    maximumFractionDigits: pence ? 2 : 0,
  }).format(n);

interface Person {
  id: string;
  depth: number;
  name?: string;
  parent: string | null;
  where: string;
  /** what they earned answering the network this year */
  earned: number;
  children: Person[];
}

function rand(seed: number) {
  let t = seed;
  return () => {
    t = (t + 0x6d2b79f5) >>> 0;
    let r = Math.imul(t ^ (t >>> 15), 1 | t);
    r ^= r + Math.imul(r ^ (r >>> 7), 61 | r);
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };
}

/** Alice's invite tree: six people she brought in, and everyone after them. */
function build(): Person[] {
  const r = rand(1786);
  const kids = [3, 4, 1, 2, 0, 3];
  const grand = [[2, 1, 0], [1, 2, 1, 0], [3], [1, 1], [], [2, 0, 1]];
  let n = 0;
  const person = (depth: number, parent: string | null, name?: string): Person => ({
    id: `p${n++}`,
    depth,
    name,
    parent,
    where: WHERE[Math.floor(r() * WHERE.length)],
    earned: Math.round(((40 + r() * 460) * (depth === 1 ? 3 : 1)) / 6) * 6,
    children: [],
  });
  return NAMES.map((name, i) => {
    const p = person(1, null, name);
    p.where = WHERE[i % WHERE.length];
    p.children = Array.from({ length: kids[i] }, (_, j) => {
      const c = person(2, p.id);
      c.children = Array.from({ length: grand[i][j] ?? 0 }, () => person(3, c.id));
      return c;
    });
    return p;
  });
}

export const NETWORK = build();
const ALL = (function flat(ps: Person[]): Person[] {
  return ps.flatMap((p) => [p, ...flat(p.children)]);
})(NETWORK);
const pct = (depth: number) => `${+(LINE[depth - 1] * 100).toFixed(3)}%`;
const share = (p: Person) => p.earned * LINE[p.depth - 1];
const BY_DEPTH = [1, 2, 3].map((d) => {
  const ps = ALL.filter((p) => p.depth === d);
  return { depth: d, people: ps.length, earned: ps.reduce((a, p) => a + p.earned, 0), toHer: ps.reduce((a, p) => a + share(p), 0) };
});
/** What came back to Alice this year from the people she brought in. */
export const INVITE_YEAR = Math.round(BY_DEPTH.reduce((a, d) => a + d.toHer, 0));

/** The same year by month, November to October, growing as the network did. */
export function inviteMonths(): number[] {
  const shape = [0, 0, 0, 1, 2, 3, 5, 6, 8, 11, 14, 18];
  const sum = shape.reduce((a, b) => a + b, 0);
  const m = shape.map((s) => Math.round((s / sum) * INVITE_YEAR));
  m[11] += INVITE_YEAR - m.reduce((a, b) => a + b, 0);
  return m;
}

// ── the exploded view ───────────────────────────────────────────────────────

const SIZE = 440;
const C = SIZE / 2;
const RINGS = [0, 78, 140, 196];

function layout() {
  const pos = new Map<string, { x: number; y: number; a: number }>();
  const weight = (p: Person): number => 1 + p.children.reduce((a, c) => a + weight(c), 0) * 0.8;
  const place = (ps: Person[], from: number, to: number) => {
    const total = ps.reduce((a, p) => a + weight(p), 0);
    let at = from;
    for (const p of ps) {
      const span = ((to - from) * weight(p)) / total;
      const a = at + span / 2;
      pos.set(p.id, { x: C + Math.cos(a) * RINGS[p.depth], y: C + Math.sin(a) * RINGS[p.depth], a });
      place(p.children, at, at + span);
      at += span;
    }
  };
  place(NETWORK, -Math.PI / 2, Math.PI * 1.5);
  return pos;
}

function Exploded({ picked, onPick }: { picked: string | null; onPick: (id: string | null) => void }) {
  const [open, setOpen] = useState(false);
  const pos = useMemo(layout, []);
  const at = (p: Person) => {
    if (open || p.depth === 1) return pos.get(p.id)!;
    const top = ALL.find((q) => q.depth === 1 && (q.id === p.parent || q.children.some((c) => c.id === p.parent)))!;
    return pos.get(top.id)!;
  };
  const r = (p: Person) => [9, 5, 3.5][p.depth - 1] + Math.sqrt(p.earned) * 0.22;
  const chosen = ALL.find((p) => p.id === picked);
  return (
    <div>
      <div className="relative mx-auto aspect-square w-full max-w-[440px]">
        <svg viewBox={`0 0 ${SIZE} ${SIZE}`} className="h-full w-full" role="img" aria-label="Alice's invite network">
          {[1, 2, 3].map((d) => (
            <circle key={d} cx={C} cy={C} r={RINGS[d]} fill="none" stroke="var(--line)" strokeDasharray="2 5" style={{ opacity: open || d === 1 ? 1 : 0, transition: "opacity .5s" }} />
          ))}
          {ALL.map((p) => {
            const a = at(p);
            const from = p.parent ? at(ALL.find((q) => q.id === p.parent)!) : { x: C, y: C };
            return (
              <line
                key={`l${p.id}`}
                x1={from.x}
                y1={from.y}
                x2={a.x}
                y2={a.y}
                stroke={INK[p.depth - 1]}
                strokeOpacity={picked && picked !== p.id ? 0.18 : 0.45}
                strokeWidth={1.2}
                style={{ transition: "all .7s cubic-bezier(.2,.8,.2,1)" }}
              />
            );
          })}
          {ALL.map((p) => {
            const a = at(p);
            const hidden = !open && p.depth > 1;
            return (
              <g
                key={p.id}
                onClick={() => onPick(picked === p.id ? null : p.id)}
                className="cursor-pointer"
                style={{ transform: `translate(${a.x}px, ${a.y}px)`, transition: "transform .7s cubic-bezier(.2,.8,.2,1), opacity .5s", opacity: hidden ? 0 : 1, pointerEvents: hidden ? "none" : "auto" }}
              >
                <circle r={r(p) + 6} fill="transparent" />
                <circle r={r(p)} fill={INK[p.depth - 1]} stroke={picked === p.id ? "var(--fg)" : "var(--card)"} strokeWidth={picked === p.id ? 2.5 : 1.5} />
                {p.name && (
                  <text y={r(p) + 13} textAnchor="middle" className="fill-[var(--muted)] text-[11px]">
                    {p.name}
                  </text>
                )}
              </g>
            );
          })}
          <g onClick={() => onPick(null)} className="cursor-pointer">
            <circle cx={C} cy={C} r={24} fill="var(--fg)" />
            <text x={C} y={C + 5} textAnchor="middle" className="fill-[var(--bg)] text-[15px] font-medium">
              A
            </text>
          </g>
          {!open && (
            <text x={C} y={C + 132} textAnchor="middle" className="fill-[var(--faint)] text-[11px]">
              {ALL.length - NETWORK.length} more behind them
            </text>
          )}
        </svg>
      </div>

      <div className="mt-2 flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-[var(--muted)]">
          {BY_DEPTH.map((d) => (
            <span key={d.depth} className="flex items-center gap-1.5">
              <span className="h-2.5 w-2.5 rounded-full" style={{ background: INK[d.depth - 1] }} />
              {["She invited", "They invited", "And after them"][d.depth - 1]} · {d.people}
            </span>
          ))}
        </div>
        <button
          onClick={() => setOpen(!open)}
          className="prism-hover flex items-center gap-1.5 rounded-[var(--radius)] border border-[var(--line-strong)] bg-[var(--card)] px-3 py-1.5 text-[12px]"
        >
          <Layers3 className="h-3.5 w-3.5" />
          {open ? "Fold it back" : "Explode it"}
        </button>
      </div>

      <div className="mt-3 min-h-[64px] rounded-[var(--radius)] border border-[var(--line)] bg-[var(--raise)] px-4 py-3 text-[13px] leading-relaxed">
        {chosen ? (
          <>
            <span className="font-tight font-medium">
              {chosen.name ?? (chosen.depth === 2 ? "Someone they invited" : "Someone further along")}
            </span>
            <span className="text-[var(--muted)]">
              {" "}· in {chosen.where} · {chosen.depth === 1 ? "Alice invited them" : `${chosen.depth} steps from Alice`}.
              {" "}Earned {gbp(chosen.earned)} answering this year, kept 90%. Alice's share, from the 10%:{" "}
              {pct(chosen.depth)}, or{" "}
              <b className="text-[var(--fg)]">{gbp(share(chosen), true)}</b>.
            </span>
            {chosen.depth > 1 && <span className="block text-[11px] text-[var(--faint)]">Past her own invites, Alice sees amounts, not names.</span>}
          </>
        ) : (
          <span className="text-[var(--muted)]">Tap anyone to see their share. Bigger circles earned more.</span>
        )}
      </div>
    </div>
  );
}

// ── the waterfall ───────────────────────────────────────────────────────────

function Waterfall() {
  const answer = 80;
  const steps = [
    { who: "Whoever invited them", note: "one step up", amount: answer * LINE[0], ink: INK[0] },
    { who: "Carol, who invited that person", note: "two steps up", amount: answer * LINE[1], ink: INK[1] },
    { who: "Alice, who invited Carol", note: "three steps up, then it stops", amount: answer * LINE[2], ink: INK[2], her: true },
    { who: "Running costs", note: "hosting and support", amount: answer * RUNNING, ink: "var(--fg)" },
    { who: "The group's own fund", note: "plus any share the line didn't use", amount: answer * FUND, ink: "#1f9d6b" },
  ];
  const pot = answer * RATE;
  let left = pot;
  return (
    <div>
      <div className="flex h-9 overflow-hidden rounded-[var(--radius)] text-[12px] font-medium">
        <div className="flex items-center px-3 text-white" style={{ flex: 1, background: "#8a8a8a" }}>
          {gbp(answer * (1 - RATE))} to the person who answered
        </div>
        <div className="flex min-w-[44px] items-center justify-center bg-[var(--fg)] text-[var(--bg)]" style={{ width: "10%" }}>
          {gbp(pot, false)}
        </div>
      </div>
      <div className="mt-1.5 text-[11px] text-[var(--faint)]">
        One {gbp(answer)} answer from someone three steps from Alice. They keep 90% at any depth.
      </div>

      <div className="font-tight mt-5 text-[13px] font-medium" data-fall>Where the {gbp(pot, false)} goes</div>
      <div className="mt-2 space-y-1.5">
        {steps.map((s, i) => {
          const start = pot - left;
          left -= s.amount;
          return (
            <div key={s.who} className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3 sm:grid-cols-[180px_minmax(0,1fr)_auto]">
              <div className="col-start-1 row-start-1 min-w-0">
                <div className={`truncate text-[12px] ${s.her ? "font-medium" : ""}`}>{s.who}</div>
                <div className="truncate text-[11px] text-[var(--faint)]">{s.note}</div>
              </div>
              <div className="relative col-span-2 col-start-1 row-start-2 h-6 rounded-[3px] bg-[var(--raise)] sm:col-span-1 sm:col-start-2 sm:row-start-1">
                {i > 0 && (
                  <span className="absolute -top-1.5 h-1.5 border-l border-dashed border-[var(--line-strong)]" style={{ left: `${(start / pot) * 100}%` }} />
                )}
                <span
                  className="absolute top-0 h-full rounded-[3px]"
                  style={{ left: `${(start / pot) * 100}%`, width: `${(s.amount / pot) * 100}%`, background: s.ink, outline: s.her ? "2px solid var(--fg)" : undefined, outlineOffset: 1 }}
                />
              </div>
              <div className="font-mono col-start-2 row-start-1 text-right text-[12px] sm:col-start-3">{gbp(s.amount, true)}</div>
            </div>
          );
        })}
      </div>
      <p className="mt-3 text-[12px] leading-relaxed text-[var(--muted)]">
        It halves at each step and stops after three. A long line costs nobody more.
      </p>
    </div>
  );
}

// ── the section ─────────────────────────────────────────────────────────────

const RULES = [
  { icon: Droplets, title: "Only from real work", line: "Only from answers given. Nothing for signing people up." },
  { icon: Gift, title: "Free to join", line: "Nothing paid upward. No starter pack." },
  { icon: Ban, title: "Never on top", line: "It comes out of the 10%. Nobody earns less for being invited." },
  { icon: Eye, title: "In the open", line: "Who invited whom is on record, open to anyone it affects." },
];

export function InvitesSection() {
  const [view, setView] = useState<"network" | "waterfall">("network");
  const [picked, setPicked] = useState<string | null>(null);
  if (!edition.showcase) return null;
  return (
    <div data-tour-section="invites" className="scroll-mt-6">
      <Section
        label="Who she brought in"
        icon={UserPlus}
        lede="When people Alice invited earn by answering, a small share of the 10% Network Rate could come back to her. Less from the people they invite."
        aside={
          <div role="radiogroup" aria-label="View" className="flex rounded-[var(--radius)] border border-[var(--line-strong)] bg-[var(--card)] p-0.5">
            {(
              [
                ["network", "Network", Network],
                ["waterfall", "Waterfall", Droplets],
              ] as const
            ).map(([id, label, Icon]) => (
              <button
                key={id}
                role="radio"
                aria-checked={view === id}
                onClick={() => setView(id)}
                className="flex items-center gap-1.5 rounded-[calc(var(--radius)-2px)] px-2 py-1 text-[11px] text-[var(--muted)] transition aria-checked:bg-[var(--fg)] aria-checked:text-[var(--bg)]"
              >
                <Icon className="h-3.5 w-3.5" />
                <span className="hidden sm:inline">{label}</span>
              </button>
            ))}
          </div>
        }
      >
        <Card>
          <div className="flex flex-wrap items-end justify-between gap-4">
            <div>
              <div className="font-mono text-[11px] uppercase tracking-wide text-[var(--faint)]">From the network she started</div>
              <div className="font-tight mt-1 text-[40px] font-medium leading-none tracking-[-0.02em]">{gbp(INVITE_YEAR)}</div>
              <div className="mt-2 text-[13px] text-[var(--muted)]">
                this year, from {ALL.length} people answering · paid automatically
              </div>
            </div>
            <div className="grid min-w-[220px] grid-cols-1 gap-1.5">
              {BY_DEPTH.map((d) => (
                <div key={d.depth} className="flex items-center justify-between gap-3 text-[12px]">
                  <span className="flex items-center gap-2">
                    <span className="h-2.5 w-2.5 rounded-full" style={{ background: INK[d.depth - 1] }} />
                    {["People she invited", "People they invited", "After them"][d.depth - 1]}{" "}
                    <span className="text-[var(--faint)]">{pct(d.depth)}</span>
                  </span>
                  <span className="font-mono text-[var(--muted)]">{gbp(d.toHer)}</span>
                </div>
              ))}
            </div>
          </div>
          <div className="mt-5 border-t border-[var(--line)] pt-5">
            {view === "network" ? <Exploded picked={picked} onPick={setPicked} /> : <Waterfall />}
          </div>
        </Card>

        <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-4">
          {RULES.map(({ icon: Icon, title, line }) => (
            <div key={title} className="rounded-[var(--radius)] border border-[var(--line)] bg-[var(--card)] px-3 py-3">
              <Icon className="h-4 w-4 text-[var(--muted)]" />
              <div className="font-tight mt-2 text-[13px] font-medium">{title}</div>
              <div className="mt-1 text-[12px] leading-relaxed text-[var(--muted)]">{line}</div>
            </div>
          ))}
        </div>

        <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
          <p className="flex items-start gap-1.5 text-[12px] text-[var(--faint)]">
            <Lock className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            Sample figures. The split of the 10% isn't settled. Nobody is paid through the network today.
          </p>
          <button
            onClick={() =>
              demoNote("In your own app this makes an invite link. Whoever joins with it is recorded as brought in by you.")
            }
            className="prism-hover flex items-center gap-1.5 rounded-[var(--radius)] bg-[var(--fg)] px-3 py-1.5 text-[12px] text-[var(--bg)]"
          >
            <UserPlus className="h-3.5 w-3.5" /> Invite someone
          </button>
        </div>
      </Section>
    </div>
  );
}
