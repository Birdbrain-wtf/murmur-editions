import { useEffect, useState } from "react";
import { edition } from "../../edition";

/**
 * People in Chat: everyone this account shares a room with, so a member can
 * message or call someone without knowing their Matrix address. Everyone in a
 * collective is seated in its members room, so that room alone gives the whole
 * list. A person's one-to-one room is found from the account's `m.direct` list
 * (which other Matrix apps keep too) or from the `is_direct` flag on an invite,
 * and made the first time someone messages or calls them.
 *
 * Calls ring: starting a call in a one-to-one room sends a call notification
 * (MSC4075, the event Element X rings on), and the other side's Chat shows
 * "Alice is calling" with Answer and Decline while the caller is still there.
 */

export const CALL_NOTIFY = "org.matrix.msc4075.call.notify";
const RING_FOR_MS = 45_000;

export interface Person {
  userId: string;
  name: string;
  /** their one-to-one room with this account, if there is one */
  roomId: string | null;
  unread: number;
  /** they opened a one-to-one room with us and we have not accepted yet */
  invited: boolean;
}

export interface Ring {
  roomId: string;
  from: string;
  name: string;
  video: boolean;
  at: number;
}

/** Accounts that are machinery, not people. Members themselves are `@decent_alice`, so match exactly. */
function isMachine(userId: string): boolean {
  return !!edition.callRecorder && userId === edition.callRecorder;
}

/** Matrix room id → the person it is a one-to-one with, for this account. */
export function directRooms(client: any): Map<string, string> {
  const out = new Map<string, string>();
  if (!client) return out;
  const me = client.getUserId();
  const direct = client.getAccountData?.("m.direct")?.getContent?.() ?? {};
  for (const [userId, ids] of Object.entries(direct)) {
    for (const id of (ids as string[]) ?? []) {
      const room = client.getRoom(id);
      const mine = room?.getMyMembership?.();
      if (mine === "join" || mine === "invite") out.set(id, userId);
    }
  }
  for (const room of client.getRooms()) {
    if (out.has(room.roomId)) continue;
    if (room.getMyMembership?.() !== "invite") continue;
    const ev = room.currentState?.getStateEvents?.("m.room.member", me);
    if (ev?.getContent?.()?.is_direct) out.set(room.roomId, ev.getSender());
  }
  return out;
}

export function listPeople(client: any): Person[] {
  if (!client) return [];
  const me = client.getUserId();
  const dms = directRooms(client);
  const byUser = new Map<string, Person>();
  for (const [roomId, userId] of dms) {
    const room = client.getRoom(roomId);
    const invited = room?.getMyMembership?.() === "invite";
    const prev = byUser.get(userId);
    // Prefer a room we are in over one we are only invited to.
    if (prev?.roomId && !prev.invited) continue;
    byUser.set(userId, {
      userId,
      name: room?.getMember?.(userId)?.name || prev?.name || userId,
      roomId,
      unread: room?.getUnreadNotificationCount?.() ?? 0,
      invited,
    });
  }
  for (const room of client.getRooms()) {
    if (room.getMyMembership?.() !== "join" || dms.has(room.roomId)) continue;
    for (const m of room.getJoinedMembers?.() ?? []) {
      if (m.userId === me || isMachine(m.userId) || byUser.has(m.userId)) continue;
      byUser.set(m.userId, { userId: m.userId, name: m.name || m.userId, roomId: null, unread: 0, invited: false });
    }
  }
  return [...byUser.values()]
    .filter((p) => !isMachine(p.userId))
    .sort((a, b) => Number(b.invited) - Number(a.invited) || a.name.localeCompare(b.name));
}

/** The one-to-one room with this person, made (and filed in `m.direct`) if there is none. */
export async function openDirect(client: any, userId: string): Promise<string> {
  const existing = [...directRooms(client)].find(([id, u]) => u === userId && client.getRoom(id)?.getMyMembership?.() === "join");
  if (existing) return existing[0];
  const invitedTo = [...directRooms(client)].find(([, u]) => u === userId);
  if (invitedTo) {
    await acceptDirect(client, invitedTo[0], userId);
    return invitedTo[0];
  }
  const { room_id } = await client.createRoom({ is_direct: true, invite: [userId], preset: "trusted_private_chat" });
  await remember(client, userId, room_id);
  await loaded(client, room_id);
  return room_id;
}

/** Join a one-to-one room someone opened with us, and file it as theirs. */
export async function acceptDirect(client: any, roomId: string, userId: string): Promise<void> {
  await client.joinRoom(roomId);
  await remember(client, userId, roomId);
}

async function remember(client: any, userId: string, roomId: string) {
  const direct = { ...(client.getAccountData?.("m.direct")?.getContent?.() ?? {}) };
  direct[userId] = [...new Set([...(direct[userId] ?? []), roomId])];
  await client.setAccountData("m.direct", direct).catch(() => {});
}

/** A room we just made reaches the client on the next sync; calls need it there. */
export async function loaded(client: any, roomId: string, ms = 8000): Promise<void> {
  const until = Date.now() + ms;
  while (!client.getRoom(roomId) && Date.now() < until) await new Promise((r) => setTimeout(r, 200));
}

/** Ring the other person in a one-to-one room. */
export async function ring(client: any, roomId: string, video: boolean): Promise<void> {
  await client
    .sendEvent(roomId, CALL_NOTIFY, {
      application: "m.call",
      call_id: "",
      notify_type: "ring",
      "m.mentions": { user_ids: [], room: true },
      "partners.decent.video": video,
    })
    .catch(() => {});
}

/** Calls ringing for this account right now, from any one-to-one room. */
export function useRings(client: any, sdk: any): [Ring | null, (roomId: string) => void] {
  const [rings, setRings] = useState<Ring[]>([]);
  useEffect(() => {
    if (!client || !sdk) return;
    const me = client.getUserId();
    const onTl = (ev: any, room: any, toStart: boolean) => {
      if (toStart || ev.getType?.() !== CALL_NOTIFY || ev.getSender?.() === me) return;
      if (Date.now() - ev.getTs() > RING_FOR_MS) return;
      if (!directRooms(client).has(room?.roomId)) return;
      const c = ev.getContent?.() ?? {};
      const next: Ring = {
        roomId: room.roomId,
        from: ev.getSender(),
        name: room.getMember?.(ev.getSender())?.name || ev.getSender(),
        video: !!c["partners.decent.video"],
        at: ev.getTs(),
      };
      setRings((prev) => [...prev.filter((r) => r.roomId !== next.roomId), next]);
    };
    client.on(sdk.RoomEvent.Timeline, onTl);
    const t = setInterval(() => {
      // Stop ringing when it is old or the caller has left the call.
      setRings((prev) =>
        prev.filter((r) => {
          if (Date.now() - r.at > RING_FOR_MS) return false;
          const room = client.getRoom(r.roomId);
          const rtc = room && client.matrixRTC?.getRoomSession(room);
          return !rtc || rtc.memberships.some((m: any) => !m.isExpired() && m.sender === r.from) || Date.now() - r.at < 5000;
        }),
      );
    }, 2000);
    return () => {
      client.off(sdk.RoomEvent.Timeline, onTl);
      clearInterval(t);
    };
  }, [client, sdk]);
  const dismiss = (roomId: string) => setRings((prev) => prev.filter((r) => r.roomId !== roomId));
  return [rings[rings.length - 1] ?? null, dismiss];
}
