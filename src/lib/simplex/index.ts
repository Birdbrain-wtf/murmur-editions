/**
 * Private chats (inside the Chat plugin, src/plugins/chat/private.tsx) over SimpleX,
 * on the collective's own relay.
 *
 * The SimpleX chat core runs on this computer (src-tauri/src/simplex.rs): off by
 * default, fetched from the collective's own host and checked against its release
 * key when the member switches it on. The page talks to it over its loopback
 * WebSocket with `SimpleXClient` (a copy of lab/simplex-comms/client/).
 *
 * Messages are end-to-end encrypted between the two members' cores. The relay
 * passes sealed envelopes and holds no identities. Nothing here is ever sent to a
 * world model: the only thing that leaves this computer besides the messages is
 * the invite record (who invited whom, never what was said).
 */
import { useEffect, useState } from "react";
import { SimpleXClient } from "./simplexClient";

const isTauri = typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
export const hasSimplex = isTauri;

export interface SimplexStatus {
  enabled: boolean;
  phase: "off" | "fetching" | "starting" | "ready" | "error";
  version?: string | null;
  /** false when this build has no queue password for the relay: no inviting or joining */
  canConnect: boolean;
  relayHost: string;
  fetchedBytes?: number | null;
  fetchTotal?: number | null;
  error?: string | null;
}

async function invoke<T>(cmd: string, args: Record<string, unknown> = {}): Promise<T> {
  const { invoke } = await import("@tauri-apps/api/core");
  return invoke<T>(cmd, args);
}

export async function simplexStatus(): Promise<SimplexStatus | null> {
  if (!isTauri) return null;
  return invoke<SimplexStatus>("simplex_status");
}

export async function setSimplexEnabled(enabled: boolean, name?: string | null): Promise<SimplexStatus> {
  return invoke<SimplexStatus>("simplex_set_enabled", { enabled, name: name ?? null });
}

export async function removeSimplex(): Promise<SimplexStatus> {
  return invoke<SimplexStatus>("simplex_remove");
}

export async function simplexWs(): Promise<string | null> {
  if (!isTauri) return null;
  return invoke<string | null>("simplex_ws");
}

export function useSimplex(everyMs = 2000): SimplexStatus | null {
  const [s, setS] = useState<SimplexStatus | null>(null);
  useEffect(() => {
    let live = true;
    const tick = () => simplexStatus().then((v) => live && setS(v)).catch(() => {});
    tick();
    if (!isTauri) return () => { live = false; };
    const t = setInterval(tick, everyMs);
    return () => { live = false; clearInterval(t); };
  }, [everyMs]);
  return s;
}

/**
 * A fetch for `httpInviteSink` that posts through the app (Rust), because
 * /api/murmur/invite sends no CORS headers and the window's own fetch would be
 * refused. Rust allows the collective's own hosts only.
 */
export const appFetch: typeof fetch = async (input, init) => {
  const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url);
  if (url.pathname !== "/api/murmur/invite") throw new Error("private messages post only invites");
  const body = typeof init?.body === "string" ? JSON.parse(init.body) : null;
  const r = await invoke<{ status: number; body: unknown }>("simplex_invite_post", { base: url.origin, body });
  return new Response(JSON.stringify(r.body ?? {}), { status: r.status, headers: { "content-type": "application/json" } });
};

// ── the core's commands, over its WebSocket (checked against simplex-chat 6.5.4.1) ──

export interface Contact {
  id: number;
  /** the SimpleX profile name the other side chose; the Decent hello names them properly */
  name: string;
  /** the connection the contact came in on, to match it to an invite this side made */
  connId: string | null;
}

export interface Item {
  id: number;
  contactId: number;
  mine: boolean;
  text: string;
  at: string;
}

function fail(resp: any): never {
  const e = resp?.chatError ?? resp;
  const detail = e?.errorType?.message ?? e?.storeError?.type ?? e?.agentError?.type ?? e?.errorType?.type ?? e?.type ?? "unknown";
  throw new Error(`private messages said no: ${detail}`);
}

function ok(resp: any, type: string): any {
  if (resp?.type !== type) fail(resp);
  return resp;
}

export function contactOf(c: any): Contact {
  return {
    id: Number(c?.contactId),
    name: c?.profile?.displayName ?? c?.localDisplayName ?? "someone",
    connId: c?.activeConn?.agentConnId ?? null,
  };
}

/** One chat item, or null for the core's own notices (features, receipts). */
export function itemOf(contactId: number, ci: any): Item | null {
  const text = ci?.content?.msgContent?.text;
  const dir = ci?.chatDir?.type;
  if (typeof text !== "string" || (dir !== "directSnd" && dir !== "directRcv")) return null;
  return { id: Number(ci?.meta?.itemId), contactId, mine: dir === "directSnd", text, at: ci?.meta?.itemTs ?? "" };
}

/** The new items in an event from the core, if it carries any. */
export function itemsOf(resp: any): Item[] {
  if (resp?.type !== "newChatItems") return [];
  const out: Item[] = [];
  for (const x of resp.chatItems ?? []) {
    if (x?.chatInfo?.type !== "direct") continue;
    const it = itemOf(Number(x.chatInfo.contact?.contactId), x.chatItem);
    if (it) out.push(it);
  }
  return out;
}

export class Chat {
  private uid: number | null = null;
  constructor(readonly client: SimpleXClient) {}

  static async open(url: string): Promise<Chat> {
    const client = new SimpleXClient(url);
    await client.connect();
    return new Chat(client);
  }

  close() {
    this.client.close();
  }

  private async userId(): Promise<number> {
    if (this.uid == null) this.uid = Number(ok(await this.client.send("/user"), "activeUser").user.userId);
    return this.uid;
  }

  /** A one-time invitation link and the connection it will arrive on. */
  async invite(): Promise<{ link: string; connId: string }> {
    const r = ok(await this.client.send(`/_connect ${await this.userId()}`, 30000), "invitation");
    const link = r.connLinkInvitation?.connFullLink;
    if (typeof link !== "string") throw new Error("private messages made no link");
    return { link, connId: r.connection?.pccAgentConnId ?? "" };
  }

  /** Join with someone's link. Returns the connection they will arrive on. */
  async join(link: string): Promise<string> {
    const r = await this.client.send(`/_connect ${await this.userId()} ${link.trim()}`, 30000);
    if (r?.type !== "sentConfirmation" && r?.type !== "sentInvitation") fail(r);
    return r.connection?.pccAgentConnId ?? "";
  }

  async contacts(): Promise<Contact[]> {
    const r = ok(await this.client.send(`/_contacts ${await this.userId()}`), "contactsList");
    return (r.contacts ?? []).map(contactOf).filter((c: Contact) => Number.isFinite(c.id));
  }

  async history(contactId: number, count = 100): Promise<Item[]> {
    const r = ok(await this.client.send(`/_get chat @${contactId} count=${count}`), "apiChat");
    return (r.chat?.chatItems ?? []).map((ci: any) => itemOf(contactId, ci)).filter(Boolean) as Item[];
  }

  async send(contactId: number, text: string): Promise<void> {
    const body = JSON.stringify([{ msgContent: { type: "text", text } }]);
    ok(await this.client.send(`/_send @${contactId} json ${body}`), "newChatItems");
  }
}
