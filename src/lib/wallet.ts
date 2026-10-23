/**
 * Decent Pay client — talks to the Bloque-backed wallet proxy on the Decent
 * space. The enterprise API key lives server-side in the proxy routes
 * (/api/wallet/*); the client never sees it.
 *
 *   POST /api/wallet/balance       { alias }       -> { accounts }  (read-only)
 *   POST /api/wallet/init          { alias }       -> { accounts }  (creates a
 *                                    virtual pocket + card if none exist yet)
 *   POST /api/wallet/transactions  { accountUrn }  -> { transactions }
 *
 * `base` is the Decent space origin — "" in dev (Vite proxies /api/wallet), the
 * zo.space origin in a Tauri build (same origin birdbrain uses).
 */

export interface CardDetails {
  /** Pomelo secure-data iframe URL rendering the live card face (short-lived). */
  card_url_details?: string;
  card_last_four?: string;
  card_provider?: string;
  card_status?: string;
  card_type?: string;
  [k: string]: unknown;
}

export interface WalletAccount {
  urn?: string;
  name?: string;
  type?: string;
  medium?: string;
  balance?: number | string | Record<string, unknown>;
  currency?: string;
  ledgerId?: string;
  ledger_account_id?: string;
  /** Bloque card-medium fields (PAN last four, provider, secure-face URL). */
  details?: CardDetails;
  /** Bloque account metadata — carries name + the card's default spend asset. */
  metadata?: { name?: string; default_asset?: string; [k: string]: unknown };
  [k: string]: unknown;
}

/** Fresh card-face details for the reveal flow (re-fetched per reveal). */
export interface CardFace {
  cardUrl?: string | null;
  lastFour?: string | null;
  provider?: string | null;
  status?: string | null;
  cardType?: string | null;
}

export interface WalletTx {
  id?: string;
  amount?: number | string;
  currency?: string;
  direction?: string;
  description?: string;
  createdAt?: string;
  status?: string;
  [k: string]: unknown;
}

/** What Bloque still needs before it will hold money for this alias. */
export interface WalletVerification {
  level: number;
  reason: "tos" | "verification";
  missing: string[];
  pending: string[];
  /** Bloque's hosted terms page, when it would open one. */
  url: string | null;
  /** True when Bloque said to try again later. */
  retryable: boolean;
}

export class WalletVerificationError extends Error {
  constructor(message: string, readonly verification: WalletVerification) {
    super(message);
  }
}

async function post<T>(base: string, path: string, body: unknown): Promise<T> {
  const res = await fetch(`${base}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify(body),
  });
  const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (data.verification) {
    throw new WalletVerificationError(
      (data.error as string) || "verification needed",
      data.verification as WalletVerification,
    );
  }
  if (!res.ok || data.error) {
    throw new Error((data.error as string) || `wallet ${res.status}`);
  }
  return data as T;
}

export function walletBalance(base: string, alias: string): Promise<WalletAccount[]> {
  return post<{ accounts?: WalletAccount[] }>(base, "/api/wallet/balance", {
    alias,
  }).then((d) => d.accounts ?? []);
}

export function walletInit(base: string, alias: string): Promise<WalletAccount[]> {
  return post<{ accounts?: WalletAccount[] }>(base, "/api/wallet/init", {
    alias,
  }).then((d) => d.accounts ?? []);
}

export function walletTransactions(
  base: string,
  accountUrn: string,
): Promise<WalletTx[]> {
  return post<{ transactions?: WalletTx[] }>(base, "/api/wallet/transactions", {
    accountUrn,
  }).then((d) => d.transactions ?? []);
}

/** Re-fetches a fresh secure card-face URL (the Pomelo JWT expires ~15 min). */
export function walletCard(
  base: string,
  alias: string,
  accountUrn?: string,
): Promise<CardFace> {
  return post<CardFace>(base, "/api/wallet/card", { alias, accountUrn });
}

/** True when this account is a card medium. */
export function isCardAccount(a: WalletAccount): boolean {
  return String(a.medium ?? a.type ?? "").toLowerCase().includes("card");
}

/** Pulls the card display fields (last four, provider, secure-face URL). */
export function cardInfo(a: WalletAccount): CardDetails | null {
  const d = a.details;
  if (!d || typeof d !== "object") return isCardAccount(a) ? {} : null;
  return d;
}

/** Display name from metadata.name (falls back to a.name). */
export function accountName(a: WalletAccount): string {
  if (a.metadata && typeof a.metadata === "object" && a.metadata.name) {
    return String(a.metadata.name);
  }
  return a.name ? String(a.name) : "";
}

function assetSymbol(asset: string): string {
  return asset.replace(/\/\d+$/, "");
}

function defaultAsset(a: WalletAccount): string | undefined {
  const m = a.metadata;
  if (m && typeof m === "object") {
    const v = (m as Record<string, unknown>).default_asset;
    if (typeof v === "string" && v) return v;
  }
  return undefined;
}

/** Best-effort id extraction across the uncertain Bloque account shape. */
export function accountUrn(a: WalletAccount): string | undefined {
  const v = a.urn ?? a.accountUrn ?? a.ledgerId ?? a.ledger_account_id ?? a.id;
  return v == null ? undefined : String(v);
}

/**
 * Best-effort balance extraction — Bloque's shape may evolve.
 *
 * Bloque returns a per-asset balance map, e.g. `{ "KSM/12": { current: "0" } }`.
 * The underlying Decent ledger account is denominated in KSM, but a card
 * declares its intended spend currency in `metadata.default_asset` (e.g.
 * "DUSD/6"). We prefer that denomination so a Decent stablecoin card reads in
 * DUSD even before the ledger holds a DUSD entry — both are currently zero, so
 * this changes the label, not any real amount.
 */
export function accountBalance(a: WalletAccount): string | null {
  const direct = a.balance ?? a.available ?? a.amount;
  if (direct != null && (typeof direct !== "object" || Array.isArray(direct))) {
    return String(direct);
  }
  if (direct && typeof direct === "object" && !Array.isArray(direct)) {
    const map = direct as Record<string, unknown>;
    const readCurrent = (asset: string): string | undefined => {
      const entry = map[asset];
      if (entry && typeof entry === "object") {
        const cur = (entry as Record<string, unknown>).current;
        return cur == null ? undefined : String(cur);
      }
      return undefined;
    };

    // 1. An explicit card denomination (metadata.default_asset) always wins.
    const preferred = defaultAsset(a);
    if (preferred) {
      return `${readCurrent(preferred) ?? "0"} ${assetSymbol(preferred)}`;
    }
    // 2. No explicit denomination: a Decent card/pocket reads in DUSD. Prefer a
    //    DUSD balance entry; else surface any asset that actually holds funds so
    //    a real (e.g. KSM) balance is never hidden; else show the zero in DUSD
    //    rather than the raw ledger key.
    const dusdKey = Object.keys(map).find((k) => assetSymbol(k) === "DUSD");
    if (dusdKey) return `${readCurrent(dusdKey) ?? "0"} DUSD`;
    for (const [asset, value] of Object.entries(map)) {
      if (!value || typeof value !== "object") continue;
      const current = (value as Record<string, unknown>).current;
      if (current != null && Number(current) !== 0) {
        return `${current} ${assetSymbol(asset)}`;
      }
    }
    return "0 DUSD";
  }
  const balances = a.balances;
  if (Array.isArray(balances) && balances.length) {
    const b = balances[0] as Record<string, unknown>;
    const amt = b?.amount ?? b?.balance;
    if (amt != null) return `${amt}${b?.asset ? " " + String(b.asset) : ""}`;
  }
  return null;
}
