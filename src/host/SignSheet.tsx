import { useEffect, useRef, useState } from "react";
import { PenLine } from "lucide-react";
import { answer, CHAIN_LABEL, usePendingSign } from "../lib/signer";
import { Button, Code, Dot, Facts, Notice, Waiting } from "../ui";

/**
 * The app's own signing screen (lib/signer.ts). Every chain call any plugin
 * asks for comes through here, read back from the bytes that will be signed.
 * A plugin can't draw this screen, change what it says, or skip it.
 */
export function SignSheet() {
  const p = usePendingSign();
  const dialog = useRef<HTMLDialogElement>(null);
  const [sure, setSure] = useState(false);
  const [details, setDetails] = useState(false);

  useEffect(() => {
    setSure(false);
    setDetails(false);
    if (p && !dialog.current?.open) dialog.current?.showModal();
    if (!p && dialog.current?.open) dialog.current.close();
  }, [p?.id]);

  if (!p) return <dialog ref={dialog} className="hidden" />;
  const r = p.reading;
  const danger = r?.risk === "danger";
  const ready = !!r && !p.problem && (!danger || sure);

  return (
    <dialog
      ref={dialog}
      aria-label="Sign this call"
      onCancel={(e) => {
        e.preventDefault();
        answer(false);
      }}
      className="fixed inset-0 m-0 h-full max-h-none w-full max-w-none items-center justify-center border-0 bg-transparent p-3 text-[var(--fg)] open:flex backdrop:bg-black/30 md:p-6"
    >
      <div className="max-h-[85vh] w-full max-w-lg overflow-y-auto rounded-[calc(var(--radius)+4px)] border border-[var(--line-strong)] bg-[var(--card)] shadow-[0_20px_80px_rgba(0,0,0,0.18)]">
        <div className="flex items-start gap-3 border-b border-[var(--line)] px-6 py-4">
          <PenLine className="mt-1 h-4 w-4 text-[var(--muted)]" />
          <div>
            <h2 className="font-tight text-lg font-medium">{p.plugin.title} asks you to sign</h2>
            <p className="text-xs text-[var(--muted)]">
              Read by the app from the call itself. Nothing is sent until you say yes.
            </p>
          </div>
        </div>

        <div className="space-y-4 px-6 py-5">
          {!r && !p.problem && <Waiting>Reading the call…</Waiting>}
          {r && (
            <ul className="space-y-2">
              {r.lines.map((l, i) => (
                <li key={i} className="flex items-start gap-2 text-sm leading-relaxed">
                  <span className="mt-1.5">
                    <Dot tone={l.risk === "danger" ? "danger" : l.risk === "check" ? "warn" : "ok"} />
                  </span>
                  <span>{l.text}</span>
                </li>
              ))}
            </ul>
          )}
          {p.request.why && (
            <p className="text-[13px] text-[var(--muted)]">
              {p.plugin.title} says: {p.request.why}
            </p>
          )}

          <Facts
            items={[
              ["chain", CHAIN_LABEL[p.request.chain]],
              ["from", `${p.from.slice(0, 8)}…${p.from.slice(-6)}`],
              ["fee", p.fee ?? (p.problem ? "-" : "working it out…")],
              ...(r ? ([["call", r.name]] as [string, string][]) : []),
            ]}
          />

          {p.problem && <Notice tone="danger">{p.problem}</Notice>}

          {r && (
            <div>
              <Button variant="quiet" onClick={() => setDetails((d) => !d)}>
                {details ? "Hide the details" : "Exactly what will be signed"}
              </Button>
              {details && (
                <div className="mt-2 space-y-2">
                  <pre className="max-h-64 overflow-auto rounded-[var(--radius)] border border-[var(--line)] bg-[var(--raise)] p-3 font-mono text-[11px] leading-relaxed">
                    {r.raw}
                  </pre>
                  <p className="break-all text-[11px] text-[var(--faint)]">
                    Call bytes: <Code>{r.callData}</Code>
                  </p>
                </div>
              )}
            </div>
          )}

          {danger && (
            <label className="flex items-start gap-2 text-[13px]">
              <input type="checkbox" className="mt-0.5" checked={sure} onChange={(e) => setSure(e.target.checked)} />
              I've read what this does and I mean it.
            </label>
          )}
        </div>

        <div className="flex justify-end gap-2 border-t border-[var(--line)] px-6 py-4">
          <Button variant="quiet" onClick={() => answer(false)}>
            Don't sign
          </Button>
          <Button variant={danger ? "danger" : "primary"} disabled={!ready} onClick={() => answer(true)}>
            Sign and send
          </Button>
        </div>
      </div>
    </dialog>
  );
}
