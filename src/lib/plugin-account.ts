/**
 * One account per plugin per collective, made from the member's own words.
 *
 * The construction is Parity's RFC-0022 product account, the one the Polkadot
 * App hosts use (`host_logic/product_account.rs` in trinity-user-agents, and
 * `@parity/product-sdk-keys`, Apache-2.0). We copy the construction, not the
 * package, because the SDK is an unaudited prototype and its host protocol is
 * not stable (brief 2026-11-04, "What to do" 2 and 3).
 *
 *   words -> root key -> //product//<plugin>.<collective>  (two hard steps)
 *                     -> /<index>                          (one soft step)
 *
 * The hard steps are the boundary. Someone holding the member's root public key
 * cannot reach or link a plugin's account, because a hard step needs the secret.
 * The soft step lets the app hand a plugin its subtree public key, so the plugin
 * can see its own addresses without ever holding a secret.
 *
 * The root key is the one `keyFromWords` in `./swap` makes (sr25519, no path),
 * so the words alone bring every plugin account back.
 *
 * Not wired in yet. This is the account half of ADR 0080 step 4 (plugins ask
 * for capabilities), which stays proposed until rich accepts it.
 */
import { HDKD, getPublicKey, secretFromSeed } from "@scure/sr25519";
import { blake2b256, entropyToMiniSecret, mnemonicToEntropy } from "@polkadot-labs/hdkd-helpers";

const INDEX_BYTES = 32;
const U32_MAX = 0xff_ff_ff_ff;

/** Domain separation so a plain index cannot collide with a raw selector. Same bytes as theirs. */
const INDEX_MAGIC = blake2b256(new TextEncoder().encode("product-account-index")).subarray(0, INDEX_BYTES - 4);

export type AccountIndex = number | Uint8Array;

/** The product id a plugin's subtree hangs from: `<plugin>.<collective>`, e.g. `swap.birdbrain`. */
export function productId(plugin: string, collective: string): string {
  const ok = /^[a-z0-9][a-z0-9-]*$/;
  if (!ok.test(plugin) || !ok.test(collective)) throw new Error("plugin and collective must be kebab-case ids");
  const id = `${plugin}.${collective}`;
  // Over 31 bytes Substrate hashes the name and @polkadot-labs/hdkd throws, so wallets would disagree.
  if (id.length > 31) throw new Error("plugin.collective must be 31 characters or fewer");
  return id;
}

/** The 32 bytes a soft step consumes. A number is a u32 plus the magic, raw bytes pass through. */
export function indexBytes(index: AccountIndex): Uint8Array {
  if (index instanceof Uint8Array) {
    if (index.length !== INDEX_BYTES) throw new Error("a raw index must be 32 bytes");
    return index.slice();
  }
  if (!Number.isInteger(index) || index < 0 || index > U32_MAX) throw new Error("index out of range");
  const bytes = new Uint8Array(INDEX_BYTES);
  new DataView(bytes.buffer).setUint32(0, index, true);
  bytes.set(INDEX_MAGIC, 4);
  return bytes;
}

/** Substrate's chain code for a named hard step: SCALE-encoded string, padded to 32 or hashed if longer. */
function junction(name: string): Uint8Array {
  const utf8 = new TextEncoder().encode(name);
  if (utf8.length >= 64) throw new Error("junction name too long");
  const encoded = new Uint8Array(utf8.length + 1);
  encoded[0] = utf8.length << 2;
  encoded.set(utf8, 1);
  if (encoded.length > 32) return blake2b256(encoded);
  const code = new Uint8Array(32);
  code.set(encoded);
  return code;
}

function rootSecret(words: string): Uint8Array {
  const normal = words.trim().toLowerCase().split(/\s+/).join(" ");
  return secretFromSeed(entropyToMiniSecret(mnemonicToEntropy(normal)));
}

function subtreeSecretFromRoot(root: Uint8Array, id: string): Uint8Array {
  return HDKD.secretHard(HDKD.secretHard(root, junction("product")), junction(id));
}

/** The subtree public key `//product//<id>`, the only thing a plugin is ever given. */
export function subtreePublicKey(words: string, id: string): Uint8Array {
  return getPublicKey(subtreeSecretFromRoot(rootSecret(words), id));
}

/** A plugin account's public key from its subtree public key alone. No secret needed. */
export function accountPublicKey(subtree: Uint8Array, index: AccountIndex = 0): Uint8Array {
  return HDKD.publicSoft(subtree, indexBytes(index));
}

/**
 * The secret for a plugin account, for the app to sign with on the plugin's
 * behalf. Never hand this to a plugin: the app signs, the plugin asks.
 */
export function accountSecret(words: string, id: string, index: AccountIndex = 0): Uint8Array {
  return HDKD.secretSoft(subtreeSecretFromRoot(rootSecret(words), id), indexBytes(index));
}

/** Testing seam: the same derivation from raw BIP-39 entropy, as Parity's vectors are written. */
export function subtreePublicKeyFromEntropy(entropy: Uint8Array, id: string): Uint8Array {
  return getPublicKey(subtreeSecretFromRoot(secretFromSeed(entropyToMiniSecret(entropy)), id));
}
