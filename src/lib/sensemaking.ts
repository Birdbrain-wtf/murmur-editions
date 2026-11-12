/**
 * Sense-making client — the personal layer of the Decent vault.
 *
 * This is the alignment seam with the sense-making assistant built with Matt:
 * the `notes` core surface captures *into* the unified vault (`core/vault`) via
 * the live `/api/sensemaking` route, so a thought you write in Decent becomes a
 * first-class vault note — typed, with an intent line, tags and people — that
 * the `understand` plugin can later retrieve.
 *
 * Same base as birdbrain: "" in dev (Vite proxies /api/sensemaking → rw.zo.space)
 * and the production origin in a packaged Tauri build.
 *
 * Matt's defining insight: the *intent step at capture*. A raw thought plus a
 * one-line "why this matters" is what turns a note into sense-making.
 */

import { edition } from "../edition";

export type NoteType = "note" | "link" | "quote" | "person";

export interface VaultEntry {
  path: string;
  type: string;
  created: string;
  tags: string[];
  people: string[];
  intent: string;
  title: string;
}

export interface CaptureInput {
  text: string;
  intent?: string;
  tags?: string[];
  people?: string[];
  type?: NoteType;
  url?: string;
}

export interface CaptureResult {
  ok: boolean;
  path: string;
  id: string;
}

export interface VaultSummary {
  total: number;
  byType: Record<string, number>;
  topTags: [string, number][];
  recent: VaultEntry[];
}

const SOURCE = "murmur";

/**
 * Mirror of the server-side type detection in `core/vault/scripts/capture.ts`,
 * so the client and the pipeline agree on what a capture *is* before it lands:
 *   - `link`  — a URL with little surrounding prose (< 80 chars beyond the URL)
 *   - `quote` — quoted text with an attribution dash ("…" — Someone)
 *   - `note`  — everything else
 */
export function detectType(text: string, url?: string): NoteType {
  const body = text.trim();
  const link = url ?? body.match(/https?:\/\/\S+/)?.[0];
  if (link && body.replace(link, "").trim().length < 80) return "link";
  if (/^[\s>"'].*["']\s*[—–-]\s*\w/m.test(body)) return "quote";
  return "note";
}

export function detectUrl(text: string): string | undefined {
  return text.match(/https?:\/\/\S+/)?.[0];
}

export async function captureNote(
  base: string,
  input: CaptureInput,
): Promise<CaptureResult> {
  if (!edition.vaultSync) throw new Error("local only");
  const url = input.url ?? detectUrl(input.text);
  const type = input.type ?? detectType(input.text, url);
  const res = await fetch(`${base}/api/sensemaking?action=capture`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({
      text: input.text,
      intent: input.intent || undefined,
      tags: input.tags ?? [],
      people: input.people ?? [],
      type,
      url,
      source: SOURCE,
    }),
  });
  if (!res.ok) throw new Error(`capture ${res.status}`);
  return (await res.json()) as CaptureResult;
}

export async function vaultSummary(base: string): Promise<VaultSummary> {
  if (!edition.vaultSync) throw new Error("local only");
  const res = await fetch(`${base}/api/sensemaking?action=summary`, {
    headers: { Accept: "application/json" },
  });
  if (!res.ok) throw new Error(`summary ${res.status}`);
  const raw = (await res.json()) as Partial<VaultSummary>;
  return {
    total: raw.total ?? 0,
    byType: raw.byType ?? {},
    topTags: raw.topTags ?? [],
    recent: Array.isArray(raw.recent) ? raw.recent : [],
  };
}

export async function searchVault(
  base: string,
  q: string,
): Promise<VaultEntry[]> {
  if (!edition.vaultSync) return [];
  const res = await fetch(
    `${base}/api/sensemaking?action=search&q=${encodeURIComponent(q)}`,
    { headers: { Accept: "application/json" } },
  );
  if (!res.ok) throw new Error(`search ${res.status}`);
  const raw = (await res.json()) as { results?: VaultEntry[] };
  return Array.isArray(raw.results) ? raw.results : [];
}

export async function readNote(
  base: string,
  path: string,
): Promise<{ content: string; intent: string; tags: string[]; people: string[]; type: string; created: string }> {
  const res = await fetch(
    `${base}/api/sensemaking?action=read&path=${encodeURIComponent(path)}`,
    { headers: { Accept: "application/json" } },
  );
  if (!res.ok) throw new Error(`read ${res.status}`);
  return await res.json();
}

export async function deleteNote(base: string, path: string): Promise<void> {
  const res = await fetch(
    `${base}/api/sensemaking?action=delete&path=${encodeURIComponent(path)}`,
    { method: "POST", headers: { Accept: "application/json" } },
  );
  if (!res.ok) throw new Error(`delete ${res.status}`);
}

/** Strip the `[[ ]]` wikilink wrapper the vault stores people names in. */
export function displayPerson(p: string): string {
  return p.replace(/^\[\[|\]\]$/g, "");
}

/** Human title for a vault entry (filenames carry a date + id prefix). */
export function entryTitle(e: VaultEntry): string {
  if (e.intent) return e.intent;
  return (e.title || e.path.split("/").pop() || "note")
    .replace(/^\d{4}-\d{2}-\d{2}(-\d{2,4})?(-\d{2})?-/, "")
    .replace(/-/g, " ")
    .trim();
}
