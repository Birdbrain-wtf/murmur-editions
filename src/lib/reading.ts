/**
 * A chain call in plain words, read from the call itself (lib/signer.ts shows it).
 *
 * Known calls get a sentence ("Send 2 KSM to …"). Calls that can hand over an
 * account, act for someone else or change the chain are marked danger, and the
 * member must say they mean it. Anything else is named and marked "read the
 * details". Kept apart from the signer so it can be tested without the app.
 */
import type { PolkadotClient } from "polkadot-api";
import { formatAmount } from "./swap";
import { pretty, toJson } from "./runtime";

export type Risk = "low" | "check" | "danger";
export interface Reading {
  /** one line per call (a batch has several) */
  lines: { text: string; risk: Risk }[];
  risk: Risk;
  /** pallet.call of the outer call */
  name: string;
  /** the decoded call, as JSON */
  raw: string;
  callData: string;
}

export interface Props {
  symbol: string;
  decimals: number;
  ss58: number;
}
const propsCache = new WeakMap<PolkadotClient, Promise<Props>>();
export function chainProps(client: PolkadotClient): Promise<Props> {
  let p = propsCache.get(client);
  if (!p) {
    p = client.getChainSpecData().then((d) => {
      const pr = (d.properties ?? {}) as any;
      const one = (x: any) => (Array.isArray(x) ? x[0] : x);
      return { symbol: one(pr.tokenSymbol) ?? "units", decimals: Number(one(pr.tokenDecimals) ?? 12), ss58: Number(pr.ss58Format ?? 42) };
    });
    propsCache.set(client, p);
  }
  return p;
}

/** Calls that can hand over an account, act as someone else, or change the chain itself. */
const DANGER: [string, string | null][] = [
  ["Proxy", null],
  ["Multisig", null],
  ["Sudo", null],
  ["Utility", "dispatch_as"],
  ["Utility", "as_derivative"],
  ["Utility", "with_weight"],
  ["System", null],
  ["Balances", "transfer_all"],
  ["Balances", "force_transfer"],
  ["Assets", "transfer_ownership"],
  ["Assets", "set_team"],
  ["Assets", "approve_transfer"],
  ["Assets", "transfer_approved"],
  ["Recovery", null],
  ["XcmPallet", null],
  ["PolkadotXcm", null],
];
const SAFE_SYSTEM = new Set(["remark", "remark_with_event"]);
export const dangerous = (pallet: string, call: string) =>
  !(pallet === "System" && SAFE_SYSTEM.has(call)) && DANGER.some(([p, c]) => p === pallet && (c === null || c === call));

const order: Risk[] = ["low", "check", "danger"];
const worst = (a: Risk, b: Risk) => (order.indexOf(a) > order.indexOf(b) ? a : b);

export async function readCall(client: PolkadotClient, props: Props, decoded: any, callData: string): Promise<Reading> {
  const api = client.getUnsafeApi() as any;
  const addr = (a: unknown) => {
    const s = typeof a === "string" ? a : (a as any)?.value ?? String(a);
    return typeof s === "string" && s.length > 20 ? `${s.slice(0, 8)}…${s.slice(-6)}` : String(s);
  };
  const native = (v: bigint) => `${formatAmount(v, props.decimals, 6)} ${props.symbol}`;
  const asset = async (id: unknown, v: bigint) => {
    try {
      const m = await api.query.Assets.Metadata.getValue(id);
      const sym = m?.symbol ? (toJson(m.symbol) as string) : `asset ${id}`;
      return `${formatAmount(v, Number(m?.decimals ?? 0), 6)} ${sym}`;
    } catch {
      return `${v} of asset ${id}`;
    }
  };
  const location = async (loc: any, v: bigint) => {
    const inner = loc?.interior;
    if (loc?.parents === 1 && inner?.type === "Here") return native(v);
    const idx = inner?.value?.find?.((j: any) => j.type === "GeneralIndex");
    return idx ? asset(idx.value, v) : `${v} of ${JSON.stringify(toJson(loc))}`;
  };

  const lines: Reading["lines"] = [];
  const one = async (c: any, depth = 0): Promise<void> => {
    const pallet: string = c.type;
    const call: string = c.value.type;
    const a = c.value.value ?? {};
    const risk: Risk = dangerous(pallet, call) ? "danger" : "low";
    const say = (text: string, r: Risk = risk) => void lines.push({ text, risk: r });
    const key = `${pallet}.${call}`;
    if (pallet === "Utility" && ["batch", "batch_all", "force_batch"].includes(call) && depth < 3) {
      say(`${a.calls.length} calls in one go${call === "batch_all" ? ", all or none" : ""}:`, "low");
      for (const inner of a.calls) await one(inner, depth + 1);
      return;
    }
    switch (key) {
      case "Balances.transfer_keep_alive":
      case "Balances.transfer_allow_death":
        return say(`Send ${native(a.value)} to ${addr(a.dest?.value ?? a.dest)}`);
      case "Balances.transfer_all":
        return say(`Send everything this account holds to ${addr(a.dest?.value ?? a.dest)}${a.keep_alive ? "" : ", and close the account"}`, "danger");
      case "Assets.transfer":
      case "Assets.transfer_keep_alive":
        return say(`Send ${await asset(a.id, a.amount)} to ${addr(a.target?.value ?? a.target)}`);
      case "AssetConversion.swap_exact_tokens_for_tokens":
        return say(`Trade ${await location(a.path[0], a.amount_in)} through the pool for at least ${await location(a.path[a.path.length - 1], a.amount_out_min)}, paid to ${addr(a.send_to)}`);
      case "AssetConversion.swap_tokens_for_exact_tokens":
        return say(`Trade at most ${await location(a.path[0], a.amount_in_max)} through the pool for ${await location(a.path[a.path.length - 1], a.amount_out)}, paid to ${addr(a.send_to)}`);
      case "System.remark":
      case "System.remark_with_event":
        return say(`Write a note on the chain: "${String(toJson(a.remark)).slice(0, 140)}"`, "low");
      case "ConvictionVoting.vote":
        return say(`Vote on referendum ${a.poll_index}: ${JSON.stringify(toJson(a.vote))}`);
      case "ConvictionVoting.remove_vote":
        return say(`Take back your vote on referendum ${a.index}`, "low");
    }
    if (risk === "danger") say(`${key}: this can move everything the account holds, act on someone else's behalf, or change the chain itself. Read the details before you sign.`, "danger");
    else say(`${key}: the app can't put this one in plain words. Read the details before you sign.`, "check");
  };
  await one(decoded);
  return {
    lines,
    risk: lines.reduce<Risk>((r, l) => worst(r, l.risk), "low"),
    name: `${decoded.type}.${decoded.value.type}`,
    raw: pretty(decoded.value.value ?? null),
    callData,
  };
}
