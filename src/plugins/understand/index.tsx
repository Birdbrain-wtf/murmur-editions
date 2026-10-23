import { useEffect, useRef, useState } from "react";
import { Brain, CornerDownLeft, Loader2 } from "lucide-react";
import type { MurmurPlugin, PluginContext } from "../../host/types";
import { issues } from "../../host/support";
import {
  birdbrainQuery,
  type BirdbrainHit,
} from "../../lib/birdbrain";

function typeColor(t?: string): string {
  switch ((t || "").toLowerCase()) {
    case "concepts":
      return "#af52de";
    case "calls":
      return "#007aff";
    case "people":
      return "#34c759";
    case "seeds":
      return "#ff9500";
    case "links":
      return "#00c7be";
    default:
      return "#6b6b6b";
  }
}

function Panel({ instance }: PluginContext) {
  const [q, setQ] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hits, setHits] = useState<BirdbrainHit[] | null>(null);
  const [asked, setAsked] = useState<string>("");
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  async function run(query: string) {
    const term = query.trim();
    if (!term) return;
    setLoading(true);
    setError(null);
    setAsked(term);
    try {
      const r = await birdbrainQuery(instance.birdbrainBase, term, 14);
      setHits(r.hits);
    } catch (e) {
      setError(e instanceof Error ? e.message : "query failed");
      setHits(null);
    } finally {
      setLoading(false);
    }
  }

  const suggestions = [
    "proof of personhood",
    "range-bound intelligence",
    "stablecoin",
    "what is birdbrain",
  ];

  return (
    <div className="flex h-full flex-col">
      <header className="border-b border-[var(--line)] px-8 pt-7 pb-5">
        <div className="flex items-center gap-2 text-[11px] uppercase tracking-[0.18em] text-[var(--faint)]">
          <Brain className="h-3.5 w-3.5" />
          understand
        </div>
        <h1 className="font-tight mt-2 text-2xl font-medium">
          Ask {instance.name}
        </h1>
        <p className="mt-1 max-w-xl text-sm text-[var(--muted)]">
          Query the collective memory of the flock — calls, concepts, seeds,
          people and links from the live vault.
        </p>
      </header>

      <div className="px-8 pt-6">
        <form
          onSubmit={(e) => {
            e.preventDefault();
            run(q);
          }}
          className="prism-hover flex items-center gap-3 rounded-[var(--radius)] border border-[var(--line-strong)] bg-[var(--card)] px-4 py-3"
          data-active={loading}
        >
          {loading ? (
            <Loader2 className="h-4 w-4 animate-spin text-[var(--muted)]" />
          ) : (
            <Brain className="h-4 w-4 text-[var(--muted)]" />
          )}
          <input
            ref={inputRef}
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Ask the birdbrain…"
            className="flex-1 bg-transparent text-[15px] outline-none placeholder:text-[var(--faint)]"
          />
          <kbd className="font-mono flex items-center gap-1 rounded border border-[var(--line)] px-1.5 py-0.5 text-[10px] text-[var(--faint)]">
            <CornerDownLeft className="h-3 w-3" /> ask
          </kbd>
        </form>

        {!hits && !loading && (
          <div className="mt-4 flex flex-wrap gap-2">
            {suggestions.map((s) => (
              <button
                key={s}
                onClick={() => {
                  setQ(s);
                  run(s);
                }}
                className="font-mono rounded-full border border-[var(--line)] px-3 py-1 text-xs text-[var(--muted)] transition hover:border-[var(--line-strong)] hover:text-[var(--fg)]"
              >
                {s}
              </button>
            ))}
          </div>
        )}
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-8 py-6">
        {error && (
          <div className="rounded-[var(--radius)] border border-[#ff3b30]/30 bg-[#ff3b30]/5 px-4 py-3 text-sm text-[#c1271d]">
            Couldn't reach the birdbrain — {error}
          </div>
        )}

        {asked && hits && (
          <div className="mb-4 text-xs text-[var(--faint)]">
            {hits.length} fragments for{" "}
            <span className="text-[var(--fg)]">"{asked}"</span>
          </div>
        )}

        <div className="flex flex-col gap-2">
          {hits?.map((h, i) => (
            <article
              key={(h.path as string) ?? i}
              className="prism-hover group rounded-[var(--radius)] border border-[var(--line)] bg-[var(--card)] px-4 py-3"
            >
              <div className="flex items-center gap-2">
                <span
                  className="h-2 w-2 rounded-full"
                  style={{ background: typeColor(h.type) }}
                />
                <span className="font-tight text-sm font-medium">
                  {h.title || h.path}
                </span>
                {h.type && (
                  <span
                    className="font-mono ml-auto text-[10px] uppercase tracking-wider"
                    style={{ color: typeColor(h.type) }}
                  >
                    {h.type}
                  </span>
                )}
              </div>
              {h.snippet && (
                <p className="font-serif mt-1.5 text-[13.5px] leading-relaxed text-[var(--muted)]">
                  {h.snippet}
                </p>
              )}
              {h.path && (
                <div className="font-mono mt-2 text-[10px] text-[var(--faint)]">
                  {h.path}
                </div>
              )}
            </article>
          ))}
        </div>

        {asked && hits && hits.length === 0 && !loading && (
          <div className="text-sm text-[var(--muted)]">
            Nothing in the flock's memory yet for that.
          </div>
        )}
      </div>
    </div>
  );
}

export const understandPlugin: MurmurPlugin = {
  id: "understand",
  title: "Understand",
  tagline: "Ask the flock's collective memory (Birdbrain)",
  icon: Brain,
  order: 10,
  kind: "plugin",
  support: issues("understand"),
  backend: "Birdbrain (Decent vault)",
  Panel,
};
