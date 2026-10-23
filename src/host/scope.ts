/**
 * Which collective the window is in.
 *
 * One app, many collectives: a member who belongs to Birdbrain, Decent and FTTF
 * keeps one app and switches between them, the way a chat app switches
 * workspaces. The build still has a home collective (its edition: its name, its
 * signing key, its update channel). The others are spaces the member has added.
 *
 * Each collective keeps its own state. Every `murmur.*` key in localStorage is
 * filed under the collective that wrote it, so a session made at one door is
 * never sent to another, and each space keeps its own plugins, skin, chat
 * account, check-ins and agent conversation. The home collective uses the
 * unprefixed keys, so every install from before this file is unchanged.
 *
 * Switching reloads the window. Every surface reads the collective once, when
 * it loads, so a reload is what keeps them all on the same one.
 *
 * This file must load before anything that reads localStorage: `edition.ts`
 * imports it first and `main.tsx` imports `edition.ts` first.
 */

/** App-level keys, shared by every collective in the window. */
const ACTIVE_KEY = "murmur.collective.v1";
const JOINED_KEY = "murmur.collectives.v1";
const GLOBAL = new Set([ACTIVE_KEY, JOINED_KEY, "murmur.whats-new.v1"]);

const store = typeof localStorage !== "undefined" ? localStorage : null;
const rawGet = store ? Object.getPrototypeOf(store).getItem as Storage["getItem"] : null;

function read<T>(key: string, fallback: T): T {
  try {
    const raw = store?.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

/** The collective the window was opened in, or null for the edition's home. */
export const storedCollective: string | null = read<string | null>(ACTIVE_KEY, null);

/** The collectives this member has added beside the home one. */
export function joinedCollectives(): string[] {
  return read<string[]>(JOINED_KEY, []);
}

/** The prefix a collective's keys are filed under ("" for the home collective). */
export function scopePrefix(collective: string, home: string): string {
  return collective === home ? "" : `@${collective}.`;
}

let prefix = "";

/** Called once by `edition.ts`, after it has settled which collective is active. */
export function enterScope(collective: string, home: string) {
  prefix = scopePrefix(collective, home);
  if (!prefix || !store) return;
  const proto = Object.getPrototypeOf(store) as Storage;
  const scoped = (key: string) =>
    key.startsWith("murmur.") && !GLOBAL.has(key) ? `murmur${prefix}${key.slice(7)}` : key;
  const { getItem, setItem, removeItem } = proto;
  proto.getItem = function (key: string) {
    return getItem.call(this, this === store ? scoped(key) : key);
  };
  proto.setItem = function (key: string, value: string) {
    return setItem.call(this, this === store ? scoped(key) : key, value);
  };
  proto.removeItem = function (key: string) {
    return removeItem.call(this, this === store ? scoped(key) : key);
  };
}

/** Read another collective's stored value without entering it (the switcher
 *  uses this to say where the member is signed in). */
export function peek(collective: string, home: string, key: string): string | null {
  if (!store || !rawGet) return null;
  const p = scopePrefix(collective, home);
  return rawGet.call(store, p ? `murmur${p}${key.slice(7)}` : key);
}

/** Prefix for names in the OS secure store, so collectives never share a value. */
export function secretScope(): string {
  return prefix ? `collective${prefix}` : "";
}

/** Open another collective in this window. */
export function switchCollective(id: string) {
  store?.setItem(ACTIVE_KEY, JSON.stringify(id));
  location.reload();
}

/** Add a collective beside the home one and open it. */
export function joinCollective(id: string) {
  const list = joinedCollectives();
  if (!list.includes(id)) store?.setItem(JOINED_KEY, JSON.stringify([...list, id]));
  switchCollective(id);
}

/** Take a collective out of the switcher. Its stored state is kept, so adding
 *  it back finds the member signed in where they were. */
export function leaveCollective(id: string, home: string) {
  store?.setItem(JOINED_KEY, JSON.stringify(joinedCollectives().filter((c) => c !== id)));
  if ((storedCollective ?? home) === id) switchCollective(home);
}
