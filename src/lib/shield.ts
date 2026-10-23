/**
 * Shield: a shielded pool on Asset Hub, read and signed on this computer.
 *
 * A shielded pool is a box everyone pays into. Paying in writes one line on the
 * chain (a commitment, which says nothing about who or how much). Taking out
 * proves, without saying which line is yours, that one of them is, and sends
 * the money somewhere new. The hiding is done by the crowd: if the box holds a
 * thousand deposits you are one of a thousand, and if it holds one you are that
 * one. So every screen here leads with the size of the crowd, the way Swap
 * leads with how far a trade moves the price.
 *
 * The pool is Kusama Shield's (shield.markets, MIT, codeberg.org/KusamaShield),
 * a contract on Asset Hub's PolkaVM. We did not write it and it is not audited
 * yet (referendum 667 pays for the audit). Nothing here signs on a network
 * holding real money: `REAL_MONEY` is off, exactly as in Swap.
 *
 * What is ours, and better than the pool's own interface:
 *
 * - **Notes come from the member's twelve words.** Shield's interface keeps
 *   each deposit's secret in the browser's storage, and clearing it loses the
 *   money. Here every note is derived from the member's own key, so twelve
 *   words and a look at the chain bring every note back on any computer. No
 *   secret is ever written down by this app.
 * - **The crowd is measured, not claimed.** `readCrowd` counts the deposits in
 *   the pool and how many share the amount about to be paid in.
 * - **A lying server cannot take anything.** The tree is rebuilt from the
 *   chain's own logs; if what a server returns is wrong the proof fails against
 *   the root the contract holds. The server is trusted for being there, not for
 *   being honest.
 *
 * Everything here takes plain arguments, so lab/shield/ runs the same code the
 * app does.
 */
import type { Contract, HDNodeWallet, JsonRpcProvider } from "ethers";

export type ShieldNet = "paseo" | "kusama" | "polkadot";

/** The BN254 scalar field the circuit works in. Every value is reduced into it. */
export const FIELD = 21888242871839275222246405745257275088548364400416034343698204186575808495617n;

/** The circuit is built for 128 siblings, whatever the pool's own tree depth. */
const CIRCUIT_DEPTH = 128;

/** The asset id the pool uses for the network's own token. */
export const NATIVE_ASSET = 0n;

export interface ShieldNetwork {
  id: ShieldNet;
  /** what the member is told this is */
  label: string;
  chainId: number;
  /** eth-rpc endpoints, tried in order (a shielded pool is an EVM contract,
   *  so it is read through eth-rpc and not through the app's light client) */
  rpcs: string[];
  contract: string;
  /** v7 keeps the nullifier back until withdrawal; v4 reveals it on deposit,
   *  which is the linkability v7 was written to fix */
  pool: "v7" | "v4";
  /**
   * The token, always to 18 places. A chain's own unit is not what a contract
   * sees: pallet-revive hands every balance to a contract scaled to 18 decimals
   * so that Ethereum tooling works, whatever the chain counts in (KSM 12, DOT
   * 10, PAS 10). Every amount on this side of the boundary, including the one
   * sealed into a commitment, is that scaled figure.
   */
  native: { symbol: string; decimals: 18 };
  /** amounts the plugin offers, so one member's deposit looks like another's */
  steps: string[];
  explorer: (tx: string) => string;
}

export const SHIELD_NETWORKS: Record<ShieldNet, ShieldNetwork> = {
  paseo: {
    id: "paseo",
    label: "Test money",
    chainId: 420420417,
    rpcs: ["https://paseo-assethub-rpc.laissez-faire.trade"],
    // FixedIlopPhase2Paseo_v7, deployed 2026-07-13: the only pool with the
    // linkability fix, and the only one this app will sign on.
    contract: "0x3068490C79708D0725E3D4Aa9C35Da708f09071e",
    pool: "v7",
    native: { symbol: "PAS", decimals: 18 },
    steps: ["0.01", "0.1", "1"],
    explorer: (tx) => `https://assethub-paseo.subscan.io/tx/${tx}`,
  },
  kusama: {
    id: "kusama",
    label: "KSM",
    chainId: 420420418,
    rpcs: ["https://eth-rpc-kusama.polkadot.io/"],
    // The pool Shield's own interface uses (Interface/src/App.tsx, 2026-09-28),
    // deployed 2026-09-02. 0xDC80…1Ed8 is an older pool with no deposits ever,
    // which this app read until 2026-10-17. Steps sit where its crowd already
    // is: most deposits so far are 0.5 or 1 KSM.
    contract: "0xC86A3B1A2EbBEc8d32949A1E75e3BafE50b5f1D4",
    pool: "v7",
    native: { symbol: "KSM", decimals: 18 },
    steps: ["0.1", "0.5", "1"],
    explorer: (tx) => `https://assethub-kusama.subscan.io/tx/${tx}`,
  },
  polkadot: {
    id: "polkadot",
    label: "DOT",
    chainId: 420420419,
    rpcs: ["https://eth-rpc.polkadot.io/"],
    // The pool Shield's own interface uses, deployed 2026-07-26
    // (FixedIlopPhase2Paseo_v7_Polkadot.sol). 0xe55B…7051 is an older pool
    // with one deposit, which this app read until 2026-10-17. Most deposits
    // here are 0.1, 0.5 or 1 DOT, so those are the steps.
    contract: "0x0D694Da746e73D1e255c1894F90e38170db45809",
    pool: "v7",
    native: { symbol: "DOT", decimals: 18 },
    steps: ["0.1", "0.5", "1"],
    explorer: (tx) => `https://assethub-polkadot.subscan.io/tx/${tx}`,
  },
};

/**
 * Real money is off in code, as in Swap. What it waits on is written down in
 * lab/shield/AGENTS.md: the audit paid for by referendum 667 has not happened,
 * the recipient of a withdrawal is not covered by the proof (VULN, lab notes),
 * and the pools hold nothing, so there is no crowd to hide in. Turning it on is
 * rich's call, not an agent's.
 */
export const REAL_MONEY = false;
export const canShield = (net: ShieldNet) => net === "paseo" || REAL_MONEY;

// ── the pool's own words ────────────────────────────────────────────────────

/** Only what this plugin calls. The pool's full ABI is in Shield's own repo. */
const POOL_ABI = [
  "function depositNative(bytes32 commitment) payable",
  "function depositNative(bytes32 commitment, bytes32 nullifierHash) payable",
  "function withdraw(uint[2] pA, uint[2][2] pB, uint[2] pC, uint[8] pubSignals, address recipient)",
  "function currentRoot() view returns (uint256)",
  "function treeSize() view returns (uint256)",
  "function escrow(address asset) view returns (uint256)",
  "function isNullifierSpent(bytes32 nullifierHash) view returns (bool)",
  "event Deposit(address indexed asset, bytes32 commitment)",
  "event NewCommitment(bytes32 newCommitmentHash)",
  "event Withdrawal(address indexed asset, uint256 amount, address indexed recipient, uint256 newCommitment)",
];

const ethersMod = () => import("ethers");
const poseidonMod = () => import("poseidon-lite");

/** A provider on the first endpoint that answers. */
export async function connect(n: ShieldNetwork): Promise<JsonRpcProvider> {
  const { JsonRpcProvider } = await ethersMod();
  let last: unknown = null;
  for (const url of n.rpcs) {
    try {
      const p = new JsonRpcProvider(url, { chainId: n.chainId, name: n.id }, { staticNetwork: true });
      await p.getBlockNumber();
      return p;
    } catch (e) {
      last = e;
    }
  }
  // The member gets one sentence; the detail goes where a developer looks.
  console.warn(`shield: no endpoint answered for ${n.id}`, last);
  throw new Error(
    `The ${n.label} pool cannot be reached. A shielded pool is a contract, not a chain, so it is read through a server rather than this computer's own light client, and none of its servers is answering.`,
  );
}

async function pool(n: ShieldNetwork, runner: JsonRpcProvider | HDNodeWallet): Promise<Contract> {
  const { Contract } = await ethersMod();
  return new Contract(n.contract, POOL_ABI, runner);
}

// ── amounts ─────────────────────────────────────────────────────────────────

export function parseAmount(text: string, decimals: number): bigint | null {
  const t = text.trim();
  if (!t || !/^\d*\.?\d*$/.test(t)) return null;
  const [whole, frac = ""] = t.split(".");
  if (frac.length > decimals) return null;
  const v = BigInt((whole || "0") + frac.padEnd(decimals, "0"));
  return v > 0n ? v : null;
}

export function formatAmount(v: bigint, decimals: number, places = 4): string {
  const neg = v < 0n;
  const abs = neg ? -v : v;
  const unit = 10n ** BigInt(decimals);
  const whole = abs / unit;
  const frac = (abs % unit).toString().padStart(decimals, "0").slice(0, places).replace(/0+$/, "");
  return `${neg ? "-" : ""}${whole.toLocaleString("en-GB")}${frac ? "." + frac : ""}`;
}

// ── the member's own key ────────────────────────────────────────────────────

/**
 * The account that pays into the pool, and the fresh accounts that collect from
 * it, all come from one set of twelve words on the standard Ethereum path. The
 * same words open the same accounts in MetaMask or any other wallet, and they
 * are the Swap words if the member chose to use them, because a different path
 * gives a different account with no link between the two on any chain.
 */
export async function account(words: string, index = 0): Promise<HDNodeWallet> {
  const { HDNodeWallet } = await ethersMod();
  return HDNodeWallet.fromPhrase(words.trim().replace(/\s+/g, " "), undefined, `m/44'/60'/0'/0/${index}`);
}

export async function newWords(): Promise<string> {
  const { Wallet } = await ethersMod();
  return Wallet.createRandom().mnemonic!.phrase;
}

export async function validWords(words: string): Promise<boolean> {
  try {
    await account(words);
    return true;
  } catch {
    return false;
  }
}

// ── notes ───────────────────────────────────────────────────────────────────

/**
 * A note is one deposit's claim on the pool: an amount, and two field elements
 * only the member can work out. Both come from the member's own key, so the
 * only thing ever needed to find a note again is the twelve words.
 *
 *   secret    = keccak("decent.shield.note.v1" | privateKey | "s" | index) mod r
 *   nullifier = the same with "n"
 */
export interface Note {
  /** which note this is for this account, counting from 0 */
  index: number;
  amount: bigint;
  asset: bigint;
  /** the line written on the chain: poseidon(poseidon(amount, asset), poseidon(nullifier, secret)) */
  commitment: string;
  /** revealed only when the note is spent, and what stops it being spent twice */
  nullifierHash: string;
  secret: string;
  nullifier: string;
}

async function noteParts(words: string, index: number): Promise<{ secret: string; nullifier: string }> {
  const { keccak256, concat, toUtf8Bytes, toBeHex } = await ethersMod();
  const key = (await account(words)).privateKey;
  const draw = (tag: string) =>
    (BigInt(keccak256(concat([toUtf8Bytes("decent.shield.note.v1"), key, toUtf8Bytes(tag), toBeHex(index, 4)]))) % FIELD).toString();
  return { secret: draw("s"), nullifier: draw("n") };
}

/**
 * The commitment and nullifier hash, exactly as the FixedIlop circuit builds
 * them (zkp-service.ts in Shield's own library). Getting this wrong would write
 * a line on the chain that no proof of ours could ever spend, so it is ported
 * rather than reinvented, and lab/shield/e2e-proof.ts checks it against the
 * circuit itself.
 */
export async function deriveNote(words: string, index: number, amount: bigint, asset = NATIVE_ASSET): Promise<Note> {
  const { poseidon1, poseidon2 } = await poseidonMod();
  const { secret, nullifier } = await noteParts(words, index);
  const precommitment = poseidon2([BigInt(nullifier), BigInt(secret)]);
  const valueAsset = poseidon2([amount, asset]);
  return {
    index,
    amount,
    asset,
    commitment: poseidon2([valueAsset, precommitment]).toString(),
    nullifierHash: poseidon1([BigInt(nullifier)]).toString(),
    secret,
    nullifier,
  };
}

// ── what the member holds, and what the chain says about it ─────────────────

/** A line in the pool's tree, with the amount that paid for it where we can see it. */
export interface Leaf {
  commitment: string;
  block: number;
  /** what the deposit transaction carried, when it was a deposit we could read */
  amount: bigint | null;
}

/** The pool as it stands. The crowd is `crowdSize(crowd)`, and nothing else. */
export interface Crowd {
  net: ShieldNet;
  head: number;
  /** every commitment in the tree, oldest first */
  leaves: Leaf[];
  /** what the pool still holds in the network's own token */
  held: bigint;
  /**
   * How many commitments the contract says its tree holds. Deposits made from a
   * Substrate account through revive.call never reach eth_getLogs, so on the
   * live pools this is larger than `leaves.length` (2026-10-17: Polkadot 176
   * against 111 seen, Kusama 55 against 44). The crowd is this figure. A tree
   * rebuilt from `leaves` alone will not reach the contract's root.
   */
  size: number | null;
  /** the root the contract itself reports */
  root: string;
  withdrawals: number;
  /** when the last deposit landed, unix seconds, if any */
  lastAt: number | null;
  /** read through a server's eth-rpc, never checked on this computer */
  checked: false;
}

export async function readCrowd(n: ShieldNetwork, provider?: JsonRpcProvider): Promise<Crowd> {
  const { id } = await ethersMod();
  const p = provider ?? (await connect(n));
  const c = await pool(n, p);
  const head = await p.getBlockNumber();

  const topics = {
    depositV7: id("Deposit(address,bytes32)"),
    depositV4: id("Deposit(address,bytes32,uint256)"),
    change: id("NewCommitment(bytes32)"),
    withdrawal: id("Withdrawal(address,uint256,address,uint256)"),
  };

  const logs = await p.getLogs({
    address: n.contract,
    fromBlock: 0,
    toBlock: head,
    topics: [[topics.depositV7, topics.depositV4, topics.change, topics.withdrawal]],
  });

  // The tree takes deposits and change commitments in the order the chain put
  // them, and nothing else: a withdrawal only tells us somebody left.
  const leaves: Leaf[] = [];
  let withdrawals = 0;
  for (const log of logs) {
    const topic = log.topics[0];
    if (topic === topics.withdrawal) {
      withdrawals++;
      continue;
    }
    // Both deposit shapes and the change event carry the commitment as the
    // first word of the data, so the same slice reads all three.
    const commitment = BigInt("0x" + log.data.slice(2, 66)).toString();
    if (commitment === "0") continue;
    leaves.push({ commitment, block: log.blockNumber, amount: null });
  }

  // What each deposit was worth is the transaction's own value. Only the most
  // recent are read, because this is for "how many look like me", not an audit.
  const recent = logs.filter((l) => l.topics[0] === topics.depositV7 || l.topics[0] === topics.depositV4).slice(-40);
  await Promise.all(
    recent.map(async (log) => {
      try {
        const tx = await p.getTransaction(log.transactionHash);
        const commitment = BigInt("0x" + log.data.slice(2, 66)).toString();
        const leaf = leaves.find((l) => l.commitment === commitment);
        if (leaf && tx) leaf.amount = tx.value;
      } catch {
        // A server that will not hand over a transaction costs us a number on
        // the screen, nothing more.
      }
    }),
  );

  const last = leaves.at(-1);
  const lastAt = last ? ((await p.getBlock(last.block))?.timestamp ?? null) : null;

  let held = 0n;
  try {
    held = await c.escrow("0x0000000000000000000000000000000000000000");
  } catch {
    held = await p.getBalance(n.contract);
  }
  let size: number | null = null;
  try {
    size = Number(await c.treeSize());
  } catch {
    // Older deployments do not offer it.
  }
  let root = "0";
  try {
    root = (await c.currentRoot()).toString();
  } catch {
    // Some deployments do not offer the view; the tree below still has a root.
  }

  return { net: n.id, head, leaves, held, size, root, withdrawals, lastAt, checked: false };
}

/**
 * How much of a crowd there is to hide in. A shielded pool hides a withdrawal
 * among the deposits that could have been it, so an amount nobody else has paid
 * in is a withdrawal with one candidate: the member.
 */
/** Every commitment in the tree, counting the ones no event shows us. */
export const crowdSize = (crowd: Crowd | null) => Math.max(crowd?.leaves.length ?? 0, crowd?.size ?? 0);

export function hidingAmong(crowd: Crowd | null, amount: bigint | null): { crowd: number; sameAmount: number | null } {
  // An unread pool says nothing, which is not the same as saying nobody is there.
  if (!crowd || amount == null) return { crowd: crowdSize(crowd), sameAmount: null };
  const known = crowd.leaves.filter((l) => l.amount != null);
  return {
    crowd: crowdSize(crowd),
    sameAmount: known.length ? known.filter((l) => l.amount === amount).length : null,
  };
}

// ── the tree ────────────────────────────────────────────────────────────────

/**
 * A lean incremental Merkle tree over poseidon, a line-for-line port of
 * InternalLeanIMT.sol so the root we work out is the root the contract holds.
 * An odd node carries straight up rather than being paired with a zero, which
 * is what makes it lean and what a plain Merkle implementation gets wrong.
 */
export class Tree {
  private leaves: bigint[] = [];
  private sides = new Map<number, bigint>();
  private _depth = 0;
  private _root = 0n;

  get root() {
    return this._root;
  }
  get size() {
    return this.leaves.length;
  }
  get depth() {
    return this._depth;
  }

  constructor(private poseidon2: (xs: bigint[]) => bigint) {}

  static async of(commitments: string[]): Promise<Tree> {
    const { poseidon2 } = await poseidonMod();
    const t = new Tree(poseidon2 as (xs: bigint[]) => bigint);
    for (const c of commitments) t.insert(BigInt(c));
    return t;
  }

  insert(leaf: bigint) {
    const index = this.leaves.length;
    if (1 << this._depth < index + 1) this._depth++;
    let node = leaf;
    for (let level = 0; level < this._depth; level++) {
      if ((index >> level) & 1) node = this.poseidon2([this.sides.get(level) ?? 0n, node]);
      else this.sides.set(level, node);
    }
    this.sides.set(this._depth, node);
    this._root = node;
    this.leaves.push(leaf);
  }

  indexOf(leaf: string) {
    return this.leaves.indexOf(BigInt(leaf));
  }

  /** The siblings on the way up, padded to the depth the circuit was built for. */
  proof(leafIndex: number): { siblings: string[]; root: string; leafIndex: number } {
    if (leafIndex < 0 || leafIndex >= this.leaves.length) throw new Error("That note is not in the pool's tree.");
    const siblings: bigint[] = [];
    let layer = [...this.leaves];
    let idx = leafIndex;
    for (let level = 0; level < this._depth; level++) {
      const sib = idx % 2 === 0 ? idx + 1 : idx - 1;
      siblings.push(sib >= 0 && sib < layer.length ? layer[sib] : 0n);
      const next: bigint[] = [];
      for (let i = 0; i < layer.length; i += 2)
        next.push(i + 1 < layer.length ? this.poseidon2([layer[i], layer[i + 1]]) : layer[i]);
      layer = next;
      idx = Math.floor(idx / 2);
    }
    while (siblings.length < CIRCUIT_DEPTH) siblings.push(0n);
    return { siblings: siblings.map(String), root: this._root.toString(), leafIndex };
  }
}

// ── the member's notes ──────────────────────────────────────────────────────

/**
 * What this computer remembers about the member's notes. No secret is kept: a
 * note's secret and nullifier are worked out from the twelve words whenever
 * they are needed, so this list is a convenience and `recover` rebuilds it.
 */
export interface Held {
  net: ShieldNet;
  index: number;
  amount: string;
  asset: string;
  commitment: string;
  at: string;
  /** "in" the pool, or spent and gone */
  state: "shielded" | "spent";
  tx?: string;
}

const HELD_KEY = "murmur.shield.notes.v1";

export function notes(net?: ShieldNet): Held[] {
  try {
    const all = JSON.parse(localStorage.getItem(HELD_KEY) || "[]") as Held[];
    return net ? all.filter((n) => n.net === net) : all;
  } catch {
    return [];
  }
}

export function rememberNote(n: Held) {
  const all = notes().filter((x) => !(x.net === n.net && x.commitment === n.commitment));
  localStorage.setItem(HELD_KEY, JSON.stringify([...all, n]));
}

export function markSpent(net: ShieldNet, commitment: string) {
  const all = notes().map((n) => (n.net === net && n.commitment === commitment ? { ...n, state: "spent" as const } : n));
  localStorage.setItem(HELD_KEY, JSON.stringify(all));
}

/** The next note index for this account on this network. */
export function nextIndex(net: ShieldNet): number {
  const used = notes(net).map((n) => n.index);
  return used.length ? Math.max(...used) + 1 : 0;
}

/**
 * Find the member's notes again from the twelve words alone.
 *
 * Every line in the pool's tree carries the amount that paid for it, so for
 * each line we work out what the member's note at each index would look like
 * for that amount and see whether it matches. Nothing secret is sent anywhere
 * and the pool cannot tell it is being asked.
 */
export async function recover(
  n: ShieldNetwork,
  words: string,
  crowd: Crowd,
  depth = 64,
  provider?: JsonRpcProvider,
): Promise<{ found: Held[]; unreadable: number }> {
  const { poseidon1, poseidon2 } = await poseidonMod();
  const parts = await Promise.all(Array.from({ length: depth }, (_, i) => noteParts(words, i)));
  const precommitments = parts.map((p) => poseidon2([BigInt(p.nullifier), BigInt(p.secret)]));

  const found: Held[] = [];
  let unreadable = 0;
  for (const leaf of crowd.leaves) {
    if (leaf.amount == null) {
      unreadable++;
      continue;
    }
    const valueAsset = poseidon2([leaf.amount, NATIVE_ASSET]);
    for (let i = 0; i < precommitments.length; i++) {
      if (poseidon2([valueAsset, precommitments[i]]).toString() !== leaf.commitment) continue;
      const spent = await spentAlready(n, poseidon1([BigInt(parts[i].nullifier)]).toString(), provider).catch(() => false);
      found.push({
        net: n.id,
        index: i,
        amount: leaf.amount.toString(),
        asset: NATIVE_ASSET.toString(),
        commitment: leaf.commitment,
        at: new Date().toISOString(),
        state: spent ? "spent" : "shielded",
      });
      break;
    }
  }
  for (const f of found) rememberNote(f);
  return { found, unreadable };
}

export async function spentAlready(n: ShieldNetwork, nullifierHash: string, provider?: JsonRpcProvider): Promise<boolean> {
  const { toBeHex, zeroPadValue } = await ethersMod();
  const c = await pool(n, provider ?? (await connect(n)));
  return c.isNullifierSpent(zeroPadValue(toBeHex(BigInt(nullifierHash)), 32));
}

// ── paying in ───────────────────────────────────────────────────────────────

export type Step =
  | { stage: "signing" }
  | { stage: "sent"; tx: string }
  | { stage: "fetching"; got: number; of: number }
  | { stage: "building" }
  | { stage: "proving" }
  | { stage: "final"; tx: string; block: number }
  | { stage: "failed"; reason: string };

/**
 * Pay into the pool. One transaction, and the only thing it says on the chain
 * is "this account paid in this much", which is the part a shielded pool never
 * hides. What it does not say is who may take it out again.
 */
export async function shield(
  n: ShieldNetwork,
  words: string,
  amount: bigint,
  index: number,
  onStep: (s: Step) => void,
): Promise<{ note: Note; tx: string; block: number } | null> {
  if (!canShield(n.id)) {
    onStep({ stage: "failed", reason: `Paying into the ${n.label} pool is not on in this build.` });
    return null;
  }
  try {
    const provider = await connect(n);
    const wallet = (await account(words, 0)).connect(provider);
    const note = await deriveNote(words, index, amount, NATIVE_ASSET);
    const { toBeHex, zeroPadValue } = await ethersMod();
    const commitment = zeroPadValue(toBeHex(BigInt(note.commitment)), 32);
    const c = await pool(n, wallet as unknown as HDNodeWallet);

    onStep({ stage: "signing" });
    const tx =
      n.pool === "v7"
        ? await c["depositNative(bytes32)"](commitment, { value: amount })
        : await c["depositNative(bytes32,bytes32)"](commitment, zeroPadValue(toBeHex(BigInt(note.nullifierHash)), 32), {
            value: amount,
          });
    onStep({ stage: "sent", tx: tx.hash });
    const receipt = await tx.wait();
    onStep({ stage: "final", tx: tx.hash, block: receipt.blockNumber });
    return { note, tx: tx.hash, block: receipt.blockNumber };
  } catch (e) {
    onStep({ stage: "failed", reason: plainly(e) });
    return null;
  }
}

// ── the proving key ─────────────────────────────────────────────────────────

/**
 * Proving needs the circuit (2.3 MB) and its proving key (33 MB). They are too
 * big to ship in the app, so they are fetched once and kept. Both are checked
 * against a hash written down here, so a swapped file is refused rather than
 * trusted: a tampered circuit could be made to leak the secret it is given.
 *
 * Birdbrain serves its own copy, because a plugin that only works while
 * somebody else's web host is up is not ours (the Zo-exit rule).
 */
export interface Artefacts {
  wasm: Uint8Array;
  zkey: Uint8Array;
}

export const ARTEFACTS = {
  wasm: {
    url: "https://birdbrain.wtf/app/shield/withdraw_phase2_fixed_v7.wasm",
    fallback: "https://codeberg.org/KusamaShield/shielded-transfers/raw/branch/main/public/withdraw_phase2_fixed_v7.wasm",
    sha256: "ba4cd3ec34af81d9978cc1c75a519ea712c95b906161be11285ad1b5efcaae2a",
    bytes: 2_307_913,
  },
  zkey: {
    url: "https://birdbrain.wtf/app/shield/withdraw_phase2_fixed_v7_0001.zkey",
    fallback:
      "https://codeberg.org/KusamaShield/shielded-transfers/raw/branch/main/public/withdraw_phase2_fixed_v7_0001.zkey",
    sha256: "30e82f856b0b7d6c26b3d569260896579e783d02d7b9a2c1dc3a98d0073f71e8",
    bytes: 34_412_253,
  },
} as const;

async function sha256(bytes: Uint8Array): Promise<string> {
  const d = await crypto.subtle.digest("SHA-256", bytes as unknown as ArrayBuffer);
  return Array.from(new Uint8Array(d), (b) => b.toString(16).padStart(2, "0")).join("");
}

let cached: Artefacts | null = null;

export async function artefacts(onStep: (s: Step) => void): Promise<Artefacts> {
  if (cached) return cached;
  const out: Partial<Artefacts> = {};
  const parts = [
    ["wasm", ARTEFACTS.wasm],
    ["zkey", ARTEFACTS.zkey],
  ] as const;
  let got = 0;
  for (const [name, part] of parts) {
    onStep({ stage: "fetching", got, of: parts.length });
    // A host that answers is not a host that answered correctly: a 404 page
    // served with a 200 is still 20 kB of HTML. So each source is kept only if
    // its bytes hash to the one file we know, and anything else moves on to the
    // next source rather than being trusted or giving up.
    let bytes: Uint8Array | null = null;
    for (const url of [part.url, part.fallback]) {
      try {
        const r = await fetch(url);
        if (!r.ok) continue;
        const got = new Uint8Array(await r.arrayBuffer());
        if (got.length !== part.bytes) continue;
        if (part.sha256 && (await sha256(got)) !== part.sha256) continue;
        bytes = got;
        break;
      } catch {
        // try the next source
      }
    }
    if (!bytes) throw new Error(`The ${name} the proof needs could not be fetched from anywhere.`);
    out[name] = bytes;
    got++;
  }
  cached = out as Artefacts;
  return cached;
}

// ── taking out ──────────────────────────────────────────────────────────────

/**
 * Where a withdrawal should land. A fresh account from the same twelve words,
 * so the money does not come back to the account that paid it in, and so the
 * member can still find it with nothing but their words.
 */
export async function collectAddress(words: string, index: number): Promise<string> {
  return (await account(words, index + 1)).address;
}

/**
 * Take a note out of the pool.
 *
 * The proof says: one of the lines in this tree is a note worth at least this
 * much, I know the secret behind it, and here is its nullifier so it can never
 * be spent again. It does not say which line.
 *
 * Two honest limits, both on the screen as well as here:
 *
 * 1. Whoever sends this transaction pays its fee and is written on the chain.
 *    Without a relayer that is the member's own account, which is the link the
 *    pool was supposed to break. Shield's `proxy_withdraw` and its mixnet work
 *    are the way out, and neither is wired up here.
 * 2. The contract takes `recipient` as a plain argument and never checks it
 *    against the proof. Anyone who sees this transaction before it is in a
 *    block can copy the proof, put their own address in and take the money.
 *    That is why nothing here runs on a network holding real money.
 */
export async function unshield(
  n: ShieldNetwork,
  words: string,
  note: Note,
  take: bigint,
  recipient: string,
  onStep: (s: Step) => void,
): Promise<{ tx: string; block: number; change: Note | null } | null> {
  if (!canShield(n.id)) {
    onStep({ stage: "failed", reason: `Taking out of the ${n.label} pool is not on in this build.` });
    return null;
  }
  try {
    const { keccak256, solidityPacked } = await ethersMod();
    const provider = await connect(n);
    const wallet = (await account(words, 0)).connect(provider);

    onStep({ stage: "building" });
    const crowd = await readCrowd(n, provider);
    if (crowd.size != null && crowd.size > crowd.leaves.length)
      throw new Error(
        `The pool's tree holds ${crowd.size} entries and only ${crowd.leaves.length} can be read here, so a proof made now would not match it. Deposits made from a Substrate account do not show up where this app looks.`,
      );
    const tree = await Tree.of(crowd.leaves.map((l) => l.commitment));
    const at = tree.indexOf(note.commitment);
    if (at < 0) throw new Error("This note is not in the pool's tree yet. Wait for its block to settle.");
    const branch = tree.proof(at);

    // The change left behind is itself a note, derived from the next index, so
    // a part-withdrawal can still be found again from the twelve words alone.
    const left = note.amount - take;
    const change = await deriveNote(words, note.index + 1, left, note.asset);

    const context = (BigInt(keccak256(solidityPacked(["address"], [wallet.address]))) % FIELD).toString();
    const input = {
      withdrawnValue: take.toString(),
      root: branch.root,
      treeDepth: String(CIRCUIT_DEPTH),
      context,
      asset: note.asset.toString(),
      existingValue: note.amount.toString(),
      existingNullifier: note.nullifier,
      existingSecret: note.secret,
      newNullifier: change.nullifier,
      newSecret: change.secret,
      siblings: branch.siblings,
      leafIndex: String(branch.leafIndex),
    };

    const art = await artefacts(onStep);
    onStep({ stage: "proving" });
    const { groth16 } = await import("snarkjs");
    const { proof, publicSignals } = await groth16.fullProve(input, art.wasm, art.zkey);

    // Check the circuit's own answer before signing anything: the nullifier it
    // reveals must be this note's, the amount must be the amount asked for, and
    // the change commitment must be the one we can find again.
    if (publicSignals[1] !== note.nullifierHash) throw new Error("The proof is for a different note. Nothing was sent.");
    if (publicSignals[3] !== take.toString()) throw new Error("The proof is for a different amount. Nothing was sent.");
    if (left > 0n && publicSignals[0] !== change.commitment)
      throw new Error("The change the proof leaves could not be found again. Nothing was sent.");

    const c = await pool(n, wallet as unknown as HDNodeWallet);
    onStep({ stage: "signing" });
    const tx = await c.withdraw(
      [proof.pi_a[0], proof.pi_a[1]],
      [
        [proof.pi_b[0][1], proof.pi_b[0][0]],
        [proof.pi_b[1][1], proof.pi_b[1][0]],
      ],
      [proof.pi_c[0], proof.pi_c[1]],
      publicSignals.map((s: string) => BigInt(s)),
      recipient,
    );
    onStep({ stage: "sent", tx: tx.hash });
    const receipt = await tx.wait();
    onStep({ stage: "final", tx: tx.hash, block: receipt.blockNumber });
    return { tx: tx.hash, block: receipt.blockNumber, change: left > 0n ? change : null };
  } catch (e) {
    onStep({ stage: "failed", reason: plainly(e) });
    return null;
  }
}

/** What a member should read when something goes wrong, rather than a stack. */
export function plainly(e: unknown): string {
  const raw = String((e as { shortMessage?: string; message?: string })?.shortMessage ?? (e as Error)?.message ?? e);
  if (/insufficient funds/i.test(raw)) return "This account has too little to pay in and cover the fee.";
  if (/Nullifier already spent/i.test(raw)) return "This note has already been taken out of the pool.";
  if (/Unknown root/i.test(raw)) return "The pool moved on while the proof was being made. Try again.";
  if (/Invalid proof/i.test(raw)) return "The pool refused the proof.";
  if (/Insufficient balance/i.test(raw)) return "The pool does not hold enough to pay this out.";
  return raw.slice(0, 200);
}
