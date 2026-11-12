import { edition } from "../edition";

/**
 * Whether the door still accepts the app's session.
 *
 * The app keeps a 30-day session and used to trust it until the date ran out.
 * A door can stop accepting one sooner (the account was merged or removed, the
 * door's key changed), and the app then said "signed in" while every plugin that
 * used the session failed on its own. So the app asks the door when it opens,
 * and any plugin the door turns away says so here; either way the member is
 * signed out of this collective only and asked for one passkey tap.
 *
 * Only a definite refusal (401) counts. A door that is down, unreachable or has
 * no whoami (FTTF's, for now) leaves the session alone.
 */

export type SessionCheck = "ok" | "rejected" | "unknown";

const EVENT = "murmur:session-rejected";

export async function checkSession(session: string | null | undefined): Promise<SessionCheck> {
  if (!session) return "unknown";
  try {
    const r = await fetch(`${edition.signIn.pair}/whoami`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({ session }),
    });
    if (r.status === 401) return "rejected";
    return r.ok ? "ok" : "unknown";
  } catch {
    return "unknown";
  }
}

/** A plugin whose door call came back 401 reports it here. */
export function sessionRejected(session: string | null | undefined) {
  if (!session) return;
  window.dispatchEvent(new CustomEvent(EVENT, { detail: { session } }));
}

export function onSessionRejected(fn: (session: string) => void): () => void {
  const h = (e: Event) => {
    const s = (e as CustomEvent).detail?.session;
    if (typeof s === "string") fn(s);
  };
  window.addEventListener(EVENT, h);
  return () => window.removeEventListener(EVENT, h);
}
