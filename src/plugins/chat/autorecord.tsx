import { useEffect, useState } from "react";
import { Circle } from "lucide-react";
import { edition } from "../../edition";
import { Button } from "../../ui";

/**
 * A room that records every call by itself (`partners.decent.call.auto`, set by
 * the operator with `project-rooms.ts autorecord`). Nobody presses Record: once
 * two people are in the call and one of them has said yes, the recorder starts,
 * and only the voices of people who said yes are kept. Saying yes is a line in
 * the room, "record me", so it works the same from Element; this strip is that
 * line as a button. The recorder answers every yes or no with a notice carrying
 * the list of who is in (`partners.decent.call.optins`), which is what this reads,
 * because the recorder's own list is on the chat server, not in the room.
 * Server side: infra/services/call-recorder/README.md, "Rooms that record every call".
 */

export const AUTO_EVENT = "partners.decent.call.auto";
const OPTINS_FIELD = "partners.decent.call.optins";
const PAGES = 10;

export interface AutoRecord {
  on: boolean;
  /** who has said yes; null until the room's history has been read */
  agreed: string[] | null;
}

async function latestList(client: any, roomId: string): Promise<string[] | null> {
  const filter = JSON.stringify({ types: ["m.room.message"], senders: [edition.callRecorder] });
  let from: string | undefined;
  for (let i = 0; i < PAGES; i++) {
    const q: Record<string, string> = { dir: "b", limit: "50", filter };
    if (from) q.from = from;
    const r: any = await client.http.authedRequest("GET", `/rooms/${encodeURIComponent(roomId)}/messages`, q);
    for (const ev of r?.chunk ?? []) {
      const list = ev?.content?.[OPTINS_FIELD]?.agreed;
      if (Array.isArray(list)) return list;
    }
    if (!r?.end || !(r.chunk ?? []).length) return null;
    from = r.end;
  }
  return null;
}

export function useAutoRecord(client: any, roomId: string | null): AutoRecord {
  const [state, setState] = useState<AutoRecord>({ on: false, agreed: null });
  useEffect(() => {
    if (!client || !roomId || !edition.callRecorder) return;
    let alive = true;
    const auto = () => client.getRoom?.(roomId)?.currentState?.getStateEvents?.(AUTO_EVENT, "")?.getContent?.() ?? {};
    const read = async () => {
      const c = auto();
      if (!c.on) return alive && setState({ on: false, agreed: null });
      setState((s) => ({ on: true, agreed: s.agreed }));
      // A yes given another way (by email) is in the room's setting until the recorder first speaks.
      const list = await latestList(client, roomId).catch(() => null);
      if (alive) setState({ on: true, agreed: list ?? c.agreed ?? [] });
    };
    void read();
    const onState = (ev: any) => {
      if (ev?.getRoomId?.() === roomId && ev.getType?.() === AUTO_EVENT) void read();
    };
    const onTl = (ev: any, room: any, toStart: boolean) => {
      if (toStart || room?.roomId !== roomId || ev.getSender?.() !== edition.callRecorder) return;
      const list = ev.getContent?.()?.[OPTINS_FIELD]?.agreed;
      if (Array.isArray(list)) setState({ on: !!auto().on, agreed: list });
    };
    client.on("RoomState.events", onState);
    client.on("Room.timeline", onTl);
    return () => {
      alive = false;
      client.off("RoomState.events", onState);
      client.off("Room.timeline", onTl);
    };
  }, [client, roomId]);
  return state;
}

/** The line under a room's header: this room records its calls, and whether you are in. */
export function AutoRecordStrip({ client, roomId, auto }: { client: any; roomId: string; auto: AutoRecord }) {
  const [sending, setSending] = useState<"yes" | "no" | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const me = client?.getUserId?.();
  const yes = !!auto.agreed?.includes(me);
  // The recorder's answer clears the wait; give up after a while so the button comes back.
  useEffect(() => {
    if (sending && (sending === "yes") === yes) setSending(null);
  }, [yes, sending]);
  useEffect(() => {
    if (!sending) return;
    const t = setTimeout(() => {
      setSending(null);
      setProblem("The recorder has not answered. It may be restarting, so try again in a minute.");
    }, 20_000);
    return () => clearTimeout(t);
  }, [sending]);
  const room = client?.getRoom?.(roomId);
  const names = (auto.agreed ?? [])
    .filter((id) => id !== me)
    .map((id) => room?.getMember?.(id)?.name || id.replace(/^@/, "").split(":")[0]);

  async function say(on: boolean) {
    setProblem(null);
    setSending(on ? "yes" : "no");
    try {
      await client.sendTextMessage(roomId, on ? "record me" : "don't record me");
    } catch {
      setSending(null);
      setProblem("That did not send. Try again.");
    }
  }

  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-2 border-b border-[var(--line)] px-6 py-2 text-[13px] text-[var(--muted)]">
      <Circle className="h-3 w-3" style={{ color: yes ? "var(--danger)" : "var(--faint)" }} />
      <span className="min-w-0 flex-1">
        This room records its calls by itself, and keeps only the voices of people who said yes.{" "}
        {auto.agreed === null
          ? ""
          : yes
            ? `Your voice is kept${names.length ? `, and so are ${names.join(", ")}'s` : ""}.`
            : `Your voice is not kept${names.length ? `. ${names.join(", ")} said yes` : ""}.`}
        {problem && <span className="block text-[var(--danger)]">{problem}</span>}
      </span>
      {auto.agreed !== null &&
        (yes ? (
          <Button variant="quiet" busy={sending === "no"} onClick={() => void say(false)}>
            Don't record me
          </Button>
        ) : (
          <Button icon={Circle} busy={sending === "yes"} onClick={() => void say(true)}>
            Record me
          </Button>
        ))}
    </div>
  );
}
