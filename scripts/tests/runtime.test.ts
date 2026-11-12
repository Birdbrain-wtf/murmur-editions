import { describe, expect, test } from "bun:test";
import type { LookupEntry } from "@polkadot-api/metadata-builders";
import { template, toChain, toJson, typeName } from "../../src/lib/runtime";
import { dangerous } from "../../src/lib/reading";

let id = 0;
const e = (v: any): LookupEntry => ({ id: id++, ...v });
const u128 = e({ type: "primitive", value: "u128" });
const u32 = e({ type: "primitive", value: "u32" });
const bytes = e({ type: "sequence", value: e({ type: "primitive", value: "u8" }) });
const hash = e({ type: "array", len: 4, value: e({ type: "primitive", value: "u8" }) });
const account = e({ type: "AccountId32" });
const dest = e({
  type: "enum",
  value: { Id: { type: "lookupEntry", value: account, idx: 0 }, Index: { type: "void", idx: 1 } },
  innerDocs: {},
});
const transfer = e({ type: "struct", value: { dest, value: e({ type: "compact", isBig: true, size: "u128" }) }, innerDocs: {} });

describe("call values", () => {
  test("templates are what a member fills in", () => {
    expect(template(transfer)).toEqual({ dest: { type: "Id", value: "" }, value: "0" });
    expect(template(bytes)).toBe("0x");
    expect(template(hash)).toBe("0x00000000");
    expect(template(e({ type: "option", value: u32 }))).toBeNull();
  });

  test("JSON becomes what the chain takes", () => {
    const v: any = toChain(transfer, { dest: { type: "Id", value: " 5Grw " }, value: "1500" });
    expect(v.dest).toEqual({ type: "Id", value: "5Grw" });
    expect(v.value).toBe(1500n);
    expect(toChain(u32, "7")).toBe(7);
    expect(toChain(u128, 9)).toBe(9n);
    expect((toChain(bytes, "hi") as any).asHex()).toBe("0x6869");
    expect((toChain(bytes, "0x0102") as any).asHex()).toBe("0x0102");
    expect(toChain(dest, { type: "Index" })).toEqual({ type: "Index", value: undefined });
  });

  test("a value that doesn't fit says where", () => {
    expect(() => toChain(transfer, { dest: { type: "Id", value: "" }, value: "1" })).toThrow("value.dest.value: an address");
    expect(() => toChain(transfer, { dest: { type: "Nope" }, value: "1" })).toThrow("value.dest: no option called Nope");
    expect(() => toChain(u128, "1.5", "amount")).toThrow("amount: a whole number");
    expect(() => toChain(u32, "-1")).toThrow("not below zero");
    expect(() => toChain(hash, "0x01")).toThrow("exactly 4 bytes");
  });

  test("what the chain hands back reads as JSON", () => {
    expect(toJson({ a: 5n, b: { type: "None", value: undefined }, c: [1n] })).toEqual({ a: "5", b: "None", c: ["1"] });
    expect(typeName(bytes)).toBe("Bytes");
    expect(typeName(transfer.value.dest as LookupEntry)).toBe("Id | Index");
  });
});

describe("the signer's risk rules", () => {
  test("calls that can hand over an account are dangerous", () => {
    expect(dangerous("Proxy", "proxy")).toBe(true);
    expect(dangerous("Utility", "dispatch_as")).toBe(true);
    expect(dangerous("Balances", "transfer_all")).toBe(true);
    expect(dangerous("System", "set_code")).toBe(true);
  });
  test("ordinary calls are not", () => {
    expect(dangerous("System", "remark")).toBe(false);
    expect(dangerous("Balances", "transfer_keep_alive")).toBe(false);
    expect(dangerous("Utility", "batch_all")).toBe(false);
    expect(dangerous("Assets", "transfer")).toBe(false);
  });
});
