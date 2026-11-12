import { Download, Loader2, RefreshCw, Sparkles, X } from "lucide-react";
import type { UpdateState } from "./useUpdater";
import { Button } from "../ui";
import { app } from "../edition";

/**
 * Floating update toast (bottom-right). Only renders for states the member
 * needs to act on or should hear about; "checking" / "uptodate" / "idle" stay
 * silent. The release notes come from the channel's latest.json (`notes`,
 * written by `finish-release`): shown before the update, and once after it.
 */
export function UpdateBanner({
  state,
  onInstall,
  onDismiss,
}: {
  state: UpdateState;
  onInstall: () => void;
  onDismiss: () => void;
}) {
  if (
    state.status !== "available" &&
    state.status !== "downloading" &&
    state.status !== "ready" &&
    state.status !== "updated"
  )
    return null;

  return (
    <div className="fixed bottom-5 right-5 z-30 w-80 overflow-hidden rounded-[calc(var(--radius)+2px)] border border-[var(--line-strong)] bg-[var(--card)] shadow-[0_16px_60px_rgba(0,0,0,0.16)]">
      <div className="spectrum-bar h-0.5 w-full" />
      <div className="p-4">
        {state.status === "available" && (
          <>
            <div className="flex items-start justify-between gap-3">
              <div>
                <div className="font-tight text-sm font-medium">Update available</div>
                <p className="mt-0.5 text-xs text-[var(--muted)]">
                  {app.productName} {state.version} is ready to install.
                </p>
              </div>
              <button
                onClick={onDismiss}
                className="shrink-0 text-[var(--faint)] hover:text-[var(--fg)]"
                title="Later"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            {state.notes && <Notes text={state.notes} />}
            <Button variant="primary" size="md" icon={Download} onClick={onInstall} className="mt-3 w-full">
              Update and restart
            </Button>
          </>
        )}

        {state.status === "updated" && (
          <>
            <div className="flex items-start justify-between gap-3">
              <div className="flex items-center gap-2">
                <Sparkles className="h-4 w-4 text-[var(--muted)]" />
                <div className="font-tight text-sm font-medium">What's new in {state.version}</div>
              </div>
              <button
                onClick={onDismiss}
                className="shrink-0 text-[var(--faint)] hover:text-[var(--fg)]"
                title="Close"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            <Notes text={state.notes} />
          </>
        )}

        {state.status === "downloading" && (
          <>
            <div className="flex items-center gap-2 text-sm">
              <Loader2 className="h-4 w-4 animate-spin text-[var(--muted)]" />
              <span className="font-tight font-medium">Downloading update…</span>
            </div>
            <div className="mt-3 h-1 w-full overflow-hidden rounded-full bg-[var(--raise)]">
              <div
                className="spectrum-bar h-full transition-[width] duration-300"
                style={{ width: `${state.pct}%` }}
              />
            </div>
          </>
        )}

        {state.status === "ready" && (
          <div className="flex items-center gap-2 text-sm">
            <RefreshCw className="h-4 w-4 animate-spin text-[var(--muted)]" />
            <span className="font-tight font-medium">Restarting…</span>
          </div>
        )}
      </div>
    </div>
  );
}

function Notes({ text }: { text: string }) {
  return (
    <div className="mt-2 max-h-40 overflow-y-auto whitespace-pre-wrap text-xs leading-relaxed text-[var(--fg)]">
      {text.trim()}
    </div>
  );
}
