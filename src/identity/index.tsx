import { useEffect, useRef, useState } from "react";
import { Fingerprint, ShieldCheck, ArrowRight, ArrowUpRight, LogOut, Landmark, MessageSquare, X, Mail, KeyRound, Sprout, Users } from "lucide-react";
import type { MurmurModule, PluginContext } from "../host/types";
import { useIdentity } from "./useIdentity";
import { edition, packed, shaped } from "../edition";
import { CollectivesSection } from "../host/Collectives";
import { AccessAndConsent } from "./access";
import { PasskeySignIn } from "./SignIn";
import { openInBrowser, startPairing, type Pairing, type SignedIn } from "./passkey";
import { approve, supported as checkInsSupported, useParticipation } from "./participation";
import { claimSeed, loadSeed, markSrc, supported as seedsSupported, withdrawClaim, type SeedState } from "./seed";
import { signInToOps, signOutOfOps, useOps } from "../lib/ops";
import { claimInvite, type ClaimOutcome } from "../lib/access";
import { askForLogins, askLabel } from "../demo/note";
import { labelOf, levelFor, sampleRole } from "../demo/access";
import { samplePublication } from "../demo/sample";
import { GROUPS, GroupList, hereGroup } from "../demo/groups";
import { AskedSection, ExpertiseSection } from "../demo/expertise";
import { IncomeSection } from "../demo/income";
import { InvitesSection } from "../demo/invites";
import { RecordSection, type RecordItem } from "../demo/record";
import { getModule } from "../host/registry";
import { Activity, ProfileHero, type Kind } from "./hero";
import { Page, PageHeader, PageBody, Section, List, Row, Status, Dot, Notice, Button, Gate, Code, Waiting, Facts, Card } from "../ui";

/**
 * Profile (the `identity` core surface).
 *
 * What this person is in the system, in the order the system builds it: a
 * member of the edition's collective (a passkey at its door, ADR 0046), their
 * Seed and its mark (claimed with a key they hold, seed.ts), their
 * check-ins (the participation key, ADR 0069), a role on the company's console
 * where the edition has one (operator, read-only in the app), and the accounts
 * the app has connected for them (chat). Nothing here is a placeholder: each
 * row reads real state, and says plainly when something isn't connected.
 */
function Panel({ instance, open, installed }: PluginContext) {
  const { identity, signIn, signOut } = useIdentity();
  const site = new URL(edition.signIn.approve).host;

  if (!identity.signedIn && edition.demo) return <DemoProfile instance={instance} open={open} />;

  if (!identity.signedIn) {
    return (
      <Page>
        <PageHeader
          icon={Fingerprint}
          eyebrow="profile"
          title={`Sign in to ${edition.productName}`}
          lede={`Use your passkey at ${site}. Signing in makes you a member of ${instance.name}.`}
        />
        <PageBody>
          <PasskeySignIn
            onSignedIn={signIn}
            lede={
              identity.lapsedAs
                ? `${instance.name} no longer accepts the sign-in this app held for ${identity.lapsedAs}, so it has signed you out here. Your other collectives are not affected.`
                : undefined
            }
          />
          <CollectivesSection />
        </PageBody>
      </Page>
    );
  }

  const until = identity.sessionExp
    ? new Date(identity.sessionExp * 1000).toLocaleDateString("en-GB", { day: "numeric", month: "long" })
    : null;

  return (
    <Page>
      <PageHeader
        icon={Fingerprint}
        eyebrow="profile"
        title="Profile"
        lede="Your own identity. Its key stays on your device and goes with you to every group."
        actions={
          <Button variant="danger" icon={LogOut} onClick={signOut}>
            Sign out
          </Button>
        }
      />
      <PageBody>
        <ProfileHero
          seed={identity.userId ?? identity.handle ?? "you"}
          name={identity.handle ?? "You"}
          line={`A member of ${instance.name}.`}
          chips={["Key on your device", "Identity you own"]}
        />

        <Section label="Membership" icon={ShieldCheck}>
          <List>
            <Row
              title={`Member of ${instance.name}`}
              status={<Status tone="ok">signed in</Status>}
              detail={
                <>
                  Your passkey at {site} proves it's you. Signed in
                  {until ? ` until ${until}` : " for 30 days"}. The app never signs anything for you.
                </>
              }
            />
            {checkInsSupported ? (
              <CheckIns session={identity.session ?? null} />
            ) : (
              <Row
                title="Check-ins"
                status={<Status>not available yet</Status>}
                detail={`${instance.name} doesn't record check-ins yet. Calls and chat work as normal.`}
              />
            )}
            {edition.invite && identity.session && <YourInvite session={identity.session} />}
          </List>
        </Section>

        {seedsSupported && identity.session && <YourSeed session={identity.session} />}

        <CollectivesSection />

        {edition.ops && <OperatorRole open={open} />}

        {identity.session && <AccessAndConsent session={identity.session} installed={installed ?? []} open={open} />}

        <Section label="Connected accounts" icon={MessageSquare}>
          <List>
            <ChatAccount open={open} />
          </List>
        </Section>

        {identity.userId && (
          <Facts
            items={[
              ["member", identity.userId],
              ["door", site],
            ]}
          />
        )}
      </PageBody>
    </Page>
  );
}

/**
 * Profile in a demo edition, before its members have logins: the signed-in
 * page as a sample member, Alice, would see it. It makes three points in the
 * order the walkthrough tells them (`data-tour-section`): the identity is the
 * member's own, not the app's; what she contributes goes into a record that
 * notes it was hers and what she agreed to; and the group's record together is
 * what lets it set terms as one. Copy keeps the contributor promise's tenses
 * (core/state/architecture/contributor-promise.md): payment is "could", never "is".
 */
function DemoProfile({ instance, open }: Pick<PluginContext, "instance" | "open">) {
  // An invented collective has no door, so it names none.
  const site = edition.showcase && !packed ? `${instance.name}'s own address` : new URL(edition.signIn.approve).host;
  const name = instance.name;
  return (
    <Page>
      <PageHeader
        icon={Fingerprint}
        eyebrow="profile · sample"
        title="Profile"
        lede={
          edition.showcase
            ? `Alice, a sample member of ${name}. Her identity is hers, built by taking part.`
            : `A sample member of ${name}. Once ${name} has logins, this page is yours.`
        }
        actions={
          <Button icon={Mail} onClick={askForLogins}>
            {askLabel}
          </Button>
        }
      />
      <PageBody>
        <ProfileHero
          seed={`alice@${name}`}
          name="Alice"
          line={
            hereGroup && shaped
              ? `${hereGroup.role.charAt(0).toUpperCase()}${hereGroup.role.slice(1)} at ${name}, and a member of ${GROUPS.length - 1} other groups.`
              : `One of ${name}'s ${sampleRole.name.toLowerCase()} since March 2025, and a member of ${GROUPS.length > 1 ? `${GROUPS.length - 1} other groups` : "one other group"}.`
          }
          chips={["Key on her phone", "Identity she owns", `${GROUPS.length || 2} groups`]}
          counts={COUNTS}
          stats={[
            [String(TOTAL), "contributions, each signed"],
            ["1,284", `in ${name}'s record`],
            ["0", "used without her say"],
            [String(GROUPS.length || 2), "groups, one identity"],
          ]}
          activity={
            <Activity
              seed={`alice@${name}`}
              weekday={edition.call?.weekday}
              caption={`A year, a square a day.${edition.call ? ` ${weekdayName(edition.call.weekday)}s stand out: ${edition.call.name}.` : ""}`}
            />
          }
        />

        <div data-tour-section="yours" className="scroll-mt-6">
          <Section
            label="Yours, not ours"
            icon={KeyRound}
            lede="Not a rented account. It starts with a key she holds."
          >
            <List>
              <Row
                title="Her passkey"
                status={<Status tone="ok">on her phone</Status>}
                detail={`Never leaves her phone. Nobody else can sign in or sign as her, not even whoever runs ${name}'s app.`}
              />
              <Row
                title={`Her membership of ${name}`}
                status={<Status tone="ok">held by her</Status>}
                detail="Tied to her own key, so nobody can quietly take it away. If she leaves, her history goes with her."
              />
              <Row
                title="One identity, many groups"
                status={<Status>{GROUPS.length || 2} groups</Status>}
                detail="What she builds here counts there too. No single app owns it."
              />
            </List>
          </Section>
        </div>

        {GROUPS.length > 0 && (
          <div data-tour-section="groups" className="scroll-mt-6">
            <Section
              label="Her groups"
              icon={Users}
              lede="One tap moves her between them. Each has its own plugins and rules. Her identity, notes and record go with her."
            >
              <GroupList />
            </Section>
          </div>
        )}

        <RecordSection items={RECORD} group={name} />

        <ExpertiseSection />

        <AskedSection />

        <IncomeSection />

        <InvitesSection />

        <div data-tour-section="together" className="scroll-mt-6">
          <Card>
            <div className="font-tight flex items-center gap-2 text-sm font-medium">
              <Users className="h-4 w-4 text-[var(--muted)]" /> {name}'s record, together
            </div>
            <div className="mt-3 grid grid-cols-3 gap-3">
              {(
                [
                  ["1,284", "contributions"],
                  ["25", "people"],
                  ["100%", "with consent on record"],
                ] as const
              ).map(([n, l]) => (
                <div key={l}>
                  <div className="font-tight text-xl font-medium">{n}</div>
                  <div className="text-[11px] text-[var(--faint)]">{l}</div>
                </div>
              ))}
            </div>
            <div className="mt-4">
              <div className="flex h-2 overflow-hidden rounded-full bg-[var(--line)]">
                <span className="h-full" style={{ width: `${(TOTAL / 1284) * 100}%`, background: "var(--fg)" }} />
              </div>
              <div className="mt-1.5 flex justify-between text-[11px] text-[var(--faint)]">
                <span>Alice's part: {TOTAL} of 1,284</span>
                <span>everyone else's, each signed</span>
              </div>
            </div>
            <div className="mt-4 space-y-2 text-[13px] leading-relaxed text-[var(--muted)]">
              <p>
                Each contribution carries who made it and what they agreed to. Together, that is proof of original
                judgement, freely shared. AI has nothing scarcer.
              </p>
              <p>
                It lets {name} set terms as one group and share what comes back by what each person put in. The aim
                is a public intelligence that answers to the people who made it, and could pay them.
              </p>
            </div>
            <p className="mt-3 text-[12px] text-[var(--faint)]">
              Sample figures. Nobody is paid from a record today.
            </p>
          </Card>
        </div>

        <Section
          label={`What Alice can do in ${name}`}
          icon={Landmark}
          lede={`Alice is one of ${name}'s ${sampleRole.name.toLowerCase()}, who ${sampleRole.line}. Others' levels are under Plugins, "Who can use what".`}
        >
          <List>
            {ACCESS_PLUGINS.filter((id) => getModule(id)).map((id) => (
              <Row
                key={id}
                title={getModule(id)!.title}
                status={<Status tone={levelFor(id) === "none" ? "idle" : "ok"}>{labelOf(levelFor(id))}</Status>}
                action={
                  <Button variant="quiet" onClick={() => open(id)} trailing={ArrowUpRight}>
                    Open
                  </Button>
                }
              />
            ))}
          </List>
        </Section>

        <Section label="Membership" icon={ShieldCheck}>
          <List>
            <Row
              title={`Member of ${name}`}
              status={<Status tone="ok">signed in</Status>}
              detail={`Her passkey at ${site} proves it's her. Signed in for 30 days. The app never signs anything by itself.`}
            />
            <Row
              title="Check-ins"
              status={<Status tone="ok">on until 18:00</Status>}
              detail="Joining a call or sending a message records that she took part. One passkey tap turns it on for up to 12 hours."
            />
          </List>
        </Section>

        <CollectivesSection />

        <Section label="Connected accounts" icon={MessageSquare}>
          <List>
            <Row
              title="Chat"
              status={<Status tone="ok">connected</Status>}
              detail="Came with her passkey. No password to keep."
              action={
                <Button onClick={() => open("chat")} trailing={ArrowUpRight}>
                  Open
                </Button>
              }
            />
          </List>
        </Section>

        <Section label="Signing in" icon={Fingerprint}>
          <p className="text-[13px] leading-relaxed text-[var(--muted)]">
            {edition.showcase && !packed
              ? "In your group's own app, each member signs in with a passkey at your own address. "
              : `Next for ${name}: each member gets a passkey login at ${site}. `}
            One tap, nothing to remember. Then chat, calls and the agent go live, and Operations reads your real
            books.
          </p>
          <div className="mt-3">
            <Button variant="primary" size="md" icon={Mail} onClick={askForLogins}>
              {askLabel}
            </Button>
          </div>
        </Section>
      </PageBody>
    </Page>
  );
}

const ACCESS_PLUGINS = shaped
  ? ["agent", ...shaped.plugins]
  : ["agent", "magazine", "fundraise", "chat", "meet", "operations", "structure"];

/** Alice's sample record: what she contributed, where, and what she agreed to. */
const RECORD: RecordItem[] = shaped
  ? [
      { kind: "call" as Kind, what: `Spoke at ${shaped.call.name}`, where: "Calls", when: "9 October", consent: 1, proof: "3f9a…c21e" },
      ...(shaped.plugins.includes("magazine")
        ? [{ kind: "writing" as Kind, what: `Wrote “${shaped.publication.pieces[0].title}”`, where: shaped.publication.name, when: "7 October", consent: 2, proof: "b04d…77a1" }]
        : []),
      { kind: "work" as Kind, what: `Added to ${shaped.made[0]?.title ?? "the shared notes"}`, where: shaped.made[0]?.title ?? "Notes", when: "6 October", consent: 1, proof: "e512…09bc" },
      ...(shaped.initiatives[0]
        ? [{ kind: "decision" as Kind, what: `Costed “${shaped.initiatives[0].title}”`, where: "Initiatives", when: "2 October", consent: 3, proof: "71c8…4d3f" }]
        : []),
      { kind: "private" as Kind, what: "Morning pages", where: "Notes", when: "every day", consent: 0, proof: "kept on this computer" },
    ]
  : [
      { kind: "call" as Kind, what: `Spoke at ${edition.call?.name ?? "the weekly call"}`, where: "Calls", when: "9 October", consent: 1, proof: "3f9a…c21e" },
      ...(edition.showcase
        ? [
            { kind: "writing" as Kind, what: "Essay, “Why Huxley Sessions became a company”", where: samplePublication?.name ?? "Magazine", when: "7 October", consent: 2, proof: "b04d…77a1" },
            { kind: "decision" as Kind, what: "Vote for Huxley Sessions Ltd", where: "Structure", when: "18 September", consent: 1, proof: "e512…09bc" },
            { kind: "work" as Kind, what: "A year of session notes from the travelling kit", where: "Huxley Sessions", when: "since last autumn", consent: 3, proof: "71c8…4d3f" },
          ]
        : [
            { kind: "writing" as Kind, what: "Essay, “Rooms that remember”", where: samplePublication?.name ?? "Magazine", when: "7 October", consent: 2, proof: "b04d…77a1" },
            { kind: "work" as Kind, what: "Notes on Bob's first spread", where: "Chat", when: "6 October", consent: 1, proof: "e512…09bc" },
            { kind: "decision" as Kind, what: "Survey of the studio roof", where: samplePublication ? "Initiatives" : "Fundraise", when: "2 October", consent: 3, proof: "71c8…4d3f" },
          ]),
      { kind: "private" as Kind, what: "Morning pages", where: "Notes", when: "every day", consent: 0, proof: "kept on this computer" },
    ];

/** Alice's sample totals by kind, which draw her mark. */
const COUNTS: Partial<Record<Kind, number>> = { call: 31, writing: 4, decision: 9, work: 4 };
const TOTAL = Object.values(COUNTS).reduce((a, b) => a + (b ?? 0), 0);
const weekdayName = (d: number) =>
  ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"][((d % 7) + 7) % 7];

const day = (t: number) => new Date(t * 1000).toLocaleDateString("en-GB", { day: "numeric", month: "long" });
const short = (a: string) => `${a.slice(0, 6)}…${a.slice(-4)}`;

function Mark({ svg, size, alt }: { svg: string; size: number; alt: string }) {
  return <img src={markSrc(svg)} width={size} height={size} alt={alt} className="shrink-0" />;
}

/**
 * Your Seed and its mark. The network keeps a Seed for each person from the
 * calls; its mark starts hollow and turns solid once, when the member has
 * claimed it with a key they hold and nobody has objected for a week.
 */
function YourSeed({ session }: { session: string }) {
  const [state, setState] = useState<SeedState | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [picked, setPicked] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);

  async function refresh() {
    try {
      const s = await loadSeed(session);
      setState(s);
      setErr(null);
      setPicked((p) => (p.length ? p : s.candidates.filter((c) => !c.taken).slice(0, 1).map((c) => c.slug)));
    } catch (e: any) {
      setErr(e?.message || "Could not reach the door.");
    }
  }
  useEffect(() => {
    void refresh();
  }, [session]);

  async function claim() {
    setBusy(true);
    setErr(null);
    try {
      await claimSeed(session, picked);
      await refresh();
    } catch (e: any) {
      setErr(e?.message || "That did not work.");
    } finally {
      setBusy(false);
    }
  }

  async function withdraw(id: string) {
    setBusy(true);
    try {
      await withdrawClaim(session, id);
      setPicked([]);
      await refresh();
    } catch (e: any) {
      setErr(e?.message || "That did not work.");
    } finally {
      setBusy(false);
    }
  }

  const lede = "Each person's Seed grows from the calls. Its mark is a picture of you that anyone can check.";
  if (!state)
    return (
      <Section label="Your Seed" icon={Sprout} lede={lede}>
        {err ? <Notice tone="danger">{err}</Notice> : <Waiting>Looking for your Seed</Waiting>}
      </Section>
    );

  const seed = state.seed;
  const live = seed && ["open", "disputed", "ready", "settled"].includes(seed.claim.status) ? seed : null;
  const forest = (
    <Button variant="quiet" onClick={() => openInBrowser(state.forest)} trailing={ArrowUpRight}>
      See the forest
    </Button>
  );

  if (live) {
    const c = live.claim;
    const open = c.objections.filter((o) => !o.resolved);
    return (
      <Section label="Your Seed" icon={Sprout} lede={lede} aside={forest}>
        <Card>
          <div className="flex items-start gap-5">
            <Mark svg={live.mark} size={96} alt={`${live.name}: ${live.kind} mark`} />
            <div className="min-w-0 flex-1">
              <Row
                title={live.name}
                status={
                  c.status === "settled" ? (
                    <Status tone="ok">anchored</Status>
                  ) : c.status === "disputed" ? (
                    <Status tone="warn">paused</Status>
                  ) : (
                    <Status tone="live">open until {day(c.opensUntil)}</Status>
                  )
                }
                detail={
                  c.status === "settled" ? (
                    <>Your mark carries your own account, <span className="font-mono text-xs">{short(c.account)}</span>. It is fixed now.</>
                  ) : c.status === "disputed" ? (
                    <>Someone said this isn't you{open[0] ? <>: "{open[0].reason}"</> : ""}. A steward will look. Your mark stays hollow until then.</>
                  ) : (
                    <>Claimed with your own account, <span className="font-mono text-xs">{short(c.account)}</span>. Anyone can object until {day(c.opensUntil)}. If nobody does, your mark turns solid.</>
                  )
                }
                action={
                  c.status !== "settled" && (
                    <Button variant="quiet" onClick={() => void withdraw(c.id)} disabled={busy}>
                      Withdraw
                    </Button>
                  )
                }
              />
              {c.slugs.length > 1 && (
                <p className="mt-2 text-[12px] text-[var(--muted)]">Joins {c.slugs.length} Seeds that were one person: {c.slugs.join(", ")}.</p>
              )}
            </div>
          </div>
        </Card>
        {err && <div className="mt-3"><Notice tone="danger">{err}</Notice></div>}
      </Section>
    );
  }

  const free = state.candidates.filter((c) => !c.taken);
  const toggle = (slug: string) => setPicked((p) => (p.includes(slug) ? p.filter((x) => x !== slug) : [...p, slug]));

  return (
    <Section label="Your Seed" icon={Sprout} lede={lede} aside={forest}>
      {seed && (seed.claim.status === "rejected" || seed.claim.status === "withdrawn") && (
        <div className="mb-3">
          <Notice>
            {seed.claim.status === "rejected"
              ? "Your last claim was turned down after an objection. You can claim again."
              : "You withdrew your last claim. You can claim again."}
          </Notice>
        </div>
      )}
      {state.candidates.length === 0 ? (
        <Card tone="dashed">
          <p className="text-[13px] leading-relaxed text-[var(--muted)]">
            No Seed matches your name yet. Join a call and one is written.
          </p>
        </Card>
      ) : (
        <List>
          {state.candidates.map((c) => (
            <label key={c.slug} className={`flex items-center gap-4 ${c.taken ? "opacity-50" : "cursor-pointer"}`}>
              <input
                type="checkbox"
                className="accent-[var(--fg)]"
                checked={picked.includes(c.slug)}
                disabled={c.taken || !state.ownAccount}
                onChange={() => toggle(c.slug)}
              />
              <Mark svg={c.mark} size={48} alt={`${c.name}: hollow mark`} />
              <div className="min-w-0">
                <div className="font-tight text-sm font-medium">{c.name}</div>
                <div className="text-[12px] text-[var(--muted)]">
                  {c.taken ? "claimed by someone else" : `${c.sessions} ${c.sessions === 1 ? "call" : "calls"} · not yet yours`}
                </div>
              </div>
            </label>
          ))}
        </List>
      )}
      <div className="mt-3 space-y-3">
        {!state.ownAccount ? (
          <Notice>
            A mark carries an account only you hold. You don't have one yet, so these stay hollow. Once you have your
            own passkey on the ledger, you can claim here.
          </Notice>
        ) : (
          free.length > 0 && (
            <div className="flex flex-wrap items-center gap-3">
              <Button variant="primary" onClick={() => void claim()} busy={busy} disabled={!picked.length}>
                {busy ? "Waiting for your passkey" : picked.length > 1 ? `Claim these ${picked.length} as me` : "Claim as me"}
              </Button>
              <span className="text-[12px] text-[var(--muted)]">
                Pick every one that is you. One passkey tap, then a week for objections.
              </span>
            </div>
          )
        )}
        {err && <Notice tone="danger">{err}</Notice>}
      </div>
    </Section>
  );
}

/** The operator role: the company's console keeps its own list of owners, operators and
 *  investors. Where it takes this edition's sign-in, that sign-in opens it; otherwise
 *  the app pairs read-only with a console passkey. */
function OperatorRole({ open }: { open: (id: string) => void }) {
  const ops = useOps();
  return (
    <Section label="Company role" icon={Landmark}>
      <List>
        <Row
          title="Operations"
          status={
            ops.kind === "ready" ? (
              <Status tone="ok">{ops.via === "member" ? "with your sign-in" : "paired"}</Status>
            ) : ops.kind === "pairing" ? (
              <Status tone="live" pulse>waiting for approval</Status>
            ) : (
              <Status>not paired</Status>
            )
          }
          detail={
            ops.kind === "ready"
              ? ops.via === "member"
                ? `Your sign-in opens ${ops.me.company}'s console as ${ops.me.who?.name ?? "an operator"}. Changes are approved in the browser with the same passkey.`
                : `Reading ${ops.me.company}'s console as ${ops.me.who?.name ?? "an operator"}. Changes are approved in the browser.`
              : edition.ops?.member
                ? "For owners, operators and investors. The passkey you sign in with opens it, if the console has you on its list."
                : "For owners and operators. It has its own passkey, separate from your membership."
          }
          action={
            ops.kind === "ready" ? (
              <>
                {ops.via === "pair" && (
                  <Button variant="quiet" onClick={() => void signOutOfOps()}>
                    Unpair
                  </Button>
                )}
                <Button onClick={() => open("operations")} trailing={ArrowUpRight}>
                  Open
                </Button>
              </>
            ) : ops.kind === "signed-out" ? (
              <Button variant={edition.ops?.member ? "quiet" : undefined} onClick={() => void signInToOps()}>
                {edition.ops?.member ? "Use a console passkey" : "Pair"}
              </Button>
            ) : null
          }
        />
      </List>
    </Section>
  );
}

function ChatAccount({ open }: { open: (id: string) => void }) {
  const [who, setWho] = useState<string | null>(null);
  useEffect(() => {
    try {
      setWho(JSON.parse(localStorage.getItem("murmur.matrix.session.v1") || "null")?.userId ?? null);
    } catch {
      setWho(null);
    }
  }, []);
  return (
    <Row
      title="Chat"
      status={who ? <Status tone="ok">connected</Status> : <Status>not connected</Status>}
      detail={who ? <span className="font-mono text-xs">{who}</span> : "Connect to talk to people here."}
      action={
        <Button onClick={() => open("chat")} trailing={ArrowUpRight}>
          {who ? "Open" : "Connect"}
        </Button>
      }
    />
  );
}

/**
 * Check-ins: whether this app may record that you took part in calls and chats.
 * One passkey tap in the browser covers a few hours (ADR 0069).
 */
function CheckIns({ session }: { session: string | null }) {
  const { grant, log, approving } = useParticipation();
  const [err, setErr] = useState<string | null>(null);
  const until = grant
    ? new Date(grant.exp * 1000).toLocaleString("en-GB", { weekday: "short", hour: "2-digit", minute: "2-digit" })
    : null;

  async function go() {
    if (!session) return;
    setErr(null);
    try {
      await approve(session);
    } catch (e: any) {
      setErr(e?.message || "That did not work.");
    }
  }

  return (
    <div>
      <Row
        title="Check-ins"
        status={grant ? <Status tone="ok">on until {until}</Status> : <Status>off</Status>}
        detail="Joining a call, sending a message or entering a venue's code records that you took part. One passkey tap turns it on for up to 12 hours. Its key on this computer can do nothing else, and signing out turns it off."
        action={
          !grant && (
            <Button variant="primary" onClick={go} busy={approving} disabled={!session}>
              {approving ? "Waiting for your passkey" : "Turn on"}
            </Button>
          )
        }
      />
      {err && (
        <div className="mt-3">
          <Notice tone="danger">{err}</Notice>
        </div>
      )}
      {log.length > 0 && (
        <ul className="font-mono mt-3 space-y-1 border-t border-[var(--line)] pt-3 text-[11px] text-[var(--muted)]">
          {log.slice(0, 5).map((c) => (
            <li key={`${c.session}-${c.at}`} className="flex items-center gap-2">
              <Dot tone={c.ok ? "ok" : "danger"} />
              <span className="truncate">{c.session}</span>
              <span className="ml-auto shrink-0 text-[var(--faint)]">
                {new Date(c.at * 1000).toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** Arrived through someone's invite: paste the link so the collective records who brought you in, and anything they set up for you comes through. */
function YourInvite({ session }: { session: string }) {
  const [link, setLink] = useState("");
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<{ tone: "ok" | "idle" | "danger"; text: string } | null>(null);
  const name = edition.instance.name;

  const line = (from: string | null, a: ClaimOutcome | null): { tone: "ok" | "idle" | "danger"; text: string } => {
    const who = from ? `${from}'s` : "the";
    if (!a || a.status === "none") return { tone: "ok", text: `Recorded. ${name} knows ${from || "who"} brought you in.` };
    if (a.status === "applied") return { tone: "ok", text: `Done: ${a.what.replace(/^Bring \S+ in as /, "you're in as ")}.` };
    if (a.status === "proposed") return { tone: "idle", text: `Recorded. What ${from || "they"} set up for you is proposed, and ${a.approvers} decides it. Until then you're a member.` };
    if (a.status === "already") return { tone: a.outcome === "declined" ? "danger" : "ok", text: a.outcome === "approved" ? "Already done: that invite was used before." : a.outcome === "declined" ? "That was declined, so you're a member." : `Already recorded, and ${who} proposal is still waiting.` };
    return { tone: "danger", text: a.reason };
  };

  async function go() {
    setBusy(true);
    setDone(null);
    const r = await claimInvite(link, session);
    setBusy(false);
    if (!r.ok) return setDone({ tone: "danger", text: r.error });
    setDone(line(r.from, r.access));
    setLink("");
  }

  return (
    <div>
      <Row
        title="Arrived with an invite?"
        detail={`Paste the link you were sent. It records who brought you in, and brings through anything they set up for you, such as your role.`}
      />
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <input
          aria-label="Your invite link"
          value={link}
          onChange={(e) => setLink(e.target.value)}
          placeholder={`${edition.invite?.base}/join#…`}
          spellCheck={false}
          className="min-w-0 flex-1 rounded-[var(--radius)] border border-[var(--line-strong)] bg-[var(--card)] px-3 py-2 font-mono text-[12px]"
        />
        <Button variant="primary" busy={busy} disabled={!link.includes("#")} onClick={go}>
          Use it
        </Button>
      </div>
      {done && (
        <div className="mt-3">
          <Notice tone={done.tone}>{done.text}</Notice>
        </div>
      )}
    </div>
  );
}

export const identitySurface: MurmurModule = {
  id: "identity",
  title: "Profile",
  tagline: "Your membership, Seed, check-ins and connected accounts",
  icon: Fingerprint,
  order: 0,
  kind: "core",
  backend: "Your passkey",
  Panel,
};
