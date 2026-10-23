import { edition } from "../edition";

/**
 * Passkey sign-in, through the member's own browser.
 *
 * A passkey is a signature over a website's hostname, and this window is not a
 * website a member's passkey was made for. Native passkeys need an
 * Apple-registered app, which we do not have yet. So the app asks the edition's
 * door for a pairing code, opens the door's approval page in the browser where
 * the passkey already lives, and waits. The browser does the proving; the app
 * receives a session of its own once the member says yes.
 *
 * Server side: /app/pair/* in infra/services/chaos-auth (Murmur, Decent) and
 * /auth/app/pair/* in orbits/fttf/auth.ts (FTTF).
 */
export interface Pairing {
  code: string;
  url: string;
  cancel: () => void;
  done: Promise<SignedIn>;
}
export interface SignedIn {
  userId: string;
  displayName: string;
  session: string;
  exp: number | null;
}

const isTauri = typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

export async function openInBrowser(url: string) {
  if (isTauri) {
    try {
      const { openUrl } = await import("@tauri-apps/plugin-opener");
      await openUrl(url);
      return;
    } catch {
      /* fall through: the code and the link stay on screen either way */
    }
  }
  window.open(url, "_blank", "noopener");
}

function expOf(token: string): number | null {
  try {
    const b = token.split(".")[1].replace(/-/g, "+").replace(/_/g, "/");
    const exp = JSON.parse(atob(b)).exp;
    return typeof exp === "number" ? exp : null;
  } catch {
    return null;
  }
}

async function post(path: string, body: unknown) {
  const r = await fetch(`${edition.signIn.pair}/${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify(body),
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error || `Sign-in service answered ${r.status}`);
  return j;
}

export async function startPairing(): Promise<Pairing> {
  const { code, secret, expiresIn } = await post("start", { app: edition.signIn.app });
  const url = edition.signIn.approve + encodeURIComponent(code);
  let cancelled = false;
  const deadline = Date.now() + (Number(expiresIn) || 600) * 1000;

  const done = new Promise<SignedIn>((resolve, reject) => {
    const tick = async () => {
      if (cancelled) return reject(new Error("cancelled"));
      if (Date.now() > deadline) return reject(new Error("The code expired. Try again."));
      try {
        const r = await post("poll", { code, secret });
        if (r.status === "approved" && r.session) {
          return resolve({ userId: r.userId, displayName: r.displayName || r.userId, session: r.session, exp: expOf(r.session) });
        }
        if (r.status === "expired") return reject(new Error("The code expired. Try again."));
      } catch {
        /* a dropped request is not a refusal: keep waiting until the deadline */
      }
      setTimeout(tick, 2000);
    };
    setTimeout(tick, 2000);
  });

  return { code, url, cancel: () => { cancelled = true; }, done };
}
