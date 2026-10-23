import { useEffect, useState } from "react";
import { Download, Mic, Trash2 } from "lucide-react";
import { edition } from "../../edition";
import { Section, Button, Notice } from "../../ui";

/**
 * Your call recordings: every project-room call that recorded your voice, with
 * the two things you can always do (ADR 0079). Take a copy: your own voice files,
 * your own lines, and the text of the call, as a zip from the door. Withdraw: we
 * delete your voice and words from our copy, and the transcript keeps only the
 * times you spoke. Server side: infra/services/chaos-auth/project-calls.ts.
 */

interface MyCall {
  call: string;
  project: string;
  name: string;
  date: string;
  people: string[];
  files: number;
  lines: number;
  withdrawn: boolean;
}

async function door(action: string, body: Record<string, unknown>) {
  const r = await fetch(`${edition.signIn.pair}/${action}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify(body),
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error || `The door said ${r.status}.`);
  return j;
}

async function open(url: string) {
  try {
    const { openUrl } = await import("@tauri-apps/plugin-opener");
    await openUrl(url);
  } catch {
    window.open(url, "_blank");
  }
}

export function MyRecordings({ session }: { session: string }) {
  const [calls, setCalls] = useState<MyCall[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [confirming, setConfirming] = useState<string | null>(null);
  const [said, setSaid] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    try {
      setCalls((await door("calls", { session })).calls ?? []);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not load your recordings.");
    }
  }
  useEffect(() => {
    void load();
  }, [session]);

  async function take(call?: string) {
    setBusy(`take:${call ?? "all"}`);
    setError(null);
    setSaid(null);
    try {
      const j = await door("calls-export", { session, call });
      await open(j.url);
      setSaid("Your copy is downloading. The link works once, for ten minutes.");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not make your copy.");
    } finally {
      setBusy(null);
    }
  }

  async function withdraw(call: string) {
    setBusy(`withdraw:${call}`);
    setError(null);
    setSaid(null);
    try {
      const j = await door("calls-withdraw", { session, call, confirm: true });
      setSaid(
        j.withdrawn?.length
          ? `Done. Your voice and words are gone from ${j.withdrawn.length === 1 ? "that call" : `${j.withdrawn.length} calls`}.`
          : "There was nothing of yours left to withdraw.",
      );
      setConfirming(null);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not withdraw.");
    } finally {
      setBusy(null);
    }
  }

  const held = (calls ?? []).filter((c) => !c.withdrawn);

  return (
    <Section label="your call recordings" icon={Mic}>
      <p className="text-[13px] leading-relaxed text-[var(--muted)]">
        Project calls that recorded your voice. Your voice stays yours. Take a copy at any time: your own voice files,
        your own lines, and the text of each call. Or withdraw: we delete your voice and your words from our copy, and
        the transcript keeps only the times you spoke. Copies other people already took stay with them.
      </p>
      {calls === null && !error && <p className="mt-3 text-[13px] text-[var(--faint)]">Loading…</p>}
      {calls?.length === 0 && <p className="mt-3 text-[13px] text-[var(--faint)]">No recordings of you yet.</p>}
      {calls && calls.length > 0 && (
        <ul className="mt-3 divide-y divide-[var(--line)] border-y border-[var(--line)]">
          {calls.map((c) => (
            <li key={c.call} className="py-2.5 text-[13px]">
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-medium">{c.name}</span>
                <span className="font-mono text-[11px] text-[var(--faint)]">{c.date}</span>
                <span className="text-[var(--muted)]">
                  {c.withdrawn ? "withdrawn" : `${c.lines} line${c.lines === 1 ? "" : "s"}`}, with{" "}
                  {c.people.join(", ")}
                </span>
                {!c.withdrawn && (
                  <span className="ml-auto flex gap-2">
                    <Button icon={Download} busy={busy === `take:${c.call}`} onClick={() => void take(c.call)}>
                      Take a copy
                    </Button>
                    <Button variant="danger" icon={Trash2} onClick={() => setConfirming(c.call)}>
                      Withdraw
                    </Button>
                  </span>
                )}
              </div>
              {confirming === c.call && (
                <div className="mt-2 flex flex-wrap items-center gap-2">
                  <span className="text-[var(--danger)]">
                    Delete your voice and your words from this call? This cannot be undone, so take a copy first if
                    you want one.
                  </span>
                  <Button variant="danger" busy={busy === `withdraw:${c.call}`} onClick={() => void withdraw(c.call)}>
                    Delete them
                  </Button>
                  <Button variant="quiet" onClick={() => setConfirming(null)}>
                    Keep them
                  </Button>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
      {held.length > 1 && (
        <div className="mt-3">
          <Button icon={Download} busy={busy === "take:all"} onClick={() => void take()}>
            Take a copy of all of them
          </Button>
        </div>
      )}
      {said && <Notice tone="ok">{said}</Notice>}
      {error && <Notice tone="danger">{error}</Notice>}
    </Section>
  );
}
