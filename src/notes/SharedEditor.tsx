import { useEffect, useRef, useState } from "react";
import * as Y from "yjs";
import { IndexeddbPersistence } from "y-indexeddb";
import { Awareness } from "y-protocols/awareness";
import { EditorState } from "@codemirror/state";
import { EditorView, keymap } from "@codemirror/view";
import { defaultKeymap } from "@codemirror/commands";
import { markdown } from "@codemirror/lang-markdown";
import { yCollab, yUndoManagerKeymap } from "y-codemirror.next";
import { Users, Save, Check } from "lucide-react";
import { collabServerUrl, peerColor, deriveRoomKey, roomIdFor } from "../lib/collab";
import { EncryptedProvider } from "../lib/EncryptedProvider";
import { captureNote } from "../lib/sensemaking";
import { edition } from "../edition";
import { Button, Status } from "../ui";

type Status = "connecting" | "connected" | "offline";

/**
 * SharedEditor — a single shared note, edited live by everyone in the room.
 *
 * One Yjs document (`Y.Text("body")`) bound to a CodeMirror editor through the
 * y-collab relay. Edits merge at the keystroke level (CRDT), so two independent
 * Decent clients on the same room key see each other type in real time, with
 * live remote cursors. "Save to vault" snapshots the current text into
 * core/vault via the same /api/sensemaking pipeline the personal notes use, so
 * a shared note becomes a first-class, recallable note (and Obsidian-readable).
 */
export default function SharedEditor({
  room,
  base,
  displayName,
}: {
  room: string;
  base: string;
  displayName: string;
}) {
  const host = useRef<HTMLDivElement>(null);
  const docRef = useRef<Y.Doc | null>(null);
  const [status, setStatus] = useState<Status>("connecting");
  const [peers, setPeers] = useState(1);
  const [saved, setSaved] = useState<null | "saving" | "done" | "error">(null);

  useEffect(() => {
    let cancelled = false;
    const ydoc = new Y.Doc();
    docRef.current = ydoc;
    const ytext = ydoc.getText("body");
    const awareness = new Awareness(ydoc);

    const color = peerColor(displayName);
    awareness.setLocalStateField("user", { name: displayName, color });

    // Rung 1 — local sovereignty: every client holds a full replica on its own
    // machine, so the note works offline and survives the relay vanishing.
    const idb = new IndexeddbPersistence(`decent-shared-${room}`, ydoc);

    const onAwareness = () => setPeers(awareness.getStates().size);
    awareness.on("change", onAwareness);
    onAwareness();

    const undoManager = new Y.UndoManager(ytext);
    const view = new EditorView({
      parent: host.current!,
      state: EditorState.create({
        doc: ytext.toString(),
        extensions: [
          keymap.of([...yUndoManagerKeymap, ...defaultKeymap]),
          markdown(),
          EditorView.lineWrapping,
          yCollab(ytext, awareness, { undoManager }),
          EditorView.theme({
            "&": { height: "100%", fontSize: "15px" },
            "&.cm-focused": { outline: "none" },
            ".cm-content": {
              fontFamily: "var(--font-sans, Inter, system-ui)",
              padding: "16px 0",
              lineHeight: "1.6",
            },
            ".cm-line": { padding: "0" },
            ".cm-scroller": { overflow: "auto" },
          }),
        ],
      }),
    });

    // a doc that never connects (no relay reachable) → mark offline so the UI is honest
    const offlineTimer = setTimeout(
      () => setStatus((s) => (s === "connected" ? s : "offline")),
      4000,
    );

    // Rung 2 — E2E: the room name is the shared secret. Derive the AES key and a
    // routing id (a hash of the name) before connecting, so the relay only ever
    // sees ciphertext addressed to an opaque room.
    let provider: EncryptedProvider | null = null;
    const onStatus = (e: { status: string }) =>
      setStatus(e.status === "connected" ? "connected" : "connecting");

    void Promise.all([deriveRoomKey(room), roomIdFor(room)]).then(
      ([key, roomId]) => {
        if (cancelled) return;
        provider = new EncryptedProvider(
          collabServerUrl(),
          roomId,
          ydoc,
          key,
          awareness,
        );
        provider.on("status", onStatus);
      },
    );

    return () => {
      cancelled = true;
      clearTimeout(offlineTimer);
      awareness.off("change", onAwareness);
      provider?.off("status", onStatus);
      view.destroy();
      provider?.destroy();
      awareness.destroy();
      void idb.destroy();
      ydoc.destroy();
      docRef.current = null;
    };
  }, [room, displayName]);

  async function saveToVault() {
    const text = docRef.current?.getText("body").toString().trim();
    if (!text) return;
    setSaved("saving");
    try {
      await captureNote(base, {
        text,
        intent: `shared note · room "${room}"`,
        tags: ["shared", "collaborative"],
        people: [],
        type: "note",
      });
      setSaved("done");
      setTimeout(() => setSaved(null), 2500);
    } catch {
      setSaved("error");
      setTimeout(() => setSaved(null), 2500);
    }
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex items-center justify-between gap-3 pb-3">
        <div className="flex items-center gap-4">
          {status === "connected" ? (
            <Status tone="ok">Live</Status>
          ) : status === "offline" ? (
            <Status tone="warn">Offline, editing on this device</Status>
          ) : (
            <Status tone="idle" pulse>
              Connecting
            </Status>
          )}
          <span className="font-mono inline-flex items-center gap-1.5 text-[11px] text-[var(--muted)]">
            <Users className="h-3.5 w-3.5" />
            {peers} here
          </span>
        </div>
        {edition.vaultSync && (
          <Button
            icon={saved === "done" ? Check : Save}
            busy={saved === "saving"}
            onClick={() => void saveToVault()}
            variant={saved === "error" ? "danger" : "secondary"}
          >
            {saved === "done"
              ? "Saved to the vault"
              : saved === "error"
                ? "Couldn't save, try again"
                : "Save to the vault"}
          </Button>
        )}
      </div>
      <div
        ref={host}
        data-active={status === "connected"}
        className="prism-hover min-h-0 flex-1 overflow-hidden rounded-[var(--radius)] border border-[var(--line-strong)] bg-[var(--card)] px-4"
      />
    </div>
  );
}
