/**
 * A fake host for plugins, so a plugin can be mounted and checked in CI without
 * the app, a door, a chain or a network.
 *
 * Copied in spirit from Parity's product-sdk (`packages/host/src/testing.ts`,
 * d0d4a90, Apache-2.0): the plugin gets only what the host hands it, and
 * reaching past the host fails loudly instead of half-working.
 *
 * It also measures how far each plugin is from the sandbox in ADR 0080. A
 * sandboxed plugin may only use its `PluginContext`. Today plugins also read
 * browser storage, the app's registry and the identity provider directly, and
 * fetch whatever they like. The host records every outbound request, so the
 * origins a plugin reaches are a list we can see before we make it declare them.
 */
import { GlobalRegistrator } from "@happy-dom/global-registrator";
import type { PluginContext } from "../../src/host/types";

export interface Reach {
  /** origins the plugin tried to fetch during mount */
  origins: Set<string>;
}

let registered = false;

/** Put a browser in place (window, document, storage) once per test process. */
export function installBrowser() {
  if (registered) return;
  GlobalRegistrator.register({ url: "http://plugin-host.test/" });
  registered = true;
}

/** Block the network for the duration of a mount and record what was asked for. */
export function blockNetwork(): { reach: Reach; restore: () => void } {
  const reach: Reach = { origins: new Set() };
  const real = globalThis.fetch;
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    reach.origins.add(new URL(url, "http://plugin-host.test/").origin);
    throw new TypeError("the test host has no network");
  }) as typeof fetch;
  return { reach, restore: () => void (globalThis.fetch = real) };
}

/** The context a plugin gets from the host: Alice, signed in, in a collective called Test. */
export function fakeContext(over: Partial<PluginContext> = {}): PluginContext & { opened: string[] } {
  const opened: string[] = [];
  return {
    identity: { handle: "alice", localId: "local-alice", did: null, signedIn: true, userId: "u-alice", session: null },
    installed: [],
    instance: { slug: "test", name: "Test", birdbrainBase: "http://door.test", matrixHomeserver: "http://matrix.test" },
    open: (id: string) => void opened.push(id),
    opened,
    ...over,
  };
}
