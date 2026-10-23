import { useState } from "react";
import { ArrowRight, ArrowUpRight, Check, MessageSquare, Sparkles } from "lucide-react";
import { getModule } from "../host/registry";
import { edition, shaped } from "../edition";
import { inkOf, onInk } from "./ink";
import { monthTotal } from "./costs";
import { sampleInitiatives, samplePublication } from "./sample";

/**
 * The agent as the front door, in every showcase demo (Huxley's and each
 * group's pack): "How you'll use <name>" walks three stages. Today, a screen
 * for each thing. Next, the agent opens on a read of everything (tiles, each a
 * tap into its section) and a few jobs it can do. Later, mostly a conversation.
 * A pack can write its own read and jobs (`brief` in shape.ts); without one
 * they are drawn from its call, publication, initiatives and made plugins.
 * Over time the app should collapse into this one conversation, with every
 * section still a tap away. Sample data only.
 */

const gbp = (n: number) => `£${n.toLocaleString("en-GB", { maximumFractionDigits: 0 })}`;

interface Tile {
  id: string;
  /** where the tap goes, if not the plugin itself */
  to?: string;
  section?: string;
  label: string;
  value: string;
  line: string;
  /** a bar, 0 to 1 */
  bar?: number;
}

function tiles(installed: string[]): Tile[] {
  if (shaped) return packTiles(installed);
  const has = (id: string) => installed.includes(id) && !!getModule(id);
  const bursaries = sampleInitiatives.find((i) => i.target && i.raised !== undefined && i.raised < i.target);
  const call = edition.call;
  const out: Tile[] = [];
  if (has("chat")) out.push({ id: "chat", label: "Chat", value: "4 new", line: "Two dates settled. One question for you." });
  if (has("meet") && call) out.push({ id: "meet", label: call.name, value: "Thursday", line: `${call.cadence.replace(/ UK$/, "")}. Nine say they're coming.` });
  if (has("magazine") && samplePublication)
    out.push({ id: "magazine", label: samplePublication.name, value: "2 replies", line: "Bob and Carol replied to the company piece." });
  if (has("fundraise") && bursaries?.target)
    out.push({
      id: "fundraise",
      label: "Initiatives",
      value: `${gbp(bursaries.raised ?? 0)} of ${gbp(bursaries.target)}`,
      line: "Six more bursaries. Four gifts this week.",
      bar: (bursaries.raised ?? 0) / bursaries.target,
    });
  if (has("spend")) out.push({ id: "spend", label: "Spending", value: "£1,435 this month", line: "From the bursaries pocket. One receipt missing." });
  if (has("structure")) out.push({ id: "structure", label: "The company", value: "Registered", line: "Huxley Sessions Ltd. I'm setting up its books." });
  if (has("operations"))
    out.push({ id: "operations", label: "The seed round", value: "£68,000 of £150,000", line: "Two investors waiting on the agreement.", bar: 68 / 150 });
  out.push({ id: "identity", section: "asked", label: "Asked of you", value: "2 questions", line: "£80 and £60 offered for what you know." });
  // Nine tiles fill the grid: Spending takes the notes' place when it's installed.
  if (!has("spend")) out.push({ id: "notes", label: "Your notes", value: "5 thoughts", line: "Two ready to share. Only you see them." });
  out.push({ id: "settings", section: "billing", label: "This month", value: gbp(monthTotal(installed)), line: "Huxley's use so far, line by line." });
  return out;
}

interface Job {
  ask: string;
  done: string;
  place: string;
}

const HUXLEY_JOBS: Job[] = [
  {
    ask: "Draft Thursday's running order",
    done: "Done. Ten minutes each for six people, Carol first as she leaves early. It's in Work in progress.",
    place: "meet",
  },
  {
    ask: "Send the two investors their agreement",
    done: "Filled in from the terms in Operations. It waits for a steward's passkey to send.",
    place: "operations",
  },
  {
    ask: "Thank this week's bursary givers",
    done: "Four short notes drafted, one per gift. They go when you approve.",
    place: "fundraise",
  },
];

// ── a group's own read, from its pack ──────────────────────────────────────

const cap = (t: string) => t.charAt(0).toUpperCase() + t.slice(1);
const DAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

function packTiles(installed: string[]): Tile[] {
  const s = shaped!;
  const has = (id: string) => installed.includes(id) && !!getModule(id);
  const open = s.initiatives.findIndex((i) => i.status === "open" && i.target > 0);
  const piece = s.publication.pieces[0];
  const by: Record<string, Tile | null> = {
    chat: has("chat") ? { id: "chat", label: "Chat", value: "4 new", line: `One question for you in ${s.rooms[0] ?? "the main room"}.` } : null,
    meet: has("meet") ? { id: "meet", label: s.call.name, value: DAYS[s.call.weekday] ?? "This week", line: `${s.call.cadence}. Nine say they're coming.` } : null,
    magazine:
      has("magazine") && piece
        ? { id: "magazine", label: s.publication.name, value: "2 replies", line: `Bob and Carol replied to "${piece.title}".` }
        : null,
    fundraise:
      has("fundraise") && open >= 0
        ? {
            id: "fundraise",
            label: "Initiatives",
            value: `${gbp(s.initiatives[open].raised)} of ${gbp(s.initiatives[open].target)}`,
            line: `${s.initiatives[open].title}. Four gifts this week.`,
            bar: s.initiatives[open].raised / s.initiatives[open].target,
          }
        : null,
    structure: has("structure")
      ? s.stage.now >= 3
        ? { id: "structure", label: "The company", value: "In order", line: "Next filing drafted. It waits for a director." }
        : { id: "structure", label: "Taking a form", value: "Drafted", line: "The papers are ready for members to read." }
      : null,
    operations: has("operations") ? { id: "operations", label: "The books", value: "2 to approve", line: "Two invoices in. Both match the budget." } : null,
  };
  s.made.forEach((m, i) => {
    const id = `made-${i + 1}`;
    const item = m.sections[0]?.items[0];
    by[id] = has(id) ? { id, label: m.title, value: cap(item?.status || "new"), line: item ? `${item.title}${/[.?!]$/.test(item.title) ? "" : "."} ${item.detail}` : m.tagline } : null;
  });
  // In rail order, so the read looks like the group's own app. Six fill the grid.
  const out = s.plugins.map((p) => by[p]).filter((t): t is Tile => !!t).slice(0, 5);
  out.push({ id: "identity", section: "asked", label: "Asked of you", value: "2 questions", line: "£80 and £60 offered for what you know." });
  return out;
}

function packJobs(): Job[] {
  const s = shaped!;
  if (s.brief?.jobs?.length) return s.brief.jobs;
  const out: Job[] = [];
  const has = (id: string) => s.plugins.includes(id);
  if (has("meet")) out.push({ ask: `Draft the ${s.call.name} running order`, done: `Done. Ten minutes each for six people, Carol first as she leaves early. It's in Work in progress.`, place: "meet" });
  const piece = s.publication.pieces[0];
  if (has("magazine") && piece)
    out.push({ ask: `Sum up the replies to "${piece.title}"`, done: "Two replies, both for it. Bob asks who runs it. Carol offers to. I've drafted a thank you.", place: "magazine" });
  const open = s.initiatives.find((i) => i.status === "open");
  if (has("fundraise") && open) out.push({ ask: `Thank this week's backers of ${open.title}`, done: "Four short notes drafted, one per gift. They go when you approve.", place: "fundraise" });
  return out.slice(0, 3);
}

const jobs = (): Job[] => (shaped ? packJobs() : HUXLEY_JOBS);
const readLine = (): string =>
  shaped
    ? shaped.brief?.read || `Morning. ${["Nothing", "One thing", "Two things", "Three things"][jobs().length] ?? "A few things"} ${jobs().length === 1 ? "needs" : "need"} you this week. Here's the rest of ${shaped.name} at a glance.`
    : "Morning. Three things need you: the investors' agreement, Thursday's running order and four thank-yous.";

export function Brief({
  installed,
  open,
  say,
}: {
  installed: string[];
  open: (id: string) => void;
  say: (q: string, a: string, places: string[]) => void;
}) {
  const [done, setDone] = useState<string[]>([]);
  const go = (t: Tile) => {
    open(t.to ?? t.id);
    if (t.section)
      setTimeout(
        () => document.querySelector(`[data-tour-section="${t.section}"]`)?.scrollIntoView({ behavior: "smooth", block: "start" }),
        250,
      );
  };
  return (
    <div className="space-y-6">
      <section>
        <p className="font-serif max-w-prose text-[17px] leading-relaxed">
          {readLine()}
        </p>
        <div className="mt-4 grid gap-2.5 sm:grid-cols-2 lg:grid-cols-3">
          {tiles(installed).map((t) => {
            const ink = inkOf(t.id);
            const Icon = getModule(t.id)?.icon ?? Sparkles;
            return (
              <button
                key={t.id}
                onClick={() => go(t)}
                className="group flex flex-col rounded-[var(--radius)] border border-[var(--line)] bg-[var(--card)] p-4 text-left transition hover:border-[var(--line-strong)]"
                style={{ background: `color-mix(in srgb, ${ink} 6%, var(--card))` }}
              >
                <span className="flex items-center gap-2">
                  <span className="flex h-6 w-6 items-center justify-center rounded-[7px]" style={{ background: ink, color: onInk(ink) }}>
                    <Icon className="h-3.5 w-3.5" />
                  </span>
                  <span className="font-tight text-[13px] text-[var(--muted)]">{t.label}</span>
                  <ArrowUpRight className="ml-auto h-3.5 w-3.5 text-[var(--faint)] transition group-hover:text-[var(--fg)]" />
                </span>
                <span className="font-tight mt-3 text-[20px] font-medium leading-tight tracking-[-0.01em]">{t.value}</span>
                {t.bar !== undefined && (
                  <span className="mt-2 h-1.5 overflow-hidden rounded-full bg-[var(--line)]">
                    <span className="block h-full rounded-full" style={{ width: `${Math.min(100, t.bar * 100)}%`, background: ink }} />
                  </span>
                )}
                <span className="mt-2 text-[12.5px] leading-snug text-[var(--muted)]">{t.line}</span>
              </button>
            );
          })}
        </div>
      </section>

      <section>
        <div className="font-mono mb-2.5 text-[11px] uppercase tracking-[0.16em] text-[var(--faint)]">I can do these for you</div>
        <div className="flex flex-wrap gap-2">
          {jobs().map((j) => {
            const ink = inkOf(j.place);
            const isDone = done.includes(j.ask);
            return (
              <button
                key={j.ask}
                disabled={isDone}
                onClick={() => {
                  setDone((d) => [...d, j.ask]);
                  say(j.ask, j.done, [j.place]);
                }}
                className="inline-flex items-center gap-2 rounded-full border px-3.5 py-2 text-[13px] transition hover:bg-[var(--raise)] disabled:opacity-60"
                style={{ borderColor: ink }}
              >
                <span className="flex h-4 w-4 items-center justify-center rounded-full" style={{ background: ink, color: onInk(ink) }}>
                  {isDone ? <Check className="h-2.5 w-2.5" /> : <Sparkles className="h-2.5 w-2.5" />}
                </span>
                {j.ask}
              </button>
            );
          })}
        </div>
      </section>
    </div>
  );
}

// ── how you'll use it ───────────────────────────────────────────────────────

const RAIL = ["#7b4fc4", "#0078bf", "#ff7a3d", "#ff48b0", "#1f9d6b", "#e0a800", "#00a19a"];

const bar = (w: string, c = "var(--line)") => <span className="block h-1.5 rounded-full" style={{ width: w, background: c }} />;

type Stage = "today" | "next" | "later";

const STAGES: { id: Stage; step: string; title: string; line: string }[] = [
  { id: "today", step: "1 · Today", title: "A screen for each thing", line: "Chat, calls, money, the books." },
  { id: "next", step: "2 · Next", title: "One page shows what needs you", line: "Tap a tile for the detail." },
  { id: "later", step: "3 · Later", title: "Mostly a conversation", line: "Ask, and it does the job." },
];

function Picture({ id }: { id: Stage }) {
  if (id === "today")
    return (
      <div className="flex h-full gap-2">
        <div className="flex flex-col gap-1.5">
          {RAIL.map((c) => (
            <span key={c} className="h-2.5 w-2.5 rounded-[3px]" style={{ background: c }} />
          ))}
        </div>
        <div className="flex flex-1 flex-col gap-1.5 pt-0.5">
          {bar("60%", "var(--line-strong)")}
          {bar("90%")}
          {bar("80%")}
          {bar("50%")}
        </div>
      </div>
    );
  if (id === "next")
    return (
      <div className="grid h-full grid-cols-3 gap-1">
        {RAIL.slice(0, 6).map((c) => (
          <span key={c} className="rounded-[3px]" style={{ background: `color-mix(in srgb, ${c} 22%, white)`, borderTop: `2px solid ${c}` }} />
        ))}
      </div>
    );
  return (
    <div className="flex h-full flex-col justify-end gap-1">
      <span className="w-3/5 rounded-[5px] p-1" style={{ background: "color-mix(in srgb, #7b4fc4 16%, white)" }}>{bar("70%", "#7b4fc4")}</span>
      <span className="ml-auto w-2/5 rounded-[5px] bg-[var(--line)] p-1">{bar("80%", "var(--line-strong)")}</span>
      <span className="w-4/5 rounded-[5px] p-1" style={{ background: "color-mix(in srgb, #7b4fc4 16%, white)" }}>{bar("90%", "#7b4fc4")}</span>
    </div>
  );
}

/**
 * "How you'll use <name>": the three stages as steps you can tap. It opens on
 * Today (what the walkthrough has shown), moves to the read filled with the
 * group's own week, then to a job done by asking. Huxley's story opens on Next.
 */
export function Horizon({
  installed,
  open,
  say,
  start = "today",
}: {
  installed: string[];
  open: (id: string) => void;
  say: (q: string, a: string, places: string[]) => void;
  start?: Stage;
}) {
  const [at, setAt] = useState<Stage>(start);
  const name = shaped?.name ?? edition.instance.name;
  const i = STAGES.findIndex((s) => s.id === at);
  const following = STAGES[i + 1];
  const job = jobs()[0];
  return (
    <section className="mb-8 rounded-[calc(var(--radius)+4px)] border border-[var(--line)] p-5" data-tour-section="horizon">
      <div className="flex items-center gap-2">
        <MessageSquare className="h-4 w-4 text-[var(--ink,var(--muted))]" />
        <span className="font-tight text-[15px] font-medium">How you'll use {name}</span>
      </div>
      <p className="mt-1 max-w-prose text-[13px] leading-relaxed text-[var(--muted)]">
        Three stages. The app starts as a screen for each thing and becomes mostly a conversation. Tap a stage to see it.
      </p>

      <div className="mt-4 grid gap-2.5 sm:grid-cols-3" role="tablist">
        {STAGES.map((s) => {
          const on = s.id === at;
          return (
            <button
              key={s.id}
              role="tab"
              aria-selected={on}
              onClick={() => setAt(s.id)}
              className={`flex gap-3 rounded-[var(--radius)] border p-2.5 text-left transition ${
                on ? "border-[var(--ink,var(--fg))] bg-[var(--card)]" : "border-[var(--line)] opacity-70 hover:opacity-100"
              }`}
            >
              <span className="h-14 w-20 shrink-0 overflow-hidden rounded-[6px] border border-[var(--line)] bg-[var(--card)] p-1.5">
                <Picture id={s.id} />
              </span>
              <span className="min-w-0">
                <span className="font-mono block text-[10px] uppercase tracking-[0.14em] text-[var(--faint)]">{s.step}</span>
                <span className="font-tight block text-[13.5px] font-medium leading-tight">{s.title}</span>
                <span className="mt-0.5 block text-[12px] leading-snug text-[var(--muted)]">{s.line}</span>
              </span>
            </button>
          );
        })}
      </div>

      <div className="mt-5">
        {at === "today" && (
          <p className="font-serif max-w-prose text-[16px] leading-relaxed">
            The app today, as the walkthrough shows it. Each thing {name} does has its own screen in the rail on the left: chat, the call,
            the money, the books and the plugins made for {name}. You open the one you need.
          </p>
        )}
        {at === "next" && (
          <>
            <p className="mb-4 max-w-prose text-[13px] leading-relaxed text-[var(--muted)]">
              Next, this page opens on a read of all of it, written for you. Here is a sample week for {name}. Tap a tile to jump into its
              section, or ask for a job below.
            </p>
            <Brief installed={installed} open={open} say={say} />
          </>
        )}
        {at === "later" && (
          <>
            <p className="max-w-prose text-[13px] leading-relaxed text-[var(--muted)]">
              Later, you mostly ask. The agent does the job and opens a section only when you want to check it. Anything that sends, signs or
              spends waits for your passkey.
            </p>
            {job && (
              <div className="mt-4 flex max-w-xl flex-col gap-2">
                <span className="ml-auto rounded-[10px] bg-[var(--raise)] px-3.5 py-2 text-[14px]">{job.ask}</span>
                <span className="font-serif rounded-[10px] px-3.5 py-2 text-[15px] leading-relaxed" style={{ background: `color-mix(in srgb, ${inkOf(job.place)} 10%, var(--card))` }}>
                  {job.done}
                </span>
                <button
                  onClick={() => say(job.ask, job.done, [job.place])}
                  className="mt-1 inline-flex items-center gap-1.5 self-start text-[13px] text-[var(--muted)] hover:text-[var(--fg)]"
                >
                  Try it <ArrowRight className="h-3.5 w-3.5" />
                </button>
              </div>
            )}
          </>
        )}
        {following && (
          <button
            onClick={() => setAt(following.id)}
            className="mt-5 inline-flex items-center gap-2 rounded-full border border-[var(--line-strong)] px-3.5 py-2 text-[13px] transition hover:bg-[var(--raise)]"
          >
            {following.step.split(" · ")[1]}: {following.title.toLowerCase()} <ArrowRight className="h-3.5 w-3.5" />
          </button>
        )}
      </div>
    </section>
  );
}
