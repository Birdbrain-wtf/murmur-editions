import { useEffect, useState } from "react";
import { Lock, Mic, MicOff, PhoneOff, Sparkles, Users, Video, VideoOff } from "lucide-react";
import { edition } from "../edition";
import { inkOf, onInk } from "./ink";
import { demoNote } from "./note";
import { Button } from "../ui";

/**
 * A call in the demo, in the same window: no link to open, no other app. It
 * rings (or joins), shows the people on it, writes a live transcript, and when
 * you leave it says what was kept and who can open it. The record of a call
 * belongs to the people who were on it; the group can choose to let the agent
 * learn from it with names and details taken out.
 *
 * A design with sample people and a scripted conversation. Nothing is captured.
 */

export const PERSON: Record<string, string> = {
  Alice: "#e5383b", Bob: "#0078bf", Carol: "#ff48b0", Dave: "#1f9d6b", Erin: "#7b4fc4",
  Frank: "#e0a800", Grace: "#00a19a", Heidi: "#ff7a3d", Ivan: "#1a1a1a",
};
export const personInk = (who: string) => PERSON[who] ?? inkOf(who.toLowerCase());

export interface CallSpec {
  title: string;
  kind: "voice" | "video";
  /** everyone on the call except you (Alice) */
  people: string[];
  /** ring them first (a call you start), or join one already running */
  ringing?: boolean;
  script: [string, string][];
}

// What each call sounds like (scripted). Speakers missing from a call are skipped.
export const SCRIPTS: Record<string, [string, string][]> = {
  meet: [
    ["Carol", "I've got two new demos. The second one is slower, tell me if it drags."],
    ["Bob", "The slower one. The chorus lands better when it waits."],
    ["Dave", "Agreed. Could the intro lose eight bars?"],
    ["Alice", "Quick one before Erin: the open day vote goes to Chat on Friday."],
    ["Erin", "I'll bring the zine proofs next week, the cover is nearly there."],
    ["Bob", "Can we note that as an action, so it's in the record?"],
    ["Alice", "Noted. Two actions, one decision."],
  ],
  bob: [
    ["Bob", "Thanks for picking up. It's the laptop for the bursary room."],
    ["Alice", "The £620 one? It needs a second steward."],
    ["Bob", "Dave said he'd approve it tonight."],
    ["Alice", "Good. And snap the receipt for the strings, it's still missing."],
    ["Bob", "Doing it now."],
  ],
  room: [
    ["Bob", "Is everyone here? Let's keep it short."],
    ["Carol", "Two dates for the open day: the 8th or the 15th."],
    ["Dave", "The 15th, the roofers are back on the 8th."],
    ["Alice", "Then the 15th, if nobody minds. I'll put it to a vote."],
    ["Carol", "Fine by me. I'll run the tea."],
  ],
};

function Silhouette({ ink }: { ink: string }) {
  return (
    <svg viewBox="0 0 100 80" className="absolute inset-x-0 bottom-0 mx-auto h-[78%]" aria-hidden>
      <circle cx="50" cy="32" r="17" fill={`color-mix(in srgb, ${ink} 55%, #fff)`} />
      <path d="M14 80c2-20 17-30 36-30s34 10 36 30z" fill={`color-mix(in srgb, ${ink} 70%, #fff)`} />
    </svg>
  );
}

function Tile({ who, kind, speaking, you, muted, camOff }: { who: string; kind: "voice" | "video"; speaking: boolean; you?: boolean; muted?: boolean; camOff?: boolean }) {
  const ink = personInk(who);
  const label = you ? `${who} (you)` : who;
  if (kind === "voice")
    return (
      <div className="flex w-24 flex-col items-center gap-2">
        <span className="relative flex h-16 w-16 items-center justify-center">
          {speaking && <span className="absolute inset-0 animate-ping rounded-full opacity-40" style={{ background: ink }} />}
          <span
            className="font-tight relative flex h-16 w-16 items-center justify-center rounded-full text-xl font-medium"
            style={{ background: ink, color: onInk(ink), boxShadow: speaking ? `0 0 0 4px var(--card), 0 0 0 7px ${ink}` : undefined }}
          >
            {who[0]}
          </span>
        </span>
        <span className="flex items-center gap-1 text-[12px]">
          {muted && <MicOff className="h-3 w-3 text-[var(--muted)]" />}
          {label}
        </span>
      </div>
    );
  return (
    <div
      className="relative aspect-video overflow-hidden rounded-[12px] bg-[#141414] transition-shadow"
      style={{ boxShadow: speaking ? `0 0 0 3px ${ink}` : undefined }}
    >
      {camOff ? (
        <div className="absolute inset-0 flex items-center justify-center">
          <span className="font-tight flex h-14 w-14 items-center justify-center rounded-full text-xl font-medium" style={{ background: ink, color: onInk(ink) }}>
            {who[0]}
          </span>
        </div>
      ) : (
        <div className="absolute inset-0" style={{ background: `linear-gradient(160deg, color-mix(in srgb, ${ink} 45%, #1d1d1d), #151515 75%)` }}>
          <Silhouette ink={ink} />
        </div>
      )}
      <span className="absolute bottom-2 left-2 flex items-center gap-1 rounded-full bg-black/55 px-2 py-0.5 text-[11px] text-white">
        {muted && <MicOff className="h-3 w-3" />}
        {label}
      </span>
    </div>
  );
}

const mmss = (s: number) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;

export function CallRoom({ spec, onLeave }: { spec: CallSpec; onLeave: () => void }) {
  const everyone = ["Alice", ...spec.people];
  const script = spec.script.filter(([who]) => everyone.includes(who));
  const [phase, setPhase] = useState<"ringing" | "live" | "ended">("ringing");
  const [secs, setSecs] = useState(0);
  const [said, setSaid] = useState(0);
  const [muted, setMuted] = useState(false);
  const [camOff, setCamOff] = useState(false);
  const [learn, setLearn] = useState(false);
  const group = edition.instance.name;

  useEffect(() => {
    if (phase !== "ringing") return;
    const t = setTimeout(() => setPhase("live"), spec.ringing ? 1800 : 900);
    return () => clearTimeout(t);
  }, [phase, spec.ringing]);

  useEffect(() => {
    if (phase !== "live") return;
    const t = setInterval(() => setSecs((s) => s + 1), 1000);
    const l = setInterval(() => setSaid((n) => Math.min(script.length, n + 1)), 2600);
    setSaid(1);
    return () => {
      clearInterval(t);
      clearInterval(l);
    };
  }, [phase, script.length]);

  const speaker = said > 0 && said <= script.length ? script[said - 1][0] : null;
  const lines = script.slice(Math.max(0, said - 4), said);

  if (phase === "ended")
    return (
      <div className="flex h-full min-h-0 flex-col overflow-y-auto px-6 py-8 md:px-10">
        <div className="mx-auto w-full max-w-xl">
          <div className="font-mono text-[11px] uppercase tracking-[0.16em] text-[var(--faint)]">call ended · {mmss(secs)}</div>
          <h2 className="font-tight mt-2 text-2xl font-medium">Kept for the people who were there</h2>
          <div className="mt-4 flex flex-wrap gap-1.5">
            {everyone.map((p) => (
              <span key={p} className="font-tight flex h-8 w-8 items-center justify-center rounded-full text-[12px] font-medium" style={{ background: personInk(p), color: onInk(personInk(p)) }} title={p}>
                {p[0]}
              </span>
            ))}
          </div>
          <div className="mt-5 grid gap-3 sm:grid-cols-3">
            {[
              [String(Math.max(said, 1)), "lines transcribed"],
              spec.title === edition.call?.name ? ["3", "1 decision, 2 actions"] : ["1", "thing agreed"],
              [String(everyone.length), "people can open it"],
            ].map(([big, small]) => (
              <div key={small} className="rounded-[var(--radius)] border border-[var(--line)] bg-[var(--card)] px-4 py-3">
                <div className="font-tight text-xl font-medium">{big}</div>
                <div className="text-[12px] text-[var(--muted)]">{small}</div>
              </div>
            ))}
          </div>
          <ul className="mt-5 flex flex-col gap-3 text-[13.5px] leading-relaxed">
            <li className="flex gap-3">
              <Sparkles className="mt-0.5 h-4 w-4 shrink-0 text-[var(--ink,var(--muted))]" />
              <span>Recording and transcript kept for {everyone.length === 2 ? "the two of you" : `the ${everyone.length} of you`}. Ask the agent later what was agreed.</span>
            </li>
            <li className="flex gap-3">
              <Lock className="mt-0.5 h-4 w-4 shrink-0 text-[var(--ink,var(--muted))]" />
              <span>Others see that a call happened, not what was said.</span>
            </li>
            <li className="flex gap-3">
              <Users className="mt-0.5 h-4 w-4 shrink-0 text-[var(--ink,var(--muted))]" />
              <span>
                {learn
                  ? `Everyone agreed, so ${group}'s agent learns from it, with names and details taken out.`
                  : `${group}'s agent doesn't learn from it, unless you all agree later.`}
              </span>
            </li>
          </ul>
          <p className="mt-5 text-[12px] text-[var(--faint)]">A sample call. Nothing was recorded.</p>
          <div className="mt-5">
            <Button variant="primary" onClick={onLeave}>Done</Button>
          </div>
        </div>
      </div>
    );

  return (
    <div className="flex h-full min-h-0 flex-col bg-[var(--raise)]">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-[var(--line)] bg-[var(--card)] px-5 py-3 md:px-8">
        <span className="font-tight text-[15px] font-medium">{spec.title}</span>
        <span className="font-mono text-[12px] text-[var(--muted)]">
          {phase === "ringing" ? (spec.ringing ? `ringing ${spec.people.length === 1 ? spec.people[0] : `${spec.people.length} people`}…` : "joining…") : mmss(secs)}
        </span>
        {phase === "live" && (
          <span className="ml-auto inline-flex items-center gap-1.5 rounded-full bg-[#e5383b] px-2.5 py-0.5 text-[11px] font-medium text-white">
            <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-white" /> recording for the {everyone.length} people here
          </span>
        )}
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-5 py-5 md:px-8">
        {phase === "ringing" ? (
          <div className="flex h-full flex-col items-center justify-center gap-4 py-10">
            <div className="flex -space-x-2">
              {spec.people.slice(0, 5).map((p) => (
                <span key={p} className="font-tight flex h-14 w-14 animate-pulse items-center justify-center rounded-full text-lg font-medium ring-4 ring-[var(--raise)]" style={{ background: personInk(p), color: onInk(personInk(p)) }}>
                  {p[0]}
                </span>
              ))}
            </div>
            <div className="text-[13px] text-[var(--muted)]">{spec.ringing ? "Ringing in the app" : "Joining in the app"}</div>
          </div>
        ) : (
          <div className="mx-auto flex max-w-4xl flex-col gap-5">
            {spec.kind === "video" ? (
              <div className={`grid gap-2.5 ${everyone.length <= 2 ? "grid-cols-1 sm:grid-cols-2" : everyone.length <= 4 ? "grid-cols-2" : "grid-cols-2 md:grid-cols-3"}`}>
                {everyone.map((p, i) => (
                  <Tile key={p} who={p} kind="video" you={i === 0} speaking={speaker === p} muted={i === 0 && muted} camOff={i === 0 && camOff} />
                ))}
              </div>
            ) : (
              <div className="flex flex-wrap justify-center gap-5 py-6">
                {everyone.map((p, i) => (
                  <Tile key={p} who={p} kind="voice" you={i === 0} speaking={speaker === p} muted={i === 0 && muted} />
                ))}
              </div>
            )}

            <div className="rounded-[var(--radius)] border border-[var(--line)] bg-[var(--card)] px-4 py-3">
              <div className="font-mono flex items-center gap-2 text-[11px] uppercase tracking-[0.14em] text-[var(--faint)]">
                <Sparkles className="h-3.5 w-3.5 text-[var(--ink,currentColor)]" /> transcribing live
              </div>
              <ul className="mt-2.5 flex min-h-[7.5rem] flex-col gap-2">
                {lines.map(([who, text]) => (
                  <li key={text} className="flex items-start gap-2.5 text-[13px] leading-snug">
                    <span className="font-tight mt-px flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[10px] font-medium" style={{ background: personInk(who), color: onInk(personInk(who)) }}>
                      {who[0]}
                    </span>
                    <span>
                      <span className="font-medium">{who}</span> <span className="text-[var(--muted)]">{text}</span>
                    </span>
                  </li>
                ))}
              </ul>
            </div>

            <div className="rounded-[var(--radius)] border border-[var(--line)] bg-[var(--card)] px-4 py-3">
              <div className="text-[13px] font-medium">Who can use this call</div>
              <div className="mt-2 grid gap-2 sm:grid-cols-2" role="radiogroup">
                {[
                  { on: false, title: "Only the people here", line: "Nobody else can open it." },
                  { on: true, title: "Let the group learn from it", line: "Names and details taken out. Everyone here must agree." },
                ].map((o) => (
                  <button
                    key={o.title}
                    role="radio"
                    aria-checked={learn === o.on}
                    onClick={() => {
                      setLearn(o.on);
                      if (o.on) demoNote(`Everyone on the call is asked. In your own app it changes only when each agrees with their passkey.`);
                    }}
                    className="rounded-[10px] border border-[var(--line)] px-3 py-2 text-left transition hover:border-[var(--line-strong)] aria-checked:border-[var(--ink,var(--fg))] aria-checked:bg-[var(--ink-wash,transparent)]"
                  >
                    <div className="text-[13px] font-medium">{o.title}</div>
                    <div className="mt-0.5 text-[12px] leading-snug text-[var(--muted)]">{o.line}</div>
                  </button>
                ))}
              </div>
            </div>
          </div>
        )}
      </div>

      {/* pr-36 keeps the controls clear of the host's floating Suggest button */}
      <div className="flex items-center justify-center gap-2 border-t border-[var(--line)] bg-[var(--card)] py-3 pl-4 pr-36 md:justify-start md:pl-8">
        <Button icon={muted ? MicOff : Mic} onClick={() => setMuted((m) => !m)}>
          <span className="hidden sm:inline">{muted ? "Unmute" : "Mute"}</span>
        </Button>
        {spec.kind === "video" && (
          <Button icon={camOff ? VideoOff : Video} onClick={() => setCamOff((c) => !c)}>
            <span className="hidden sm:inline">{camOff ? "Camera on" : "Camera off"}</span>
          </Button>
        )}
        <button
          onClick={() => setPhase("ended")}
          className="inline-flex items-center gap-2 rounded-full bg-[#e5383b] px-4 py-2 text-[13px] font-medium text-white hover:opacity-90"
        >
          <PhoneOff className="h-4 w-4" /> Leave
        </button>
      </div>
    </div>
  );
}
