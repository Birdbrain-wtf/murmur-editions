/**
 * Every plugin mounts against the fake host, and meets the module contract.
 *
 * A ratchet, not a wish list. `REACHES_PAST_HOST` names the plugins that today
 * need something the host does not hand them (browser storage, the app's
 * registry, the identity provider). They are listed so CI passes now. A plugin
 * on that list that starts mounting cleanly fails until it is taken off, and a
 * new plugin that reaches past the host fails until it is fixed or added here
 * with a reason. The list only shrinks. Context: ADR 0080 step 4, the sandbox.
 */
import { beforeAll, describe, expect, test } from "bun:test";
import { createElement } from "react";
import { blockNetwork, fakeContext, installBrowser } from "./plugin-host";

const REACHES_PAST_HOST: Record<string, string> = {
  agent: "imports the app's plugin registry, which only Vite can build",
  invite: "imports the app's plugin registry, which only Vite can build",
  chat: "reads the identity provider directly instead of its context",
  onchain: "reads the identity provider directly instead of its context",
  watch: "reads the identity provider directly instead of its context",
};

const KEBAB = /^[a-z0-9][a-z0-9-]*$/;
const files = [...new Bun.Glob("src/plugins/*/index.tsx").scanSync(".")].sort();

beforeAll(() => {
  installBrowser();
  process.env.BASE_URL ??= "/";
});

describe("plugins against the test host", () => {
  for (const file of files) {
    const id = file.split("/")[2];
    test(id, async () => {
      const { reach, restore } = blockNetwork();
      let failure: string | null = null;
      try {
        const m = await import(`../../${file}`);
        const mod = Object.values(m).find((x: any) => x?.kind === "plugin" && x?.Panel) as any;
        expect(mod, "exports a plugin module").toBeTruthy();
        expect(mod.id).toMatch(KEBAB);
        expect(mod.support?.href, "says where help and bug reports go").toBeTruthy();

        const { createRoot } = await import("react-dom/client");
        const { act } = await import("react");
        const el = document.createElement("div");
        document.body.appendChild(el);
        const root = createRoot(el);
        const errors: unknown[] = [];
        const onError = (e: ErrorEvent) => errors.push(e.error ?? e.message);
        window.addEventListener("error", onError);
        await act(async () => root.render(createElement(mod.Panel, fakeContext())));
        await act(async () => new Promise((r) => setTimeout(r, 20)));
        await act(async () => root.unmount());
        window.removeEventListener("error", onError);
        el.remove();
        if (errors.length) throw errors[0];
      } catch (e) {
        failure = String((e as Error)?.message ?? e);
      } finally {
        restore();
      }

      if (id in REACHES_PAST_HOST) {
        expect(failure, `${id} now mounts against the host: take it off REACHES_PAST_HOST`).not.toBeNull();
      } else {
        expect(failure, `${id} reaches past the host`).toBeNull();
      }
      if (reach.origins.size) console.log(`  ${id} reached for: ${[...reach.origins].join(", ")}`);
    });
  }
});
