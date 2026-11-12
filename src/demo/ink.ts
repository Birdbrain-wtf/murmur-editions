import type { CSSProperties } from "react";
import { edition, shaped } from "../edition";

export const colourful = true;

const INKS: Record<string, string> = {
  agent: "#7b4fc4",
  chat: "#0078bf",
  meet: "#ff7a3d",
  magazine: "#ff48b0",
  fundraise: "#1f9d6b",
  spend: "#3b49df",
  structure: "#e0a800",
  operations: "#00a19a",
  notes: "#ffd400",
  identity: "#e5383b",
  settings: "#6b6b6b",
  how: "#1a1a1a",
};
const SPARE = ["#0078bf", "#ff48b0", "#1f9d6b", "#7b4fc4", "#ff7a3d"];
const LIGHT = new Set(["#ffd400", "#e0a800"]);

// A group's pack may bring its own section colours (`look.palette`); they go
// round the sections in rail order, so neighbours never share one.
const ORDER = ["agent", "made-1", "made-2", "magazine", "fundraise", "meet", "chat", "structure", "operations", "spend", "notes", "identity", "settings", "how"];
const OWN = shaped?.look?.palette;

export function inkOf(id: string): string {
  if (OWN?.length) {
    const at = ORDER.indexOf(id);
    if (at >= 0) return OWN[at % OWN.length];
  }
  if (INKS[id]) return INKS[id];
  let h = 0;
  for (const c of id) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return SPARE[h % SPARE.length];
}

/** What sits on top of a filled ink: dark on the yellows, white on the rest. */
export const onInk = (ink: string) => (LIGHT.has(ink) || light(ink) ? "#1a1a1a" : "#ffffff");
function light(hex: string) {
  const n = parseInt(hex.slice(1), 16);
  return (0.299 * (n >> 16) + 0.587 * ((n >> 8) & 255) + 0.114 * (n & 255)) / 255 > 0.62;
}

/** The CSS variables a surface reads its ink from (`--ink`, `--ink-wash`, `--ink-on`). */
export function inkVars(id: string): CSSProperties {
  if (!edition.showcase) return {
    "--ink": "var(--accent)",
    "--ink-on": "var(--fg)",
    "--ink-wash": "color-mix(in srgb, var(--accent) 3%, var(--bg))",
    "--ink-soft": "color-mix(in srgb, var(--accent) 9%, var(--bg))",
  } as CSSProperties;
  const ink = inkOf(id);
  return {
    "--ink": ink,
    "--ink-on": onInk(ink),
    "--ink-wash": `color-mix(in srgb, ${ink} 9%, var(--bg))`,
    "--ink-soft": `color-mix(in srgb, ${ink} 18%, var(--bg))`,
  } as CSSProperties;
}
