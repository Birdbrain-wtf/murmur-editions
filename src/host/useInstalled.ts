import { useCallback, useEffect, useState } from "react";
import { DEFAULT_INSTALLED, isStandard } from "./registry";
import { STANDARD } from "../edition";

// Bumped to v2 with the first public release's curated plugin set, so existing
// clients pick up the new defaults rather than a stale install list.
const KEY = "murmur.installed.v2";

// Plugins an edition has offered to this install, so a plugin added to the
// edition later is installed once on update and never forced back after the
// member removes it. Installs from before this list existed have seen every
// default except the ones named here.
const SEEN = "murmur.installed.seen.v1";
const ADDED_SINCE = ["agent", "invite"];

function load(): string[] {
  let list: string[] | null = null;
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) list = JSON.parse(raw) as string[];
  } catch {
    /* ignore */
  }
  if (!list) {
    localStorage.setItem(SEEN, JSON.stringify(DEFAULT_INSTALLED));
    return [...DEFAULT_INSTALLED];
  }
  let seen: string[];
  try {
    seen = JSON.parse(localStorage.getItem(SEEN) || "null") ?? DEFAULT_INSTALLED.filter((id) => !ADDED_SINCE.includes(id));
  } catch {
    seen = [];
  }
  const fresh = DEFAULT_INSTALLED.filter((id) => !seen.includes(id) && !list!.includes(id));
  localStorage.setItem(SEEN, JSON.stringify([...new Set([...seen, ...DEFAULT_INSTALLED])]));
  // The standard tier comes back even on an install that removed it before it was standard.
  const missing = STANDARD.filter((id) => !list!.includes(id) && !fresh.includes(id));
  return [...list, ...fresh, ...missing];
}

/**
 * Which plugins the user has installed. Core surfaces (identity, notes) are not
 * tracked here — they are always mounted. This is the "add capabilities over
 * time" model: a fresh client starts minimal and grows as backends come online.
 */
export function useInstalled() {
  const [installed, setInstalled] = useState<string[]>(load);

  useEffect(() => {
    localStorage.setItem(KEY, JSON.stringify(installed));
  }, [installed]);

  const install = useCallback((id: string) => {
    setInstalled((prev) => (prev.includes(id) ? prev : [...prev, id]));
  }, []);

  const uninstall = useCallback((id: string) => {
    if (isStandard(id)) return;
    setInstalled((prev) => prev.filter((x) => x !== id));
  }, []);

  const isInstalled = useCallback(
    (id: string) => installed.includes(id),
    [installed],
  );

  return { installed, install, uninstall, isInstalled };
}
