import { useState } from "react";
import {
  Hammer,
  Copy,
  Check,
  Loader2,
  Settings2,
  Sparkles,
  ArrowUpRight,
} from "lucide-react";
import type { MurmurPlugin, PluginContext } from "../../host/types";
import { issues } from "../../host/support";

/**
 * Build plugin — turn a user into a maintainer.
 *
 * Decent's thesis is "the shell is the product; the modules are the proof." The
 * build plugin closes that loop: it lets anyone in the flock forge a new module
 * for their own instance. The agentic compute is a *pluggable backend*, not
 * something baked into the webview — so the SOVEREIGN default is "copy the
 * brief and run it with your own agent (your Zo, your Claude, your keys)". A
 * hosted forge endpoint is an optional convenience that degrades gracefully:
 * if it isn't reachable, the brief still works. That keeps build aligned with
 * resilience — no single agent backend is a point of failure.
 */

const BACKEND_KEY = "murmur.build.backend.v1";

interface Spec {
  id: string;
  title: string;
  tagline: string;
  backend: string;
  purpose: string;
}

function camelId(id: string): string {
  return id
    .split(/[-_\s]+/)
    .filter(Boolean)
    .map((w, i) => (i === 0 ? w : w[0].toUpperCase() + w.slice(1)))
    .join("");
}

/**
 * The real artifact: a complete, self-contained prompt any agent can execute to
 * scaffold a parallel-safe Decent plugin. This is what makes a user a builder.
 */
function brief(s: Spec): string {
  const id = s.id.trim() || "<id>";
  const exportName = `${camelId(id) || "my"}Plugin`;
  return `You are scaffolding a new plugin for **Decent** — Decent's Tauri
desktop client: a thin module host over Matrix (chat), Birdbrain (understand)
and federation. Build the plugin below to the contract, then verify it.

## The plugin to build
- id: \`${id}\`            (kebab-case, stable)
- title: ${s.title.trim() || "<Title>"}
- tagline: ${s.tagline.trim() || "<one line for the catalog>"}
- binds to (backend): ${s.backend.trim() || "<what it talks to, or 'local'>"}
- what it does: ${s.purpose.trim() || "<describe the capability and the panel>"}

## The contract — every module implements this one interface
\`\`\`ts
export interface MurmurModule {
  id: string;                 // kebab-case
  title: string;              // rail label
  tagline: string;            // catalog one-liner
  icon: LucideIcon;           // from "lucide-react"
  order: number;              // rail weight (lower = higher)
  Panel: ComponentType<PluginContext>;
  kind: "core" | "plugin";    // yours is "plugin"
  backend?: string;           // what it binds to (shown in the catalog)
  needsUpgrade?: boolean;     // true only if it needs the Electron tier
  useStatus?: () => PluginStatus;
}
\`\`\`
Your Panel receives \`PluginContext\`: { identity, instance, open }.
- instance.birdbrainBase — base origin for this instance's API ("" in dev).
- instance.name / instance.slug — the instance this client speaks for.
- identity — { handle, localId, did, signedIn }.
- open(moduleId) — switch the active module.

## How to add it (parallel-safe — do NOT skip steps)
1. \`cd lab/murmur && bun run new-plugin ${id}\`
   Scaffolds \`src/plugins/${id}/index.tsx\`. The registry AUTO-DISCOVERS it via
   import.meta.glob — there is NO registry file to edit, so parallel plugin
   branches never collide.
2. Implement the Panel and export it:
   \`export const ${exportName}: MurmurPlugin = { id, title, tagline, icon, order, kind: "plugin", backend, Panel };\`
3. \`bun run build\` to type-check.

## Rules that keep the flock's releases clean
- NEVER edit the registry — discovery is automatic.
- NEVER bump the version or write to \`release/\` from a plugin branch.
  Versioning happens once, centrally, at release-cut.
- Work on a worktree off develop:
  \`git worktree add ../murmur-${id} -b feat/${id} develop\`

## Styling: use the kit in src/ui, never hand-roll
- Every panel is Page → PageHeader (icon, eyebrow, title, lede, actions) →
  PageBody (width read | wide | full). Sections, Card, List/Row, Button
  (primary | secondary | quiet | danger), Field + inputClass, Gate for
  sign-in or connect states, Status for state at rest, Notice for errors.
- Prism: white at rest, colour on interaction. No filled or gradient buttons,
  no coloured pills. Colours come from tokens (--danger, --ok, --warn, --accent).
- Copy: British English, sentence case, no em-dashes, no infrastructure names.

## Definition of done
\`src/plugins/${id}/index.tsx\` exports a MurmurModule with kind:"plugin", renders
its Panel, type-checks under \`bun run build\`, and appears in the catalog with no
registry edit. If it binds to a backend, fetch from instance.birdbrainBase and
handle the unreachable case gracefully.`;
}

function Panel({ instance }: PluginContext) {
  const [spec, setSpec] = useState<Spec>({
    id: "",
    title: "",
    tagline: "",
    backend: "",
    purpose: "",
  });
  const [copied, setCopied] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [endpoint, setEndpoint] = useState<string>(
    () => localStorage.getItem(BACKEND_KEY) ?? "",
  );
  const [forging, setForging] = useState(false);
  const [forgeMsg, setForgeMsg] = useState<{
    kind: "ok" | "err";
    text: string;
  } | null>(null);

  const text = brief(spec);
  const ready = spec.id.trim() && spec.purpose.trim();

  function set<K extends keyof Spec>(k: K, v: string) {
    setSpec((s) => ({ ...s, [k]: v }));
  }

  async function copy() {
    await navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 1600);
  }

  function saveEndpoint(v: string) {
    setEndpoint(v);
    if (v.trim()) localStorage.setItem(BACKEND_KEY, v.trim());
    else localStorage.removeItem(BACKEND_KEY);
  }

  async function forge() {
    const url =
      endpoint.trim() || `${instance.birdbrainBase}/api/build`;
    setForging(true);
    setForgeMsg(null);
    try {
      const r = await fetch(url, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ spec, brief: text }),
      });
      if (!r.ok) throw new Error(`backend returned ${r.status}`);
      const data = (await r.json()) as { ok?: boolean; message?: string };
      setForgeMsg({
        kind: "ok",
        text:
          data.message ||
          "Forge accepted the brief. Watch your build channel for the draft.",
      });
    } catch (e) {
      setForgeMsg({
        kind: "err",
        text: `No forge backend reachable (${
          e instanceof Error ? e.message : "error"
        }). Copy the brief and run it with your own agent — that's the sovereign path.`,
      });
    } finally {
      setForging(false);
    }
  }

  const fields: {
    k: keyof Spec;
    label: string;
    placeholder: string;
    area?: boolean;
  }[] = [
    { k: "id", label: "id", placeholder: "ledger" },
    { k: "title", label: "title", placeholder: "Ledger" },
    {
      k: "tagline",
      label: "tagline",
      placeholder: "Track the flock's shared treasury",
    },
    {
      k: "backend",
      label: "binds to",
      placeholder: "Kreivo chain · local · an API you own",
    },
    {
      k: "purpose",
      label: "what it does",
      placeholder:
        "Describe the capability and what its panel shows. The clearer this is, the better the plugin your agent forges.",
      area: true,
    },
  ];

  return (
    <div className="flex h-full flex-col">
      <header className="border-b border-[var(--line)] px-8 pt-7 pb-5">
        <div className="flex items-center gap-2 text-[11px] uppercase tracking-[0.18em] text-[var(--faint)]">
          <Hammer className="h-3.5 w-3.5" />
          build
        </div>
        <h1 className="font-tight mt-2 text-2xl font-medium">
          Forge a plugin
        </h1>
        <p className="mt-1 max-w-xl text-sm text-[var(--muted)]">
          Decent is built from modules — and you can add your own. Describe a
          capability and get a complete brief any agent can build from. The
          shell is the product; the next module is yours.
        </p>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto px-8 py-6">
        <div className="grid gap-3">
          {fields.map((f) => (
            <label key={f.k} className="block">
              <span className="font-mono text-[11px] uppercase tracking-wider text-[var(--faint)]">
                {f.label}
              </span>
              {f.area ? (
                <textarea
                  value={spec[f.k]}
                  onChange={(e) => set(f.k, e.target.value)}
                  placeholder={f.placeholder}
                  rows={3}
                  className="prism-hover mt-1 w-full resize-y rounded-[var(--radius)] border border-[var(--line)] bg-[var(--card)] px-3.5 py-2.5 text-sm outline-none placeholder:text-[var(--faint)] focus:border-[var(--line-strong)]"
                />
              ) : (
                <input
                  value={spec[f.k]}
                  onChange={(e) => set(f.k, e.target.value)}
                  placeholder={f.placeholder}
                  className="prism-hover mt-1 w-full rounded-[var(--radius)] border border-[var(--line)] bg-[var(--card)] px-3.5 py-2 text-sm outline-none placeholder:text-[var(--faint)] focus:border-[var(--line-strong)]"
                />
              )}
            </label>
          ))}
        </div>

        <div className="mt-5 flex flex-wrap items-center gap-2">
          <button
            onClick={copy}
            disabled={!ready}
            className="prism-hover inline-flex items-center gap-1.5 rounded-[var(--radius)] border border-[var(--line-strong)] bg-[var(--card)] px-4 py-2 text-sm font-medium disabled:opacity-40"
          >
            {copied ? (
              <>
                <Check className="h-4 w-4 text-[#34c759]" /> Copied
              </>
            ) : (
              <>
                <Copy className="h-4 w-4" /> Copy brief
              </>
            )}
          </button>
          <button
            onClick={forge}
            disabled={!ready || forging}
            className="inline-flex items-center gap-1.5 rounded-[var(--radius)] px-4 py-2 text-sm font-medium text-white disabled:opacity-40"
            style={{ background: "var(--spectrum)" }}
          >
            {forging ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Sparkles className="h-4 w-4" />
            )}
            Forge with agent
          </button>
          <button
            onClick={() => setShowSettings((v) => !v)}
            className="prism-hover ml-auto inline-flex items-center gap-1.5 rounded-full border border-[var(--line)] px-3 py-1.5 text-xs text-[var(--muted)]"
          >
            <Settings2 className="h-3.5 w-3.5" /> Agent backend
          </button>
        </div>

        {showSettings && (
          <div className="mt-3 rounded-[var(--radius)] border border-[var(--line)] bg-[var(--raise)] px-4 py-3.5">
            <span className="font-mono text-[11px] uppercase tracking-wider text-[var(--faint)]">
              forge endpoint
            </span>
            <input
              value={endpoint}
              onChange={(e) => saveEndpoint(e.target.value)}
              placeholder={`${instance.birdbrainBase || "(same origin)"}/api/build`}
              className="prism-hover mt-1 w-full rounded-[var(--radius)] border border-[var(--line)] bg-[var(--card)] px-3.5 py-2 text-sm outline-none placeholder:text-[var(--faint)] focus:border-[var(--line-strong)]"
            />
            <p className="mt-2 text-[12.5px] leading-relaxed text-[var(--muted)]">
              Bring your own agent: point this at any backend that accepts the
              brief — your Zo, a self-hosted runner, a teammate's. Left empty,
              "Forge with agent" tries this instance's <code className="font-mono text-[var(--fg)]">/api/build</code>.
              No backend is required: copying the brief and running it yourself
              is the sovereign default.
            </p>
          </div>
        )}

        {forgeMsg && (
          <div
            className="mt-3 rounded-[var(--radius)] px-4 py-3 text-[13px] leading-relaxed"
            style={{
              border: `1px solid ${
                forgeMsg.kind === "ok" ? "#34c75933" : "#ff950033"
              }`,
              background:
                forgeMsg.kind === "ok" ? "#34c7590d" : "#ff95000d",
              color: forgeMsg.kind === "ok" ? "#1f7a36" : "#9a5b00",
            }}
          >
            {forgeMsg.text}
          </div>
        )}

        <div className="mt-7">
          <div className="mb-2 flex items-center justify-between">
            <span className="font-mono text-[11px] uppercase tracking-wider text-[var(--faint)]">
              the brief
            </span>
            <span className="font-mono text-[10px] text-[var(--faint)]">
              hand to any agent
            </span>
          </div>
          <pre className="font-mono max-h-80 overflow-y-auto whitespace-pre-wrap rounded-[var(--radius)] border border-[var(--line)] bg-[var(--card)] px-4 py-3.5 text-[12px] leading-relaxed text-[var(--muted)]">
            {text}
          </pre>
        </div>

        <div className="mt-6 flex items-start gap-2 rounded-[var(--radius)] border border-dashed border-[var(--line-strong)] bg-[var(--raise)] px-5 py-4">
          <ArrowUpRight className="mt-0.5 h-4 w-4 shrink-0 text-[var(--muted)]" />
          <p className="text-[13px] leading-relaxed text-[var(--muted)]">
            What you build can ship to the whole flock. Plugins are
            auto-discovered — no registry to edit — so many people can forge in
            parallel without collisions, and finished work folds into one
            signed release. Today one maintainer holds the signing key; the{" "}
            <span className="text-[var(--fg)]">north star</span> is that
            plugin-shipping entities co-govern releases.
          </p>
        </div>

        <p className="font-mono mt-6 text-[11px] text-[var(--faint)]">
          building for {instance.name} · {instance.slug}
        </p>
      </div>
    </div>
  );
}

export const buildPlugin: MurmurPlugin = {
  id: "build",
  title: "Build",
  tagline: "Forge new plugins — become a maintainer",
  icon: Hammer,
  order: 60,
  kind: "plugin",
  support: issues("build"),
  backend: "Pluggable agent (your Zo / BYO keys)",
  Panel,
};
