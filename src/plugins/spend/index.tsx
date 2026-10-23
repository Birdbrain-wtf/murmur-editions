import { useState } from "react";
import {
  ArrowRight,
  Building2,
  CreditCard,
  KeyRound,
  Lock,
  Receipt,
  Snowflake,
  Target,
  Users,
} from "lucide-react";
import type { MurmurModule, PluginContext } from "../../host/types";
import { issues } from "../../host/support";
import { logoUrl } from "../../host/useSkin";
import { edition, shaped } from "../../edition";
import { demoNote } from "../../demo/note";
import { colourful, inkOf, onInk } from "../../demo/ink";
import { Button, Notice, Page, PageBody, PageHeader, Section, Status } from "../../ui";

/**
 * Spending: the money members gave, spent in the open. A group has its own
 * debit card, and the stewards give a member a card with a budget for one job.
 * Every payment carries what it was for, whose card paid, its receipt and the
 * passkeys that agreed it, so the books keep themselves.
 *
 * Demo only (Huxley): a design with sample data. What is real today is
 * Decent's own virtual debit card through a regulated card partner (see
 * orbits/bloque/AGENTS.md). The copy must keep to the UK card rules there:
 * "a debit card", never the digital money behind it, no rewards or perks, and
 * the company keeps its own account apart from the collective's (ADR 0057).
 */

const PEOPLE: Record<string, string> = { Alice: "#e5383b", Bob: "#0078bf", Carol: "#ff48b0" };

interface Pocket {
  id: string;
  title: string;
  raised: number;
  spent: number;
  note: string;
  open?: boolean;
}

// Each initiative's money sits in its own pocket, so it's only spent on what it was given for.
const POCKETS: Pocket[] = [
  { id: "bursaries", title: "Six more bursaries", raised: 5120, spent: 2250, note: "Raising now. Studio time, mentors and travel.", open: true },
  { id: "roof", title: "The roof", raised: 18420, spent: 18060, note: "Done. £360 held for the gutters, agreed 14 to 0." },
  { id: "kit", title: "The travelling kit", raised: 3410, spent: 3390, note: "Done. The kit now belongs to Huxley Sessions Ltd." },
];

interface HolderCard {
  who: string;
  role: string;
  last4: string;
  pocket: string;
  rules: string[];
  live: boolean;
}

const CARDS: HolderCard[] = [
  {
    who: "Alice",
    role: "steward",
    last4: "4417",
    pocket: "Any pocket",
    live: true,
    rules: ["Spends from any pocket", "Up to £500 a payment on her own", "Over £500, a second steward's passkey"],
  },
  {
    who: "Bob",
    role: "runs the bursaries",
    last4: "2093",
    pocket: "Bursaries only",
    live: true,
    rules: ["Spends only from the bursaries pocket", "Up to £300 a month", "Ends when the bursary year ends"],
  },
  {
    who: "Carol",
    role: "runs the open day",
    last4: "7710",
    pocket: "Open day",
    live: false,
    rules: ["Switches on if members agree the open day", "£400 in all, for tea and sound", "Ends the week after"],
  },
];

interface Payment {
  daysAgo: number;
  what: string;
  where: string;
  amount: number;
  who: string;
  pocket: string;
  receipt: boolean;
  /** a second steward's passkey, for anything over the card's own limit */
  second?: string;
}

const PAYMENTS: Payment[] = [
  { daysAgo: 2, what: "Studio time for Jess and Theo", where: "Huxley's own rooms", amount: 240, who: "Bob", pocket: "bursaries", receipt: true },
  { daysAgo: 5, what: "Mentor sessions, October", where: "Four mentors", amount: 450, who: "Alice", pocket: "bursaries", receipt: true },
  { daysAgo: 8, what: "Train fares to a showcase in Leeds", where: "Rail operator", amount: 86.4, who: "Bob", pocket: "bursaries", receipt: true },
  { daysAgo: 11, what: "A laptop for the bursary room", where: "Computer shop", amount: 620, who: "Alice", pocket: "bursaries", receipt: true, second: "Dave" },
  { daysAgo: 13, what: "Strings and reeds", where: "Music shop", amount: 38.5, who: "Bob", pocket: "bursaries", receipt: false },
  { daysAgo: 30, what: "Gutter clips and sealant", where: "Builders' merchant", amount: 64.2, who: "Alice", pocket: "roof", receipt: true },
];

const gbp = (n: number) =>
  n.toLocaleString("en-GB", { style: "currency", currency: "GBP", minimumFractionDigits: n % 1 ? 2 : 0, maximumFractionDigits: 2 });

const when = (n: number) =>
  n === 0
    ? "Today"
    : new Date(Date.now() - n * 86400000).toLocaleDateString("en-GB", { day: "numeric", month: "short" });

const POCKET_INK: Record<string, string> = { bursaries: "#1f9d6b", roof: "#0078bf", kit: "#ff7a3d" };

/** The card itself: black like Huxley, with a stripe in its holder's colour. */
function DebitCard({ card }: { card: HolderCard }) {
  const ink = PEOPLE[card.who];
  return (
    <div
      role="img"
      aria-label={`${card.who}'s Huxley debit card, ${card.pocket}`}
      className="relative aspect-[1.586] w-full overflow-hidden rounded-[16px] bg-[#151515] text-white shadow-[0_14px_34px_-14px_rgba(0,0,0,0.55)]"
    >
      <span aria-hidden className="absolute -right-10 top-0 h-full w-24 rotate-[18deg]" style={{ background: ink }} />
      <span aria-hidden className="absolute -right-2 top-0 h-full w-3 rotate-[18deg]" style={{ background: "#ffd400" }} />
      <div className="relative flex h-full flex-col justify-between p-4">
        <div className="flex items-center gap-2">
          <img src={logoUrl("/brand/huxley.png")} alt="" className="h-7 w-7 rounded-full bg-white p-0.5" />
          <span className="font-tight text-[15px] font-medium tracking-tight">Huxley</span>
          <span className="text-[10px] uppercase tracking-[0.18em] opacity-60">debit</span>
          {!card.live && (
            <span className="ml-auto rounded-full border border-white/40 px-2 py-0.5 text-[10px] uppercase tracking-wider">
              waiting
            </span>
          )}
        </div>
        <svg viewBox="0 0 40 30" className="h-6 w-8" aria-hidden>
          <rect x="1" y="1" width="38" height="28" rx="5" fill="#d9c27a" />
          <path d="M1 11h12M1 19h12M27 11h12M27 19h12M13 1v28M27 1v28" stroke="#a88d3e" strokeWidth="1.2" fill="none" />
        </svg>
        <div>
          <div className="font-mono text-[13px] tracking-[0.18em] opacity-90">···· {card.last4}</div>
          <div className="mt-1 flex items-end justify-between gap-2">
            <div className="min-w-0">
              <div className="truncate text-[12px] font-medium uppercase tracking-wider">{card.who}</div>
              <div className="truncate text-[10px] uppercase tracking-wider opacity-70">{card.pocket}</div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function Cards() {
  const [pick, setPick] = useState(0);
  const [frozen, setFrozen] = useState<Record<string, boolean>>({});
  const card = CARDS[pick];
  const ink = PEOPLE[card.who];
  return (
    <div className="grid gap-5 md:grid-cols-[1fr_1.1fr]">
      <div>
        <div className="mx-auto max-w-[400px]">
          <DebitCard card={card} />
        </div>
        <div className="mx-auto mt-3 grid max-w-[400px] grid-cols-3 gap-2" role="tablist" aria-label="Whose card">
          {CARDS.map((c, i) => (
            <button
              key={c.who}
              role="tab"
              aria-selected={i === pick}
              onClick={() => setPick(i)}
              className="flex items-center gap-2 rounded-[10px] border border-[var(--line)] bg-[var(--card)] px-2.5 py-2 text-left transition hover:border-[var(--line-strong)] aria-selected:border-[var(--fg)]"
            >
              <span className="relative h-5 w-8 shrink-0 overflow-hidden rounded-[4px] bg-[#151515]">
                <span className="absolute -right-1 top-0 h-full w-3 rotate-[18deg]" style={{ background: PEOPLE[c.who] }} />
              </span>
              <span className="min-w-0">
                <span className="block truncate text-[12px] font-medium">{c.who}</span>
                <span className="block truncate text-[10.5px] text-[var(--muted)]">{c.pocket}</span>
              </span>
            </button>
          ))}
        </div>
      </div>
      <div className="rounded-[var(--radius)] border border-[var(--line)] bg-[var(--card)] p-5">
        <div className="flex items-center gap-3">
          <span className="flex h-9 w-9 items-center justify-center rounded-full text-sm font-semibold" style={{ background: ink, color: onInk(ink) }}>
            {card.who[0]}
          </span>
          <div className="min-w-0">
            <div className="font-tight text-[15px] font-medium">{card.who}'s card</div>
            <div className="text-[12px] text-[var(--muted)]">{card.role}</div>
          </div>
          <div className="ml-auto">
            {!card.live ? (
              <Status tone="idle">waiting on a vote</Status>
            ) : frozen[card.who] ? (
              <Status tone="idle">frozen</Status>
            ) : (
              <Status tone="ok">on</Status>
            )}
          </div>
        </div>
        <ul className="mt-4 flex flex-col gap-2.5">
          {card.rules.map((r, n) => (
            <li key={r} className="flex items-start gap-2.5 text-[13px] leading-snug">
              <span className="mt-0.5 shrink-0 text-[var(--ink,var(--muted))]">
                {(() => {
                  const Icon = [Target, Lock, KeyRound][n] ?? Target;
                  return <Icon className="h-4 w-4" />;
                })()}
              </span>
              {r}
            </li>
          ))}
        </ul>
        <p className="mt-4 text-[12px] leading-relaxed text-[var(--muted)]">
          Stewards set these rules in view of members. Changing one needs a passkey approval.
        </p>
        {card.live && (
          <div className="mt-4">
            <Button
              icon={Snowflake}
              onClick={() => {
                setFrozen((f) => ({ ...f, [card.who]: !f[card.who] }));
                demoNote(frozen[card.who] ? `${card.who}'s card is back on.` : `${card.who}'s card is frozen. Any steward, or ${card.who}, can do it in one tap.`);
              }}
            >
              {frozen[card.who] ? "Unfreeze" : "Freeze"}
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}

function Pockets() {
  return (
    <div className="grid gap-3 sm:grid-cols-3">
      {POCKETS.map((p) => {
        const ink = colourful ? POCKET_INK[p.id] : "var(--fg)";
        const left = p.raised - p.spent;
        return (
          <div key={p.id} className="relative overflow-hidden rounded-[var(--radius)] border border-[var(--line)] bg-[var(--card)] px-4 pt-4 pb-3.5">
            <span aria-hidden className="absolute inset-x-0 top-0 h-1" style={{ background: ink }} />
            <div className="flex items-center justify-between gap-2">
              <span className="font-tight text-[14px] font-medium">{p.title}</span>
              {p.open && <Status tone="live">open</Status>}
            </div>
            <div className="font-tight mt-2 text-2xl font-medium">{gbp(left)}</div>
            <div className="text-[11px] text-[var(--muted)]">left · {gbp(p.spent)} spent of {gbp(p.raised)} given</div>
            <div className="mt-3 h-2 overflow-hidden rounded-full bg-[var(--raise)]">
              <div className="h-full rounded-full" style={{ width: `${Math.round((p.spent / p.raised) * 100)}%`, background: ink }} />
            </div>
            <p className="mt-2.5 text-[12px] leading-snug text-[var(--muted)]">{p.note}</p>
          </div>
        );
      })}
    </div>
  );
}

function Payments() {
  return (
    <ol className="flex flex-col divide-y divide-[var(--line)] overflow-hidden rounded-[var(--radius)] border border-[var(--line)] bg-[var(--card)]">
      {PAYMENTS.map((p) => {
        const ink = PEOPLE[p.who];
        const pocket = POCKETS.find((x) => x.id === p.pocket)!;
        return (
          <li key={p.what} className="flex items-start gap-3 px-4 py-3">
            <span
              className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-[12px] font-semibold"
              style={{ background: ink, color: onInk(ink) }}
              title={`${p.who}'s card`}
            >
              {p.who[0]}
            </span>
            <div className="min-w-0 flex-1">
              <div className="flex items-baseline justify-between gap-3">
                <span className="font-tight truncate text-[14px] font-medium">{p.what}</span>
                <span className="font-tight shrink-0 text-[14px] font-medium tabular-nums">{gbp(p.amount)}</span>
              </div>
              <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-[11.5px] text-[var(--muted)]">
                <span>{when(p.daysAgo)}</span>
                <span aria-hidden>·</span>
                <span>{p.where}</span>
                <span
                  className="rounded-full px-2 py-px text-[10.5px] font-medium"
                  style={colourful ? { background: POCKET_INK[p.pocket], color: onInk(POCKET_INK[p.pocket]) } : { border: "1px solid var(--line-strong)" }}
                >
                  {pocket.title}
                </span>
                {p.second && (
                  <span className="inline-flex items-center gap-1">
                    <KeyRound className="h-3 w-3" /> approved by {p.who} and {p.second}
                  </span>
                )}
                {p.receipt ? (
                  <span className="inline-flex items-center gap-1">
                    <Receipt className="h-3 w-3" /> receipt filed
                  </span>
                ) : (
                  <button
                    className="inline-flex items-center gap-1 font-medium text-[var(--fg)] underline decoration-dotted underline-offset-2"
                    onClick={() =>
                      demoNote(`${p.who} gets a nudge to photograph the receipt. The agent files it under ${pocket.title.toLowerCase()}.`)
                    }
                  >
                    <Receipt className="h-3 w-3" /> receipt needed
                  </button>
                )}
              </div>
            </div>
          </li>
        );
      })}
    </ol>
  );
}

function Apart({ open }: { open: (id: string) => void }) {
  const sides = [
    {
      icon: Users,
      title: "Huxley, the collective",
      line: "Gifts and members' subs, spent only on what members agreed.",
      ink: inkOf("spend"),
    },
    {
      icon: Building2,
      title: "Huxley Sessions Ltd",
      line: "Its own account and cards. Paid by schools, care homes and investors.",
      ink: inkOf("operations"),
    },
  ];
  return (
    <div className="rounded-[var(--radius)] border border-[var(--line)] bg-[var(--card)] p-5">
      <div className="grid gap-4 sm:grid-cols-2">
        {sides.map((s) => (
          <div key={s.title} className="flex gap-3">
            <span
              className="flex h-9 w-9 shrink-0 items-center justify-center rounded-[10px]"
              style={colourful ? { background: s.ink, color: onInk(s.ink) } : { border: "1px solid var(--line-strong)" }}
            >
              <s.icon className="h-[18px] w-[18px]" />
            </span>
            <div>
              <div className="font-tight text-[14px] font-medium">{s.title}</div>
              <p className="mt-1 text-[12.5px] leading-snug text-[var(--muted)]">{s.line}</p>
            </div>
          </div>
        ))}
      </div>
      <p className="mt-4 border-t border-[var(--line)] pt-4 text-[13px] leading-relaxed">
        Gifts never pay the company's bills. The agent keeps the two sets of books apart.
      </p>
      <div className="mt-3">
        <Button trailing={ArrowRight} onClick={() => open("operations")}>
          The company's books
        </Button>
      </div>
    </div>
  );
}

function Panel({ open }: PluginContext) {
  const name = edition.instance.name;
  return (
    <Page>
      <PageHeader
        icon={CreditCard}
        eyebrow="spending"
        title="Spending"
        lede={`What members gave, spent in the open.`}
      />
      <PageBody width="wide">
        <Section label={`${name}'s cards`} icon={CreditCard}>
          <Cards />
        </Section>

        <Section label="Where the money is" icon={Target} lede="One pocket per initiative, spent only on what it was given for.">
          <Pockets />
        </Section>

        <Section label="Payments" icon={Receipt} lede="Every payment and its receipt, open to members.">
          <Payments />
        </Section>

        {!shaped && (
          <Section label="Two pockets, kept apart" icon={Building2}>
            <Apart open={open} />
          </Section>
        )}

        <Notice>
          Sample figures. Live today: Decent's own debit card, issued by a regulated card company, not by Decent. In the works:
          cards in a group's own name, and in the UK.
        </Notice>
      </PageBody>
    </Page>
  );
}

export const spendPlugin: MurmurModule = {
  id: "spend",
  title: "Spending",
  tagline: "A debit card for your group, with every payment in the open",
  icon: CreditCard,
  order: 33,
  kind: "plugin",
  lab: true,
  support: issues("spend"),
  backend: "a regulated card company, through Decent",
  Panel,
};
