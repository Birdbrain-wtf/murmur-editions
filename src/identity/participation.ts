import { useSyncExternalStore } from "react";
import { edition } from "../edition";
import { appSecret } from "../lib/secrets";
import { openInBrowser } from "./passkey";

/**
 * Participation: one signed check-in that every plugin shares (ADR 0069).
 *
 * The app's session says who you are and never what you did, so it cannot be
 * the evidence that you were in a call or a chat. A check-in is signed by a
 * participation key instead: an Ed25519 key made on this device, approved once
 * with a passkey tap in the browser, good for a few hours, and only able to say
 * "I took part in this session". It cannot spend, vote or touch the chain.
 *
 * Plugins never handle the key. They call `participate(kind, session)` with a
 * session id that names its context, e.g. `meet:chaos-sessions@2026-10-06` or
 * `chat:!room:decent.partners@2026-10-06`. The collective is not theirs to say:
 * the door fills it in from the app that holds the session.
 *
 * The private key sits in the system's secure store, never in localStorage.
 * Only the grant (which is public: it is in the evidence ledger) lives there.
 *
 * Server side: /app/pair/grant-* and /app/pair/participate in
 * infra/services/chaos-auth/server.ts.
 */
// ask: a plugin ask (ADR 0078, host/Asks.tsx). Its session is ask:<hash of the
// ask>, so the check-in is the member's signature over what they asked for.
// access: a proposed change to who can use what (lib/access.ts), the same shape.
// share: a note the member chose to give the collective (lib/share.ts).
export type Kind = "meet" | "chat" | "place" | "ask" | "access" | "share" | "invite";

export interface Grant {
  id: string;
  userId: string;
  collective: string;
  key: string;
  exp: number;
}

export interface CheckIn {
  kind: Kind;
  session: string;
  at: number;
  ok: boolean;
}

export type Outcome =
  | { status: "recorded" | "already" }
  | { status: "needs-approval" }
  | { status: "unsupported" }
  | { status: "failed"; error: string };

const GRANT_KEY = "murmur.participation.grant.v1";
const LOG_KEY = "murmur.participation.log.v1";
const SECRET = "participation.key";

export const supported = !!edition.signIn.grant;

// ── a tiny store, so the Identity panel and plugins see the same state ──────

let grant: Grant | null = readGrant();
let log: CheckIn[] = readLog();
let approving = false;
const listeners = new Set<() => void>();
let snapshot = { grant, log, approving };
function emit() {
  snapshot = { grant, log, approving };
  for (const l of listeners) l();
}
function readGrant(): Grant | null {
  try {
    const g = JSON.parse(localStorage.getItem(GRANT_KEY) || "null") as Grant | null;
    return g && g.exp > Date.now() / 1000 ? g : null;
  } catch {
    return null;
  }
}
function readLog(): CheckIn[] {
  try {
    return JSON.parse(localStorage.getItem(LOG_KEY) || "[]");
  } catch {
    return [];
  }
}
function setGrant(g: Grant | null) {
  grant = g;
  if (g) localStorage.setItem(GRANT_KEY, JSON.stringify(g));
  else localStorage.removeItem(GRANT_KEY);
  emit();
}
function remember(c: CheckIn) {
  log = [c, ...log.filter((x) => x.session !== c.session)].slice(0, 20);
  localStorage.setItem(LOG_KEY, JSON.stringify(log));
  emit();
}

export function useParticipation() {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => snapshot,
  );
}

// ── the key ─────────────────────────────────────────────────────────────────

const b64u = (buf: ArrayBuffer | Uint8Array) =>
  btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const fromB64u = (s: string) => Uint8Array.from(atob(s.replace(/-/g, "+").replace(/_/g, "/")), (c) => c.charCodeAt(0));

async function freshKey(): Promise<{ pub: string }> {
  const pair = (await crypto.subtle.generateKey({ name: "Ed25519" }, true, ["sign", "verify"])) as CryptoKeyPair;
  const pkcs8 = await crypto.subtle.exportKey("pkcs8", pair.privateKey);
  const pub = b64u(await crypto.subtle.exportKey("raw", pair.publicKey));
  await appSecret.set(SECRET, JSON.stringify({ pkcs8: b64u(pkcs8), pub }));
  return { pub };
}

async function signWith(message: string): Promise<string | null> {
  const raw = await appSecret.get(SECRET);
  if (!raw) return null;
  const { pkcs8 } = JSON.parse(raw);
  const key = await crypto.subtle.importKey("pkcs8", fromB64u(pkcs8), { name: "Ed25519" }, false, ["sign"]);
  return b64u(await crypto.subtle.sign({ name: "Ed25519" }, key, new TextEncoder().encode(message)));
}

async function post(path: string, body: unknown) {
  const r = await fetch(`${edition.signIn.pair}/${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify(body),
  });
  const j = await r.json().catch(() => ({}));
  return { status: r.status, ...j };
}

// ── approval: one passkey tap in the browser ────────────────────────────────

/** Make a fresh key, open the door's approval page, and wait for the tap. */
export async function approve(session: string): Promise<void> {
  if (!supported || approving) return;
  approving = true;
  setGrant(null);
  try {
    const { pub } = await freshKey();
    const start = await post("grant-start", { session, key: pub });
    if (!start.code) throw new Error(start.error || "Could not start the approval.");
    await openInBrowser(edition.signIn.grant + encodeURIComponent(start.code));
    const deadline = Date.now() + (Number(start.expiresIn) || 600) * 1000;
    while (Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 2000));
      const r = await post("grant-poll", { code: start.code, secret: start.secret }).catch(() => null);
      if (r?.status === "approved" && r.grant) {
        setGrant({ id: r.grant.id, userId: r.grant.userId, collective: r.grant.collective, key: r.grant.key, exp: r.grant.exp });
        return;
      }
      if (r?.status === "expired") break;
    }
    throw new Error("The approval timed out. Try again.");
  } finally {
    approving = false;
    emit();
  }
}

/** Switch check-ins off: the door revokes the grant and the key is deleted. */
export async function revoke(session: string | null | undefined): Promise<void> {
  const g = grant;
  setGrant(null);
  await appSecret.delete(SECRET).catch(() => {});
  if (g && session) await post("grant-revoke", { session, grantId: g.id }).catch(() => {});
}

// ── the one call plugins make ───────────────────────────────────────────────

/** London date, so a session id means the same day to everyone in the room. */
export function today(): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/London" }).format(new Date());
}

export async function participate(kind: Kind, session: string, code?: string): Promise<Outcome> {
  if (!supported) return { status: "unsupported" };
  const g = grant && grant.exp > Date.now() / 1000 + 30 ? grant : null;
  if (!g) {
    if (grant) setGrant(null);
    return { status: "needs-approval" };
  }
  const at = Math.floor(Date.now() / 1000);
  const message = ["decent/participate/v1", g.collective, kind, session, String(at), g.id, ...(code ? [`anchor:${code}`] : [])].join("\n");
  try {
    const sig = await signWith(message);
    if (!sig) {
      setGrant(null);
      return { status: "needs-approval" };
    }
    const r = await post("participate", { grantId: g.id, kind, session, at, sig, ...(code ? { code } : {}) });
    if (r.regrant) {
      setGrant(null);
      return { status: "needs-approval" };
    }
    if (!r.ok) {
      remember({ kind, session, at, ok: false });
      return { status: "failed", error: r.error || `The door answered ${r.status}` };
    }
    remember({ kind, session, at, ok: true });
    return { status: r.already ? "already" : "recorded" };
  } catch (e: any) {
    return { status: "failed", error: e?.message || "Could not reach the door." };
  }
}

// ── places (ADR 0070) ───────────────────────────────────────────────────────
//
// A place is checked into like a call. The session is the venue's H3 cell on a
// day, and the evidence is the six-character code on the steward's screen, which
// changes every minute. No location is read from this device: the code says
// where you are, and only the venue's cell is ever recorded.

export const PLACE_STEP = 60;

function liveGrant(): Grant | null {
  return grant && grant.exp > Date.now() / 1000 + 30 ? grant : null;
}

/** The live participation key's id, for a collective's server to look its check-in up at the door. */
export const liveGrantId = (): string | null => liveGrant()?.id ?? null;

/** The places this member stewards, if any. */
export async function stewardPlaces(): Promise<{ cell: string; name: string }[]> {
  const g = liveGrant();
  if (!g) return [];
  const r = await post("place-steward", { grantId: g.id }).catch(() => null);
  return Array.isArray(r?.cells) ? r.cells : [];
}

// Sorted-key JSON of the flat anchor: the bytes lab/hex-presence verifies.
const anchorBytes = (o: Record<string, string | number>) =>
  "{" + Object.keys(o).sort().map((k) => JSON.stringify(k) + ":" + JSON.stringify(o[k])).join(",") + "}";

/** Steward side: sign this minute's anchor and put its code on the screen. */
export async function publishAnchor(cell: string): Promise<{ code: string; window: number } | { error: string }> {
  const g = liveGrant();
  if (!g) return { error: "Check-ins are off. Turn them on in Identity." };
  const window = Math.floor(Date.now() / 1000 / PLACE_STEP);
  const body = { type: "venue-anchor:v1", steward: `pgrant:${g.id}`, cell, window, step: PLACE_STEP };
  const sig = await signWith(anchorBytes(body));
  if (!sig) return { error: "This computer has lost its check-in key. Turn check-ins on again." };
  const r = await post("anchor", { grantId: g.id, anchor: { ...body, proof: { stamp_types: "hexclaim:v2", sig } } }).catch(() => null);
  return r?.ok ? { code: r.code, window } : { error: r?.error || "Could not reach the door." };
}

/** Member side: type the code on the screen, get checked in to that place today. */
export async function checkInAtPlace(code: string): Promise<Outcome & { name?: string }> {
  const g = liveGrant();
  if (!g) return { status: supported ? "needs-approval" : "unsupported" };
  const found = await post("place-lookup", { grantId: g.id, code }).catch(() => null);
  if (!found?.cell) return { status: "failed", error: found?.error || "Could not reach the door." };
  const out = await participate("place", `place:${found.cell}@${today()}`, found.code);
  return { ...out, name: found.name };
}
