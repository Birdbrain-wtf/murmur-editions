import { useEffect, useState } from "react";
import { ArrowLeft, ArrowUpRight, CheckCircle2, CircleHelp, Lightbulb, Quote, RotateCw, Sparkles, Users, Waves } from "lucide-react";
import { openInBrowser } from "../../identity/passkey";
import { Button, Card, Notice, Section, Waiting } from "../../ui";

/**
 * The record of the Chaos Sessions, drawn inside the app rather than sent out
 * to the /chaOS page. Same data as that page: the index from `/api/chaOS`, one
 * session's extract from `/api/chaOS/<id>`. Each session wears one ink from
 * Birdbrain's spectrum, chosen by its number, so a session keeps its colour
 * wherever it is mentioned. The last index read is kept, so it opens offline.
 * Recording paths in the data are never shown.
 */

const CACHE = "murmur.chaos-record.v1";
const SPECTRUM = ["#ff3b30", "#ff9500", "#ffcc00", "#34c759", "#00c7be", "#007aff", "#af52de"];
const LIGHT = new Set(["#ffcc00", "#34c759", "#00c7be"]);
const inkOf = (id: string) => SPECTRUM[(Math.max(1, parseInt(id.replace(/\D/g, ""), 10) || 1) - 1) % SPECTRUM.length];
const onInk = (ink: string) => (LIGHT.has(ink) ? "#1a1a1a" : "#ffffff");

interface Session {
  id: string;
  date: string | null;
  status: string;
  frame?: string | null;
  topics?: string[];
  attendance_count?: number | null;
  attendance_names?: string[] | null;
  speaker_count?: number | null;
  duration_minutes?: number | null;
  counts?: Record<string, number>;
}
interface Question {
  session: string;
  text: string;
  raised_by?: string;
}
interface Concept {
  slug: string;
  first_seen: string;
  appears_in: string[];
  first_speaker?: string;
  summary: string;
}
interface Motif {
  id: string;
  label: string;
  summary: string;
  sessions: string[];
}
interface Index {
  cadence?: string;
  sessions: Session[];
  open_questions?: Question[];
  motifs?: Motif[];
  concepts?: { promoted?: Concept[]; provisional_count?: number };
  counts?: Record<string, number>;
}
interface Extract {
  quotes?: { speaker: string; timestamp?: string; text: string }[];
  decisions?: { what: string; by?: string; timestamp?: string }[];
  questions?: { text: string; raised_by?: string; timestamp?: string }[];
  concepts?: { name: string; summary: string; first_speaker?: string }[];
}
interface Detail extends Session {
  extract?: Extract;
  speaker_map?: Record<string, string>;
  deck?: { html?: string; pdf?: string };
}

function cached(): Index | null {
  try {
    return JSON.parse(localStorage.getItem(CACHE) || "null");
  } catch {
    return null;
  }
}

const day = (d: string | null) =>
  d ? new Date(`${d}T12:00:00Z`).toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" }) : "";
const words = (tag: string) => tag.replace(/-/g, " ");
const named = (tag: string) => words(tag).replace(/^./, (c) => c.toUpperCase());

function Badge({ id }: { id: string }) {
  const ink = inkOf(id);
  return (
    <span
      className="font-mono inline-flex items-center rounded-[4px] px-1.5 py-0.5 text-[10px] font-medium tracking-wide"
      style={{ background: ink, color: onInk(ink) }}
    >
      {id}
    </span>
  );
}

function Chip({ children, ink }: { children: string; ink?: string }) {
  return (
    <span
      className="rounded-full border border-[var(--line)] px-2 py-0.5 text-[11px] text-[var(--muted)]"
      style={ink ? { background: `color-mix(in srgb, ${ink} 9%, var(--card))` } : undefined}
    >
      {children}
    </span>
  );
}

/** One session strip per call: a quick way to see the whole run at a glance. */
function Run({ sessions, pick }: { sessions: Session[]; pick: (id: string) => void }) {
  const done = sessions.filter((s) => s.status === "complete");
  const most = Math.max(1, ...done.map((s) => s.attendance_count ?? s.speaker_count ?? 0));
  return (
    <div className="flex h-16 items-end gap-[3px]" aria-label="Every session, oldest on the left">
      {done.map((s) => {
        const n = s.attendance_count ?? s.speaker_count ?? 0;
        return (
          <button
            key={s.id}
            title={`${s.id} · ${day(s.date)}${n ? ` · ${n} people` : ""}`}
            onClick={() => pick(s.id)}
            className="flex-1 rounded-t-[2px] transition hover:opacity-70"
            style={{ height: `${18 + (n / most) * 82}%`, background: inkOf(s.id) }}
          />
        );
      })}
    </div>
  );
}

function Stat({ n, label }: { n: number | undefined; label: string }) {
  return (
    <div className="rounded-[var(--radius)] border border-[var(--line)] bg-[var(--card)] px-4 py-3">
      <div className="font-tight text-[26px] font-medium leading-none tracking-[-0.01em]">{n ?? "·"}</div>
      <div className="mt-1.5 text-[12px] text-[var(--muted)]">{label}</div>
    </div>
  );
}

type Tab = "sessions" | "ideas" | "questions";

function Tabs({ tab, set }: { tab: Tab; set: (t: Tab) => void }) {
  const all: [Tab, string][] = [
    ["sessions", "Sessions"],
    ["ideas", "Ideas"],
    ["questions", "Open questions"],
  ];
  return (
    <div className="flex gap-1 rounded-[var(--radius)] border border-[var(--line)] bg-[var(--raise)] p-1">
      {all.map(([k, label]) => (
        <button
          key={k}
          onClick={() => set(k)}
          className={`flex-1 rounded-[calc(var(--radius)-2px)] px-3 py-1.5 text-xs transition ${
            tab === k ? "bg-[var(--card)] font-medium text-[var(--fg)] shadow-sm" : "text-[var(--muted)] hover:text-[var(--fg)]"
          }`}
        >
          {label}
        </button>
      ))}
    </div>
  );
}

function SessionRow({ s, pick }: { s: Session; pick: (id: string) => void }) {
  const ink = inkOf(s.id);
  const people = s.attendance_count ?? s.speaker_count;
  return (
    <button
      onClick={() => pick(s.id)}
      className="prism-hover flex w-full flex-col rounded-[var(--radius)] border border-[var(--line)] bg-[var(--card)] px-4 py-3.5 text-left transition"
      style={{ borderLeft: `4px solid ${ink}` }}
    >
      <div className="flex flex-wrap items-center gap-2">
        <Badge id={s.id} />
        <span className="font-mono text-[10px] uppercase tracking-wide text-[var(--faint)]">
          {day(s.date)}
          {people ? ` · ${people} people` : ""}
          {s.duration_minutes ? ` · ${s.duration_minutes} min` : ""}
        </span>
      </div>
      {s.frame && <p className="mt-2 line-clamp-3 text-[14px] leading-relaxed">{s.frame}</p>}
      {!!s.topics?.length && (
        <div className="mt-2.5 flex flex-wrap gap-1.5">
          {s.topics.slice(0, 5).map((t) => (
            <Chip key={t} ink={ink}>
              {words(t)}
            </Chip>
          ))}
        </div>
      )}
    </button>
  );
}

function SessionView({ id, base, origin, back }: { id: string; base: string; origin: string; back: () => void }) {
  const [d, setD] = useState<Detail | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let alive = true;
    fetch(`${base}/api/chaOS/${encodeURIComponent(id)}`, { headers: { Accept: "application/json" } })
      .then((r) => (r.ok ? r.json() : Promise.reject(r.status)))
      .then((j: Detail) => alive && setD(j))
      .catch(() => alive && setFailed(true));
    return () => {
      alive = false;
    };
  }, [base, id]);

  const ink = inkOf(id);
  const x = d?.extract ?? {};
  const names = (d?.attendance_names ?? Object.values(d?.speaker_map ?? {})).filter((n) => n && n !== "Guest");
  const who = [...new Set(names)];

  return (
    <>
      <div>
        <Button icon={ArrowLeft} onClick={back}>
          The record
        </Button>
      </div>
      {failed && <Notice tone="warn">Couldn't fetch this session. Try again in a moment.</Notice>}
      {!d && !failed && <Waiting>Opening {id}</Waiting>}
      {d && (
        <article className="flex flex-col gap-6">
          <header className="overflow-hidden rounded-[var(--radius)] border border-[var(--line)] bg-[var(--card)]">
            <div className="h-1.5" style={{ background: ink }} />
            <div className="px-5 py-5" style={{ background: `color-mix(in srgb, ${ink} 6%, var(--card))` }}>
              <div className="flex flex-wrap items-center gap-2">
                <Badge id={id} />
                <span className="font-mono text-[11px] uppercase tracking-wide text-[var(--faint)]">
                  {day(d.date)}
                  {d.duration_minutes ? ` · ${d.duration_minutes} min` : ""}
                </span>
              </div>
              {d.frame && (
                <p className="font-tight mt-3 text-[21px] font-medium leading-snug tracking-[-0.01em]">{d.frame}</p>
              )}
              {!!d.topics?.length && (
                <div className="mt-3 flex flex-wrap gap-1.5">
                  {d.topics.map((t) => (
                    <Chip key={t} ink={ink}>
                      {words(t)}
                    </Chip>
                  ))}
                </div>
              )}
            </div>
          </header>

          {!!x.decisions?.length && (
            <Section label="What was decided" icon={CheckCircle2}>
              <ul className="flex flex-col gap-2">
                {x.decisions.map((k, n) => (
                  <li key={n} className="flex gap-3 rounded-[var(--radius)] border border-[var(--line)] bg-[var(--card)] px-4 py-3 text-[14px] leading-relaxed">
                    <span className="mt-[7px] h-2 w-2 shrink-0 rounded-full" style={{ background: ink }} />
                    <span>
                      {k.what}
                      {k.by && <span className="text-[var(--faint)]"> · {k.by}</span>}
                    </span>
                  </li>
                ))}
              </ul>
            </Section>
          )}

          {!!x.quotes?.length && (
            <Section label="In their words" icon={Quote}>
              <div className="flex flex-col gap-3">
                {x.quotes.slice(0, 6).map((q, n) => (
                  <blockquote key={n} className="border-l-[5px] pl-4" style={{ borderColor: ink }}>
                    <p className="font-serif text-[16px] leading-relaxed">“{q.text}”</p>
                    <footer className="font-mono mt-1 text-[11px] text-[var(--faint)]">
                      {q.speaker}
                      {q.timestamp ? ` · ${q.timestamp}` : ""}
                    </footer>
                  </blockquote>
                ))}
              </div>
            </Section>
          )}

          {!!x.concepts?.length && (
            <Section label="Ideas that came up" icon={Lightbulb}>
              <div className="grid gap-2 sm:grid-cols-2">
                {x.concepts.map((c) => (
                  <div key={c.name} className="rounded-[var(--radius)] border border-[var(--line)] bg-[var(--card)] px-4 py-3">
                    <div className="font-tight text-[14px] font-medium">{named(c.name)}</div>
                    <p className="mt-1 text-[13px] leading-relaxed text-[var(--muted)]">{c.summary}</p>
                    {c.first_speaker && <p className="font-mono mt-1.5 text-[10px] text-[var(--faint)]">raised by {c.first_speaker}</p>}
                  </div>
                ))}
              </div>
            </Section>
          )}

          {!!x.questions?.length && (
            <Section label="Left open" icon={CircleHelp}>
              <ul className="flex flex-col gap-2">
                {x.questions.map((q, n) => (
                  <li key={n} className="rounded-[var(--radius)] border border-dashed border-[var(--line-strong)] bg-[var(--raise)] px-4 py-3 text-[14px] leading-relaxed">
                    {q.text}
                    {q.raised_by && <span className="text-[var(--faint)]"> · {q.raised_by}</span>}
                  </li>
                ))}
              </ul>
            </Section>
          )}

          {who.length > 0 && (
            <Section label="Who was there" icon={Users}>
              <div className="flex flex-wrap gap-1.5">
                {who.map((n) => (
                  <Chip key={n}>{n}</Chip>
                ))}
              </div>
            </Section>
          )}

          {d.deck?.html && (
            <div>
              <Button trailing={ArrowUpRight} onClick={() => void openInBrowser(`${origin}${d.deck!.html}`)}>
                The session's picture story
              </Button>
            </div>
          )}
        </article>
      )}
    </>
  );
}

/** The whole record: numbers, the run of sessions, then sessions, ideas or open questions. */
export function ChaosRecord({ base, origin, back }: { base: string; origin: string; back: () => void }) {
  const [index, setIndex] = useState<Index | null>(cached);
  const [failed, setFailed] = useState(false);
  const [nonce, setNonce] = useState(0);
  const [tab, setTab] = useState<Tab>("sessions");
  const [open, setOpen] = useState<string | null>(null);
  const [more, setMore] = useState(false);

  useEffect(() => {
    let alive = true;
    setFailed(false);
    fetch(`${base}/api/chaOS`, { headers: { Accept: "application/json" } })
      .then((r) => (r.ok ? r.json() : Promise.reject(r.status)))
      .then((j: Index) => {
        if (!alive || !Array.isArray(j?.sessions)) return;
        const keep: Index = {
          cadence: j.cadence,
          sessions: j.sessions.map(({ id, date, status, frame, topics, attendance_count, speaker_count, duration_minutes }) => ({
            id, date, status, frame, topics, attendance_count, speaker_count, duration_minutes,
          })),
          open_questions: j.open_questions,
          motifs: j.motifs,
          concepts: { promoted: j.concepts?.promoted, provisional_count: j.concepts?.provisional_count },
          counts: j.counts,
        };
        setIndex(keep);
        try {
          localStorage.setItem(CACHE, JSON.stringify(keep));
        } catch {}
      })
      .catch(() => alive && setFailed(true));
    return () => {
      alive = false;
    };
  }, [base, nonce]);

  if (open) return <SessionView id={open} base={base} origin={origin} back={() => setOpen(null)} />;

  const done = (index?.sessions ?? []).filter((s) => s.status === "complete").reverse();
  const qs = [...(index?.open_questions ?? [])].reverse();
  const shown = more ? qs : qs.slice(0, 20);

  return (
    <>
      <div className="flex items-center justify-between gap-3">
        <Button icon={ArrowLeft} onClick={back}>
          Chaos Sessions
        </Button>
        <Button icon={RotateCw} onClick={() => setNonce((n) => n + 1)} title="Fetch the latest record">
          Refresh
        </Button>
      </div>
      {failed && (
        <Notice tone="warn">
          {index ? "Couldn't reach the record, so this is the last copy you read." : "Couldn't reach the record. Try again in a moment."}
        </Notice>
      )}
      {!index && !failed && <Waiting>Fetching the record</Waiting>}
      {index && (
        <>
          <Card tone="dashed">
            <div className="flex gap-3">
              <Sparkles className="mt-0.5 h-4 w-4 shrink-0 text-[var(--faint)]" />
              <div className="min-w-0">
                <div className="font-tight text-[13px] font-medium">How this is made</div>
                <p className="mt-1 text-[13px] leading-relaxed text-[var(--muted)]">
                  Every call is recorded and transcribed. A model then pulls out what was decided, what was asked and
                  which ideas came up, and keeps who said each one. Ideas that keep coming back across calls are
                  promoted.
                </p>
              </div>
            </div>
          </Card>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            <Stat n={index.counts?.sessions ?? done.length} label="sessions" />
            <Stat n={index.counts?.attendees} label="people" />
            <Stat n={index.concepts?.provisional_count} label="ideas raised" />
            <Stat n={index.counts?.open_questions ?? qs.length} label="questions left open" />
          </div>
          <Run sessions={index.sessions} pick={setOpen} />
          <Tabs tab={tab} set={setTab} />

          {tab === "sessions" && (
            <div className="flex flex-col gap-2">
              {done.map((s) => (
                <SessionRow key={s.id} s={s} pick={setOpen} />
              ))}
            </div>
          )}

          {tab === "ideas" && (
            <div className="flex flex-col gap-6">
              {!!index.motifs?.length && (
                <Section label="Threads that run through the calls" icon={Waves}>
                  <div className="flex flex-col gap-2">
                    {index.motifs.map((m, n) => {
                      const ink = SPECTRUM[(n * 2) % SPECTRUM.length];
                      return (
                        <div
                          key={m.id}
                          className="rounded-[var(--radius)] border border-[var(--line)] px-4 py-3.5"
                          style={{ background: `color-mix(in srgb, ${ink} 8%, var(--card))`, borderLeft: `4px solid ${ink}` }}
                        >
                          <div className="font-tight text-[15px] font-medium">{m.label}</div>
                          <p className="mt-1 text-[13px] leading-relaxed text-[var(--muted)]">{m.summary}</p>
                          <div className="mt-2 flex flex-wrap gap-1">
                            {m.sessions.map((s) => (
                              <button key={s} onClick={() => setOpen(s)}>
                                <Badge id={s} />
                              </button>
                            ))}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </Section>
              )}
              {!!index.concepts?.promoted?.length && (
                <Section label="Ideas that stuck" icon={Lightbulb} lede="Raised in one call and picked up again in later ones.">
                  <div className="grid gap-2 sm:grid-cols-2">
                    {index.concepts.promoted.map((c) => (
                      <div key={c.slug} className="rounded-[var(--radius)] border border-[var(--line)] bg-[var(--card)] px-4 py-3">
                        <div className="font-tight text-[14px] font-medium">{named(c.slug)}</div>
                        <p className="mt-1 text-[13px] leading-relaxed text-[var(--muted)]">{c.summary}</p>
                        <div className="mt-2 flex flex-wrap items-center gap-1">
                          {c.appears_in.map((s) => (
                            <button key={s} onClick={() => setOpen(s)}>
                              <Badge id={s} />
                            </button>
                          ))}
                          {c.first_speaker && <span className="font-mono ml-1 text-[10px] text-[var(--faint)]">first: {c.first_speaker}</span>}
                        </div>
                      </div>
                    ))}
                  </div>
                </Section>
              )}
            </div>
          )}

          {tab === "questions" && (
            <div className="flex flex-col gap-2">
              {shown.map((q, n) => (
                <button
                  key={n}
                  onClick={() => setOpen(q.session)}
                  className="prism-hover flex gap-3 rounded-[var(--radius)] border border-[var(--line)] bg-[var(--card)] px-4 py-3 text-left text-[14px] leading-relaxed transition"
                >
                  <span className="pt-0.5">
                    <Badge id={q.session} />
                  </span>
                  <span>
                    {q.text}
                    {q.raised_by && <span className="text-[var(--faint)]"> · {q.raised_by}</span>}
                  </span>
                </button>
              ))}
              {!more && qs.length > shown.length && (
                <div>
                  <Button onClick={() => setMore(true)}>Show all {qs.length}</Button>
                </div>
              )}
            </div>
          )}
        </>
      )}
    </>
  );
}
