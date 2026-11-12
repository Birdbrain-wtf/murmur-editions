/**
 * collab — where the Decent app reaches the Yjs relay (the `y-collab` service).
 *
 * Same engine relay.md uses (Yjs CRDT over a websocket), self-hosted + MIT.
 * Each shared note is one Yjs document == one room; clients in the same room
 * converge to the same text.
 *
 * - Production (Tauri build): set VITE_COLLAB_URL to the public wss endpoint.
 * - Dev: default to the same origin under /yjs, which Vite proxies to the
 *   local relay on 127.0.0.1:52790 (see vite.config.ts) — so the browser never
 *   touches CORS and there's nothing to configure.
 */
export function collabServerUrl(): string {
  const override = import.meta.env.VITE_COLLAB_URL;
  if (override) return override.replace(/\/+$/, "");
  const proto = location.protocol === "https:" ? "wss" : "ws";
  return `${proto}://${location.host}/yjs`;
}

/** A stable, readable colour for a peer's cursor, derived from their name. */
export function peerColor(seed: string): string {
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) % 360;
  return `hsl(${h} 70% 45%)`;
}

/**
 * End-to-end encryption for shared notes.
 *
 * The room name two people both type IS the shared secret. From it we derive
 * (a) an AES-GCM key the relay never sees, and (b) a routing room-id that is
 * just a hash of the name — so the relay routes blobs without ever learning the
 * name or the content. The relay is blind: it shuttles + stores ciphertext only.
 *
 * Security model: the note is exactly as private as the name is hard to guess.
 * A low-entropy name ("notes") is brute-forceable; treat the name as a
 * passphrase. (Future: carry a random key in the invite link for high entropy.)
 */
const enc = new TextEncoder();

export async function deriveRoomKey(secret: string): Promise<CryptoKey> {
  const baseKey = await crypto.subtle.importKey(
    "raw",
    enc.encode(secret),
    "PBKDF2",
    false,
    ["deriveKey"],
  );
  return crypto.subtle.deriveKey(
    {
      name: "PBKDF2",
      salt: enc.encode("decent-shared-notes-key-v1"),
      iterations: 100_000,
      hash: "SHA-256",
    },
    baseKey,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"],
  );
}

/** Routing id the relay sees: a hash of the name, never the name itself. */
export async function roomIdFor(secret: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    enc.encode("decent-shared-notes-room-v1:" + secret),
  );
  return Array.from(new Uint8Array(digest), (b) =>
    b.toString(16).padStart(2, "0"),
  ).join("");
}

/** AES-GCM encrypt → 12-byte IV prepended to the ciphertext. */
export async function encryptBytes(
  key: CryptoKey,
  data: Uint8Array,
): Promise<Uint8Array> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = new Uint8Array(
    await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, data as BufferSource),
  );
  const out = new Uint8Array(iv.length + ct.length);
  out.set(iv, 0);
  out.set(ct, iv.length);
  return out;
}

export async function decryptBytes(
  key: CryptoKey,
  blob: Uint8Array,
): Promise<Uint8Array> {
  const iv = blob.subarray(0, 12);
  const ct = blob.subarray(12);
  return new Uint8Array(
    await crypto.subtle.decrypt(
      { name: "AES-GCM", iv: iv as BufferSource },
      key,
      ct as BufferSource,
    ),
  );
}
