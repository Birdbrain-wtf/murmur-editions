/**
 * A chain's runtime, read from its own metadata (the explorer and the call builder).
 *
 * Every Substrate chain describes itself: its pallets, the calls each takes,
 * the storage each keeps, and the type of every value. The app reads that
 * description from the chain at the finalised block, through the same light
 * client it reads everything else through, so nothing here is written for one
 * chain. Asset Hub, Kreivo and the test network all browse the same way.
 *
 * Values cross between three shapes:
 *  - polkadot-api's (bigint, Binary, `{ type, value }` enums), what the chain takes;
 *  - JSON the member can read and edit (numbers as strings, bytes as 0x hex);
 *  - a template: the JSON shape a call's arguments take, filled with blanks.
 */
import { Binary, type PolkadotClient } from "polkadot-api";
import { getDynamicBuilder, getLookupFn, type LookupEntry, type MetadataLookup } from "@polkadot-api/metadata-builders";
import { compact, decAnyMetadata, unifyMetadata, type UnifiedMetadata } from "@polkadot-api/substrate-bindings";

export interface Field {
  name: string;
  type: LookupEntry;
  docs: string[];
}
export interface CallDef {
  name: string;
  docs: string[];
  fields: Field[];
}
export interface StorageDef {
  name: string;
  docs: string[];
  /** the key types, in order; empty for a plain value */
  keys: LookupEntry[];
  value: LookupEntry;
}
export interface PalletDef {
  name: string;
  calls: CallDef[];
  storage: StorageDef[];
  constants: { name: string; docs: string[]; type: LookupEntry }[];
}
export interface Runtime {
  block: { hash: string; number: number };
  specName: string | null;
  specVersion: number | null;
  pallets: PalletDef[];
  lookup: MetadataLookup;
  meta: UnifiedMetadata;
  dyn: ReturnType<typeof getDynamicBuilder>;
}

const cache = new WeakMap<PolkadotClient, Promise<Runtime>>();

/** The runtime at the finalised block. Read once per client: it changes only with an upgrade. */
export function runtimeOf(client: PolkadotClient): Promise<Runtime> {
  let r = cache.get(client);
  if (!r) {
    r = load(client);
    r.catch(() => cache.delete(client));
    cache.set(client, r);
  }
  return r;
}

async function load(client: PolkadotClient): Promise<Runtime> {
  const block = await client.getFinalizedBlock();
  const raw = await client.getMetadata(block.hash);
  const meta = unifyMetadata(decAnyMetadata(raw));
  const lookup = getLookupFn(meta);
  const variants = (ref: { type: number } | undefined) => {
    if (!ref) return [];
    const e = lookup(ref.type);
    return e.type === "enum" ? Object.entries(e.value) : [];
  };
  const pallets: PalletDef[] = meta.pallets
    .map((p) => ({
      name: p.name,
      calls: variants(p.calls as any).map(([name, v]: [string, any]) => ({
        name,
        docs: (lookup(p.calls!.type) as any).innerDocs?.[name] ?? [],
        fields: fieldsOf(v),
      })),
      storage: (p.storage?.items ?? []).map((s) => {
        if (s.type.tag === "plain") return { name: s.name, docs: s.docs, keys: [], value: lookup(s.type.value) };
        const m = s.type.value;
        const k = lookup(m.key);
        const keys = m.hashers.length > 1 && k.type === "tuple" ? k.value : [k];
        return { name: s.name, docs: s.docs, keys, value: lookup(m.value) };
      }),
      constants: p.constants.map((c) => ({ name: c.name, docs: c.docs, type: lookup(c.type) })),
    }))
    .sort((a, b) => a.name.localeCompare(b.name));
  let specName: string | null = null;
  let specVersion: number | null = null;
  try {
    const v = await (client.getUnsafeApi() as any).constants.System.Version();
    specName = v.spec_name ?? null;
    specVersion = v.spec_version ?? null;
  } catch {
    /* a chain without System.Version still browses */
  }
  return { block: { hash: block.hash, number: block.number }, specName, specVersion, pallets, lookup, meta, dyn: getDynamicBuilder(lookup) };
}

function fieldsOf(v: any): Field[] {
  if (v.type === "void") return [];
  if (v.type === "struct") return Object.entries(v.value).map(([name, t]) => ({ name, type: t as LookupEntry, docs: v.innerDocs?.[name] ?? [] }));
  if (v.type === "tuple") return v.value.map((t: LookupEntry, i: number) => ({ name: String(i), type: t, docs: [] }));
  if (v.type === "lookupEntry") return [{ name: "0", type: v.value, docs: [] }];
  return [{ name: "0", type: v, docs: [] }];
}

const isBytes = (e: LookupEntry) =>
  (e.type === "sequence" || e.type === "array") && e.value.type === "primitive" && e.value.value === "u8";
const big = (p: string) => /^[ui](64|128|256)$/.test(p);

/** A short name for a type, for labels: "u128", "AccountId", "Vec<u8>", "Option<…>". */
export function typeName(e: LookupEntry): string {
  switch (e.type) {
    case "primitive":
      return e.value;
    case "compact":
      return `Compact<${e.size}>`;
    case "AccountId32":
    case "AccountId20":
      return "AccountId";
    case "void":
      return "()";
    case "bitSequence":
      return "BitSeq";
    case "option":
      return `Option<${typeName(e.value)}>`;
    case "sequence":
      return isBytes(e) ? "Bytes" : `Vec<${typeName(e.value)}>`;
    case "array":
      return isBytes(e) ? `[u8; ${e.len}]` : `[${typeName(e.value)}; ${e.len}]`;
    case "tuple":
      return `(${e.value.map(typeName).join(", ")})`;
    case "struct":
      return "{…}";
    case "enum": {
      const names = Object.keys(e.value);
      return names.length > 4 ? `${names.slice(0, 3).join(" | ")} | …` : names.join(" | ");
    }
    case "result":
      return "Result";
  }
}

/** The JSON shape a value of this type takes, with blanks to fill. */
export function template(e: LookupEntry, depth = 0): unknown {
  if (depth > 8) return null;
  switch (e.type) {
    case "primitive":
      return e.value === "bool" ? false : e.value === "str" || e.value === "char" ? "" : "0";
    case "compact":
      return "0";
    case "AccountId32":
    case "AccountId20":
      return "";
    case "void":
      return null;
    case "bitSequence":
      return [];
    case "option":
      return null;
    case "sequence":
      return isBytes(e) ? "0x" : [];
    case "array":
      return isBytes(e) ? "0x" + "00".repeat(e.len) : Array.from({ length: e.len }, () => template(e.value, depth + 1));
    case "tuple":
      return e.value.map((x) => template(x, depth + 1));
    case "struct":
      return Object.fromEntries(Object.entries(e.value).map(([k, v]) => [k, template(v, depth + 1)]));
    case "enum": {
      const [name, v] = Object.entries(e.value)[0];
      const inner = (v as any).type === "lookupEntry" ? (v as any).value : v;
      return { type: name, value: (inner as any).type === "void" ? null : template(inner as LookupEntry, depth + 1) };
    }
    case "result":
      return { success: true, value: template(e.value.ok, depth + 1) };
  }
}

/** A call's arguments as a template: one key per field. */
export const callTemplate = (c: CallDef) => Object.fromEntries(c.fields.map((f) => [f.name, template(f.type)]));

/**
 * The member's JSON, turned into what the chain takes. Throws with the path of
 * the first value that does not fit, e.g. "dest.value: not an address".
 */
export function toChain(e: LookupEntry, v: unknown, path = "value"): unknown {
  const bad = (why: string): never => {
    throw new Error(`${path}: ${why}`);
  };
  switch (e.type) {
    case "primitive": {
      if (e.value === "bool") return typeof v === "boolean" ? v : v === "true" ? true : v === "false" ? false : bad("true or false");
      if (e.value === "str" || e.value === "char") return typeof v === "string" ? v : bad("text");
      const s = typeof v === "number" ? String(v) : typeof v === "string" ? v.trim() : bad("a whole number");
      if (!/^-?\d+$/.test(s)) bad("a whole number");
      if (s.startsWith("-") && e.value.startsWith("u")) bad("not below zero");
      return big(e.value) ? BigInt(s) : Number(s);
    }
    case "compact": {
      const s = typeof v === "number" ? String(v) : typeof v === "string" ? v.trim() : bad("a whole number");
      if (!/^\d+$/.test(s)) bad("a whole number");
      return e.isBig ? BigInt(s) : Number(s);
    }
    case "AccountId32":
      return typeof v === "string" && v.trim() ? v.trim() : bad("an address");
    case "AccountId20":
      return typeof v === "string" && /^0x[0-9a-fA-F]{40}$/.test(v.trim()) ? v.trim() : bad("a 0x address of 20 bytes");
    case "void":
      return undefined;
    case "bitSequence":
      return bad("bit sequences can't be written here yet");
    case "option":
      return v == null ? undefined : toChain(e.value, v, path);
    case "sequence":
    case "array": {
      if (isBytes(e)) {
        if (typeof v !== "string") return bad("0x hex, or text");
        const b = /^0x([0-9a-fA-F]{2})*$/.test(v) ? Binary.fromHex(v as `0x${string}`) : Binary.fromText(v);
        if (e.type === "array" && b.asBytes().length !== e.len) bad(`exactly ${e.len} bytes`);
        return b;
      }
      if (!Array.isArray(v)) return bad("a list");
      if (e.type === "array" && v.length !== e.len) bad(`exactly ${e.len} items`);
      return v.map((x, i) => toChain(e.value, x, `${path}[${i}]`));
    }
    case "tuple":
      if (!Array.isArray(v) || v.length !== e.value.length) return bad(`a list of ${e.value.length}`);
      return e.value.map((t, i) => toChain(t, v[i], `${path}[${i}]`));
    case "struct": {
      if (!v || typeof v !== "object" || Array.isArray(v)) return bad("an object");
      const o = v as Record<string, unknown>;
      return Object.fromEntries(Object.entries(e.value).map(([k, t]) => [k, toChain(t, o[k], `${path}.${k}`)]));
    }
    case "enum": {
      const o = v as { type?: string; value?: unknown };
      if (!o || typeof o !== "object" || typeof o.type !== "string") return bad(`{ "type": one of ${Object.keys(e.value).slice(0, 6).join(", ")} }`);
      const variant = (e.value as any)[o.type];
      if (!variant) return bad(`no option called ${o.type}`);
      const inner = variant.type === "lookupEntry" ? variant.value : variant;
      return { type: o.type, value: inner.type === "void" ? undefined : toChain(inner, o.value, `${path}.value`) };
    }
    case "result":
      return bad("results can't be written here");
  }
}

/** Binary by shape, not class: a second copy of polkadot-api makes its own class. */
const isBinary = (v: unknown): v is Binary =>
  !!v && typeof v === "object" && typeof (v as any).asHex === "function" && typeof (v as any).asBytes === "function";

/** Anything polkadot-api hands back, made readable as JSON. */
export function toJson(v: unknown): unknown {
  if (typeof v === "bigint") return v.toString();
  if (isBinary(v)) {
    const b = v.asBytes();
    const t = new TextDecoder("utf-8", { fatal: false }).decode(b);
    return b.length && /^[\x20-\x7e]+$/.test(t) ? t : v.asHex();
  }
  if (v instanceof Uint8Array) return "0x" + Array.from(v, (x) => x.toString(16).padStart(2, "0")).join("");
  if (Array.isArray(v)) return v.map(toJson);
  if (v && typeof v === "object") {
    const o = v as Record<string, unknown>;
    // a void enum variant reads as its name alone
    if (typeof o.type === "string" && Object.keys(o).length <= 2 && o.value === undefined) return o.type;
    return Object.fromEntries(Object.entries(o).filter(([, x]) => x !== undefined).map(([k, x]) => [k, toJson(x)]));
  }
  return v;
}

export const pretty = (v: unknown) => JSON.stringify(toJson(v), null, 2) ?? "null";

// ── blocks ──────────────────────────────────────────────────────────────────

export interface Extrinsic {
  index: number;
  /** pallet.call */
  name: string;
  /** who signed it, or null for the chain's own (inherent) calls */
  signer: string | null;
  args: unknown;
}

/**
 * Read one extrinsic from its bytes using the chain's own metadata: version 4
 * (bare or signed) and version 5 (bare or general). The decoders don't say how
 * far they read, so each part is encoded again to measure it.
 */
export function decodeExtrinsic(rt: Runtime, hex: string, index: number): Extrinsic {
  const bytes = Uint8Array.from(hex.slice(2).match(/../g) ?? [], (x) => parseInt(x, 16));
  const len = compact.dec(bytes);
  let at = compact.enc(len).length;
  const v = bytes[at++];
  const version = v & 0x3f;
  const kind = v >> 6; // 0 bare, 2 signed (v4), 1 general (v5)
  const ex: any = rt.meta.extrinsic;
  const take = (id: number) => {
    const c = rt.dyn.buildDefinition(id);
    const value = c.dec(bytes.slice(at));
    at += c.enc(value).length;
    return value;
  };
  const extensions = (ver: number) => {
    for (const e of ex.signedExtensions?.[ver] ?? []) take(e.type);
  };
  let signer: string | null = null;
  if (kind === 2 && version === 4) {
    if (ex.address == null) throw new Error("this chain's metadata doesn't describe signed calls");
    const addr = take(ex.address);
    take(ex.signature);
    extensions(0);
    signer = typeof addr === "string" ? addr : typeof addr?.value === "string" ? addr.value : JSON.stringify(toJson(addr));
  } else if (kind === 1 && version === 5) {
    extensions(bytes[at++]);
  }
  const callType = ex.call ?? rt.lookup.call;
  if (callType == null) throw new Error("this chain's metadata doesn't describe its calls");
  const call = rt.dyn.buildDefinition(callType).dec(bytes.slice(at));
  return { index, name: `${call.type}.${call.value.type}`, signer, args: toJson(call.value.value ?? null) };
}

export interface BlockView {
  number: number;
  hash: string;
  extrinsics: (Extrinsic | { index: number; error: string })[];
  events: { phase: string; name: string; data: unknown }[];
}

export async function readBlock(client: PolkadotClient, rt: Runtime, block: { number: number; hash: string }): Promise<BlockView> {
  const api = client.getUnsafeApi() as any;
  const [body, events] = await Promise.all([
    client.getBlockBody(block.hash),
    api.query.System.Events.getValue({ at: block.hash }).catch(() => []),
  ]);
  return {
    ...block,
    extrinsics: body.map((h, i) => {
      try {
        return decodeExtrinsic(rt, h, i);
      } catch (e: any) {
        return { index: i, error: String(e?.message ?? e) };
      }
    }),
    events: (events as any[]).map((e) => ({
      phase: e.phase?.type === "ApplyExtrinsic" ? `call ${e.phase.value}` : String(e.phase?.type ?? "").replace(/([a-z])([A-Z])/g, "$1 $2").toLowerCase(),
      name: `${e.event.type}.${e.event.value.type}`,
      data: toJson(e.event.value.value ?? null),
    })),
  };
}
