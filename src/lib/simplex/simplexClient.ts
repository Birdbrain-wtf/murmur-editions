// Copy of lab/simplex-comms/client/simplexClient.ts, which stays the source of
// truth (it is the client the headless proofs there run). Change it there first,
// then copy it here. Unchanged apart from this header.

/**
 * SimpleXClient — reference WebSocket client for the SimpleX chat core.
 *
 * This is the seam for wiring SimpleX into the Decent (murmur) `chat` plugin as a
 * sovereign backend alongside Matrix. It is browser/Tauri-friendly: it uses the
 * global `WebSocket`, which exists in the Tauri webview. In the desktop app the
 * `simplex-chat` core runs as a **Tauri sidecar** (a bundled binary) exposing its
 * WebSocket API on a localhost port; this client connects to it.
 *
 * It is NOT wired into the live app — it's a tested reference (the same protocol
 * proven by ../scripts/demo.ts) so the chat-plugin integration is a known path.
 *
 * Protocol: send {corrId, cmd}; receive {corrId, resp} for replies and
 * {resp} (no corrId) for async events.
 */

export interface SimpleXMessage {
  /** contact display name the message is from/to */
  contact: string;
  text: string;
  ts: number;
  mine: boolean;
}

type EventHandler = (resp: any) => void;

export class SimpleXClient {
  private ws: WebSocket | null = null;
  private corr = 0;
  private pending = new Map<string, (resp: any) => void>();
  private handlers = new Set<EventHandler>();

  constructor(private wsUrl = "ws://localhost:5225") {}

  async connect(): Promise<void> {
    const ws = new WebSocket(this.wsUrl);
    await new Promise<void>((resolve, reject) => {
      ws.onopen = () => resolve();
      ws.onerror = () => reject(new Error("simplex core ws connect failed"));
    });
    ws.onmessage = (ev) => this.onMessage(String(ev.data));
    this.ws = ws;
  }

  private onMessage(raw: string) {
    let msg: any;
    try {
      msg = JSON.parse(raw);
    } catch {
      return;
    }
    if (msg.corrId && this.pending.has(msg.corrId)) {
      this.pending.get(msg.corrId)!(msg.resp);
      this.pending.delete(msg.corrId);
      return;
    }
    const resp = msg.resp ?? msg;
    for (const h of this.handlers) h(resp);
  }

  /** Low-level: send a raw chat command, await its correlated reply. */
  send(cmd: string, timeoutMs = 15000): Promise<any> {
    if (!this.ws) throw new Error("not connected");
    const corrId = String(++this.corr);
    return new Promise((resolve, reject) => {
      const t = setTimeout(() => reject(new Error(`timeout: ${cmd}`)), timeoutMs);
      this.pending.set(corrId, (r) => {
        clearTimeout(t);
        resolve(r);
      });
      this.ws!.send(JSON.stringify({ corrId, cmd }));
    });
  }

  /** Subscribe to async events (incoming messages, contactConnected, …). */
  onEvent(h: EventHandler): () => void {
    this.handlers.add(h);
    return () => this.handlers.delete(h);
  }

  /**
   * Create a one-time invitation link. This IS the invite-graph edge: hand the
   * returned link to one person; when they connect, record (inviter, invitee)
   * against passkey identities in data/invite-graph.jsonl.
   */
  async createInvitation(): Promise<string> {
    const resp = await this.send("/connect");
    const link = JSON.stringify(resp).match(/simplex:\/[^"\\]*/i)?.[0];
    if (!link) throw new Error("no invitation link in response");
    return link;
  }

  /** Connect to a contact using an invitation link you received. */
  async connectViaLink(link: string): Promise<void> {
    await this.send(`/connect ${link}`);
  }

  /** Send a text message to a contact by display name. */
  async sendMessage(contact: string, text: string): Promise<void> {
    await this.send(`@${contact} ${text}`);
  }

  /** Convenience: subscribe to incoming messages as typed objects. */
  onMessageReceived(cb: (m: SimpleXMessage) => void): () => void {
    return this.onEvent((resp) => {
      if (resp?.type !== "newChatItems" && resp?.type !== "chatItemReceived") return;
      const items = resp.chatItems ?? (resp.chatItem ? [resp.chatItem] : []);
      for (const ci of items) {
        const content = ci?.chatItem?.content ?? ci?.content;
        const text = content?.msgContent?.text;
        const dir = ci?.chatItem?.chatDir ?? ci?.chatDir;
        const contact =
          ci?.chatInfo?.contact?.localDisplayName ??
          resp?.chatInfo?.contact?.localDisplayName ??
          "unknown";
        if (typeof text === "string") {
          cb({
            contact,
            text,
            ts: Date.now(),
            mine: dir?.type === "directSnd",
          });
        }
      }
    });
  }

  close() {
    try {
      this.ws?.close();
    } catch {
      /* ignore */
    }
    this.ws = null;
  }
}
