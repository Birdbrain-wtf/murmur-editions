/**
 * The exchange engine (src-tauri/src/exchange.rs).
 *
 * Off by default. Switched on, the app fetches the engine from birdbrain.wtf,
 * checks it against Birdbrain's release key and runs it on this computer. The
 * member's exchange wallet lives in it. Trades settle by atomic swap between two
 * members' wallets, so the market's host never holds a key or a coin.
 *
 * The page never holds the engine's password: `exchangeApi` reaches only the
 * routes the Rust side allows, and the engine uses the password cached against
 * its own session.
 */
import { useEffect, useState } from "react";

const isTauri = typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
export const hasExchange = isTauri;

/** KSM on Asset Hub, and dUSD on it, by their exchange asset ids. */
export const KSM = 434;
export const DUSD = 434001;

export interface ExchangeStatus {
  enabled: boolean;
  phase: "off" | "fetching" | "starting" | "ready" | "error";
  version?: string | null;
  network: string;
  fetchedBytes?: number | null;
  fetchTotal?: number | null;
  error?: string | null;
}

async function invoke<T>(cmd: string, args: Record<string, unknown> = {}): Promise<T> {
  const { invoke } = await import("@tauri-apps/api/core");
  return invoke<T>(cmd, args);
}

export async function exchangeStatus(): Promise<ExchangeStatus | null> {
  if (!isTauri) return null;
  return invoke<ExchangeStatus>("exchange_status");
}

export async function setExchangeEnabled(enabled: boolean): Promise<ExchangeStatus> {
  return invoke<ExchangeStatus>("exchange_set_enabled", { enabled });
}

/** One call to the engine. Throws with the engine's own message when it says no. */
export async function exchangeApi<T = any>(path: string, body?: unknown, method: "GET" | "POST" = body === undefined ? "GET" : "POST"): Promise<T> {
  const r = await invoke<any>("exchange_api", { method, path, body: body ?? null });
  if (r && r.ok === false) throw new Error(r.msg || "the exchange said no");
  return r as T;
}

export interface BookOrder {
  rate: number;
  qty: number;
  msgRate: number;
  qtyAtomic: number;
  sell: boolean;
  token: string;
}

export async function exchangeBook(host: string, base: number, quote: number): Promise<{ sells: BookOrder[] | null; buys: BookOrder[] | null }> {
  return invoke("exchange_book", { host, base, quote });
}

export function useExchange(everyMs = 2000): ExchangeStatus | null {
  const [s, setS] = useState<ExchangeStatus | null>(null);
  useEffect(() => {
    let live = true;
    const tick = () => exchangeStatus().then((v) => live && setS(v)).catch(() => {});
    tick();
    if (!isTauri) return () => { live = false; };
    const t = setInterval(tick, everyMs);
    return () => { live = false; clearInterval(t); };
  }, [everyMs]);
  return s;
}

/** The engine's view of this member: wallets, markets joined, their orders. */
export function useExchangeUser(ready: boolean, everyMs = 4000) {
  const [user, setUser] = useState<any>(null);
  const [error, setError] = useState<string | null>(null);
  const [n, setN] = useState(0);
  useEffect(() => {
    if (!ready) return;
    let live = true;
    const tick = () =>
      exchangeApi("/user")
        .then((r) => { if (live) { setUser(r.user); setError(null); } })
        .catch((e) => live && setError(String(e)));
    tick();
    const t = setInterval(tick, everyMs);
    return () => { live = false; clearInterval(t); };
  }, [ready, everyMs, n]);
  return { user, error, refresh: () => setN((x) => x + 1) };
}

/**
 * Prices on the wire are quote atoms per 10^8 base atoms. KSM's atom is 10^-9
 * (gwei) and dUSD's 10^-6, so 2 dUSD per KSM is 200,000.
 */
export function toMsgRate(price: number, baseFactor: number, quoteFactor: number, rateStep: number): number {
  const raw = Math.round((price * quoteFactor * 1e8) / baseFactor);
  return Math.max(rateStep, Math.round(raw / rateStep) * rateStep);
}

export function fromMsgRate(msgRate: number, baseFactor: number, quoteFactor: number): string {
  return ((msgRate * baseFactor) / quoteFactor / 1e8).toLocaleString(undefined, { maximumFractionDigits: 6 });
}

export const ORDER_STATUS: Record<number, string> = {
  1: "waiting for the next round",
  2: "on the book",
  3: "filled",
  4: "cancelled",
  5: "withdrawn",
};

/** Where a matched trade has got to, from this member's side. */
export const MATCH_STATUS: Record<number, string> = {
  0: "matched",
  1: "first payment locked",
  2: "both payments locked",
  3: "first side collected",
  4: "both sides collected",
  5: "settled",
};
