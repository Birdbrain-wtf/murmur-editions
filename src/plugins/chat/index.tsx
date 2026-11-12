import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import {
  ArrowLeft,
  Search,
  MessageSquare,
  Hash,
  Send,
  Settings,
  LogOut,
  Fingerprint,
  Link2,
  Phone,
  Video,
  LockKeyhole,
  User,
  Users,
  PhoneIncoming,
  PhoneOff,
  Bell,
  BellOff,
  AtSign,
} from "lucide-react";
import type { MurmurPlugin, PluginContext } from "../../host/types";
import { issues } from "../../host/support";
import { edition, groupWord } from "../../edition";
import {
  Page,
  PageHeader,
  PageBody,
  Section,
  Eyebrow,
  Gate,
  inputClass,
  Button,
  Notice,
  Dot,
} from "../../ui";
import { participate, today } from "../../identity/participation";
import { sessionRejected } from "../../identity/session";
import { PasskeySignIn } from "../../identity/SignIn";
import { useIdentity } from "../../identity/useIdentity";
import { CallStage, joinCall, leaveCall, useCallers, useRecording, type CallState } from "./call";
import { MyRecordings } from "./recordings";
import { DemoChat } from "./demo";
import { PrivateChats } from "./private";
import { Composer, Timeline } from "./conversation";
import { messageContent, readMentions, roomPeople, type Mention } from "./mentions";
import { AutoRecordStrip, useAutoRecord } from "./autorecord";
import { acceptDirect, directRooms, listPeople, loaded, openDirect, ring, useRings, type Person } from "./people";
import { LEVELS, alert, alertsOn, levelOf, looking, markRead, setAlerts, setLevel, shouldAlert, type Level } from "./notify";

/**
 * Chat plugin — Matrix.
 *
 * Signing in is the passkey. The app hands its session to the door that issued
 * it (`<signIn.pair>/matrix`), which makes the member's account on their
 * collective's own homeserver, seats them in the members room and returns a
 * per-member token. There is no Matrix password to know, so there is no
 * password form and no password to change. Someone in two collectives has one
 * account in each edition, all opened by the same passkey. A member who already
 * uses Matrix elsewhere can have that address invited too (`<signIn.pair>/matrix-link`).
 * Server side: infra/services/chaos-auth/matrix-members.ts.
 *
 * matrix-js-sdk is lazy-imported on first use so the rest of the host renders
 * even if the SDK has browser-build quirks. v0.1 runs without e2ee (no olm /
 * rust-crypto), so it speaks plaintext rooms; encrypted rooms show a notice.
 * Federation between Decent instances rides on Matrix rooms, which is what the
 * `network` plugin builds on. Voice and video calls in a room: ./call.tsx.
 */

interface RoomLite {
  id: string;
  name: string;
  unread: number;
  /** of those, how many mention this account */
  mentions: number;
  level: Level;
  /** someone has invited this account and it has not joined yet */
  invited: boolean;
}

// A Matrix address: @name:server.
const MXID = /^@[^:\s]+:[^\s]+$/;
interface EventLite {
  id: string;
  sender: string;
  body: string;
  ts: number;
  mine: boolean;
  name?: string;
  mentions?: Mention[];
  forMe?: boolean;
  /** shown the moment it is sent, before the server has it */
  pending?: boolean;
  txnId?: string;
}

const SESSION_KEY = "murmur.matrix.session.v1";
// Unsent words in group rooms, kept on this device until sent or signed out.
// Private chats keep theirs in memory only, so nothing private is written down.
const DRAFTS_KEY = "murmur.matrix.drafts.v1";
function loadDrafts(): Record<string, string> {
  try { return JSON.parse(localStorage.getItem(DRAFTS_KEY) || "{}"); } catch { return {}; }
}
function saveDraft(drafts: Record<string, string>, room: string, value: string) {
  if (value) drafts[room] = value; else delete drafts[room];
  localStorage.setItem(DRAFTS_KEY, JSON.stringify(drafts));
}

/** A demo edition shows sample rooms until the member signs in (`./demo.tsx`). */
function Panel(ctx: PluginContext) {
  const [side, setSide] = useState<"rooms" | "private">("rooms");
  if (edition.demo && !(ctx.identity.signedIn && ctx.identity.session)) return <DemoChat {...ctx} />;
  // One Chat for the member: the group rooms (Matrix) and private chats (SimpleX),
  // two engines underneath that never mix (rich 2026-10-16).
  const switcher = edition.privateChats ? (
    <div role="group" aria-label="Chat" className="flex gap-2">
      <Button variant={side === "rooms" ? "primary" : "quiet"} icon={Hash} aria-pressed={side === "rooms"} onClick={() => setSide("rooms")}>
        Group rooms
      </Button>
      <Button variant={side === "private" ? "primary" : "quiet"} icon={LockKeyhole} aria-pressed={side === "private"} onClick={() => setSide("private")}>
        Private chats
      </Button>
    </div>
  ) : undefined;
  if (side === "private" && switcher) return <PrivateChats ctx={ctx} switcher={switcher} />;
  return <LivePanel {...ctx} switcher={switcher} />;
}

function LivePanel({ identity, switcher }: PluginContext & { switcher?: ReactNode }) {
  const [client, setClient] = useState<any>(null);
  const [phase, setPhase] = useState<"loggedout" | "connecting" | "ready">(
    "loggedout",
  );
  const [error, setError] = useState<string | null>(null);

  const [notOpen, setNotOpen] = useState(false);

  const [rooms, setRooms] = useState<RoomLite[]>([]);
  // Everyone this account shares a room with, and which room is one-to-one with whom.
  const [people, setPeople] = useState<Person[]>([]);
  const [directs, setDirects] = useState<Map<string, string>>(new Map());
  const [sdk, setSdk] = useState<any>(null);
  const [opening, setOpening] = useState<string | null>(null);
  const [activeRoom, setActiveRoom] = useState<string | null>(null);
  const [events, setEvents] = useState<EventLite[]>([]);
  const [draft, setDraft] = useState("");
  const [to, setTo] = useState("");
  const [starting, setStarting] = useState(false);
  const [conversation, setConversation] = useState(false);
  const [search, setSearch] = useState("");
  const drafts = useRef<Record<string, string>>(loadDrafts());
  const selectedRoom = useRef(activeRoom);
  selectedRoom.current = activeRoom;
  function selectRoom(id: string) {
    setActiveRoom(id);
    setView("chat");
    setConversation(true);
  }
  useEffect(() => { setDraft(activeRoom ? drafts.current[activeRoom] ?? "" : ""); }, [activeRoom]);
  function editDraft(value: string) {
    if (activeRoom) saveDraft(drafts.current, activeRoom, value);
    setDraft(value);
  }

  const [view, setView] = useState<"chat" | "account">("chat");
  const [elsewhere, setElsewhere] = useState("");
  const [linking, setLinking] = useState(false);
  const [linked, setLinked] = useState<string | null>(null);
  const [linkError, setLinkError] = useState<string | null>(null);
  const [myName, setMyName] = useState("");
  const [savingName, setSavingName] = useState(false);
  const [nameNote, setNameNote] = useState<{ tone: "ok" | "danger"; text: string } | null>(null);
  const [alerts, setAlertsState] = useState(alertsOn);
  const [alertNote, setAlertNote] = useState<string | null>(null);
  const [roomLevel, setRoomLevel] = useState<Level>("all");
  const sectionRef = useRef<HTMLElement>(null);
  const signedIn = !!(identity.signedIn && identity.session);

  const [call, setCall] = useState<CallState | null>(null);
  const [calling, setCalling] = useState(false);
  const callRef = useRef<CallState | null>(null);
  callRef.current = call;
  const callers = useCallers(phase === "ready" ? client : null, activeRoom);
  const activeDirect = activeRoom ? directs.get(activeRoom) ?? null : null;
  const recording = useRecording(phase === "ready" ? client : null, activeRoom, !!activeDirect);
  const autoRecord = useAutoRecord(phase === "ready" && !activeDirect ? client : null, activeRoom);
  const [incoming, dismissRing] = useRings(phase === "ready" ? client : null, sdk);

  // Signing in from the gate above opens chat straight away.
  const { signIn } = useIdentity();
  const firstSession = useRef(identity.session);
  useEffect(() => {
    if (identity.session && identity.session !== firstSession.current && !localStorage.getItem(SESSION_KEY)) {
      firstSession.current = identity.session;
      void openWithPasskey();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [identity.session]);

  // Restore a persisted session on mount, or open chat with the passkey session
  // if there is none yet.
  useEffect(() => {
    const raw = localStorage.getItem(SESSION_KEY);
    if (raw) {
      try {
        const s = JSON.parse(raw);
        void start({ baseUrl: s.baseUrl, accessToken: s.accessToken, userId: s.userId });
      } catch {
        /* ignore */
      }
    } else if (signedIn) {
      void openWithPasskey();
    }
    return () => {
      // Leaving Chat hangs up, so nobody stays in a call they cannot see.
      const c = callRef.current;
      if (c) void c.live.disconnect();
      try {
        client?.stopClient?.();
      } catch {
        /* ignore */
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);


  async function start(creds: { baseUrl: string; accessToken: string; userId: string }) {
    setPhase("connecting");
    setError(null);
    try {
      const sdk: any = await import("matrix-js-sdk");
      // Calls name the device they come from, so ask the server which one this token is.
      const who = await fetch(`${creds.baseUrl.replace(/\/$/, "")}/_matrix/client/v3/account/whoami`, {
        headers: { Authorization: `Bearer ${creds.accessToken}`, Accept: "application/json" },
      })
        .then((r) => (r.ok ? r.json() : {}))
        .catch(() => ({})) as { device_id?: string };
      const c = sdk.createClient({
        baseUrl: creds.baseUrl,
        accessToken: creds.accessToken,
        userId: creds.userId,
        deviceId: who.device_id,
      });

      c.on(sdk.ClientEvent.Sync, (state: string) => {
        if (state === "PREPARED") {
          setPhase("ready");
          refreshRooms(c, sdk);
        }
      });
      c.on(sdk.RoomEvent.Timeline, (ev: any, room: any, toStart: boolean, _removed: boolean, data: any) => {
        refreshRooms(c, sdk);
        if (toStart || !data?.liveEvent || !c.isInitialSyncComplete?.()) return;
        if (!shouldAlert(c, ev, selectedRoom.current)) return;
        const who = room?.getMember?.(ev.getSender())?.name || shortSender(ev.getSender());
        const direct = directRooms(c).has(room?.roomId);
        void alert(direct ? who : `${who} in ${room?.name ?? "a room"}`, ev.getContent()?.body ?? "");
      });
      c.on(sdk.RoomEvent.Receipt, () => refreshRooms(c, sdk));
      // A new one-to-one room, or someone opening one with us, changes the People list.
      c.on(sdk.ClientEvent.AccountData, () => refreshRooms(c, sdk));
      c.on(sdk.RoomEvent.MyMembership, () => refreshRooms(c, sdk));
      setSdk(sdk);

      await c.startClient({ initialSyncLimit: 30 });
      setClient(c);
    } catch (e) {
      setError(e instanceof Error ? e.message : "matrix connect failed");
      setPhase("loggedout");
    }
  }

  function refreshRooms(c: any, _sdk: any) {
    const dms = directRooms(c);
    setDirects(dms);
    setPeople(listPeople(c));
    const list: RoomLite[] = c
      .getRooms()
      .filter((r: any) => !dms.has(r.roomId))
      .map((r: any) => ({
        id: r.roomId,
        name: r.name || r.roomId,
        unread: r.getUnreadNotificationCount?.() ?? 0,
        mentions: r.getUnreadNotificationCount?.("highlight") ?? 0,
        level: levelOf(c, r.roomId),
        invited: r.getMyMembership?.() === "invite",
      }))
      .sort((a: RoomLite, b: RoomLite) => a.name.localeCompare(b.name));
    setRooms(list);
    setActiveRoom((prev) => prev ?? list.find((r) => !r.invited)?.id ?? null);
  }

  // Trade the app's passkey session for a chat account on this collective's own
  // server. Idempotent: the door finds the account and the seat if they exist.
  async function openWithPasskey() {
    if (!identity.session) return;
    setPhase("connecting");
    setError(null);
    setNotOpen(false);
    try {
      const r = await fetch(`${edition.signIn.pair}/matrix`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify({ session: identity.session }),
      });
      const j = await r.json().catch(() => ({}));
      if (r.status === 503 && j.notOpen) {
        setNotOpen(true);
        setPhase("loggedout");
        return;
      }
      // The door no longer accepts the app's session: the app signs out of this
      // collective and the gate below offers the passkey in place.
      if (r.status === 401) {
        setPhase("loggedout");
        sessionRejected(identity.session);
        return;
      }
      if (!r.ok || !j.accessToken) throw new Error(j.error || `Chat did not open (${r.status}).`);
      const session = { baseUrl: j.baseUrl, accessToken: j.accessToken, userId: j.userId };
      localStorage.setItem(SESSION_KEY, JSON.stringify(session));
      await start(session);
      if (j.roomId) setActiveRoom(j.roomId);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Chat did not open.");
      setPhase("loggedout");
    }
  }

  // Bring an address the member already has elsewhere into the members room.
  // The door invites it; only its owner can accept, so nothing else is checked.
  async function linkElsewhere(e: React.FormEvent) {
    e.preventDefault();
    const mxid = elsewhere.trim();
    if (!identity.session || !MXID.test(mxid)) return;
    setLinking(true);
    setLinkError(null);
    try {
      const r = await fetch(`${edition.signIn.pair}/matrix-link`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify({ session: identity.session, mxid }),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j.error || `The invite did not go (${r.status}).`);
      setLinked(j.invited || mxid);
      setElsewhere("");
    } catch (err) {
      setLinkError(err instanceof Error ? err.message : "The invite did not go.");
    } finally {
      setLinking(false);
    }
  }

  // Signing out of the app signs out of chat too, so a shared computer does not
  // stay in the last person's rooms.
  useEffect(() => {
    if (!signedIn && client) void signOut();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [signedIn]);

  // Load timeline when active room changes.
  useEffect(() => {
    if (!client || !activeRoom) return;
    setEvents([]);
    let cancelled = false;
    let detach: (() => void) | undefined;
    (async () => {
      const sdk: any = await import("matrix-js-sdk");
      if (cancelled) return;
      const room = client.getRoom(activeRoom);
      if (!room) return;
      const me = client.getUserId();
      const lite = (ev: any): EventLite => ({
        id: ev.getId(),
        sender: ev.getSender(),
        body: ev.getContent()?.body ?? "",
        ts: ev.getTs(),
        mine: ev.getSender() === me,
        name: room.getMember?.(ev.getSender())?.name,
        mentions: readMentions(ev.getContent(), room),
        forMe: ev.getSender() !== me && readMentions(ev.getContent(), room).some((m) => m.userId === me),
        txnId: ev.getTxnId?.() ?? ev.getUnsigned?.()?.transaction_id,
      });
      setEvents(
        room
          .getLiveTimeline()
          .getEvents()
          .filter((ev: any) => ev.getType() === "m.room.message")
          .map(lite),
      );

      // Our own message is already on screen from send(); when the SDK or the
      // server hands it back, it replaces that line rather than adding another.
      const onTl = (ev: any, r: any) => {
        if (r?.roomId !== activeRoom) return;
        if (ev.getType() !== "m.room.message") return;
        const next = lite(ev);
        setEvents((prev) => {
          const i = prev.findIndex(
            (p) => p.id === next.id || (!!next.txnId && p.txnId === next.txnId),
          );
          if (i < 0) return [...prev, next];
          const copy = prev.slice();
          copy[i] = { ...next, pending: prev[i].pending && ev.status != null };
          return copy;
        });
      };
      const onEcho = (ev: any, r: any) => {
        if (r?.roomId !== activeRoom) return;
        const txnId = ev.getTxnId?.();
        if (!txnId) return;
        setEvents((prev) =>
          prev.map((p) =>
            p.txnId === txnId ? { ...p, id: ev.getId(), pending: ev.status != null } : p,
          ),
        );
      };
      client.on(sdk.RoomEvent.Timeline, onTl);
      client.on(sdk.RoomEvent.LocalEchoUpdated, onEcho);
      detach = () => {
        client.off(sdk.RoomEvent.Timeline, onTl);
        client.off(sdk.RoomEvent.LocalEchoUpdated, onEcho);
      };
    })();
    return () => {
      cancelled = true;
      detach?.();
    };
  }, [client, activeRoom]);

  // Reading a room marks it read, here and in the member's other Matrix apps, but
  // only while they can actually see it: the window in front and the room on screen.
  useEffect(() => {
    if (!client || !activeRoom || view !== "chat") return;
    const room = activeRoom;
    const read = () => {
      if (looking() && (sectionRef.current?.offsetWidth ?? 0) > 0) void markRead(client, room).then(() => refreshRooms(client, sdk));
    };
    read();
    window.addEventListener("focus", read);
    document.addEventListener("visibilitychange", read);
    return () => {
      window.removeEventListener("focus", read);
      document.removeEventListener("visibilitychange", read);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [client, activeRoom, view, conversation, events.length]);

  useEffect(() => {
    if (client && activeRoom) setRoomLevel(levelOf(client, activeRoom));
  }, [client, activeRoom, rooms]);

  async function chooseLevel(level: Level) {
    if (!client || !activeRoom) return;
    const was = roomLevel;
    setRoomLevel(level);
    try {
      await setLevel(client, activeRoom, level);
      refreshRooms(client, sdk);
    } catch (err) {
      setRoomLevel(was);
      setError(err instanceof Error ? err.message : "Could not change notifications for this room.");
    }
  }

  // The name other people see beside this account's messages, in this app and in
  // any other Matrix app. The address itself never changes.
  useEffect(() => {
    if (view !== "account" || !client) return;
    setNameNote(null);
    client
      .getProfileInfo(client.getUserId(), "displayname")
      .then((p: any) => setMyName(p?.displayname ?? ""))
      .catch(() => setMyName(client.getUser?.(client.getUserId())?.displayName ?? ""));
  }, [view, client]);

  async function saveName(e: React.FormEvent) {
    e.preventDefault();
    const name = myName.trim();
    if (!client || !name || savingName) return;
    setSavingName(true);
    setNameNote(null);
    try {
      await client.setDisplayName(name);
      setNameNote({ tone: "ok", text: `People now see you as ${name}.` });
    } catch (err) {
      setNameNote({ tone: "danger", text: err instanceof Error ? err.message : "The name did not save." });
    } finally {
      setSavingName(false);
    }
  }

  async function toggleAlerts() {
    setAlertNote(null);
    const on = await setAlerts(!alerts);
    setAlertsState(on);
    if (!alerts && !on) setAlertNote("This computer did not allow alerts. Turn them on for the app in your system's notification settings, then try again.");
  }

  // Start a direct conversation with someone by their Matrix address, so a
  // member can talk to the people they invite without leaving the app.
  async function startDirect(e: React.FormEvent) {
    e.preventDefault();
    const target = to.trim();
    if (!client || !MXID.test(target) || starting) return;
    setStarting(true);
    setError(null);
    try {
      const { room_id } = await client.createRoom({
        is_direct: true,
        invite: [target],
        preset: "trusted_private_chat",
      });
      // Mark it as a direct chat in the account, which other Matrix apps read too.
      const direct = { ...(client.getAccountData?.("m.direct")?.getContent?.() ?? {}) };
      direct[target] = [...new Set([...(direct[target] ?? []), room_id])];
      await client.setAccountData("m.direct", direct).catch(() => {});
      setTo("");
      selectRoom(room_id);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not start the conversation.");
    } finally {
      setStarting(false);
    }
  }

  // Open the one-to-one room with this person, making it the first time.
  async function openPerson(p: Person) {
    if (!client || opening) return;
    if (p.roomId && !p.invited) return selectRoom(p.roomId);
    setOpening(p.userId);
    setError(null);
    try {
      const id = p.invited && p.roomId ? (await acceptDirect(client, p.roomId, p.userId), p.roomId) : await openDirect(client, p.userId);
      await loaded(client, id);
      refreshRooms(client, sdk);
      selectRoom(id);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not open the conversation.");
    } finally {
      setOpening(null);
    }
  }

  async function join(roomId: string) {
    try {
      await client.joinRoom(roomId);
      selectRoom(roomId);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not join the room.");
    }
  }

  async function send(e: React.FormEvent) {
    e.preventDefault();
    const body = draft.trim();
    if (!body || !client || !activeRoom) return;
    const sentRoom = activeRoom;
    editDraft("");
    // Show it straight away. The server's copy takes the same place when it lands.
    const txnId = client.makeTxnId();
    const me = client.getUserId();
    const content = messageContent(body, roomPeople(client, activeRoom));
    const mentions = readMentions(content, client.getRoom(activeRoom));
    setEvents((prev) => [
      ...prev,
      {
        id: `~${activeRoom}:${txnId}`,
        sender: me,
        body,
        ts: Date.now(),
        mine: true,
        mentions,
        pending: true,
        txnId,
      },
    ]);
    try {
      await client.sendMessage(activeRoom, content as any, txnId);
      // Speaking in a room is taking part: a signed check-in for this room today.
      // Reading is not, so opening a room records nothing (ADR 0069).
      void participate("chat", `chat:${activeRoom}@${today()}`);
    } catch (err) {
      // Take the line back off and return the words to the box, so nothing
      // looks sent that was not.
      if (selectedRoom.current === sentRoom) setEvents((prev) => prev.filter((p) => p.txnId !== txnId));
      saveDraft(drafts.current, sentRoom, drafts.current[sentRoom] || body);
      if (selectedRoom.current === sentRoom) setDraft(drafts.current[sentRoom]);
      setError(err instanceof Error ? err.message : "send failed");
    }
  }

  async function startCall(video: boolean, roomId = activeRoom) {
    if (!client || !roomId || calling) return;
    if (call) await hangUp();
    setCalling(true);
    setError(null);
    try {
      const first = roomId === activeRoom ? callers === 0 : false;
      setCall(await joinCall(client, roomId, video));
      // Calling one person rings them; a group room's call is there for whoever opens it.
      if (directs.has(roomId) && first) void ring(client, roomId, video);
      // Joining a call is taking part in the room, the same as speaking in it.
      void participate("chat", `chat:${roomId}@${today()}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "The call did not start.");
    } finally {
      setCalling(false);
    }
  }

  async function answerRing(video: boolean) {
    if (!incoming) return;
    const id = incoming.roomId;
    dismissRing(id);
    selectRoom(id);
    await startCall(video, id);
  }

  const hangUp = useCallback(async () => {
    const c = callRef.current;
    if (!c) return;
    setCall(null);
    await leaveCall(client, c);
  }, [client]);

  async function signOut() {
    await hangUp();
    try {
      await client?.logout?.();
    } catch {
      /* token may already be invalid — clear locally regardless */
    }
    try {
      client?.stopClient?.();
    } catch {
      /* ignore */
    }
    localStorage.removeItem(SESSION_KEY);
    localStorage.removeItem(DRAFTS_KEY);
    drafts.current = {};
    setClient(null);
    setRooms([]);
    setEvents([]);
    setActiveRoom(null);
    setView("chat");
    setError(null);
    setPhase("loggedout");
  }

  const header = (
    <PageHeader
      icon={MessageSquare}
      eyebrow="chat"
      title="Chat"
      lede={`Talk to the people in your ${groupWord}.${identity.handle ? ` Signed in as ${identity.handle}.` : ""}`}
      actions={switcher}
    />
  );

  // ── Not connected: the passkey opens chat ───────────────────────
  if (phase !== "ready") {
    return (
      <Page>
        {header}
        <PageBody width="read">
          {!signedIn ? (
            <PasskeySignIn
              onSignedIn={signIn}
              title="Sign in to chat"
              lede={
                identity.lapsedAs
                  ? `${edition.instance.name} no longer accepts the sign-in this app held for ${identity.lapsedAs}. Sign in again and Chat opens where you left it.`
                  : `Chat opens with your passkey. Sign in to ${edition.instance.name} and you land in the room with everyone else in your ${groupWord}.`
              }
            />
          ) : notOpen ? (
            <Gate icon={MessageSquare} title="Chat is not open yet">
              <p>
                Your {groupWord}'s chat server is not running yet. When it is, opening Chat puts you
                straight into the members room, with nothing to set up.
              </p>
            </Gate>
          ) : (
            <Gate
              icon={MessageSquare}
              title="Open chat"
              action={
                <Button
                  variant="primary"
                  size="md"
                  icon={Fingerprint}
                  busy={phase === "connecting"}
                  onClick={() => void openWithPasskey()}
                >
                  {phase === "connecting" ? "Opening" : "Open chat"}
                </Button>
              }
            >
              <p>
                Your chat account comes with your passkey. Opening Chat makes it the first time and puts
                you in the room with everyone else in your {groupWord}.
              </p>
              {error && <Notice tone="danger">{error}</Notice>}
            </Gate>
          )}
        </PageBody>
      </Page>
    );
  }

  // ── Ready: rooms + timeline ──────────────────────────────────────
  const activeName = activeDirect
    ? people.find((p) => p.userId === activeDirect)?.name ?? shortSender(activeDirect)
    : rooms.find((r) => r.id === activeRoom)?.name ?? "";
  const q = search.toLowerCase();
  const shownPeople = people.filter((p) => p.name.toLowerCase().includes(q) || p.userId.toLowerCase().includes(q));
  const shownRooms = rooms.filter((r) => r.name.toLowerCase().includes(q));
  const roomName = (id: string) =>
    directs.has(id) ? people.find((p) => p.userId === directs.get(id))?.name ?? "them" : rooms.find((r) => r.id === id)?.name ?? "another room";
  return (
    <Page>
      {header}
      {incoming && call?.roomId !== incoming.roomId && (
        <div role="alert" className="flex flex-wrap items-center gap-2 border-b border-[var(--line)] px-8 py-3 text-[13px]">
          <PhoneIncoming className="h-4 w-4 text-[var(--accent)]" />
          <span className="font-medium">
            {incoming.name} is {incoming.video ? "video " : ""}calling you
          </span>
          <span className="ml-auto flex flex-wrap gap-2">
            <Button variant="primary" icon={Phone} busy={calling} onClick={() => void answerRing(false)}>
              Answer
            </Button>
            <Button icon={Video} busy={calling} onClick={() => void answerRing(true)}>
              Answer with video
            </Button>
            <Button variant="quiet" icon={PhoneOff} onClick={() => dismissRing(incoming.roomId)}>
              Not now
            </Button>
          </span>
        </div>
      )}
      <div className="chat-layout" data-conversation={conversation}>
        <aside className="chat-sidebar" aria-label="Rooms">
          <div className="border-b border-[var(--line)] px-8 py-3">
            <Eyebrow icon={Hash}>rooms</Eyebrow>
          </div>
          <label className="mx-3 mt-3 flex items-center gap-2">
            <Search size={16} aria-hidden="true" />
            <input type="search" aria-label="Find a person or room" placeholder="Find a person or room" value={search} onChange={(e) => setSearch(e.target.value)} className={`${inputClass} min-w-0 flex-1`} />
          </label>
          <form onSubmit={startDirect} className="flex items-center gap-2 border-b border-[var(--line)] px-4 py-3">
            <input
              value={to}
              onChange={(e) => setTo(e.target.value)}
              placeholder={`Message @alice:${serverOf(client?.getUserId?.() ?? "")}`}
              spellCheck={false}
              aria-label="Start a conversation with a Matrix address"
              className={`${inputClass} font-mono min-w-0 flex-1 px-2.5 py-1.5 text-xs`}
            />
            <Button
              type="submit"
              disabled={!MXID.test(to.trim())}
              busy={starting}
              icon={Send}
              title="Start a conversation"
              aria-label="Start a conversation"
            />
          </form>
          <div className="chat-room-list min-h-0 flex-1 overflow-y-auto">
            {search && !shownRooms.length && !shownPeople.length && <p className="px-4 py-3 text-sm text-[var(--muted)]">Nobody and no room matches that.</p>}
            {shownRooms.map((r) => r.invited ? (
              <div key={r.id} className="flex items-center gap-2 px-4 py-2 text-sm text-[var(--muted)]">
                <Hash className="h-3.5 w-3.5 shrink-0 text-[var(--faint)]" />
                <span className="truncate">{r.name}</span>
                <Button className="ml-auto" onClick={() => void join(r.id)}>
                  Join
                </Button>
              </div>
            ) : (
              <button
                key={r.id}
                onClick={() => selectRoom(r.id)}
                aria-current={r.id === activeRoom ? "true" : undefined}
                data-active={r.id === activeRoom}
                className="chat-room prism-hover flex w-full items-center gap-2 px-4 py-2 text-left text-sm text-[var(--muted)] data-[active=true]:text-[var(--fg)]"
              >
                <Hash className="h-3.5 w-3.5 shrink-0 text-[var(--faint)]" />
                <span className={`truncate ${r.unread > 0 ? "font-medium text-[var(--fg)]" : ""}`}>{r.name}</span>
                <span className="ml-auto flex items-center gap-1.5">
                  {r.level === "off" && <BellOff aria-label="Notifications off" className="h-3.5 w-3.5 text-[var(--faint)]" />}
                  {r.level === "mentions" && <AtSign aria-label="Mentions only" className="h-3.5 w-3.5 text-[var(--faint)]" />}
                  {r.unread > 0 && (
                    <span
                      aria-label={r.mentions > 0 ? `${r.unread} unread, ${r.mentions} mentioning you` : `${r.unread} unread messages`}
                      className={`font-mono text-xs ${r.mentions > 0 ? "text-[var(--accent)]" : ""}`}
                    >
                      {r.mentions > 0 ? `@${r.unread}` : r.unread}
                    </span>
                  )}
                </span>
              </button>
            ))}
            {rooms.length === 0 && (
              <p className="px-4 py-2 text-xs text-[var(--faint)]">No rooms yet.</p>
            )}
            <div className="mt-3 px-4 py-2">
              <Eyebrow icon={Users}>people</Eyebrow>
            </div>
            {shownPeople.map((p) => (
              <button
                key={p.userId}
                onClick={() => void openPerson(p)}
                aria-current={p.roomId && p.roomId === activeRoom ? "true" : undefined}
                data-active={!!p.roomId && p.roomId === activeRoom}
                title={p.userId}
                className="chat-room prism-hover flex w-full items-center gap-2 px-4 py-2 text-left text-sm text-[var(--muted)] data-[active=true]:text-[var(--fg)]"
              >
                <User className="h-3.5 w-3.5 shrink-0 text-[var(--faint)]" />
                <span className={`truncate ${p.unread > 0 || p.invited ? "font-medium text-[var(--fg)]" : ""}`}>{p.name}</span>
                <span className="ml-auto font-mono text-xs">
                  {opening === p.userId
                    ? "opening"
                    : p.invited
                      ? "wants to talk"
                      : p.unread > 0
                        ? <span aria-label={`${p.unread} unread messages`}>{p.unread}</span>
                        : null}
                </span>
              </button>
            ))}
            {people.length === 0 && (
              <p className="px-4 py-2 text-xs text-[var(--faint)]">Nobody else here yet.</p>
            )}
          </div>
          <div className="border-t border-[var(--line)] p-2">
            <button
              onClick={() => { setView(view === "account" ? "chat" : "account"); setConversation(true); }}
              data-active={view === "account"}
              className="prism-hover flex w-full items-center gap-2 rounded-[var(--radius)] px-3 py-2 text-left text-sm text-[var(--muted)] data-[active=true]:text-[var(--fg)]"
            >
              <Settings className="h-3.5 w-3.5 shrink-0 text-[var(--faint)]" />
              <span className="truncate">Chat settings</span>
            </button>
          </div>
        </aside>

        <section ref={sectionRef} className="flex min-w-0 flex-1 flex-col">
          {view === "account" && <div className="chat-back p-3"><Button icon={ArrowLeft} onClick={() => { setConversation(false); setView("chat"); }}>Rooms</Button></div>}
          {view === "account" ? (
            <PageBody width="read">
              <Section label="account" icon={Settings} lede={<span className="font-mono">{client?.getUserId?.() ?? ""}</span>}>
                <p className="text-[13px] leading-relaxed text-[var(--muted)]">
                  This address is yours on your {groupWord}'s chat server. Your passkey is how you get back
                  into it, so there is no password to keep.
                </p>
              </Section>
              <Section label="your name in chat" icon={User}>
                <p className="text-[13px] leading-relaxed text-[var(--muted)]">
                  The name people see beside your messages, here and in any other Matrix app. Your address
                  above stays the same, and so does your sign-in.
                </p>
                <form onSubmit={saveName} className="mt-3 flex items-center gap-2">
                  <input
                    value={myName}
                    onChange={(e) => { setMyName(e.target.value); setNameNote(null); }}
                    maxLength={64}
                    placeholder="Alice"
                    aria-label="Your name in chat"
                    className={`${inputClass} min-w-0 flex-1`}
                  />
                  <Button type="submit" size="md" busy={savingName} disabled={!myName.trim()}>
                    Save
                  </Button>
                </form>
                {nameNote && <Notice tone={nameNote.tone}>{nameNote.text}</Notice>}
              </Section>
              <Section label="notifications" icon={Bell}>
                <p className="text-[13px] leading-relaxed text-[var(--muted)]">
                  Each room has its own setting: all messages, mentions only, or off. Change it from the bell
                  at the top of the room. Your phone and other Matrix apps follow the same setting.
                </p>
                <label className="mt-3 flex items-center gap-2 text-[13px]">
                  <input type="checkbox" checked={alerts} onChange={() => void toggleAlerts()} />
                  Show an alert on this computer when a message arrives
                </label>
                {alertNote && <Notice tone="danger">{alertNote}</Notice>}
              </Section>
              <Section label="already on matrix" icon={Link2}>
                <p className="text-[13px] leading-relaxed text-[var(--muted)]">
                  If you already use Matrix somewhere else, add that address and it gets an invite to
                  the {edition.instance.name} members room too. Accept it in the app you usually use.
                </p>
                <form onSubmit={linkElsewhere} className="mt-3 flex items-center gap-2">
                  <input
                    value={elsewhere}
                    onChange={(e) => setElsewhere(e.target.value)}
                    placeholder="@alice:matrix.org"
                    spellCheck={false}
                    aria-label="Your Matrix address elsewhere"
                    className={`${inputClass} font-mono min-w-0 flex-1`}
                  />
                  <Button type="submit" size="md" icon={Link2} busy={linking} disabled={!MXID.test(elsewhere.trim())}>
                    Send invite
                  </Button>
                </form>
                {linked && <Notice tone="ok">Invite sent to {linked}.</Notice>}
                {linkError && <Notice tone="danger">{linkError}</Notice>}
              </Section>
              {edition.id === "decent" && identity.session && <MyRecordings session={identity.session} />}
              <Section label="this device">
                <Button variant="danger" size="md" icon={LogOut} onClick={signOut}>
                  Sign out of chat
                </Button>
              </Section>
            </PageBody>
          ) : (
            <>
              <div className="chat-room-header">
                <span className="chat-back"><Button icon={ArrowLeft} aria-label="Back to rooms" onClick={() => setConversation(false)} /></span>
                {activeDirect ? <User className="h-4 w-4 text-[var(--faint)]" /> : <Hash className="h-4 w-4 text-[var(--faint)]" />}
                <span className="font-tight min-w-0 flex-1 truncate text-sm font-medium" title={activeDirect ?? undefined}>{activeName || "Group rooms"}</span>
                {activeRoom && (
                  <label className="flex items-center gap-1.5 text-[var(--muted)]" title="Notifications for this room">
                    {roomLevel === "off" ? <BellOff className="h-4 w-4" aria-hidden="true" /> : <Bell className="h-4 w-4" aria-hidden="true" />}
                    <select
                      value={roomLevel}
                      onChange={(e) => void chooseLevel(e.target.value as Level)}
                      aria-label="Notifications for this room"
                      className={`${inputClass} px-2 py-1 text-xs`}
                    >
                      {LEVELS.map((l) => <option key={l.id} value={l.id}>{l.label}</option>)}
                    </select>
                  </label>
                )}
                {call?.roomId !== activeRoom && activeRoom && (
                  <span className="ml-auto flex flex-wrap items-center gap-2">
                    {callers > 0 && (
                      <span className="flex items-center gap-1.5 font-mono text-[11px] text-[var(--muted)]">
                        <Dot tone="live" />
                        {callers} in a call
                      </span>
                    )}
                    {callers > 0 && recording.active && (
                      <span className="flex items-center gap-1.5 font-mono text-[11px] text-[var(--danger)]">
                        <Dot tone="danger" />
                        {autoRecord.on ? "recording" : "recording, you join with your microphone off"}
                      </span>
                    )}
                    <Button icon={Phone} busy={calling} onClick={() => void startCall(false)}>
                      {callers > 0 ? "Join with voice" : activeDirect ? `Call ${activeName}` : "Voice call"}
                    </Button>
                    <Button icon={Video} busy={calling} onClick={() => void startCall(true)}>
                      {callers > 0 ? "Join with video" : "Video call"}
                    </Button>
                  </span>
                )}
              </div>
              {autoRecord.on && activeRoom && !activeDirect && <AutoRecordStrip client={client} roomId={activeRoom} auto={autoRecord} />}
              {call && call.roomId === activeRoom && (
                <CallStage call={call} name={shortSender} onLeave={hangUp} client={client} direct={!!activeDirect} auto={autoRecord} />
              )}
              {call && call.roomId !== activeRoom && (
                <div className="flex items-center gap-2 border-b border-[var(--line)] px-8 py-2 text-[13px] text-[var(--muted)]">
                  <Dot tone="live" />
                  {directs.has(call.roomId) ? `In a call with ${roomName(call.roomId)}.` : `In a call in ${roomName(call.roomId)}.`}
                  <Button variant="quiet" onClick={() => setActiveRoom(call.roomId)}>
                    Go back
                  </Button>
                  <Button variant="quiet" onClick={() => void hangUp()}>
                    Leave
                  </Button>
                </div>
              )}
              <Timeline key={activeRoom} room={activeName} messages={events} />
              {error && (
                <div className="px-8 pb-2">
                  <Notice tone="danger">{error}</Notice>
                </div>
              )}
              <Composer value={draft} onChange={editDraft} onSend={send} name={activeName} people={roomPeople(client, activeRoom)} disabled={!activeRoom} />
            </>
          )}
        </section>
      </div>
    </Page>
  );
}

/** The server part of a Matrix address: @alice:decent.partners → decent.partners */
function serverOf(mxid: string): string {
  return mxid.split(":").slice(1).join(":") || "server";
}

function shortSender(s: string): string {
  return s.replace(/^@/, "").split(":")[0];
}

export const chatPlugin: MurmurPlugin = {
  id: "chat",
  title: "Chat",
  tagline: `Talk to the people in your ${groupWord}`,
  icon: MessageSquare,
  order: 20,
  kind: "plugin",
  support: issues("chat"),
  backend: "Matrix homeserver",
  Panel,
};
