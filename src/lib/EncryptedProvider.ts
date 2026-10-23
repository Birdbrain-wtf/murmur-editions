import * as Y from "yjs";
import * as awarenessProtocol from "y-protocols/awareness";
import { encryptBytes, decryptBytes } from "./collab";

/**
 * EncryptedProvider — end-to-end encrypted transport for one shared Yjs doc.
 *
 * Replaces y-websocket's WebsocketProvider. y-websocket speaks the Yjs *sync
 * protocol*, which requires the server to hold a plaintext Y.Doc to merge
 * updates — incompatible with E2E. Here the server is a *blind relay*: it only
 * routes + stores opaque ciphertext. Every Yjs update and awareness update is
 * AES-GCM encrypted client-side with a key derived from the room name (the
 * shared secret), so the relay never sees content.
 *
 * Wire (binary, first byte = type):
 *   0 UPDATE     incremental doc update — broadcast to peers (live typing)
 *   1 AWARENESS  cursor/presence — broadcast to peers, never stored
 *   2 SNAPSHOT   full-state snapshot — relay stores (debounced) for late joiners
 * On connect the relay replays its stored snapshot (as an UPDATE) so a newcomer
 * who arrives while everyone else is offline still gets the note.
 */

const MSG_UPDATE = 0;
const MSG_AWARENESS = 1;
const MSG_SNAPSHOT = 2;

const SNAPSHOT_DEBOUNCE = 1200;
const RECONNECT_DELAY = 2000;

type StatusHandler = (e: { status: "connecting" | "connected" | "disconnected" }) => void;

export class EncryptedProvider {
  readonly ydoc: Y.Doc;
  readonly awareness: awarenessProtocol.Awareness;
  private readonly url: string;
  private readonly key: CryptoKey;
  private ws: WebSocket | null = null;
  private shouldConnect = true;
  private statusHandlers = new Set<StatusHandler>();
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private snapshotTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(
    baseUrl: string,
    roomId: string,
    ydoc: Y.Doc,
    key: CryptoKey,
    awareness: awarenessProtocol.Awareness,
  ) {
    this.ydoc = ydoc;
    this.awareness = awareness;
    this.key = key;
    this.url = `${baseUrl.replace(/\/+$/, "")}/${roomId}`;

    ydoc.on("update", this.onDocUpdate);
    awareness.on("update", this.onAwarenessUpdate);
    this.connect();
  }

  on(event: "status", fn: StatusHandler) {
    if (event === "status") this.statusHandlers.add(fn);
  }
  off(event: "status", fn: StatusHandler) {
    if (event === "status") this.statusHandlers.delete(fn);
  }
  private emitStatus(status: "connecting" | "connected" | "disconnected") {
    for (const h of this.statusHandlers) h({ status });
  }

  private connect() {
    if (!this.shouldConnect) return;
    this.emitStatus("connecting");
    const ws = new WebSocket(this.url);
    ws.binaryType = "arraybuffer";
    this.ws = ws;

    ws.onopen = () => {
      this.emitStatus("connected");
      // push our full state so peers + the relay learn what we have
      const state = Y.encodeStateAsUpdate(this.ydoc);
      void this.send(MSG_UPDATE, state);
      void this.send(MSG_SNAPSHOT, state);
      if (this.awareness.getLocalState()) {
        const aw = awarenessProtocol.encodeAwarenessUpdate(this.awareness, [
          this.awareness.clientID,
        ]);
        void this.send(MSG_AWARENESS, aw);
      }
    };

    ws.onmessage = (ev: MessageEvent) => {
      void this.onMessage(new Uint8Array(ev.data as ArrayBuffer));
    };

    ws.onclose = () => {
      if (this.ws === ws) this.ws = null;
      this.emitStatus("disconnected");
      if (this.shouldConnect && !this.reconnectTimer) {
        this.reconnectTimer = setTimeout(() => {
          this.reconnectTimer = null;
          this.connect();
        }, RECONNECT_DELAY);
      }
    };

    ws.onerror = () => ws.close();
  }

  private async send(type: number, bytes: Uint8Array) {
    const ws = this.ws;
    if (!ws || ws.readyState !== WebSocket.OPEN) return;
    const blob = await encryptBytes(this.key, bytes);
    const framed = new Uint8Array(1 + blob.length);
    framed[0] = type;
    framed.set(blob, 1);
    if (ws.readyState === WebSocket.OPEN) ws.send(framed);
  }

  private onDocUpdate = (update: Uint8Array, origin: unknown) => {
    if (origin === this) return; // came from the network — don't echo
    void this.send(MSG_UPDATE, update);
    this.scheduleSnapshot();
  };

  private onAwarenessUpdate = (
    changes: { added: number[]; updated: number[]; removed: number[] },
    origin: unknown,
  ) => {
    if (origin === this) return;
    const changed = changes.added.concat(changes.updated, changes.removed);
    const aw = awarenessProtocol.encodeAwarenessUpdate(this.awareness, changed);
    void this.send(MSG_AWARENESS, aw);
  };

  private scheduleSnapshot() {
    if (this.snapshotTimer) clearTimeout(this.snapshotTimer);
    this.snapshotTimer = setTimeout(() => {
      this.snapshotTimer = null;
      void this.send(MSG_SNAPSHOT, Y.encodeStateAsUpdate(this.ydoc));
    }, SNAPSHOT_DEBOUNCE);
  }

  private async onMessage(framed: Uint8Array) {
    if (framed.length < 1) return;
    const type = framed[0];
    let plain: Uint8Array;
    try {
      plain = await decryptBytes(this.key, framed.subarray(1));
    } catch {
      return; // wrong key or corrupt — not ours to read
    }
    if (type === MSG_UPDATE || type === MSG_SNAPSHOT) {
      Y.applyUpdate(this.ydoc, plain, this);
    } else if (type === MSG_AWARENESS) {
      awarenessProtocol.applyAwarenessUpdate(this.awareness, plain, this);
    }
  }

  destroy() {
    this.shouldConnect = false;
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    if (this.snapshotTimer) clearTimeout(this.snapshotTimer);
    this.ydoc.off("update", this.onDocUpdate);
    this.awareness.off("update", this.onAwarenessUpdate);
    // best-effort: tell peers our cursor is gone
    const ws = this.ws;
    if (ws && ws.readyState === WebSocket.OPEN) {
      awarenessProtocol.removeAwarenessStates(
        this.awareness,
        [this.awareness.clientID],
        "destroy",
      );
      const aw = awarenessProtocol.encodeAwarenessUpdate(this.awareness, [
        this.awareness.clientID,
      ]);
      void this.send(MSG_AWARENESS, aw).finally(() => ws.close());
    } else {
      ws?.close();
    }
  }
}
