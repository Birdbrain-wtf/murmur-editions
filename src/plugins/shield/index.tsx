import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import {
  ArrowDownToLine,
  ArrowUpFromLine,
  ChevronDown,
  CircleAlert,
  Clock,
  Copy,
  ExternalLink,
  Eye,
  EyeOff,
  KeyRound,
  RefreshCw,
  Search,
  Trash2,
  Users,
  Wallet,
} from "lucide-react";
import type { MurmurModule, PluginContext } from "../../host/types";
import { issues } from "../../host/support";
import {
  Button,
  Card,
  Empty,
  Facts,
  Field,
  Gate,
  List,
  Notice,
  Page,
  PageBody,
  PageHeader,
  Row,
  Section,
  Status,
  Waiting,
  inputClass,
} from "../../ui";
import { keySecret, persistent } from "../../lib/secrets";
import { openInBrowser } from "../../identity/passkey";
import {
  SHIELD_NETWORKS,
  account,
  canShield,
  collectAddress,
  connect,
  deriveNote,
  formatAmount,
  crowdSize,
  hidingAmong,
  markSpent,
  newWords,
  nextIndex,
  notes as heldNotes,
  parseAmount,
  readCrowd,
  recover,
  rememberNote,
  shield,
  unshield,
  validWords,
  type Crowd,
  type Held,
  type ShieldNet,
  type ShieldNetwork,
  type Step,
} from "../../lib/shield";

/**
 * Shield: pay into a shielded pool, wait, take it out somewhere new.
 *
 * The pool is Kusama Shield's (shield.markets), a contract on Asset Hub. The
 * hiding is done by the crowd, not by the maths: the proof says "one of these
 * deposits is mine" and the crowd is how many deposits that could mean. So the
 * crowd is the first thing on the screen and the last word in every warning,
 * the way Swap leads with how far a trade moves the pool's price.
 *
 * It is a lab plugin on test money. Everything it will not promise is on the
 * screen, under "What this cannot promise yet", and real money is off in code.
 */

const NET_KEY = "murmur.shield.net.v1";
const ACCOUNT_KEY = "murmur.shield.account.v1";
const WORDS = "shield.words";
/** Swap's words, offered so a member need only write one set down. */
const SWAP_WORDS = "swap.words";

/** One ink for the whole plugin: it says "hidden", and only the member's own
 *  marks wear it. Prism holds: white at rest, colour is the consequence. */
const INK = "#4338ca";
const wash = (pct: number) => `color-mix(in srgb, ${INK} ${pct}%, var(--card))`;

const ago = (seconds: number | null) => {
  if (seconds == null) return "never";
  const mins = Math.max(0, Math.round((Date.now() / 1000 - seconds) / 60));
  if (mins < 60) return `${mins} min ago`;
  const hours = Math.round(mins / 60);
  if (hours < 48) return `${hours} h ago`;
  return `${Math.round(hours / 24)} days ago`;
};

// ── the crowd ───────────────────────────────────────────────────────────────

/**
 * Every deposit in the pool, as one square each, the member's own filled in.
 * A privacy screen that does not show this is asking to be believed; this one
 * can be counted. An empty pool looks empty, which is the point.
 */
function CrowdStrip({ total, mine, unread }: { total: number; mine: number[]; unread?: boolean }) {
  const shown = Math.min(total, 240);
  const own = new Set(mine);
  if (unread)
    return (
      <div className="grid place-items-center rounded-[calc(var(--radius)+4px)] border border-dashed border-[var(--line-strong)] px-4 py-7 text-center text-[13px] text-[var(--muted)]">
        The pool could not be read, so there is nothing honest to show here.
      </div>
    );
  if (total === 0)
    return (
      <div
        className="grid place-items-center rounded-[calc(var(--radius)+4px)] border border-dashed border-[var(--line-strong)] px-4 py-7 text-center text-[13px] text-[var(--muted)]"
        aria-label="The pool is empty"
      >
        Nobody is in the pool.
      </div>
    );
  return (
    <div
      className="flex flex-wrap gap-1 rounded-[calc(var(--radius)+4px)] px-4 py-4"
      style={{ background: wash(5) }}
      role="img"
      aria-label={`${total} deposits in the pool, ${mine.length} of them yours`}
    >
      {Array.from({ length: shown }, (_, i) => {
        const isMine = own.has(i);
        return (
          <span
            key={i}
            title={isMine ? "Yours" : "Someone else's deposit"}
            className="h-3 w-3 rounded-[3px] ring-1"
            style={{
              background: isMine ? INK : "var(--card)",
              // @ts-expect-error CSS custom property on a style object
              "--tw-ring-color": isMine ? INK : "var(--line-strong)",
            }}
          />
        );
      })}
      {total > shown && <span className="self-center pl-1 text-xs text-[var(--faint)]">+{total - shown} more</span>}
    </div>
  );
}

/** The one number this plugin exists to tell the truth about. */
function CrowdSection({
  n,
  crowd,
  mine,
  onRefresh,
  busy,
}: {
  n: ShieldNetwork;
  crowd: Crowd | null;
  mine: number[];
  onRefresh: () => void;
  busy: boolean;
}) {
  const total = crowdSize(crowd);
  const unread = !crowd;
  const verdict = unread
    ? busy
      ? "Reading the pool."
      : "The pool has not been read, so nothing here says how much cover it gives. An unread pool is not an empty one."
    : total === 0
      ? "A shielded pool hides you among other people's deposits. With nobody else here, it hides nothing."
      : total < 10
        ? `A withdrawal from this pool has ${total} deposit${total === 1 ? "" : "s"} it could have come from. That is a small crowd, and a small crowd is a thin disguise.`
        : `A withdrawal from this pool could have come from any of ${total} deposits.`;
  return (
    <Section
      label="The crowd"
      icon={Users}
      lede={`How much cover the ${n.label} pool actually gives, counted from the chain rather than claimed.`}
      aside={
        <Button variant="quiet" icon={RefreshCw} busy={busy} onClick={onRefresh}>
          Refresh
        </Button>
      }
    >
      <div className="space-y-3">
        <CrowdStrip total={total} mine={mine} unread={unread} />
        <Card tone="quiet">
          <div className="space-y-3">
            <Notice tone={unread ? "idle" : total === 0 ? "danger" : total < 10 ? "warn" : "ok"}>{verdict}</Notice>
            <Facts
              items={[
                ["in the tree", unread ? "not read" : String(total)],
                ["yours", unread ? "not read" : String(mine.length)],
                ["pool holds", crowd ? `${formatAmount(crowd.held, n.native.decimals)} ${n.native.symbol}` : "-"],
                ["taken out", crowd ? String(crowd.withdrawals) : "-"],
                ["last deposit", ago(crowd?.lastAt ?? null)],
                ["read at block", crowd ? `#${crowd.head.toLocaleString("en-GB")}` : "-"],
              ]}
            />
            <Status tone={unread ? "idle" : "warn"}>
              {unread ? "not read" : "read from a public server, not checked on this computer"}
            </Status>
          </div>
        </Card>
      </div>
    </Section>
  );
}

// ── the three stages ────────────────────────────────────────────────────────

/** Pay in, wait, take out somewhere new: the shape of the whole plugin. */
function Journey({ at }: { at: 0 | 1 | 2 }) {
  const steps = [
    { icon: ArrowDownToLine, title: "Pay in", line: "Public: your account, the amount" },
    { icon: Clock, title: "Wait", line: "The longer the better" },
    { icon: ArrowUpFromLine, title: "Take out", line: "To an account that is new" },
  ];
  return (
    <ol className="grid gap-2 sm:grid-cols-3">
      {steps.map((s, i) => {
        const here = i === at;
        return (
          <li
            key={s.title}
            className="rounded-[var(--radius)] border px-4 py-3"
            style={{
              borderColor: here ? INK : "var(--line)",
              background: here ? wash(7) : "var(--card)",
            }}
          >
            <div className="flex items-center gap-2">
              <s.icon className="h-4 w-4" style={{ color: here ? INK : "var(--muted)" }} />
              <span className="font-tight text-sm font-medium">{s.title}</span>
            </div>
            <p className="mt-1 text-xs leading-relaxed text-[var(--muted)]">{s.line}</p>
          </li>
        );
      })}
    </ol>
  );
}

function Progress({ s, n }: { s: Step; n: ShieldNetwork }) {
  if (s.stage === "fetching") return <Waiting>Fetching what the proof needs, once ({s.got} of {s.of} done)</Waiting>;
  if (s.stage === "building") return <Waiting>Rebuilding the pool's tree from the chain</Waiting>;
  if (s.stage === "proving") return <Waiting>Making the proof on this computer</Waiting>;
  if (s.stage === "signing") return <Waiting>Signing on this computer</Waiting>;
  if (s.stage === "sent") return <Waiting>Sent, waiting for a block</Waiting>;
  if (s.stage === "failed") return <Notice tone="danger">{s.reason}</Notice>;
  return (
    <span className="flex flex-wrap items-center gap-3">
      <Notice tone="ok">Done, in block #{s.block.toLocaleString("en-GB")}.</Notice>
      <Button variant="quiet" icon={ExternalLink} onClick={() => openInBrowser(n.explorer(s.tx))}>
        See it on the chain
      </Button>
    </span>
  );
}

// ── paying in ───────────────────────────────────────────────────────────────

/**
 * The amount is the leak nobody expects. The proof hides which deposit was
 * yours, but a withdrawal says out loud how much it is worth, so an amount
 * nobody else paid in picks you out of any crowd. Hence three standard amounts
 * first, a custom one behind a fold, and a count of who else paid the same.
 */
function PayIn({
  n,
  crowd,
  words,
  balance,
  onPaid,
}: {
  n: ShieldNetwork;
  crowd: Crowd | null;
  words: string;
  balance: bigint | null;
  onPaid: (note: Held) => void;
}) {
  const [text, setText] = useState(n.steps[0]);
  const [custom, setCustom] = useState(false);
  const [sure, setSure] = useState(false);
  const [step, setStep] = useState<Step | null>(null);
  useEffect(() => setText(n.steps[0]), [n]);

  const amount = useMemo(() => parseAmount(text, n.native.decimals), [text, n.native.decimals]);
  const busy = step != null && step.stage !== "final" && step.stage !== "failed";
  const { sameAmount } = hidingAmong(crowd, amount);
  const standard = n.steps.includes(text.trim());
  const short = amount != null && balance != null && amount >= balance;
  const alone = sameAmount === 0 && !standard;
  const ready = amount != null && !short && canShield(n.id) && (!alone || sure);

  const pay = async () => {
    if (!amount) return;
    const index = nextIndex(n.id);
    const r = await shield(n, words, amount, index, setStep);
    if (!r) return;
    const note: Held = {
      net: n.id,
      index,
      amount: amount.toString(),
      asset: "0",
      commitment: r.note.commitment,
      at: new Date().toISOString(),
      state: "shielded",
      tx: r.tx,
    };
    rememberNote(note);
    onPaid(note);
  };

  const label = !canShield(n.id)
    ? `Paying real ${n.native.symbol} in is not on yet: use test money`
    : !amount
      ? "Pick an amount"
      : short
        ? `Not enough ${n.native.symbol} for that and the fee`
        : alone && !sure
          ? "Tick the box above to pay in"
          : `Pay in ${text.trim()} ${n.native.symbol}`;

  return (
    <Section label="Pay in" icon={ArrowDownToLine} lede="One transaction. It says your account paid this much in, and nothing about who can take it out.">
      <Card>
        <div className="space-y-3">
          <div className="grid gap-2 sm:grid-cols-3">
            {n.steps.map((s) => {
              const on = !custom && text.trim() === s;
              return (
                <button
                  key={s}
                  disabled={busy}
                  onClick={() => {
                    setCustom(false);
                    setText(s);
                  }}
                  className="rounded-[calc(var(--radius)+4px)] border px-4 py-3 text-left transition disabled:opacity-45"
                  style={{ borderColor: on ? INK : "var(--line)", background: on ? wash(8) : "var(--card)" }}
                >
                  <div className="text-xl tabular-nums">{s}</div>
                  <div className="text-xs text-[var(--muted)]">{n.native.symbol}</div>
                </button>
              );
            })}
          </div>

          <button
            className="text-[13px] text-[var(--muted)] underline-offset-4 hover:text-[var(--fg)] hover:underline"
            onClick={() => setCustom(!custom)}
            aria-expanded={custom}
          >
            {custom ? "Use a standard amount" : "Another amount"}
          </button>

          {custom && (
            <>
              <Field
                label="Amount"
                hint={`In ${n.native.symbol}. An amount other people have also paid in hides you better than a tidy-looking one.`}
              >
                <input
                  className={inputClass + " tabular-nums"}
                  inputMode="decimal"
                  placeholder="0"
                  value={text}
                  disabled={busy}
                  onChange={(e) => setText(e.target.value.replace(",", "."))}
                />
              </Field>
              {alone && (
                <>
                  <Notice tone="danger">
                    Nobody else in this pool has paid in {text.trim()} {n.native.symbol}. A withdrawal of that amount can
                    only be yours, whatever the proof hides. A standard amount is the whole point of the standard amounts.
                  </Notice>
                  <label className="flex items-center gap-2 text-[13px]">
                    <input type="checkbox" checked={sure} onChange={(e) => setSure(e.target.checked)} />
                    I understand, pay it in anyway
                  </label>
                </>
              )}
            </>
          )}

          {sameAmount != null && sameAmount > 0 && (
            <Notice tone={sameAmount < 3 ? "warn" : "ok"}>
              {sameAmount} other deposit{sameAmount === 1 ? "" : "s"} in this pool {sameAmount === 1 ? "is" : "are"} for the
              same amount.
            </Notice>
          )}

          <button
            className="w-full rounded-[calc(var(--radius)+4px)] border px-4 py-3.5 text-[15px] font-medium transition disabled:cursor-default"
            style={
              ready && !busy
                ? { borderColor: INK, background: wash(14), color: "var(--fg)" }
                : { borderColor: "var(--line)", background: "var(--card)", color: "var(--muted)" }
            }
            disabled={!ready || busy}
            onClick={pay}
          >
            {busy ? "Paying in" : label}
          </button>
          {step && <Progress s={step} n={n} />}
        </div>
      </Card>
    </Section>
  );
}

// ── what the member holds in the pool ───────────────────────────────────────

function Notes({
  n,
  mine,
  crowd,
  words,
  onSpent,
  onRecover,
  recovering,
}: {
  n: ShieldNetwork;
  mine: Held[];
  crowd: Crowd | null;
  words: string;
  onSpent: () => void;
  onRecover: () => void;
  recovering: boolean;
}) {
  const inPool = mine.filter((m) => m.state === "shielded");
  const [taking, setTaking] = useState<string | null>(null);
  return (
    <Section
      label="What you hold in the pool"
      icon={EyeOff}
      lede="Each of these is one deposit nobody can connect to you until you take it out. They are worked out from your twelve words, so this app never writes down a secret and any computer with those words can find them again."
      aside={
        <Button variant="quiet" icon={Search} busy={recovering} onClick={onRecover}>
          Look for mine
        </Button>
      }
    >
      {inPool.length === 0 ? (
        <Empty>
          Nothing in the {n.label} pool yet.{mine.length ? " Everything you had here has been taken out." : ""}
        </Empty>
      ) : (
        <div className="space-y-3">
          <List>
            {inPool.map((m) => {
              const settled = crowd?.leaves.some((l) => l.commitment === m.commitment) ?? false;
              const age = Math.round((Date.now() - new Date(m.at).getTime()) / 3_600_000);
              return (
                <Row
                  key={m.commitment}
                  title={
                    <span className="flex items-center gap-2.5">
                      <span aria-hidden className="h-3 w-3 rounded-[3px]" style={{ background: INK }} />
                      <span className="tabular-nums">{formatAmount(BigInt(m.amount), n.native.decimals)}</span>
                      <span className="text-[var(--muted)]">{n.native.symbol}</span>
                    </span>
                  }
                  detail={
                    settled
                      ? age < 1
                        ? "In the pool, paid in within the hour. Taking it out this soon ties the two halves together by their timing alone."
                        : `In the pool, ${age < 48 ? `${age} h` : `${Math.round(age / 24)} days`} old.`
                      : "Waiting for the chain to settle it into the pool's tree."
                  }
                  status={<Status tone={settled ? (age < 1 ? "warn" : "ok") : "idle"} pulse={!settled}>{settled ? "in the pool" : "settling"}</Status>}
                  action={
                    <Button
                      icon={ArrowUpFromLine}
                      disabled={!settled}
                      onClick={() => setTaking(taking === m.commitment ? null : m.commitment)}
                    >
                      {taking === m.commitment ? "Close" : "Take out"}
                    </Button>
                  }
                />
              );
            })}
          </List>
          {taking && (
            <TakeOut
              n={n}
              words={words}
              note={inPool.find((m) => m.commitment === taking)!}
              onDone={() => {
                setTaking(null);
                onSpent();
              }}
            />
          )}
        </div>
      )}
    </Section>
  );
}

// ── taking out ──────────────────────────────────────────────────────────────

function TakeOut({ n, words, note, onDone }: { n: ShieldNetwork; words: string; note: Held; onDone: () => void }) {
  const held = BigInt(note.amount);
  const [text, setText] = useState(formatAmount(held, n.native.decimals, n.native.decimals).replace(/,/g, ""));
  const [to, setTo] = useState("");
  const [fresh, setFresh] = useState<string | null>(null);
  const [payer, setPayer] = useState<string | null>(null);
  const [sure, setSure] = useState(false);
  const [step, setStep] = useState<Step | null>(null);

  useEffect(() => {
    let live = true;
    Promise.all([collectAddress(words, note.index), account(words, 0)]).then(([a, p]) => {
      if (!live) return;
      setFresh(a);
      setPayer(p.address);
      setTo((t) => t || a);
    });
    return () => {
      live = false;
    };
  }, [words, note.index]);

  const take = useMemo(() => parseAmount(text, n.native.decimals), [text, n.native.decimals]);
  const busy = step != null && step.stage !== "final" && step.stage !== "failed";
  const tooMuch = take != null && take > held;
  // Paying out to the account that paid in writes both halves against one name,
  // which is the one mistake that undoes everything the pool did.
  const backToPayer = payer != null && to.trim().toLowerCase() === payer.toLowerCase();
  const ready = take != null && !tooMuch && /^0x[0-9a-fA-F]{40}$/.test(to.trim()) && sure && canShield(n.id);

  const go = async () => {
    if (!take) return;
    const full = await deriveNote(words, note.index, held, BigInt(note.asset));
    const r = await unshield(n, words, full, take, to.trim(), setStep);
    if (!r) return;
    markSpent(n.id, note.commitment);
    if (r.change) {
      rememberNote({
        net: n.id,
        index: r.change.index,
        amount: r.change.amount.toString(),
        asset: note.asset,
        commitment: r.change.commitment,
        at: new Date().toISOString(),
        state: "shielded",
        tx: r.tx,
      });
    }
    setTimeout(onDone, 2500);
  };

  return (
    <Card tone="quiet">
      <div className="space-y-4">
        <Field label="How much to take out" hint={`Up to ${formatAmount(held, n.native.decimals)} ${n.native.symbol}. What is left stays in the pool as a new deposit only you can find.`}>
          <input
            className={inputClass + " tabular-nums"}
            inputMode="decimal"
            value={text}
            disabled={busy}
            onChange={(e) => setText(e.target.value.replace(",", "."))}
          />
        </Field>

        <Field
          label="Where it should land"
          hint="A new account from your own twelve words, so the money does not come back to the account that paid it in. Any address works, but your own old one undoes the whole exercise."
        >
          <input className={inputClass + " font-mono text-xs"} value={to} disabled={busy} onChange={(e) => setTo(e.target.value)} />
        </Field>
        {fresh && to.trim().toLowerCase() !== fresh.toLowerCase() && (
          <Button variant="quiet" onClick={() => setTo(fresh)}>
            Use the new account this app made for you
          </Button>
        )}
        {backToPayer && (
          <Notice tone="danger">
            That is the account that paid in. Sending it back there puts both halves under one name and the pool may as well
            not have been used.
          </Notice>
        )}

        <Notice tone="warn">
          Whoever sends this transaction pays its fee and is written on the chain, and without a relayer that is the account
          that paid in. The pool hides which deposit is yours; it does not hide that you asked. Until that is fixed this is
          a rehearsal, not a private payment.
        </Notice>

        <label className="flex items-start gap-2 text-[13px]">
          <input className="mt-1" type="checkbox" checked={sure} onChange={(e) => setSure(e.target.checked)} />
          I have read what this does and does not hide
        </label>

        <button
          className="w-full rounded-[calc(var(--radius)+4px)] border px-4 py-3.5 text-[15px] font-medium transition disabled:cursor-default"
          style={
            ready && !busy
              ? { borderColor: INK, background: wash(14), color: "var(--fg)" }
              : { borderColor: "var(--line)", background: "var(--card)", color: "var(--muted)" }
          }
          disabled={!ready || busy}
          onClick={go}
        >
          {busy
            ? "Working"
            : !canShield(n.id)
              ? "Not on for real money"
              : tooMuch
                ? "That is more than this deposit holds"
                : !sure
                  ? "Tick the box above"
                  : backToPayer
                    ? "Take it out, back to the account that paid in"
                    : "Make the proof and take it out"}
        </button>
        {!step && (
          <p className="text-xs text-[var(--faint)]">
            The first proof fetches 36 MB once and keeps it. Making a proof takes a few seconds and happens here, on this
            computer: nothing secret is sent anywhere.
          </p>
        )}
        {step && <Progress s={step} n={n} />}
      </div>
    </Card>
  );
}

// ── what it will not promise ────────────────────────────────────────────────

/**
 * Every lab plugin says it is early. This one says what is actually wrong,
 * because a privacy tool that oversells itself is worse than none: someone
 * acts on the promise. All four lines are checked against the pool's own code
 * and governance, and the runbook (lab/shield/AGENTS.md) carries the reading.
 */
function Honest({ n, crowd }: { n: ShieldNetwork; crowd: Crowd | null }) {
  const [open, setOpen] = useState(false);
  const lines: [string, string][] = [
    ["Not audited yet", "The audit was voted through on Kusama as referendum 667 and has not happened. Nobody independent has checked the maths or the contract."],
    [
      "The recipient is not covered by the proof",
      "The contract takes the address to pay out as an ordinary argument and never checks it against the proof. Anyone who sees a withdrawal before it is in a block can copy the proof, put their own address in and take the money. We found this reading the contract and it is written up for Shield's own team. Until it is answered, no real money goes near it.",
    ],
    [
      "The crowd is small",
      crowd
        ? `This one holds ${formatAmount(crowd.held, n.native.decimals)} ${n.native.symbol} and has ${crowdSize(crowd)} entries in its tree. Privacy is other people, and there are not many of them yet.`
        : "Privacy is other people, and these pools have tens of them, not thousands.",
    ],
    [
      "Nobody can be hidden from the fee",
      "Without a relayer the account that pays in is the account that asks to take out. That link is visible to anyone reading the chain. Shield's own relayer is run by its team, and on Kusama its website hands the relayer the note's secret, so whoever runs it can see which deposit was yours.",
    ],
    [
      "Real money is off in code",
      "Only test money can move. Turning that on is rich's call, and it waits on the audit, the answer above, and a UK read of what a privacy screen means for us.",
    ],
  ];
  return (
    <Section label="What this cannot promise yet" icon={CircleAlert}>
      <div className="rounded-[var(--radius)] border border-[var(--line)]">
        <button className="flex w-full items-center gap-2 px-5 py-4 text-left" onClick={() => setOpen(!open)} aria-expanded={open}>
          <span className="font-tight text-sm font-medium">Five things, in plain words</span>
          <span className="ml-auto text-[13px] text-[var(--muted)]">{open ? "Hide" : "Read them"}</span>
          <ChevronDown className={"h-4 w-4 text-[var(--muted)] transition-transform " + (open ? "rotate-180" : "")} />
        </button>
        {open && (
          <dl className="space-y-4 border-t border-[var(--line)] px-5 py-4">
            {lines.map(([k, v]) => (
              <div key={k}>
                <dt className="font-tight flex items-center gap-2 text-sm font-medium">
                  <span aria-hidden className="h-1.5 w-1.5 rounded-full bg-[var(--warn)]" />
                  {k}
                </dt>
                <dd className="mt-1 text-[13px] leading-relaxed text-[var(--muted)]">{v}</dd>
              </div>
            ))}
            <p className="pt-1 text-xs leading-relaxed text-[var(--faint)]">
              The pool is Kusama Shield's work, not ours: shield.markets, MIT licensed, open at codeberg.org/KusamaShield.
              What this app adds is the screen, the twelve-word notes and the counting.
            </p>
          </dl>
        )}
      </div>
    </Section>
  );
}

// ── the account ─────────────────────────────────────────────────────────────

function MakeAccount({ onDone }: { onDone: (address: string) => void }) {
  const [mode, setMode] = useState<"start" | "new" | "restore">("start");
  const [words, setWords] = useState("");
  const [wrote, setWrote] = useState(false);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [swapWords, setSwapWords] = useState<string | null>(null);

  useEffect(() => {
    keySecret.get(SWAP_WORDS).then(setSwapWords).catch(() => {});
  }, []);

  const save = async (w: string) => {
    setBusy(true);
    setProblem(null);
    try {
      const clean = w.trim().replace(/\s+/g, " ");
      if (!(await validWords(clean))) throw new Error("Those words don't make a valid key.");
      const a = await account(clean, 0);
      await keySecret.set(WORDS, clean);
      onDone(a.address);
    } catch (e) {
      setProblem(String((e as Error)?.message ?? e));
    } finally {
      setBusy(false);
    }
  };

  if (mode === "new")
    return (
      <Gate
        icon={KeyRound}
        title="Write these twelve words down"
        action={
          <>
            <Button variant="primary" disabled={!wrote} busy={busy} onClick={() => save(words)}>
              Done
            </Button>
            <Button variant="quiet" onClick={() => setMode("start")}>
              Back
            </Button>
          </>
        }
      >
        <ol className="font-mono grid grid-cols-3 gap-x-6 gap-y-1.5 rounded-[var(--radius)] border border-[var(--line-strong)] px-4 py-3 text-sm text-[var(--fg)]">
          {words.split(" ").map((w, i) => (
            <li key={i}>
              <span className="text-[var(--faint)]">{i + 1}.</span> {w}
            </li>
          ))}
        </ol>
        <Notice tone="warn">
          On paper, not in a note or a photo. These words are the account and every deposit it hides in the pool. Nobody can
          reset them for you, and without them a deposit stays in the pool for good.
        </Notice>
        <label className="flex items-center gap-2 text-[13px] text-[var(--fg)]">
          <input type="checkbox" checked={wrote} onChange={(e) => setWrote(e.target.checked)} />
          I have written them down
        </label>
        {problem && <Notice tone="danger">{problem}</Notice>}
      </Gate>
    );

  if (mode === "restore")
    return (
      <Gate
        icon={KeyRound}
        title="Use words you already have"
        action={
          <>
            <Button variant="primary" busy={busy} onClick={() => save(words)}>
              Use these words
            </Button>
            <Button variant="quiet" onClick={() => setMode("start")}>
              Back
            </Button>
          </>
        }
      >
        <Field label="Your words" hint="Twelve or twenty-four words, with spaces between them.">
          <textarea className={inputClass + " font-mono"} rows={3} value={words} onChange={(e) => setWords(e.target.value)} />
        </Field>
        {problem && <Notice tone="danger">{problem}</Notice>}
      </Gate>
    );

  return (
    <Gate
      icon={Wallet}
      title="Make the account that pays in"
      action={
        <>
          <Button
            variant="primary"
            busy={busy}
            onClick={async () => {
              setWords(await newWords());
              setWrote(false);
              setMode("new");
            }}
          >
            Make an account
          </Button>
          {swapWords && (
            <Button busy={busy} onClick={() => save(swapWords)}>
              Use the same words as Swap
            </Button>
          )}
          <Button
            onClick={() => {
              setWords("");
              setMode("restore");
            }}
          >
            I have words already
          </Button>
        </>
      }
    >
      <p>
        The pool is paid into by a key on this computer, made from twelve words you write down. It is yours: nobody else,
        including whoever runs this app, can move what it holds or work out which deposit in the pool is yours.
      </p>
      <p>
        Those same words make every deposit's secret and every account a withdrawal lands in, so twelve words on paper are
        the whole backup, on any computer.
      </p>
      {swapWords && <p>Swap already keeps twelve words on this computer. Using the same ones means one set to write down, and gives a different account on a different chain with no link between them.</p>}
    </Gate>
  );
}

function AccountSection({
  n,
  address,
  balance,
  onRefresh,
  onForget,
}: {
  n: ShieldNetwork;
  address: string;
  balance: bigint | null;
  onRefresh: () => void;
  onForget: () => void;
}) {
  const [copied, setCopied] = useState(false);
  const [words, setWords] = useState<string | null>(null);
  const [asking, setAsking] = useState<"show" | "forget" | null>(null);
  const [wrote, setWrote] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  useEffect(() => {
    if (!words) return;
    const t = setTimeout(() => setWords(null), 60_000);
    return () => clearTimeout(t);
  }, [words]);

  return (
    <Section
      label="The account that pays in"
      icon={Wallet}
      lede={
        n.id === "paseo"
          ? "Test money, with no value. Send PAS on Asset Hub's PolkaVM to this address to pay into the pool with it."
          : `Send ${n.native.symbol} to this address on Asset Hub to pay into the pool with it.`
      }
      aside={
        <Button variant="quiet" icon={RefreshCw} onClick={onRefresh}>
          Refresh
        </Button>
      }
    >
      <List>
        <Row
          title={
            <span className="tabular-nums">
              {balance != null ? formatAmount(balance, n.native.decimals) : "-"} {n.native.symbol}
            </span>
          }
          detail="What this account holds in the open, before anything is paid in."
        />
        <Row
          title="Address"
          detail={<span className="font-mono break-all text-xs">{address}</span>}
          action={
            <Button
              icon={Copy}
              onClick={() => {
                navigator.clipboard?.writeText(address);
                setCopied(true);
                setTimeout(() => setCopied(false), 1500);
              }}
            >
              {copied ? "Copied" : "Copy"}
            </Button>
          }
        />
        <Row
          title="Your words"
          detail="The twelve words behind this account and every deposit it hides."
          action={
            words ? (
              <Button onClick={() => setWords(null)}>Hide</Button>
            ) : (
              <Button icon={Eye} onClick={() => setAsking("show")}>
                Show
              </Button>
            )
          }
        />
        <Row
          title="Remove from this computer"
          detail="Takes the key off this computer. Your deposits stay in the pool, for your words to find again."
          action={
            <Button
              icon={Trash2}
              onClick={() => {
                setWrote(false);
                setAsking("forget");
              }}
            >
              Remove
            </Button>
          }
        />
      </List>

      {asking === "show" && (
        <Card tone="quiet">
          <div className="mt-3 space-y-3">
            <Notice tone="warn">
              Anyone who sees these words can take every deposit out of the pool. Check nobody is looking, and that you are
              not sharing your screen.
            </Notice>
            <div className="flex gap-2">
              <Button
                variant="primary"
                onClick={async () => {
                  setProblem(null);
                  const w = await keySecret.get(WORDS);
                  if (!w) return setProblem("This computer no longer holds the words.");
                  setWords(w);
                  setAsking(null);
                }}
              >
                Show them
              </Button>
              <Button variant="quiet" onClick={() => setAsking(null)}>
                Cancel
              </Button>
            </div>
          </div>
        </Card>
      )}

      {words && (
        <ol className="font-mono mt-3 grid grid-cols-3 gap-x-6 gap-y-1.5 rounded-[var(--radius)] border border-[var(--line-strong)] px-4 py-3 text-sm text-[var(--fg)]">
          {words.split(" ").map((w, i) => (
            <li key={i}>
              <span className="text-[var(--faint)]">{i + 1}.</span> {w}
            </li>
          ))}
        </ol>
      )}

      {asking === "forget" && (
        <Card tone="quiet">
          <div className="mt-3 space-y-3">
            <Notice tone="danger">
              Without your words this cannot be undone, and a deposit nobody can prove is nobody's. Show the words first if
              you are not sure you have them.
            </Notice>
            <label className="flex items-center gap-2 text-[13px]">
              <input type="checkbox" checked={wrote} onChange={(e) => setWrote(e.target.checked)} />
              I have my words written down
            </label>
            <div className="flex gap-2">
              <Button
                variant="primary"
                disabled={!wrote}
                onClick={async () => {
                  setProblem(null);
                  try {
                    await keySecret.delete(WORDS);
                    onForget();
                  } catch (e) {
                    setProblem(String((e as Error)?.message ?? e));
                  }
                }}
              >
                Remove the key
              </Button>
              <Button variant="quiet" onClick={() => setAsking(null)}>
                Cancel
              </Button>
            </div>
          </div>
        </Card>
      )}

      {problem && <Notice tone="danger">{problem}</Notice>}
    </Section>
  );
}

// ── the screen ──────────────────────────────────────────────────────────────

function Panel(_: PluginContext) {
  const [net, setNet] = useState<ShieldNet>(() => (localStorage.getItem(NET_KEY) as ShieldNet) || "paseo");
  const n = SHIELD_NETWORKS[net];
  const [words, setWords] = useState<string | null>(null);
  const [address, setAddress] = useState<string | null>(() => localStorage.getItem(ACCOUNT_KEY));
  const [crowd, setCrowd] = useState<Crowd | null>(null);
  const [balance, setBalance] = useState<bigint | null>(null);
  const [mine, setMine] = useState<Held[]>(() => heldNotes(net));
  const [reading, setReading] = useState(false);
  const [recovering, setRecovering] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  useEffect(() => {
    keySecret
      .get(WORDS)
      .then(async (w) => {
        if (!w) return;
        setWords(w);
        const a = await account(w, 0);
        setAddress(a.address);
        localStorage.setItem(ACCOUNT_KEY, a.address);
      })
      .catch(() => {});
  }, []);

  const read = useCallback(() => {
    setReading(true);
    setProblem(null);
    setCrowd(null);
    setBalance(null);
    connect(n)
      .then(async (p) => {
        const [c, b] = await Promise.all([readCrowd(n, p), address ? p.getBalance(address) : Promise.resolve(null)]);
        setCrowd(c);
        setBalance(b);
      })
      .catch((e) => setProblem(String((e as Error)?.message ?? e)))
      .finally(() => setReading(false));
  }, [n, address]);
  useEffect(read, [read]);

  useEffect(() => setMine(heldNotes(net)), [net]);

  const pick = (v: ShieldNet) => {
    localStorage.setItem(NET_KEY, v);
    setNet(v);
  };

  // Where the member's own deposits sit in the crowd, so the strip can mark them.
  const minePlaces = useMemo(() => {
    if (!crowd) return [];
    const own = new Set(mine.map((m) => m.commitment));
    return crowd.leaves.map((l, i) => (own.has(l.commitment) ? i : -1)).filter((i) => i >= 0);
  }, [crowd, mine]);

  const inPool = mine.filter((m) => m.state === "shielded").length;

  const lookForMine = async () => {
    if (!words || !crowd) return;
    setRecovering(true);
    try {
      const { found, unreadable } = await recover(n, words, crowd);
      setMine(heldNotes(net));
      setProblem(
        found.length
          ? null
          : `No deposit in this pool was made with your words${unreadable ? `. ${unreadable} of them could not be read back from the server, so they could not be checked` : ""}.`,
      );
    } catch (e) {
      setProblem(String((e as Error)?.message ?? e));
    } finally {
      setRecovering(false);
    }
  };

  return (
    <Page>
      <PageHeader
        icon={EyeOff}
        eyebrow="shield"
        title="Shield"
        lede="Pay into a shielded pool, wait, then take it out somewhere new. How well it hides you depends on how many other people are in there, so that is the first thing here."
        actions={
          <div className="flex items-center gap-1">
            {(["paseo", "kusama", "polkadot"] as ShieldNet[]).map((v) => (
              <Button key={v} variant={v === net ? "primary" : "secondary"} onClick={() => pick(v)}>
                {v === "paseo" ? "Test money" : SHIELD_NETWORKS[v].native.symbol}
              </Button>
            ))}
          </div>
        }
      />
      <PageBody>
        {problem && <Notice tone="danger">{problem}</Notice>}
        {!canShield(net) && (
          <Notice tone="warn">
            This pool holds real money, so this screen only reads it. Nothing here can pay in or take out until that is
            turned on.
          </Notice>
        )}

        <Journey at={inPool ? 1 : 0} />

        <CrowdSection n={n} crowd={crowd} mine={minePlaces} onRefresh={read} busy={reading} />

        {!persistent ? (
          <Gate icon={EyeOff} title="Paying in needs the desktop app">
            <p>
              The key behind your deposits belongs in this computer's own secure store, which a browser tab has no way to
              reach. The crowd above reads anywhere.
            </p>
          </Gate>
        ) : !words || !address ? (
          <MakeAccount
            onDone={(a) => {
              setAddress(a);
              localStorage.setItem(ACCOUNT_KEY, a);
              keySecret.get(WORDS).then(setWords);
            }}
          />
        ) : (
          <>
            {canShield(net) && (
              <PayIn
                n={n}
                crowd={crowd}
                words={words}
                balance={balance}
                onPaid={() => {
                  setMine(heldNotes(net));
                  read();
                }}
              />
            )}
            <Notes
              n={n}
              mine={mine}
              crowd={crowd}
              words={words}
              recovering={recovering}
              onRecover={lookForMine}
              onSpent={() => {
                setMine(heldNotes(net));
                read();
              }}
            />
            <AccountSection
              n={n}
              address={address}
              balance={balance}
              onRefresh={read}
              onForget={() => {
                localStorage.removeItem(ACCOUNT_KEY);
                setAddress(null);
                setWords(null);
              }}
            />
          </>
        )}

        <Honest n={n} crowd={crowd} />
      </PageBody>
    </Page>
  );
}

export const shieldPlugin: MurmurModule = {
  id: "shield",
  title: "Shield",
  tagline: "Pay into a shielded pool and take it out somewhere new, with the size of the crowd in plain sight. Test money only",
  icon: EyeOff,
  order: 27,
  kind: "plugin",
  lab: true,
  support: issues("shield"),
  backend: "Kusama Shield's pool on Asset Hub",
  Panel,
};
