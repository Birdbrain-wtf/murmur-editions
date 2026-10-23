import type { LucideIcon } from "lucide-react";
import { Mic, PenLine, Vote, Layers, Lock } from "lucide-react";
import type { ReactNode } from "react";

/**
 * The top of Profile: a person's mark, name and what they've done, drawn so the
 * page reads as someone's own rather than an account screen. The mark is
 * generated from who they are and what they've contributed: one ring per kind
 * of contribution, one tick per thing, so it grows as they take part.
 */

export type Kind = "call" | "writing" | "decision" | "work" | "private";

export const KINDS: Record<Kind, { label: string; plural: string; colour: string; icon: LucideIcon }> = {
  call: { label: "call", plural: "calls joined", colour: "#007aff", icon: Mic },
  writing: { label: "piece", plural: "pieces written", colour: "#ff9500", icon: PenLine },
  decision: { label: "vote", plural: "votes and decisions", colour: "#34c759", icon: Vote },
  work: { label: "piece of work", plural: "pieces of work shared", colour: "#af52de", icon: Layers },
  private: { label: "private", plural: "kept private", colour: "#8a8a8a", icon: Lock },
};

function hash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
}

function rand(seed: number) {
  let t = seed;
  return () => {
    t = (t + 0x6d2b79f5) >>> 0;
    let r = Math.imul(t ^ (t >>> 15), 1 | t);
    r ^= r + Math.imul(r ^ (r >>> 7), 61 | r);
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };
}

export function IdentityMark({
  seed,
  initial,
  counts,
  size = 120,
}: {
  seed: string;
  initial: string;
  counts: Partial<Record<Kind, number>>;
  size?: number;
}) {
  const r = rand(hash(seed));
  const kinds = (["call", "writing", "decision", "work"] as Kind[]).filter((k) => (counts[k] ?? 0) > 0);
  const c = 60;
  return (
    <svg viewBox="0 0 120 120" width={size} height={size} className="shrink-0" role="img" aria-label={`${initial}'s mark`}>
      <circle cx={c} cy={c} r={58} fill="var(--raise)" stroke="var(--line)" />
      {kinds.length === 0 &&
        [44, 34].map((rad) => <circle key={rad} cx={c} cy={c} r={rad} fill="none" stroke="var(--line-strong)" strokeDasharray="2 4" />)}
      {kinds.map((k, ring) => {
        const rad = 52 - ring * 9;
        const n = Math.min(counts[k] ?? 0, 48);
        const start = r() * Math.PI * 2;
        const sweep = Math.PI * 2 * (0.35 + 0.65 * Math.min(1, n / 24));
        return (
          <g key={k}>
            <circle cx={c} cy={c} r={rad} fill="none" stroke="var(--line)" />
            {Array.from({ length: n }, (_, i) => {
              const a = start + (sweep * i) / Math.max(1, n - 1 || 1);
              const len = 3 + r() * 3;
              return (
                <line
                  key={i}
                  x1={c + Math.cos(a) * (rad - len / 2)}
                  y1={c + Math.sin(a) * (rad - len / 2)}
                  x2={c + Math.cos(a) * (rad + len / 2)}
                  y2={c + Math.sin(a) * (rad + len / 2)}
                  stroke={KINDS[k].colour}
                  strokeWidth={2.2}
                  strokeLinecap="round"
                />
              );
            })}
          </g>
        );
      })}
      <circle cx={c} cy={c} r={kinds.length ? 52 - kinds.length * 9 + 2 : 24} fill="var(--card)" stroke="var(--line-strong)" />
      <text
        x={c}
        y={c}
        textAnchor="middle"
        dominantBaseline="central"
        className="font-tight"
        style={{ fontSize: kinds.length > 3 ? 18 : 22, fontWeight: 500, fill: "var(--fg)" }}
      >
        {initial}
      </text>
    </svg>
  );
}

/** A year of taking part, a square a day. The regular call's weekday
 *  stands out because that's when most people show up. */
export function Activity({ seed, weekday, caption }: { seed: string; weekday?: number; caption?: ReactNode }) {
  const r = rand(hash(seed + "/activity"));
  const weeks = 52;
  const cells = Array.from({ length: weeks * 7 }, (_, i) => {
    const day = i % 7;
    const week = Math.floor(i / 7);
    const ramp = 0.4 + (0.6 * week) / weeks;
    let v = r() < 0.45 * ramp ? r() * 0.6 : 0;
    if (weekday != null && day === weekday % 7 && r() < 0.9) v = 0.7 + r() * 0.3;
    return v;
  });
  return (
    <div>
      <div className="grid gap-[2px]" style={{ gridTemplateColumns: `repeat(${weeks}, minmax(0, 1fr))` }}>
        {Array.from({ length: weeks }, (_, w) => (
          <div key={w} className="flex flex-col gap-[2px]">
            {cells.slice(w * 7, w * 7 + 7).map((v, d) => (
              <span
                key={d}
                className="block aspect-square w-full rounded-[2px]"
                style={{
                  background: v === 0 ? "var(--line)" : `color-mix(in srgb, var(--fg) ${Math.round(18 + v * 72)}%, transparent)`,
                }}
              />
            ))}
          </div>
        ))}
      </div>
      {caption && <p className="mt-2 text-[11px] text-[var(--faint)]">{caption}</p>}
    </div>
  );
}

export function ProfileHero({
  seed,
  name,
  line,
  chips,
  counts,
  stats,
  activity,
}: {
  seed: string;
  name: string;
  line: ReactNode;
  chips?: string[];
  counts?: Partial<Record<Kind, number>>;
  stats?: [string, string][];
  activity?: ReactNode;
}) {
  const kinds = (["call", "writing", "decision", "work"] as Kind[]).filter((k) => (counts?.[k] ?? 0) > 0);
  return (
    <div className="overflow-hidden rounded-[var(--radius)] border border-[var(--line)] bg-[var(--card)]">
      <div className="spectrum-bar h-1" />
      <div className="flex flex-col gap-5 px-5 py-5 sm:flex-row sm:items-center">
        <IdentityMark seed={seed} initial={name.slice(0, 1).toUpperCase()} counts={counts ?? {}} />
        <div className="min-w-0 flex-1">
          <div className="font-tight text-2xl font-medium tracking-tight">{name}</div>
          <div className="mt-1 text-[13px] leading-relaxed text-[var(--muted)]">{line}</div>
          {chips && chips.length > 0 && (
            <div className="mt-3 flex flex-wrap gap-1.5">
              {chips.map((c) => (
                <span key={c} className="rounded-full border border-[var(--line-strong)] px-2.5 py-0.5 text-[11px] text-[var(--muted)]">
                  {c}
                </span>
              ))}
            </div>
          )}
          {kinds.length > 0 && (
            <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-[var(--muted)]">
              {kinds.map((k) => (
                <span key={k} className="inline-flex items-center gap-1.5">
                  <span className="h-2 w-2 rounded-full" style={{ background: KINDS[k].colour }} />
                  {counts![k]} {KINDS[k].plural}
                </span>
              ))}
            </div>
          )}
        </div>
      </div>
      {stats && stats.length > 0 && (
        <div className="grid grid-cols-2 border-t border-[var(--line)] sm:grid-cols-4">
          {stats.map(([n, l], i) => (
            <div key={l} className={`px-5 py-3 ${i % 2 ? "border-l" : ""} ${i > 1 ? "border-t sm:border-t-0" : ""} ${i === 2 ? "sm:border-l" : ""} border-[var(--line)]`}>
              <div className="font-tight text-xl font-medium">{n}</div>
              <div className="text-[11px] text-[var(--faint)]">{l}</div>
            </div>
          ))}
        </div>
      )}
      {activity && <div className="border-t border-[var(--line)] px-5 py-4">{activity}</div>}
    </div>
  );
}
