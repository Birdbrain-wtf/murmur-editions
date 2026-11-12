/**
 * The app's signer: the one place a chain call is signed (ADR 0080, step 4).
 *
 * A plugin never holds the member's key. It builds a call and asks:
 *
 *   const r = await requestSign({ plugin: "swap", chain: "paseo", tx }, onProgress);
 *
 * The app then
 *  1. checks the plugin said, in its own declaration (`signs` in host/types.ts),
 *     that it signs on this chain, and that this chain may be signed on at all;
 *  2. turns the call into bytes and decodes those same bytes again, so what the
 *     member reads is what gets signed, whatever the plugin says about it;
 *  3. shows it in plain words, with the fee and the raw call, on a screen the
 *     app draws (host/SignSheet.tsx);
 *  4. reads the key from the secure store only after the member says yes, signs,
 *     sends, and reports each step until the block is final.
 *
 * Approval is this screen, not a passkey: a passkey signs for a website, and the
 * account here is a sr25519 key made from the member's words (./account.ts).
 */
import { useSyncExternalStore } from "react";
import { Binary, type PolkadotClient } from "polkadot-api";
import { hubClient, type Chain } from "./hub";
import { accountKey, signingKeyFor } from "./account";
import { REAL_MONEY, addressFor, formatAmount } from "./swap";
import { explainRefusal } from "./refusals";
import { chainProps, readCall, type Reading } from "./reading";

export { chainProps };
export type { Reading, Risk } from "./reading";

/** Where a key may sign. The test network always; anything holding real money only when REAL_MONEY is on. */
export const signable = (chain: Chain) => chain === "paseo" || REAL_MONEY;

export const CHAIN_LABEL: Record<Chain, string> = {
  paseo: "Asset Hub, test network",
  kusama: "Asset Hub (KSM)",
  kreivo: "Kreivo",
};

export interface SignRequest {
  /** the asking plugin's id; it must list `chain` in its `signs` */
  plugin: string;
  chain: Chain;
  /** a polkadot-api transaction built on `hubClient(chain)` */
  tx: { getEncodedData(): Promise<Binary> };
  /** pay the fee in this asset (Asset Hub's ChargeAssetTxPayment), the only option a plugin may set */
  feeAsset?: unknown;
  /** the plugin's own line about it, shown below the app's reading and labelled as the plugin's */
  why?: string;
}

export type SignProgress =
  | { stage: "waiting" }
  | { stage: "declined" }
  | { stage: "signing" }
  | { stage: "sent" }
  | { stage: "in-block"; block: string }
  | { stage: "final"; block: string; number: number; index: number; events: any[] }
  | { stage: "failed"; reason: string; block?: string };

export interface Pending {
  id: number;
  request: SignRequest;
  plugin: { id: string; title: string };
  from: string;
  reading: Reading | null;
  fee: string | null;
  problem: string | null;
}

// ── the queue the sheet draws ───────────────────────────────────────────────

let current: Pending | null = null;
let decide: ((yes: boolean) => void) | null = null;
const listeners = new Set<() => void>();
const set = (p: Pending | null) => {
  current = p;
  listeners.forEach((f) => f());
};
export const usePendingSign = () =>
  useSyncExternalStore(
    (f) => (listeners.add(f), () => void listeners.delete(f)),
    () => current,
  );
export function answer(yes: boolean) {
  const d = decide;
  decide = null;
  d?.(yes);
}

let seq = 0;
let busy: Promise<unknown> = Promise.resolve();

/**
 * Ask the member to sign `request.tx`. Settles when the block is final, the call
 * fails, or the member says no. One request at a time: a second waits its turn.
 */
export function requestSign(request: SignRequest, onProgress: (p: SignProgress) => void = () => {}): Promise<SignProgress> {
  const run = busy.then(() => sign(request, onProgress));
  busy = run.catch(() => {});
  return run;
}

async function sign(request: SignRequest, onProgress: (p: SignProgress) => void): Promise<SignProgress> {
  const fail = (reason: string): SignProgress => {
    const p: SignProgress = { stage: "failed", reason };
    onProgress(p);
    return p;
  };
  const { getModule } = await import("../host/registry");
  const mod = getModule(request.plugin);
  if (!mod) return fail(`No plugin called ${request.plugin} is installed.`);
  if (!mod.signs?.includes(request.chain)) return fail(`${mod.title} didn't say it signs on ${CHAIN_LABEL[request.chain]}, so the app won't sign for it there.`);
  if (!signable(request.chain)) return fail(`Signing on ${CHAIN_LABEL[request.chain]} is switched off in this build. Only the test network can be signed on for now.`);
  const publicKey = accountKey();
  if (!publicKey) return fail("There's no account on this computer yet. Make one, or restore it from your words.");

  const client = await hubClient(request.chain);
  const props = await chainProps(client);
  const from = addressFor(publicKey, { ss58: props.ss58 } as any);
  const options = request.feeAsset ? { asset: request.feeAsset } : undefined;

  onProgress({ stage: "waiting" });
  const id = ++seq;
  const pending: Pending = { id, request, plugin: { id: mod.id, title: mod.title }, from, reading: null, fee: null, problem: null };
  set(pending);

  // Decode the very bytes that will be signed.
  let tx: any;
  try {
    const callData = await request.tx.getEncodedData();
    tx = await (client.getUnsafeApi() as any).txFromCallData(callData);
    const reading = await readCall(client, props, tx.decodedCall, callData.asHex());
    set({ ...(current?.id === id ? current : pending), reading });
    tx.getEstimatedFees(from, options)
      .then((f: bigint) => current?.id === id && set({ ...current, fee: `${formatAmount(f, props.decimals, 6)} ${props.symbol}${request.feeAsset ? ", paid in the other asset" : ""}` }))
      .catch((e: any) => current?.id === id && set({ ...current, problem: `The chain won't price this call: ${e?.message ?? e}. It would probably fail.` }));
  } catch (e: any) {
    set({ ...pending, problem: `The app couldn't read this call, so it won't sign it: ${e?.message ?? e}` });
  }

  const yes = await new Promise<boolean>((resolve) => (decide = resolve));
  set(null);
  if (!yes || !tx) {
    const p: SignProgress = { stage: "declined" };
    onProgress(p);
    return p;
  }

  let key: Awaited<ReturnType<typeof signingKeyFor>>;
  try {
    key = await signingKeyFor(publicKey);
  } catch (e: any) {
    return fail(e.message);
  }
  onProgress({ stage: "signing" });
  return new Promise((resolve) => {
    const done = (p: SignProgress) => {
      onProgress(p);
      resolve(p);
      sub?.unsubscribe();
    };
    let sub: { unsubscribe(): void } | null = null;
    sub = tx.signSubmitAndWatch(key.signer, options).subscribe({
      next: (e: any) => {
        if (e.type === "broadcasted") onProgress({ stage: "sent" });
        if (e.type === "txBestBlocksState" && e.found) onProgress({ stage: "in-block", block: e.block.hash });
        if (e.type === "finalized") {
          if (!e.ok) done({ stage: "failed", reason: refusal(e.dispatchError), block: e.block.hash });
          else done({ stage: "final", block: e.block.hash, number: e.block.number, index: e.block.index, events: e.events });
        }
      },
      error: (err: unknown) => done({ stage: "failed", reason: String((err as Error)?.message ?? err) }),
    });
  });
}

/** The chain's refusal, in plain words where the app knows it (./refusals.ts). */
export const refusal = explainRefusal;

