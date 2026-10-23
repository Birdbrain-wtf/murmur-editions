/**
 * Birdbrain client — talks to the live Decent intelligence.
 *
 * Live endpoint (confirmed): GET {base}/api/birdbrain?q=<term>&limit=<n>
 * Searches the unified vault (notes, calls, concepts, seeds, people, links).
 *
 * In dev, base is "" so Vite proxies /api/birdbrain → rw.zo.space (no CORS).
 * In a Tauri build, set VITE_BIRDBRAIN_BASE=https://rw.zo.space.
 */

export interface BirdbrainHit {
  title?: string;
  path?: string;
  type?: string;
  snippet?: string;
  score?: number;
  [k: string]: unknown;
}

export interface BirdbrainResult {
  query: string;
  count: number;
  hits: BirdbrainHit[];
  raw: unknown;
}

export interface BirdbrainInfo {
  service: string;
  sections: string[];
}

export async function birdbrainInfo(base: string): Promise<BirdbrainInfo> {
  const res = await fetch(`${base}/api/birdbrain`, {
    headers: { Accept: "application/json" },
  });
  if (!res.ok) throw new Error(`birdbrain ${res.status}`);
  return (await res.json()) as BirdbrainInfo;
}

export async function birdbrainQuery(
  base: string,
  q: string,
  limit = 12,
): Promise<BirdbrainResult> {
  const url = `${base}/api/birdbrain?q=${encodeURIComponent(q)}&limit=${limit}`;
  const res = await fetch(url, { headers: { Accept: "application/json" } });
  if (!res.ok) throw new Error(`birdbrain query ${res.status}`);
  const raw = (await res.json()) as unknown;

  // The endpoint shape may evolve; normalise defensively.
  const hits = extractHits(raw);
  return { query: q, count: hits.length, hits, raw };
}

function extractHits(raw: unknown): BirdbrainHit[] {
  if (!raw || typeof raw !== "object") return [];
  const obj = raw as Record<string, unknown>;
  const candidate =
    (Array.isArray(obj.results) && obj.results) ||
    (Array.isArray(obj.hits) && obj.hits) ||
    (Array.isArray(obj.matches) && obj.matches) ||
    (Array.isArray(obj.notes) && obj.notes) ||
    [];
  return (candidate as unknown[]).map((h) => normaliseHit(h));
}

function normaliseHit(h: unknown): BirdbrainHit {
  if (!h || typeof h !== "object") return { snippet: String(h) };
  const o = h as Record<string, unknown>;
  return {
    title: str(o.title ?? o.name ?? o.heading ?? o.path),
    path: str(o.path ?? o.file ?? o.id),
    type: str(o.type ?? o.kind ?? o.section),
    snippet: str(o.snippet ?? o.excerpt ?? o.summary ?? o.text ?? o.body),
    score: typeof o.score === "number" ? o.score : undefined,
    ...o,
  };
}

function str(v: unknown): string | undefined {
  if (v == null) return undefined;
  return typeof v === "string" ? v : String(v);
}
