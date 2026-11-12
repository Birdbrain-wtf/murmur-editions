import { useEffect, useState } from "react";

/**
 * Light and dark. The choice is about this computer, not a collective, so its
 * key is global (listed in GLOBAL in scope.ts). "system" follows the Mac.
 *
 * The resolved theme sits on <html data-theme="light|dark">; styles.css swaps
 * the tokens under it, so a surface styled with var(--bg), var(--fg),
 * var(--card) and friends needs nothing more. useSkin reads `isDark()` so a
 * group's own background and near-black colours never land on a dark page.
 */
export type ThemeMode = "light" | "dark" | "system";

export const THEME_KEY = "murmur.theme.v1";
const listeners = new Set<() => void>();
const media = typeof matchMedia !== "undefined" ? matchMedia("(prefers-color-scheme: dark)") : null;

export function themeMode(): ThemeMode {
  try {
    const v = localStorage.getItem(THEME_KEY);
    if (v === "light" || v === "dark" || v === "system") return v;
  } catch {
    /* ignore */
  }
  return "system";
}

export function isDark(mode: ThemeMode = themeMode()): boolean {
  return mode === "dark" || (mode === "system" && !!media?.matches);
}

function paint() {
  if (typeof document === "undefined") return;
  const dark = isDark();
  document.documentElement.dataset.theme = dark ? "dark" : "light";
  document.documentElement.style.colorScheme = dark ? "dark" : "light";
  listeners.forEach((f) => f());
}

export function setThemeMode(mode: ThemeMode) {
  try {
    localStorage.setItem(THEME_KEY, mode);
  } catch {
    /* ignore */
  }
  paint();
}

/** Called when the theme changes (by choice or by the Mac). */
export function onTheme(f: () => void): () => void {
  listeners.add(f);
  return () => listeners.delete(f);
}

export function useTheme(): { mode: ThemeMode; dark: boolean; setMode: (m: ThemeMode) => void } {
  const [, tick] = useState(0);
  useEffect(() => onTheme(() => tick((n) => n + 1)), []);
  const mode = themeMode();
  return { mode, dark: isDark(mode), setMode: setThemeMode };
}

media?.addEventListener?.("change", () => {
  if (themeMode() === "system") paint();
});

// Before first paint, so a dark window never flashes white.
paint();
