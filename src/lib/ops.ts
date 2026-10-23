import { useSyncExternalStore } from "react";
import { edition } from "../edition";
import { openInBrowser } from "../identity/passkey";
import { appSecret } from "./secrets";
import { sampleMe, sampleOps } from "../demo/sample";
import { demoNote } from "../demo/note";

/**
 * The connection to this edition's operations console (infra/services/ops-console),
 * shared by the Operations and Files plugins and shown in Settings.
 *
 * One sign-in first: where the console takes this edition's member sign-in
 * (Decent's does, infra/services/ops-console/member.ts), the app reads it with the
 * session it already holds, and the same passkey approves changes in the browser.
 * The console still decides who may read what, from its own list.
 *
 * Otherwise (FTTF's console, or an investor with a console-only passkey) the app
 * pairs: it asks for a code, opens /ops/link?code=… in the browser, and polls
 * until that passkey approves it. What comes back is a read-only token for seven
 * days, kept in the system's secure store. Anything that acts is still approved
 * in the browser.
 *
 * proposeChange() is how the app changes something without the token acting:
 * it sends a draft, opens /ops/approve?d=… in the browser and polls until the
 * owner taps (or declines) there. Placing an edition is the first change.
 */
export interface OpsMe {
  signedIn: boolean;
  /** An investor's sign-in opens their investor room only: what they hold, the documents, and anything to sign. */
  role?: "owner" | "investor" | null;
  who: { handle: string; name: string } | null;
  brand: string;
  company: string;
  views: { accounts?: boolean; position?: boolean; shares?: boolean; raise?: boolean; incubation?: boolean; duties?: boolean; connections?: boolean; files?: boolean; investor?: boolean };
}

/** member: the app's own sign-in opened the console. pair: a console-only token. */
export type OpsVia = "member" | "pair";
/** Why the console is shut: the app is not signed in, or this sign-in has no place on the console's list. */
export type OpsShut = "app-signed-out" | "no-access";

type State =
  | { kind: "unavailable" }
  | { kind: "loading" }
  | { kind: "signed-out"; error?: string; why?: OpsShut }
  | { kind: "pairing"; code: string; url: string }
  | { kind: "ready"; me: OpsMe; via: OpsVia };

// VITE_OPS_BASE points a dev build at a local console (see infra/services/ops-console/test/app-e2e.ts).
const base = (import.meta.env.VITE_OPS_BASE as string | undefined) ?? edition.ops?.base ?? null;
const TOKEN = `ops.${edition.id}`;

// A demo edition reads the template in src/demo/sample.ts, not a console.
const demo = !!edition.demo;

let state: State = demo ? { kind: "ready", me: sampleMe, via: "member" } : base ? { kind: "loading" } : { kind: "unavailable" };
let token: string | null = null;
let via: OpsVia | null = null;

/** The app's own session (useIdentity keeps it), if it has not run out. */
function appSession(): string | null {
  try {
    const id = JSON.parse(localStorage.getItem("murmur.identity.v1") || "null");
    return id?.session && (!id.sessionExp || id.sessionExp > Date.now() / 1000) ? String(id.session) : null;
  } catch {
    return null;
  }
}
let cancelPairing: (() => void) | null = null;
const listeners = new Set<() => void>();
const set = (s: State) => {
  state = s;
  listeners.forEach((l) => l());
};

export class OpsError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
  }
}

async function call(path: string, init: RequestInit = {}): Promise<Response> {
  if (!base) throw new OpsError("This edition has no operations console.", 404);
  const headers: Record<string, string> = { Accept: "application/json", ...(init.headers as Record<string, string>) };
  if (token) headers.Authorization = `Bearer ${token}`;
  const r = await fetch(`${base}${path}`, { ...init, headers });
  if (r.status === 401 && token) {
    // Expired or revoked: forget it and ask again. The app's own session is the app's to keep.
    if (via === "pair") await appSecret.delete(TOKEN).catch(() => {});
    const was = via;
    token = null;
    via = null;
    set({ kind: "signed-out", error: was === "pair" ? "The console's sign-in ran out. Sign in again." : undefined, why: appSession() ? "no-access" : "app-signed-out" });
  }
  return r;
}

/** GET a JSON view from the console. */
export async function opsGet<T>(path: string): Promise<T> {
  if (demo) return sampleOps(path) as T;
  const r = await call(path);
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new OpsError(j.error || `The console answered ${r.status}`, r.status);
  return j as T;
}

/**
 * An investor signs what rich has issued to them: their statement or their agreement. The one
 * write an investor's token has, and only for their own room (the console's appGate).
 */
export async function investorSign(body: Record<string, unknown>): Promise<{ ok: true; message: string }> {
  if (demo) {
    demoNote("In your own app this signs the document, with your typed name as your signature.");
    throw new OpsError("Not signed: this is a demo.", 400);
  }
  const r = await call("/api/ops/investor/sign", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new OpsError(j.error || `The console answered ${r.status}`, r.status);
  return j;
}

/** GET raw bytes (a file) from the console. */
export async function opsBlob(path: string): Promise<Blob> {
  const r = await call(path);
  if (!r.ok) {
    const j = await r.json().catch(() => ({}));
    throw new OpsError(j.error || `The console answered ${r.status}`, r.status);
  }
  return r.blob();
}

/** Does this bearer open the console? Asked without touching the current token. */
async function meWith(bearer: string): Promise<OpsMe | null> {
  try {
    const r = await fetch(`${base}/api/ops/me`, { headers: { Accept: "application/json", Authorization: `Bearer ${bearer}` } });
    if (!r.ok) return null;
    const me = (await r.json()) as OpsMe;
    return me.signedIn ? me : null;
  } catch {
    return null;
  }
}

async function refresh() {
  if (!base || demo) return;
  // The app's own sign-in first: one passkey for the app and the console.
  const session = appSession();
  if (session) {
    const me = await meWith(session);
    if (me) {
      token = session;
      via = "member";
      return set({ kind: "ready", me, via });
    }
  }
  // Then a token this computer paired with the console on its own.
  const paired = await appSecret.get(TOKEN).catch(() => null);
  if (paired) {
    const me = await meWith(paired);
    if (me) {
      token = paired;
      via = "pair";
      return set({ kind: "ready", me, via });
    }
    await appSecret.delete(TOKEN).catch(() => {});
  }
  token = null;
  via = null;
  set({ kind: "signed-out", why: session ? "no-access" : "app-signed-out" });
}

/** How the console was opened; a member sign-in has no separate sign-out. */
export const opsVia = () => via;

/** Look again, e.g. after the app signs in. */
export const refreshOps = () => void refresh();

// The app signing in or out changes what opens the console. Signing out also ends the
// console's reads for that session at once, rather than when the session runs out.
if (typeof window !== "undefined" && !demo) {
  window.addEventListener("murmur:identity", (e) => {
    const old = (e as CustomEvent<{ signedOut?: string }>).detail?.signedOut;
    if (old && via === "member" && base) {
      void fetch(`${base}/api/ops/app/signout`, { method: "POST", headers: { Authorization: `Bearer ${old}` } }).catch(() => {});
      token = null;
      via = null;
    }
    if (started) void refresh();
  });
}

function device() {
  const ua = navigator.userAgent;
  return /Mac/.test(ua) ? "a Mac" : /Windows/.test(ua) ? "a Windows PC" : /Linux/.test(ua) ? "a Linux computer" : "a computer";
}

async function post(path: string, body: unknown) {
  const r = await fetch(`${base}${path}`, { method: "POST", headers: { "Content-Type": "application/json", Accept: "application/json" }, body: JSON.stringify(body) });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error || `The console answered ${r.status}`);
  return j;
}

/** Ask for a code, open the approval page in the browser, wait for the owner's tap. */
export async function signInToOps() {
  if (!base) return;
  cancelPairing?.();
  try {
    const { code, secret, expiresIn } = await post("/api/ops/app/pair/start", { device: device() });
    const url = `${base}/ops/link?code=${encodeURIComponent(code)}`;
    set({ kind: "pairing", code, url });
    await openInBrowser(url);
    let stopped = false;
    cancelPairing = () => {
      stopped = true;
    };
    const deadline = Date.now() + (Number(expiresIn) || 600) * 1000;
    while (!stopped && Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 2000));
      if (stopped) break;
      try {
        const r = await post("/api/ops/app/pair/poll", { code, secret });
        if (r.status === "approved" && r.token) {
          token = r.token;
          via = "pair";
          await appSecret.set(TOKEN, r.token);
          cancelPairing = null;
          return refresh();
        }
        if (r.status === "expired") break;
      } catch {
        /* a dropped request is not a refusal: keep waiting */
      }
    }
    if (!stopped) set({ kind: "signed-out", error: "The code ran out. Try again." });
  } catch (e) {
    set({ kind: "signed-out", error: (e as Error).message });
  }
}

export function cancelOpsSignIn() {
  cancelPairing?.();
  cancelPairing = null;
  set({ kind: "signed-out" });
}

/** Ends a paired token. With the app's own sign-in there is nothing separate to end: signing out of the app does it. */
export async function signOutOfOps() {
  if (demo) return demoNote("In your own app this signs this computer out of the operations console.");
  if (via === "member") return;
  if (token) await call("/api/ops/app/signout", { method: "POST" }).catch(() => {});
  token = null;
  via = null;
  await appSecret.delete(TOKEN).catch(() => {});
  set({ kind: "signed-out", why: appSession() ? "no-access" : "app-signed-out" });
}

export type Proposal = { status: "approved" | "declined" | "failed" | "expired" | "stopped"; error?: string };

/**
 * Draft a change here, approve it in the browser. Resolves when the owner has
 * tapped, declined, or the draft has run out (ten minutes). `onOpen` hands back
 * the approval page so it can be opened again; `stop` ends the wait (the draft
 * then simply runs out on the console).
 */
export async function proposeChange(
  kind: "incubation.place" | "duty.close",
  target: string,
  change: Record<string, unknown>,
  opts: { onOpen?: (url: string) => void; stop?: AbortSignal } = {},
): Promise<Proposal> {
  if (demo) {
    demoNote("In your own app this opens the change in your browser, where one passkey tap writes it.");
    return { status: "stopped" };
  }
  const r = await call("/api/ops/app/draft", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ kind, target, change, ...(kind === "incubation.place" ? { ladder: 5 } : {}) }) });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new OpsError(j.error || `The console answered ${r.status}`, r.status);
  const url = `${base}${j.url}`;
  opts.onOpen?.(url);
  await openInBrowser(url);
  const deadline = Date.now() + (Number(j.expiresIn) || 600) * 1000;
  while (Date.now() < deadline) {
    await new Promise((res) => setTimeout(res, 2000));
    if (opts.stop?.aborted) return { status: "stopped" };
    try {
      const p = await opsGet<{ status: string; error?: string }>(`/api/ops/app/draft/${j.id}`);
      if (p.status !== "pending") return p as Proposal;
    } catch (e) {
      if (e instanceof OpsError && e.status === 401) return { status: "failed", error: "The console's sign-in ran out." };
      /* a dropped request is not a refusal: keep waiting */
    }
  }
  return { status: "expired" };
}

/** Open a page of the console itself, in the browser, where actions are approved. */
export const openConsole = (path = "/ops") =>
  demo
    ? demoNote("In your own app this opens the operations console in your browser, where changes are made and approved with your passkey.")
    : base && openInBrowser(`${base}${path}`);

let started = false;
export function useOps(): State {
  if (!started) {
    started = true;
    void refresh();
  }
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => state,
  );
}
