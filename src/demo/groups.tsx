import { Check } from "lucide-react";
import { edition, packShape, shaped, showcaseName } from "../edition";
import { Button, List, Row, Status } from "../ui";
import { archetypeShape, RESET, SHAPE_KEY, type ArchetypeKey } from "./shape";

/**
 * The sample member's other groups (invented demo only). Alice is a steward of
 * the showcase collective, and also freelances for a company, volunteers at a
 * community hall and owns a share of a co-op. Opening one reshapes the demo as
 * that group, from the templates in `shape.ts`, the way a visitor's sketch
 * does, but keeps the walkthrough's place and her notes: one identity, many
 * groups. A real member's groups are `host/Collectives.tsx`.
 */

export interface SampleGroup {
  key: string;
  name: string;
  kind: string;
  /** what Alice is there */
  role: string;
  line: string;
  archetype: ArchetypeKey | null;
}

const HOME = "home";

export const GROUPS: SampleGroup[] = edition.showcase
  ? [
      {
        key: HOME,
        name: showcaseName,
        ...(packShape?.member ?? {
          kind: "Studio collective",
          role: "a steward",
          line: "Where she makes things. She helped raise the roof and voted for the company.",
        }),
        archetype: null,
      },
      {
        key: "halfmoon",
        name: "Halfmoon Pictures",
        kind: "Production company",
        role: "a freelance sound recordist",
        line: "Location sound on two documentaries. She sees only her projects.",
        archetype: "production",
      },
      {
        key: "northside",
        name: "Northside Commons",
        kind: "Community",
        role: "a volunteer",
        line: "Her street's hall. She runs sound for Saturday gigs.",
        archetype: "local",
      },
      {
        key: "loaf",
        name: "Common Loaf",
        kind: "Co-operative",
        role: "one of its owners",
        line: "The food co-op on her road. A shift a month and a vote.",
        archetype: "coop",
      },
    ]
  : [];

/** The group this window shows, when it is one of Alice's. A visitor's own sketch is none of them. */
export const hereKey: string | null = !edition.showcase ? null : shaped && shaped.source !== "pack" ? (shaped.alice ?? null) : HOME;
export const hereGroup = GROUPS.find((g) => g.key === hereKey) ?? null;

/** Open another of her groups. Her notes stay, and so does the walkthrough's place. */
export function openGroup(g: SampleGroup) {
  if (g.archetype) localStorage.setItem(SHAPE_KEY, JSON.stringify(archetypeShape(g.archetype, { name: g.name, alice: g.key })));
  else localStorage.removeItem(SHAPE_KEY);
  for (const k of RESET) if (k !== "murmur.tour.v1") localStorage.removeItem(k);
  location.reload();
}

export function GroupMark({ name, size = "md" }: { name: string; size?: "sm" | "md" }) {
  const box = size === "sm" ? "h-8 w-8 text-[11px]" : "h-10 w-10 text-sm";
  return (
    <div
      className={`${box} flex shrink-0 items-center justify-center rounded-[var(--radius)] border border-[var(--line-strong)] font-tight font-semibold`}
    >
      {name.split(/\s+/).slice(0, 2).map((w) => w[0]).join("")}
    </div>
  );
}

/** Her groups as a list, for the rail's menu and for Profile. */
export function GroupList() {
  return (
    <List>
      {!hereGroup && shaped && (
        <Row title={shaped.name} status={<Status tone="ok">open</Status>} detail="Sketched from what you told us." />
      )}
      {GROUPS.map((g) => {
        const here = g.key === hereKey;
        return (
          <Row
            key={g.key}
            title={g.name}
            status={here ? <Status tone="ok">open</Status> : <Status>{g.kind}</Status>}
            detail={`Alice is ${g.role}. ${g.line}`}
            action={here ? <Check className="h-4 w-4 text-[var(--muted)]" /> : <Button onClick={() => openGroup(g)}>Open</Button>}
          />
        );
      })}
    </List>
  );
}
