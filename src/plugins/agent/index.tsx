import { Horizon } from "../../demo/brief";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import {
  ArrowUpRight,
  Check,
  ChevronDown,
  CornerDownLeft,
  History,
  RotateCcw,
  Sparkles,
  Trash2,
} from "lucide-react";
import type { MurmurPlugin, PluginContext } from "../../host/types";
import { issues } from "../../host/support";
import { edition, groupWord, installs, shaped } from "../../edition";
import { Button, Notice, Page, PageHeader, Section, Waiting } from "../../ui";
import { getModule, pluginCatalog } from "../../host/registry";
import { listSecrets } from "../../lib/secrets";
import { signInToOps } from "../../lib/ops";
import { useReach } from "../../lib/reach";
import { supported as checkInsSupported, useParticipation } from "../../identity/participation";
import { sampleAnswers, sampleFallback } from "../../demo/sample";
import { askClaude, claudeStatus } from "../../lib/claude";

/**
 * The collective's own agent, inside the app. Named after the edition (Decent,
 * Birdbrain, FTTF): a member talks to the company or collective itself.
 *
 * It answers over the same room-agent engine as the chat on birdbrain.wtf, in
 * its app mode (infra/services/room-agent/app-guide/): first it helps a member
 * get set up, then it answers from the collective's own documentation. The door
 * that holds the member's session picks the agent (`<signIn.pair>/ask`), so a
 * plugin can never ask another collective's agent.
 *
 * Two halves, on purpose. The setup list is worked out here from the app's own
 * state, so it is always right even when the model is slow or down. The
 * conversation is the model's, and it can point back into the app with buttons.
 *
 * What the agent is told about this member is a short report (`report()`):
 * flags and counts, never a key's name or value, a message or a note. The
 * conversation stays on this computer and goes back with each question as
 * history, like the web page; the server keeps none of it. Past conversations
 * are kept too, on this computer only, and listed under Conversations.
 *
 * Two ways to answer (rich, 2026-10-21). The collective's own model, through
 * the door, by default. Or, when this computer has Claude Code, the member's
 * own Claude, as their general assistant: it answers anything, and the door
 * (or `edition.context`, Decent's own box) sends the passages from the
 * collective's documents and the app guide for the questions that need them.
 * Claude Code runs it here, on the member's own subscription (lib/claude.ts).
 */

/** Before conversations were kept: one running thread. Read once, then folded into the list. */
const THREAD_KEY = "murmur.agent.v1";
const CONVOS_KEY = "murmur.agent.conversations.v1";
const ENGINE_KEY = "murmur.agent.engine.v1";
const MAX_CONVOS = 50;
const FOLD_KEY = "murmur.agent.setup-folded.v1";
const MATRIX_KEY = "murmur.matrix.session.v1";
const INVITED_KEY = "murmur.invited.v1";

interface Turn {
  q: string;
  a: string;
  actions?: string[];
  error?: string;
  at: number;
  /** Answered by the member's own Claude rather than the collective's model. */
  by?: "claude";
}

interface Conversation {
  id: string;
  at: number;
  turns: Turn[];
}

const turnsOf = (t: unknown): Turn[] => (Array.isArray(t) ? t.filter((x) => x && typeof x.q === "string") : []);

function loadConvos(): Conversation[] {
  try {
    const list = JSON.parse(localStorage.getItem(CONVOS_KEY) || "null");
    if (Array.isArray(list)) {
      return list
        .filter((c) => c && typeof c.id === "string")
        .map((c) => ({ id: c.id, at: Number(c.at) || 0, turns: turnsOf(c.turns) }))
        .filter((c) => c.turns.length);
    }
    // First run with conversations: the old single thread becomes the first one.
    const old = turnsOf(JSON.parse(localStorage.getItem(THREAD_KEY) || "[]"));
    return old.length ? [{ id: crypto.randomUUID(), at: old[old.length - 1].at, turns: old }] : [];
  } catch {
    return [];
  }
}

function saveConvos(list: Conversation[]) {
  try {
    const kept = [...list]
      .filter((c) => c.turns.length)
      .sort((a, b) => b.at - a.at)
      .slice(0, MAX_CONVOS)
      .map((c) => ({ ...c, turns: c.turns.slice(-40) }));
    localStorage.setItem(CONVOS_KEY, JSON.stringify(kept));
    localStorage.removeItem(THREAD_KEY);
  } catch {
    /* a full store costs the history, never the answer */
  }
}

const titleOf = (c: Conversation) => {
  const q = c.turns.find((t) => t.q && t.q !== "(not sent)")?.q ?? "A conversation";
  return q.length > 80 ? `${q.slice(0, 78)}…` : q;
};

const whenOf = (at: number) => {
  const d = new Date(at);
  const today = new Date();
  if (d.toDateString() === today.toDateString()) return d.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
  return d.toLocaleDateString(undefined, { day: "numeric", month: "short", ...(d.getFullYear() === today.getFullYear() ? {} : { year: "numeric" }) });
};

/** Something that looks like a key or token. Never sent: it belongs in Settings.
 *  The door strips the same shapes (room-agent engine/app-door.ts). */
const SECRETISH = /\b(?:sk|pk|rk|ghp|gho|github_pat|xox[abprs]|AKIA|AIza|whsec|sk_live|sk_test)[-_A-Za-z0-9]{6,}|\b[A-Za-z0-9+/_-]{32,}={0,2}(?![A-Za-z0-9])/;

/** What the model is writing, minus the lines that become buttons. */
const visible = (s: string) =>
  s
    .replace(/\s*\**\s*ACTION\s*:[^\n]*$/i, "")
    .split("\n")
    .filter((l) => !/^\s*\**\s*ACTION\s*:/i.test(l))
    .join("\n")
    .replace(/\*\*/g, "")
    .replace(/\s+[—–]\s+/g, ", ")
    .trim();

/** The places an answer points to, as buttons: only ones this edition has, two at most. */
function takeActions(s: string): { a: string; actions: string[] } {
  const places = [...s.matchAll(/ACTION\s*:\s*\**\s*open\s*:\s*([A-Za-z]+)/gi)]
    .map((m) => m[1].toLowerCase())
    .filter((p) => !!getModule(p));
  return { a: visible(s.replace(/[ \t]*\**[ \t]*ACTION[ \t]*:[ \t]*\**[ \t]*open[ \t]*:[ \t]*[A-Za-z]+\**[.,]?/gi, "")), actions: [...new Set(places)].slice(0, 2) };
}

// ── the setup list ──────────────────────────────────────────────────────────

interface Step {
  id: string;
  title: string;
  hint: string;
  done: boolean;
  place: string;
  ask: string;
}

function useSetup(identity: PluginContext["identity"], installed: string[]): Step[] {
  const { grant } = useParticipation();
  const [, tick] = useState(0);

  // Chat sign-in, keys and invites live in other plugins; look again whenever
  // the member comes back to this panel or saves a key.
  useEffect(() => {
    const on = () => tick((n) => n + 1);
    window.addEventListener("focus", on);
    window.addEventListener("murmur:secrets", on);
    window.addEventListener("storage", on);
    return () => {
      window.removeEventListener("focus", on);
      window.removeEventListener("murmur:secrets", on);
      window.removeEventListener("storage", on);
    };
  }, []);

  const has = (id: string) => installed.includes(id);
  const signedIn = !!(identity.signedIn && identity.session);
  const steps: Step[] = [
    {
      id: "signin",
      title: "Sign in with your passkey",
      hint: `So ${edition.instance.name} knows who it is talking to.`,
      done: signedIn,
      place: "identity",
      ask: "How do I sign in with my passkey?",
    },
  ];
  if (checkInsSupported) {
    steps.push({
      id: "checkins",
      title: "Turn on check-ins",
      hint: "One tap, and calls and chat count as taking part.",
      done: !!grant && grant.exp > Date.now() / 1000,
      place: "identity",
      ask: "What are check-ins and how do I turn them on?",
    });
  }
  if (has("chat")) {
    steps.push({
      id: "chat",
      title: "Connect Chat",
      hint: `Talk to the people in your ${groupWord}.`,
      done: !!localStorage.getItem(MATRIX_KEY),
      place: "chat",
      ask: "How do I chat with people here?",
    });
  }
  steps.push({
    id: "keys",
    title: "Passwords for other services",
    hint: "Optional. Add one when a service needs it.",
    done: listSecrets().length > 0,
    place: "settings",
    ask: "How do I add an API key, and what are keys for?",
  });
  if (has("invite")) {
    steps.push({
      id: "invite",
      title: "Invite someone",
      hint: "Send an invite link, never a bare download.",
      done: !!localStorage.getItem(INVITED_KEY),
      place: "invite",
      ask: "How do I add someone to the app?",
    });
  }
  return steps;
}

/** The report the agent gets about this member's setup. Flags and counts only. */
function report(steps: Step[], installed: string[]) {
  const done = (id: string) => steps.find((s) => s.id === id)?.done;
  return {
    checkIns: checkInsSupported ? (done("checkins") ? "on" : "off") : "unsupported",
    ...(installs(edition).includes("chat") ? { chat: !!done("chat") } : {}),
    keys: listSecrets().length,
    ...(edition.ops ? { ops: installed.includes("operations") ? "paired" : "unpaired" } : {}),
    installed,
  };
}

// ── asking ──────────────────────────────────────────────────────────────────

type Event =
  | { type: "waiting"; waitedMs: number }
  | { type: "token"; t: string }
  | { type: "done"; answer: string; actions?: string[] }
  | { type: "error"; error: string };

async function ask(
  session: string,
  question: string,
  history: Turn[],
  state: unknown,
  on: (e: Event) => void,
  signal: AbortSignal,
) {
  const r = await fetch(`${edition.signIn.pair}/ask`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "text/event-stream" },
    body: JSON.stringify({
      session,
      question,
      history: history.filter((t) => t.a && !t.error).slice(-6).map((t) => ({ q: t.q, a: t.a })),
      state,
    }),
    signal,
  });
  if (!r.ok || !r.body || !(r.headers.get("content-type") || "").includes("event-stream")) {
    const j = await r.json().catch(() => ({}));
    if (r.status === 401) throw new Error("Your sign-in has run out. Sign in again in Identity.");
    throw new Error(j.error || `The door answered ${r.status}.`);
  }
  const reader = r.body.getReader();
  const decoder = new TextDecoder();
  let buf = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    const frames = buf.split("\n\n");
    buf = frames.pop() ?? "";
    for (const f of frames) {
      const ev = f.match(/^event: (.+)$/m)?.[1];
      const data = f.match(/^data: (.+)$/m)?.[1];
      if (!ev || !data) continue;
      try {
        on({ type: ev, ...JSON.parse(data) } as Event);
      } catch {
        /* a malformed frame is skipped, the next one still lands */
      }
    }
  }
}

/**
 * The same question for the member's own Claude, as a general assistant: the
 * collective composes the prompt with whatever of its documents match, and
 * Claude Code runs it here.
 */
async function askOwnClaude(
  session: string,
  question: string,
  history: Turn[],
  state: unknown,
  onToken: (t: string) => void,
  signal: AbortSignal,
): Promise<string> {
  const r = await fetch(edition.context ?? `${edition.signIn.pair}/context`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({
      session,
      question,
      history: history.filter((t) => t.a && !t.error).slice(-6).map((t) => ({ q: t.q, a: t.a })),
      state,
      general: true,
    }),
    signal,
  });
  const j = await r.json().catch(() => ({}));
  if (r.status === 401) throw new Error("Your sign-in has run out. Sign in again in Identity.");
  if (!r.ok) throw new Error(j.error || `The door answered ${r.status}.`);
  if (j.empty) return String(j.answer || "");
  return askClaude({ system: String(j.system), prompt: String(j.user), onToken, signal });
}

// ── the panel ───────────────────────────────────────────────────────────────

function Panel({ identity, open, installed: installedIds }: PluginContext) {
  // Only what this sign-in can use: the console's list and the collective's grid decide (lib/reach.ts).
  const { visible: installed, pairable } = useReach(
    (installedIds ?? installs(edition)).filter((id) => !!getModule(id)),
    identity.session,
  );
  const steps = useSetup(identity, installed);
  const [convos, setConvos] = useState<Conversation[]>(loadConvos);
  // The conversation on screen, the latest one to start with. Null is a fresh
  // one, made on its first question.
  const [currentId, setCurrentId] = useState<string | null>(() => [...convos].sort((a, b) => b.at - a.at)[0]?.id ?? null);
  const [listOpen, setListOpen] = useState(false);
  const newId = useRef<string>(crypto.randomUUID());
  const thread = useMemo(() => convos.find((c) => c.id === currentId)?.turns ?? [], [convos, currentId]);
  const setThread = (next: Turn[] | ((t: Turn[]) => Turn[])) => {
    setConvos((list) => {
      const id = currentId ?? newId.current;
      const had = list.find((c) => c.id === id);
      const turns = typeof next === "function" ? next(had?.turns ?? []) : next;
      const rest = list.filter((c) => c.id !== id);
      return turns.length ? [{ id, at: Date.now(), turns }, ...rest] : rest;
    });
    if (!currentId) setCurrentId(newId.current);
  };
  const startNew = () => {
    newId.current = crypto.randomUUID();
    setCurrentId(null);
    setListOpen(false);
  };
  // Who answers: the collective's own model, or the member's own Claude on this computer.
  const [claude, setClaude] = useState<{ found: boolean; version?: string | null }>({ found: false });
  const [engine, setEngine] = useState<"group" | "claude">(() => (localStorage.getItem(ENGINE_KEY) === "claude" ? "claude" : "group"));
  useEffect(() => {
    void claudeStatus().then(setClaude);
  }, []);
  useEffect(() => {
    localStorage.setItem(ENGINE_KEY, engine);
  }, [engine]);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState<{ q: string; text: string; waited: number } | null>(null);
  const [folded, setFolded] = useState(() => localStorage.getItem(FOLD_KEY) !== "0");
  const abort = useRef<AbortController | null>(null);
  const end = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLTextAreaElement>(null);

  const name = edition.instance.name;
  const signedIn = !!(identity.signedIn && identity.session);
  // A demo edition, before logins: the agent answers from a short script
  // (demo/sample.ts) so a newcomer can see what it is for.
  const scripted = !!edition.demo && !signedIn;
  // Huxley's own story (not a visitor's sketch): the agent opens on a read of everything.
  const story = !!edition.showcase && !shaped;
  const canAsk = signedIn || scripted;
  const ownClaude = engine === "claude" && claude.found && signedIn && !scripted;
  const doneCount = steps.filter((s) => s.done).length;
  const allDone = doneCount === steps.length;
  const next = steps.find((s) => !s.done);

  const loaded = useRef(convos);
  useEffect(() => {
    if (convos !== loaded.current) saveConvos(convos);
  }, [convos]);
  // Follow the conversation as it grows, but open at the top so the setup list shows.
  useEffect(() => {
    if (thread.length || busy) end.current?.scrollIntoView({ block: "end" });
  }, [thread.length, busy?.text]);
  useEffect(() => () => abort.current?.abort(), []);
  useEffect(() => {
    localStorage.setItem(FOLD_KEY, folded ? "1" : "0");
  }, [folded]);

  async function send(raw: string) {
    const q = raw.trim();
    if (!q || busy) return;
    if (scripted) {
      setDraft("");
      const hit = sampleAnswers.find((x) => x.match(q)) ?? sampleFallback;
      setBusy({ q, text: "", waited: 0 });
      setTimeout(() => {
        setBusy(null);
        setThread((t) => [...t, { q, a: hit.a, actions: hit.places, at: Date.now() }]);
      }, 700);
      return;
    }
    if (!identity.session) return;
    if (SECRETISH.test(q)) {
      setDraft("");
      setThread((t) => [
        ...t,
        {
          q: "(not sent)",
          a: "",
          actions: ["settings"],
          error: "That looks like a key, so I didn't send it. Save keys in Settings, where they go into this computer's secure store.",
          at: Date.now(),
        },
      ]);
      return;
    }
    setDraft("");
    setBusy({ q, text: "", waited: 0 });
    const ctl = new AbortController();
    abort.current = ctl;
    let text = "";
    let final: Turn | null = null;
    if (ownClaude) {
      try {
        const answer = await askOwnClaude(
          identity.session,
          q,
          thread,
          report(steps, installed),
          (t) => {
            text += t;
            setBusy((b) => (b ? { ...b, text } : b));
          },
          ctl.signal,
        );
        final = { q, ...takeActions(answer), at: Date.now(), by: "claude" };
      } catch (e) {
        if ((e as Error).name === "AbortError") return;
        final = { q, a: "", error: (e as Error).message || "Your Claude could not answer just now.", at: Date.now(), by: "claude" };
      } finally {
        abort.current = null;
        setBusy(null);
      }
      setThread((t) => [...t, final!]);
      setTimeout(() => input.current?.focus(), 0);
      return;
    }
    try {
      await ask(
        identity.session,
        q,
        thread,
        report(steps, installed),
        (e) => {
          if (e.type === "waiting") setBusy((b) => (b ? { ...b, waited: e.waitedMs } : b));
          if (e.type === "token") {
            text += e.t;
            setBusy((b) => (b ? { ...b, text } : b));
          }
          if (e.type === "done") final = { q, a: e.answer, actions: e.actions ?? [], at: Date.now() };
          if (e.type === "error") final = { q, a: "", error: "The agent could not answer just now. Try again in a minute.", at: Date.now() };
        },
        ctl.signal,
      );
      if (!final) final = text ? { q, a: visible(text), at: Date.now() } : { q, a: "", error: "The answer was cut off. Try again.", at: Date.now() };
    } catch (e) {
      if ((e as Error).name === "AbortError") return;
      final = { q, a: "", error: (e as Error).message || "Could not reach the door.", at: Date.now() };
    } finally {
      abort.current = null;
      setBusy(null);
    }
    if (final) setThread((t) => [...t, final!]);
    setTimeout(() => input.current?.focus(), 0);
  }

  const suggestions = useMemo(() => {
    const out: string[] = [];
    if (next) out.push(doneCount === 0 ? "I'm new here. Where do I start?" : `What's next after ${steps[0].done ? "signing in" : "this"}?`);
    out.push(`What can the ${edition.productName} app do?`);
    for (const s of steps) if (!s.done && out.length < 4) out.push(s.ask);
    // In a demo, the questions its script was written for come first.
    if (scripted) out.splice(1, 0, ...sampleAnswers.flatMap((x) => (x.ask ? [x.ask] : [])).slice(0, 3));
    if (out.length < 4) out.push(`What is ${name}?`);
    return [...new Set(out)].slice(0, scripted ? 5 : 4);
  }, [steps, next, doneCount, name, scripted]);

  return (
    <Page>
      <PageHeader
        icon={Sparkles}
        eyebrow={edition.productName.toLowerCase()}
        title={`Talk to ${name}`}
        lede={
          story
            ? `The read on everything in ${name}, and help with the rest.`
            : `Ask how anything works. ${name} helps you get set up and get work done.`
        }
        actions={
          !busy && (convos.length > 0 || thread.length > 0) ? (
            <div className="flex flex-wrap gap-2">
              {convos.length > 0 && (
                <Button icon={History} onClick={() => setListOpen((o) => !o)} aria-expanded={listOpen} title="Your past conversations">
                  Conversations
                </Button>
              )}
              {thread.length > 0 && (
                <Button icon={RotateCcw} onClick={startNew} title="Start a new conversation">
                  New conversation
                </Button>
              )}
            </div>
          ) : undefined
        }
      />

      <div className="min-h-0 flex-1 space-y-6 overflow-y-auto px-5 py-6 md:px-8">
        {listOpen && (
          <Section label="Your conversations">
            <ul className="max-w-4xl overflow-hidden rounded-[var(--radius)] border border-[var(--line)] bg-[var(--card)]">
              {[...convos].sort((a, b) => b.at - a.at).map((c) => (
                <li key={c.id} className="flex items-center gap-3 border-t border-[var(--line)] first:border-t-0">
                  <button
                    onClick={() => {
                      setCurrentId(c.id);
                      setListOpen(false);
                    }}
                    aria-current={c.id === currentId}
                    className="flex min-w-0 flex-1 items-baseline gap-3 px-5 py-3 text-left hover:bg-[var(--raise)]"
                  >
                    <span className={`min-w-0 flex-1 truncate text-sm ${c.id === currentId ? "font-medium" : ""}`}>{titleOf(c)}</span>
                    <span className="shrink-0 font-mono text-[11px] text-[var(--faint)]">
                      {whenOf(c.at)}
                    </span>
                  </button>
                  <button
                    onClick={() => {
                      setConvos((list) => list.filter((x) => x.id !== c.id));
                      if (c.id === currentId) startNew();
                    }}
                    title="Delete this conversation"
                    aria-label={`Delete "${titleOf(c)}"`}
                    className="mr-3 rounded p-1.5 text-[var(--faint)] hover:bg-[var(--raise)] hover:text-[var(--fg)]"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </li>
              ))}
            </ul>
            <p className="mt-2 px-1 text-xs text-[var(--faint)]">Kept on this computer only. Deleting one removes it for good.</p>
          </Section>
        )}
        {!edition.demo && thread.length === 0 && !busy && (
          <section className="max-w-4xl space-y-5">
            {!signedIn && (
              <div className="flex flex-wrap items-center justify-between gap-4 rounded-[var(--radius)] border border-[var(--line)] bg-[var(--ink-wash,var(--raise))] p-5">
                <div>
                  <h2 className="font-tight text-lg font-medium">Make yourself at home</h2>
                  <p className="mt-1 text-sm text-[var(--muted)]">Explore below, or sign in to talk to {name}.</p>
                </div>
                <PlaceButton place="identity" open={open} label="Sign in" />
              </div>
            )}
            <Section label="Your workspace">
              <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
                {pluginCatalog.filter((mod) => mod.id !== "agent" && installed.includes(mod.id)).map((mod) => {
                  const id = mod.id;
                  const Icon = mod.icon;
                  return (
                    <button key={id} onClick={() => open(id)} className="prism-hover group flex items-start gap-3 rounded-[var(--radius)] border border-[var(--line)] bg-[var(--card)] p-4 text-left hover:border-[var(--line-strong)] hover:bg-[var(--raise)]">
                      <Icon className="mt-0.5 h-5 w-5 shrink-0 text-[var(--muted)]" />
                      <span className="min-w-0 flex-1">
                        <span className="font-tight block text-sm font-medium">{mod.title}{mod.lab ? " (lab)" : ""}</span>
                        <span className="mt-1 block text-xs leading-relaxed text-[var(--muted)]">{mod.tagline}</span>
                      </span>
                      <ArrowUpRight className="h-3.5 w-3.5 shrink-0 text-[var(--muted)]" />
                    </button>
                  );
                })}
              </div>
              {pairable && (
                <p className="mt-3 px-1 text-xs text-[var(--faint)]">
                  Look after {name}'s books?{" "}
                  <button onClick={() => void signInToOps()} className="underline underline-offset-2 hover:text-[var(--fg)]">
                    Sign in to the company console
                  </button>
                </p>
              )}
            </Section>
          </section>
        )}
        {/* every showcase demo: how you'll use it, from a screen per thing to the read to a conversation */}
        {edition.showcase && (
          <Horizon
            installed={installed}
            open={open}
            start={story ? "next" : "today"}
            say={(q, a, places) => setThread((t) => [...t, { q, a, actions: places, at: Date.now() }])}
          />
        )}

        {/* setup: worked out from the app itself, so it holds when the model is slow */}
        {!story && <section className="mb-6 overflow-hidden rounded-[var(--radius)] border border-[var(--line)] bg-[var(--card)]">
          <button
            onClick={() => setFolded((f) => !f)}
            aria-expanded={!folded}
            aria-controls="agent-setup"
            className="flex w-full items-center gap-3 px-5 py-3.5 text-left"
          >
            <span className="font-tight text-sm font-medium">{allDone ? "You're set up" : "Set up what you need"}</span>
            <span className="font-mono text-[11px] text-[var(--faint)]">
              {doneCount} of {steps.length}
            </span>
            <span className="ml-auto h-[3px] w-24 overflow-hidden bg-[var(--line)]">
              <span className="block h-full" style={{ width: `${(doneCount / steps.length) * 100}%`, background: "var(--fg)" }} />
            </span>
            <ChevronDown className={`h-4 w-4 text-[var(--faint)] transition ${folded ? "-rotate-90" : ""}`} />
          </button>
          {!folded && (
            <ol id="agent-setup" className="border-t border-[var(--line)]">
              {steps.map((s) => (
                <li key={s.id} className="flex items-center gap-3 border-t border-[var(--line)] px-5 py-3 first:border-t-0">
                  <span
                    className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-full border ${
                      s.done ? "border-[var(--ok)] text-[var(--ok)]" : "border-[var(--line-strong)] text-transparent"
                    }`}
                  >
                    <Check className="h-3 w-3" />
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className={`font-tight text-sm ${s.done ? "text-[var(--muted)]" : "font-medium text-[var(--fg)]"}`}>{s.title}</div>
                    {!s.done && <div className="text-[13px] text-[var(--muted)]">{s.hint}</div>}
                  </div>
                  {!s.done && (
                    <>
                      {canAsk && (
                        <Button variant="quiet" onClick={() => void send(s.ask)} disabled={!!busy}>
                          Ask
                        </Button>
                      )}
                      <PlaceButton place={s.place} open={open} />
                    </>
                  )}
                </li>
              ))}
            </ol>
          )}
        </section>}

        {/* the conversation */}
        {thread.length === 0 && !busy && (
          <div className="font-serif max-w-prose text-[15px] leading-relaxed text-[var(--muted)]">
            {story
              ? `Or ask me anything. In this demo I answer from a script.`
              : scripted
              ? `I'm ${name}. In this demo I answer from a script. Try one of these.`
              : signedIn
              ? `Hello${identity.handle ? ` ${identity.handle}` : ""}. I'm ${name}. Ask me anything, or start with one of these.`
              : `Sign in when you're ready to ask ${name} a question.`}
          </div>
        )}

        <div className="flex flex-col gap-5">
          {thread.map((t, i) => (
            <Exchange key={t.at + "-" + i} q={t.q}>
              {t.error ? (
                <>
                  <Notice tone="danger">{t.error}</Notice>
                  {!!t.actions?.length && (
                    <div className="mt-3 flex flex-wrap gap-2">
                      {t.actions.map((a) => (
                        <PlaceButton key={a} place={a} open={open} />
                      ))}
                    </div>
                  )}
                </>
              ) : (
                <>
                  <Answer text={t.a} actions={t.actions} open={open} />
                  {t.by === "claude" && <p className="mt-2 text-[11px] text-[var(--faint)]">Answered by your Claude</p>}
                </>
              )}
            </Exchange>
          ))}
          {busy && (
            <Exchange q={busy.q}>
              {busy.text ? (
                <Answer text={visible(busy.text)} open={open} />
              ) : (
                <Waiting>
                  {ownClaude
                    ? `Your Claude is thinking…`
                    : busy.waited > 40_000
                    ? `${name} is waking up. This can take a minute or two.`
                    : `${name} is reading its documents…`}
                </Waiting>
              )}
            </Exchange>
          )}
        </div>

        {thread.length === 0 && !busy && canAsk && (
          <div className="mt-4 flex flex-wrap gap-2">
            {suggestions.map((s) => (
              <Button key={s} onClick={() => void send(s)}>
                {s}
              </Button>
            ))}
          </div>
        )}
        <div ref={end} />
      </div>

      {/* The hint sits above the input and the foot leaves room for the host's
          floating Suggest button at the bottom right. */}
      {canAsk && <div className="shrink-0 border-t border-[var(--line)] px-5 pt-3 pb-14 md:px-8">
        <div className="mb-2 flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
          <p className="text-[11px] text-[var(--faint)]">
            {story
              ? `Anything that sends, signs or spends waits for your passkey. In this demo nothing leaves.`
              : ownClaude
              ? `Your Claude on this computer, on your own Claude plan. Ask it anything. It knows ${name}'s documents and can't open files or change anything.`
              : `${name} can't change your settings, see your keys or move money.`}
          </p>
          {claude.found && signedIn && !scripted && (
            <div role="radiogroup" aria-label="Who answers" className="flex shrink-0 items-center gap-1 text-[11px]">
              <span className="mr-1 text-[var(--faint)]">Answer with</span>
              {(["group", "claude"] as const).map((e) => (
                <button
                  key={e}
                  role="radio"
                  aria-checked={engine === e}
                  disabled={!!busy}
                  onClick={() => setEngine(e)}
                  title={e === "claude" ? `Claude Code on this computer${claude.version ? ` (${claude.version})` : ""}` : `${name}'s own model`}
                  className={`rounded-full border px-2.5 py-0.5 ${
                    engine === e ? "border-[var(--line-strong)] text-[var(--fg)]" : "border-transparent text-[var(--faint)] hover:text-[var(--fg)]"
                  }`}
                >
                  {e === "claude" ? "Your Claude" : name}
                </button>
              ))}
            </div>
          )}
        </div>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void send(draft);
          }}
          className="prism-hover flex items-end gap-3 rounded-[var(--radius)] border border-[var(--line-strong)] bg-[var(--card)] px-4 py-3"
          data-active={!!busy}
        >
          <textarea
            ref={input}
            value={draft}
            rows={1}
            maxLength={800}
            disabled={!canAsk}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                void send(draft);
              }
            }}
            placeholder={canAsk ? `Ask ${name}…` : "Sign in with your passkey to talk"}
            className="max-h-40 min-h-[1.5rem] flex-1 resize-none bg-transparent text-[15px] outline-none placeholder:text-[var(--faint)] disabled:opacity-60"
          />
          {busy ? (
            <Button type="button" variant="quiet" onClick={() => abort.current?.abort()}>
              Stop
            </Button>
          ) : canAsk ? (
            <Button type="submit" variant="primary" icon={CornerDownLeft} disabled={!draft.trim()}>Ask</Button>
          ) : (
            <PlaceButton place="identity" open={open} label="Sign in" />
          )}
        </form>
      </div>}
    </Page>
  );
}

function Exchange({ q, children }: { q: string; children: ReactNode }) {
  return (
    <div>
      <div className="mb-2 ml-auto w-fit max-w-[85%] rounded-[var(--radius)] bg-[var(--raise)] px-3 py-2 text-sm">{q}</div>
      <div className="max-w-prose">{children}</div>
    </div>
  );
}

function Answer({ text, actions, open }: { text: string; actions?: string[]; open: (id: string) => void }) {
  return (
    <>
      <p className="font-serif whitespace-pre-wrap text-[15px] leading-relaxed">{text}</p>
      {!!actions?.length && (
        <div className="mt-3 flex flex-wrap gap-2">
          {actions.map((a) => (
            <PlaceButton key={a} place={a} open={open} />
          ))}
        </div>
      )}
    </>
  );
}

/** A button into another part of the app, shown only if this edition has it. */
function PlaceButton({ place, open, label }: { place: string; open: (id: string) => void; label?: string }) {
  const mod = getModule(place);
  if (!mod) return null;
  return (
    <Button type="button" variant="secondary" trailing={ArrowUpRight} onClick={() => open(place)}>
      {label ?? `Open ${mod.title}`}
    </Button>
  );
}

export const agentPlugin: MurmurPlugin = {
  id: "agent",
  title: edition.productName,
  tagline: `Talk to ${edition.instance.name}: get set up and get work done`,
  icon: Sparkles,
  order: 1,
  kind: "plugin",
  support: issues("agent"),
  backend: `${edition.instance.name}'s own agent`,
  Panel,
};
