/**
 * Kreivo, read through the light client (src/lib/hub.ts, chain `kreivo`).
 *
 * `countMembers` counts a community's members the way the explorer does
 * (infra/services/explorer/explorer.ts, `holdings`): every membership item in
 * the community's collection, less those the community's own account still
 * holds, counted by distinct owner. Run through the light client, the answer
 * comes from proofs this computer checked.
 */
import { getSs58AddressInfo, type PolkadotClient } from "polkadot-api";

const hex = (b: Uint8Array) => Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");

/** A community's own account: `modlkv/cmtys` ++ id (u16 LE), zero-padded, as a hex public key. */
export function communityKey(id: number): string {
  const raw = new Uint8Array(32);
  raw.set([...new TextEncoder().encode("modlkv/cmtys"), id & 0xff, (id >> 8) & 0xff]);
  return hex(raw);
}

const keyOf = (a: string) => {
  const i = getSs58AddressInfo(a);
  return i.isValid ? hex(i.publicKey) : a;
};

export async function countMembers(client: PolkadotClient, community: number): Promise<{ count: number; memberships: number; block: number }> {
  const block = await client.getFinalizedBlock();
  const api = client.getUnsafeApi() as any;
  const entries: { keyArgs: unknown[]; value: { owner: string } }[] = await api.query.CommunityMemberships.Item.getEntries(community, {
    at: block.hash,
  });
  const own = communityKey(community);
  const issued = entries.map((e) => keyOf(e.value.owner)).filter((k) => k !== own);
  return { count: new Set(issued).size, memberships: issued.length, block: block.number };
}
