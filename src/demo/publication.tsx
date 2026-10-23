import { useState } from "react";
import { ArrowLeft, ArrowRight, BookOpen, HandHeart, Layers, MessageCircle, Newspaper, PenLine } from "lucide-react";
import type { PluginContext } from "../host/types";
import { edition, installs } from "../edition";
import { Button, Card, Notice, Page, PageBody, PageHeader, Section, Status } from "../ui";
import { RISO, sampleInitiatives, samplePublication, type SamplePiece } from "./sample";
import { logoUrl } from "../host/useSkin";
import { demoNote } from "./note";

/**
 * The invented organisation's own publication (`samplePublication`), in place
 * of Decent Magazine. It comes before the money on purpose: an idea is written
 * up here first, members read it and argue about it, and only then does it
 * become an initiative in Fundraise, with the piece beside it so anyone who
 * gives can see why. Each piece that argued for an initiative links to it, and
 * the initiative links back (`openPiece`).
 */

/** Whether this organisation raises money for its initiatives at all. */
const raises = installs(edition).includes("fundraise") && sampleInitiatives.length > 0;

// Fundraise asks for a piece to be open when the publication next draws.
let wanted: string | null = null;
export function openPiece(id: string, open: (plugin: string) => void) {
  wanted = id;
  open("magazine");
}

const money = (n = 0) =>
  new Intl.NumberFormat("en-GB", { style: "currency", currency: "GBP", maximumFractionDigits: 0 }).format(n);


// ── the printed look ────────────────────────────────────────────────────────
// The Review is the one place the demo goes into colour: each piece has its own
// ink, and the illustrations are members' own. Colour here is what people made.

const inkOf = (p: SamplePiece) => p.ink ?? RISO.blue;
const onInk = (ink: string) => (ink === RISO.yellow || ink === "#ff7a3d" ? "#1a1a1a" : "#ffffff");

// Members wear the three inks and the colours they make when printed over each other.
const MEMBER_INKS = [RISO.blue, RISO.pink, RISO.yellow, "#7b4fc4", "#1f9d6b", "#ff7a3d"];
const MEMBER_INK: Record<string, string> = {};
function memberInk(name: string) {
  MEMBER_INK[name] ??= MEMBER_INKS[Object.keys(MEMBER_INK).length % MEMBER_INKS.length];
  return MEMBER_INK[name];
}

function Face({ name, size = 28 }: { name: string; size?: number }) {
  const ink = memberInk(name);
  return (
    <span
      title={name}
      className="font-tight inline-flex shrink-0 items-center justify-center rounded-full font-medium ring-2 ring-[var(--card)]"
      style={{ width: size, height: size, background: ink, color: onInk(ink), fontSize: size * 0.42 }}
    >
      {name[0]}
    </span>
  );
}

function Faces({ names, size }: { names: string[]; size?: number }) {
  return (
    <span className="flex -space-x-1.5">
      {names.map((n) => (
        <Face key={n} name={n} size={size} />
      ))}
    </span>
  );
}

/** The piece's picture: a member's illustration, or (in a visitor's sketch) a block of its ink. */
function Plate({ piece, className = "" }: { piece: SamplePiece; className?: string }) {
  const ink = inkOf(piece);
  if (piece.art)
    return <img src={logoUrl(piece.art.src)} alt={piece.art.alt} loading="lazy" className={`block w-full object-cover ${className}`} />;
  return (
    <div
      aria-hidden
      className={`relative flex w-full items-end overflow-hidden ${className}`}
      style={{
        background: RISO.paper,
        backgroundImage: `radial-gradient(${ink} 1.6px, transparent 1.8px)`,
        backgroundSize: "9px 9px",
      }}
    >
      <span
        className="font-tight absolute -bottom-6 right-3 select-none text-[140px] font-medium leading-none opacity-90"
        style={{ color: ink, mixBlendMode: "multiply" }}
      >
        {piece.title[0]}
      </span>
    </div>
  );
}

function Replies({ piece }: { piece: SamplePiece }) {
  const r = piece.replies ?? [];
  if (!r.length) return null;
  return (
    <span className="font-mono flex items-center gap-1.5 whitespace-nowrap text-[11px] text-[var(--faint)]">
      <Faces names={[...new Set(r.map((x) => x.by))]} size={18} />
      {r.length} {r.length === 1 ? "reply" : "replies"}
    </span>
  );
}

function InkBar({ ink }: { ink: string }) {
  return <div className="h-1.5 w-full" style={{ background: ink }} />;
}

/** Everyone who made this issue: who wrote, who drew, who answered back. */
function madeBy(pieces: SamplePiece[]) {
  const roles = new Map<string, Set<string>>();
  const add = (n: string, r: string) => roles.set(n, (roles.get(n) ?? new Set()).add(r));
  pieces.forEach((p) => {
    add(p.by, "wrote");
    // a credited picture (a photograph, or one made for the sketch) is not a member's drawing
    if (p.art && !p.art.credit) add(p.art.by, "drew");
    p.replies?.forEach((r) => add(r.by, "replied"));
  });
  const order = ["wrote", "drew", "replied"];
  return [...roles].map(([name, r]) => ({ name, roles: order.filter((o) => r.has(o)) }));
}

function doing(crew: { roles: string[] }[]) {
  const words = { wrote: "wrote", drew: "drew", replied: "answered back" } as Record<string, string>;
  const used = ["wrote", "drew", "replied"].filter((r) => crew.some((c) => c.roles.includes(r))).map((r) => words[r]);
  return used.length > 1 ? `${used.slice(0, -1).join(", ")} and ${used.at(-1)}` : used[0] ?? "wrote";
}

function InitiativeCard({ piece, open }: { piece: SamplePiece; open: (id: string) => void }) {
  const i = sampleInitiatives.find((x) => x.id === piece.initiative);
  if (!i) return null;
  const state =
    i.status === "funded"
      ? { tone: "ok" as const, text: `funded · ${money(i.raised)} from ${i.donations} people` }
      : i.status === "proposed"
        ? { tone: "idle" as const, text: "an idea · needs someone to run it" }
        : { tone: "live" as const, text: `raising now · ${money(i.raised)} of ${money(i.target)}` };
  return (
    <Card tone="quiet">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0">
          <div className="font-mono text-[11px] uppercase tracking-wide text-[var(--faint)]">Makes the case for</div>
          <div className="font-tight mt-1 text-sm font-medium">{i.title}</div>
          <div className="mt-1">
            <Status tone={state.tone}>{state.text}</Status>
          </div>
        </div>
        <Button icon={HandHeart} trailing={ArrowRight} onClick={() => open("fundraise")}>
          {i.status === "open" ? "See it in Initiatives" : "Open Initiatives"}
        </Button>
      </div>
    </Card>
  );
}

/** A piece whose case led somewhere other than an initiative (Huxley's company, in Structure). */
function LeadsCard({ piece, open }: { piece: SamplePiece; open: (id: string) => void }) {
  const l = piece.leads;
  if (!l) return null;
  return (
    <Card tone="quiet">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0">
          <div className="font-mono text-[11px] uppercase tracking-wide text-[var(--faint)]">Made the case for</div>
          <div className="font-tight mt-1 text-sm font-medium">{l.title}</div>
          <div className="mt-1">
            <Status tone="live">{l.status}</Status>
          </div>
        </div>
        <Button icon={Layers} trailing={ArrowRight} onClick={() => open(l.plugin)}>
          {l.button}
        </Button>
      </div>
    </Card>
  );
}

function Reading({ piece, back, open }: { piece: SamplePiece; back: () => void; open: (id: string) => void }) {
  const pub = samplePublication!;
  const ink = inkOf(piece);
  const [first, ...more] = piece.body;
  return (
    <>
      <Button variant="quiet" icon={ArrowLeft} onClick={back}>
        {pub.name}
      </Button>
      <article className="max-w-prose">
        <figure className="overflow-hidden rounded-[var(--radius)] border border-[var(--line)]">
          <InkBar ink={ink} />
          <Plate piece={piece} className="aspect-[3/2]" />
          {piece.art && (
            <figcaption className="font-mono bg-[var(--card)] px-3 py-2 text-[11px] text-[var(--faint)]">
              {piece.art.credit ?? `Drawn by ${piece.art.by}, a member`}
            </figcaption>
          )}
        </figure>
        <h2 className="font-tight mt-6 text-[28px] font-medium leading-tight tracking-[-0.01em]">{piece.title}</h2>
        <p className="mt-3 text-[16px] leading-relaxed text-[var(--muted)]">{piece.dek}</p>
        <div className="mt-4 flex items-center gap-2">
          <Face name={piece.by} size={24} />
          <p className="font-mono text-[11px] text-[var(--faint)]">
            by {piece.by} · {piece.minutes} min · signed
          </p>
        </div>
        <div className="font-serif mt-6 flex flex-col gap-4 text-[16px] leading-[1.7]">
          <p>{first}</p>
          {piece.pull && (
            <blockquote
              className="font-tight my-2 border-l-[6px] py-1 pl-5 text-[22px] font-medium leading-snug tracking-[-0.01em]"
              style={{ borderColor: ink }}
            >
              {piece.pull}
            </blockquote>
          )}
          {more.map((p, n) => (
            <p key={n}>{p}</p>
          ))}
        </div>
      </article>
      <InitiativeCard piece={piece} open={open} />
      <LeadsCard piece={piece} open={open} />
      <Section label="Replies" icon={MessageCircle}>
        <div className="flex max-w-prose flex-col gap-2">
          {(piece.replies ?? []).map((r, n) => (
            <div key={n} className="flex gap-3 rounded-[var(--radius)] border border-[var(--line)] bg-[var(--card)] px-4 py-3">
              <Face name={r.by} />
              <div className="min-w-0">
                <div className="font-tight text-[13px] font-medium">{r.by}</div>
                <p className="mt-0.5 text-[14px] leading-relaxed text-[var(--muted)]">{r.text}</p>
              </div>
            </div>
          ))}
          <div>
            <Button
              icon={PenLine}
              onClick={() =>
                demoNote(`In your own app your reply is signed and kept beside the piece.`)
              }
            >
              {piece.replies?.length ? "Add a reply" : "Be the first to reply"}
            </Button>
          </div>
        </div>
      </Section>
    </>
  );
}

export function PublicationPanel({ open }: PluginContext) {
  const pub = samplePublication!;
  const [reading, setReading] = useState<string | null>(() => {
    const w = wanted;
    wanted = null;
    return w;
  });
  const piece = pub.pieces.find((p) => p.id === reading);
  const [lead, ...rest] = pub.pieces;
  const name = edition.instance.name;
  const crew = madeBy(pub.pieces);
  crew.forEach((c) => memberInk(c.name));

  return (
    <Page>
      <PageHeader
        icon={Newspaper}
        eyebrow={`${name.toLowerCase()}'s publication · sample`}
        title={`${pub.name} · ${pub.issue}`}
        lede={pub.line}
        actions={
          <Button
            icon={PenLine}
            onClick={() =>
              demoNote(
                `In your own app you write it here, signed with your passkey. You choose who may use it.`,
              )
            }
          >
            Write for the next issue
          </Button>
        }
      />
      <PageBody>
        {piece ? (
          <Reading piece={piece} back={() => setReading(null)} open={open} />
        ) : (
          <>
            <Notice>
              {name}'s own publication. Ideas are argued here first
              {raises ? ", and the agreed ones become initiatives" : ", before anything is decided"}. Sample pieces and people.
            </Notice>

            <figure
              className="overflow-hidden rounded-[var(--radius)] border border-[var(--line)]"
              style={{ background: RISO.paper }}
            >
              <div className="flex">
                {[RISO.pink, RISO.blue, RISO.yellow].map((c) => (
                  <div key={c} className="h-2 flex-1" style={{ background: c }} />
                ))}
              </div>
              <div className="relative">
                {pub.cover ? (
                  <img src={logoUrl(pub.cover.src)} alt={pub.cover.alt} className="block aspect-[3/2] w-full object-cover sm:aspect-[21/9]" />
                ) : (
                  <Plate piece={{ ...lead, title: pub.name, art: undefined, ink: RISO.pink }} className="aspect-[21/9]" />
                )}
                <div className="absolute bottom-3 left-3 max-w-[80%] rounded-[4px] px-3 py-2 sm:bottom-5 sm:left-5 sm:px-4 sm:py-3" style={{ background: RISO.paper }}>
                  <div className="font-mono text-[10px] uppercase tracking-wide" style={{ color: RISO.blue }}>
                    {pub.issue}
                  </div>
                  <div className="font-tight text-[20px] font-medium leading-tight tracking-[-0.01em] text-[#1a1a1a] sm:text-[28px]">
                    {pub.name}
                  </div>
                </div>
              </div>
              {pub.cover && (
                <figcaption className="font-mono px-3 py-2 text-[11px] text-[#6b6455]">{pub.cover.credit ?? `Cover by ${pub.cover.by}, a member`}</figcaption>
              )}
            </figure>

            <Card>
              <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <div className="min-w-0">
                  <div className="font-mono text-[11px] uppercase tracking-wide text-[var(--faint)]">Made together</div>
                  <p className="mt-1 text-[13px] leading-relaxed text-[var(--muted)]">
                    {crew.length} members {doing(crew)}. Each signed their own work.
                  </p>
                </div>
                <div className="flex flex-wrap gap-x-4 gap-y-2">
                  {crew.map((c) => (
                    <div key={c.name} className="flex items-center gap-2">
                      <Face name={c.name} size={30} />
                      <div className="leading-tight">
                        <div className="font-tight text-[13px] font-medium">{c.name}</div>
                        <div className="font-mono text-[10px] text-[var(--faint)]">{c.roles.join(" · ")}</div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </Card>

            <button
              onClick={() => setReading(lead.id)}
              className="prism-hover group grid overflow-hidden rounded-[var(--radius)] border border-[var(--line)] bg-[var(--card)] text-left transition sm:grid-cols-[1.1fr_1fr]"
            >
              <div className="relative">
                <Plate piece={lead} className="aspect-[3/2] h-full" />
              </div>
              <div className="flex flex-col border-t-[6px] px-6 py-6 sm:border-l-[6px] sm:border-t-0" style={{ borderColor: inkOf(lead) }}>
                <div className="font-mono text-[11px] uppercase tracking-wide text-[var(--faint)]">
                  Lead · {lead.minutes} min
                </div>
                <h2 className="font-tight mt-2 text-[24px] font-medium leading-tight tracking-[-0.01em]">{lead.title}</h2>
                <p className="mt-2 text-[15px] leading-relaxed text-[var(--muted)]">{lead.dek}</p>
                <div className="mt-auto flex flex-wrap items-center gap-3 pt-4">
                  <span className="flex items-center gap-2 text-[12px] text-[var(--muted)]">
                    <Face name={lead.by} size={22} /> {lead.by}
                  </span>
                  <Replies piece={lead} />
                  {(lead.initiative || lead.leads) && (
                    <Status tone="live">{lead.leads ? `made the case for ${lead.leads.title.split(",")[0]}` : "makes the case for an initiative"}</Status>
                  )}
                </div>
              </div>
            </button>

            {rest.length > 0 && (
              <Section label="In this issue" icon={BookOpen}>
                <div className="grid gap-3 sm:grid-cols-2">
                  {rest.map((p, n) => (
                    <button
                      key={p.id}
                      onClick={() => setReading(p.id)}
                      className={`prism-hover flex flex-col overflow-hidden rounded-[var(--radius)] border border-[var(--line)] bg-[var(--card)] text-left transition ${n === rest.length - 1 && rest.length % 2 ? "sm:col-span-2" : ""}`}
                    >
                      <InkBar ink={inkOf(p)} />
                      <Plate piece={p} className={n === rest.length - 1 && rest.length % 2 ? "aspect-[2/1] sm:aspect-[4/1]" : "aspect-[2/1]"} />
                      <div className="flex flex-1 flex-col px-5 py-4">
                        <div className="font-tight text-[15px] font-medium leading-snug">{p.title}</div>
                        <p className="mt-1.5 text-[13px] leading-relaxed text-[var(--muted)]">{p.dek}</p>
                        <div className="mt-auto flex flex-wrap items-center gap-x-3 gap-y-1.5 pt-3">
                          <span className="font-mono flex items-center gap-1.5 text-[11px] text-[var(--faint)]">
                            <Face name={p.by} size={20} /> <span className="whitespace-nowrap">{p.by} · {p.minutes} min{p.initiative ? " · an initiative" : ""}</span>
                          </span>
                          <Replies piece={p} />
                        </div>
                      </div>
                    </button>
                  ))}
                </div>
              </Section>
            )}

            <Card tone="dashed">
              <p className="text-[13px] leading-relaxed text-[var(--muted)]">
                Every piece is signed and kept in {name}'s record, with what its writer agreed it may be used for.
                {raises && " Initiatives shows the ones members agreed on."}
              </p>
            </Card>
          </>
        )}
      </PageBody>
    </Page>
  );
}
