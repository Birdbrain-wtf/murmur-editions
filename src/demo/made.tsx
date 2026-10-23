import {
  ArrowLeft,
  BookOpen,
  Briefcase,
  CalendarDays,
  ClipboardList,
  Clapperboard,
  Disc3,
  Heart,
  Image as ImageIcon,
  MapPin,
  Package,
  Play,
  Share2,
  Sprout,
  Store,
  Ticket,
  Tv,
  Users,
  Wrench,
  type LucideIcon,
} from "lucide-react";
import { useState } from "react";
import type { MurmurModule, PluginContext } from "../host/types";
import { email } from "../host/support";
import { edition, shaped } from "../edition";
import { Button, Card, Empty, List, Notice, Page, PageBody, PageHeader, Row, Section, Status } from "../ui";
import { filmSrc, type Film, type IconName, type Made, type Profile, type Release, type ReleaseKind, type Shape } from "./shape";
import { demoNote } from "./note";
import { logoUrl } from "../host/useSkin";

/**
 * A plugin made for one organisation's own work, sketched for a visitor's group
 * ("What are you looking for?", `./shape.ts`): Events for a venue, Projects for
 * a production company, a Rota for volunteers. It shows what the plugin would
 * hold, with sample items. In a real app it is built for the group as a custom
 * plugin, by Decent's builders and agents.
 *
 * A pack may give a made plugin `profiles`: artist pages, each with its films,
 * photographs, records and events in one place (Four To The Floor's ask, 2026-10-18:
 * the film and the record are one story, so they live on one page and the
 * person the film moves buys the record in one tap). The films play from the
 * group's own Stream account. Buying is sample only.
 */

const ICON: Record<IconName, LucideIcon> = {
  calendar: CalendarDays,
  briefcase: Briefcase,
  users: Users,
  package: Package,
  "map-pin": MapPin,
  clipboard: ClipboardList,
  film: Clapperboard,
  heart: Heart,
  store: Store,
  sprout: Sprout,
  book: BookOpen,
  wrench: Wrench,
  tv: Tv,
};

const SHELF: Record<ReleaseKind, { label: string; icon: LucideIcon; one: string; many: string }> = {
  film: { label: "Films", icon: Clapperboard, one: "film", many: "films" },
  photograph: { label: "Photographs", icon: ImageIcon, one: "photograph", many: "photographs" },
  record: { label: "Records", icon: Disc3, one: "record", many: "records" },
  event: { label: "Events", icon: Ticket, one: "event", many: "events" },
};
const ORDER: ReleaseKind[] = ["film", "photograph", "record", "event"];

function count(p: Profile): string {
  const parts = ORDER.map((k) => {
    const n = p.releases.filter((r) => r.kind === k).length;
    return n ? `${n} ${n === 1 ? SHELF[k].one : SHELF[k].many}` : "";
  }).filter(Boolean);
  return parts.join(" · ");
}

function Player({ film, hero, title }: { film?: Film; hero?: Profile["hero"]; title: string }) {
  if (film)
    return (
      <figure className="overflow-hidden rounded-[var(--radius)] border border-[var(--line)] bg-black">
        <iframe
          key={film.id}
          src={filmSrc(film)}
          title={title}
          allow="autoplay; fullscreen; encrypted-media; picture-in-picture"
          allowFullScreen
          className="block aspect-video w-full border-0"
        />
        {film.label && <figcaption className="font-mono bg-[var(--card)] px-3 py-2 text-[11px] text-[var(--faint)]">{film.label}</figcaption>}
      </figure>
    );
  if (hero)
    return (
      <figure className="overflow-hidden rounded-[var(--radius)] border border-[var(--line)]">
        <img src={logoUrl(hero.src)} alt={hero.alt} className="block aspect-video w-full object-cover" />
        {hero.credit && <figcaption className="font-mono bg-[var(--card)] px-3 py-2 text-[11px] text-[var(--faint)]">{hero.credit}</figcaption>}
      </figure>
    );
  return null;
}

/** One artist's page: the film up top, then what they have to show and to sell. */
function ProfilePage({ p, plugin, ctx, onBack }: { p: Profile; plugin: Made; ctx: PluginContext; onBack: () => void }) {
  const name = edition.instance.name;
  const [playing, setPlaying] = useState<Film | undefined>(p.film);
  const of = (k: ReleaseKind) => p.releases.filter((r) => r.kind === k);
  const credits = shaped?.made.findIndex((m) => /credit/i.test(m.title)) ?? -1;
  const creditsId = credits >= 0 ? `made-${credits + 1}` : "";
  const buy = (r: Release) =>
    demoNote(
      `In your own app this takes a card payment on ${p.name}'s own account${r.kind === "record" ? " and the record goes in the post" : ""}. ${name} takes nothing from the sale.`,
    );
  const play = (f: Film) => {
    setPlaying(f);
    document.querySelector(".page-body-top")?.scrollIntoView({ behavior: "smooth", block: "start" });
  };
  return (
    <Page>
      <PageHeader
        icon={Users}
        eyebrow={`${plugin.title.toLowerCase()} · ${name.toLowerCase()}`}
        title={p.name}
        lede={p.line}
        actions={
          <>
            <Button icon={ArrowLeft} onClick={onBack}>
              All pages
            </Button>
            <Button
              icon={Share2}
              onClick={() => demoNote(`In your own app this page has its own address on ${name}. Share it and people land here, not on a shop somewhere else.`)}
            >
              Share
            </Button>
          </>
        }
      />
      <PageBody width="wide">
        <div className="page-body-top" />
        <Player film={playing} hero={p.hero} title={p.name} />
        <div className="grid gap-6 md:grid-cols-[1fr_280px]">
          <p className="max-w-prose text-sm leading-relaxed text-[var(--muted)]">{p.about}</p>
          {p.facts && (
            <dl className="grid gap-2 self-start">
              {p.facts.map(([k, v]) => (
                <div key={k} className="border-l border-[var(--line-strong)] pl-3">
                  <dt className="font-mono text-[11px] uppercase tracking-[0.14em] text-[var(--faint)]">{k}</dt>
                  <dd className="text-[13px] text-[var(--muted)]">{v}</dd>
                </div>
              ))}
            </dl>
          )}
        </div>

        {ORDER.map((k) => {
          const items = of(k);
          const shelf = SHELF[k];
          return (
            <Section key={k} label={shelf.label} icon={shelf.icon} aside={<span className="font-mono text-[11px] text-[var(--faint)]">{items.length}</span>}>
              {!items.length && <Empty>Nothing here yet. Space is kept for it.</Empty>}
              {!!items.length && k === "photograph" && (
                <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
                  {items.map((r) => (
                    <figure key={r.title} className="overflow-hidden rounded-[var(--radius)] border border-[var(--line)] bg-[var(--card)]">
                      {r.art ? (
                        <img src={logoUrl(r.art.src)} alt={r.art.alt} loading="lazy" className="block aspect-[4/3] w-full object-cover" />
                      ) : (
                        <div className="flex aspect-[4/3] items-center justify-center text-[var(--faint)]">
                          <ImageIcon className="h-5 w-5" />
                        </div>
                      )}
                      <figcaption className="px-3 py-2">
                        <div className="font-tight text-[13px] font-medium">{r.title}</div>
                        <div className="font-mono mt-0.5 text-[11px] text-[var(--faint)]">{[r.when, r.art?.credit ?? r.line].filter(Boolean).join(" · ")}</div>
                      </figcaption>
                    </figure>
                  ))}
                </div>
              )}
              {!!items.length && k === "record" && (
                <div className="grid gap-3 sm:grid-cols-2">
                  {items.map((r) => (
                    <Card key={r.title} className="flex gap-4 !px-4 !py-4">
                      {r.art ? (
                        <img src={logoUrl(r.art.src)} alt={r.art.alt} loading="lazy" className="h-28 w-28 shrink-0 rounded-[6px] object-cover" />
                      ) : (
                        <div className="flex h-28 w-28 shrink-0 items-center justify-center rounded-[6px] border border-dashed border-[var(--line-strong)] text-[var(--faint)]">
                          <Disc3 className="h-6 w-6" />
                        </div>
                      )}
                      <div className="flex min-w-0 flex-1 flex-col">
                        <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                          <span className="font-tight text-sm font-medium">{r.title}</span>
                          {r.status && <Status tone={/pre|soon|coming|wait/i.test(r.status) ? "warn" : "live"}>{r.status}</Status>}
                        </div>
                        <p className="mt-1 text-[13px] leading-relaxed text-[var(--muted)]">{r.line}</p>
                        <div className="mt-auto flex items-center justify-between gap-3 pt-3">
                          <span className="font-mono text-[11px] text-[var(--faint)]">{[r.when, r.price].filter(Boolean).join(" · ")}</span>
                          <Button
                            variant="primary"
                            onClick={() => (r.price ? buy(r) : demoNote(`In your own app this plays from ${p.name}'s own channel, and the listen is counted on their record.`))}
                          >
                            {/pre/i.test(r.status ?? "") ? "Pre-order" : r.price ? "Buy" : "Listen"}
                          </Button>
                        </div>
                      </div>
                    </Card>
                  ))}
                </div>
              )}
              {!!items.length && (k === "film" || k === "event") && (
                <List>
                  {items.map((r) => (
                    <Row
                      key={r.title}
                      icon={k === "film" ? Clapperboard : CalendarDays}
                      title={r.title}
                      status={r.status ? <Status tone={/premiere|soon|coming|wait|rehears/i.test(r.status) ? "warn" : "live"}>{r.status}</Status> : undefined}
                      detail={[r.when, r.line].filter(Boolean).join(". ")}
                      action={
                        r.film ? (
                          <Button icon={Play} onClick={() => play(r.film!)} disabled={playing?.id === r.film.id}>
                            {playing?.id === r.film.id ? "Playing" : "Play"}
                          </Button>
                        ) : k === "event" && r.price ? (
                          <Button icon={Ticket} onClick={() => buy(r)}>
                            {r.price}
                          </Button>
                        ) : undefined
                      }
                    />
                  ))}
                </List>
              )}
            </Section>
          );
        })}

        <Card tone="quiet">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="text-[13px] leading-relaxed text-[var(--muted)]">
              Everything sold here lands in {p.name}'s own account. {name} is the home and the shop, not the label, and takes nothing from a sale.
              Every name on the films is on the record, confirmed by the person named.
            </p>
            {creditsId && (
              <Button variant="quiet" onClick={() => ctx.open(creditsId)}>
                See the credits
              </Button>
            )}
          </div>
        </Card>
      </PageBody>
    </Page>
  );
}

function panelFor(m: Made, id: string) {
  const Icon = ICON[m.icon];
  return function MadePanel(ctx: PluginContext) {
    const name = edition.instance.name;
    const [open, setOpen] = useState<string | null>(null);
    const page = m.profiles?.find((p) => p.slug === open);
    if (page) return <ProfilePage p={page} plugin={m} ctx={ctx} onBack={() => setOpen(null)} />;
    return (
      <Page>
        <PageHeader
          icon={Icon}
          eyebrow={`made for ${name.toLowerCase()} · ${m.live ? "live from the lab" : "sample"}`}
          title={m.title}
          lede={m.tagline}
          actions={
            m.live ? (
              <a href={m.live.src} target="_blank" rel="noopener" className="text-[13px] text-[var(--muted)] underline underline-offset-4">
                Open on its own
              </a>
            ) : (
              <Button onClick={() => demoNote(`In your own app this adds to ${m.title}, in ${name}'s record.`)}>
                Add
              </Button>
            )
          }
        />
        <PageBody width={m.profiles ? "wide" : "read"}>
          {m.live && (
            <figure className="overflow-hidden rounded-[var(--radius)] border border-[var(--line)] bg-black">
              <iframe
                src={m.live.src}
                title={m.title}
                allow="autoplay; fullscreen; encrypted-media; picture-in-picture"
                allowFullScreen
                className="block aspect-video max-h-[78vh] w-full border-0"
              />
              {m.live.label && (
                <figcaption className="font-mono bg-[var(--card)] px-3 py-2 text-[11px] text-[var(--faint)]">{m.live.label}</figcaption>
              )}
            </figure>
          )}
          {!m.live && m.hero && !m.profiles && (
            <figure className="overflow-hidden rounded-[var(--radius)] border border-[var(--line)]">
              <img src={logoUrl(m.hero.src)} alt={m.hero.alt} className="block aspect-[21/9] w-full object-cover" />
              {m.hero.credit && (
                <figcaption className="font-mono bg-[var(--card)] px-3 py-2 text-[11px] text-[var(--faint)]">{m.hero.credit}</figcaption>
              )}
            </figure>
          )}
          {m.profiles && (
            <div className="grid gap-4 sm:grid-cols-2">
              {m.profiles.map((p) => (
                <button
                  key={p.slug}
                  type="button"
                  onClick={() => setOpen(p.slug)}
                  className="prism-hover group overflow-hidden rounded-[var(--radius)] border border-[var(--line)] bg-[var(--card)] text-left transition"
                >
                  {p.hero ? (
                    <img src={logoUrl(p.hero.src)} alt={p.hero.alt} className="block aspect-[16/9] w-full object-cover" />
                  ) : (
                    <div className="flex aspect-[16/9] items-center justify-center bg-[var(--raise)] text-[var(--faint)]">
                      <Users className="h-6 w-6" />
                    </div>
                  )}
                  <div className="px-4 py-3">
                    <div className="font-tight text-base font-medium group-hover:underline group-hover:underline-offset-4">{p.name}</div>
                    <div className="mt-0.5 text-[13px] leading-relaxed text-[var(--muted)]">{p.line}</div>
                    <div className="font-mono mt-2 text-[11px] text-[var(--faint)]">{count(p) || "Space kept for films, photographs, records and events"}</div>
                  </div>
                </button>
              ))}
            </div>
          )}
          {!m.live && <Notice>
            {shaped?.alice || shaped?.source === "pack" ? "A plugin made for this group." : "Sketched from what you told us."} In your own app it is made to fit how {name}{" "}
            works, and changes when that does.
          </Notice>}
          {m.sections.map((s) => (
            <Section key={s.label} label={s.label}>
              <List>
                {s.items.map((it) => (
                  <Row
                    key={it.title}
                    title={it.title}
                    status={it.status ? <Status tone={/gap|help|wait|need|due/i.test(it.status) ? "warn" : "live"}>{it.status}</Status> : undefined}
                    detail={it.detail}
                  />
                ))}
              </List>
            </Section>
          ))}
          <Card tone="dashed">
            <p className="text-[13px] leading-relaxed text-[var(--muted)]">
              Custom plugins follow the same rules as the rest, with their own levels under "Who can use what". What
              people add stays theirs. One made for {name} can later be offered to other groups.
            </p>
          </Card>
        </PageBody>
      </Page>
    );
  };
}

/** The plugins a sketch was made with, as modules the host can mount (`made-1` to `made-4`). */
export function madeModules(s: Shape | null): MurmurModule[] {
  if (!s) return [];
  return s.made.map((m, i) => {
    const id = `made-${i + 1}`;
    return {
      id,
      title: m.title,
      tagline: m.tagline,
      icon: ICON[m.icon],
      order: 3 + i,
      kind: "plugin",
      support: email(id),
      backend: `made for ${s.name} (a sketch)`,
      Panel: panelFor(m, id),
    } satisfies MurmurModule;
  });
}
