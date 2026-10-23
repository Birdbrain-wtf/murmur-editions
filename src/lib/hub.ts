/**
 * Asset Hub, read through the light client on this computer (src-tauri/src/hub.rs).
 *
 * `hubClient(net)` is a polkadot-api client whose every message goes through the
 * Rust light client: `hub_send` carries a request in, and each answer comes back
 * as a `hub` event. The light client checks what it is told, so a balance or a
 * quote shown in Swap is one this computer verified.
 *
 * One client per network for the life of the window: the light client has one
 * JSON-RPC server per network, and two clients on it would read each other's
 * answers.
 *
 * In a plain browser there is no light client. A dev build reads a public server
 * instead and says so (`checked: false`); a release build in a browser has none.
 */
import { createClient, type PolkadotClient } from "polkadot-api";
import type { JsonRpcProvider } from "polkadot-api/ws-provider/web";

export type Net = "kusama" | "paseo";

const isTauri = typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

/** Whether this window can read Asset Hub at all. */
export const hasHub = isTauri || import.meta.env.DEV;
/** Whether what it reads was checked on this computer. */
export const checked = isTauri;

const PUBLIC_RPC: Record<Net, string> = {
  kusama: "wss://kusama-asset-hub-rpc.polkadot.io",
  paseo: "wss://asset-hub-paseo-rpc.n.dwellir.com",
};

function lightClientProvider(net: Net): JsonRpcProvider {
  return (onMessage) => {
    let closed = false;
    let unlisten: (() => void) | null = null;
    let send: ((msg: string) => void) | null = null;
    const queue: string[] = [];
    (async () => {
      const [{ listen }, { invoke }] = await Promise.all([
        import("@tauri-apps/api/event"),
        import("@tauri-apps/api/core"),
      ]);
      unlisten = await listen<{ net: string; msg: string }>("hub", (e) => {
        if (!closed && e.payload.net === net) onMessage(e.payload.msg);
      });
      await invoke("hub_start", { net });
      send = (msg) => void invoke("hub_send", { net, msg }).catch(() => {});
      for (const m of queue.splice(0)) send(m);
    })();
    return {
      send: (msg) => (send ? send(msg) : queue.push(msg)),
      disconnect: () => {
        closed = true;
        unlisten?.();
      },
    };
  };
}

const clients = new Map<Net, Promise<PolkadotClient>>();

export function hubClient(net: Net): Promise<PolkadotClient> {
  let c = clients.get(net);
  if (!c) {
    c = isTauri
      ? Promise.resolve(createClient(lightClientProvider(net)))
      : Promise.all([import("polkadot-api/ws-provider/web"), import("polkadot-api/polkadot-sdk-compat")]).then(
          ([{ getWsProvider }, { withPolkadotSdkCompat }]) =>
            createClient(withPolkadotSdkCompat(getWsProvider(PUBLIC_RPC[net]))),
        );
    clients.set(net, c);
  }
  return c;
}
