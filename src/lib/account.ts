/**
 * The member's chain account, held by the app (ADR 0080, step 4).
 *
 * One key per collective in the window, made from twelve words the member writes
 * down. The words sit in the system's secure store (`./secrets`) and are read
 * only at the moment of signing, inside `./signer`. Plugins never read them:
 * they see the public key and ask the signer to sign a call, and the member
 * approves it on a screen the app draws (`host/SignSheet.tsx`).
 *
 * The storage names are the ones Swap used before the key moved here, so an
 * account made in Swap is the same account after the move.
 */
import { keySecret } from "./secrets";
import { keyFromWords, normaliseWords, validWords, newWords, addressFor } from "./swap";

const WORDS = "swap.words";
const PUBLIC = "murmur.swap.account.v1";

const hex = (b: Uint8Array) => Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");
const unhex = (s: string) => new Uint8Array(s.match(/../g)!.map((x) => parseInt(x, 16)));

export { newWords, validWords, normaliseWords, addressFor };

const listeners = new Set<() => void>();
const emit = () => listeners.forEach((f) => f());
export const onAccountChange = (f: () => void) => {
  listeners.add(f);
  return () => void listeners.delete(f);
};

/** The account's public key, or null when this computer holds none. */
export function accountKey(): Uint8Array | null {
  const v = localStorage.getItem(PUBLIC);
  return v ? unhex(v) : null;
}

/** Keep the words in the secure store and remember the public key. */
export async function saveWords(words: string): Promise<Uint8Array> {
  const clean = normaliseWords(words);
  const key = keyFromWords(clean);
  await keySecret.set(WORDS, clean);
  localStorage.setItem(PUBLIC, hex(key.publicKey));
  emit();
  return key.publicKey;
}

/** The words, for the member to write down again. Only the account screen asks. */
export const revealWords = () => keySecret.get(WORDS);

/** Delete the key from this computer. The words still bring the account back. */
export async function forgetAccount() {
  await keySecret.delete(WORDS);
  localStorage.removeItem(PUBLIC);
  emit();
}

/**
 * The signing key, for the signer only. It checks the words still make the
 * account the app shows, so a key swapped underneath never signs for it.
 */
export async function signingKeyFor(publicKey: Uint8Array) {
  const words = await keySecret.get(WORDS);
  if (!words) throw new Error("This computer no longer holds the account's key. Restore it from your words.");
  const key = keyFromWords(words);
  if (hex(key.publicKey) !== hex(publicKey)) throw new Error("The key on this computer is not this account's. Restore it from your words.");
  return key;
}
