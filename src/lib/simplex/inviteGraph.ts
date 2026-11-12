// Copy of lab/simplex-comms/client/inviteGraph.ts, which stays the source of
// truth (its inviteIdOf() must match /api/murmur/invite byte for byte). Change it
// there first, then copy it here. One addition: httpInviteSink takes an optional
// fetch, because the desktop app posts through Rust (the route sends no CORS
// headers, so a fetch from the window would be refused).

/**
 * inviteGraph.ts — bind a SimpleX connection to a Decent invite-graph edge.
 *
 * THE PROBLEM. SimpleX deliberately has no protocol-level identity: a one-time
 * invitation link is anonymous transport, and `contactConnected` tells you a
 * contact appeared but not *who* (in Decent terms) they are. The Decent invite
 * graph (`/api/murmur/invite`, lifecycle mint → open → claim) is keyed on
 * passkey identities — exactly the relational data the Kabocha model compensates.
 * So the transport can't complete the edge on its own; the app layer must.
 *
 * THE BRIDGE. A SimpleX invitation link is one edge. We map it:
 *   • mint  — the inviter mints `/connect`; we know the inviter (our passkey) and
 *             the link, so we POST `mint` immediately.
 *   • claim — once the contact connects, the two clients exchange a small
 *             *Decent hello* over the now-established SimpleX channel (each side
 *             sends its passkey handle/DID). On receiving the peer's hello the
 *             INVITER posts `claim`, binding the invitee's identity to the edge.
 * (SimpleX edges skip `open` — that's a /join-web-page concept; status goes
 * minted → claimed.)
 *
 * AUTHORITY. The inviter is the authoritative ledger writer for a SimpleX edge:
 * only it holds the full mint payload, so only it can reproduce the deterministic
 * `inviteId`. The invitee contributes solely its identity, via the hello.
 *
 * TRUST (2026-10-16). The hello itself proves nothing; the check-ins do. Both
 * sides make a signed participation check-in (ADR 0069, kind "chat") into the
 * session `chat:simplex:<inviteId>`: the inviter when it mints, the invitee when
 * the inviter's hello hands it the session. The claim names the collective, and
 * `/api/murmur/invite` re-verifies both check-ins from the participation ledger
 * before it marks the edge `verified`, taking both identities from the ledger
 * rather than from anything either client said. A claim without them is still
 * recorded, unverified, as before.
 *
 * Browser/Tauri-friendly: uses only global `crypto.subtle` and `fetch` (present
 * in the Tauri webview and in bun). No node-only imports.
 */

/** A Decent participant as the app layer knows them (not the SimpleX transport). */
export interface DecentIdentity {
  /** Kreivo/passkey DID — the durable identity. Null until signed-in. */
  did: string | null;
  /** Human handle (display name). */
  handle: string;
}

/**
 * The invite payload. Shape + the canonical fields below MUST stay in sync with
 * the `/api/murmur/invite` route's `inviteIdOf()` — they form the shared
 * deterministic-edge contract, so the same invite always maps to the same id no
 * matter which side logs the event.
 */
export interface InvitePayload {
  v: number;
  from: string | null; // inviter handle
  fromDid: string | null; // inviter passkey DID
  inst: { slug: string; name?: string };
  room?: string | null;
  community?: string | null;
  /** "simplex:<token>" — folds the transport edge into the stable id. */
  note?: string | null;
  ts: number;
}

async function sha256hex(s: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** Stable short token for a SimpleX invitation link (a one-time link == one edge). */
export async function simplexInviteToken(link: string): Promise<string> {
  return (await sha256hex(link)).slice(0, 12);
}

/**
 * Build the mint/claim payload for a SimpleX invitation. The link is folded into
 * `note` as `simplex:<token>` so the deterministic `inviteId` is unique per link
 * and reproducible by the inviter on both the mint and the later claim.
 */
export async function buildSimplexPayload(opts: {
  link: string;
  inviter: DecentIdentity;
  slug: string;
  name?: string;
  community?: string | null;
  ts?: number;
}): Promise<InvitePayload> {
  return {
    v: 1,
    from: opts.inviter.handle ?? null,
    fromDid: opts.inviter.did ?? null,
    inst: { slug: opts.slug, name: opts.name },
    room: null,
    community: opts.community ?? null,
    note: `simplex:${await simplexInviteToken(opts.link)}`,
    ts: opts.ts ?? Date.now(),
  };
}

/**
 * Deterministic edge id. MUST match `/api/murmur/invite`'s `inviteIdOf()`
 * byte-for-byte (same fields, same key order, sha256 → first 16 hex chars).
 */
export async function inviteIdOf(p: InvitePayload): Promise<string> {
  const canon = JSON.stringify({
    from: p.from ?? null,
    fromDid: p.fromDid ?? null,
    inst: p.inst?.slug ?? null,
    room: p.room ?? null,
    community: p.community ?? null,
    note: p.note ?? null,
    ts: p.ts ?? null,
  });
  return (await sha256hex(canon)).slice(0, 16);
}

// ── The in-band Decent identity hello ────────────────────────────────────────
// The first messages exchanged after a SimpleX contact connects. Control-prefixed
// so a client can tell a hello from a user-typed chat line and not render it.

export const DECENT_HELLO_PREFIX = "decent.hello ";

/** The participation session both sides check into for one SimpleX invite. */
export function simplexSession(inviteId: string): string {
  return `chat:simplex:${inviteId}`;
}

export interface DecentHello extends DecentIdentity {
  /** Inviter → invitee: the session to check into. Absent on the invitee's reply. */
  session?: string | null;
  /** Invitee → inviter: whether its check-in into that session was recorded. */
  checkedIn?: boolean;
}

export function encodeDecentHello(
  id: DecentIdentity,
  extra: { session?: string | null; checkedIn?: boolean } = {},
): string {
  const hello: DecentHello = { did: id.did, handle: id.handle, ...extra };
  return DECENT_HELLO_PREFIX + JSON.stringify(hello);
}

/** Parse a chat line as a Decent hello, or null if it isn't one. */
export function decodeDecentHello(text: string): DecentHello | null {
  if (!text.startsWith(DECENT_HELLO_PREFIX)) return null;
  try {
    const o = JSON.parse(text.slice(DECENT_HELLO_PREFIX.length));
    if (typeof o?.handle !== "string") return null;
    const session = typeof o.session === "string" && /^chat:simplex:[0-9a-f]{16}$/.test(o.session) ? o.session : null;
    return { did: o.did ?? null, handle: o.handle, session, checkedIn: o.checkedIn === true };
  } catch {
    return null;
  }
}

// ── Event sinks ──────────────────────────────────────────────────────────────

export type InviteEvent =
  | { type: "mint"; payload: InvitePayload }
  | { type: "open"; payload: InvitePayload; ua?: string }
  | {
      type: "claim";
      payload: InvitePayload;
      to?: string | null;
      toDid?: string | null;
      /** Collective whose participation ledger holds both check-ins (e.g. "birdbrain"). */
      collective?: string | null;
    };

export interface InviteResult {
  ok: boolean;
  inviteId: string;
  deduped?: boolean;
  /** Set on a claim the route could prove from the participation ledger. */
  verified?: { fromUserId: string; toUserId: string } | null;
}

export type InviteSink = (ev: InviteEvent) => Promise<InviteResult>;

/**
 * Production sink: POST the event to the live `/api/murmur/invite` route, which
 * computes the inviteId server-side and appends to the shared ledger.
 */
export function httpInviteSink(baseUrl: string, fetchImpl: typeof fetch = fetch): InviteSink {
  const url = baseUrl.replace(/\/$/, "") + "/api/murmur/invite";
  return async (ev) => {
    const body: Record<string, unknown> = { type: ev.type, payload: ev.payload };
    if (ev.type === "claim") {
      body.to = ev.to ?? null;
      body.toDid = ev.toDid ?? null;
      if (ev.collective) body.collective = ev.collective;
    }
    if (ev.type === "open" && ev.ua) body.ua = ev.ua;
    const res = await fetchImpl(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    const j = (await res.json().catch(() => ({}))) as any;
    if (!res.ok || j?.error) {
      throw new Error(`invite sink: ${res.status} ${j?.error ?? ""}`.trim());
    }
    return { ok: true, inviteId: j.inviteId, deduped: !!j.deduped, verified: j.verified ?? null };
  };
}
