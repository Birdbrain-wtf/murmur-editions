import { useState } from "react";
import { edition, shaped } from "../edition";
import { getModule } from "../host/registry";
import { demoNote } from "./note";

/**
 * Who can use what, as a sample (demo editions only). Each plugin a collective
 * runs gets a level for each kind of member, so a resident can join the calls
 * without reading the books, and a guest sees only what they were invited to.
 *
 * This is a design shown with sample data, not a working control: the live
 * app has no per-plugin levels yet. A change here says what it would do in a
 * real app (a proposal the stewards approve, recorded) and keeps the new value
 * on screen only.
 */

export type { Level } from "./shape";
import type { Level } from "./shape";

export const LEVELS: { id: Level; label: string; line: string }[] = [
  { id: "none", label: "No access", line: "doesn't see it" },
  { id: "see", label: "See", line: "reads, can't change anything" },
  { id: "join", label: "Take part", line: "posts, joins, contributes" },
  { id: "run", label: "Run", line: "sets it up and approves" },
];

const HUXLEY_ROLES: { id: string; name: string; who: string; line: string }[] = [
  { id: "steward", name: "Stewards", who: "Alice and 2 others", line: "look after the building and approve spending" },
  { id: "member", name: "Members", who: "Bob and 17 others", line: "vote on what Huxley does" },
  { id: "resident", name: "Residents", who: "Carol and 3 others", line: "work in the building, no vote" },
  { id: "investor", name: "Investors", who: "in Huxley Sessions Ltd", line: "see the company's books and their own holding" },
  { id: "guest", name: "Guests", who: "invited one at a time", line: "see only what they're invited to" },
];

/** The sample: one row per plugin, one level per role, in `ROLES` order. */
const HUXLEY_LEVELS: Record<string, Level[]> = {
  agent: ["run", "join", "join", "none", "none"],
  magazine: ["run", "join", "join", "see", "see"],
  fundraise: ["run", "join", "join", "see", "see"],
  spend: ["run", "see", "none", "none", "none"],
  chat: ["run", "join", "join", "none", "join"],
  meet: ["run", "join", "join", "none", "join"],
  operations: ["run", "see", "none", "see", "none"],
  structure: ["run", "see", "none", "see", "none"],
};

// A visitor's sketch brings its own kinds of people and their levels.
export const ROLES = shaped
  ? shaped.roles.map((r, i) => ({ id: `r${i}`, name: r.name, who: r.who, line: r.line }))
  : HUXLEY_ROLES;
const SAMPLE: Record<string, Level[]> = shaped
  ? Object.fromEntries(["agent", ...shaped.plugins].map((id) => [id, shaped!.roles.map((r) => r.levels[id] ?? "see")]))
  : HUXLEY_LEVELS;

/** Alice is a steward. */
export const sampleRole = ROLES[0];
export const levelFor = (plugin: string): Level => SAMPLE[plugin]?.[0] ?? "join";
export const labelOf = (l: Level) => LEVELS.find((x) => x.id === l)!.label;

const next = (l: Level): Level => LEVELS[(LEVELS.findIndex((x) => x.id === l) + 1) % LEVELS.length].id;

export function AccessTable({ installed }: { installed: string[] }) {
  const name = edition.instance.name;
  const rows = Object.keys(SAMPLE).filter((id) => installed.includes(id) && getModule(id));
  const [grid, setGrid] = useState(SAMPLE);

  function turn(plugin: string, i: number) {
    setGrid((g) => ({ ...g, [plugin]: g[plugin].map((l, j) => (j === i ? next(l) : l)) }));
    demoNote(
      `In your own app this is a proposal. The stewards approve it with a passkey and it goes into ${name}'s record.`,
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <p className="px-1 text-[13px] leading-relaxed text-[var(--muted)]">
        Each plugin has its own levels.{" "}
        {shaped
          ? `${ROLES[0].name} can run everything, and ${ROLES[ROLES.length - 1].name.toLowerCase()} see only what they're given.`
          : "A resident joins calls but can't read the books. An investor sees the company's books, not the members' chat."}{" "}
        Tap a level to change it.
      </p>

      <div className="overflow-x-auto rounded-[var(--radius)] border border-[var(--line)]">
        <table className="w-full min-w-[30rem] border-collapse text-left text-[12px]">
          <thead>
            <tr className="border-b border-[var(--line)]">
              <th className="px-3 py-2.5 font-normal text-[var(--faint)]">Plugin</th>
              {ROLES.map((r) => (
                <th key={r.id} className="px-2 py-2.5 align-bottom font-normal" title={r.line}>
                  <div className="font-tight text-[13px] font-medium text-[var(--fg)]">{r.name}</div>
                  <div className="text-[11px] text-[var(--faint)]">{r.who}</div>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((id) => {
              const m = getModule(id)!;
              const Icon = m.icon;
              return (
                <tr key={id} className="border-b border-[var(--line)] last:border-b-0">
                  <td className="px-3 py-2">
                    <span className="flex items-center gap-2">
                      <Icon className="h-4 w-4 shrink-0 text-[var(--muted)]" />
                      <span className="font-tight text-[13px]">{m.title}</span>
                    </span>
                  </td>
                  {grid[id].map((l, i) => (
                    <td key={i} className="px-2 py-2">
                      <button
                        onClick={() => turn(id, i)}
                        title={`${ROLES[i].name}: ${labelOf(l)}, ${LEVELS.find((x) => x.id === l)!.line}. Tap to change.`}
                        data-level={l}
                        className="prism-hover whitespace-nowrap rounded-full border px-2.5 py-1 font-mono text-[11px] transition data-[level=none]:border-dashed data-[level=none]:border-[var(--line)] data-[level=none]:text-[var(--faint)] data-[level=see]:border-[var(--line-strong)] data-[level=see]:text-[var(--muted)] data-[level=join]:border-[var(--line-strong)] data-[level=join]:text-[var(--fg)] data-[level=run]:border-[var(--fg)] data-[level=run]:text-[var(--fg)]"
                      >
                        {labelOf(l)}
                      </button>
                    </td>
                  ))}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <dl className="grid grid-cols-1 gap-x-6 gap-y-1 px-1 text-[12px] sm:grid-cols-2">
        {LEVELS.map((l) => (
          <div key={l.id} className="flex gap-2">
            <dt className="font-mono text-[var(--fg)]">{l.label}</dt>
            <dd className="text-[var(--muted)]">{l.line}</dd>
          </div>
        ))}
      </dl>

      <p className="px-1 text-[12px] leading-relaxed text-[var(--faint)]">
        A sample. In your own app each change is approved and recorded, so anyone can see who could do what, and when.
      </p>
    </div>
  );
}
