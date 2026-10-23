import { useEffect, useState, type MouseEvent } from "react";
import { ArrowLeft, ArrowUpRight, BookOpen, Feather, Languages, RotateCw, Sparkles } from "lucide-react";
import type { MurmurPlugin, PluginContext } from "../../host/types";
import { issues } from "../../host/support";
import { logoUrl } from "../../host/useSkin";
import { openInBrowser } from "../../identity/passkey";
import { Button, Card, Notice, Page, PageBody, PageHeader, Section, Waiting } from "../../ui";

/**
 * Journal plugin: Birdbrain's own publication, the editorial at
 * birdbrain.wtf/editorial/birdbrain, drawn natively and in colour.
 *
 * The posts come as data from the journal's own address (`?format=json`, which
 * serves rendered/feed.json from infra/skills/world-model-editorial/scripts/render.ts),
 * so a new piece shows here the moment it is published. Each piece wears one ink
 * from Birdbrain's spectrum, chosen by its number, and the cover art is drawn in
 * that same ink (public/birdbrain/journal/<slug>.webp, sources beside the posts
 * in studio/publications/birdbrain/editorial/art/). A piece with no art yet gets
 * a printed plate in its ink. The last copy read is kept, so the journal opens
 * offline.
 */

const JOURNAL = "https://birdbrain.wtf/editorial/birdbrain";
const CACHE = "murmur.journal.v1";

// Birdbrain's spectrum (the `birdbrain` brand preset), in the same order the art was inked.
const SPECTRUM = ["#ff3b30", "#ff9500", "#ffcc00", "#34c759", "#00c7be", "#007aff", "#af52de"];
const LIGHT = new Set(["#ffcc00", "#34c759", "#00c7be"]);
const inkOf = (p: Post) => SPECTRUM[((p.number ?? 1) - 1 + SPECTRUM.length) % SPECTRUM.length];
const onInk = (ink: string) => (LIGHT.has(ink) ? "#1a1a1a" : "#ffffff");

const LANG: Record<string, string> = { fr: "Français", es: "Español", zh: "中文", it: "Italiano", de: "Deutsch", ja: "日本語" };

interface Post {
  slug: string;
  title: string;
  dek: string;
  date: string;
  number: number | null;
  strand: string;
  byline: string;
  window: string | null;
  spine: string | null;
  pressure: number | null;
  body: string;
  receipts: string[];
  cites: string[];
  langs: string[];
}
interface Feed {
  name: string;
  strapline: string;
  site: string | null;
  posts: Post[];
}

function cached(): Feed | null {
  try {
    return JSON.parse(localStorage.getItem(CACHE) || "null");
  } catch {
    return null;
  }
}

const day = (d: string) =>
  new Date(`${d}T12:00:00Z`).toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" });
const minutes = (html: string) => Math.max(1, Math.round(html.replace(/<[^>]+>/g, " ").split(/\s+/).length / 220));

// Links inside a piece (sources, receipts) open in the member's browser, never in the window.
function outward(e: MouseEvent) {
  const a = (e.target as HTMLElement).closest("a");
  if (!a?.href) return;
  e.preventDefault();
  void openInBrowser(a.href);
}

/** The piece's picture: its own art, or a printed plate in its ink until art is drawn. */
function Art({ post, className = "" }: { post: Post; className?: string }) {
  const [missing, setMissing] = useState(false);
  const ink = inkOf(post);
  if (!missing)
    return (
      <img
        src={logoUrl(`/birdbrain/journal/${post.slug}.webp`)}
        alt=""
        loading="lazy"
        onError={() => setMissing(true)}
        className={`block w-full bg-white object-cover ${className}`}
      />
    );
  return (
    <div
      aria-hidden
      className={`relative w-full overflow-hidden bg-white ${className}`}
      style={{ backgroundImage: `radial-gradient(${ink} 1.5px, transparent 1.7px)`, backgroundSize: "10px 10px" }}
    >
      <span
        className="font-tight absolute -bottom-6 right-4 select-none text-[150px] font-medium leading-none"
        style={{ color: ink, mixBlendMode: "multiply" }}
      >
        {post.number ?? post.title[0]}
      </span>
    </div>
  );
}

function Badge({ post }: { post: Post }) {
  const ink = inkOf(post);
  return (
    <span
      className="font-mono inline-flex items-center rounded-[4px] px-1.5 py-0.5 text-[10px] font-medium tracking-wide"
      style={{ background: ink, color: onInk(ink) }}
    >
      Nº {post.number ?? "·"}
    </span>
  );
}

function Spectrum() {
  return (
    <div className="flex" aria-hidden>
      {SPECTRUM.map((c) => (
        <div key={c} className="h-1.5 flex-1" style={{ background: c }} />
      ))}
    </div>
  );
}

/** A very short account of how the journal is made, kept on the cover. */
function HowItIsMade() {
  return (
    <Card tone="dashed">
      <div className="flex gap-3">
        <Sparkles className="mt-0.5 h-4 w-4 shrink-0 text-[var(--faint)]" />
        <div className="min-w-0">
          <div className="font-tight text-[13px] font-medium">How this is made</div>
          <p className="mt-1 text-[13px] leading-relaxed text-[var(--muted)]">
            Each day the Monday call transcripts are weighed for how much has built up around one idea. When it is
            enough, a model writes a short piece in Birdbrain's voice and ties each claim to the call it came from.
            It goes out without sign-off, and a person reads every piece as it lands and can pull it. The pictures are
            made with an image model, one ink per piece. The talk sets the pace, not the calendar.
          </p>
        </div>
      </div>
    </Card>
  );
}

function Reading({ post, back }: { post: Post; back: () => void }) {
  const ink = inkOf(post);
  return (
    <>
      <div>
        <Button icon={ArrowLeft} onClick={back}>
          All pieces
        </Button>
      </div>
      <article className="flex flex-col gap-5">
        <figure className="overflow-hidden rounded-[var(--radius)] border border-[var(--line)]">
          <div className="h-1.5" style={{ background: ink }} />
          <Art post={post} className="aspect-[3/2]" />
        </figure>
        <header>
          <div className="flex flex-wrap items-center gap-2">
            <Badge post={post} />
            <span className="font-mono text-[11px] uppercase tracking-wide text-[var(--faint)]">
              {post.strand} · {day(post.date)} · {minutes(post.body)} min
            </span>
          </div>
          <h2 className="font-tight mt-3 text-[30px] font-medium leading-[1.12] tracking-[-0.015em]">{post.title}</h2>
          {post.dek && (
            <p className="mt-3 border-l-[5px] pl-4 text-[17px] leading-relaxed text-[var(--muted)]" style={{ borderColor: ink }}>
              {post.dek}
            </p>
          )}
          <p className="font-mono mt-3 text-[11px] text-[var(--faint)]">
            {post.byline}
            {post.window ? ` · from the calls of ${post.window}` : ""}
          </p>
        </header>
        <div
          onClick={outward}
          className="font-serif flex flex-col gap-4 text-[16.5px] leading-[1.72] [&_a]:underline [&_a]:decoration-[var(--ink-line)] [&_a]:underline-offset-2 [&_a.cite]:font-mono [&_a.cite]:text-[0.78em] [&_a.cite]:font-semibold [&_a.cite]:no-underline [&_blockquote]:font-tight [&_blockquote]:border-l-[5px] [&_blockquote]:border-[var(--ink-line)] [&_blockquote]:pl-4 [&_blockquote]:text-[20px] [&_blockquote]:leading-snug [&_h2]:font-tight [&_h2]:mt-3 [&_h2]:text-[20px] [&_h2]:font-medium [&_h3]:font-tight [&_h3]:text-[17px] [&_h3]:font-medium [&_ol]:list-decimal [&_ol]:pl-6 [&_ul]:list-disc [&_ul]:pl-6"
          style={{ ["--ink-line" as string]: ink }}
          dangerouslySetInnerHTML={{ __html: post.body }}
        />
        {post.pressure && (
          <div className="rounded-[var(--radius)] border border-[var(--line)] px-4 py-3" style={{ background: `color-mix(in srgb, ${ink} 8%, var(--bg))` }}>
            <div className="flex items-center justify-between gap-3">
              <span className="font-tight text-[13px] font-medium">Pressured out</span>
              <span className="font-mono text-[11px] text-[var(--faint)]">
                pressure {post.pressure.toFixed(2)}
              </span>
            </div>
            <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-[var(--line)]">
              <div className="h-full rounded-full" style={{ width: `${Math.min(100, (post.pressure / 6) * 100)}%`, background: ink }} />
            </div>
            <p className="mt-2 text-[12px] leading-relaxed text-[var(--muted)]">
              This piece went out when enough talk had gathered{post.spine ? ` around ${post.spine.replace(/-/g, " ")}` : ""}.
            </p>
          </div>
        )}
        {post.receipts.length > 0 && (
          <Section label="Receipts" icon={BookOpen}>
            <ul onClick={outward} className="flex flex-col gap-2 [&_a]:font-mono [&_a]:font-semibold">
              {post.receipts.map((r, n) => (
                <li
                  key={n}
                  className="rounded-[var(--radius)] border border-[var(--line)] bg-[var(--card)] px-4 py-2.5 text-[13px] leading-relaxed text-[var(--muted)]"
                  style={{ borderLeft: `4px solid ${ink}` }}
                  dangerouslySetInnerHTML={{ __html: r }}
                />
              ))}
            </ul>
          </Section>
        )}
        {post.langs.length > 0 && (
          <Section label="Also in" icon={Languages}>
            <div className="flex flex-wrap gap-2">
              {post.langs.map((l) => (
                <Button key={l} trailing={ArrowUpRight} onClick={() => void openInBrowser(`${JOURNAL}/${l}/${post.slug}`)}>
                  {LANG[l] ?? l}
                </Button>
              ))}
            </div>
          </Section>
        )}
      </article>
    </>
  );
}

function Panel(_: PluginContext) {
  const [feed, setFeed] = useState<Feed | null>(cached);
  const [failed, setFailed] = useState(false);
  const [reading, setReading] = useState<string | null>(null);
  const [nonce, setNonce] = useState(0);

  useEffect(() => {
    let alive = true;
    setFailed(false);
    fetch(`${JOURNAL}?format=json`, { headers: { Accept: "application/json" } })
      .then((r) => (r.ok ? r.json() : Promise.reject(r.status)))
      .then((j: Feed) => {
        if (!alive || !Array.isArray(j?.posts)) return;
        setFeed(j);
        localStorage.setItem(CACHE, JSON.stringify(j));
      })
      .catch(() => alive && setFailed(true));
    return () => {
      alive = false;
    };
  }, [nonce]);

  const posts = feed?.posts ?? [];
  const post = posts.find((p) => p.slug === reading);
  const [lead, ...rest] = posts;

  return (
    <Page>
      <PageHeader
        icon={Feather}
        eyebrow="journal"
        title="Birdbrain's journal"
        lede="The network of the Monday call, thinking out loud."
        actions={
          <>
            <Button icon={RotateCw} onClick={() => setNonce((n) => n + 1)} title="Look for new pieces">
              Refresh
            </Button>
            <Button trailing={ArrowUpRight} onClick={() => void openInBrowser(post ? `${JOURNAL}/${post.slug}` : JOURNAL)}>
              Open in browser
            </Button>
          </>
        }
      >
        <div className="absolute inset-x-0 bottom-0">
          <Spectrum />
        </div>
      </PageHeader>
      <PageBody width={post ? "read" : "wide"}>
        {failed && (
          <Notice tone="warn">
            {feed ? "Couldn't reach the journal, so this is the last copy you read." : "Couldn't reach the journal. Try again in a moment."}
          </Notice>
        )}
        {!feed && !failed && <Waiting>Fetching the journal</Waiting>}

        {post ? (
          <Reading post={post} back={() => setReading(null)} />
        ) : (
          lead && (
            <>
              <button
                onClick={() => setReading(lead.slug)}
                className="prism-hover group flex flex-col overflow-hidden rounded-[var(--radius)] border border-[var(--line)] bg-[var(--card)] text-left transition"
              >
                <div className="h-1.5" style={{ background: inkOf(lead) }} />
                <Art post={lead} className="aspect-[16/9]" />
                <div className="flex flex-col border-t border-[var(--line)] px-6 py-5">
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge post={lead} />
                    <span className="font-mono text-[11px] uppercase tracking-wide text-[var(--faint)]">
                      Latest · {day(lead.date)} · {minutes(lead.body)} min
                    </span>
                  </div>
                  <h2 className="font-tight mt-2.5 text-[26px] font-medium leading-tight tracking-[-0.01em]">{lead.title}</h2>
                  <p className="mt-2 text-[15px] leading-relaxed text-[var(--muted)]">{lead.dek}</p>
                </div>
              </button>

              <HowItIsMade />

              {rest.length > 0 && (
                <Section label="Earlier pieces" icon={BookOpen}>
                  <div className="grid gap-3 sm:grid-cols-2">
                    {rest.map((p) => (
                      <button
                        key={p.slug}
                        onClick={() => setReading(p.slug)}
                        className="prism-hover flex flex-col overflow-hidden rounded-[var(--radius)] border border-[var(--line)] bg-[var(--card)] text-left transition"
                      >
                        <div className="h-1" style={{ background: inkOf(p) }} />
                        <Art post={p} className="aspect-[2/1]" />
                        <div className="flex flex-1 flex-col px-5 py-4">
                          <div className="flex items-center gap-2">
                            <Badge post={p} />
                            <span className="font-mono text-[10px] uppercase tracking-wide text-[var(--faint)]">{day(p.date)}</span>
                          </div>
                          <div className="font-tight mt-2 text-[16px] font-medium leading-snug">{p.title}</div>
                          <p className="mt-1.5 line-clamp-3 text-[13px] leading-relaxed text-[var(--muted)]">{p.dek}</p>
                        </div>
                      </button>
                    ))}
                  </div>
                </Section>
              )}
            </>
          )
        )}
      </PageBody>
    </Page>
  );
}

export const journalPlugin: MurmurPlugin = {
  id: "journal",
  title: "Journal",
  tagline: "Birdbrain's own writing, filed from the Monday calls",
  icon: Feather,
  // just above the magazine
  order: 38,
  kind: "plugin",
  support: issues("journal"),
  backend: "birdbrain.wtf/editorial/birdbrain",
  Panel,
};
