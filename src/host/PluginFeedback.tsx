import { useEffect, useRef, useState } from "react";
import { MessageSquarePlus, X, Check, Bug, Lightbulb, Type, ArrowUpRight, FlaskConical } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import type { Identity, InstanceConfig, Support } from "./types";
import { isTauri } from "./useUpdater";
import { Button } from "../ui";
import { openInBrowser } from "../identity/passkey";

/**
 * The host-level "suggest a change" affordance.
 *
 * It floats over every module panel (the host owns it, not the plugins — they
 * each draw their own header, so a uniform surface has to live in the shell).
 * A suggestion POSTs to `/api/murmur/feedback`, tagged with the active plugin,
 * the instance, and who sent it, and lands in the append-only backlog ledger.
 * Fire-and-forget: the panel never blocks on it.
 *
 * Under the form sits the plugin's own route back (`support` on the module):
 * where to get help or report a bug in that plugin and get an answer. A lab
 * plugin says so at the top.
 */

type Kind = "idea" | "bug" | "copy";

const KINDS: { k: Kind; label: string; Icon: LucideIcon }[] = [
  { k: "idea", label: "Idea", Icon: Lightbulb },
  { k: "bug", label: "Bug", Icon: Bug },
  { k: "copy", label: "Copy", Icon: Type },
];

let cachedVersion: string | null = null;
async function appVersion(): Promise<string> {
  if (cachedVersion !== null) return cachedVersion;
  if (!isTauri) return (cachedVersion = "web");
  try {
    const { getVersion } = await import("@tauri-apps/api/app");
    cachedVersion = await getVersion();
  } catch {
    cachedVersion = "unknown";
  }
  return cachedVersion;
}

export function PluginFeedback({
  pluginId,
  pluginTitle,
  identity,
  instance,
  lab,
  support,
}: {
  pluginId: string;
  pluginTitle: string;
  identity: Identity;
  instance: InstanceConfig;
  lab?: boolean;
  support?: Support;
}) {
  const [open, setOpen] = useState(false);
  const [kind, setKind] = useState<Kind>("idea");
  const [text, setText] = useState("");
  const [phase, setPhase] = useState<"edit" | "sending" | "sent" | "error">("edit");
  const taRef = useRef<HTMLTextAreaElement>(null);

  // Reset everything when the user switches to a different plugin.
  useEffect(() => {
    setOpen(false);
    setText("");
    setKind("idea");
    setPhase("edit");
  }, [pluginId]);

  useEffect(() => {
    if (open && phase === "edit") taRef.current?.focus();
  }, [open, phase]);

  async function submit() {
    const body = text.trim();
    if (!body || phase === "sending") return;
    setPhase("sending");
    try {
      const base =
        instance.birdbrainBase?.trim() ||
        (typeof window !== "undefined" ? window.location.origin : "");
      const res = await fetch(`${base}/api/murmur/feedback`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          plugin: pluginId,
          pluginTitle,
          kind,
          text: body,
          instance: { slug: instance.slug, name: instance.name },
          from: identity.handle,
          fromDid: identity.did,
          version: await appVersion(),
          ua: typeof navigator !== "undefined" ? navigator.userAgent : "",
        }),
      });
      if (!res.ok) throw new Error(String(res.status));
      setPhase("sent");
      setText("");
      setTimeout(() => {
        setOpen(false);
        setPhase("edit");
      }, 1800);
    } catch {
      setPhase("error");
    }
  }

  return (
    <div className="absolute bottom-4 right-4 z-10 flex flex-col items-end">
      {open && (
        <div className="mb-2 w-80 overflow-hidden rounded-[calc(var(--radius)+4px)] border border-[var(--line-strong)] bg-[var(--card)] shadow-[0_20px_60px_rgba(0,0,0,0.18)]">
          <div className="flex items-center justify-between border-b border-[var(--line)] px-4 py-3">
            <div className="min-w-0">
              <div className="font-tight text-sm font-medium">Suggest a change</div>
              <div className="truncate text-[11px] text-[var(--muted)]">
                to {pluginTitle}
              </div>
            </div>
            <button
              onClick={() => setOpen(false)}
              className="text-[var(--faint)] transition hover:text-[var(--fg)]"
            >
              <X className="h-4 w-4" />
            </button>
          </div>

          {lab && (
            <div className="flex items-start gap-2 border-b border-[var(--line)] px-4 py-2.5 text-[11px] leading-relaxed text-[var(--muted)]">
              <FlaskConical className="mt-0.5 h-3.5 w-3.5 shrink-0" />
              <span>
                {pluginTitle} is in the lab: early, for testing, and it may change. Bug reports help most.
              </span>
            </div>
          )}

          {phase === "sent" ? (
            <div className="flex items-center gap-2 px-4 py-6 text-sm text-[var(--muted)]">
              <Check className="h-4 w-4 text-[var(--ok)]" />
              Sent. Thank you.
            </div>
          ) : (
            <div className="px-4 py-3.5">
              <div className="mb-2.5 flex gap-1.5">
                {KINDS.map(({ k, label, Icon }) => (
                  <button
                    key={k}
                    onClick={() => setKind(k)}
                    data-active={kind === k}
                    className="prism-hover flex flex-1 items-center justify-center gap-1.5 rounded-[var(--radius)] border border-[var(--line)] py-1.5 text-xs text-[var(--muted)] transition data-[active=true]:border-[var(--line-strong)] data-[active=true]:bg-[var(--raise)] data-[active=true]:text-[var(--fg)]"
                  >
                    <Icon className="h-3.5 w-3.5" /> {label}
                  </button>
                ))}
              </div>

              <textarea
                ref={taRef}
                value={text}
                onChange={(e) => setText(e.target.value)}
                onKeyDown={(e) => {
                  if ((e.metaKey || e.ctrlKey) && e.key === "Enter") submit();
                }}
                placeholder={`What would make ${pluginTitle} better?`}
                rows={3}
                className="w-full resize-y rounded-[var(--radius)] border border-[var(--line)] bg-[var(--bg)] px-3 py-2 text-sm outline-none placeholder:text-[var(--faint)] focus:border-[var(--line-strong)]"
              />

              {phase === "error" && (
                <p className="mt-1.5 text-[11px] text-[var(--danger)]">
                  Couldn't send. Check your connection and try again.
                </p>
              )}

              <div className="mt-2.5 flex items-center justify-between">
                <span className="text-[11px] text-[var(--faint)]">
                  Goes to the people who build {instance.name}'s app.
                </span>
                <Button variant="primary" onClick={submit} disabled={!text.trim()} busy={phase === "sending"}>
                  Send
                </Button>
              </div>
            </div>
          )}

          {support && (
            <button
              onClick={() => openInBrowser(support.href)}
              className="prism-hover flex w-full items-center justify-between gap-2 border-t border-[var(--line)] px-4 py-2.5 text-left text-[11px] text-[var(--muted)] transition hover:text-[var(--fg)]"
            >
              <span className="min-w-0 truncate">
                Help or a bug in {pluginTitle}? {support.label}
              </span>
              <ArrowUpRight className="h-3.5 w-3.5 shrink-0" />
            </button>
          )}
        </div>
      )}

      <button
        onClick={() => setOpen((o) => !o)}
        title={`Suggest a change to ${pluginTitle}`}
        className="prism-hover flex items-center gap-1.5 rounded-[var(--radius)] border border-[var(--line-strong)] bg-[var(--card)] px-3 py-1.5 text-xs font-medium text-[var(--muted)] shadow-[0_6px_20px_rgba(0,0,0,0.08)] transition hover:text-[var(--fg)]"
      >
        <MessageSquarePlus className="h-3.5 w-3.5" />
        Suggest
      </button>
    </div>
  );
}
