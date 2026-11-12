import { edition } from "../edition";
import { openInBrowser } from "./passkey";

/**
 * Your Seed: the record the network keeps of you from the calls, and its mark.
 *
 * A Seed is written before anyone signs anything, so its mark starts hollow: a
 * placeholder that proves nothing. Claiming it ties it to an account you hold.
 * One passkey tap in the browser signs the claim, and it must be a passkey that
 * holds that account. The claim stays open for a week so anyone can object, then
 * the mark turns solid once and stays that way.
 *
 * The door draws the marks, so the app and the forest use one drawing. They come
 * back as SVG text and are shown as images, never as markup.
 *
 * Server side: the sign-in service's /app/pair/seed* endpoints. The claim rules and
 * ledger are public in github.com/Birdbrain-wtf/seeds
 * (profiles/chaos-sessions/identity-forest/scripts/seed-claims.ts).
 */
export const supported = !!edition.signIn.claim;

export type ClaimStatus = "open" | "disputed" | "ready" | "settled" | "rejected" | "withdrawn";

export interface SeedState {
  /** the account this member holds the key to, or null if they have none yet */
  ownAccount: string | null;
  seed: {
    slug: string;
    name: string;
    kind: "anchored" | "unanchored";
    mark: string;
    claim: {
      id: string;
      slugs: string[];
      account: string;
      status: ClaimStatus;
      opensUntil: number;
      objections: { reason: string; at: string; resolved: "upheld" | "dismissed" | null }[];
    };
  } | null;
  candidates: { slug: string; name: string; sessions: number; mark: string; taken: boolean }[];
  forest: string;
  challengeDays: number;
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

export const markSrc = (svg: string) => `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;

export async function loadSeed(session: string): Promise<SeedState> {
  const r = await post("seed", { session });
  if (r.status !== 200) throw new Error(r.error || `The door answered ${r.status}`);
  return r as SeedState;
}

/** Start a claim, open the approval page in the browser, and wait for the tap. */
export async function claimSeed(session: string, slugs: string[]): Promise<void> {
  if (!edition.signIn.claim) throw new Error("Seeds are not available here yet.");
  const start = await post("seed-claim-start", { session, slugs });
  if (!start.code) throw new Error(start.error || "Could not start the claim.");
  await openInBrowser(edition.signIn.claim + encodeURIComponent(start.code));
  const deadline = Date.now() + (Number(start.expiresIn) || 600) * 1000;
  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 2000));
    const r = await post("seed-claim-poll", { code: start.code, secret: start.secret }).catch(() => null);
    if (r?.status === "approved") return;
    if (r?.status === "expired") break;
  }
  throw new Error("The approval timed out. Try again.");
}

export async function withdrawClaim(session: string, claimId: string): Promise<void> {
  const r = await post("seed-withdraw", { session, claimId });
  if (!r.ok) throw new Error(r.error || "Could not withdraw the claim.");
}
