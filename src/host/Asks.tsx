import { useEffect, useMemo, useState } from "react";
import { ArrowLeft, Check, MessageSquarePlus, Search } from "lucide-react";
import type { Identity, MurmurModule } from "./types";
import { edition } from "../edition";
import { Button, Status, inputClass } from "../ui";
import { approve, liveGrantId, participate } from "../identity/participation";

/**
 * The plugin registry and plugin asks (ADR 0078).
 *
 * An app can only install what its signed release carries. So the Plugins sheet
 * searches every plugin that exists (the collective's `/plugins.json`, made by
 * scripts/plugin-registry.ts), and anything this edition does not carry becomes an
 * ask rather than a download. An ask is signed with the participation key, so
 * asking counts as taking part, and it is filed with the collective's own server
 * (infra/services/plugin-asks), never Zo's. Who decides is the collective's own
 * data: its operator while incubated, a trusted group of early members during the
 * handover, then its own governance.
 */

export type Entry = {
  id: string;
  title: string;
  tagline: string;
  backend: string | null;
  by: string;
  lab: boolean;
  madeFor: string | null;
  editions: { id: string; name: string }[];
  held: boolean;
};

type AskRow = { id: string; title: string; need: string; plugin: string | null; by: string; at: string; status: string; note: string | null };
type AskList = { stage: string; approvers: string; line: string; asks: AskRow[] };

const base = edition.asks?.base ?? null;

async function getJson<T>(path: string): Promise<T | null> {
  if (!base) return null;
  try {
    const r = await fetch(`${base}${path}`, { headers: { Accept: "application/json" } });
    return r.ok ? ((await r.json()) as T) : null;
  } catch {
    return null;
  }
}

export function useRegistry(): Entry[] | null {
  const [list, setList] = useState<Entry[] | null>(null);
  useEffect(() => {
    getJson<{ plugins: Entry[] }>("/plugins.json").then((r) => setList(r?.plugins ?? []));
  }, []);
  return list;
}

function useAsks(): [AskList | null, () => void] {
  const [list, setList] = useState<AskList | null>(null);
  const [n, setN] = useState(0);
  useEffect(() => {
    getJson<AskList>("/api/plugins/asks").then(setList);
  }, [n]);
  return [list, () => setN((x) => x + 1)];
}

const words = (q: string) => q.toLowerCase().split(/\s+/).filter(Boolean);
const hits = (q: string, ...fields: (string | null | undefined)[]) => {
  const hay = fields.filter(Boolean).join(" ").toLowerCase();
  return words(q).every((w) => hay.includes(w));
};

/** Where a plugin from elsewhere lives, in a few words. */
function whereLine(e: Entry): string {
  if (e.madeFor) return `Made for ${e.madeFor}`;
  if (e.editions.length) return `In ${e.editions.map((x) => x.name).join(", ")}`;
  if (e.held) return "Built, not in any app yet";
  return "In other collectives' apps";
}

export function SearchBox({ q, setQ }: { q: string; setQ: (q: string) => void }) {
  return (
    <label className="flex items-center gap-2 rounded-[var(--radius)] border border-[var(--line)] px-3 py-2 focus-within:border-[var(--fg)]">
      <Search className="h-4 w-4 shrink-0 text-[var(--faint)]" />
      <input
        aria-label="Search plugins"
        value={q}
        onChange={(e) => setQ(e.target.value)}
        placeholder="Search every plugin that exists"
        className="w-full bg-transparent text-sm outline-none placeholder:text-[var(--faint)]"
        autoFocus
      />
    </label>
  );
}

/** Search results: what this app carries (as normal rows), then what exists elsewhere. */
export function SearchResults({
  q,
  carried,
  renderRow,
  registry,
  onAsk,
}: {
  q: string;
  carried: MurmurModule[];
  renderRow: (p: MurmurModule) => React.ReactNode;
  registry: Entry[] | null;
  onAsk: (plugin: string | null, title: string) => void;
}) {
  const here = carried.filter((p) => hits(q, p.id, p.title, p.tagline, p.backend));
  const ids = new Set(carried.map((p) => p.id));
  const elsewhere = (registry ?? []).filter((e) => !ids.has(e.id) && hits(q, e.id, e.title, e.tagline, e.backend, e.madeFor));
  return (
    <div className="flex flex-col gap-5">
      <section className="flex flex-col gap-2">
        <div className="px-1 font-tight text-sm font-medium">In {edition.instance.name}</div>
        {here.length ? here.map(renderRow) : <p className="px-1 text-xs text-[var(--faint)]">Nothing here matches.</p>}
      </section>
      <section className="flex flex-col gap-2">
        <div className="flex items-baseline gap-2 px-1">
          <span className="font-tight text-sm font-medium">Elsewhere</span>
          <span className="text-xs text-[var(--faint)]">Not in this app yet. Ask, and it can come in a later release.</span>
        </div>
        {registry === null && base && <p className="px-1 text-xs text-[var(--faint)]">Looking…</p>}
        {!base && <p className="px-1 text-xs text-[var(--faint)]">{edition.instance.name} has no address of its own for the full list yet.</p>}
        {elsewhere.map((e) => (
          <article key={e.id} className="flex items-center gap-4 rounded-[var(--radius)] border border-dashed border-[var(--line-strong)] px-4 py-3">
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <span className="font-tight text-sm font-medium">{e.title}</span>
                {e.lab && <Status>lab</Status>}
              </div>
              <div className="mt-0.5 truncate text-xs text-[var(--muted)]">
                {whereLine(e)} · {e.tagline}
              </div>
            </div>
            <Button onClick={() => onAsk(e.id, e.title)} disabled={!base}>
              Ask for this
            </Button>
          </article>
        ))}
        {registry && base && !elsewhere.length && <p className="px-1 text-xs text-[var(--faint)]">Nothing elsewhere matches either.</p>}
      </section>
      <button
        onClick={() => onAsk(null, q.trim())}
        disabled={!base}
        className="flex items-center gap-2 self-start px-1 text-sm text-[var(--muted)] hover:text-[var(--fg)] disabled:opacity-50"
      >
        <MessageSquarePlus className="h-4 w-4" />
        Nothing that fits? Ask for a new plugin
      </button>
    </div>
  );
}

const STATUS: Record<string, [string, "idle" | "ok" | "live" | "warn"]> = {
  waiting: ["waiting", "idle"],
  approved: ["approved", "ok"],
  building: ["being built", "live"],
  shipped: ["shipped", "ok"],
  declined: ["declined", "warn"],
};

/** The asks filed with this collective, and who decides them. Shown under the tiers. */
export function AsksSection({ onAsk, refreshKey }: { onAsk: () => void; refreshKey: number }) {
  const [list, refresh] = useAsks();
  useEffect(() => {
    if (refreshKey) refresh();
  }, [refreshKey]);
  return (
    <section className="flex flex-col gap-2">
      <div className="flex items-baseline justify-between gap-2 px-1">
        <div className="flex items-baseline gap-2">
          <span className="font-tight text-sm font-medium">Asks</span>
          <span className="text-xs text-[var(--faint)]">
            {base ? (list ? `Decided by ${list.approvers}` : "Plugins members have asked for") : "Waiting on an address of its own"}
          </span>
        </div>
        {base && (
          <Button variant="quiet" icon={MessageSquarePlus} onClick={onAsk}>
            Ask for a plugin
          </Button>
        )}
      </div>
      {!base && (
        <p className="px-1 text-xs text-[var(--faint)]">
          Asks are filed with {edition.instance.name}'s own server. They open once it has one.
        </p>
      )}
      {list?.asks.slice(0, 8).map((a) => (
        <article key={a.id} className="rounded-[var(--radius)] border border-[var(--line)] px-4 py-3">
          <div className="flex items-center gap-2">
            <span className="font-tight text-sm font-medium">{a.title}</span>
            <Status tone={STATUS[a.status]?.[1] ?? "idle"}>{STATUS[a.status]?.[0] ?? a.status}</Status>
          </div>
          <div className="mt-0.5 line-clamp-2 text-xs text-[var(--muted)]">{a.need}</div>
          <div className="mt-1 text-xs text-[var(--faint)]">
            {a.by} · {new Date(a.at).toLocaleDateString("en-GB", { day: "numeric", month: "short" })}
            {a.note ? ` · ${a.note}` : ""}
          </div>
        </article>
      ))}
      {list && !list.asks.length && <p className="px-1 text-xs text-[var(--faint)]">Nobody has asked for anything yet.</p>}
    </section>
  );
}

const b64u = (buf: ArrayBuffer) =>
  btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
/** The ask's id, computed the way infra/services/plugin-asks/asks.ts computes it. */
async function askId(a: Record<string, unknown>): Promise<string> {
  const sorted = "{" + Object.keys(a).sort().map((k) => JSON.stringify(k) + ":" + JSON.stringify(a[k])).join(",") + "}";
  return b64u(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(sorted))).slice(0, 22);
}

/** The ask itself: say what you need, see what already exists, sign it, file it. */
export function AskForm({
  plugin,
  initialTitle,
  registry,
  carried,
  identity,
  onBack,
  onFiled,
}: {
  plugin: string | null;
  initialTitle: string;
  registry: Entry[] | null;
  carried: MurmurModule[];
  identity: Identity;
  onBack: () => void;
  onFiled: () => void;
}) {
  const [title, setTitle] = useState(initialTitle);
  const [need, setNeed] = useState("");
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<{ ok: boolean; text: string; turnOn?: boolean } | null>(null);
  const [list] = useAsks();
  const existing = registry?.find((e) => e.id === plugin) ?? null;

  // Search first, so nobody asks for something that already exists.
  const near = useMemo(() => {
    if (plugin || title.trim().length < 3) return [];
    const q = title.trim();
    return [
      ...carried.filter((p) => hits(q, p.title, p.tagline)).map((p) => ({ id: p.id, title: p.title, where: `Already in ${edition.instance.name}` })),
      ...(registry ?? [])
        .filter((e) => !carried.some((p) => p.id === e.id) && hits(q, e.title, e.tagline))
        .map((e) => ({ id: e.id, title: e.title, where: whereLine(e) })),
    ].slice(0, 4);
  }, [title, plugin, registry, carried]);

  async function file() {
    if (!edition.asks) return;
    setBusy(true);
    setNote(null);
    try {
      const ask = { v: 1, collective: edition.instance.slug, plugin, title: title.trim(), need: need.trim() };
      const id = await askId(ask);
      const r = await participate("ask", `ask:${id}`);
      if (r.status === "needs-approval") {
        setNote({ ok: false, text: "Asks are signed with your check-in key, and check-ins are off on this computer.", turnOn: true });
        return;
      }
      if (r.status === "unsupported") {
        setNote({ ok: false, text: `${edition.instance.name}'s sign-in cannot sign asks yet.` });
        return;
      }
      if (r.status === "failed") {
        setNote({ ok: false, text: r.error });
        return;
      }
      const res = await fetch(`${edition.asks.base}/api/plugins/ask`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify({ ask, grantId: liveGrantId() }),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok || !j.ok) {
        setNote({ ok: false, text: j.error || `${edition.instance.name}'s server answered ${res.status}.` });
        return;
      }
      setNote({ ok: true, text: j.already ? "You had already asked for exactly this. It is on the list." : `Filed with ${edition.instance.name}. ${list?.approvers ?? "Its approvers"} decide it, and you can follow it under Asks.` });
      onFiled();
    } catch (e: any) {
      setNote({ ok: false, text: e?.message || "Could not file the ask." });
    } finally {
      setBusy(false);
    }
  }

  async function turnOn() {
    if (!identity.session) return;
    setBusy(true);
    try {
      await approve(identity.session);
      setNote(null);
      await file();
    } catch (e: any) {
      setNote({ ok: false, text: e?.message || "The approval did not finish." });
      setBusy(false);
    }
  }

  const done = note?.ok;
  const ready = title.trim().length > 0 && title.trim().length <= 80 && need.trim().length >= 10 && need.trim().length <= 2000;

  return (
    <div className="flex flex-col gap-4">
      <button onClick={onBack} className="flex items-center gap-1 self-start text-xs text-[var(--muted)] hover:text-[var(--fg)]">
        <ArrowLeft className="h-3.5 w-3.5" /> Back to plugins
      </button>
      <div>
        <div className="font-tight text-base font-medium">{existing ? `Ask for ${existing.title}` : "Ask for a new plugin"}</div>
        <p className="mt-1 text-xs text-[var(--muted)]">
          {existing
            ? `${existing.title} is ${whereLine(existing).toLowerCase()}. Say what ${edition.instance.name} would use it for.`
            : "Say what you need in plain words. If it is agreed, it is built, reviewed and comes in a later release of the app."}
        </p>
      </div>

      {!existing && (
        <label className="flex flex-col gap-1">
          <span className="text-xs text-[var(--muted)]">What would you call it?</span>
          <input className={inputClass} value={title} maxLength={80} onChange={(e) => setTitle(e.target.value)} disabled={busy || done} />
        </label>
      )}
      {near.length > 0 && !done && (
        <div className="flex flex-col gap-1 rounded-[var(--radius)] bg-[var(--line)]/40 px-3 py-2 text-xs">
          <span className="text-[var(--muted)]">These already exist. One of them may do it:</span>
          {near.map((n) => (
            <span key={n.id}>
              <span className="font-medium">{n.title}</span> <span className="text-[var(--faint)]">· {n.where}</span>
            </span>
          ))}
        </div>
      )}
      <label className="flex flex-col gap-1">
        <span className="text-xs text-[var(--muted)]">What should it do, and for whom?</span>
        <textarea
          className={`${inputClass} min-h-28`}
          value={need}
          maxLength={2000}
          onChange={(e) => setNeed(e.target.value)}
          disabled={busy || done}
          placeholder="For example: a page where members can see which rooms we have booked this month, and book one."
        />
      </label>

      <div className="rounded-[var(--radius)] border border-[var(--line)] px-3 py-2 text-xs text-[var(--muted)]">
        <span className="font-medium text-[var(--fg)]">Who decides: {list?.approvers ?? "…"}</span>
        {list?.line ? <span className="block pt-0.5">{list.line}</span> : null}
        <span className="block pt-0.5">Asking is signed with your check-in key, so it counts as taking part in {edition.instance.name}.</span>
      </div>

      {note && (
        <p className={`text-xs ${note.ok ? "text-[var(--fg)]" : "text-[var(--danger)]"}`}>
          {note.ok && <Check className="mr-1 inline h-3.5 w-3.5" />}
          {note.text}
        </p>
      )}

      <div className="flex gap-2">
        {done ? (
          <Button onClick={onBack}>Done</Button>
        ) : note?.turnOn ? (
          <Button variant="primary" onClick={turnOn} busy={busy} disabled={!identity.session}>
            Turn on check-ins and ask
          </Button>
        ) : (
          <Button variant="primary" onClick={file} busy={busy} disabled={!ready || !identity.signedIn}>
            {identity.signedIn ? "Sign and ask" : "Sign in first"}
          </Button>
        )}
      </div>
    </div>
  );
}
