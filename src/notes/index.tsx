import { useEffect, useMemo, useRef, useState } from "react";
import {
  NotebookPen,
  CornerDownLeft,
  Trash2,
  Search,
  Hash,
  AtSign,
  X,
  RefreshCw,
  Quote,
  Link2,
  FileText,
  Loader2,
  Share2,
  Users,
  ArrowLeft,
  Smartphone,
  ArrowUpRight,
  type LucideIcon,
} from "lucide-react";
import type { MurmurModule, PluginContext } from "../host/types";
import {
  captureNote,
  vaultSummary,
  searchVault,
  deleteNote,
  detectType,
  detectUrl,
  displayPerson,
  entryTitle,
  type NoteType,
  type VaultEntry,
} from "../lib/sensemaking";
import SharedEditor from "./SharedEditor";
import { edition } from "../edition";
import { shareNote, withdrawNote } from "../lib/share";
import { approve } from "../identity/participation";
import {
  Page,
  PageHeader,
  PageBody,
  Section,
  Card,
  List,
  Row,
  Status,
  Button,
  Field,
  Empty,
  inputClass,
} from "../ui";

/**
 * Notes — core surface.
 *
 * The personal sense-making layer (the work with Matt Black) made concrete.
 * v0.2 closes the "vault sync" seam: a capture no longer just sits in
 * localStorage — it lands in the unified Decent vault (`core/vault`) through the
 * live `/api/sensemaking` route, typed and carrying Matt's *intent* line, so it
 * becomes a first-class note the `understand` plugin can retrieve. localStorage
 * is now an offline mirror + instant feedback, not the source of truth.
 *
 * Distinct from `understand` (the *shared* corpus) — this is your own thinking,
 * captured the way the sense-making assistant captures it: thought + intent +
 * tags + people, reindexed into the same graph.
 */

interface LocalNote {
  id: string;
  body: string;
  intent: string;
  tags: string[];
  people: string[];
  type: NoteType;
  ts: number;
  /** vault path once synced (e.g. "notes/2026-…md"); absent while local-only */
  vaultPath?: string;
  synced: boolean;
  /** set once the member chose to share this note with the collective (lib/share.ts) */
  shared?: { id: string; at: number };
}

const KEY = "murmur.notes.v2";
const LEGACY_KEY = "murmur.notes.v1";

function load(): LocalNote[] {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) {
      const list = JSON.parse(raw) as LocalNote[];
      // The invented demo always has the sample member's thinking to show.
      if (list.length || !edition.showcase) return list;
      return sampleNotes();
    }
    // migrate v1 ({ id, body, ts }) → local-only, unsynced
    const legacy = localStorage.getItem(LEGACY_KEY);
    if (legacy) {
      const old = JSON.parse(legacy) as { id: string; body: string; ts: number }[];
      return old.map((n) => ({
        id: n.id,
        body: n.body,
        intent: "",
        tags: [],
        people: [],
        type: "note" as NoteType,
        ts: n.ts,
        synced: false,
      }));
    }
  } catch {
    /* ignore */
  }
  return edition.showcase ? sampleNotes() : [];
}

/** The invented demo's sample member thinks across all her groups, here and nowhere else. */
function sampleNotes(): LocalNote[] {
  const day = 86_400_000;
  const now = Date.now();
  const n = (i: number, type: NoteType, body: string, intent: string, tags: string[]): LocalNote => ({
    id: `sample-${i}`, body, intent, tags, people: [], type, ts: now - i * day, synced: false,
  });
  return [
    n(0, "note", "Halfmoon's second film: the interviews sound boxy. Try the hall at Northside, it's quiet on weekday mornings.", "Ask the hall before I suggest it.", ["halfmoon", "northside"]),
    n(1, "quote", "“Ten minutes each, kind and honest.”", "Keep this for the call's page.", ["huxley"]),
    n(2, "note", "The roof piece needs the three quotes side by side, not in a list. People skim lists.", "Before it goes in the Review.", ["huxley", "roof"]),
    n(4, "link", "https://www.gov.uk/guidance/venture-capital-schemes-raise-money-by-offering-tax-reliefs-to-investors", "SEIS limits, for the company piece.", ["seis"]),
    n(6, "note", "Common Loaf: could the vote on the new bread supplier happen on phones, not just at the meeting?", "Raise at the general meeting.", ["loaf"]),
  ];
}

const TYPE_LABEL: Record<string, string> = {
  note: "Note",
  link: "Link",
  quote: "Quote",
  person: "Person",
};

const CHIP =
  "font-mono rounded-[var(--radius)] border border-[var(--line)] px-1.5 py-0.5 text-[11px] text-[var(--muted)]";

function typeIcon(type: string): LucideIcon {
  switch ((type || "").toLowerCase()) {
    case "link":
    case "links":
      return Link2;
    case "quote":
    case "quotes":
      return Quote;
    default:
      return FileText;
  }
}

/** A unified trail item — either a local capture (has body) or a vault entry. */
interface TrailItem {
  key: string;
  ts: number;
  type: string;
  title: string;
  body?: string;
  intent: string;
  tags: string[];
  people: string[];
  vaultPath?: string;
  synced: boolean;
  origin: "local" | "vault";
}

function localToTrail(n: LocalNote): TrailItem {
  return {
    key: n.id,
    ts: n.ts,
    type: n.type,
    title: n.body.slice(0, 80),
    body: n.body,
    intent: n.intent,
    tags: n.tags,
    people: n.people.map(displayPerson),
    vaultPath: n.vaultPath,
    synced: n.synced,
    origin: "local",
  };
}

function vaultToTrail(e: VaultEntry): TrailItem {
  return {
    key: e.path,
    ts: e.created ? new Date(e.created).getTime() : 0,
    type: e.type,
    title: entryTitle(e),
    intent: e.intent,
    tags: e.tags ?? [],
    people: (e.people ?? []).map(displayPerson),
    vaultPath: e.path,
    synced: true,
    origin: "vault",
  };
}

/** A small chip-list input for tags / people. */
function ChipInput({
  value,
  onChange,
  placeholder,
  icon,
  lower,
}: {
  value: string[];
  onChange: (v: string[]) => void;
  placeholder: string;
  icon: React.ReactNode;
  lower?: boolean;
}) {
  const [draft, setDraft] = useState("");
  function commit() {
    const raw = draft.trim().replace(/[,]+$/, "").trim();
    if (!raw) return;
    const v = lower ? raw.toLowerCase().replace(/\s+/g, "-") : raw;
    if (!value.includes(v)) onChange([...value, v]);
    setDraft("");
  }
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <span className="text-[var(--faint)]">{icon}</span>
      {value.map((v) => (
        <span
          key={v}
          className="font-mono flex items-center gap-1 rounded-[var(--radius)] border border-[var(--line)] bg-[var(--raise)] px-1.5 py-0.5 text-[11px] text-[var(--muted)]"
        >
          {v}
          <button
            onClick={() => onChange(value.filter((x) => x !== v))}
            aria-label={`Remove ${v}`}
            className="text-[var(--faint)] hover:text-[var(--fg)]"
          >
            <X className="h-2.5 w-2.5" />
          </button>
        </span>
      ))}
      <input
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === ",") {
            e.preventDefault();
            commit();
          } else if (e.key === "Backspace" && !draft && value.length) {
            onChange(value.slice(0, -1));
          }
        }}
        onBlur={commit}
        placeholder={placeholder}
        className="min-w-[7rem] flex-1 bg-transparent text-xs outline-none placeholder:text-[var(--faint)]"
      />
    </div>
  );
}

function Panel({ instance, identity }: PluginContext) {
  const base = instance.birdbrainBase;
  // The mobile companion (Ask/Capture/Trail) — same vault, pocket-sized.
  const surfaceUrl = `${instance.birdbrainBase || ""}/surface`;

  // Personal capture vs. a live shared note. The room key is the only thing
  // two clients must agree on to land in the same Yjs document.
  const [mode, setMode] = useState<"personal" | "shared">("personal");
  const [roomDraft, setRoomDraft] = useState("");
  const [room, setRoom] = useState<string | null>(null);
  const displayName = useMemo(() => {
    if (identity.handle) return identity.handle;
    const k = "murmur.collab.guest";
    let g = sessionStorage.getItem(k);
    if (!g) {
      g = "guest-" + Math.random().toString(36).slice(2, 6);
      sessionStorage.setItem(k, g);
    }
    return g;
  }, [identity.handle]);

  const [notes, setNotes] = useState<LocalNote[]>(load);
  const [draft, setDraft] = useState("");
  const [intent, setIntent] = useState("");
  const [tags, setTags] = useState<string[]>([]);
  const [people, setPeople] = useState<string[]>([]);
  const [capturing, setCapturing] = useState(false);

  const [vaultRecent, setVaultRecent] = useState<VaultEntry[]>([]);
  const [vaultTotal, setVaultTotal] = useState<number | null>(null);
  const [loadingVault, setLoadingVault] = useState(true);

  const [query, setQuery] = useState("");
  const [results, setResults] = useState<VaultEntry[] | null>(null);
  const [searching, setSearching] = useState(false);

  // Sharing one note: which note is waiting on the door, and what to say about it.
  const [sharing, setSharing] = useState<string | null>(null);
  const [shareMsg, setShareMsg] = useState<{ key: string; text: string } | null>(null);

  const ref = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    localStorage.setItem(KEY, JSON.stringify(notes));
  }, [notes]);

  useEffect(() => {
    ref.current?.focus();
  }, []);

  async function refreshVault() {
    setLoadingVault(true);
    try {
      const s = await vaultSummary(base);
      setVaultRecent(s.recent);
      setVaultTotal(s.total);
    } catch {
      setVaultRecent([]);
      setVaultTotal(null);
    } finally {
      setLoadingVault(false);
    }
  }

  useEffect(() => {
    void refreshVault();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [base]);

  const detected: NoteType = useMemo(
    () => (draft.trim() ? detectType(draft) : "note"),
    [draft],
  );
  const detectedUrl = useMemo(
    () => (draft.trim() ? detectUrl(draft) : undefined),
    [draft],
  );

  async function capture() {
    const body = draft.trim();
    if (!body || capturing) return;
    const type = detectType(body);
    const localId = crypto.randomUUID();
    const note: LocalNote = {
      id: localId,
      body,
      intent: intent.trim(),
      tags,
      people,
      type,
      ts: Date.now(),
      synced: false,
    };
    setNotes((prev) => [note, ...prev]);
    setDraft("");
    setIntent("");
    setTags([]);
    setPeople([]);
    if (!edition.vaultSync) {
      ref.current?.focus();
      return;
    }
    setCapturing(true);
    try {
      const res = await captureNote(base, {
        text: note.body,
        intent: note.intent,
        tags: note.tags,
        people: note.people,
        type: note.type,
        url: detectedUrl,
      });
      setNotes((prev) =>
        prev.map((n) =>
          n.id === localId ? { ...n, synced: true, vaultPath: res.path } : n,
        ),
      );
      void refreshVault();
    } catch {
      // stays local-only; the trail shows a retry affordance
    } finally {
      setCapturing(false);
      ref.current?.focus();
    }
  }

  async function retry(n: LocalNote) {
    setNotes((prev) =>
      prev.map((x) => (x.id === n.id ? { ...x, synced: false } : x)),
    );
    try {
      const res = await captureNote(base, {
        text: n.body,
        intent: n.intent,
        tags: n.tags,
        people: n.people,
        type: n.type,
        url: detectUrl(n.body),
      });
      setNotes((prev) =>
        prev.map((x) =>
          x.id === n.id ? { ...x, synced: true, vaultPath: res.path } : x,
        ),
      );
      void refreshVault();
    } catch {
      /* still offline */
    }
  }

  /** Share one note, or withdraw it. A missing check-in key is turned on with one tap, then tried again. */
  async function shareToggle(n: LocalNote, again = false): Promise<boolean> {
    setSharing(n.id);
    setShareMsg(null);
    try {
      const r = n.shared
        ? await withdrawNote(n.shared.id)
        : await shareNote({ type: n.type, text: n.body, intent: n.intent, tags: n.tags, people: n.people.map(displayPerson) });
      if (r.status === "needs-approval") {
        if (!again && identity.session) {
          setShareMsg({ key: n.id, text: "Sharing is signed with your check-in key. Approve it in your browser." });
          await approve(identity.session);
          return await shareToggle(n, true);
        }
        setShareMsg({ key: n.id, text: identity.session ? "Check-ins are still off on this computer." : "Sign in first. Sharing is signed with your passkey." });
        return false;
      }
      if (r.status === "failed") {
        setShareMsg({ key: n.id, text: r.error });
        return false;
      }
      setNotes((prev) =>
        prev.map((x) => (x.id === n.id ? { ...x, shared: r.status === "shared" ? { id: r.id, at: Date.now() } : undefined } : x)),
      );
      setShareMsg({ key: n.id, text: r.status === "shared" ? `Shared with ${edition.share?.name}. You can withdraw it at any time.` : "Withdrawn. It is no longer in the vault." });
      return true;
    } catch (e: any) {
      setShareMsg({ key: n.id, text: e?.message || "That did not go through." });
      return false;
    } finally {
      setSharing(null);
    }
  }

  async function removeItem(item: TrailItem) {
    // a shared note is withdrawn first, so deleting it here never leaves a copy there
    const local = notes.find((n) => n.id === item.key);
    if (local?.shared && !(await shareToggle(local))) return;
    // delete from the vault if it lives there, then drop the local mirror
    if (item.vaultPath) {
      try {
        await deleteNote(base, item.vaultPath);
      } catch {
        /* best-effort */
      }
    }
    setNotes((prev) =>
      prev.filter((n) => n.id !== item.key && n.vaultPath !== item.vaultPath),
    );
    setVaultRecent((prev) => prev.filter((e) => e.path !== item.vaultPath));
    setResults((prev) =>
      prev ? prev.filter((e) => e.path !== item.vaultPath) : prev,
    );
  }

  async function runSearch(term: string) {
    const q = term.trim();
    setQuery(term);
    if (!q) {
      setResults(null);
      return;
    }
    if (!edition.vaultSync) {
      // notes live here, so search them here
      const needle = q.toLowerCase();
      setResults(
        notes
          .filter((n) => [n.body, n.intent, ...n.tags, ...n.people].some((f) => f.toLowerCase().includes(needle)))
          .map((n) => ({ path: n.id, type: n.type, created: new Date(n.ts).toISOString(), tags: n.tags, people: n.people, intent: n.intent, title: n.body.slice(0, 80) })),
      );
      return;
    }
    setSearching(true);
    try {
      setResults(await searchVault(base, q));
    } catch {
      setResults([]);
    } finally {
      setSearching(false);
    }
  }

  /** Unified, de-duplicated, reverse-chron trail. */
  const trail: TrailItem[] = useMemo(() => {
    const byPath = new Map<string, TrailItem>();
    for (const e of vaultRecent) byPath.set(e.path, vaultToTrail(e));
    const out: TrailItem[] = [];
    const seenPaths = new Set<string>();
    for (const n of notes) {
      const t = localToTrail(n);
      if (n.vaultPath && byPath.has(n.vaultPath)) {
        // local mirror wins (it carries the body); skip the vault twin
        seenPaths.add(n.vaultPath);
      }
      out.push(t);
    }
    for (const [path, t] of byPath) {
      if (!seenPaths.has(path)) out.push(t);
    }
    return out.sort((a, b) => b.ts - a.ts);
  }, [notes, vaultRecent]);

  const showing: TrailItem[] | null = results
    ? results.map((r) => {
        const n = notes.find((x) => x.id === r.path);
        return n ? localToTrail(n) : vaultToTrail(r);
      })
    : null;

  const headerStatus = loadingVault ? (
    <Status tone="idle" pulse>
      Checking the vault
    </Status>
  ) : vaultTotal != null ? (
    <Status tone="ok">
      {vaultTotal} {vaultTotal === 1 ? "note" : "notes"} in the vault
    </Status>
  ) : edition.vaultSync ? (
    <Status tone="warn">Vault offline, saving here</Status>
  ) : (
    <Status tone="idle">On this device</Status>
  );

  const keptWhere = edition.vaultSync
    ? `Syncs to ${edition.vaultName}`
    : edition.share
    ? "Saved on this device until you share it"
    : "Saved on this device";

  function openRoom() {
    const r = roomDraft.trim().toLowerCase().replace(/\s+/g, "-");
    if (r) setRoom(r);
  }

  return (
    <Page>
      <PageHeader
        icon={NotebookPen}
        eyebrow="notes"
        title="Notes"
        lede={
          edition.demo
            ? "Your space to think. No group sees it unless you share it."
            : edition.vaultSync
            ? `Capture a thought and why it matters. Kept in ${edition.vaultName}.`
            : edition.share
            ? `Capture a thought and why it matters. Kept on this device. Share a note with ${edition.share.name} when you want to, and take it back whenever you like.`
            : "Capture a thought and why it matters. Kept on this device, for you alone."
        }
        actions={
          <>
            {headerStatus}
            {edition.vaultSync && (
              <a
                href={surfaceUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1.5 px-1 text-xs text-[var(--muted)] underline-offset-4 hover:text-[var(--fg)] hover:underline"
              >
                <Smartphone className="h-3.5 w-3.5" />
                On your phone
                <ArrowUpRight className="h-3.5 w-3.5" />
              </a>
            )}
          </>
        }
      >
        {/* Personal capture vs. a live shared note */}
        <div
          role="tablist"
          className="mt-4 inline-flex rounded-[var(--radius)] border border-[var(--line)] bg-[var(--raise)] p-0.5 text-xs"
        >
          {(["personal", "shared"] as const).map((m) => (
            <button
              key={m}
              role="tab"
              aria-selected={mode === m}
              onClick={() => setMode(m)}
              className={`flex items-center gap-1.5 rounded-[var(--radius)] px-3 py-1 transition ${
                mode === m
                  ? "border border-[var(--line-strong)] bg-[var(--card)] text-[var(--fg)]"
                  : "border border-transparent text-[var(--muted)] hover:text-[var(--fg)]"
              }`}
            >
              {m === "personal" ? (
                <NotebookPen className="h-3.5 w-3.5" />
              ) : (
                <Share2 className="h-3.5 w-3.5" />
              )}
              {m === "personal" ? "Personal" : "Shared"}
            </button>
          ))}
        </div>
      </PageHeader>

      {mode === "personal" ? (
        <PageBody width="wide">
          {/* Capture */}
          <div
            className="prism-hover rounded-[var(--radius)] border border-[var(--line-strong)] bg-[var(--card)] px-4 py-3"
            data-active={draft.length > 0}
          >
            <textarea
              ref={ref}
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                  e.preventDefault();
                  void capture();
                }
              }}
              rows={3}
              placeholder="What are you making sense of?"
              className="w-full resize-none bg-transparent text-[15px] leading-relaxed outline-none placeholder:text-[var(--faint)]"
            />

            {/* Intent: the step that turns a note into sensemaking */}
            <div className="mt-2 border-t border-[var(--line)] pt-2">
              <input
                value={intent}
                onChange={(e) => setIntent(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                    e.preventDefault();
                    void capture();
                  }
                }}
                placeholder="Why it matters (optional)"
                className="w-full bg-transparent text-[13px] outline-none placeholder:text-[var(--faint)]"
              />
            </div>

            {/* Tags + people → vault frontmatter */}
            <div className="mt-2 grid gap-2 border-t border-[var(--line)] pt-2 sm:grid-cols-2">
              <ChipInput
                value={tags}
                onChange={setTags}
                placeholder="Tags"
                lower
                icon={<Hash className="h-3 w-3" />}
              />
              <ChipInput
                value={people}
                onChange={setPeople}
                placeholder="People"
                icon={<AtSign className="h-3 w-3" />}
              />
            </div>

            <div className="mt-3 flex items-center justify-between gap-3 border-t border-[var(--line)] pt-3">
              <span className="text-xs text-[var(--faint)]" title={`Detected type: ${detected}`}>
                {detectedUrl ? "Link" : TYPE_LABEL[detected] ?? "Note"} · {keptWhere}
              </span>
              <Button
                variant="primary"
                icon={CornerDownLeft}
                busy={capturing}
                disabled={!draft.trim()}
                onClick={() => void capture()}
              >
                Capture
              </Button>
            </div>
          </div>

          {/* Recall / search the vault */}
          <div className="relative">
            <Search className="pointer-events-none absolute top-1/2 left-3 h-3.5 w-3.5 -translate-y-1/2 text-[var(--faint)]" />
            <input
              value={query}
              onChange={(e) => void runSearch(e.target.value)}
              placeholder="Search your notes"
              aria-label="Search your notes"
              className={`${inputClass} pr-9 pl-9`}
            />
            <span className="absolute top-1/2 right-3 flex -translate-y-1/2 items-center">
              {searching ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin text-[var(--faint)]" />
              ) : query ? (
                <button
                  onClick={() => runSearch("")}
                  aria-label="Clear search"
                  className="text-[var(--faint)] hover:text-[var(--fg)]"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              ) : null}
            </span>
          </div>

          {/* Trail */}
          {showing ? (
            showing.length === 0 ? (
              <Empty>Nothing matches “{query}”.</Empty>
            ) : (
              <Section label={`${showing.length} result${showing.length === 1 ? "" : "s"}`}>
                <TrailList items={showing} onRemove={removeItem} onRetry={retry} notes={notes} onShare={shareToggle} sharing={sharing} shareMsg={shareMsg} />
              </Section>
            )
          ) : trail.length === 0 ? (
            <Empty>
              {edition.vaultSync
                ? `No notes yet. They sync to ${edition.vaultName}.`
                : "No notes yet."}
            </Empty>
          ) : (
            <Section label="recent">
              <TrailList items={trail} onRemove={removeItem} onRetry={retry} notes={notes} onShare={shareToggle} sharing={sharing} shareMsg={shareMsg} />
            </Section>
          )}
        </PageBody>
      ) : room ? (
        <div className="flex min-h-0 flex-1 flex-col px-8 pt-6 pb-20">
          <div className="mb-3 flex items-center justify-between gap-3">
            <div className="flex min-w-0 items-center gap-2 text-xs">
              <Button variant="quiet" icon={ArrowLeft} onClick={() => setRoom(null)}>
                Rooms
              </Button>
              <span className="text-[var(--line-strong)]">/</span>
              <span className="font-mono truncate text-[var(--fg)]">{room}</span>
            </div>
            <span className="text-xs text-[var(--muted)]">
              You are <span className="font-mono text-[var(--fg)]">{displayName}</span>
            </span>
          </div>
          <SharedEditor room={room} base={base} displayName={displayName} />
        </div>
      ) : (
        <PageBody>
          <Section
            label="shared note"
            icon={Users}
            lede={
              edition.vaultSync
                ? "Edit one live note together. Save it to the vault when you're done."
                : "Edit one live note together."
            }
          >
            <Card>
              <Field label="Room name" hint="Anyone who types the same name joins.">
                <input
                  value={roomDraft}
                  onChange={(e) => setRoomDraft(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") openRoom();
                  }}
                  placeholder="e.g. alice-and-bob"
                  className={inputClass}
                />
              </Field>
              <div className="mt-4">
                <Button
                  variant="primary"
                  icon={Share2}
                  onClick={openRoom}
                  disabled={!roomDraft.trim()}
                >
                  Open shared note
                </Button>
              </div>
            </Card>
          </Section>
        </PageBody>
      )}
    </Page>
  );
}

function TrailList({
  items,
  onRemove,
  onRetry,
  notes,
  onShare,
  sharing,
  shareMsg,
}: {
  items: TrailItem[];
  onRemove: (i: TrailItem) => void;
  onRetry: (n: LocalNote) => void;
  notes: LocalNote[];
  onShare: (n: LocalNote) => void;
  sharing: string | null;
  shareMsg: { key: string; text: string } | null;
}) {
  return (
    <List>
      {items.map((item) => {
        const local = notes.find((n) => n.id === item.key);
        const when = item.ts
          ? new Date(item.ts).toLocaleString([], {
              day: "numeric",
              month: "short",
              hour: "2-digit",
              minute: "2-digit",
            })
          : "";
        return (
          <div key={item.key} className="group">
            <Row
              icon={typeIcon(item.type)}
              title={
                <span className="whitespace-pre-wrap font-normal">
                  {item.body ?? item.title}
                </span>
              }
              detail={
                <>
                  {item.intent && <p>{item.intent}</p>}
                  {(item.tags.length > 0 || item.people.length > 0) && (
                    <div className="mt-2 flex flex-wrap items-center gap-1.5">
                      {item.tags.map((t) => (
                        <span key={`t-${t}`} className={CHIP}>
                          #{t}
                        </span>
                      ))}
                      {item.people.map((p) => (
                        <span key={`p-${p}`} className={CHIP}>
                          @{p}
                        </span>
                      ))}
                    </div>
                  )}
                  <div className="mt-2 flex flex-wrap items-center gap-3">
                    {when && (
                      <span className="font-mono text-[11px] text-[var(--faint)]">{when}</span>
                    )}
                    {item.synced ? (
                      <span title={item.vaultPath}>
                        <Status tone="ok">In the vault</Status>
                      </span>
                    ) : edition.vaultSync ? (
                      <>
                        <Status tone="warn">Not synced yet</Status>
                        {local && (
                          <Button
                            variant="quiet"
                            icon={RefreshCw}
                            onClick={() => onRetry(local)}
                          >
                            Try again
                          </Button>
                        )}
                      </>
                    ) : local?.shared ? (
                      <>
                        <Status tone="ok">Shared with {edition.share?.name}</Status>
                        <Button variant="quiet" busy={sharing === local.id} onClick={() => onShare(local)}>
                          Withdraw
                        </Button>
                      </>
                    ) : (
                      <>
                        <Status tone="idle">On this device</Status>
                        {edition.share && local && (
                          <Button variant="quiet" icon={Share2} busy={sharing === local.id} onClick={() => onShare(local)}>
                            Share with {edition.share.name}
                          </Button>
                        )}
                      </>
                    )}
                  </div>
                  {shareMsg?.key === item.key && (
                    <p className="mt-1.5 text-xs text-[var(--muted)]">{shareMsg.text}</p>
                  )}
                </>
              }
              action={
                <button
                  onClick={() => onRemove(item)}
                  aria-label="Delete note"
                  title={edition.vaultSync || local?.shared ? "Delete, from the vault too" : "Delete"}
                  className="text-[var(--faint)] opacity-0 transition group-hover:opacity-100 hover:text-[var(--danger)] focus:opacity-100"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              }
            />
          </div>
        );
      })}
    </List>
  );
}

export const notesSurface: MurmurModule = {
  id: "notes",
  title: "Notes",
  tagline: edition.vaultSync
    ? `Capture a thought and why it matters, kept in ${edition.vaultName}`
    : "Capture a thought and why it matters, kept on this device",
  icon: NotebookPen,
  order: 1,
  kind: "core",
  backend: edition.vaultSync ? "The Decent vault" : edition.share ? `On this device, shared with ${edition.share.name} by choice` : "On this device",
  Panel,
};
