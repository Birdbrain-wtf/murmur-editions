/**
 * The chain, checked on this device (ADR 0068).
 *
 * The desktop app runs smoldot, a light client, in its Rust back end
 * (src-tauri/src/chain.rs). It follows the chain's finality proofs itself, so a
 * block number shown here is one this computer checked, not one a server
 * reported. `useChain` polls the snapshot; `chainCall` sends one JSON-RPC call
 * through the light client.
 *
 * In a plain browser there is no light client, and the status says so rather
 * than falling back to a server and calling that checked.
 */
import { useEffect, useState } from "react";

const isTauri = typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
export const hasLightClient = isTauri;

export interface ChainStatus {
  running: boolean;
  chain: string;
  genesis?: string | null;
  best?: number | null;
  finalized?: number | null;
  finalizedHash?: string | null;
  /** unix ms when the last finalised block arrived */
  finalizedAt?: number | null;
  peers?: number | null;
  syncing?: boolean | null;
  specName?: string | null;
  specVersion?: number | null;
  startedAt: number;
  error?: string | null;
}

async function invoke<T>(cmd: string, args: Record<string, unknown> = {}): Promise<T> {
  const { invoke } = await import("@tauri-apps/api/core");
  return invoke<T>(cmd, args);
}

export async function chainStatus(): Promise<ChainStatus> {
  if (!isTauri) {
    return { running: false, chain: "", startedAt: 0, error: "The light client runs in the desktop app, not in a browser." };
  }
  return invoke<ChainStatus>("chain_status");
}

/** One JSON-RPC call answered from proofs the light client checked. */
export async function chainCall<T = unknown>(method: string, params: unknown[] = []): Promise<T> {
  if (!isTauri) throw new Error("The light client runs in the desktop app.");
  return invoke<T>("chain_rpc", { method, params });
}

export function useChain(everyMs = 3000): ChainStatus | null {
  const [s, setS] = useState<ChainStatus | null>(null);
  useEffect(() => {
    let live = true;
    const tick = () => chainStatus().then((v) => live && setS(v)).catch((e) => live && setS({ running: false, chain: "", startedAt: 0, error: String(e) }));
    tick();
    if (!isTauri) return () => { live = false; };
    const t = setInterval(tick, everyMs);
    return () => { live = false; clearInterval(t); };
  }, [everyMs]);
  return s;
}

/**
 * Keep a copy: the optional full node (ADR 0068, step 2, src-tauri/src/node.rs).
 *
 * Off by default. Switched on, the app fetches the node program from
 * birdbrain.wtf, checks it against Birdbrain's release key, and runs it while
 * the computer is on mains power. It holds every block and never makes one.
 */
export interface NodeStatus {
  enabled: boolean;
  phase: "off" | "fetching" | "waiting-for-power" | "starting" | "syncing" | "synced" | "error";
  version?: string | null;
  fetchedBytes?: number | null;
  fetchTotal?: number | null;
  best?: number | null;
  highest?: number | null;
  peers?: number | null;
  diskBytes?: number | null;
  onMains: boolean;
  error?: string | null;
}

export async function nodeStatus(): Promise<NodeStatus | null> {
  if (!isTauri) return null;
  return invoke<NodeStatus>("node_status");
}

export async function setKeepCopy(enabled: boolean): Promise<NodeStatus> {
  return invoke<NodeStatus>("node_set_enabled", { enabled });
}

export async function removeCopy(): Promise<NodeStatus> {
  return invoke<NodeStatus>("node_remove");
}

export function useNode(everyMs = 3000): [NodeStatus | null, (s: NodeStatus) => void] {
  const [s, setS] = useState<NodeStatus | null>(null);
  useEffect(() => {
    if (!isTauri) return;
    let live = true;
    const tick = () => nodeStatus().then((v) => live && setS(v)).catch(() => {});
    tick();
    const t = setInterval(tick, everyMs);
    return () => { live = false; clearInterval(t); };
  }, [everyMs]);
  return [s, setS];
}
