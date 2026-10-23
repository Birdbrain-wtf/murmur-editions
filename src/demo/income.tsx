import { ArrowDownLeft, ArrowUpRight, CheckCircle2, Coins, KeyRound, Lock, Route, Send, Wallet } from "lucide-react";
import { edition, showcaseName } from "../edition";
import { Card, Section } from "../ui";
import { GROUPS } from "./groups";
import { RISO } from "./sample";
import { inviteMonths } from "./invites";

/**
 * What the sample member earns and pays, one payment at a time (invented demo
 * only). Every line traces to something in her record: an answer she gave, a
 * piece the group licensed, a session she led. Money moves when the record
 * says the work is done, so nobody chases an invoice. A design shown with
 * sample figures, labelled as such: the contributor promise
 * (core/state/architecture/contributor-promise.md) means nobody is paid
 * through the network today, and the section says so.
 */

const home = showcaseName;
const g = (key: string) => GROUPS.find((x) => x.key === key)?.name ?? key;
const gbp = (n: number, pence = false) =>
  new Intl.NumberFormat("en-GB", {
    style: "currency",
    currency: "GBP",
    minimumFractionDigits: pence ? 2 : 0,
    maximumFractionDigits: pence ? 2 : 0,
  }).format(n);

interface Stream {
  key: string;
  label: string;
  how: string;
  ink: string;
  /** twelve months, oldest first */
  months: number[];
}

// November to October. Each stream's months add up to its year.
const STREAMS: Stream[] = [
  {
    key: "sessions",
    label: `${home} Sessions Ltd`,
    how: "Sessions she led, paid when the school signs the session off",
    ink: RISO.yellow,
    months: [0, 0, 0, 60, 120, 120, 180, 120, 0, 180, 240, 240],
  },
  {
    key: "answers",
    label: "Answering the network",
    how: "Questions matched to her record, paid when the asker marks them answered",
    ink: RISO.blue,
    months: [0, 0, 72, 0, 54, 72, 0, 72, 54, 0, 72, 126],
  },
  {
    key: "licence",
    label: "Her pieces, licensed",
    how: `Her share when ${home} licenses the Review, on terms members agreed`,
    ink: RISO.pink,
    months: [0, 0, 0, 0, 0, 38, 0, 0, 44, 0, 0, 51],
  },
  {
    key: "invites",
    label: "People she brought in",
    how: "A share of the Network Rate on answers given by people she invited, and the people they invited",
    ink: "#e0a800",
    months: inviteMonths(),
  },
  {
    key: "halfmoon",
    label: g("halfmoon"),
    how: "Location sound days, paid against the call sheet she signed",
    ink: "#7b4fc4",
    months: [0, 0, 0, 0, 0, 0, 450, 0, 0, 0, 0, 0],
  },
  {
    key: "loaf",
    label: g("loaf"),
    how: "Her share of the co-op's surplus, by what she bought",
    ink: "#1f9d6b",
    months: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 38],
  },
];
const MONTHS = ["N", "D", "J", "F", "M", "A", "M", "J", "J", "A", "S", "O"];
const yearOf = (s: Stream) => s.months.reduce((a, b) => a + b, 0);
const YEAR = STREAMS.reduce((n, s) => n + yearOf(s), 0);
const PEAK = Math.max(...MONTHS.map((_, i) => STREAMS.reduce((n, s) => n + s.months[i], 0)));
const THROUGH_NETWORK = yearOf(STREAMS[1]) + yearOf(STREAMS[2]);

const OUT: { what: string; amount: number; atSource?: boolean }[] = [
  { what: `Her ${home} membership, £5 a month`, amount: 60 },
  { what: "One question she asked the network, about mixing for radio", amount: 45 },
  { what: "Network Rate: 10% of her network earnings, taken before they reached her", amount: Math.round(THROUGH_NETWORK / 9), atSource: true },
];

const RECENT: { day: string; what: string; amount: number; stream: string }[] = [
  { day: "11 Oct", what: "Session at St Aidan's Primary, signed off", amount: 120, stream: "sessions" },
  { day: "9 Oct", what: "Answer: “How do you get a recording kit through safeguarding?”", amount: 54, stream: "answers" },
  { day: "6 Oct", what: "Common Loaf's surplus, shared out", amount: 38, stream: "loaf" },
  { day: "3 Oct", what: "“A studio that travels”, licensed by Huxley to community radio", amount: 51, stream: "licence" },
  { day: "2 Oct", what: "Answer: “How did you raise for a roof with no bank account?”", amount: 72, stream: "answers" },
];
const inkFor = (k: string) => STREAMS.find((s) => s.key === k)!.ink;

/** One £80 answer, followed from the asker's budget to Alice's wallet. */
const TRAIL = [
  { icon: Send, title: "A co-op asks", line: "It sets aside £80. Its name stays off the question." },
  { icon: Route, title: "Her record matches", line: "Alice has raised for a roof before, so it reaches her." },
  { icon: KeyRound, title: "She answers", line: "Signed with her key, so it's provably hers. The co-op never sees her name." },
  { icon: CheckCircle2, title: "They mark it useful", line: "That triggers payment. No invoice." },
  { icon: Wallet, title: "She's paid", line: "£72 lands in her wallet that minute, noted in her record." },
];

function YearChart() {
  return (
    <div>
      <div className="flex h-36 items-end gap-1.5">
        {MONTHS.map((m, i) => {
          const total = STREAMS.reduce((n, s) => n + s.months[i], 0);
          return (
            <div key={i} className="flex h-full flex-1 flex-col items-center justify-end gap-1">
              <div
                className="flex w-full flex-col-reverse overflow-hidden rounded-[3px]"
                style={{ height: `${(total / PEAK) * 100}%`, minHeight: total ? 3 : 1, background: total ? undefined : "var(--line)" }}
                title={`${gbp(total)}`}
              >
                {STREAMS.map((s) =>
                  s.months[i] ? <div key={s.key} style={{ height: `${(s.months[i] / total) * 100}%`, background: s.ink }} /> : null,
                )}
              </div>
              <span className="font-mono text-[10px] text-[var(--faint)]">{m}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function Split() {
  return (
    <div>
      <div className="flex h-9 overflow-hidden rounded-[var(--radius)] text-[12px] font-medium">
        <div className="flex items-center px-3 text-white" style={{ width: "90%", background: RISO.blue }}>
          £72 to Alice
        </div>
        <div className="flex items-center justify-center bg-[var(--fg)] text-[var(--bg)]" style={{ width: "10%" }}>
          £8
        </div>
      </div>
      <div className="mt-1.5 flex flex-col gap-0.5 text-[11px] text-[var(--faint)] sm:flex-row sm:justify-between">
        <span>£80 the co-op set aside</span>
        <span>10% Network Rate: running costs, the group's fund, her inviters</span>
      </div>
    </div>
  );
}

export function IncomeSection() {
  if (!edition.showcase) return null;
  const outTotal = OUT.filter((o) => !o.atSource).reduce((n, o) => n + o.amount, 0);
  return (
    <div data-tour-section="income" className="scroll-mt-6">
      <Section
        label="What comes back to her"
        icon={Coins}
        lede="Each payment would trace to work in her record and arrive once the work is signed off. No invoices. What she pays out is just as plain."
      >
        <Card>
          <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
            <div>
              <div className="font-mono text-[11px] uppercase tracking-wide text-[var(--faint)]">The last twelve months</div>
              <div className="font-tight mt-1 text-[40px] font-medium leading-none tracking-[-0.02em]">{gbp(YEAR)}</div>
              <div className="mt-2 text-[13px] text-[var(--muted)]">
                from {STREAMS.length} places · {gbp(YEAR - outTotal)} after outgoings
              </div>
            </div>
            <div className="grid grid-cols-1 gap-1.5 sm:min-w-[240px]">
              {STREAMS.map((s) => (
                <div key={s.key} className="flex items-center justify-between gap-3 text-[12px]">
                  <span className="flex items-center gap-2">
                    <span className="h-2.5 w-2.5 rounded-full" style={{ background: s.ink }} />
                    {s.label}
                  </span>
                  <span className="font-mono text-[var(--muted)]">{gbp(yearOf(s))}</span>
                </div>
              ))}
            </div>
          </div>
          <div className="mt-5">
            <YearChart />
          </div>
          <div className="mt-4 flex h-2 overflow-hidden rounded-full">
            {STREAMS.map((s) => (
              <div key={s.key} style={{ width: `${(yearOf(s) / YEAR) * 100}%`, background: s.ink }} />
            ))}
          </div>
        </Card>

        <div className="mt-4">
          <Card>
            <div className="font-tight text-sm font-medium">One £80 answer, start to finish</div>
            <ol className="mt-4 grid grid-cols-1 gap-2 sm:grid-cols-5">
              {TRAIL.map((t, i) => (
                <li key={t.title} className="relative rounded-[var(--radius)] border border-[var(--line)] bg-[var(--card)] px-3 py-3">
                  <div className="flex items-center gap-2">
                    <span
                      className="font-mono flex h-5 w-5 items-center justify-center rounded-full text-[10px] text-white"
                      style={{ background: i === TRAIL.length - 1 ? RISO.blue : "var(--fg)" }}
                    >
                      {i + 1}
                    </span>
                    <t.icon className="h-4 w-4 text-[var(--muted)]" />
                  </div>
                  <div className="font-tight mt-2 text-[13px] font-medium">{t.title}</div>
                  <div className="mt-1 text-[12px] leading-relaxed text-[var(--muted)]">{t.line}</div>
                </li>
              ))}
            </ol>
            <div className="mt-4">
              <Split />
            </div>
          </Card>
        </div>

        <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-[1.5fr_1fr]">
          <Card>
            <div className="font-tight flex items-center gap-2 text-sm font-medium">
              <ArrowDownLeft className="h-4 w-4 text-[var(--muted)]" /> Coming in
            </div>
            <ul className="mt-3 flex flex-col">
              {RECENT.map((r) => (
                <li key={r.day + r.what} className="flex items-start gap-3 border-t border-[var(--line)] py-2.5 first:border-t-0">
                  <span className="mt-0.5 h-9 w-1.5 shrink-0 rounded-full" style={{ background: inkFor(r.stream) }} />
                  <div className="min-w-0 flex-1">
                    <div className="text-[13px] leading-snug">{r.what}</div>
                    <div className="font-mono mt-0.5 text-[11px] text-[var(--faint)]">{r.day} · paid automatically</div>
                  </div>
                  <span className="font-mono whitespace-nowrap text-[13px] font-medium">+{gbp(r.amount)}</span>
                </li>
              ))}
            </ul>
          </Card>
          <Card>
            <div className="font-tight flex items-center gap-2 text-sm font-medium">
              <ArrowUpRight className="h-4 w-4 text-[var(--muted)]" /> Going out, this year
            </div>
            <ul className="mt-3 flex flex-col">
              {OUT.map((o) => (
                <li key={o.what} className="flex items-start justify-between gap-3 border-t border-[var(--line)] py-2.5 first:border-t-0">
                  <span className="text-[13px] leading-snug text-[var(--muted)]">{o.what}</span>
                  <span className={`font-mono whitespace-nowrap text-[13px] ${o.atSource ? "text-[var(--faint)]" : ""}`}>
                    {o.atSource ? `(${gbp(o.amount)})` : `−${gbp(o.amount)}`}
                  </span>
                </li>
              ))}
            </ul>
            <p className="mt-2 text-[12px] leading-relaxed text-[var(--faint)]">
              When she asks, it runs in reverse. She sets money aside for whoever answers.
            </p>
          </Card>
        </div>

        <p className="mt-3 flex items-start gap-1.5 text-[12px] text-[var(--faint)]">
          <Lock className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          Sample figures. Nobody is paid through the network today. Each payment could be tied to signed work and seen
          only by her.
        </p>
      </Section>
    </div>
  );
}
