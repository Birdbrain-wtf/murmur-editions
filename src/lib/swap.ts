/**
 * Swap: KSM and dUSD through Asset Hub's own pool (the AssetConversion pallet).
 *
 * The lighter sibling of Exchange. There is no market and no counterparty to
 * wait for: the member's account trades against the pool in one transaction,
 * signed on this computer and settled in one block. The price is whatever the
 * pool holds, so every quote shows how far the trade moves it.
 *
 * Everything here takes a polkadot-api client and nothing else, so the lab
 * scripts (lab/swap/) run the same code the app does.
 */
import type { PolkadotClient } from "polkadot-api";
import { getPolkadotSigner } from "polkadot-api/signer";
import { sr25519CreateDerive } from "@polkadot-labs/hdkd";
import {
  entropyToMiniSecret,
  generateMnemonic,
  mnemonicToEntropy,
  ss58Address,
  ss58Decode,
  validateMnemonic,
} from "@polkadot-labs/hdkd-helpers";
import type { Net } from "./hub";

export type { Net };
export type Side = "native" | "dusd";

/** lab/swap/bbt.json, the test BBT on Paseo Asset Hub. */
const BBT_TEST_ID = 50001041;

export interface Token {
  symbol: string;
  decimals: number;
}

export type Asset = Token & { assetId: number };

export interface Network {
  id: Net;
  /** what the member is told this is */
  label: string;
  ss58: number;
  native: Token;
  dusd: Token & { assetId: number };
  /** every asset with a pool against the native token that Swap offers, dUSD first */
  assets: Asset[];
  /** a finished swap, for the member to check somewhere other than this app */
  explorer: (block: string, index: number) => string;
}

export const NETWORKS: Record<Net, Network> = {
  paseo: {
    id: "paseo",
    label: "Test money",
    ss58: 0,
    native: { symbol: "PAS", decimals: 10 },
    // A test dUSD in a PAS/dUSD pool priced like KSM/dUSD at par (lab/swap/setup-testnet.ts).
    dusd: { symbol: "dUSD", decimals: 6, assetId: 50001039 },
    assets: [
      { symbol: "dUSD", decimals: 6, assetId: 50001039 },
      // The BBT test: fixed supply, LP tokens and every admin role sent to a keyless
      // account, so nobody can mint, freeze or pull the pool (lab/swap/setup-bbt.ts).
      { symbol: "BBT", decimals: 10, assetId: BBT_TEST_ID },
    ],
    explorer: (b, i) => `https://assethub-paseo.subscan.io/extrinsic/${b}-${i}`,
  },
  kusama: {
    id: "kusama",
    label: "KSM",
    ss58: 2,
    native: { symbol: "KSM", decimals: 12 },
    dusd: { symbol: "dUSD", decimals: 6, assetId: 50000002 },
    assets: [{ symbol: "dUSD", decimals: 6, assetId: 50000002 }],
    explorer: (b, i) => `https://assethub-kusama.subscan.io/extrinsic/${b}-${i}`,
  },
};

/**
 * The same network with `asset` standing where dUSD stands. Every function here
 * reads `n.dusd` as "the asset on the other side of the pool", so a swap, quote,
 * balance or fee for BBT is the dUSD call made on `withAsset(n, bbt)`.
 */
export const withAsset = (n: Network, asset: Asset): Network => (asset.assetId === n.dusd.assetId ? n : { ...n, dusd: asset });
export const assetById = (n: Network, id: number | undefined) => n.assets.find((a) => a.assetId === id) ?? n.dusd;

/**
 * Real KSM can be quoted but not swapped yet. Turning this on is rich's call:
 * a key on the device needs its recovery words written down first, and a swap
 * screen in front of real money wants the UK read the Exchange is waiting on.
 */
export const REAL_MONEY = false;
export const canSwap = (net: Net) => net === "paseo" || REAL_MONEY;

/** The pool keeps 0.3% of what goes in (AssetConversion.LPFee = 3 per mille). */
export const POOL_FEE = 0.003;
/** How far the price may move between the quote and the block, before the swap
 *  refuses to happen rather than fill worse. */
export const SLIPPAGE = 0.01;

const location = (n: Network, side: Side) =>
  side === "native"
    ? { parents: 1, interior: { type: "Here", value: undefined } }
    : {
        parents: 0,
        interior: {
          type: "X2",
          value: [
            { type: "PalletInstance", value: 50 },
            { type: "GeneralIndex", value: BigInt(n.dusd.assetId) },
          ],
        },
      };

export const token = (n: Network, side: Side) => (side === "native" ? n.native : n.dusd);
export const other = (side: Side): Side => (side === "native" ? "dusd" : "native");

// ── amounts ─────────────────────────────────────────────────────────────────

/** "1.25" → planck. Returns null for anything that is not a plain positive number. */
export function parseAmount(text: string, decimals: number): bigint | null {
  const t = text.trim();
  if (!/^\d*\.?\d*$/.test(t) || t === "" || t === ".") return null;
  const [whole, frac = ""] = t.split(".");
  if (frac.length > decimals) return null;
  const v = BigInt(whole || "0") * 10n ** BigInt(decimals) + BigInt(frac.padEnd(decimals, "0") || "0");
  return v > 0n ? v : null;
}

/** planck → "1.2345", trimmed to `places` and never in scientific notation. */
export function formatAmount(v: bigint, decimals: number, places = 4): string {
  const neg = v < 0n;
  const a = neg ? -v : v;
  const base = 10n ** BigInt(decimals);
  const whole = a / base;
  let frac = (a % base).toString().padStart(decimals, "0").slice(0, places).replace(/0+$/, "");
  if (whole === 0n && frac === "" && a > 0n) frac = "0".repeat(places - 1) + "1";
  return `${neg ? "-" : ""}${whole.toLocaleString("en-GB")}${frac ? "." + frac : ""}`;
}

const toNumber = (v: bigint, decimals: number) => Number(v) / 10 ** decimals;

// ── the member's key ────────────────────────────────────────────────────────

export interface Account {
  publicKey: Uint8Array;
  address: (n: Network) => string;
}

export const newWords = () => generateMnemonic(128);
export const validWords = (w: string) => validateMnemonic(w.trim().toLowerCase().split(/\s+/).join(" "));
export const normaliseWords = (w: string) => w.trim().toLowerCase().split(/\s+/).join(" ");

/** The same key any Polkadot wallet makes from these words (sr25519, no path),
 *  so the member can take the account to Talisman, Nova or Polkadot.js. */
export function keyFromWords(words: string) {
  const kp = sr25519CreateDerive(entropyToMiniSecret(mnemonicToEntropy(normaliseWords(words))))("");
  return {
    publicKey: kp.publicKey,
    address: (n: Network) => ss58Address(kp.publicKey, n.ss58),
    signer: getPolkadotSigner(kp.publicKey, "Sr25519", kp.sign),
  };
}

export const addressFor = (publicKey: Uint8Array, n: Network) => ss58Address(publicKey, n.ss58);

// ── reading the chain ───────────────────────────────────────────────────────

export interface Balances {
  /** native that can leave the account without closing it */
  native: bigint;
  dusd: bigint;
  /** every asset in `n.assets`, by asset id */
  assets: Record<number, bigint>;
}

export async function balances(client: PolkadotClient, n: Network, address: string): Promise<Balances> {
  const api = client.getUnsafeApi() as any;
  const ids = [...new Set([n.dusd.assetId, ...n.assets.map((a) => a.assetId)])];
  const [acc, ed, ...held] = await Promise.all([
    api.query.System.Account.getValue(address),
    api.constants.Balances.ExistentialDeposit(),
    ...ids.map((id) => api.query.Assets.Account.getValue(id, address)),
  ]);
  const { free, frozen } = acc.data as { free: bigint; frozen: bigint };
  const locked = frozen > ed ? frozen : ed;
  const assets = Object.fromEntries(ids.map((id, i) => [id, (held[i]?.balance as bigint) ?? 0n]));
  return {
    native: free > locked ? free - locked : 0n,
    dusd: assets[n.dusd.assetId],
    assets,
  };
}

export interface Pool {
  native: bigint;
  dusd: bigint;
  /** dUSD per one native token, from the reserves */
  price: number;
}

export async function pool(client: PolkadotClient, n: Network): Promise<Pool | null> {
  const api = client.getUnsafeApi() as any;
  const r = await api.apis.AssetConversionApi.get_reserves(location(n, "native"), location(n, "dusd"));
  if (!r) return null;
  const [native, dusd] = r as [bigint, bigint];
  return { native, dusd, price: toNumber(dusd, n.dusd.decimals) / toNumber(native, n.native.decimals) };
}

export interface Quote {
  from: Side;
  amountIn: bigint;
  amountOut: bigint;
  /** the least the swap will accept, after SLIPPAGE */
  minOut: bigint;
  /** how far this trade moves the pool's price, net of the pool's fee (0.05 = 5%) */
  impact: number;
  pool: Pool;
}

/** What `amountIn` of `from` buys now, read from the pool on this computer. */
export async function quote(client: PolkadotClient, n: Network, from: Side, amountIn: bigint): Promise<Quote | null> {
  const api = client.getUnsafeApi() as any;
  const [out, p] = await Promise.all([
    api.apis.AssetConversionApi.quote_price_exact_tokens_for_tokens(location(n, from), location(n, other(from)), amountIn, true),
    pool(client, n),
  ]);
  if (out == null || !p) return null;
  const [rIn, rOut] = from === "native" ? [p.native, p.dusd] : [p.dusd, p.native];
  const fair = (Number(amountIn) * Number(rOut)) / Number(rIn) * (1 - POOL_FEE);
  const amountOut = out as bigint;
  return {
    from,
    amountIn,
    amountOut,
    minOut: (amountOut * BigInt(Math.round((1 - SLIPPAGE) * 10_000))) / 10_000n,
    impact: fair > 0 ? Math.max(0, 1 - Number(amountOut) / fair) : 0,
    pool: p,
  };
}

export function swapTx(client: PolkadotClient, n: Network, q: Quote, sendTo: string) {
  const api = client.getUnsafeApi() as any;
  return api.tx.AssetConversion.swap_exact_tokens_for_tokens({
    path: [location(n, q.from), location(n, other(q.from))],
    amount_in: q.amountIn,
    amount_out_min: q.minOut,
    send_to: sendTo,
    // never let a swap close the account by spending below the minimum balance
    keep_alive: true,
  });
}

/** The network's fee for this swap, in the native token. */
export async function networkFee(client: PolkadotClient, n: Network, q: Quote, address: string): Promise<bigint> {
  return swapTx(client, n, q, address).getEstimatedFees(address);
}

export type Progress =
  | { stage: "signing" }
  | { stage: "sent" }
  | { stage: "in-block"; block: string }
  | { stage: "final"; block: string; number: number; index: number; amountOut: bigint | null }
  | { stage: "failed"; reason: string; block?: string };

type Key = ReturnType<typeof keyFromWords>;

/** Sign `tx` with the member's key, send it, and settle when its block is final. */
function signAndWatch(
  tx: any,
  key: Key,
  options: Record<string, unknown> | undefined,
  onProgress: (p: Progress) => void,
  amountOut: (events: any[]) => bigint | null,
): Promise<Progress> {
  onProgress({ stage: "signing" });
  return new Promise((resolve) => {
    const done = (p: Progress) => {
      onProgress(p);
      resolve(p);
      sub.unsubscribe();
    };
    const sub = tx.signSubmitAndWatch(key.signer, options).subscribe({
      next: (e: any) => {
        if (e.type === "broadcasted") onProgress({ stage: "sent" });
        if (e.type === "txBestBlocksState" && e.found) onProgress({ stage: "in-block", block: e.block.hash });
        if (e.type === "finalized") {
          if (!e.ok) {
            done({ stage: "failed", reason: describe(e.dispatchError), block: e.block.hash });
            return;
          }
          done({
            stage: "final",
            block: e.block.hash,
            number: e.block.number,
            index: e.block.index,
            amountOut: amountOut(e.events as any[]),
          });
        }
      },
      error: (err: unknown) => done({ stage: "failed", reason: String((err as Error)?.message ?? err) }),
    });
  });
}

/**
 * Sign the swap with the member's key and send it. `onProgress` hears each step;
 * the promise settles when the block holding it is final, or the swap fails.
 * The fee is paid in dUSD when the account holds too little of the native token
 * to pay it (ChargeAssetTxPayment), so an account holding only dUSD can still swap.
 */
export function submitSwap(
  client: PolkadotClient,
  n: Network,
  q: Quote,
  key: Key,
  opts: { feeInDusd: boolean },
  onProgress: (p: Progress) => void,
): Promise<Progress> {
  const tx = swapTx(client, n, q, key.address(n));
  return signAndWatch(tx, key, opts.feeInDusd ? { asset: location(n, "dusd") } : undefined, onProgress, (events) => {
    const ev = events.find((x) => x.type === "AssetConversion" && x.value.type === "SwapExecuted");
    return ev?.value.value.amount_out ?? null;
  });
}

// ── sending ─────────────────────────────────────────────────────────────────

/** Any Polkadot-family address, read back in this network's format; null if it isn't one. */
export function readAddress(text: string, n: Network): string | null {
  try {
    const t = text.trim();
    if (!t) return null;
    const [publicKey] = ss58Decode(t);
    return publicKey.length === 32 ? ss58Address(publicKey, n.ss58) : null;
  } catch {
    return null;
  }
}

/**
 * Whether `to` can take what we send. dUSD is not a "sufficient" asset on Asset
 * Hub (on Kusama or the test network), so it can only land in an account that
 * already holds the native token; anything else fails with CannotCreate. A
 * native send to an empty account must be at least the existential deposit.
 */
export async function recipient(client: PolkadotClient, n: Network, to: string) {
  const api = client.getUnsafeApi() as any;
  const [acc, ed] = await Promise.all([api.query.System.Account.getValue(to), api.constants.Balances.ExistentialDeposit()]);
  return { open: (acc.providers as number) > 0, minimum: ed as bigint };
}

export function sendTx(client: PolkadotClient, n: Network, side: Side, to: string, amount: bigint) {
  const api = client.getUnsafeApi() as any;
  const dest = { type: "Id", value: to };
  // keep_alive both ways: a send never closes the account it leaves
  return side === "native"
    ? api.tx.Balances.transfer_keep_alive({ dest, value: amount })
    : api.tx.Assets.transfer_keep_alive({ id: n.dusd.assetId, target: dest, amount });
}

export async function sendFee(client: PolkadotClient, n: Network, side: Side, to: string, amount: bigint, from: string) {
  return sendTx(client, n, side, to, amount).getEstimatedFees(from);
}

/** Send `amount` of `side` from the member's account to `to`. Same steps as a swap. */
export function submitSend(
  client: PolkadotClient,
  n: Network,
  side: Side,
  to: string,
  amount: bigint,
  key: Key,
  opts: { feeInDusd: boolean },
  onProgress: (p: Progress) => void,
): Promise<Progress> {
  const tx = sendTx(client, n, side, to, amount);
  return signAndWatch(tx, key, opts.feeInDusd ? { asset: location(n, "dusd") } : undefined, onProgress, () => amount);
}

function describe(err: any): string {
  const inner = err?.value?.value?.type ?? err?.value?.type ?? err?.type;
  const known: Record<string, string> = {
    ProvidedMinimumNotSufficientForSwap: "The price moved more than 1% before the block. Nothing was swapped. Ask for a new quote.",
    InsufficientLiquidity: "The pool does not hold enough for this swap.",
    AmountOutTooHigh: "The pool does not hold enough for this swap.",
    BalanceLow: "This account does not hold enough for the swap and its fee.",
    FundsUnavailable: "This account does not hold enough for the swap and its fee.",
    NotExpendable: "That would spend the minimum this account must keep open. Try a little less.",
    ExistentialDeposit: "That is less than the smallest amount an empty account can receive here. Send a little more.",
    BelowMinimum: "That is less than the smallest amount an empty account can receive here. Send a little more.",
    CannotCreate: `That account holds none of the network's own token, so it can't receive dUSD yet. Send it a little of that first.`,
  };
  return known[inner] ?? `The chain refused it (${inner ?? JSON.stringify(err)}).`;
}

// ── history, kept on this computer ──────────────────────────────────────────

export interface Done {
  /** missing on entries from before sending existed: those are swaps */
  kind?: "swap" | "send";
  net: Net;
  at: string;
  from: Side;
  amountIn: string;
  amountOut: string;
  block: string;
  index: number;
  /** a send's destination */
  to?: string;
  /** the asset on the other side, when it was not dUSD */
  asset?: number;
}

const HISTORY = "murmur.swap.history.v1";

export function history(): Done[] {
  try {
    return JSON.parse(localStorage.getItem(HISTORY) || "[]");
  } catch {
    return [];
  }
}

export function remember(d: Done) {
  localStorage.setItem(HISTORY, JSON.stringify([d, ...history()].slice(0, 50)));
}
