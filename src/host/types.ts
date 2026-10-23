import type { ComponentType } from "react";
import type { LucideIcon } from "lucide-react";

/**
 * The Decent module contract (type name kept as the codename `Murmur*`).
 *
 * A Decent instance is a thin host that mounts modules. Two are *core* and
 * always present — `identity` (who you are + your participation) and `notes`
 * (personal sensemaking). Everything else is a *plugin* the user installs over
 * time from the catalog: `understand` (Birdbrain), `chat` (Matrix), `meet`
 * (Jitsi), `mail` (email) and `network` (federation). All implement this
 * one interface, so the shell treats them uniformly.
 */
interface ModuleBase {
  /** stable id, kebab-case (e.g. "chat", "understand", "network") */
  id: string;
  /** human label shown in the rail */
  title: string;
  /** one-line description for tooltips / the catalog */
  tagline: string;
  /** rail / catalog icon */
  icon: LucideIcon;
  /** ordering weight in the rail (lower = higher) */
  order: number;
  /** the panel rendered when this module is active */
  Panel: ComponentType<PluginContext>;
  /**
   * What this module binds to — surfaced in the catalog (e.g. "Matrix
   * homeserver", "Self-hosted email"). Sovereign targets the user owns.
   */
  backend?: string;
  /**
   * Plugins that need the heavier Electron client (multiple live Matrix syncs
   * + per-peer sandboxes) flag the upgrade path. The rail marks them.
   */
  needsUpgrade?: boolean;
  /** optional live status dot for the rail (e.g. connected / syncing) */
  useStatus?: () => PluginStatus;
  /**
   * Lab: early, experimental, here for testing (Swap and Exchange, which move
   * test money only). It may change or go away. The catalog, the rail and the
   * Suggest panel say so. Drop the flag when the plugin is ready for real use.
   */
  lab?: boolean;
  /**
   * The collective that made it, shown on market plugins. Unset means Decent.
   * (Which tier a plugin sits in is per edition: `tierOf` in `../edition.ts`.)
   */
  by?: string;
}

/**
 * Where someone goes for help with this plugin, or to report a bug in it:
 * a specific route, alongside the general Suggest button. Build one with
 * `issues()` or `email()` from `./support`.
 */
export interface Support {
  /** what the link says, e.g. "Report it on GitHub" */
  label: string;
  href: string;
}

/**
 * "core" modules are always mounted (identity, notes). "plugin" modules are
 * installed by the user over time from the catalog, and every plugin must say
 * where its help and bug reports go.
 */
export type MurmurModule =
  | (ModuleBase & { kind: "core"; support?: Support })
  | (ModuleBase & { kind: "plugin"; support: Support });

/** Back-compat alias — modules were formerly all called "plugins". */
export type MurmurPlugin = MurmurModule;

export type PluginStatus =
  | { kind: "idle" }
  | { kind: "active"; label?: string }
  | { kind: "warn"; label?: string }
  | { kind: "error"; label?: string };

/** Identity surfaced to every module. Passkey today → Kreivo DID later. */
export interface Identity {
  /** display handle (birdbrain-layer name) */
  handle: string | null;
  /** opaque local id derived from the passkey credential */
  localId: string | null;
  /** did:kreivo:… once on-chain identity is wired */
  did: string | null;
  signedIn: boolean;
  /** the member id at the edition's door, once signed in with a passkey */
  userId?: string | null;
  /** the app's session token from that door (identifies, never authorises) */
  session?: string | null;
  /** when that session runs out, unix seconds */
  sessionExp?: number | null;
  /** signed out because the door stopped accepting the session: the name it was for */
  lapsedAs?: string | null;
}

/** What the host passes to each module panel. */
export interface PluginContext {
  identity: Identity;
  installed?: string[];
  /** the instance this client is bound to (its own birdbrain) */
  instance: InstanceConfig;
  /** ask the host to switch the active module */
  open: (moduleId: string) => void;
}

/** Configuration of the instance this client speaks for. */
export interface InstanceConfig {
  /** e.g. "decent" */
  slug: string;
  /** e.g. "Decent" */
  name: string;
  /** base origin for this instance's birdbrain API ("" = same-origin/dev proxy) */
  birdbrainBase: string;
  /** Matrix homeserver this instance federates over */
  matrixHomeserver: string;
}
