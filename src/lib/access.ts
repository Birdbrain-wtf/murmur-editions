import { useEffect, useState } from "react";
import { edition } from "../edition";
import { liveGrantId, participate } from "../identity/participation";

/**
 * Who can use what, and what you have agreed to.
 *
 * Two servers, neither of them Zo's. The collective's own address holds the grid
 * (`edition.access`, infra/services/access): roles, who holds them, a level per
 * plugin per role, and signed proposals to change it. The door holds consent
 * (`edition.signIn.pair` → consents), read from the records it already keeps.
 *
 * A change is never made here. It is proposed, signed with the participation key
 * so the proposal is the member's own, and decided by whoever the collective's
 * stage says decides (its operator while incubated).
 */

export type Level = "none" | "see" | "join" | "run";
export const LEVEL_LABEL: Record<Level, string> = { none: "No access", see: "See", join: "Take part", run: "Run" };
export const LEVEL_LINE: Record<Level, string> = {
  none: "doesn't see it",
  see: "reads, can't change anything",
  join: "posts, joins, contributes",
  run: "sets it up and approves",
};
export const LEVELS: Level[] = ["none", "see", "join", "run"];

export type AccessRole = { id: string; name: string; line: string; rank: number | null; holders: number | null; default: boolean };
export type Proposal = { id: string; what: string; why: string; by: string; at: string; status: "waiting" | "approved" | "declined"; note: string | null; decidedBy: string | null };
export type AccessGrid = {
  stage: string;
  approvers: string;
  line: string;
  roles: AccessRole[];
  plugins: Record<string, Record<string, Level>>;
  elsewhere: Record<string, string>;
  proposals: Proposal[];
};
export type MyAccess = {
  userId: string;
  name: string;
  roles: string[];
  levels: Record<string, Level>;
  /** plugins where a level was set for you on your invite, which wins over your roles */
  own?: string[];
  approver: boolean;
  people: { userId: string; roles: string[] }[] | null;
  proposals: Proposal[] | null;
};
export type Consents = {
  agreement: { accepted: { version: string; at: string; surface: string } | null; current: string; upToDate: boolean; history: { version: string; at: string; surface: string }[] };
  weekly: { email: string | null; on: boolean; confirmed: boolean; at: string | null };
  checkins: { live: { id: string; exp: number } | null; ever: number };
  calls: { count: number; withdrawn: number } | null;
};

const base = edition.access?.base ?? null;
export const accessSupported = !!base;

async function post<T>(url: string, body: unknown): Promise<T> {
  const r = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json", Accept: "application/json" }, body: JSON.stringify(body) });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error || `The server answered ${r.status}.`);
  return j as T;
}

export function useAccess(session: string | null | undefined, n = 0) {
  const [grid, setGrid] = useState<AccessGrid | null>(null);
  const [me, setMe] = useState<MyAccess | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (!base) return;
    let live = true;
    fetch(`${base}/api/access`, { headers: { Accept: "application/json" } })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`The server answered ${r.status}.`))))
      .then((g) => live && setGrid(g))
      .catch((e) => live && setError(e.message));
    if (session)
      post<MyAccess>(`${base}/api/access/me`, { session })
        .then((m) => live && setMe(m))
        .catch((e) => live && setError(e.message));
    return () => {
      live = false;
    };
  }, [session, n]);
  return { grid, me, error };
}

export function useConsents(session: string | null | undefined, n = 0) {
  const [c, setC] = useState<Consents | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (!session) return;
    let live = true;
    post<Consents>(`${edition.signIn.pair}/consents`, { session })
      .then((x) => live && setC(x))
      .catch((e) => live && setError(e.message));
    return () => {
      live = false;
    };
  }, [session, n]);
  return { consents: c, error };
}

export const setWeekly = (session: string, on: boolean) => post(`${edition.signIn.pair}/consent-set`, { session, what: "weekly", on });

export type Draft =
  | { what: "level"; plugin: string; role: string; level: Level; why: string }
  | { what: "role"; person: string; role: string; add: boolean; why: string };

const b64u = (buf: ArrayBuffer) =>
  btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const sorted = (c: Record<string, unknown>) =>
  "{" + Object.keys(c).sort().map((k) => JSON.stringify(k) + ":" + JSON.stringify(c[k])).join(",") + "}";
const digest = async (s: string) => b64u(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s)));
/** The change's id, computed the way infra/services/access/access.ts computes it. */
async function changeId(c: Record<string, unknown>): Promise<string> {
  return (await digest(sorted(c))).slice(0, 22);
}

/**
 * The check-in an inviter signs when their invite sets a role or levels:
 * invite:<inviteId>:<12 chars of the hash of {levels, role}>, computed the way
 * infra/services/access/access.ts computes it, so a link whose role is changed
 * after signing fails to verify at the collective's server.
 */
export async function inviteSession(inviteId: string, role: string, levels: Record<string, Level>): Promise<string> {
  const sortedLevels = Object.fromEntries(Object.keys(levels).sort().map((k) => [k, levels[k]]));
  return `invite:${inviteId}:${(await digest(sorted({ levels: sortedLevels, role }))).slice(0, 12)}`;
}

export type SignResult = { ok: true; grant: string } | { ok: false; needsCheckIns?: boolean; error: string };

/** Sign what an invite offers with the check-in key. The grant id rides in the invite so the collective can look the check-in up. */
export async function signInvite(inviteId: string, role: string, levels: Record<string, Level>): Promise<SignResult> {
  if (!base) return { ok: false, error: `${edition.instance.name} has no address for roles yet.` };
  const r = await participate("invite", await inviteSession(inviteId, role, levels));
  if (r.status === "needs-approval") return { ok: false, needsCheckIns: true, error: "A role on an invite is signed with your check-in key, and check-ins are off on this computer." };
  if (r.status === "unsupported") return { ok: false, error: `${edition.instance.name}'s sign-in cannot sign invites yet.` };
  if (r.status === "failed") return { ok: false, error: r.error };
  const grant = liveGrantId();
  return grant ? { ok: true, grant } : { ok: false, needsCheckIns: true, error: "Check-ins turned off while signing. Turn them on and try again." };
}

export type ClaimOutcome =
  | { status: "none" }
  | { status: "applied"; what: string }
  | { status: "proposed"; what: string; approvers: string }
  | { status: "already"; what: string; outcome: "waiting" | "approved" | "declined" }
  | { status: "refused"; reason: string };
export type ClaimResult = { ok: true; from: string | null; access: ClaimOutcome | null } | { ok: false; error: string };

/**
 * The newcomer's side: paste the invite link after signing in. The claim goes to the
 * collective's invite door with the app's session, which proves who claimed it and
 * records who brought them in. If the invite set a role or levels, the door hands
 * them to the access server and the outcome comes back.
 */
export async function claimInvite(link: string, session: string): Promise<ClaimResult> {
  const door = edition.invite?.base;
  if (!door) return { ok: false, error: `${edition.instance.name} has no address for invites yet.` };
  const frag = link.trim().replace(/^.*#/, "");
  let p: any = null;
  try {
    const b64 = frag.replace(/-/g, "+").replace(/_/g, "/") + "=".repeat((4 - (frag.length % 4)) % 4);
    const bin = atob(b64);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    p = JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    p = null;
  }
  if (!p || p.v !== 1 || !p.inst?.slug || typeof p.ts !== "number") return { ok: false, error: "That doesn't look like an invite link." };
  if (p.inst.slug !== edition.instance.slug) return { ok: false, error: `That invite is for ${p.inst.name || p.inst.slug}, not ${edition.instance.name}.` };
  try {
    const j = await post<{ ok: boolean; access?: ClaimOutcome }>(`${door}/api/murmur/invite`, { type: "claim", payload: p, session });
    return { ok: true, from: p.from ?? null, access: j.access ?? null };
  } catch (e: any) {
    return { ok: false, error: e.message };
  }
}

export type ProposeResult = { ok: true; what: string; already?: boolean } | { ok: false; needsCheckIns?: boolean; error: string };

/** Sign a proposed change with the check-in key and file it with the collective. */
export async function propose(d: Draft): Promise<ProposeResult> {
  if (!base) return { ok: false, error: `${edition.instance.name} has no address for this yet.` };
  const change = { v: 1, collective: edition.instance.slug, on: new Date().toISOString().slice(0, 10), ...d, why: d.why.trim() };
  const id = await changeId(change);
  const r = await participate("access", `access:${id}`);
  if (r.status === "needs-approval") return { ok: false, needsCheckIns: true, error: "Changes are signed with your check-in key, and check-ins are off on this computer." };
  if (r.status === "unsupported") return { ok: false, error: `${edition.instance.name}'s sign-in cannot sign changes yet.` };
  if (r.status === "failed") return { ok: false, error: r.error };
  try {
    const j = await post<{ ok: boolean; what: string; already?: boolean }>(`${base}/api/access/propose`, { change, grantId: liveGrantId() });
    return { ok: true, what: j.what, already: j.already };
  } catch (e: any) {
    return { ok: false, error: e.message };
  }
}
