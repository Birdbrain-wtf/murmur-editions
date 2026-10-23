import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { edition } from "../edition";

/**
 * Skins — a group rebrands its own Decent client.
 *
 * A Decent build ships pointed at one instance (see `registry.ts`). A *skin*
 * lets the group bound to that instance restyle the client without a fork: it
 * overrides the Prism design tokens (the spectrum, the accent, the resting
 * surface, the corner radius) and the instance name. The Prism principle holds —
 * white is still the resting state — but the *consequence* colour and the brand
 * name become the group's.
 *
 * A skin is just data: persisted to `localStorage["murmur.skin.v1"]` and
 * applied as inline custom properties on `:root` (inline wins over styles.css,
 * so clearing a field falls back to the Decent default). Because it is data, a
 * group admin can export it as a short shareable code and hand it to every
 * member — the same "distribute a payload" shape as invite links.
 */
export interface Skin {
  /** overrides the instance name in the rail + headings; "" = Decent default */
  name: string;
  /** URL (absolute or root-relative) for the brand logo shown in the rail; "" = use first letter */
  logo: string;
  /** ordered colour stops for the brand spectrum; [] = default rainbow */
  spectrum: string[];
  /** the single accent (focus, selection); "" = #007aff */
  accent: string;
  /** resting background; "" = #ffffff (keep it near-white per Prism) */
  bg: string;
  /** foreground text; "" = #0a0a0a */
  fg: string;
  /** corner radius in px; null = 10 */
  radius: number | null;
}

export const EMPTY_SKIN: Skin = {
  name: "",
  logo: "",
  spectrum: [],
  accent: "",
  bg: "",
  fg: "",
  radius: null,
};

/** Decent's defaults — mirror styles.css :root. Used for the editor's
 *  baseline and the "reset" target. */
export const DECENT_DEFAULTS = {
  spectrum: [
    "#ff3b30",
    "#ff9500",
    "#ffcc00",
    "#34c759",
    "#00c7be",
    "#007aff",
    "#af52de",
  ],
  accent: "#007aff",
  bg: "#ffffff",
  fg: "#0a0a0a",
  radius: 10,
};

/** Named brand skins for in-development clients. */
export const BRAND_PRESETS: { id: string; label: string; skin: Partial<Skin> }[] =
  [
    {
      id: "birdbrain",
      label: "Birdbrain",
      skin: {
        name: "Birdbrain",
        logo: "/brand/birdbrain.png",
        spectrum: [
          "#ff3b30",
          "#ff9500",
          "#ffcc00",
          "#34c759",
          "#00c7be",
          "#007aff",
          "#af52de",
        ],
        accent: "#007aff",
        bg: "#ffffff",
        radius: 12,
      },
    },
    {
      id: "decent",
      label: "Decent",
      skin: {
        name: "Decent",
        logo: "/brand/decent.png",
        spectrum: [
          "#ff3b30",
          "#ff9500",
          "#ffcc00",
          "#34c759",
          "#00c7be",
          "#007aff",
          "#af52de",
        ],
        accent: "#007aff",
        bg: "#ffffff",
      },
    },
    {
      id: "fttf",
      label: "Four To The Floor",
      skin: {
        name: "FTTF",
        logo: "/brand/fttf.png",
        spectrum: ["#0a0a0a", "#ff6a00", "#0a0a0a"],
        accent: "#ff6a00",
        bg: "#ffffff",
        radius: 6,
      },
    },
  ];

/** A few generic starter skins so the editor demonstrates the range. */
export const SKIN_PRESETS: { id: string; label: string; skin: Partial<Skin> }[] =
  [
    {
      id: "default",
      label: "Default",
      skin: EMPTY_SKIN,
    },
    {
      id: "dusk",
      label: "Dusk",
      skin: {
        spectrum: ["#7c3aed", "#db2777", "#f59e0b"],
        accent: "#7c3aed",
        bg: "#fbfafd",
      },
    },
    {
      id: "terminal",
      label: "Terminal",
      skin: {
        spectrum: ["#22c55e", "#16a34a"],
        accent: "#16a34a",
        bg: "#fbfdfb",
        radius: 4,
      },
    },
    {
      id: "ember",
      label: "Ember",
      skin: {
        spectrum: ["#f97316", "#ef4444", "#b91c1c"],
        accent: "#ef4444",
        bg: "#fffaf7",
      },
    },
    {
      id: "ocean",
      label: "Ocean",
      skin: {
        spectrum: ["#06b6d4", "#0ea5e9", "#3b82f6"],
        accent: "#0ea5e9",
        bg: "#f7fbfd",
        radius: 14,
      },
    },
  ];

const KEY = "murmur.skin.v1";
const CODE_PREFIX = "decent-skin:";

function load(): Skin {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) {
      const saved = { ...EMPTY_SKIN, ...(JSON.parse(raw) as Partial<Skin>) };
      // A saved look that names a brand logo no preset carries any more (a
      // renamed edition, e.g. Alder → Huxley) is stale: wear the edition's own.
      const retired =
        saved.logo.startsWith("/brand/") && !BRAND_PRESETS.some((p) => p.skin.logo === saved.logo);
      if (!retired) return saved;
    }
  } catch {
    /* ignore */
  }
  // First run: the edition's own brand (Murmur wears the bird), else the default.
  const preset = BRAND_PRESETS.find((p) => p.id === edition.defaultSkin);
  return { ...EMPTY_SKIN, ...(preset?.skin ?? {}) };
}

/** Build the spectrum gradient string from evenly-distributed stops. */
function spectrumGradient(stops: string[]): string {
  if (stops.length === 1) return `linear-gradient(90deg, ${stops[0]}, ${stops[0]})`;
  const parts = stops.map((c, i) => {
    const pct = Math.round((i / (stops.length - 1)) * 100);
    return `${c} ${pct}%`;
  });
  return `linear-gradient(90deg, ${parts.join(", ")})`;
}

/** Apply (or clear) a skin's tokens as inline props on the document root.
 *  Clearing a field removes the inline prop so styles.css's default returns. */
function apply(skin: Skin) {
  const root = document.documentElement;
  const set = (prop: string, val: string | null) =>
    val ? root.style.setProperty(prop, val) : root.style.removeProperty(prop);

  set("--spectrum", skin.spectrum.length ? spectrumGradient(skin.spectrum) : null);
  set("--accent", skin.accent || null);
  set("--bg", skin.bg || null);
  set("--fg", skin.fg || null);
  set("--radius", skin.radius != null ? `${skin.radius}px` : null);
}

// Apply the stored skin once at module load — before first paint — so there is
// no flash of the default theme on a skinned client.
if (typeof document !== "undefined") {
  try {
    apply(load());
  } catch {
    /* ignore */
  }
}

/** Encode a skin to a short, shareable code (only the non-default fields). */
export function encodeSkin(skin: Skin): string {
  const trimmed: Partial<Skin> = {};
  if (skin.name) trimmed.name = skin.name;
  if (skin.logo) trimmed.logo = skin.logo;
  if (skin.spectrum.length) trimmed.spectrum = skin.spectrum;
  if (skin.accent) trimmed.accent = skin.accent;
  if (skin.bg) trimmed.bg = skin.bg;
  if (skin.fg) trimmed.fg = skin.fg;
  if (skin.radius != null) trimmed.radius = skin.radius;
  return CODE_PREFIX + btoa(unescape(encodeURIComponent(JSON.stringify(trimmed))));
}

/** Decode a shareable code back into a skin (tolerant of the prefix / raw JSON). */
export function decodeSkin(code: string): Skin | null {
  try {
    const body = code.trim().startsWith(CODE_PREFIX)
      ? code.trim().slice(CODE_PREFIX.length)
      : code.trim();
    const json = body.startsWith("{")
      ? body
      : decodeURIComponent(escape(atob(body)));
    const parsed = JSON.parse(json) as Partial<Skin>;
    return { ...EMPTY_SKIN, ...parsed };
  } catch {
    return null;
  }
}

interface SkinContextValue {
  skin: Skin;
  /** patch one or more fields */
  update: (patch: Partial<Skin>) => void;
  /** replace the whole skin (used by presets / paste) */
  set: (skin: Skin) => void;
  /** back to Decent defaults */
  reset: () => void;
}

const SkinContext = createContext<SkinContextValue | null>(null);

export function SkinProvider({ children }: { children: ReactNode }) {
  const [skin, setSkin] = useState<Skin>(load);

  useEffect(() => {
    apply(skin);
    try {
      localStorage.setItem(KEY, JSON.stringify(skin));
    } catch {
      /* ignore */
    }
  }, [skin]);

  const update = useCallback(
    (patch: Partial<Skin>) => setSkin((prev) => ({ ...prev, ...patch })),
    [],
  );
  const set = useCallback((next: Skin) => setSkin({ ...EMPTY_SKIN, ...next }), []);
  const reset = useCallback(() => setSkin({ ...EMPTY_SKIN }), []);

  const value = useMemo<SkinContextValue>(
    () => ({ skin, update, set, reset }),
    [skin, update, set, reset],
  );

  return <SkinContext.Provider value={value}>{children}</SkinContext.Provider>;
}

export function useSkin(): SkinContextValue {
  const ctx = useContext(SkinContext);
  if (!ctx) throw new Error("useSkin must be used within <SkinProvider>");
  return ctx;
}

/** A brand preset's logo is a path from the site root (`/brand/<id>.png`). When
 *  the web build is served under a prefix (the "try it" build at /try/), the
 *  path is moved under it. Other values (a full address) are left alone. */
export function logoUrl(p: string): string {
  if (!p.startsWith("/") || p.startsWith("//")) return p;
  return import.meta.env.BASE_URL.replace(/\/$/, "") + p;
}
