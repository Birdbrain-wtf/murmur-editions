import type { MurmurModule, InstanceConfig } from "./types";
import { identitySurface } from "../identity";
import { notesSurface } from "../notes";
import { settingsSurface } from "../settings";
import { app, edition, installs, offers, shaped, STANDARD } from "../edition";
import { madeModules } from "../demo/made";
import { howSurface } from "../demo/how";

/**
 * The instance this client is bound to. Each edition ships pointed at one
 * home (Murmur at Birdbrain, Decent at Decent; see `../edition.ts`). The `network` plugin lets it discover and link to
 * other instances. The sovereignty arc: these origins move from rented infra
 * to boxes Decent owns under `decent.partners`.
 */
export const instance: InstanceConfig = {
  slug: edition.instance.slug,
  name: edition.instance.name,
  // Dev uses Vite's proxy (relative base ""); a packaged build has no proxy and
  // must hit the origin directly, so fall back to the production host there.
  birdbrainBase:
    import.meta.env.VITE_BIRDBRAIN_BASE ??
    // The dev proxy only reaches the build's own collective; a space the member
    // added goes straight to its origin.
    (import.meta.env.DEV && edition.id === app.id ? "" : edition.origin),
  matrixHomeserver:
    import.meta.env.VITE_MATRIX_HOMESERVER ?? "https://matrix.decent.partners",
};

/** Core surfaces — always mounted, never uninstallable. Notes sits at the top
 *  of the body; settings and identity are pinned to the foot of the rail. */
export const coreModules: MurmurModule[] = [
  notesSurface,
  settingsSurface,
  identitySurface,
  // the invented demo's closing chapter: what's underneath, and why it matters
  ...(edition.showcase ? [howSurface] : []),
];

/**
 * Installable plugins — the catalog the user adds from over time.
 *
 * Auto-discovered: every folder under `src/plugins/` that exports a
 * `MurmurModule` with `kind: "plugin"` is picked up here at build time via
 * Vite's `import.meta.glob`. Adding a plugin is therefore just adding its
 * folder (`bun run new-plugin <id>` scaffolds one) — this file never changes,
 * so parallel plugin branches never collide on the registry.
 */
const discovered = import.meta.glob<Record<string, unknown>>(
  "../plugins/*/index.tsx",
  { eager: true },
);

function isPlugin(x: unknown): x is MurmurModule {
  return (
    typeof x === "object" &&
    x !== null &&
    "id" in x &&
    "Panel" in x &&
    (x as { kind?: unknown }).kind === "plugin"
  );
}

/**
 * The first public release ships a deliberately small surface. Every plugin
 * folder is still auto-discovered above, but only those listed here are
 * surfaced in the catalog and rail — the rest stay in the codebase, hidden,
 * and are added back by appending their id as their backends mature.
 *
 * Set per edition (`../edition.ts`): the standard tier, the edition's custom
 * plugins, its starter and market picks, and its optional ones.
 */
export const RELEASE_PLUGINS = [
  ...offers(edition),
  // Plugins held back from every edition can be surfaced in a local build to try
  // them: VITE_EXTRA_PLUGINS=exchange bun run dev
  ...String(import.meta.env.VITE_EXTRA_PLUGINS ?? "").split(",").map((s) => s.trim()).filter(Boolean),
];

/** Where a plugin sits in the rail: the edition's own order first, then its weight. */
export function rank(m: Pick<MurmurModule, "id" | "order">): number {
  const at = edition.rail?.indexOf(m.id) ?? -1;
  return at >= 0 ? at - 1000 : m.order;
}

export const pluginCatalog: MurmurModule[] = [
  ...Object.values(discovered).flatMap((mod) => Object.values(mod)),
  // plugins sketched for a visitor's own group, in the invented demo
  ...madeModules(shaped),
]
  .filter(isPlugin)
  .filter((p) => RELEASE_PLUGINS.includes(p.id))
  .sort((a, b) => rank(a) - rank(b));

/** Plugins installed on a fresh client — the full v1 surface. Notes (core) is
 *  always mounted alongside these. Collaborate lives inside Notes. Anything
 *  held back from `RELEASE_PLUGINS` cannot be installed until it's released. */
export const DEFAULT_INSTALLED = installs(edition);

/** The standard tier: always installed, never removable. */
export const isStandard = (id: string) => STANDARD.includes(id);

const all = [...coreModules, ...pluginCatalog];

export function getModule(id: string): MurmurModule | undefined {
  return all.find((m) => m.id === id);
}
