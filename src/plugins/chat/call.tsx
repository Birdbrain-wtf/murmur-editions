import { useEffect, useRef, useState } from "react";
import { Mic, MicOff, Video, VideoOff, PhoneOff, Circle, Square, Check, X } from "lucide-react";
import type { Participant, Room as LiveRoom, RemoteTrack } from "livekit-client";
import { edition } from "../../edition";
import { Button, Notice } from "../../ui";
import { AUTO_EVENT, type AutoRecord } from "./autorecord";

/**
 * Voice and video calls in a chat room, over MatrixRTC.
 *
 * The room's call is a Matrix thing: each person in it posts a membership to the
 * room (the SDK's MatrixRTCSession does that and keeps it fresh), so any MatrixRTC
 * app in the room, Element X or Element Call included, sees the same call. The
 * sound and pictures go through LiveKit, a media relay on the collective's own
 * chat server: the app trades a one-off Matrix OpenID token for a relay ticket at
 * `<focus>/sfu/get`. Whoever started the call picked the relay, and everyone after
 * uses that one ("oldest membership"), so people from two collectives end up in
 * the same place. Server side: the `/livekit/*` paths on matrix.<server>, set up in
 * infra/services/matrix-calls/README.md.
 */

interface LivekitFocus {
  type: "livekit";
  livekit_service_url: string;
}

export interface CallState {
  roomId: string;
  live: LiveRoom;
  video: boolean;
}

/**
 * Recording, in project rooms only (ADR 0079). The switch is a state event in the
 * room, so every app in the call reads the same thing: anyone in the call can
 * turn it on or off, everyone sees the red bar, and someone who joins while it is
 * on starts with their microphone off. The recorder on the chat server
 * (infra/services/call-recorder) keeps each person's voice as its own file, so
 * each person can take theirs or have it deleted. A room offers recording when it
 * carries the project marker; the members room does not.
 */
export const RECORDING_EVENT = "partners.decent.call.recording";
const PROJECT_EVENT = "partners.decent.project";
/**
 * One-to-one calls record only when both people say yes (rich 2026-10-18). Each
 * person's answer is a state event keyed by their own Matrix address, which the
 * server lets only that person write, so nobody can agree on someone else's
 * behalf. An ask is a fresh nonce: agreeing to one call's recording is not
 * agreeing to the next. When everyone in the call has agreed to the same ask,
 * either app invites the recorder into the room (it is not there before) and
 * turns the switch on; the recorder checks the answers itself and stops the
 * moment anyone in the call takes theirs back.
 */
export const CONSENT_EVENT = "partners.decent.call.consent";
const ASK_FOR_MS = 2 * 60 * 60 * 1000;

export interface Recording {
  offered: boolean;
  active: boolean;
  /** who last switched it, as a Matrix address */
  by: string | null;
  /** everyone in the call must agree first (one-to-one rooms) */
  mutual: boolean;
}

function readRecording(client: any, roomId: string, direct: boolean): Recording {
  const st = client?.getRoom?.(roomId)?.currentState;
  const project = st?.getStateEvents?.(PROJECT_EVENT, "");
  const rec = st?.getStateEvents?.(RECORDING_EVENT, "");
  const c = rec?.getContent?.() ?? {};
  const mutual = !project && direct && !!edition.callRecorder;
  return { offered: !!project || mutual, active: !!c.active, by: rec?.getSender?.() ?? null, mutual };
}

export function useRecording(client: any, roomId: string | null, direct = false): Recording {
  const [r, setR] = useState<Recording>({ offered: false, active: false, by: null, mutual: false });
  useEffect(() => {
    if (!client || !roomId) return;
    const read = () => setR(readRecording(client, roomId, direct));
    read();
    const onState = (ev: any) => {
      if (ev?.getRoomId?.() !== roomId) return;
      const t = ev.getType?.();
      if (t === RECORDING_EVENT || t === PROJECT_EVENT) read();
    };
    client.on("RoomState.events", onState);
    return () => {
      client.off("RoomState.events", onState);
    };
  }, [client, roomId, direct]);
  return r;
}

export interface Consent {
  /** the current ask, if anyone asked in the last two hours */
  ask: string | null;
  askedBy: string | null;
  agreed: string[];
  declined: string[];
}

function readConsent(client: any, roomId: string): Consent {
  const evs: any[] = client?.getRoom?.(roomId)?.currentState?.getStateEvents?.(CONSENT_EVENT) ?? [];
  const fresh = evs
    .map((e) => ({ who: e.getStateKey(), sender: e.getSender(), c: e.getContent?.() ?? {} }))
    .filter((x) => x.who === x.sender && x.c.ask && Date.now() - (x.c.ts ?? 0) < ASK_FOR_MS);
  const latest = fresh.filter((x) => x.c.asked).sort((a, b) => b.c.ts - a.c.ts)[0];
  if (!latest) return { ask: null, askedBy: null, agreed: [], declined: [] };
  const same = fresh.filter((x) => x.c.ask === latest.c.ask);
  return {
    ask: latest.c.ask,
    askedBy: latest.who,
    agreed: same.filter((x) => x.c.agreed).map((x) => x.who),
    declined: same.filter((x) => !x.c.agreed).map((x) => x.who),
  };
}

export function useConsent(client: any, roomId: string | null): Consent {
  const empty: Consent = { ask: null, askedBy: null, agreed: [], declined: [] };
  const [c, setC] = useState<Consent>(empty);
  useEffect(() => {
    if (!client || !roomId) return;
    const read = () => setC(readConsent(client, roomId));
    read();
    const onState = (ev: any) => {
      if (ev?.getRoomId?.() === roomId && ev.getType?.() === CONSENT_EVENT) read();
    };
    client.on("RoomState.events", onState);
    return () => {
      client.off("RoomState.events", onState);
    };
  }, [client, roomId]);
  return c;
}

async function answer(client: any, call: CallState, ask: string, agreed: boolean, asked = false) {
  await client.sendStateEvent(
    call.roomId,
    CONSENT_EVENT,
    { ask, agreed, asked, lk_room: call.live.name, ts: Date.now() },
    client.getUserId(),
  );
}

/** Take back this account's yes, if it gave one. Leaving a call does this. */
async function withdrawConsent(client: any, call: CallState) {
  const me = client?.getUserId?.();
  const c = readConsent(client, call.roomId);
  if (c.ask && c.agreed.includes(me)) await answer(client, call, c.ask, false).catch(() => {});
}

/** Everyone has said yes: bring the recorder in and switch on. */
async function startMutual(client: any, call: CallState, ask: string) {
  const recorder = edition.callRecorder;
  if (!recorder) throw new Error("This collective has no call recorder.");
  const room = client.getRoom(call.roomId);
  const pl = room?.currentState?.getStateEvents?.("m.room.power_levels", "")?.getContent?.() ?? {};
  // The recorder resets the switch when the call ends, so it may set it.
  if (pl.events?.[RECORDING_EVENT] !== 0) {
    await client
      .sendStateEvent(call.roomId, "m.room.power_levels", { ...pl, events: { ...(pl.events ?? {}), [RECORDING_EVENT]: 0 } }, "")
      .catch(() => {});
  }
  const there = room?.getMember?.(recorder)?.membership;
  if (there !== "join" && there !== "invite") await client.invite(call.roomId, recorder);
  await client.sendStateEvent(call.roomId, RECORDING_EVENT, { active: true, lk_room: call.live.name, ask }, "");
}

export async function setRecording(client: any, call: CallState, active: boolean): Promise<void> {
  await client.sendStateEvent(call.roomId, RECORDING_EVENT, { active, lk_room: call.live.name }, "");
}

/** Where this account's server says its relay is, from its well-known, falling back to the usual path. */
async function ownFocus(client: any): Promise<LivekitFocus> {
  const server = String(client.getUserId() ?? "").split(":").slice(1).join(":");
  try {
    const r = await fetch(`https://${server}/.well-known/matrix/client`, { headers: { Accept: "application/json" } });
    const j = await r.json();
    const f = (j["org.matrix.msc4143.rtc_foci"] ?? []).find(
      (x: any) => x?.type === "livekit" && typeof x.livekit_service_url === "string",
    );
    if (f) return { type: "livekit", livekit_service_url: f.livekit_service_url };
  } catch {
    /* fall through */
  }
  return { type: "livekit", livekit_service_url: `${client.getHomeserverUrl().replace(/\/$/, "")}/livekit/jwt` };
}

/** People in the room's call right now, not counting this device. */
export function useCallers(client: any, roomId: string | null): number {
  const [n, setN] = useState(0);
  useEffect(() => {
    if (!client || !roomId) return;
    const room = client.getRoom(roomId);
    if (!room || !client.matrixRTC) return;
    const rtc = client.matrixRTC.getRoomSession(room);
    const me = `${client.getUserId()}|${client.getDeviceId()}`;
    const count = () =>
      setN(
        rtc.memberships.filter((m: any) => !m.isExpired() && `${m.sender}|${m.deviceId}` !== me).length,
      );
    count();
    rtc.on("memberships_changed", count);
    const t = setInterval(count, 15_000);
    return () => {
      rtc.off("memberships_changed", count);
      clearInterval(t);
    };
  }, [client, roomId]);
  return n;
}

export async function joinCall(client: any, roomId: string, video: boolean): Promise<CallState> {
  const room = client.getRoom(roomId);
  if (!room) throw new Error("That room is not loaded yet.");
  if (!client.getDeviceId()) throw new Error("Sign out of chat and open it again to make calls.");
  const rtc = client.matrixRTC.getRoomSession(room);
  const own = await ownFocus(client);
  // Join the relay the call already uses, or bring our own if we are first.
  const oldest = rtc.memberships.find((m: any) => !m.isExpired());
  const theirs = oldest
    ?.getPreferredFoci?.()
    .find((f: any) => f?.type === "livekit" && typeof f.livekit_service_url === "string");
  const service: string = theirs?.livekit_service_url ?? own.livekit_service_url;

  const openid = await client.getOpenIdToken();
  const r = await fetch(`${service.replace(/\/$/, "")}/sfu/get`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({ room: roomId, openid_token: openid, device_id: client.getDeviceId() }),
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok || !j.url || !j.jwt) throw new Error(`The call did not start (${r.status}).`);

  const { Room } = await import("livekit-client");
  const live = new Room({ adaptiveStream: true, dynacast: true });
  await live.connect(j.url, j.jwt);
  rtc.joinRoomSession(
    [{ ...own, livekit_alias: roomId }],
    { type: "livekit", focus_selection: "oldest_membership" },
    // One membership event per device (MSC4143), the shape current Element apps read.
    { manageMediaKeys: false, useLegacyMemberEvents: false },
  );
  // A refused microphone or camera leaves you in the call, listening. Joining a
  // call that is already recording leaves the microphone off: turning it on is
  // the choice to be in the recording.
  // A room that records every call keeps only the voices of people who said yes, so there
  // the microphone starts on as usual.
  const autoOn = !!client.getRoom?.(roomId)?.currentState?.getStateEvents?.(AUTO_EVENT, "")?.getContent?.()?.on;
  if (autoOn || !readRecording(client, roomId, false).active) await live.localParticipant.setMicrophoneEnabled(true).catch(() => {});
  if (video) await live.localParticipant.setCameraEnabled(true).catch(() => {});
  return { roomId, live, video };
}

export async function leaveCall(client: any, call: CallState): Promise<void> {
  await withdrawConsent(client, call);
  try {
    await call.live.disconnect();
  } catch {
    /* already gone */
  }
  const room = client?.getRoom?.(call.roomId);
  if (room) await client.matrixRTC.getRoomSession(room).leaveRoomSession(3000).catch(() => false);
}

/** The call strip: a tile for everyone in it, and the three controls. */
export function CallStage({
  call,
  name,
  onLeave,
  client,
  direct = false,
  auto,
}: {
  call: CallState;
  name: (identity: string) => string;
  onLeave: () => void;
  client: any;
  /** a one-to-one room: recording needs everyone's yes */
  direct?: boolean;
  /** the room records every call by itself; the strip above says who is in */
  auto?: AutoRecord;
}) {
  const [, setTick] = useState(0);
  const [problem, setProblem] = useState<string | null>(null);
  const recording = useRecording(client, call.roomId, direct);
  const consent = useConsent(recording.mutual ? client : null, call.roomId);
  // A relay identity is "@user:server:device"; the room knows the person's name.
  const nameOf = (id: string) =>
    client?.getRoom?.(call.roomId)?.getMember?.(id.split(":").slice(0, 2).join(":"))?.name ?? name(id);
  const [asking, setAsking] = useState(false);
  const [switching, setSwitching] = useState(false);
  const audioRef = useRef<HTMLDivElement>(null);
  const leaveRef = useRef(onLeave);
  leaveRef.current = onLeave;
  const { live } = call;

  useEffect(() => {
    let alive = true;
    const bump = () => alive && setTick((t) => t + 1);
    const onSub = (track: RemoteTrack) => {
      if (track.kind === "audio") audioRef.current?.appendChild(track.attach());
      bump();
    };
    const onUnsub = (track: RemoteTrack) => {
      track.detach().forEach((el) => el.remove());
      bump();
    };
    const onGone = () => leaveRef.current();
    const bumps = [
      "participantConnected",
      "participantDisconnected",
      "trackMuted",
      "trackUnmuted",
      "localTrackPublished",
      "localTrackUnpublished",
      "activeSpeakersChanged",
    ] as const;
    bumps.forEach((e) => live.on(e as any, bump));
    live.on("trackSubscribed" as any, onSub);
    live.on("trackUnsubscribed" as any, onUnsub);
    live.on("disconnected" as any, onGone);
    // Anything already playing before this mounted.
    live.remoteParticipants.forEach((p) =>
      p.audioTrackPublications.forEach((pub) => pub.track && audioRef.current?.appendChild(pub.track.attach())),
    );
    return () => {
      alive = false;
      bumps.forEach((e) => live.off(e as any, bump));
      live.off("trackSubscribed" as any, onSub);
      live.off("trackUnsubscribed" as any, onUnsub);
      live.off("disconnected" as any, onGone);
    };
  }, [live]);

  const me = live.localParticipant;
  const people: Participant[] = [me, ...live.remoteParticipants.values()];
  const myId: string = client?.getUserId?.() ?? "";
  // A relay identity is "@user:server:device"; consent is per person.
  const inCall = [...new Set(people.map((p) => (p === me ? myId : p.identity.split(":").slice(0, 2).join(":"))))];
  const others = inCall.filter((id) => id !== myId);
  const everyoneAgreed =
    recording.mutual && !!consent.ask && inCall.length >= 2 && inCall.every((id) => consent.agreed.includes(id));
  const askedOfMe = recording.mutual && !!consent.ask && consent.askedBy !== myId && !consent.agreed.includes(myId) && !consent.declined.includes(myId);
  const waitingOn = recording.mutual && consent.ask && consent.agreed.includes(myId) ? others.filter((id) => !consent.agreed.includes(id)) : [];
  const saidNo = recording.mutual && consent.ask ? consent.declined.filter((id) => id !== myId) : [];

  // Whoever's app sees the last yes first switches it on; the second does nothing.
  const starting = useRef<string | null>(null);
  useEffect(() => {
    if (!everyoneAgreed || recording.active || !consent.ask || starting.current === consent.ask) return;
    starting.current = consent.ask;
    void startMutual(client, call, consent.ask).catch(() => {
      starting.current = null;
      setProblem("You both agreed, but the recording did not start. Try asking again.");
    });
  }, [everyoneAgreed, recording.active, consent.ask, client, call]);

  async function toggle(kind: "mic" | "camera") {
    setProblem(null);
    try {
      if (kind === "mic") await me.setMicrophoneEnabled(!me.isMicrophoneEnabled);
      else await me.setCameraEnabled(!me.isCameraEnabled);
    } catch {
      setProblem(
        kind === "mic"
          ? "The microphone did not start. Check that this app may use it in your computer's privacy settings."
          : "The camera did not start. Check that this app may use it in your computer's privacy settings.",
      );
    }
    setTick((t) => t + 1);
  }

  async function flip(active: boolean) {
    setProblem(null);
    setSwitching(true);
    try {
      if (recording.mutual) {
        // Asking is saying yes yourself; stopping is taking your yes back.
        if (active) await answer(client, call, crypto.randomUUID(), true, true);
        else {
          await withdrawConsent(client, call);
          await setRecording(client, call, false);
        }
      } else await setRecording(client, call, active);
      setAsking(false);
    } catch {
      setProblem(active ? "The recording did not start. Try again in a moment." : "The recording did not stop. Try again now.");
    } finally {
      setSwitching(false);
    }
  }

  async function reply(agreed: boolean) {
    if (!consent.ask) return;
    setProblem(null);
    setSwitching(true);
    try {
      await answer(client, call, consent.ask, agreed);
    } catch {
      setProblem("Your answer did not go. Try again.");
    } finally {
      setSwitching(false);
    }
  }

  return (
    <div className="border-b border-[var(--line)] px-8 py-4">
      {recording.active && (
        <div
          role="status"
          className="mb-3 flex flex-wrap items-center gap-2 rounded-[var(--radius)] border px-3 py-2 text-[13px]"
          style={{ borderColor: "var(--danger)", color: "var(--danger)" }}
        >
          <Circle className="h-3 w-3 fill-current" />
          <span className="font-medium">Recording</span>
          <span className="text-[var(--muted)]">
            {recording.mutual
              ? "You both agreed. Each voice is kept as its own file and transcribed, and either of you can stop it."
              : `${recording.by ? `Started by ${nameOf(recording.by)}. ` : ""}Each voice is kept as its own file and transcribed.`}
          </span>
          <Button variant="danger" icon={Square} busy={switching} onClick={() => void flip(false)} className="ml-auto">
            Stop recording
          </Button>
        </div>
      )}
      {recording.active && auto?.on && auto.agreed && !auto.agreed.includes(myId) && (
        <Notice tone="warn">This call is recording, but not your voice, because you have not said yes. Press Record me above to be included.</Notice>
      )}
      {recording.active && !auto?.on && !me.isMicrophoneEnabled && (
        <Notice tone="warn">
          Your microphone is off because this call is being recorded. Turn it on when you are happy to be in the recording.
        </Notice>
      )}
      {askedOfMe && !recording.active && (
        <div role="alert" className="mb-3 rounded-[var(--radius)] border border-[var(--line-strong)] px-4 py-3 text-[13px] leading-relaxed">
          <p className="font-medium">{nameOf(consent.askedBy ?? "")} would like to record this call</p>
          <p className="mt-1 text-[var(--muted)]">
            Nothing is recorded unless you both say yes, and either of you can stop it at any time. Each voice is kept as
            its own file and transcribed, and filed in {edition.instance.name}'s private record under each of your names.
            It is not used to train any model. Your voice stays yours: you can take a copy of it, or have your voice and
            your words deleted, whenever you like.
          </p>
          <div className="mt-3 flex gap-2">
            <Button variant="primary" icon={Check} busy={switching} onClick={() => void reply(true)}>
              Yes, record
            </Button>
            <Button variant="quiet" icon={X} onClick={() => void reply(false)}>
              No thanks
            </Button>
          </div>
        </div>
      )}
      {waitingOn.length > 0 && !recording.active && (
        <Notice tone="warn">
          Waiting for {waitingOn.map(nameOf).join(" and ")} to agree. Nothing is recorded until they do.{" "}
          <button className="underline" onClick={() => void flip(false)}>
            Cancel
          </button>
        </Notice>
      )}
      {saidNo.length > 0 && !recording.active && waitingOn.length === 0 && (
        <Notice tone="warn">{saidNo.map(nameOf).join(" and ")} said no to recording, so this call is not recorded.</Notice>
      )}
      {asking && !recording.active && recording.mutual && (
        <div className="mb-3 rounded-[var(--radius)] border border-[var(--line-strong)] px-4 py-3 text-[13px] leading-relaxed">
          <p className="font-medium">Ask to record this call?</p>
          <p className="mt-1 text-[var(--muted)]">
            {others.length ? others.map(nameOf).join(" and ") : "The other person"} will be asked first. Nothing is
            recorded unless you both say yes, and either of you can stop it at any time. Each voice is kept as its own
            file and transcribed, and filed in {edition.instance.name}'s private record under each of your names. It is
            not used to train any model.
          </p>
          <p className="mt-1 text-[var(--muted)]">
            Your voice stays yours. You can take a copy of your recordings with you at any time, and you can have your
            voice and your words deleted from ours.
          </p>
          <div className="mt-3 flex gap-2">
            <Button variant="primary" icon={Circle} busy={switching} disabled={!others.length} onClick={() => void flip(true)}>
              Ask
            </Button>
            <Button variant="quiet" onClick={() => setAsking(false)}>
              Not now
            </Button>
          </div>
        </div>
      )}
      {asking && !recording.active && !recording.mutual && (
        <div className="mb-3 rounded-[var(--radius)] border border-[var(--line-strong)] px-4 py-3 text-[13px] leading-relaxed">
          <p className="font-medium">Record this call?</p>
          <p className="mt-1 text-[var(--muted)]">
            Everyone in the call sees a red bar while it records, and anyone can stop it. Each person's voice is kept
            as its own file and transcribed, and the record is filed with this project and with each person's note. It
            stays private to the people on the project and is not used to train any model.
          </p>
          <p className="mt-1 text-[var(--muted)]">
            Your voice stays yours. You can take a copy of your recordings with you at any time, and you can have your
            voice and your words deleted from ours.
          </p>
          <div className="mt-3 flex gap-2">
            <Button variant="primary" icon={Circle} busy={switching} onClick={() => void flip(true)}>
              Start recording
            </Button>
            <Button variant="quiet" onClick={() => setAsking(false)}>
              Not now
            </Button>
          </div>
        </div>
      )}
      <div className="flex flex-wrap gap-3">
        {people.map((p) => (
          <Tile key={p.identity} p={p} label={p === me ? "You" : nameOf(p.identity)} />
        ))}
      </div>
      <div className="mt-3 flex items-center gap-2">
        <Button
          icon={me.isMicrophoneEnabled ? Mic : MicOff}
          onClick={() => void toggle("mic")}
          aria-pressed={!me.isMicrophoneEnabled}
        >
          {me.isMicrophoneEnabled ? "Mute" : "Unmute"}
        </Button>
        <Button
          icon={me.isCameraEnabled ? Video : VideoOff}
          onClick={() => void toggle("camera")}
          aria-pressed={me.isCameraEnabled}
        >
          {me.isCameraEnabled ? "Camera off" : "Camera on"}
        </Button>
        {recording.offered && !auto?.on && !recording.active && !asking && !askedOfMe && waitingOn.length === 0 && (
          <Button icon={Circle} onClick={() => setAsking(true)}>
            Record
          </Button>
        )}
        <Button variant="danger" icon={PhoneOff} onClick={onLeave}>
          Leave
        </Button>
        <span className="ml-2 font-mono text-[11px] text-[var(--faint)]">
          {people.length === 1 ? "Waiting for others" : `${people.length} in the call`}
        </span>
      </div>
      {problem && <Notice tone="warn">{problem}</Notice>}
      <div ref={audioRef} hidden />
    </div>
  );
}

function Tile({ p, label }: { p: Participant; label: string }) {
  const ref = useRef<HTMLVideoElement>(null);
  const pub = p.getTrackPublication("camera" as any);
  const track = pub && !pub.isMuted ? pub.track : undefined;
  useEffect(() => {
    const el = ref.current;
    if (!track || !el) return;
    track.attach(el);
    return () => {
      track.detach(el);
    };
  }, [track]);
  return (
    <div
      className="relative flex h-32 w-48 items-center justify-center overflow-hidden rounded-[var(--radius)] border bg-[var(--card)]"
      style={{ borderColor: p.isSpeaking ? "var(--accent)" : "var(--line)" }}
    >
      {track ? (
        <video ref={ref} autoPlay playsInline muted className="h-full w-full object-cover" />
      ) : (
        <span className="font-tight text-2xl text-[var(--faint)]">{label.slice(0, 2).toUpperCase()}</span>
      )}
      <span className="absolute bottom-1.5 left-2 flex items-center gap-1 font-mono text-[10px] text-[var(--muted)]">
        {!p.isMicrophoneEnabled && <MicOff className="h-3 w-3" />}
        {label}
      </span>
    </div>
  );
}
