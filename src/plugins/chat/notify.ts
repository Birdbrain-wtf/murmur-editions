/**
 * Unread, read and notifications for group rooms and one-to-one chats.
 *
 * Read: opening a room (with the window in front) sends a read receipt for its
 * last message, so the unread count clears here and in every other Matrix app the
 * member uses. Before 2026-10-20 the app never sent one, so counts only cleared
 * when the same messages were read in Element.
 *
 * Levels: each room is All messages, Mentions only or Off. They are the member's
 * own Matrix push rules, the same ones Element writes, so the server's unread
 * counts, this app's alerts and the member's phone all follow one setting:
 * - all: no rule for the room
 * - mentions: a room rule with no actions (only @-mentions and keywords count)
 * - off: an override rule on the room with no actions (nothing counts)
 *
 * Alerts: an on/off switch for this device, kept in localStorage. When it is on, a
 * message the push rules say should notify shows a desktop alert, unless the member
 * is already looking at that room.
 */

export type Level = "all" | "mentions" | "off";

export const LEVELS: { id: Level; label: string }[] = [
  { id: "all", label: "All messages" },
  { id: "mentions", label: "Mentions only" },
  { id: "off", label: "Off" },
];

const ALERTS_KEY = "murmur.chat.alerts.v1";
const isTauri = typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

/** Whether this window is the one the member is looking at. */
export function looking(): boolean {
  return document.visibilityState === "visible" && document.hasFocus();
}

/** Mark everything in the room as read, up to its last message. */
export async function markRead(client: any, roomId: string): Promise<void> {
  const room = client?.getRoom?.(roomId);
  if (!room) return;
  const last = room.getLiveTimeline().getEvents().filter((ev: any) => !!ev.getId() && !ev.getId().startsWith("~")).at(-1);
  if (!last) return;
  const me = client.getUserId();
  if (room.hasUserReadEvent?.(me, last.getId()) && !room.getUnreadNotificationCount?.()) return;
  try {
    await client.setRoomReadMarkers(roomId, last.getId(), last);
  } catch {
    // A failed receipt only means the count stays until the next try.
    return;
  }
  room.setUnreadNotificationCount?.("total", 0);
  room.setUnreadNotificationCount?.("highlight", 0);
}

function rules(client: any): any {
  return client?.pushRules?.global ?? {};
}

/** The member's level for this room, read from their push rules. */
export function levelOf(client: any, roomId: string): Level {
  const g = rules(client);
  const silent = (r: any) => r?.enabled !== false && !(r?.actions ?? []).includes("notify");
  if ((g.override ?? []).some((r: any) => r.rule_id === roomId && silent(r))) return "off";
  if ((g.room ?? []).some((r: any) => r.rule_id === roomId && silent(r))) return "mentions";
  return "all";
}

/** Set the room's level: clears whatever rule it had, then writes the new one. */
export async function setLevel(client: any, roomId: string, level: Level): Promise<void> {
  const g = rules(client);
  if ((g.override ?? []).some((r: any) => r.rule_id === roomId)) await client.deletePushRule("global", "override", roomId);
  if ((g.room ?? []).some((r: any) => r.rule_id === roomId)) await client.deletePushRule("global", "room", roomId);
  if (level === "mentions") await client.addPushRule("global", "room", roomId, { actions: [] });
  if (level === "off") {
    await client.addPushRule("global", "override", roomId, {
      actions: [],
      conditions: [{ kind: "event_match", key: "room_id", pattern: roomId }],
    });
  }
  // The server sends the new rules back on the next sync. Read them now so the
  // control does not flick back in the meantime.
  client.pushRules = await client.getPushRules().catch(() => client.pushRules);
}

export function alertsOn(): boolean {
  return localStorage.getItem(ALERTS_KEY) === "on";
}

/** Turn alerts on (asking the system for permission) or off. Returns the new state. */
export async function setAlerts(on: boolean): Promise<boolean> {
  if (on && !(await permission())) {
    localStorage.removeItem(ALERTS_KEY);
    return false;
  }
  if (on) localStorage.setItem(ALERTS_KEY, "on");
  else localStorage.removeItem(ALERTS_KEY);
  return on;
}

async function permission(): Promise<boolean> {
  if (isTauri) {
    const n = await import("@tauri-apps/plugin-notification");
    if (await n.isPermissionGranted()) return true;
    return (await n.requestPermission()) === "granted";
  }
  if (typeof Notification === "undefined") return false;
  if (Notification.permission === "granted") return true;
  return (await Notification.requestPermission()) === "granted";
}

export async function alert(title: string, body: string): Promise<void> {
  try {
    if (isTauri) {
      const n = await import("@tauri-apps/plugin-notification");
      n.sendNotification({ title, body });
    } else if (typeof Notification !== "undefined" && Notification.permission === "granted") {
      new Notification(title, { body });
    }
  } catch {
    /* an alert that cannot show is not worth an error on screen */
  }
}

/**
 * Should this live event alert the member? Their push rules decide, the same as
 * on their phone: Off rooms never do, Mentions only rooms only for a mention.
 */
export function shouldAlert(client: any, ev: any, activeRoom: string | null): boolean {
  if (!alertsOn()) return false;
  if (ev.getType?.() !== "m.room.message" || ev.getSender?.() === client.getUserId()) return false;
  if (ev.getRoomId?.() === activeRoom && looking()) return false;
  return !!client.getPushActionsForEvent?.(ev)?.notify;
}
