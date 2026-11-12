/**
 * The chain's refusals, in plain words. Shared by the signer (lib/signer.ts) and
 * the lab scripts that sign without it (lib/swap.ts), so a member reads the same
 * sentence whichever path sent the call.
 */
const KNOWN: Record<string, string> = {
  ProvidedMinimumNotSufficientForSwap: "The price moved more than 1% before the block. Nothing was swapped. Ask for a new quote.",
  InsufficientLiquidity: "The pool does not hold enough for this swap.",
  AmountOutTooHigh: "The pool does not hold enough for this swap.",
  BalanceLow: "This account does not hold enough for this and its fee.",
  FundsUnavailable: "This account does not hold enough for this and its fee.",
  InsufficientBalance: "This account does not hold enough for this and its fee.",
  NotExpendable: "That would spend the minimum this account must keep open. Try a little less.",
  ExistentialDeposit: "That is less than the smallest amount an empty account can receive here. Send a little more.",
  BelowMinimum: "That is less than the smallest amount an empty account can receive here. Send a little more.",
  CannotCreate: "That account holds none of the network's own token, so it can't receive this asset yet. Send it a little of that first.",
  BadOrigin: "This account isn't allowed to make that call.",
  NoPermission: "This account isn't allowed to make that call.",
  CallFiltered: "This chain doesn't let ordinary accounts make that call.",
};

export function explainRefusal(err: any): string {
  const inner = err?.value?.value?.type ?? err?.value?.type ?? err?.type;
  const outer = err?.value?.type && err?.value?.value?.type ? err.value.type : null;
  if (inner && KNOWN[inner]) return KNOWN[inner];
  let raw: string;
  try {
    raw = [outer, inner].filter(Boolean).join(".") || JSON.stringify(err, (_, x) => (typeof x === "bigint" ? x.toString() : x));
  } catch {
    raw = String(err);
  }
  return `The chain refused it (${raw}).`;
}
