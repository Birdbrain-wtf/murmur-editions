import { useCallback, useEffect, useState } from "react";
import { app } from "../edition";

/**
 * Self-update for the desktop build.
 *
 * The Tauri updater + process plugins only exist inside the native shell, so
 * everything is gated on `isTauri` and the plugin modules are lazy-imported —
 * the browser dev preview (and the hosted web demo) renders untouched.
 *
 * Flow: check the release endpoint → if a newer signed build exists, surface a
 * banner → download + verify (signature checked against the bundled pubkey) →
 * relaunch into the new version. Built for members who never touch a terminal.
 */

export type UpdateState =
  | { status: "idle" }
  | { status: "checking" }
  | { status: "available"; version: string; notes?: string }
  | { status: "downloading"; pct: number }
  | { status: "ready" }
  | { status: "uptodate" }
  | { status: "updated"; version: string; notes: string }
  | { status: "error"; message: string };

export const isTauri =
  typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

// The updater plugin is compiled into desktop builds only (see src-tauri). On
// iOS/Android the native plugin is absent, so skip the check entirely rather
// than fail a lazy import on every launch.
const isMobileWebview =
  typeof navigator !== "undefined" &&
  /android|iphone|ipad|ipod/i.test(navigator.userAgent);

// Every edition has its own signed channel; an edition can still opt out here.
const canSelfUpdate = isTauri && !isMobileWebview && app.selfUpdate;

// The notes of the update being installed, kept across the restart so the new
// version can say once what changed. Shown only if the app really is now that
// version, so a failed install never claims to have updated.
const WHATS_NEW_KEY = "murmur.whats-new.v1";

// Which channel this install follows. "stable" gets a build only after it has
// sat on "early" for the soak (lab/murmur/STABILITY.md); "early" gets every build
// the day it ships. Sent as a header, so the address baked into the build never changes.
const CHANNEL_KEY = "murmur.update-channel.v1";
export type UpdateChannel = "stable" | "early";

export function getUpdateChannel(): UpdateChannel {
  try {
    return localStorage.getItem(CHANNEL_KEY) === "early" ? "early" : "stable";
  } catch {
    return "stable";
  }
}

export function setUpdateChannel(channel: UpdateChannel) {
  localStorage.setItem(CHANNEL_KEY, channel);
}

export function useUpdater() {
  const [state, setState] = useState<UpdateState>({ status: "idle" });
  const [pending, setPending] = useState<any>(null);

  const check = useCallback(async () => {
    if (!canSelfUpdate) return;
    setState((s) => (s.status === "updated" ? s : { status: "checking" }));
    try {
      const { check } = await import("@tauri-apps/plugin-updater");
      const update = await check({ headers: { "X-Update-Channel": getUpdateChannel() } });
      if (update) {
        setPending(update);
        setState({ status: "available", version: update.version, notes: update.body });
      } else {
        setState((s) => (s.status === "updated" ? s : { status: "uptodate" }));
      }
    } catch (e) {
      setState({
        status: "error",
        message: e instanceof Error ? e.message : "update check failed",
      });
    }
  }, []);

  const install = useCallback(async () => {
    if (!pending) return;
    try {
      let downloaded = 0;
      let total = 0;
      setState({ status: "downloading", pct: 0 });
      localStorage.setItem(
        WHATS_NEW_KEY,
        JSON.stringify({ version: pending.version, notes: pending.body ?? "" }),
      );
      await pending.downloadAndInstall((ev: any) => {
        switch (ev.event) {
          case "Started":
            total = ev.data?.contentLength ?? 0;
            break;
          case "Progress":
            downloaded += ev.data?.chunkLength ?? 0;
            setState({
              status: "downloading",
              pct: total ? Math.min(100, Math.round((downloaded / total) * 100)) : 0,
            });
            break;
          case "Finished":
            setState({ status: "ready" });
            break;
        }
      });
      const { relaunch } = await import("@tauri-apps/plugin-process");
      await relaunch();
    } catch (e) {
      setState({
        status: "error",
        message: e instanceof Error ? e.message : "update failed",
      });
    }
  }, [pending]);

  const dismiss = useCallback(() => setState({ status: "idle" }), []);

  // Just updated: say what changed, once. Then the usual check.
  useEffect(() => {
    if (!canSelfUpdate) return;
    const raw = localStorage.getItem(WHATS_NEW_KEY);
    if (!raw) return;
    void (async () => {
      try {
        const saved = JSON.parse(raw);
        const { getVersion } = await import("@tauri-apps/api/app");
        if (saved?.version && saved.version === (await getVersion()) && saved.notes) {
          setState((s) => (s.status === "idle" || s.status === "checking" || s.status === "uptodate"
            ? { status: "updated", version: saved.version, notes: saved.notes }
            : s));
        }
      } catch {
        /* nothing to show */
      }
      localStorage.removeItem(WHATS_NEW_KEY);
    })();
  }, []);

  // Check shortly after launch so it never blocks first paint.
  useEffect(() => {
    if (!canSelfUpdate) return;
    const t = setTimeout(() => void check(), 1500);
    return () => clearTimeout(t);
  }, [check]);

  return { state, check, install, dismiss, isTauri };
}
