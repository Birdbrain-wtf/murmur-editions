import { edition } from "../../edition";

/**
 * Mentions: typing @ in a room offers the people in it, and a sent message names
 * them the way every Matrix app reads (a matrix.to link in the formatted body and
 * `m.mentions`), so Element X and the room agents notify the person too. A message
 * from another app that mentions someone is read back the same way.
 */

export interface Mention {
  userId: string;
  name: string;
}

const MATRIX_TO = "https://matrix.to/#/";

/** The bridge account the door uses to seat people. It never speaks, so it is not offered. */
const isPlumbing = (userId: string) =>
  /^@decent_appservice:/.test(userId) || (!!edition.callRecorder && userId === edition.callRecorder);

/** Everyone in the room who can be mentioned, this account left out. */
export function roomPeople(client: any, roomId: string | null): Mention[] {
  const room = roomId ? client?.getRoom?.(roomId) : null;
  if (!room) return [];
  const me = client.getUserId();
  return (room.getJoinedMembers?.() ?? [])
    .filter((m: any) => m.userId !== me && !isPlumbing(m.userId))
    .map((m: any) => ({ userId: m.userId, name: m.name || localpart(m.userId) }))
    .sort((a: Mention, b: Mention) => a.name.localeCompare(b.name));
}

export function localpart(userId: string): string {
  return userId.replace(/^@/, "").split(":")[0];
}

/** The people a message names, longest name first so "Jamie Jessett" wins over "Jamie". */
export function mentionedIn(body: string, people: Mention[]): Mention[] {
  let rest = body;
  const out: Mention[] = [];
  for (const p of [...people].sort((a, b) => b.name.length - a.name.length)) {
    if (!rest.includes(`@${p.name}`)) continue;
    out.push(p);
    rest = rest.split(`@${p.name}`).join(" ");
  }
  return out;
}

const escape = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/** The content of a message, with anyone named in it mentioned properly. */
export function messageContent(body: string, people: Mention[]): Record<string, unknown> {
  const named = mentionedIn(body, people);
  const content: Record<string, unknown> = { msgtype: "m.text", body, "m.mentions": { user_ids: named.map((p) => p.userId) } };
  if (!named.length) return content;
  let html = escape(body);
  for (const p of named) {
    const link = `<a href="${MATRIX_TO}${escape(p.userId)}">${escape(p.name)}</a>`;
    html = html.split(escape(`@${p.name}`)).join(link);
  }
  content.format = "org.matrix.custom.html";
  content.formatted_body = html.replace(/\n/g, "<br>");
  return content;
}

/** Who a received message mentions, whichever app sent it. */
export function readMentions(content: any, room: any): Mention[] {
  const ids = new Set<string>(content?.["m.mentions"]?.user_ids ?? []);
  const html: string = content?.formatted_body ?? "";
  for (const m of html.matchAll(/href="https:\/\/matrix\.to\/#\/(@[^"/?]+)/g)) ids.add(decodeURIComponent(m[1]));
  return [...ids].map((userId) => ({ userId, name: room?.getMember?.(userId)?.name || localpart(userId) }));
}

/** The @word being typed just before the cursor, if any. */
export function typingMention(text: string, cursor: number): { start: number; query: string } | null {
  const m = /(^|\s)@([^\s@]{0,30})$/.exec(text.slice(0, cursor));
  return m ? { start: cursor - m[2].length - 1, query: m[2].toLowerCase() } : null;
}
