import { describe, expect, test } from "bun:test";
import { sr25519CreateDerive } from "@polkadot-labs/hdkd";
import { entropyToMiniSecret, generateMnemonic, mnemonicToEntropy } from "@polkadot-labs/hdkd-helpers";
import { getPublicKey, sign, verify } from "@scure/sr25519";
import {
  accountPublicKey,
  accountSecret,
  indexBytes,
  productId,
  subtreePublicKey,
  subtreePublicKeyFromEntropy,
} from "../../src/lib/plugin-account";

const hex = (b: Uint8Array) => `0x${[...b].map((x) => x.toString(16).padStart(2, "0")).join("")}`;

// Parity's cross-host vector: trinity-user-agents tests/wasm_crypto_vectors.rs,
// repeated in product-sdk packages/keys/src/product-account.test.ts (d0d4a90).
const ENTROPY = new Uint8Array(16).fill(0xab);

describe("plugin accounts use Parity's product-account construction", () => {
  test("matches the hosts' own vector for myapp.dot", () => {
    const subtree = subtreePublicKeyFromEntropy(ENTROPY, "myapp.dot");
    expect(hex(subtree)).toBe("0x4a4c063de30994d4341f1effa157ded4e0b340b2e657f238bef3f930faba192b");
    expect(hex(accountPublicKey(subtree, 0))).toBe(
      "0x1c1ae478b564572f806ffa6352b4273d612beb01610b19f4e5bf444521cd5b5c",
    );
  });

  test("pins the index magic", () => {
    expect(hex(indexBytes(0).subarray(4))).toBe("0x12e86013736c5498f050b03cdc16957dff0e422fb92ca77ec3ab168f");
  });

  test("our hard steps agree with the standard wallet derivation", () => {
    const words = generateMnemonic(128);
    const mini = entropyToMiniSecret(mnemonicToEntropy(words));
    for (const id of ["swap.birdbrain", "chat.fttf", "operations.kinterrella"]) {
      expect(hex(subtreePublicKey(words, id))).toBe(hex(sr25519CreateDerive(mini)(`//product//${id}`).publicKey));
    }
  });

  test("the secret the app holds matches the public key the plugin sees, and signs", () => {
    const words = generateMnemonic(128);
    const id = productId("swap", "birdbrain");
    const secret = accountSecret(words, id, 3);
    const pub = accountPublicKey(subtreePublicKey(words, id), 3);
    expect(hex(getPublicKey(secret))).toBe(hex(pub));
    const msg = new TextEncoder().encode("check-in");
    expect(verify(msg, sign(secret, msg), pub)).toBe(true);
  });

  test("each plugin, collective and index gets its own account", () => {
    const words = generateMnemonic(128);
    const seen = new Set<string>();
    for (const [p, c] of [["swap", "birdbrain"], ["swap", "decent"], ["chat", "birdbrain"]]) {
      const sub = subtreePublicKey(words, productId(p, c));
      for (const i of [0, 1]) seen.add(hex(accountPublicKey(sub, i)));
    }
    expect(seen.size).toBe(6);
  });

  test("refuses ids that could be confused and indexes out of range", () => {
    expect(() => productId("Swap", "birdbrain")).toThrow();
    expect(() => productId("swap", "bird.brain")).toThrow();
    expect(() => productId("a-plugin-with-a-long-name", "decent")).toThrow();
    expect(() => indexBytes(-1)).toThrow();
    expect(() => indexBytes(2 ** 32)).toThrow();
    expect(() => indexBytes(new Uint8Array(31))).toThrow();
  });
});
