import { ArrowRight, Bot, Check, Circle, Landmark, Layers, UserRound, Users } from "lucide-react";
import type { MurmurModule, PluginContext } from "../../host/types";
import { issues } from "../../host/support";
import { edition, shaped } from "../../edition";
import { demoNote } from "../../demo/note";
import { sampleIncorporated } from "../../demo/sample";
import { FORM_INFO, STAGES, type Form, type Who } from "../../demo/shape";
import { Button, Card, Empty, List, Notice, Page, PageBody, PageHeader, Row, Section, Status } from "../../ui";

/**
 * Structure: an organisation grows in stages, from a few people and an idea to
 * a group, then a legal form, then running it, and each stage is set up when
 * it is needed rather than all at the start. When a group needs a legal form
 * (a bank account, a grant, a lease, investment), agents draft the papers from
 * what it already does, people from Decent check what needs a person, and the
 * members approve it with their passkeys. It is a plugin like any other.
 *
 * Demo only for now: the ladder, the forms and each path are a design with
 * sample data (Huxley's own, or a visitor's sketch from `demo/shape.ts`).
 */

interface Path {
  now: number;
  next: Form;
  why: string;
  /** how far along the next step is: indexes of steps done, and the one in hand */
  done: number[];
  doing?: number;
  /** what happened at each stage already passed */
  history: string[];
}

// Huxley, the invented studio collective: a group with no legal form for years,
// raising gifts for what belongs to everyone, until its travelling studio started
// earning and needed investors. That part became a company; the collective did not.
const HUXLEY: Path = {
  now: 2,
  next: "company",
  why: "The travelling kit outgrew gifts. Schools and care homes pay for sessions, and ten kits need about £150,000. That takes investors, and SEIS relief needs a young UK company. So the sessions became Huxley Sessions Ltd. The collective stays a group and holds a tenth.",
  done: [0, 1, 2],
  doing: 3,
  history: [
    "Six people renting desks, with a group chat and a shared notebook.",
    "An agreement, a weekly call and a shared record. With no legal form, members raised £18,420 for the roof, £9,350 for bursaries and £3,410 for a travelling kit.",
    `Huxley Sessions Ltd, registered ${new Date(`${sampleIncorporated}T00:00:00Z`).toLocaleDateString("en-GB", { day: "numeric", month: "long", timeZone: "UTC" })} after a members' vote, fifteen to two. The collective holds a tenth.`,
  ],
};

function pathFor(): Path {
  if (shaped)
    return {
      now: shaped.stage.now,
      next: shaped.stage.next,
      why: shaped.stage.why,
      done: [],
      history: [],
    };
  return HUXLEY;
}

const WHO: Record<Who, { label: string; icon: typeof Bot; line: string }> = {
  agent: { label: "the agent", icon: Bot, line: "drafts, files and keeps the dates" },
  expert: { label: "someone from Decent", icon: UserRound, line: "checks what needs a person" },
  members: { label: "your members", icon: Users, line: "decide, with a passkey" },
};

function Ladder({ path }: { path: Path }) {
  return (
    <ol className="flex flex-col">
      {STAGES.map((st, n) => {
        const state = n < path.now ? "done" : n === path.now ? "now" : "later";
        return (
          <li key={st.title} className="flex gap-4">
            <div className="flex flex-col items-center">
              <span
                data-state={state}
                className="mt-1 flex h-6 w-6 shrink-0 items-center justify-center rounded-full border text-[11px] data-[state=done]:border-[var(--ink,var(--fg))] data-[state=done]:bg-[var(--ink,transparent)] data-[state=done]:text-[var(--ink-on,currentColor)] data-[state=later]:border-dashed data-[state=later]:border-[var(--line-strong)] data-[state=now]:border-2 data-[state=now]:border-[var(--ink,var(--accent))] data-[state=now]:font-semibold data-[state=now]:text-[var(--fg)]"
              >
                {state === "done" ? <Check className="h-3.5 w-3.5" /> : n + 1}
              </span>
              {n < STAGES.length - 1 && <span className="my-1 w-px flex-1 bg-[var(--line)]" />}
            </div>
            <div className="min-w-0 pb-5">
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                <span className={`font-tight text-sm ${state === "later" ? "text-[var(--muted)]" : "font-medium"}`}>{st.title}</span>
                {state === "now" && (
                  <Status tone="live">{edition.showcase && !shaped ? "Huxley Sessions" : edition.instance.name} is here</Status>
                )}
              </div>
              <p className="mt-1 text-[13px] leading-relaxed text-[var(--muted)]">{st.line}</p>
              {path.history[n] && (
                <p className="mt-1.5 border-l-2 border-[var(--line-strong)] pl-3 text-[12px] text-[var(--faint)]">{path.history[n]}</p>
              )}
            </div>
          </li>
        );
      })}
    </ol>
  );
}

function Panel({ open }: PluginContext) {
  const name = edition.instance.name;
  const path = pathFor();
  const next = path.next !== "none" ? FORM_INFO[path.next] : null;

  return (
    <Page>
      <PageHeader
        icon={Layers}
        eyebrow="structure · sample"
        title="Grow in stages"
        lede={`Start with nothing. When ${name} needs a legal form, the agent drafts it, someone from Decent checks it and members approve it.`}
      />
      <PageBody>
        <Notice>Sample people and dates. The stages are real, the forms are the UK's.</Notice>

        <Section label={`Where ${name} is`} icon={Layers}>
          <Card>
            <Ladder path={path} />
          </Card>
        </Section>

        {next ? (
          <Section label={`${path.done.length ? "Under way" : "Next"}: ${next.title.toLowerCase()}`} icon={Landmark} lede={path.why}>
            <List>
              {next.steps.map((st, n) => {
                const who = WHO[st.who];
                const state = path.done.includes(n) ? "done" : path.doing === n ? "doing" : "to do";
                return (
                  <Row
                    key={st.what}
                    icon={state === "done" ? Check : state === "doing" ? who.icon : Circle}
                    title={st.what}
                    status={<Status tone={state === "done" ? "ok" : state === "doing" ? "live" : "idle"}>{state}</Status>}
                    detail={`By ${who.label}`}
                  />
                );
              })}
            </List>
            <div className="mt-3 flex flex-wrap gap-2">
              <Button
                variant="primary"
                onClick={() =>
                  demoNote(
                    `In your own app the agent drafts from ${name}'s record. Any expert time shows in Billing before it's spent.`,
                  )
                }
              >
                {path.done.length ? "Carry on" : "Start this step"}
              </Button>
              {!shaped && edition.showcase && (
                <Button trailing={ArrowRight} onClick={() => open("operations")}>
                  See its books and first round
                </Button>
              )}
            </div>
          </Section>
        ) : (
          <Empty>
            {name} has the form it needs. Structure keeps its registers and filings up to date.
          </Empty>
        )}

        <Section label="Who does the work" lede="Nobody does the paperwork as a second job.">
          <div className="grid gap-3 sm:grid-cols-3">
            {(Object.keys(WHO) as Who[]).map((k) => {
              const w = WHO[k];
              const Icon = w.icon;
              return (
                <Card key={k}>
                  <Icon className="h-4 w-4 text-[var(--muted)]" />
                  <div className="font-tight mt-2 text-sm font-medium first-letter:uppercase">{w.label}</div>
                  <p className="mt-1 text-[12px] leading-relaxed text-[var(--muted)]">{w.line}</p>
                </Card>
              );
            })}
          </div>
        </Section>

        <Section label="Forms it could take" icon={Landmark}>
          <List>
            {(Object.keys(FORM_INFO) as Exclude<Form, "none">[]).map((f) => (
              <Row
                key={f}
                title={FORM_INFO[f].title}
                status={f === path.next ? <Status tone="live">{path.done.length ? "under way" : `next for ${name}`}</Status> : undefined}
                detail={FORM_INFO[f].line}
              />
            ))}
          </List>
        </Section>
      </PageBody>
    </Page>
  );
}

export const structurePlugin: MurmurModule = {
  id: "structure",
  title: "Structure",
  tagline: "Grow from a few people to an organisation, in stages",
  icon: Layers,
  order: 34,
  kind: "plugin",
  lab: true,
  support: issues("structure"),
  backend: "agents and Decent's experts, approved by your members",
  Panel,
};
