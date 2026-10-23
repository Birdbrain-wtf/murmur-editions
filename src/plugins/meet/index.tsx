import { colourful, onInk } from "../../demo/ink";
import { useEffect, useState } from "react";
import { Video, ArrowRight, CalendarPlus, Radio, Sparkles, MapPin, PhoneOff } from "lucide-react";
import type { MurmurModule, PluginContext } from "../../host/types";
import { issues } from "../../host/support";
import { edition } from "../../edition";
import { demoNote } from "../../demo/note";
import { CallRoom, SCRIPTS } from "../../demo/callroom";
import { ChaosRecord } from "./record";
import { Button, Card, Code, Eyebrow, Field, Notice, Page, PageBody, PageHeader, Status, inputClass } from "../../ui";
import {
  checkInAtPlace,
  participate,
  PLACE_STEP,
  publishAnchor,
  stewardPlaces,
  supported as checkInsSupported,
  today,
  useParticipation,
} from "../../identity/participation";

/**
 * "meet" plugin — **Chaos Sessions**, the default way members take part.
 *
 * The id stays the generic primitive ("meet") so any instance can fork it; the
 * *title* is each culture's own brand of the call. Decent's instance is the
 * Chaos Sessions — the weekly Monday 15:00 UK ritual that is the highest-
 * bandwidth channel by which the world tells Decent what's true. Each call is
 * recorded + transcribed into Birdbrain's memory (concepts, Seeds, the digest).
 *
 * This panel surfaces the *ritual*, not a generic room launcher: the next
 * session, a live/countdown state, and the one button that actually works —
 * the JWT-gated room (cs.birdbrain.wtf/chaos-sessions, the same room the
 * auto-recorder joins). A signed-in app trades its session for a room ticket at
 * `<signIn.pair>/call` and the call opens right here, in the app's own window.
 * Without a session, or before the member has accepted the live agreement, the
 * button falls back to the hosted passkey door (`/chaos/join`) in the browser,
 * which proves attendance and takes consent. The sovereign target stays
 * self-hosted Jitsi under decent.partners.
 */

interface ChaosSession {
  id: string;
  date: string | null;
  title: string | null;
  status: string;
}

interface ChaosInfo {
  cadence: string;
  session: ChaosSession | null;
}

// London wall-clock 15:00 → the exact UTC instant, DST-safe (no tz library).
function londonInstant(dateStr: string, hour = 15, minute = 0): Date {
  const [y, m, d] = dateStr.split("-").map(Number);
  const wallAsUTC = Date.UTC(y, m - 1, d, hour, minute, 0);
  // Offset between Europe/London and UTC at that instant.
  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone: "Europe/London",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });
  const p = fmt
    .formatToParts(new Date(wallAsUTC))
    .reduce<Record<string, string>>((a, x) => ((a[x.type] = x.value), a), {});
  const seenAsUTC = Date.UTC(
    Number(p.year),
    Number(p.month) - 1,
    Number(p.day),
    Number(p.hour === "24" ? "0" : p.hour),
    Number(p.minute),
    Number(p.second),
  );
  const offset = seenAsUTC - wallAsUTC;
  return new Date(wallAsUTC - offset);
}

const CALL_WINDOW_MS = 90 * 60 * 1000;

function useChaos(base: string): ChaosInfo | null {
  const [info, setInfo] = useState<ChaosInfo | null>(null);
  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const res = await fetch(`${base}/api/chaOS`, {
          headers: { Accept: "application/json" },
        });
        if (!res.ok) throw new Error(`chaOS ${res.status}`);
        const j = (await res.json()) as {
          cadence?: string;
          sessions?: ChaosSession[];
        };
        const session =
          j.sessions?.find((s) => s.status === "scheduled") ?? null;
        if (alive)
          setInfo({ cadence: j.cadence ?? "Mondays 15:00 UK", session });
      } catch {
        if (alive)
          setInfo({ cadence: "Mondays 15:00 UK", session: null });
      }
    })();
    return () => {
      alive = false;
    };
  }, [base]);
  return info;
}

function useNow(intervalMs = 30_000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(t);
  }, [intervalMs]);
  return now;
}

function countdown(ms: number): string {
  const mins = Math.floor(ms / 60000);
  const days = Math.floor(mins / 1440);
  const hours = Math.floor((mins % 1440) / 60);
  const m = mins % 60;
  if (days > 0) return `in ${days}d ${hours}h`;
  if (hours > 0) return `in ${hours}h ${m}m`;
  if (mins > 0) return `in ${m} min`;
  return "any moment now";
}

/**
 * In the room together: a place check-in (ADR 0070). A member types the code on
 * the venue's screen. A steward of the venue can put that screen up from here:
 * the code is signed with their own check-in key and changes every minute.
 * Nothing reads this computer's location.
 */
function PlaceCard() {
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<{ ok: boolean; text: string } | null>(null);
  const [places, setPlaces] = useState<{ cell: string; name: string }[]>([]);
  const [hosting, setHosting] = useState<{ cell: string; name: string } | null>(null);
  const [shown, setShown] = useState<{ code: string } | { error: string } | null>(null);

  useEffect(() => {
    void stewardPlaces().then(setPlaces);
  }, []);

  // Re-sign as each minute turns, so the screen never shows a stale code.
  useEffect(() => {
    if (!hosting) return;
    let last = -1;
    let stop = false;
    const tick = async () => {
      const w = Math.floor(Date.now() / 1000 / PLACE_STEP);
      if (w === last || stop) return;
      last = w;
      const r = await publishAnchor(hosting.cell);
      if (!stop) setShown(r);
    };
    void tick();
    const t = setInterval(() => void tick(), 2000);
    return () => {
      stop = true;
      clearInterval(t);
    };
  }, [hosting]);

  async function submit() {
    if (code.trim().length < 6 || busy) return;
    setBusy(true);
    setNote(null);
    const r = await checkInAtPlace(code.trim());
    setBusy(false);
    if (r.status === "recorded" || r.status === "already") {
      setNote({ ok: true, text: `You're checked in at ${r.name ?? "this place"} for today.` });
      setCode("");
    } else if (r.status === "needs-approval") setNote({ ok: false, text: "Check-ins are off. Turn them on in Profile." });
    else if (r.status === "failed") setNote({ ok: false, text: r.error });
  }

  return (
    <Card>
      <div className="font-tight flex items-center gap-2 text-sm font-medium">
        <MapPin className="h-4 w-4 text-[var(--muted)]" /> In the room together
      </div>
      <p className="mt-1.5 text-[13px] leading-relaxed text-[var(--muted)]">
        At a venue? Type the code on its screen. Only the venue's area is
        recorded, never where you are.
      </p>
      <div className="mt-4">
        <Field label="Venue code" hint="Six letters and numbers.">
          <span className="flex gap-2">
            <input
              value={code}
              onChange={(e) => setCode(e.target.value.toUpperCase().slice(0, 6))}
              onKeyDown={(e) => e.key === "Enter" && void submit()}
              placeholder="CODE"
              spellCheck={false}
              className={`${inputClass} font-mono !w-36 tracking-[0.3em]`}
            />
            <Button
              size="md"
              onClick={(e) => {
                e.preventDefault();
                void submit();
              }}
              disabled={code.trim().length < 6}
              busy={busy}
            >
              {busy ? "Checking…" : "Check in"}
            </Button>
          </span>
        </Field>
      </div>
      {note && (
        <div className="mt-3">
          <Notice tone={note.ok ? "ok" : "idle"}>{note.text}</Notice>
        </div>
      )}

      {places.length > 0 && (
        <div className="mt-5 border-t border-[var(--line)] pt-4">
          {hosting ? (
            <div className="space-y-3">
              <Eyebrow>{hosting.name} · showing now</Eyebrow>
              <Code>{shown && "code" in shown ? shown.code : "······"}</Code>
              {shown && "error" in shown && <Notice tone="danger">{shown.error}</Notice>}
              <Button
                variant="quiet"
                onClick={() => {
                  setHosting(null);
                  setShown(null);
                }}
              >
                Stop showing the code
              </Button>
            </div>
          ) : (
            <div className="flex flex-wrap gap-2">
              {places.map((p) => (
                <Button key={p.cell} onClick={() => setHosting(p)}>
                  Show the code for {p.name}
                </Button>
              ))}
            </div>
          )}
        </div>
      )}
    </Card>
  );
}

/**
 * In a demo edition with a call of its own (`edition.call`), Meet shows that
 * call as a sample: when it next happens, what the last one left in the record,
 * and buttons that say what they would do. Nothing is fetched or joined.
 */
function DemoCall() {
  const call = edition.call!;
  const now = useNow();
  const next = (() => {
    const d = new Date(now);
    for (let i = 0; i < 8; i++) {
      const day = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + i));
      if (day.getUTCDay() !== call.weekday) continue;
      const at = londonInstant(day.toISOString().slice(0, 10), call.hour);
      if (at.getTime() + CALL_WINDOW_MS > now) return at;
    }
    return null;
  })();
  const live = !!next && now >= next.getTime();
  const label = next
    ? next.toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long", timeZone: "Europe/London" })
    : "being scheduled";
  // Joining opens the call right here, in the same window.
  const [inCall, setInCall] = useState(false);
  if (inCall)
    return (
      <Page>
        <CallRoom
          spec={{ title: call.name, kind: "video", people: COMING.map(([n]) => n).filter((n) => n !== "Alice").slice(0, 5), script: SCRIPTS.meet }}
          onLeave={() => setInCall(false)}
        />
      </Page>
    );
  return (
    <Page>
      <PageHeader
        icon={Video}
        eyebrow="calls · sample"
        title={call.name}
        lede={
          <>
            {edition.instance.name}'s regular call, <span className="text-[var(--fg)]">{call.cadence}</span>. {call.line}
          </>
        }
      />
      <PageBody>
        <Card>
          <div className="flex items-start justify-between gap-4">
            <div className="flex items-start gap-4">
              {next && (
                <div className="hidden w-16 shrink-0 overflow-hidden rounded-[10px] border border-[var(--ink)] text-center [.inked_&]:block">
                  <div className="font-mono bg-[var(--ink)] py-1 text-[10px] uppercase tracking-[0.14em] text-[var(--ink-on)]">
                    {next.toLocaleDateString("en-GB", { weekday: "short" })}
                  </div>
                  <div className="font-tight py-1.5 text-[26px] font-medium leading-none">{next.getDate()}</div>
                </div>
              )}
              <div>
                <Eyebrow>next call</Eyebrow>
                <div className="font-tight mt-1.5 text-lg font-medium">{label}</div>
                <div className="mt-0.5 text-[13px] text-[var(--muted)]">{call.cadence}</div>
              </div>
            </div>
            <Status tone={live ? "live" : "idle"} pulse={live}>
              {live ? "Live now" : next ? countdown(next.getTime() - now) : "Being scheduled"}
            </Status>
          </div>
          <div className="mt-5 flex flex-wrap items-center gap-2">
            <Button
              variant="primary"
              icon={live ? Radio : Video}
              onClick={() => setInCall(true)}
            >
              {live ? "Join the live call" : `Join ${call.name}`}
            </Button>
            <Button icon={CalendarPlus} onClick={() => demoNote("In your own app this adds every call to your calendar.")}>
              Add to calendar
            </Button>
          </div>
          {colourful && (
            <div className="mt-5 flex items-center gap-3">
              <div className="flex -space-x-1.5">
                {COMING.map(([n, c]) => (
                  <span
                    key={n}
                    title={n}
                    className="font-tight flex h-7 w-7 items-center justify-center rounded-full text-[11px] font-medium ring-2 ring-[var(--card)]"
                    style={{ background: c, color: onInk(c) }}
                  >
                    {n[0]}
                  </span>
                ))}
              </div>
              <span className="text-[13px] text-[var(--muted)]">{COMING.length} coming</span>
            </div>
          )}
          <p className="mt-4 text-[13px] leading-relaxed text-[var(--muted)]">
            One tap to join. The call opens right here.
          </p>
        </Card>

        <Card tone="dashed">
          <div className="font-tight flex items-center gap-2 text-sm font-medium">
            <Sparkles className="h-4 w-4 text-[var(--ink,var(--muted))]" /> Last week, in the record
          </div>
          <ul className="mt-3 space-y-2 text-[13px] leading-relaxed text-[var(--muted)]">
            {LAST_WEEK.map(([who, c, line]) => (
              <li key={line} className="flex items-start gap-2.5">
                <span
                  className="font-tight mt-px flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[10px] font-medium"
                  style={colourful ? { background: c, color: onInk(c) } : { border: "1px solid var(--line-strong)" }}
                >
                  {who}
                </span>
                <span>{line}</span>
              </li>
            ))}
          </ul>
          <p className="mt-3 text-[12px] text-[var(--faint)]">
            A sample. Each call is kept for the people who were there. Nobody else can open it, unless the
            group lets the agent learn from it with names and details taken out.
          </p>
        </Card>
      </PageBody>
    </Page>
  );
}

// Who's coming on Thursday, and what last week left in the record (sample).
const COMING: [string, string][] = [
  ["Alice", "#e5383b"], ["Bob", "#0078bf"], ["Carol", "#ff48b0"], ["Dave", "#1f9d6b"], ["Erin", "#7b4fc4"],
  ["Frank", "#ffd400"], ["Grace", "#00a19a"], ["Heidi", "#ff7a3d"], ["Ivan", "#1a1a1a"],
];
const LAST_WEEK: [string, string, string][] = [
  ["C", "#ff48b0", "Carol played two new demos. The room preferred the slower one."],
  ["B", "#0078bf", "Bob showed the first spread of the next issue of the magazine."],
  ["✓", "#1f9d6b", "Agreed: the open studio day goes to a vote in Chat by Friday."],
];

interface CallTicket {
  token: string;
  domain: string;
  room: string;
}

async function openOutside(url: string) {
  try {
    const { openUrl } = await import("@tauri-apps/plugin-opener");
    await openUrl(url);
  } catch {
    window.open(url, "_blank");
  }
}

// The room, inside the app, set up the way the website's call page sets it up
// (core/doors/instances/chaos-live.tsx): straight in, camera and microphone off
// until the member turns them on.
function CallView({ ticket, title, leave }: { ticket: CallTicket; title: string; leave: () => void }) {
  const src =
    `https://${ticket.domain}/${encodeURIComponent(ticket.room)}?jwt=${encodeURIComponent(ticket.token)}` +
    "#config.disableDeepLinking=true&config.prejoinPageEnabled=false&config.prejoinConfig.enabled=false" +
    "&config.startWithAudioMuted=true&config.startWithVideoMuted=true&interfaceConfig.MOBILE_APP_PROMO=false";
  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex items-center justify-between gap-3 border-b border-[var(--line)] px-5 py-3">
        <div className="font-tight flex items-center gap-2 text-sm font-medium">
          <Radio className="h-4 w-4" /> {title}
        </div>
        <Button variant="secondary" icon={PhoneOff} onClick={leave}>
          Leave the call
        </Button>
      </div>
      <iframe
        title={title}
        src={src}
        allow="camera; microphone; display-capture; autoplay; clipboard-write; fullscreen"
        allowFullScreen
        className="min-h-0 w-full flex-1 border-0 bg-black"
      />
    </div>
  );
}

function Panel(ctx: PluginContext) {
  if (edition.demo && edition.call && !ctx.identity.signedIn) return <DemoCall />;
  return <ChaosPanel {...ctx} />;
}

function ChaosPanel({ instance, identity, open }: PluginContext) {
  const info = useChaos(instance.birdbrainBase);
  const { grant } = useParticipation();
  const now = useNow();
  const [record, setRecord] = useState(false);
  const [ticket, setTicket] = useState<CallTicket | null>(null);
  const [joining, setJoining] = useState(false);
  const [joinNote, setJoinNote] = useState<string | null>(null);

  // External, hosted surfaces. These are real pages the user opens in a
  // browser, so they must resolve to a live origin even in dev (where
  // birdbrainBase is "" for the proxy) — fall back to Birdbrain's.
  const origin = instance.birdbrainBase || "https://birdbrain.wtf";
  const joinUrl = `${origin}/chaos/join`;
  const icsUrl = `${origin}/chaOS.ics`;

  const session = info?.session ?? null;
  const start = session?.date ? londonInstant(session.date) : null;
  const live =
    start !== null &&
    now >= start.getTime() &&
    now <= start.getTime() + CALL_WINDOW_MS;
  const upcoming = start !== null && now < start.getTime();

  const dateLabel = start
    ? start.toLocaleDateString("en-GB", {
        weekday: "long",
        day: "numeric",
        month: "long",
        timeZone: "Europe/London",
      })
    : "scheduling…";

  let state: { tone: "live" | "idle"; label: string };
  if (live) state = { tone: "live", label: "Live now" };
  else if (upcoming) state = { tone: "idle", label: countdown(start!.getTime() - now) };
  else state = { tone: "idle", label: "Being scheduled" };

  const cadence = info?.cadence ?? "Mondays 15:00 UK";

  // The call's own door records attendance too. This is the app's signed
  // check-in, the same one every plugin makes (ADR 0069).
  async function join() {
    void participate("meet", `meet:chaos-sessions@${today()}`);
    setJoinNote(null);
    if (!identity.session) return void openOutside(joinUrl);
    setJoining(true);
    try {
      const r = await fetch(`${edition.signIn.pair}/call`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify({ session: identity.session }),
      });
      const j = await r.json().catch(() => ({}));
      if (r.ok && j.jitsi?.token) return setTicket(j.jitsi as CallTicket);
      setJoinNote(
        j.needsConsent
          ? "Read and accept the agreement at the door first. It opens in your browser, and next time the call opens here."
          : "The call could not open here just now, so it opened in your browser.",
      );
    } catch {
      setJoinNote("The call could not open here just now, so it opened in your browser.");
    } finally {
      setJoining(false);
    }
    void openOutside(joinUrl);
  }

  if (ticket) return <CallView ticket={ticket} title={session?.id ? `${session.id} · Chaos Sessions` : "Chaos Sessions"} leave={() => setTicket(null)} />;

  if (record)
    return (
      <Page>
        <PageHeader icon={Video} eyebrow="chaos sessions" title="The record" lede="What every call left behind, in the words of the people who were there." />
        <PageBody width="wide">
          <ChaosRecord base={instance.birdbrainBase} origin={origin} back={() => setRecord(false)} />
        </PageBody>
      </Page>
    );

  return (
    <Page>
      <PageHeader
        icon={Video}
        eyebrow="chaos sessions"
        title="Chaos Sessions"
        lede={
          <>
            A weekly open call, <span className="text-[var(--fg)]">{cadence}</span>, recorded
            and transcribed.
          </>
        }
      />

      <PageBody>
        {/* Next session */}
        <Card>
          <div className="flex items-start justify-between gap-4">
            <div>
              <Eyebrow>{session?.id ? `${session.id} · next` : "next session"}</Eyebrow>
              <div className="font-tight mt-1.5 text-lg font-medium">{dateLabel}</div>
              <div className="mt-0.5 text-[13px] text-[var(--muted)]">{cadence}</div>
            </div>
            <Status tone={state.tone} pulse={live}>
              {state.label}
            </Status>
          </div>

          <div className="mt-5 flex flex-wrap items-center gap-2">
            <Button
              variant="primary"
              icon={live ? Radio : Video}
              busy={joining}
              onClick={() => void join()}
              data-active={live ? "true" : undefined}
            >
              {live ? "Join the live call" : "Join the Chaos Sessions"}
            </Button>
            <a href={icsUrl} className={`${LINK} border-[var(--line-strong)]`}>
              <CalendarPlus className="h-3.5 w-3.5" /> Add to calendar
            </a>
          </div>
          <p className="mt-4 text-[13px] leading-relaxed text-[var(--muted)]">
            {identity.session ? "The call opens right here. " : ""}Your passkey shows you were there. No password.{" "}
            {identity.handle
              ? `You'll join as ${identity.handle}.`
              : "Join under a handle, or none."}
          </p>
          {joinNote && <p className="mt-2 text-[13px] leading-relaxed text-[var(--muted)]">{joinNote}</p>}
          {checkInsSupported && identity.signedIn && !grant && (
            <div className="mt-2">
              <Button variant="quiet" className="!px-0" onClick={() => open("identity")}>
                Check-ins are off. Turn them on in Profile.
              </Button>
            </div>
          )}
        </Card>

        {checkInsSupported && grant && <PlaceCard />}

        {/* What taking part means */}
        <Card tone="dashed">
          <div className="font-tight flex items-center gap-2 text-sm font-medium">
            <Sparkles className="h-4 w-4 text-[var(--muted)]" /> Showing up is contributing
          </div>
          <p className="mt-1.5 text-[13px] leading-relaxed text-[var(--muted)]">
            Ideas and decisions from each session stay findable in the shared record.
          </p>
          <button onClick={() => setRecord(true)} className={`${LINK} mt-4 border-[var(--line-strong)]`}>
            Explore the record <ArrowRight className="h-3.5 w-3.5" />
          </button>
        </Card>

        <p className="text-[12px] leading-relaxed text-[var(--faint)]">We host the calls.</p>
      </PageBody>
    </Page>
  );
}

/** Links that leave the app wear the kit's button shape (white, a border,
 *  colour on hover). They stay anchors so the browser opens them. */
const LINK =
  "prism-hover inline-flex shrink-0 items-center justify-center gap-1.5 rounded-[var(--radius)] border bg-[var(--card)] px-4 py-2.5 text-sm text-[var(--fg)] transition";

export const meetPlugin: MurmurModule = {
  id: "meet",
  title: edition.demo && edition.call ? edition.call.name : "Chaos Sessions",
  tagline: edition.demo && edition.call ? `${edition.instance.name}'s regular call` : "A weekly open call, recorded and transcribed",
  icon: Video,
  order: 15,
  kind: "plugin",
  support: issues("meet"),
  backend: "Video calls we host",
  Panel,
};
