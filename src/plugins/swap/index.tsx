import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { ArrowDown, ChevronDown, Copy, ExternalLink, Eye, History, KeyRound, Repeat, RefreshCw, Send, Trash2, Wallet } from "lucide-react";
import type { PolkadotClient } from "polkadot-api";
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
import { checked, hasHub, hubClient, type Net } from "../../lib/hub";
import { keySecret } from "../../lib/secrets";
import { openInBrowser } from "../../identity/passkey";
import {
  NETWORKS,
  addressFor,
  balances as readBalances,
  canSwap,
  formatAmount,
  history as readHistory,
  keyFromWords,
  networkFee,
  newWords,
  normaliseWords,
  other,
  parseAmount,
  quote as readQuote,
  readAddress,
  recipient,
  remember,
  sendFee,
  submitSend,
  submitSwap,
  token,
  validWords,
  withAsset,
  assetById,
  type Balances,
  type Network,
  type Progress,
  type Quote,
  type Side,
} from "../../lib/swap";

/**
 * Swap: KSM and dUSD in one step, against the pool on the chain.
 *
 * The lighter sibling of Exchange. Exchange is the members' market: a price
 * members set, wallet to wallet. Swap trades against Asset Hub's own pool, so
 * it is quick and always there, and the price is whatever the pool holds. Every
 * quote says how far the trade moves that price, because the pool is small.
 *
 * The account is a key on this computer, made from twelve words the member
 * writes down. The words sit in the system's secure store and are read only at
 * the moment of signing. Real KSM is quoted but not swapped yet (REAL_MONEY).
 */

const NET_KEY = "murmur.swap.net.v1";
/** test money, from lab/swap/drip.ts behind the Birdbrain edge */
const DRIP = "https://birdbrain.wtf/api/murmur/drip";
const ACCOUNT_KEY = "murmur.swap.account.v1";
const WORDS = "swap.words";
/** past this, the member confirms they mean it */
const BIG_MOVE = 0.1;

const hex = (b: Uint8Array) => Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");
const unhex = (s: string) => new Uint8Array(s.match(/../g)!.map((x) => parseInt(x, 16)));
const pct = (x: number) => `${(x * 100).toFixed(x < 0.01 ? 2 : 1)}%`;

function useClient(net: Net) {
  const [client, setClient] = useState<PolkadotClient | null>(null);
  const [block, setBlock] = useState<number | null>(null);
  useEffect(() => {
    let live = true;
    let sub: { unsubscribe(): void } | null = null;
    setClient(null);
    setBlock(null);
    hubClient(net).then((c) => {
      if (!live) return;
      setClient(c);
      sub = c.finalizedBlock$.subscribe((b) => live && setBlock(b.number));
    });
    return () => {
      live = false;
      sub?.unsubscribe();
    };
  }, [net]);
  return { client, block };
}

function Panel(_: PluginContext) {
  const [net, setNet] = useState<Net>(() => (localStorage.getItem(NET_KEY) as Net) || "paseo");
  const [account, setAccount] = useState<Uint8Array | null>(() => {
    const v = localStorage.getItem(ACCOUNT_KEY);
    return v ? unhex(v) : null;
  });
  const n = NETWORKS[net];
  const { client, block } = useClient(net);
  const [bal, setBal] = useState<Balances | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const address = account ? addressFor(account, n) : null;

  const pick = (v: Net) => {
    localStorage.setItem(NET_KEY, v);
    setBal(null);
    setNet(v);
  };

  const refresh = useCallback(() => {
    if (!client || !address) return;
    readBalances(client, n, address)
      .then((b) => {
        setBal(b);
        setProblem(null);
      })
      .catch((e) => setProblem(String(e?.message ?? e)));
  }, [client, address, n]);
  useEffect(refresh, [refresh, block]);

  const header = (
    <PageHeader
      icon={Repeat}
      eyebrow="swap"
      title="Swap"
      lede="Trade KSM and dUSD in one step. Pick what you pay, see what you get, then swap."
      actions={
        hasHub ? (
          <div className="flex items-center gap-1">
            {(["paseo", "kusama"] as Net[]).map((v) => (
              <Button key={v} variant={v === net ? "primary" : "secondary"} onClick={() => pick(v)}>
                {v === "kusama" ? "Real KSM" : "Test money"}
              </Button>
            ))}
          </div>
        ) : undefined
      }
    />
  );

  if (!hasHub) {
    return (
      <Page>
        {header}
        <PageBody>
          <Gate icon={Repeat} title="Swap runs in the desktop app">
            <p>It reads the chain and keeps your account's key on your own computer, which a browser tab can't do.</p>
          </Gate>
        </PageBody>
      </Page>
    );
  }

  return (
    <Page>
      {header}
      <PageBody>
        {problem && <Notice tone="danger">{problem}</Notice>}
        {!account ? (
          <MakeAccount
            onDone={(pk) => {
              localStorage.setItem(ACCOUNT_KEY, hex(pk));
              setAccount(pk);
            }}
          />
        ) : (
          <>
            {client && bal ? (
              <SwapCard client={client} n={n} address={address!} bal={bal} block={block} onSwapped={refresh} />
            ) : (
              <Waiting>{block == null ? "Catching up with the chain" : "Reading your account"}</Waiting>
            )}
            {client && bal && <SendSection client={client} n={n} address={address!} bal={bal} onSent={refresh} />}
            <AccountSection
              n={n}
              address={address!}
              bal={bal}
              onRefresh={refresh}
              onForget={() => {
                localStorage.removeItem(ACCOUNT_KEY);
                setBal(null);
                setAccount(null);
              }}
            />
            <HistorySection n={n} />
          </>
        )}
        <Section label="This computer" icon={KeyRound}>
          <Card tone="quiet">
            <div className="mb-3">
              {checked ? (
                <Status tone={block ? "ok" : "warn"} pulse={!block}>
                  {block ? "checked on this computer" : "catching up"}
                </Status>
              ) : (
                <Status tone="warn">read from a public server (preview only)</Status>
              )}
            </div>
            <Facts
              items={[
                ["network", n.id === "paseo" ? "Paseo test network" : "KSM"],
                ["final block", block != null ? `#${block.toLocaleString("en-GB")}` : "-"],
              ]}
            />
          </Card>
        </Section>
      </PageBody>
    </Page>
  );
}

// ── making or restoring the account ─────────────────────────────────────────

function MakeAccount({ onDone }: { onDone: (publicKey: Uint8Array) => void }) {
  const [mode, setMode] = useState<"start" | "new" | "restore">("start");
  const [words, setWords] = useState("");
  const [wrote, setWrote] = useState(false);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  const save = async (w: string) => {
    setBusy(true);
    setProblem(null);
    try {
      const clean = normaliseWords(w);
      const key = keyFromWords(clean);
      await keySecret.set(WORDS, clean);
      onDone(key.publicKey);
    } catch (e) {
      setProblem(String((e as Error)?.message ?? e));
    } finally {
      setBusy(false);
    }
  };

  if (mode === "new") {
    const list = words.split(" ");
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
          {list.map((w, i) => (
            <li key={i}>
              <span className="text-[var(--faint)]">{i + 1}.</span> {w}
            </li>
          ))}
        </ol>
        <Notice tone="warn">
          On paper, not in a note or a photo. Anyone with these words can spend what the account holds. If this computer is
          lost, they are the only way back in, and nobody can reset them for you.
        </Notice>
        <label className="flex items-center gap-2 text-[13px] text-[var(--fg)]">
          <input type="checkbox" checked={wrote} onChange={(e) => setWrote(e.target.checked)} />
          I have written them down
        </label>
        {problem && <Notice tone="danger">{problem}</Notice>}
      </Gate>
    );
  }

  if (mode === "restore") {
    const ok = validWords(words);
    return (
      <Gate
        icon={KeyRound}
        title="Restore from your words"
        action={
          <>
            <Button variant="primary" disabled={!ok} busy={busy} onClick={() => save(words)}>
              Restore
            </Button>
            <Button variant="quiet" onClick={() => setMode("start")}>
              Back
            </Button>
          </>
        }
      >
        <Field label="Recovery words" hint="Twelve or twenty-four words, with spaces between them.">
          <textarea className={inputClass + " font-mono"} rows={3} value={words} onChange={(e) => setWords(e.target.value)} />
        </Field>
        {words.trim() && !ok && <Notice>Those words don't make a valid key yet.</Notice>}
        {problem && <Notice tone="danger">{problem}</Notice>}
      </Gate>
    );
  }

  return (
    <Gate
      icon={Wallet}
      title="Make your swap account"
      action={
        <>
          <Button
            variant="primary"
            onClick={() => {
              setWords(newWords());
              setWrote(false);
              setMode("new");
            }}
          >
            Make an account
          </Button>
          <Button
            onClick={() => {
              setWords("");
              setMode("restore");
            }}
          >
            I have recovery words
          </Button>
        </>
      }
    >
      <p>
        Swap signs with a key kept on this computer, made from twelve words you write down. It is yours: nobody else,
        including whoever runs this app, can move what it holds.
      </p>
      <p>The same words open the account in any Polkadot wallet, such as Talisman or Nova.</p>
    </Gate>
  );
}

// ── the swap ────────────────────────────────────────────────────────────────

/** The account's key, read from the secure store at the moment of signing. */
async function signingKey(n: Network, address: string, onProgress: (p: Progress) => void) {
  const words = await keySecret.get(WORDS);
  if (!words) {
    onProgress({ stage: "failed", reason: "This computer no longer holds the account's key. Restore it from your words." });
    return null;
  }
  const key = keyFromWords(words);
  if (key.address(n) !== address) {
    onProgress({ stage: "failed", reason: "The key on this computer is not this account's. Restore it from your words." });
    return null;
  }
  return key;
}

function SwapCard({
  client,
  n: base,
  address,
  bal,
  block,
  onSwapped,
}: {
  client: PolkadotClient;
  n: Network;
  address: string;
  bal: Balances;
  block: number | null;
  onSwapped: () => void;
}) {
  const [from, setFrom] = useState<Side>("native");
  const [assetId, setAssetId] = useState(base.dusd.assetId);
  // the network with the chosen asset where dUSD stands (withAsset in lib/swap)
  const n = useMemo(() => withAsset(base, assetById(base, assetId)), [base, assetId]);
  useEffect(() => setAssetId(base.dusd.assetId), [base]);
  const [text, setText] = useState("");
  const [q, setQ] = useState<Quote | null>(null);
  const [fee, setFee] = useState<bigint | null>(null);
  const [quoting, setQuoting] = useState(false);
  const [quoteProblem, setQuoteProblem] = useState<string | null>(null);
  const [sure, setSure] = useState(false);
  const [progress, setProgress] = useState<Progress | null>(null);
  const [details, setDetails] = useState(false);
  const [inverted, setInverted] = useState(false);

  const tIn = token(n, from);
  const tOut = token(n, other(from));
  const amountIn = useMemo(() => parseAmount(text, tIn.decimals), [text, tIn.decimals]);
  const held = from === "native" ? bal.native : bal.assets[n.dusd.assetId] ?? 0n;
  const busy = progress != null && progress.stage !== "final" && progress.stage !== "failed";

  // Quote on every change, and again at every final block while the page is open.
  useEffect(() => {
    if (busy) return;
    if (!amountIn) {
      setQ(null);
      setFee(null);
      setQuoteProblem(null);
      return;
    }
    let live = true;
    // A new amount waits for its quote; a new block only refreshes the one showing.
    const fresh = q == null || q.from !== from || q.amountIn !== amountIn;
    if (fresh) setQuoting(true);
    const t = setTimeout(async () => {
      try {
        const next = await readQuote(client, n, from, amountIn);
        if (!live) return;
        setQ(next);
        setQuoteProblem(next ? null : "The pool cannot quote that amount.");
        if (next) setFee(await networkFee(client, n, next, address).catch(() => null));
      } catch (e) {
        if (live) setQuoteProblem(String((e as Error)?.message ?? e));
      } finally {
        if (live) setQuoting(false);
      }
    }, fresh ? 350 : 0);
    return () => {
      live = false;
      clearTimeout(t);
    };
  }, [client, n, from, amountIn, address, block, busy]);

  useEffect(() => setSure(false), [from, text, n]);

  // The fee is paid in the native token, or in dUSD when there is too little of it.
  const feeInDusd = fee != null && bal.native < fee * 2n + (from === "native" ? amountIn ?? 0n : 0n);
  const short = amountIn != null && amountIn > held;
  const big = q != null && q.impact >= BIG_MOVE;
  const ready = q != null && !short && !quoting && (!big || sure) && canSwap(n.id);

  const max = () => {
    const keep = from === "native" ? (fee ?? 0n) * 3n : 0n;
    const v = held > keep ? held - keep : 0n;
    setText(v > 0n ? formatAmount(v, tIn.decimals, tIn.decimals).replace(/,/g, "") : "");
  };

  const swap = async () => {
    if (!q) return;
    const key = await signingKey(n, address, setProgress);
    if (!key) return;
    const r = await submitSwap(client, n, q, key, { feeInDusd }, setProgress);
    if (r.stage === "final") {
      remember({
        kind: "swap",
        net: n.id,
        at: new Date().toISOString(),
        from,
        amountIn: formatAmount(q.amountIn, tIn.decimals),
        amountOut: formatAmount(r.amountOut ?? q.amountOut, tOut.decimals),
        block: r.block,
        index: r.index,
        ...(n !== base ? { asset: n.dusd.assetId } : {}),
      });
      setText("");
      onSwapped();
    }
  };

  const price = q?.pool.price ?? null;
  const rate =
    price == null
      ? null
      : (from === "native") !== inverted
        ? `1 ${n.native.symbol} = ${price.toFixed(4)} ${n.dusd.symbol}`
        : `1 ${n.dusd.symbol} = ${(1 / price).toFixed(4)} ${n.native.symbol}`;
  const impactTone = q == null ? null : q.impact >= BIG_MOVE ? "danger" : q.impact >= 0.02 ? "warn" : "ok";

  // One button, and its words say what is missing, as in most swap apps.
  const label = !canSwap(n.id)
    ? "Real KSM swaps are not on yet: try test money"
    : !amountIn
      ? "Enter an amount"
      : short
        ? `Not enough ${tIn.symbol}`
        : quoting
          ? "Getting a price"
          : quoteProblem || !q
            ? "No price for that amount"
            : big && !sure
              ? "Tick the box above to swap"
              : `Swap ${tIn.symbol} for ${tOut.symbol}`;

  return (
    <Card>
      <div className="space-y-3">
        {base.assets.length > 1 && (
          <div className="flex items-center gap-1">
            {base.assets.map((a) => (
              <Button
                key={a.assetId}
                variant={a.assetId === n.dusd.assetId ? "primary" : "secondary"}
                disabled={busy}
                onClick={() => {
                  setAssetId(a.assetId);
                  setText("");
                }}
              >
                {base.native.symbol} and {a.symbol}
              </Button>
            ))}
          </div>
        )}

        <div className="relative space-y-1.5">
          <TokenPanel
            label="You pay"
            symbol={tIn.symbol}
            foot={
              <>
                You hold {formatAmount(held, tIn.decimals)} {tIn.symbol}
                <button
                  className="ml-2 font-medium underline-offset-2 hover:underline disabled:opacity-45"
                  style={{ color: inkOf(tIn.symbol) }}
                  onClick={max}
                  disabled={busy || held === 0n}
                >
                  Max
                </button>
              </>
            }
          >
            <input
              className="w-full min-w-0 bg-transparent text-3xl tabular-nums outline-none placeholder:text-[var(--faint)]"
              inputMode="decimal"
              placeholder="0"
              aria-label={`Amount of ${tIn.symbol} to pay`}
              value={text}
              disabled={busy}
              onChange={(e) => setText(e.target.value.replace(",", "."))}
            />
          </TokenPanel>

          <button
            title="Swap the other way"
            aria-label="Swap the other way"
            disabled={busy}
            onClick={() => {
              setFrom(other(from));
              setText("");
            }}
            className="group absolute left-1/2 top-1/2 z-10 grid h-10 w-10 -translate-x-1/2 -translate-y-1/2 place-items-center rounded-full border-4 border-[var(--card)] bg-[var(--card)] ring-1 ring-[var(--line)] text-[var(--fg)] shadow-sm transition hover:text-[var(--accent)] disabled:opacity-45"
          >
            <ArrowDown className="h-4 w-4 transition-transform group-hover:rotate-180" />
          </button>

          <TokenPanel
            label="You get"
            symbol={tOut.symbol}
            foot={q ? `At least ${formatAmount(q.minOut, tOut.decimals)} ${tOut.symbol}, or nothing is swapped` : " "}
          >
            <div className={"w-full min-w-0 truncate text-3xl tabular-nums " + (q ? "text-[var(--fg)]" : "text-[var(--faint)]")}>
              {q ? formatAmount(q.amountOut, tOut.decimals) : quoting ? "…" : "0"}
            </div>
          </TokenPanel>
        </div>

        {quoteProblem && <Notice tone="danger">{quoteProblem}</Notice>}

        {q && (
          <div className="rounded-[var(--radius)] border border-[var(--line)] text-[13px]">
            <button
              className="flex w-full items-center gap-2 px-3 py-2.5 text-left"
              onClick={() => setDetails(!details)}
              aria-expanded={details}
            >
              <span
                className="font-mono text-[var(--fg)] hover:underline"
                title="Show the price the other way round"
                onClick={(e) => {
                  e.stopPropagation();
                  setInverted(!inverted);
                }}
              >
                {rate}
              </span>
              <span className="ml-auto flex items-center gap-1.5" style={{ color: `var(--${impactTone})` }}>
                <span className="h-1.5 w-1.5 rounded-full bg-current" />
                {impactTone === "ok" ? "Small move" : impactTone === "warn" ? "Moves the price" : "Big move"} {pct(q.impact)}
              </span>
              <ChevronDown className={"h-4 w-4 text-[var(--muted)] transition-transform " + (details ? "rotate-180" : "")} />
            </button>
            {details && (
              <dl className="space-y-1.5 border-t border-[var(--line)] px-3 py-2.5 text-[var(--muted)]">
                <Detail k="Moves the pool's price by" v={`${pct(q.impact)}, plus the pool's 0.3% fee`} />
                <Detail k="You get at least" v={`${formatAmount(q.minOut, tOut.decimals)} ${tOut.symbol} (1% leeway)`} />
                <Detail
                  k="Network fee"
                  v={
                    fee == null
                      ? "Working it out"
                      : `About ${formatAmount(fee, n.native.decimals, 6)} ${n.native.symbol}${feeInDusd ? `, paid in ${n.dusd.symbol}` : ""}`
                  }
                />
                <Detail
                  k="The pool holds"
                  v={`${formatAmount(q.pool.native, n.native.decimals, 2)} ${n.native.symbol} and ${formatAmount(q.pool.dusd, n.dusd.decimals, 2)} ${n.dusd.symbol}`}
                />
                <p className="pt-1 text-xs text-[var(--faint)]">
                  The price is whatever the pool holds, so a bigger trade moves it further. For a bigger trade at a price members
                  set, use Exchange.
                </p>
              </dl>
            )}
          </div>
        )}

        {big && (
          <>
            <Notice tone="danger">
              This trade moves the pool's price by {pct(q!.impact)}, so you get noticeably less than the going rate. A smaller
              amount, or Exchange, may get you a better price.
            </Notice>
            <label className="flex items-center gap-2 text-[13px]">
              <input type="checkbox" checked={sure} onChange={(e) => setSure(e.target.checked)} />
              I understand, swap anyway
            </label>
          </>
        )}

        <button
          className="w-full rounded-[calc(var(--radius)+4px)] border px-4 py-3.5 text-[15px] font-medium transition disabled:cursor-default"
          style={
            ready && !busy
              ? { borderColor: inkOf(tOut.symbol), background: wash(tOut.symbol, 14), color: "var(--fg)" }
              : { borderColor: "var(--line)", background: "var(--card)", color: "var(--muted)" }
          }
          disabled={!ready || busy}
          onClick={swap}
        >
          {busy ? "Swapping" : label}
        </button>
        {progress && <SwapProgress p={progress} n={n} />}
      </div>
    </Card>
  );
}

// ── the parts of the swap card ──────────────────────────────────────────────

/**
 * Each token keeps one colour wherever it appears, as swap apps do with logos.
 * Colour is the consequence here: it says which token, nothing more.
 */
const INK: Record<string, string> = {
  KSM: "#111111",
  PAS: "#e6007a",
  dUSD: "#1f9d55",
  BBT: "#d97706",
};
function inkOf(symbol: string) {
  if (INK[symbol]) return INK[symbol];
  let h = 0;
  for (const c of symbol) h = (h * 31 + c.charCodeAt(0)) % 360;
  return `hsl(${h} 60% 42%)`;
}
const wash = (symbol: string, pctMix: number) => `color-mix(in srgb, ${inkOf(symbol)} ${pctMix}%, var(--card))`;

function TokenMark({ symbol, size = 22 }: { symbol: string; size?: number }) {
  return (
    <span
      aria-hidden
      className="grid shrink-0 place-items-center rounded-full font-semibold text-white"
      style={{ width: size, height: size, background: inkOf(symbol), fontSize: size * 0.42 }}
    >
      {symbol === "dUSD" ? "$" : symbol[0]}
    </span>
  );
}

function TokenPanel({
  label,
  symbol,
  foot,
  children,
}: {
  label: string;
  symbol: string;
  foot: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="rounded-[calc(var(--radius)+4px)] px-4 py-3" style={{ background: wash(symbol, 6) }}>
      <div className="text-xs text-[var(--muted)]">{label}</div>
      <div className="mt-1 flex items-center gap-3">
        {children}
        <span className="flex shrink-0 items-center gap-1.5 rounded-full border border-[var(--line)] bg-[var(--card)] py-1 pl-1 pr-3 text-sm font-medium">
          <TokenMark symbol={symbol} />
          {symbol}
        </span>
      </div>
      <div className="mt-1 min-h-4 text-xs text-[var(--faint)]">{foot}</div>
    </div>
  );
}

function Held({ symbol, amount }: { symbol: string; amount: string }) {
  return (
    <span className="flex items-center gap-2.5">
      <TokenMark symbol={symbol} />
      <span className="tabular-nums">{amount}</span>
      <span className="text-[var(--muted)]">{symbol}</span>
    </span>
  );
}

function Detail({ k, v }: { k: string; v: ReactNode }) {
  return (
    <div className="flex justify-between gap-4">
      <dt>{k}</dt>
      <dd className="text-right text-[var(--fg)]">{v}</dd>
    </div>
  );
}

function SwapProgress({ p, n, verb = "Swapped" }: { p: Progress; n: Network; verb?: string }) {
  if (p.stage === "signing") return <Waiting>Signing on this computer</Waiting>;
  if (p.stage === "sent") return <Waiting>Sent, waiting for a block</Waiting>;
  if (p.stage === "in-block") return <Waiting>In a block, waiting for it to be final</Waiting>;
  if (p.stage === "failed") return <Notice tone="danger">{p.reason}</Notice>;
  return (
    <span className="flex items-center gap-3">
      <Notice tone="ok">{verb}, final in block #{p.number.toLocaleString("en-GB")}.</Notice>
      <Button variant="quiet" icon={ExternalLink} onClick={() => openInBrowser(n.explorer(String(p.number), p.index))}>
        See it on the chain
      </Button>
    </span>
  );
}

// ── sending ─────────────────────────────────────────────────────────────────

function SendSection({
  client,
  n,
  address,
  bal,
  onSent,
}: {
  client: PolkadotClient;
  n: Network;
  address: string;
  bal: Balances;
  onSent: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [side, setSide] = useState<Side>("dusd");
  const [toText, setToText] = useState("");
  const [text, setText] = useState("");
  const [fee, setFee] = useState<bigint | null>(null);
  const [dest, setDest] = useState<{ open: boolean; minimum: bigint } | null>(null);
  const [sure, setSure] = useState(false);
  const [progress, setProgress] = useState<Progress | null>(null);

  const t = token(n, side);
  const to = readAddress(toText, n);
  const amount = useMemo(() => parseAmount(text, t.decimals), [text, t.decimals]);
  const held = side === "native" ? bal.native : bal.dusd;
  const busy = progress != null && progress.stage !== "final" && progress.stage !== "failed";

  useEffect(() => {
    setFee(null);
    if (!to || !amount) return;
    let live = true;
    sendFee(client, n, side, to, amount, address)
      .then((f) => live && setFee(f))
      .catch(() => live && setFee(null));
    return () => {
      live = false;
    };
  }, [client, n, side, to, amount, address]);

  useEffect(() => {
    setDest(null);
    if (!to) return;
    let live = true;
    recipient(client, n, to)
      .then((r) => live && setDest(r))
      .catch(() => {});
    return () => {
      live = false;
    };
  }, [client, n, to]);

  useEffect(() => setSure(false), [side, toText, text, n]);

  const feeInDusd = fee != null && bal.native < fee * 2n + (side === "native" ? amount ?? 0n : 0n);
  const short = amount != null && amount > held;
  const self = to === address;
  // dUSD only lands in an account that already holds the native token (recipient()).
  const closed =
    dest != null && !dest.open && (side === "dusd" || (amount != null && amount < dest.minimum));
  const ready = !!to && !!amount && !short && !self && !closed && fee != null && sure && canSwap(n.id);

  const send = async () => {
    if (!to || !amount) return;
    const key = await signingKey(n, address, setProgress);
    if (!key) return;
    const r = await submitSend(client, n, side, to, amount, key, { feeInDusd }, setProgress);
    if (r.stage === "final") {
      remember({
        kind: "send",
        net: n.id,
        at: new Date().toISOString(),
        from: side,
        amountIn: formatAmount(amount, t.decimals),
        amountOut: formatAmount(amount, t.decimals),
        block: r.block,
        index: r.index,
        to,
      });
      setText("");
      setToText("");
      onSent();
    }
  };

  return (
    <Section
      label="Send"
      icon={Send}
      lede={`Move ${n.native.symbol} or ${n.dusd.symbol} from this account to another on Asset Hub, such as your own Talisman or Nova wallet.`}
      aside={
        <Button variant="quiet" onClick={() => setOpen(!open)}>
          {open ? "Close" : "Send"}
        </Button>
      }
    >
      {open && (
        <Card>
          <div className="space-y-4">
            <div className="flex items-center gap-1">
              {(["dusd", "native"] as Side[]).map((v) => (
                <Button key={v} variant={v === side ? "primary" : "secondary"} disabled={busy} onClick={() => { setSide(v); setText(""); }}>
                  {token(n, v).symbol}
                </Button>
              ))}
            </div>
            <Field label="To" hint="An Asset Hub address. Check the first and last few characters against where you copied it.">
              <input
                className={inputClass + " font-mono"}
                value={toText}
                disabled={busy}
                spellCheck={false}
                onChange={(e) => setToText(e.target.value)}
              />
            </Field>
            {toText.trim() && !to && <Notice tone="danger">That isn't an address this network can send to.</Notice>}
            {to && to !== toText.trim() && (
              <p className="text-xs text-[var(--faint)]">
                On this network that address is written <span className="font-mono break-all">{to}</span>. It is the same account.
              </p>
            )}
            {self && <Notice>That is this account.</Notice>}
            {dest && !dest.open && side === "dusd" && (
              <Notice tone="danger">
                That account holds no {n.native.symbol} yet, so it can't receive {n.dusd.symbol}. Send it at least{" "}
                {formatAmount(dest.minimum, n.native.decimals, 6)} {n.native.symbol} first.
              </Notice>
            )}
            {dest && !dest.open && side === "native" && amount != null && amount < dest.minimum && (
              <Notice tone="danger">
                That account is empty, so the first send to it must be at least {formatAmount(dest.minimum, n.native.decimals, 6)}{" "}
                {n.native.symbol}.
              </Notice>
            )}
            <div>
              <Field label="Amount">
                <div className="flex items-center gap-2">
                  <input
                    className={inputClass + " font-mono"}
                    inputMode="decimal"
                    placeholder="0"
                    value={text}
                    disabled={busy}
                    onChange={(e) => setText(e.target.value.replace(",", "."))}
                  />
                  <span className="font-mono w-14 shrink-0 text-sm">{t.symbol}</span>
                </div>
              </Field>
              <p className="mt-1.5 text-xs text-[var(--faint)]">
                You hold {formatAmount(held, t.decimals)} {t.symbol}.
              </p>
            </div>
            {short && <Notice tone="danger">That is more than this account holds.</Notice>}
            {to && amount != null && !short && !self && !closed && (
              <>
                <List>
                  <Row title="Sends" detail={`${formatAmount(amount, t.decimals, t.decimals)} ${t.symbol}`} />
                  <Row title="To" detail={<span className="font-mono break-all">{to}</span>} />
                  <Row
                    title="Network fee"
                    detail={
                      fee == null
                        ? "Working it out"
                        : `About ${formatAmount(fee, n.native.decimals, 6)} ${n.native.symbol}${feeInDusd ? `, paid in ${n.dusd.symbol}` : ""}`
                    }
                  />
                </List>
                <Notice tone="warn">A send can't be called back. If the address is wrong, what you send is gone.</Notice>
                <label className="flex items-center gap-2 text-[13px]">
                  <input type="checkbox" checked={sure} onChange={(e) => setSure(e.target.checked)} />
                  I have checked the address
                </label>
              </>
            )}
            {!canSwap(n.id) && <Notice>Real KSM and dUSD can't be sent from here yet. Switch to test money to try it.</Notice>}
            <div className="flex items-center gap-3">
              <Button variant="primary" size="md" icon={Send} disabled={!ready} busy={busy} onClick={send}>
                Send
              </Button>
              {progress && <SwapProgress p={progress} n={n} verb="Sent" />}
            </div>
          </div>
        </Card>
      )}
    </Section>
  );
}

// ── the account and what it has done ────────────────────────────────────────

function AccountSection({
  n,
  address,
  bal,
  onRefresh,
  onForget,
}: {
  n: Network;
  address: string;
  bal: Balances | null;
  onRefresh: () => void;
  onForget: () => void;
}) {
  const [copied, setCopied] = useState(false);
  const [words, setWords] = useState<string | null>(null);
  const [asking, setAsking] = useState<"show" | "forget" | null>(null);
  const [wrote, setWrote] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [drip, setDrip] = useState<{ busy?: boolean; ok?: boolean; text?: string }>({});

  const askDrip = async () => {
    setDrip({ busy: true });
    try {
      const r = await fetch(DRIP, {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify({ address }),
      }).then((x) => x.json());
      setDrip(
        r.ok
          ? { ok: true, text: `${r.pas} PAS and ${r.dusd} dUSD are on their way. They show here when the block is final.` }
          : { ok: false, text: r.error || "The drip didn't answer. Try again in a minute." },
      );
      if (r.ok) setTimeout(onRefresh, r.pending ? 40_000 : 15_000);
    } catch {
      // No answer can still mean it went out (a slow network outlasts the
      // edge), so look again before saying try again.
      setDrip({ ok: false, text: "No answer yet. It may still arrive, so this checks again in a minute." });
      setTimeout(onRefresh, 60_000);
    }
  };

  const copy = () => {
    navigator.clipboard?.writeText(address);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  const show = async () => {
    setProblem(null);
    const w = await keySecret.get(WORDS);
    if (!w) {
      setProblem("This computer no longer holds the account's key. Restore it from your words.");
      return;
    }
    setWords(w);
    setAsking(null);
  };

  const forget = async () => {
    setProblem(null);
    try {
      await keySecret.delete(WORDS);
      onForget();
    } catch (e) {
      setProblem(String((e as Error)?.message ?? e));
    }
  };

  // Hide the words again after a minute, in case the screen is left open.
  useEffect(() => {
    if (!words) return;
    const t = setTimeout(() => setWords(null), 60_000);
    return () => clearTimeout(t);
  }, [words]);

  return (
    <Section
      label="Your account"
      icon={Wallet}
      lede={
        n.id === "paseo"
          ? "Test money has no value. Ask for some once a day: 5 PAS and 100 dUSD."
          : `Send ${n.native.symbol} or ${n.dusd.symbol} to this address on Asset Hub to swap with it.`
      }
      aside={<Button variant="quiet" icon={RefreshCw} onClick={onRefresh}>Refresh</Button>}
    >
      <List>
        <Row title={<Held symbol={n.native.symbol} amount={bal ? formatAmount(bal.native, n.native.decimals) : "-"} />} />
        {n.assets.map((a) => (
          <Row
            key={a.assetId}
            title={<Held symbol={a.symbol} amount={bal ? formatAmount(bal.assets[a.assetId] ?? 0n, a.decimals) : "-"} />}
          />
        ))}
        <Row
          title="Address"
          detail={<span className="font-mono break-all">{address}</span>}
          action={<Button icon={Copy} onClick={copy}>{copied ? "Copied" : "Copy"}</Button>}
        />
        {n.id === "paseo" && (
          <Row
            title="Test money"
            detail={drip.text ?? "From Birdbrain's test drip, to this address."}
            status={drip.text ? <Status tone={drip.ok ? "ok" : "warn"}>{drip.ok ? "sent" : "not sent"}</Status> : undefined}
            action={
              <Button icon={Wallet} busy={drip.busy} disabled={drip.busy || drip.ok} onClick={askDrip}>
                Get test money
              </Button>
            }
          />
        )}
        <Row
          title="Recovery words"
          detail="The twelve words that open this account anywhere."
          action={
            words ? (
              <Button onClick={() => setWords(null)}>Hide</Button>
            ) : (
              <Button icon={Eye} onClick={() => setAsking("show")}>Show</Button>
            )
          }
        />
        <Row
          title="Remove from this computer"
          detail="Takes the key off this computer. The account and what it holds stay on the chain, for your words to open."
          action={<Button icon={Trash2} onClick={() => { setWrote(false); setAsking("forget"); }}>Remove</Button>}
        />
      </List>

      {asking === "show" && (
        <Card tone="quiet">
          <div className="space-y-3">
            <Notice tone="warn">Anyone who sees these words can spend what the account holds. Check nobody is looking, and that you aren't sharing your screen.</Notice>
            <div className="flex gap-2">
              <Button variant="primary" onClick={show}>Show them</Button>
              <Button variant="quiet" onClick={() => setAsking(null)}>Cancel</Button>
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
          <div className="space-y-3">
            <Notice tone="danger">
              Without your words this can't be undone, and nobody can get the account back for you. Show the words first if
              you aren't sure you have them.
            </Notice>
            <label className="flex items-center gap-2 text-[13px]">
              <input type="checkbox" checked={wrote} onChange={(e) => setWrote(e.target.checked)} />
              I have my recovery words
            </label>
            <div className="flex gap-2">
              <Button variant="primary" disabled={!wrote} onClick={forget}>Remove the key</Button>
              <Button variant="quiet" onClick={() => setAsking(null)}>Cancel</Button>
            </div>
          </div>
        </Card>
      )}

      {problem && <Notice tone="danger">{problem}</Notice>}
    </Section>
  );
}

function HistorySection({ n }: { n: Network }) {
  const done = readHistory().filter((d) => d.net === n.id);
  return (
    <Section label="What this account has done" icon={History}>
      {done.length === 0 ? (
        <Empty>Nothing on {n.id === "paseo" ? "test money" : n.native.symbol} yet.</Empty>
      ) : (
        <List>
          {done.map((d) => {
            const dn = withAsset(n, assetById(n, d.asset));
            const tIn = token(dn, d.from);
            const tOut = token(dn, other(d.from));
            return (
              <Row
                key={d.block + d.index}
                title={
                  d.kind === "send"
                    ? `Sent ${d.amountIn} ${tIn.symbol} to ${d.to ? d.to.slice(0, 6) + "…" + d.to.slice(-4) : "another account"}`
                    : `${d.amountIn} ${tIn.symbol} for ${d.amountOut} ${tOut.symbol}`
                }
                detail={new Date(d.at).toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short" })}
              />
            );
          })}
        </List>
      )}
    </Section>
  );
}

export const swapPlugin: MurmurModule = {
  id: "swap",
  title: "Swap",
  tagline: "Swap KSM and dUSD in one step, against the pool on the chain. Test money only",
  icon: Repeat,
  order: 26,
  kind: "plugin",
  lab: true,
  support: issues("swap"),
  backend: "Asset Hub, read on this computer",
  Panel,
};
