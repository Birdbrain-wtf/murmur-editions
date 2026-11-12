import { edition } from "../edition";
import { liveGrantId, participate } from "../identity/participation";

/**
 * Sharing one note with the collective (infra/services/notes-share).
 *
 * Notes live on this device. Nothing leaves until the member presses Share on
 * one of them. The note is hashed with a fresh salt, the member checks in to
 * share:<hash> with their participation key (ADR 0069), and the collective's
 * server files it only after the door confirms that signature. Withdrawing is
 * the same gesture over share:<hash>:withdraw.
 */

export interface ShareInput {
  type: "note" | "link" | "quote" | "person";
  text: string;
  intent: string;
  tags: string[];
  people: string[];
}

export type ShareOutcome =
  | { status: "shared" | "withdrawn"; id: string }
  | { status: "needs-approval" }
  | { status: "failed"; error: string };

const b64u = (buf: ArrayBuffer) =>
  btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

async function noteId(n: Record<string, unknown>): Promise<string> {
  const sorted = "{" + Object.keys(n).sort().map((k) => JSON.stringify(k) + ":" + JSON.stringify(n[k])).join(",") + "}";
  return b64u(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(sorted))).slice(0, 22);
}

const freshSalt = () => b64u(crypto.getRandomValues(new Uint8Array(12)).buffer);

async function post(path: string, body: unknown): Promise<{ ok: boolean; error?: string; id?: string }> {
  const res = await fetch(`${edition.share!.base}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify(body),
  });
  const j = await res.json().catch(() => ({}));
  if (!res.ok || !j.ok) return { ok: false, error: j.error || `${edition.instance.name}'s server answered ${res.status}.` };
  return { ok: true, id: j.id };
}

export async function shareNote(input: ShareInput): Promise<ShareOutcome> {
  if (!edition.share) return { status: "failed", error: "This app keeps notes on the device only." };
  const note = { v: 1, collective: edition.instance.slug, salt: freshSalt(), ...input };
  const id = await noteId(note);
  const r = await participate("share", `share:${id}`);
  if (r.status === "needs-approval") return { status: "needs-approval" };
  if (r.status === "unsupported") return { status: "failed", error: `${edition.instance.name}'s sign-in cannot sign notes yet.` };
  if (r.status === "failed") return { status: "failed", error: r.error };
  const out = await post("/api/notes/share", { note, grantId: liveGrantId() });
  return out.ok ? { status: "shared", id } : { status: "failed", error: out.error! };
}

export async function withdrawNote(id: string): Promise<ShareOutcome> {
  if (!edition.share) return { status: "failed", error: "Nothing was shared from this app." };
  const r = await participate("share", `share:${id}:withdraw`);
  if (r.status === "needs-approval") return { status: "needs-approval" };
  if (r.status === "unsupported") return { status: "failed", error: `${edition.instance.name}'s sign-in cannot sign this yet.` };
  if (r.status === "failed") return { status: "failed", error: r.error };
  const out = await post("/api/notes/withdraw", { id, grantId: liveGrantId() });
  return out.ok ? { status: "withdrawn", id } : { status: "failed", error: out.error! };
}
