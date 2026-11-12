---
name: writing-a-plugin
description: Add or change a plugin in this app (a folder under src/plugins/). Use when asked to build a new plugin, change what a plugin does, or get a plugin past the plugin test host. Covers the module contract, what a plugin may and may not reach, how it is tested, and how a plugin will get its own account.
compatibility: Any coding agent with a shell and Bun. Written for this repository.
license: Apache-2.0
---

# Writing a plugin

A plugin is one folder, `src/plugins/<id>/index.tsx`, exporting a module with `kind: "plugin"`. The app finds it by itself. Nothing else needs editing.

## Start

```bash
bun run new-plugin <id>   # kebab-case, e.g. good-news
bun run dev               # the plugin shows in the catalogue
bun run test              # it must mount against the test host
```

## The contract

The type is `MurmurModule` in `src/host/types.ts`. Every plugin needs:

- `id`, kebab-case and stable. It names the plugin's account later, so never rename it.
- `title`, `tagline`, `icon`, `order`, and `Panel`, the component the app shows.
- `support`, where help and bug reports go. Build it with `issues()` or `email()` from `src/host/support.ts`.
- `lab: true` while it is experimental, so the catalogue says so.

## Use only what the host hands you

`Panel` receives a `PluginContext`: who the member is (`identity`), which collective this is (`instance`), what is installed, and `open()` to switch to another plugin. Build on that and nothing else.

Plugins will be sandboxed (ADR 0080). A plugin that reaches past its context today will break then. So do not:

- import from `src/host/` beyond `types` and `support`, or from another plugin's folder
- call `useIdentity()` or read the app's identity provider. Use `identity` from the context
- read or write `localStorage` keys that are not prefixed with your plugin id
- hold, read or ask for the member's words or keys. The app signs, the plugin asks

## Accounts

A plugin that needs to act on chain will get its own account per collective, derived from the member's words at `//product//<plugin>.<collective>/<index>` (`src/lib/plugin-account.ts`, the same construction the Polkadot App hosts use). The plugin is given the subtree public key and can see its own addresses. It never sees a secret. `plugin.collective` must be 31 characters or fewer. This is built and tested and not wired in yet, so do not depend on it until ADR 0080 is accepted.

## The test host

`scripts/tests/plugins-mount.test.tsx` mounts every plugin against a fake host (`scripts/tests/plugin-host.ts`): Alice, signed in, in a collective called Test, with the network blocked and every origin the plugin reached for printed.

- A new plugin must mount cleanly. If it throws, it is reaching past the host. Fix that rather than adding it to `REACHES_PAST_HOST`.
- That list names the plugins that still reach past the host today. It only shrinks. When you fix one, the test fails until you take it off.
- Read the "reached for" lines. Every origin there is one the plugin will have to declare once the host is its only way out.

## Before you hand it back

`bun run test` and `bun run build` both pass, and the plugin opens in `bun run dev`.
