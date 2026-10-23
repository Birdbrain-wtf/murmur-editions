import { useState } from "react";
import {
  PenLine,
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
 * Publish plugin — turn a user into a contributor.
 *
 * Where `build` makes the flock's *software* output (plugins), `publish` makes
 * its *media* output: articles and features for Decent magazine, the
 * world-facing front end of the endeavour. Same shape as build — the agentic
 * compute is a PLUGGABLE backend, not baked into the webview. The SOVEREIGN
 * default is "copy the brief and run it with your own agent (your Zo, your
 * Claude, your keys)", which drafts + ships the piece to the magazine repo. A
 * hosted publish endpoint is an optional convenience that degrades gracefully:
 * if it isn't reachable, the brief still works. No single backend is a point of
 * failure — that keeps publish aligned with the resilience north star, and it
 * decentralises the *distribution* axis for the flock's content.
 */

const BACKEND_KEY = "murmur.publish.backend.v1";

interface Spec {
  title: string;
  dek: string;
  authors: string;
  collective: string;
  kind: string;
  angle: string;
  notes: string;
}

function slugify(title: string): string {
  return (
    title
      .toLowerCase()
      .trim()
      .replace(/['"]/g, "")
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 80) || "<slug>"
  );
}

/**
 * The real artifact: a complete, self-contained prompt any agent can execute to
 * draft and ship an article to Decent magazine. This is what makes a user a
 * contributor — no CMS, no gatekeeper, just a brief and an agent.
 */
function brief(s: Spec): string {
  const title = s.title.trim() || "<title>";
  const slug = s.title.trim() ? slugify(s.title) : "<slug>";
  const authors = s.authors.trim() || "<your name — every piece must be attributed>";
  const collective = s.collective.trim();
  return `You are drafting and shipping a piece for **Decent magazine** — the
world-facing publication of the Decent Partners network, live at
https://zine.decent.partners. It is a zero-dependency Bun site: each article
is a single self-contained HTML file with inline styles. No React, no build
step. Its source is \`studio/site\` in the Decent workspace.

## The piece to write
- title: ${title}
- standfirst (dek): ${s.dek.trim() || "<one-line subtitle that sells the read>"}
- by: ${authors}${collective ? ` · published under ${collective}` : ""}
- form: ${s.kind.trim() || "essay (also: dispatch, feature, exchange, profile)"}
- angle / thesis: ${s.angle.trim() || "<the single argument the piece makes>"}
- what to cover: ${s.notes.trim() || "<key points, sources, structure, anyone to quote or cite>"}

## Authorship & credit (required — never ship an unattributed piece)
- byline author(s): ${authors}
- publishing under collective: ${collective || "— (publish under the author's own name)"}

Credit is not optional. In the article's \`hero-byline\` block, render the
author(s) exactly as the existing spreads do:
  \`<span>By <strong><a href="/contributors#<slug>">Name</a></strong></span>\`
- For multiple contributors, list each as its own linked <strong> name,
  comma-separated, in the order given — everyone who shaped the draft is named.
- If a collective is given, the piece is published UNDER it: lead the byline
  with the collective ("By <Collective>") and STILL credit the humans — either a
  second byline span ("Written by A, B, C") or, for a wholly collective work,
  the masthead pattern \`<dt>Authored by</dt><dd><a href="/contributors"><Collective></a> — collective</dd>\`.
  The collective is the banner, never a way to erase who wrote it.
- Make every byline link resolve: if a named contributor (or the collective) is
  not yet on \`public/contributors.html\`, add them — a card with an id anchor
  (\`#<slug>\`, lowercased-hyphenated name) matching the link, plus a one-line
  bio, in the existing markup. Bump the homepage contributor count if you add people.

## How to publish (follow the magazine's documented process)
1. Optionally draft the prose first as markdown in \`studio/site/drafts/${slug}.md\`,
   then write the final, self-contained article to:
   \`studio/site/public/articles/${slug}.html\`
   It is served automatically at \`/articles/${slug}\` — no build, no restart.
2. Add it to the cover: open \`studio/site/public/index.html\` and add a tile (or
   update the featured card — search \`class="featured"\`), with the kicker,
   title, deck and an \`href="/articles/${slug}"\` link, matching the existing
   tiles' markup.
3. If this opens a new issue, bump the masthead \`Issue Nº\` on the cover.
4. Reload — the server resolves \`/articles/${slug}\` to the HTML automatically.

## Stay inside the Decent design system
- Type: Fraunces / Instrument Serif (serif display + body) + JetBrains Mono.
- Palette: paper + ink + vermilion + signal-yellow + deep-green.
- Each article keeps the shared Decent navigation/type DNA but earns its own
  visual world — bespoke hero, palette accent, pull-quotes, diagrams. Study an
  existing spread first (e.g. \`public/articles/relativistic-economics.html\` or
  \`how-a-network-knows-itself.html\`) and match its structural quality.
- Self-contained: inline \`<style>\`, no external build assets beyond
  \`/images/...\` and \`/assets/...\` you add.

## Voice
Decent writes with conviction and precision — essayistic, network-native,
unafraid of a strong thesis. Make the argument; don't hedge it. Open with a hook,
not a summary. Write the standfirst so a reader knows in one line why to care.

## Definition of done
\`public/articles/${slug}.html\` exists as a self-contained spread inside the
design system, the cover links to it, it reads at \`/articles/${slug}\`, and the
prose delivers the thesis above. If a hosted publish backend handled this,
report the live URL back.`;
}

function Panel({ instance, identity }: PluginContext) {
  const [spec, setSpec] = useState<Spec>({
    title: "",
    dek: "",
    authors: identity.handle ?? "",
    collective: "",
    kind: "",
    angle: "",
    notes: "",
  });
  const [copied, setCopied] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [endpoint, setEndpoint] = useState<string>(
    () => localStorage.getItem(BACKEND_KEY) ?? "",
  );
  const [shipping, setShipping] = useState(false);
  const [shipMsg, setShipMsg] = useState<{
    kind: "ok" | "err";
    text: string;
  } | null>(null);

  const text = brief(spec);
  const ready = spec.title.trim() && spec.angle.trim();

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

  async function ship() {
    const url = endpoint.trim() || `${instance.birdbrainBase}/api/publish`;
    setShipping(true);
    setShipMsg(null);
    try {
      const r = await fetch(url, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ spec, brief: text }),
      });
      if (!r.ok) throw new Error(`backend returned ${r.status}`);
      const data = (await r.json()) as {
        ok?: boolean;
        message?: string;
        url?: string;
      };
      setShipMsg({
        kind: "ok",
        text:
          data.message ||
          (data.url
            ? `Draft accepted — ${data.url}`
            : "Publish accepted the brief. Watch the magazine for the draft."),
      });
    } catch (e) {
      setShipMsg({
        kind: "err",
        text: `No publish backend reachable (${
          e instanceof Error ? e.message : "error"
        }). Copy the brief and run it with your own agent — that's the sovereign path.`,
      });
    } finally {
      setShipping(false);
    }
  }

  const fields: {
    k: keyof Spec;
    label: string;
    placeholder: string;
    area?: boolean;
  }[] = [
    { k: "title", label: "title", placeholder: "The Network Is the Nation" },
    {
      k: "dek",
      label: "standfirst",
      placeholder: "One line that tells a reader why to care",
    },
    {
      k: "authors",
      label: "author(s)",
      placeholder: "Your name — comma-separate co-authors who shaped the draft",
    },
    {
      k: "collective",
      label: "collective (optional)",
      placeholder: "Publish under a collective, e.g. Decent Partners — blank = your own name",
    },
    {
      k: "kind",
      label: "form",
      placeholder: "essay · dispatch · feature · exchange · profile",
    },
    {
      k: "angle",
      label: "angle / thesis",
      placeholder: "The single argument the piece makes",
    },
    {
      k: "notes",
      label: "what to cover",
      placeholder:
        "Key points, sources, structure, anyone to quote or cite. The clearer this is, the better the piece your agent drafts.",
      area: true,
    },
  ];

  return (
    <div className="flex h-full flex-col">
      <header className="border-b border-[var(--line)] px-8 pt-7 pb-5">
        <div className="flex items-center gap-2 text-[11px] uppercase tracking-[0.18em] text-[var(--faint)]">
          <PenLine className="h-3.5 w-3.5" />
          publish
        </div>
        <h1 className="font-tight mt-2 text-2xl font-medium">
          Write for the magazine
        </h1>
        <p className="mt-1 max-w-xl text-sm text-[var(--muted)]">
          Decent magazine is the flock's front page. Describe a piece and get a
          complete brief any agent can draft and ship — straight onto the
          publication. You and your agent are the editorial desk.
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

        {spec.title.trim() && (
          <p className="font-mono mt-3 text-[11px] text-[var(--faint)]">
            will publish at{" "}
            <span className="text-[var(--muted)]">
              /articles/{slugify(spec.title)}
            </span>
          </p>
        )}
        {spec.authors.trim() && (
          <p className="font-mono mt-1 text-[11px] text-[var(--faint)]">
            credited to{" "}
            <span className="text-[var(--muted)]">{spec.authors.trim()}</span>
            {spec.collective.trim() && (
              <>
                {" "}
                · under{" "}
                <span className="text-[var(--muted)]">
                  {spec.collective.trim()}
                </span>
              </>
            )}
          </p>
        )}

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
            onClick={ship}
            disabled={!ready || shipping}
            className="inline-flex items-center gap-1.5 rounded-[var(--radius)] px-4 py-2 text-sm font-medium text-white disabled:opacity-40"
            style={{ background: "var(--spectrum)" }}
          >
            {shipping ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Sparkles className="h-4 w-4" />
            )}
            Publish with agent
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
              publish endpoint
            </span>
            <input
              value={endpoint}
              onChange={(e) => saveEndpoint(e.target.value)}
              placeholder={`${instance.birdbrainBase || "(same origin)"}/api/publish`}
              className="prism-hover mt-1 w-full rounded-[var(--radius)] border border-[var(--line)] bg-[var(--card)] px-3.5 py-2 text-sm outline-none placeholder:text-[var(--faint)] focus:border-[var(--line-strong)]"
            />
            <p className="mt-2 text-[12.5px] leading-relaxed text-[var(--muted)]">
              Bring your own agent: point this at any backend that accepts the
              brief — your Zo, a self-hosted runner, a teammate's. Left empty,
              "Publish with agent" tries this instance's{" "}
              <code className="font-mono text-[var(--fg)]">/api/publish</code>.
              No backend is required: copying the brief and running it yourself
              is the sovereign default.
            </p>
          </div>
        )}

        {shipMsg && (
          <div
            className="mt-3 rounded-[var(--radius)] px-4 py-3 text-[13px] leading-relaxed"
            style={{
              border: `1px solid ${
                shipMsg.kind === "ok" ? "#34c75933" : "#ff950033"
              }`,
              background: shipMsg.kind === "ok" ? "#34c7590d" : "#ff95000d",
              color: shipMsg.kind === "ok" ? "#1f7a36" : "#9a5b00",
            }}
          >
            {shipMsg.text}
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
            What you write becomes the flock's public voice. The magazine is the
            front end for the whole endeavour — so anyone in the network can
            contribute a piece, and their agent can do the drafting. Distribution
            is the flip side of <span className="text-[var(--fg)]">subscribe</span>:
            what's published here is what feeds the network's readers.
          </p>
        </div>

        <p className="font-mono mt-6 text-[11px] text-[var(--faint)]">
          publishing for {instance.name} · {instance.slug}
        </p>
      </div>
    </div>
  );
}

export const publishPlugin: MurmurPlugin = {
  id: "publish",
  title: "Publish",
  tagline: "Draft & ship articles to Decent magazine",
  icon: PenLine,
  order: 65,
  kind: "plugin",
  support: issues("publish"),
  backend: "Decent magazine (zine.decent.partners)",
  Panel,
};
