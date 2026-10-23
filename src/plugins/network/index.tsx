import { useState } from "react";
import { Network, Radio, Plus, ArrowUpRight, Lock } from "lucide-react";
import type { MurmurPlugin, PluginContext } from "../../host/types";
import { issues } from "../../host/support";

/**
 * Network plugin — federation.
 *
 * A single Decent instance is one birdbrain. The network plugin is how instances find
 * and link to each other: a peer's `understand` corpus and `chat` rooms become
 * reachable, and queries can fan out across the federation. Multi-instance
 * federation is the "network tier" — it's the capability that justifies the
 * heavier Electron client (multiple long-lived Matrix syncs + per-peer
 * sandboxes), which a single Tauri webview isn't built to hold.
 */

interface Peer {
  slug: string;
  name: string;
  homeserver: string;
  status: "self" | "known" | "invite";
  members?: number;
}

const SEED_PEERS: Peer[] = [
  {
    slug: "decent",
    name: "Decent · Birdbrain",
    homeserver: "matrix.org",
    status: "self",
    members: 25,
  },
  {
    slug: "lifehouses",
    name: "Lifehouses",
    homeserver: "matrix.org",
    status: "known",
    members: 27,
  },
  {
    slug: "four-to-the-floor",
    name: "Four To The Floor",
    homeserver: "matrix.org",
    status: "invite",
  },
];

function Panel({ instance }: PluginContext) {
  const [peers] = useState<Peer[]>(SEED_PEERS);

  return (
    <div className="flex h-full flex-col">
      <header className="border-b border-[var(--line)] px-8 pt-7 pb-5">
        <div className="flex items-center gap-2 text-[11px] uppercase tracking-[0.18em] text-[var(--faint)]">
          <Network className="h-3.5 w-3.5" />
          network
        </div>
        <h1 className="font-tight mt-2 text-2xl font-medium">The federation</h1>
        <p className="mt-1 max-w-xl text-sm text-[var(--muted)]">
          One Decent instance is one mind. Link others and the flock thinks
          together — queries fan out, rooms bridge, memory compounds.
        </p>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto px-8 py-6">
        <div className="mb-3 flex items-center justify-between">
          <span className="font-mono text-[11px] uppercase tracking-wider text-[var(--faint)]">
            instances
          </span>
          <button className="prism-hover flex items-center gap-1.5 rounded-full border border-[var(--line-strong)] px-3 py-1 text-xs text-[var(--muted)]">
            <Plus className="h-3.5 w-3.5" /> add peer
          </button>
        </div>

        <div className="grid gap-2">
          {peers.map((p) => (
            <article
              key={p.slug}
              className="prism-hover flex items-center gap-4 rounded-[var(--radius)] border border-[var(--line)] bg-[var(--card)] px-4 py-3.5"
            >
              <div
                className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-[var(--line-strong)]"
                style={{
                  background:
                    p.status === "self"
                      ? "var(--spectrum)"
                      : "var(--raise)",
                }}
              >
                <Radio
                  className="h-4 w-4"
                  style={{ color: p.status === "self" ? "#fff" : "var(--muted)" }}
                />
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span className="font-tight text-sm font-medium">{p.name}</span>
                  {p.status === "self" && (
                    <span className="font-mono rounded bg-[var(--raise)] px-1.5 py-0.5 text-[9px] uppercase tracking-wider text-[var(--faint)]">
                      this instance
                    </span>
                  )}
                </div>
                <div className="font-mono mt-0.5 text-[11px] text-[var(--faint)]">
                  {p.slug} · {p.homeserver}
                  {p.members ? ` · ${p.members} voices` : ""}
                </div>
              </div>
              {p.status === "known" && (
                <button className="flex items-center gap-1 text-xs text-[#007aff]">
                  link <ArrowUpRight className="h-3.5 w-3.5" />
                </button>
              )}
              {p.status === "invite" && (
                <span className="font-mono text-[11px] text-[var(--faint)]">
                  invite pending
                </span>
              )}
            </article>
          ))}
        </div>

        <div className="mt-8 rounded-[var(--radius)] border border-dashed border-[var(--line-strong)] bg-[var(--raise)] px-5 py-4">
          <div className="flex items-center gap-2">
            <Lock className="h-4 w-4 text-[var(--muted)]" />
            <span className="font-tight text-sm font-medium">
              Federation needs the full client
            </span>
          </div>
          <p className="mt-1.5 text-[13px] leading-relaxed text-[var(--muted)]">
            Linking peers means running several live Matrix syncs and a sandbox
            per instance at once — more than a single Tauri webview holds well.
            When you link your first peer, Decent offers the{" "}
            <span className="text-[var(--fg)]">Electron upgrade</span>: the same
            plugins, multi-window, built to hold the whole flock.
          </p>
          <button className="prism-hover mt-3 inline-flex items-center gap-1.5 rounded-[var(--radius)] border border-[var(--line-strong)] px-3 py-1.5 text-xs font-medium">
            <ArrowUpRight className="h-3.5 w-3.5" /> About the upgrade path
          </button>
        </div>

        <p className="font-mono mt-6 text-[11px] text-[var(--faint)]">
          bound to {instance.name} · {instance.slug}
        </p>
      </div>
    </div>
  );
}

export const networkPlugin: MurmurPlugin = {
  id: "network",
  title: "Network",
  tagline: "Federate with other instances",
  icon: Network,
  order: 50,
  kind: "plugin",
  support: issues("network"),
  needsUpgrade: true,
  backend: "Inter-instance federation",
  Panel,
};
