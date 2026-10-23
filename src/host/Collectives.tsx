import { useState } from "react";
import { Check, Plus, Users, X } from "lucide-react";
import { app, collectives, edition, memberOf, shaped, type Edition } from "../edition";
import { joinCollective, leaveCollective, peek, switchCollective } from "./scope";
import { BRAND_PRESETS, logoUrl } from "./useSkin";
import { Button, List, Row, Section, Status } from "../ui";
import { GROUPS, GroupList, GroupMark, hereKey, openGroup } from "../demo/groups";

/**
 * The collectives this member keeps in one app (`./scope.ts`). Each opens in
 * its own space: its look, its plugins, its sign-in at its own door. Adding one
 * here only adds the space. Membership comes from signing in at that
 * collective's door, the same passkey flow as the home one.
 */

function logoOf(c: Edition): string {
  const preset = BRAND_PRESETS.find((p) => p.id === (c.defaultSkin || c.instance.slug));
  return preset?.skin.logo ? logoUrl(preset.skin.logo) : "";
}

function stored(c: Edition): any {
  try {
    return JSON.parse(peek(c.id, app.id, "murmur.identity.v1") || "null");
  } catch {
    return null;
  }
}

function signedInAs(c: Edition): string | null {
  const id = stored(c);
  if (!id?.signedIn || !id.session) return null;
  if (id.sessionExp && id.sessionExp < Date.now() / 1000) return null;
  return id.handle ?? "member";
}

/** Signed out because the door stopped accepting the session, or it ran out. */
function lapsedAs(c: Edition): string | null {
  const id = stored(c);
  if (id?.lapsedAs) return id.lapsedAs;
  if (id?.signedIn && id.sessionExp && id.sessionExp < Date.now() / 1000) return id.handle ?? "member";
  return null;
}

export function Mark({ c, size = "md" }: { c: Edition; size?: "sm" | "md" }) {
  const logo = logoOf(c);
  const box = size === "sm" ? "h-8 w-8 text-sm" : "h-10 w-10 text-base";
  return (
    <div
      className={`${box} flex shrink-0 items-center justify-center overflow-hidden rounded-[var(--radius)] border border-[var(--line-strong)] font-tight font-semibold`}
    >
      {logo ? <img src={logo} alt="" className="h-full w-full object-cover" /> : c.instance.name.slice(0, 1)}
    </div>
  );
}

const addable = () => collectives.filter((c) => !memberOf.some((m) => m.id === c.id));

/** The list itself, used by the rail's menu and by Profile. */
function CollectiveList() {
  const others = addable();
  return (
    <div className="flex flex-col gap-5">
      <List>
        {memberOf.map((c) => {
          const here = c.id === edition.id;
          const who = signedInAs(c);
          const lapsed = who ? null : lapsedAs(c);
          const host = new URL(c.signIn.approve).host;
          return (
            <Row
              key={c.id}
              title={c.instance.name}
              status={
                here ? (
                  <Status tone="ok">open</Status>
                ) : who ? (
                  <Status>signed in</Status>
                ) : (
                  <Status tone="warn">{lapsed ? "sign in again" : "not signed in"}</Status>
                )
              }
              detail={
                who
                  ? `As ${who}, with your passkey at ${host}.`
                  : lapsed
                    ? `Its sign-in for ${lapsed} has lapsed. One passkey tap at ${host} when you open it.`
                    : `Sign in with your passkey at ${host}.`
              }
              action={
                <>
                  {c.id !== app.id && (
                    <Button variant="quiet" onClick={() => leaveCollective(c.id, app.id)} title={`Take ${c.instance.name} out of this app`}>
                      Remove
                    </Button>
                  )}
                  {here ? (
                    <Check className="h-4 w-4 text-[var(--muted)]" />
                  ) : (
                    <Button onClick={() => switchCollective(c.id)}>Open</Button>
                  )}
                </>
              }
            />
          );
        })}
      </List>
      {others.length > 0 && (
        <List>
          {others.map((c) => (
            <Row
              key={c.id}
              title={c.instance.name}
              detail={`Add it if you're a member, or want to become one. You'll sign in at ${new URL(c.signIn.approve).host}.`}
              action={
                <Button variant="primary" icon={Plus} onClick={() => joinCollective(c.id)}>
                  Add
                </Button>
              }
            />
          ))}
        </List>
      )}
    </div>
  );
}

/** Profile's section: works on phones, where the rail has no mark. */
export function CollectivesSection() {
  if (collectives.length < 2) return null;
  return (
    <Section
      label="Collectives"
      icon={Users}
      lede="One app for every collective you belong to. Each keeps its own look, plugins and sign-in."
    >
      <CollectiveList />
    </Section>
  );
}

/** The mark at the top of the rail, which opens the switcher. */
export function CollectiveSwitcher({ name, logo: skinLogo }: { name: string; logo: string }) {
  const [open, setOpen] = useState(false);
  const logo = shaped && shaped.source !== "pack" ? "" : skinLogo || logoOf(edition);
  // The invented demo's sample member belongs to several groups (`demo/groups.tsx`).
  const sample = GROUPS.length > 0;
  const many = collectives.length > 1 || sample;
  return (
    <div data-tour="groups" className="contents md:flex md:shrink-0 md:flex-col md:items-center">
      <button
        onClick={() => many && setOpen(true)}
        title={many ? `${name}: switch collective` : name}
        className="prism-hover hidden h-10 w-10 shrink-0 items-center justify-center overflow-hidden rounded-[var(--radius)] border border-[var(--line-strong)] font-tight text-base font-semibold md:flex"
      >
        {logo ? <img src={logo} alt={name} className="h-full w-full object-cover" /> : name.slice(0, 1)}
      </button>
      {sample && (
        <div className="hidden flex-col items-center gap-1.5 md:mt-2 md:flex">
          {GROUPS.filter((g) => g.key !== hereKey).map((g) => (
            <button
              key={g.key}
              onClick={() => openGroup(g)}
              title={`Open ${g.name}, where Alice is ${g.role}`}
              className="prism-hover opacity-60 transition hover:opacity-100"
            >
              {g.archetype ? <GroupMark name={g.name} size="sm" /> : <Mark c={app} size="sm" />}
            </button>
          ))}
        </div>
      )}
      {!sample && memberOf.length > 1 && (
        <div className="hidden flex-col items-center gap-1.5 md:mt-2 md:flex">
          {memberOf
            .filter((c) => c.id !== edition.id)
            .map((c) => (
              <button
                key={c.id}
                onClick={() => switchCollective(c.id)}
                title={`Open ${c.instance.name}`}
                className="prism-hover opacity-60 transition hover:opacity-100"
              >
                <Mark c={c} size="sm" />
              </button>
            ))}
        </div>
      )}
      {open && (
        <div className="fixed inset-0 z-20 flex items-center justify-center bg-black/20 p-6" onClick={() => setOpen(false)}>
          <div
            className="max-h-[80vh] w-full max-w-lg overflow-y-auto rounded-[calc(var(--radius)+4px)] border border-[var(--line-strong)] bg-[var(--card)] shadow-[0_20px_80px_rgba(0,0,0,0.18)]"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between border-b border-[var(--line)] px-6 py-4">
              <div>
                <div className="font-tight text-lg font-medium">{sample ? "Alice's groups" : "Collectives"}</div>
                <p className="text-xs text-[var(--muted)]">
                  {sample
                    ? "One identity in every group. Each has its own plugins and rules, and her notes and record go with her."
                    : "Each keeps its own look, plugins and sign-in."}
                </p>
              </div>
              <button onClick={() => setOpen(false)} className="text-[var(--faint)] hover:text-[var(--fg)]">
                <X className="h-5 w-5" />
              </button>
            </div>
            <div className="p-4">
              {sample ? <GroupList /> : <CollectiveList />}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
