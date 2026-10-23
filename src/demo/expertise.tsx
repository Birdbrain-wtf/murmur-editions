import { Inbox, Lightbulb, Lock, Route, ScrollText, Send } from "lucide-react";
import { edition, showcaseName } from "../edition";
import { Button, Card, List, Row, Section, Status } from "../ui";
import { GROUPS } from "./groups";
import { demoNote } from "./note";

/**
 * What the sample member knows, and the questions it brings her (invented demo
 * only). Expertise is read from her signed record across every group she is
 * in, never from what she says about herself. Groups post challenges, which
 * are matched privately against people's records: the person sees a question,
 * not who asked, and the group sees an answer, not a name. A design shown with
 * sample data. Payment keeps the contributor promise's tenses
 * (core/state/architecture/contributor-promise.md): "could", never "is".
 */

const home = showcaseName;
const g = (key: string) => GROUPS.find((x) => x.key === key)?.name ?? key;

const KNOWS: { what: string; from: string[]; behind: number; vouched: number }[] = [
  {
    what: "Raising money for a building with no legal form",
    from: [`${home}: the roof campaign`, `${g("northside")}: the heating appeal`],
    behind: 14,
    vouched: 2,
  },
  {
    what: "Recording music in schools and care homes",
    from: [`${home} Sessions: a year of sessions`],
    behind: 22,
    vouched: 1,
  },
  {
    what: "Location sound for documentaries",
    from: [`${g("halfmoon")}: two films, 31 days on location`],
    behind: 31,
    vouched: 1,
  },
  {
    what: "Running a fair members' vote",
    from: [`${g("loaf")}: three general meetings`, `${home}: the vote on the company`],
    behind: 6,
    vouched: 2,
  },
];
const MOST = Math.max(...KNOWS.map((k) => k.behind));

export function ExpertiseSection() {
  if (!edition.showcase) return null;
  return (
    <div data-tour-section="expertise" className="scroll-mt-6">
      <Section
        label="What she knows"
        icon={Lightbulb}
        lede="Read from work Alice signed in every group she's in, not from a CV. Each group that saw the work vouches for it. Nobody sees this unless she shows it."
      >
        <div className="mb-4 grid grid-cols-3 gap-2">
          {(
            [
              [String(KNOWS.length), "things she knows"],
              [String(KNOWS.reduce((n, k) => n + k.behind, 0)), "signed pieces behind them"],
              [String(GROUPS.length), "groups vouching"],
            ] as const
          ).map(([n, l]) => (
            <div key={l} className="rounded-[var(--radius)] border border-[var(--line)] bg-[var(--card)] px-3 py-2.5">
              <div className="font-tight text-xl font-medium">{n}</div>
              <div className="text-[11px] leading-snug text-[var(--faint)]">{l}</div>
            </div>
          ))}
        </div>
        <List>
          {KNOWS.map((k) => (
            <Row
              key={k.what}
              title={k.what}
              status={<Status tone="ok">{k.vouched === 1 ? "1 group vouches" : `${k.vouched} groups vouch`}</Status>}
              detail={
                <>
                  <div className="mt-1 flex items-center gap-2">
                    <span className="h-1.5 w-32 overflow-hidden rounded-full bg-[var(--line)]">
                      <span className="block h-full bg-[var(--fg)]" style={{ width: `${(k.behind / MOST) * 100}%` }} />
                    </span>
                    <span className="font-mono text-[11px] text-[var(--faint)]">{k.behind} signed pieces</span>
                  </div>
                  <div className="mt-1.5">From {k.from.join(" · ")}</div>
                </>
              }
            />
          ))}
        </List>
      </Section>
    </div>
  );
}

const ASKED: { who: string; q: string; match: string; terms: string; done?: string }[] = [
  {
    who: "A village hall committee",
    q: "Our heating appeal has stalled at £6,000. What got yours over the line?",
    match: KNOWS[0].what,
    terms: "An hour's written answer. £80, agreed up front.",
  },
  {
    who: "A theatre company of twelve",
    q: "What's a fair day rate for recording in care homes, and what must residents agree to?",
    match: KNOWS[1].what,
    terms: "A half-hour call. £60 offered.",
  },
  {
    who: "A school music service",
    q: "How do you get a portable recording kit through a school's safeguarding checks?",
    match: KNOWS[1].what,
    terms: "Answered on 9 October.",
    done: "Marked useful, noted in her record.",
  },
];

const HOW = [
  { icon: Send, title: "A group asks", line: "It writes the challenge. Its name stays off it." },
  { icon: Route, title: "The record finds who's done it", line: "Only people who have done it see the question." },
  { icon: ScrollText, title: "You answer", line: "They see your answer, not your name. It's credited to your record." },
];

export function AskedSection() {
  if (!edition.showcase) return null;
  return (
    <div data-tour-section="asked" className="scroll-mt-6">
      <Section
        label="Asked of her"
        icon={Inbox}
        lede="Any group can post a challenge, and it finds people who have done it before. Alice sees a question, not who asked. The group sees an answer, not her name."
      >
        <div className="mb-4 grid grid-cols-1 gap-2 sm:grid-cols-3">
          {HOW.map((h, i) => (
            <div key={h.title} className="rounded-[var(--radius)] border border-[var(--line)] bg-[var(--card)] px-4 py-3">
              <div className="flex items-center gap-2">
                <span className="font-mono flex h-5 w-5 items-center justify-center rounded-full border border-[var(--line-strong)] text-[10px] text-[var(--muted)]">
                  {i + 1}
                </span>
                <h.icon className="h-4 w-4 text-[var(--muted)]" />
              </div>
              <div className="font-tight mt-2 text-sm font-medium">{h.title}</div>
              <div className="mt-1 text-[12px] leading-relaxed text-[var(--muted)]">{h.line}</div>
            </div>
          ))}
        </div>

        <List>
          {ASKED.map((a) => (
            <Row
              key={a.q}
              icon={a.done ? ScrollText : Lock}
              title={`“${a.q}”`}
              status={a.done ? <Status tone="ok">answered</Status> : <Status tone="live">for her</Status>}
              detail={
                <>
                  <div>
                    {a.who} · matched on <span className="text-[var(--fg)]">{a.match.toLowerCase()}</span>
                  </div>
                  <div className="mt-1 text-[var(--faint)]">{a.done ? `${a.terms} ${a.done}` : a.terms}</div>
                </>
              }
              action={
                a.done ? undefined : (
                  <span className="flex gap-1.5">
                    <Button variant="quiet" onClick={() => demoNote("Declined. Nobody learns she said no. The question moves to the next match.")}>
                      Not for me
                    </Button>
                    <Button
                      onClick={() =>
                        demoNote("In your own app you'd answer here, signed with your passkey. Your name stays off unless you add it.")
                      }
                    >
                      Answer
                    </Button>
                  </span>
                )
              }
            />
          ))}
        </List>

        <div className="mt-4">
        <Card>
          <div className="font-tight text-sm font-medium">{home} asks too</div>
          <p className="mt-1.5 text-[13px] leading-relaxed text-[var(--muted)]">
            At ten weeks old, {home} Sessions Ltd asked: “How should we price care-home sessions?” Three people who had
            done it answered. {home} never learned who they were. They never saw its books.
          </p>
          <p className="mt-2 text-[13px] leading-relaxed text-[var(--muted)]">
            The more groups take part, the likelier a question finds someone who has done it.
          </p>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <Button
              onClick={() =>
                demoNote("In your own app a steward writes the challenge, members agree what it reveals, and it goes out without your group's name.")
              }
            >
              Ask the network
            </Button>
          </div>
        </Card>
        </div>
        <p className="mt-3 text-[12px] text-[var(--faint)]">
          Sample data. Nobody is paid through the network today. This shows how answers could be paid for.
        </p>
      </Section>
    </div>
  );
}
