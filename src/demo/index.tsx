import { useCallback, useEffect, useLayoutEffect, useMemo, useState } from "react";
import { ArrowLeft, ArrowRight, Compass, Mail, Sparkles, X } from "lucide-react";
import { edition, groupWord, packed, shaped, showcaseName } from "../edition";
import { GROUPS, hereGroup } from "./groups";
import { getModule, rank } from "../host/registry";
import { Button, Status } from "../ui";
import { askForLogins, askLabel, useDemoNote } from "./note";
import { samplePublication } from "./sample";
import { TailorForm } from "./tailor";
import type { CatalogTab } from "../host/App";

export { askForLogins, askLabel };

/**
 * Demo mode: rung 1 of the incubation path (a private sketch, after the conversation at rung 0) (core/state/architecture/incubation-model.md).
 *
 * A demo edition (`edition.demo`) is handed to a collective before its members
 * have logins. So that they can see how the app would work for them, the
 * surfaces that need a sign-in show sample data instead (Operations, Chat, the
 * agent, Profile: `./sample.ts`), a bar across the top says so, and a short
 * walkthrough steps through the app, rail button by rail button, ending on the
 * next rung: logins for everyone.
 */

export const isDemo = !!edition.demo;

const TOUR_KEY = "murmur.tour.v1";
const name = edition.instance.name;


// ── the bar ─────────────────────────────────────────────────────────────────

export function DemoBar({
  installed,
  onTour,
  onTailor,
}: {
  installed: string[];
  onTour: () => void;
  onTailor: () => void;
}) {
  const note = useDemoNote();
  return (
    <div className="flex shrink-0 items-center gap-3 border-b border-[var(--line)] px-4 py-1.5 text-[12px]">
      <Status tone="live">demo</Status>
      <span className="min-w-0 flex-1 truncate text-[var(--muted)]" role="status">
        {note
          ? note.text
          : hereGroup && shaped?.alice
            ? `${name}, another of Alice's groups. She's ${hereGroup.role} here, with the same identity and notes.`
            : packed && shaped?.source === "pack"
            ? `A first sketch of ${name}'s own app, made by Decent. Sample data throughout, and nothing leaves this computer.`
            : shaped
            ? `A sketch of ${name}, made from what you told us. Everything is sample data, and nothing leaves this computer.`
            : edition.showcase
              ? `${name} is an invented collective. All sample data, and nothing leaves this computer.`
              : `A preview of ${name}'s own app, with sample data. Nothing here leaves this computer.`}
      </span>
      <Button variant="quiet" icon={Compass} onClick={onTour}>
        <span className="hidden sm:inline">Walk through</span>
      </Button>
      {edition.showcase && (
        <Button variant="quiet" icon={Sparkles} onClick={onTailor}>
          <span className="hidden sm:inline">{packed || (shaped && !hereGroup) ? "Change it" : "Make it yours"}</span>
        </Button>
      )}
      <Button variant="quiet" icon={Mail} onClick={askForLogins}>
        <span className="hidden md:inline">{askLabel}</span>
      </Button>
    </div>
  );
}

// ── the walkthrough ─────────────────────────────────────────────────────────

interface Step {
  /** the rail button to point at (`data-tour`); none for the first and last */
  target?: string;
  /** the surface to open while this step shows */
  opens?: string;
  /** which part of the Plugins sheet to show, when the step points at it */
  tab?: CatalogTab;
  /** a part of the open surface to scroll to (`data-tour-section`) */
  section?: string;
  /** the last step of an invented demo: ask what the visitor is looking for */
  tailor?: boolean;
  title: string;
  body: string;
}

function steps(installed: string[]): Step[] {
  const has = (id: string) => installed.includes(id) && !!getModule(id);
  const title = (id: string) => getModule(id)?.title ?? id;
  const pub = samplePublication;
  // Huxley's own story (not a visitor's sketch): gifts, then a company, then investment.
  const story = !!edition.showcase && !shaped;
  const out: Step[] = [];
  // In Huxley's own story the agent comes back at the very end, as where it's all going.
  if (has("agent") && !story)
    out.push({
      target: "agent",
      opens: "agent",
      title: `Talk to ${name}`,
      body: `Start with How you'll use ${name}: today a screen for each thing, next one page that shows what needs you, later mostly a conversation. Tap each stage. Below, ask it anything. Here it follows a script.`,
    });
  if (has("magazine"))
    out.push({
      target: "magazine",
      opens: "magazine",
      title: title("magazine"),
      body: pub
        ? story
          ? `When an idea needs more than a chat, someone writes it up in ${pub.name}, signed. Everyone reads the case before anything is decided. The roof, the bursaries and the kit all started here.`
          : `${name}'s own publication. Ideas are written up and signed here before anything is decided.${has("fundraise") ? " Open a piece to see the initiative it argues for." : ""}`
        : `Long reads for the whole ${groupWord}. This is Decent Magazine, live. Later, ${name} publishes its own here.`,
    });
  if (has("fundraise"))
    out.push({
      target: "fundraise",
      opens: "fundraise",
      title: title("fundraise"),
      body: pub
        ? story
          ? `Once members agree, they raise the money. With no legal form, ${name} raised gifts for its roof, bursaries and a travelling recording kit. Then the kit started earning, and growing it needed investment.`
          : `Money comes after the argument. Each initiative was made in ${pub.name}, agreed by members, then raised for, and links back to its case.`
        : `${getModule("fundraise")!.tagline}. Set up the way ${name} works.`,
    });
  if (has("spend"))
    out.push({
      target: "spend",
      opens: "spend",
      title: "Spending",
      body: `Then it's spent, in the open. ${name} has its own debit card, and a member can get one for a single job. Bob's only pays for bursaries. Every payment shows who, what for and the receipt.`,
    });
  for (const id of installed.filter((i) => i.startsWith("made-") && has(i)))
    out.push({
      target: id,
      opens: id,
      title: title(id),
      body: `${getModule(id)!.tagline.replace(/\.+$/, "").replace(/[^?!]$/, "$&.")} Made for ${name} from what you told us.`,
    });
  if (has("chat"))
    out.push({
      target: "chat",
      opens: "chat",
      title: "Chat",
      body: story
        ? `Once you've joined, you can talk. Rooms for everyone and for each project, messages between two people, and calls that open right here. Send a message or ring Bob.`
        : `Rooms for the whole ${groupWord}, messages between two people, and calls. These are samples, so send a message.`,
    });
  if (has("meet"))
    out.push({
      target: "meet",
      opens: "meet",
      title: title("meet"),
      body: story && edition.call
        ? `Every week ${name} meets on ${edition.call.name}. It opens right here. The call is transcribed for the people who were there, and nobody else can open it. If everyone agrees, the agent learns from it with names taken out.`
        : edition.call
        ? `${name}'s regular call, ${edition.call.name}. One tap to join, and your passkey records you were there.`
        : `${getModule("meet")!.tagline}. One tap to join.`,
    });
  if (has("operations"))
    out.push({
      target: "operations",
      opens: "operations",
      title: "Operations",
      body: story
        ? `Now the company raises money. Huxley Sessions Ltd sells shares to grow the kit, with tax relief (SEIS) for investors. Members invest on the same terms as anyone. The collective holds a tenth. Sample figures.`
        : `The books in one place: money in and out, the share register and a round. Changes need a passkey. Sample figures.`,
    });
  if (has("structure"))
    out.push({
      target: "structure",
      opens: "structure",
      title: story ? "Becoming a company" : shaped?.stage.now === 3 ? "Its legal form" : "Grow in stages",
      body: story
        ? `To take investment, the kit became a company, Huxley Sessions Ltd. The agent drafted the papers, Decent checked them, members voted. The collective stays a collective.`
        : shaped?.stage.now === 3
          ? `${shaped.stage.why} New groups start with nothing and take a form when they need one. The agent drafts, Decent checks, members approve.`
          : `Start with nothing. When ${name} needs a bank account, a grant or investment, it takes the form that fits: a charity, a co-op, a company. The agent drafts, Decent checks, members approve.`,
    });
  // The agent first, then the rest top to bottom, as they sit in the rail.
  // Huxley's own story runs from the simplest thing to the most involved:
  // joining, talking, meeting, writing it up, raising gifts, becoming a
  // company, raising investment. The agent comes after the story.
  const STORY = ["identity", "chat", "meet", "magazine", "fundraise", "spend", "structure", "operations", "agent"];
  const order = (st: Step) =>
    story
      ? STORY.indexOf(st.target!) < 0 ? 50 : STORY.indexOf(st.target!)
      : st.target === "agent" ? -2000 : getModule(st.target!) ? rank(getModule(st.target!)!) : 99;
  if (story)
    out.push({
      target: "identity",
      opens: "identity",
      section: "yours",
      title: "Joining",
      body: `It starts with joining. Alice joined with one tap of a passkey on her phone. No password, no form. The key never leaves her phone, so the identity is hers, not ours.`,
    });
  out.sort((a, b) => order(a) - order(b));
  out.unshift({
    title: edition.showcase && !shaped ? "What this is for" : `Welcome to ${edition.productName}`,
    body: hereGroup && shaped?.alice
      ? `${name}, another of Alice's groups. She's ${hereGroup.role} here. All sample data, so try anything.`
      : packed && shaped?.source === "pack"
      ? `A first sketch of ${name}'s own app, drawn from what we know of you so far. The people are made up and so are the figures, so try anything. About five minutes.`
      : shaped
      ? `${name}, sketched from “${shaped.asked}”. Everything here is drawn from that. All sample data, so try anything.`
      : edition.showcase
        ? `A tool to help any group understand itself and each other better, get more done together and share in the value it creates. A community, a company, a charity or a co-op.`
        : `A demo of ${name}'s own app. All sample data, so try anything. Two minutes.`,
  });
  if (edition.showcase && !shaped)
    out.splice(1, 0, {
      title: `Meet ${name}`,
      body: `${name} is a made-up studio collective of musicians, writers and designers. We'll follow it from the first people joining to a company raising money, then what it means for one member, Alice. All sample data, so try anything.`,
    });
  const roles = shaped?.roles;
  out.push(
    {
      target: "catalog",
      tab: "plugins",
      title: "Plugins",
      body: `Add or remove what's in the rail, including plugins made for ${name} and ones other groups share.`,
    },
    {
      target: "catalog",
      tab: "access",
      title: "Who can use what",
      body: roles
        ? `Each plugin has its own levels. ${roles[0].name} run everything, ${roles[roles.length - 1].name.toLowerCase()} see only what they're given. Changes are approved and recorded.`
        : `Each plugin has its own levels. An investor sees the company's books but not members' chat. A guest sees only what they're invited to. Changes are approved and recorded.`,
    },
    {
      target: "settings",
      opens: "settings",
      title: "Settings",
      body: "How the app looks, and the ledger: the shared record of who made what. Many computers keep copies, so nobody can quietly change it.",
    },
    {
      target: "settings",
      opens: "settings",
      section: "billing",
      title: "Billing",
      body: `${name} pays for what it uses, and sees every line. Use less, pay less.`,
    },
    {
      target: "notes",
      opens: "notes",
      title: edition.showcase ? "Your own space to think" : "Notes",
      body: edition.showcase
        ? `Now the person, not the group. Notes is yours alone, kept on your computer. No group sees it. When something's ready, you choose where it goes.`
        : "Your own space to think, kept on this computer. No group can see it.",
    },
    ...(story ? [] : [{
      target: "identity",
      opens: "identity",
      section: "yours",
      title: "Your own identity",
      body: `Profile is yours, not ours. Your key stays on your phone, so nobody can sign in as you or take your membership away. This is a sample member, Alice.`,
    }]),
    ...(GROUPS.length
      ? [
          {
            target: "identity",
            opens: "identity",
            section: "groups",
            title: "Many groups, one you",
            body: `Alice is in four groups: ${showcaseName}, a production company, her street's hall and a food co-op. One tap moves between them. Her identity and record go with her.`,
          },
        ]
      : []),
    {
      target: "identity",
      opens: "identity",
      section: "record",
      title: "Your record",
      body: `Everything you contribute is recorded: that it was yours, when, and who may use it. Tap the icons to change that. Nothing is used without your say.`,
    },
    {
      target: "settings",
      opens: "settings",
      section: "lens",
      title: "Your own way of seeing",
      body: `Say how you like to see things, “more visual” or “raw numbers”, and the record redraws to match. Everyone gets their own version of the app.`,
    },
    ...(GROUPS.length
      ? [
          {
            target: "identity",
            opens: "identity",
            section: "expertise",
            title: "What you know",
            body: "The record shows what Alice is good at, built from signed work rather than a CV. Each group that saw the work vouches for it. Private until she shows it.",
          },
          {
            target: "identity",
            opens: "identity",
            section: "asked",
            title: "Asked of you",
            body: `A group posts a challenge. It goes privately to people who've done it before. Alice sees the question, not who asked. The group sees the answer, not her name.`,
          },
          {
            target: "identity",
            opens: "identity",
            section: "income",
            title: "What comes back",
            body: `What it could add up to. Each payment traces to something she did, and arrives without an invoice. Sample figures. Nobody is paid through the network today.`,
          },
          {
            target: "identity",
            opens: "identity",
            section: "invites",
            title: "Who you bring in",
            body: "Bring people in and the network could pay you back: a small share when they earn, from the 10% Network Rate, never on top. Tap “Explode it” to see her network.",
          },
        ]
      : []),
    {
      target: "identity",
      opens: "identity",
      section: "together",
      title: "Stronger together",
      body: `Together, ${name}'s record proves original, consented judgement, which AI is short of. So the group can set terms as one. The start of an intelligence that is public, answers to the people who made it, and could pay them.`,
    },
    ...(edition.showcase && getModule("how")
      ? [
          {
            target: "how",
            opens: "how",
            title: "How it all works",
            body: "Underneath: a ledger nobody can quietly change, money that moves in seconds, your group's own chat, and intelligence groups run together. No mining, no coin to buy. Tap a layer to follow Alice's answer down.",
          },
          ...(story && has("agent")
            ? [
                {
                  target: "agent",
                  opens: "agent",
                  title: `Talk to ${name}`,
                  body: `Over time it all collapses into one conversation. ${name} gives you the read, does the jobs it can and waits for your passkey to send or spend. Tap any tile for the detail.`,
                },
              ]
            : []),
        ]
      : []),
    edition.showcase && !packed
      ? {
          tailor: true,
          title: shaped ? "Something else in mind?" : "What are you looking for?",
          body: shaped
            ? "Describe another group and the demo changes to match."
            : "Describe your group in a sentence and this demo becomes yours.",
        }
      : {
          title: "Next: logins for everyone",
          body: `When ${name} is ready, each member gets a passkey login at ${name}'s own address, and everything goes live. Ask us.`,
        },
  );
  return out;
}

/** Whether the walkthrough has been seen in this collective. */
export function tourSeen() {
  return localStorage.getItem(TOUR_KEY) === "done";
}

export function Tour({
  installed,
  open,
  setCatalog,
  onClose,
}: {
  installed: string[];
  open: (id: string) => void;
  setCatalog: (tab: false | CatalogTab) => void;
  onClose: () => void;
}) {
  const list = useMemo(() => steps(installed), [installed]);
  const [i, setI] = useState(0);
  const step = list[i];
  const last = i === list.length - 1;
  const [ring, setRing] = useState<DOMRect | null>(null);

  const finish = useCallback(() => {
    localStorage.setItem(TOUR_KEY, "done");
    setCatalog(false);
    onClose();
  }, [onClose, setCatalog]);

  useEffect(() => {
    if (step.opens) open(step.opens);
    setCatalog(step.target === "catalog" ? (step.tab ?? "plugins") : false);
    if (step.section)
      // after the surface has drawn
      requestAnimationFrame(() =>
        document
          .querySelector(`[data-tour-section="${step.section}"]`)
          ?.scrollIntoView({ block: "start", behavior: "smooth" }),
      );
  }, [step, open, setCatalog]);

  // Follow the rail button, including when the window changes size.
  useLayoutEffect(() => {
    const place = () => {
      const el = step.target ? document.querySelector(`[data-tour="${step.target}"]`) : null;
      // On a phone the rail scrolls sideways: bring the button into view
      // without moving anything else on the page.
      const bar = el?.closest<HTMLElement>(".overflow-x-auto");
      if (el && bar) {
        const r = el.getBoundingClientRect(), b = bar.getBoundingClientRect();
        if (r.left < b.left || r.right > b.right) bar.scrollLeft += r.left - b.left - b.width / 2 + r.width / 2;
      }
      setRing(el ? el.getBoundingClientRect() : null);
    };
    place();
    window.addEventListener("resize", place);
    return () => window.removeEventListener("resize", place);
  }, [step]);

  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (e.key === "Escape") finish();
      if (e.key === "ArrowRight" && !last) setI((n) => n + 1);
      if (e.key === "ArrowLeft") setI((n) => Math.max(0, n - 1));
    };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, [finish, last]);

  return (
    <>
      {ring && (
        <div
          aria-hidden
          className="pointer-events-none fixed z-40 rounded-[calc(var(--radius)+4px)] transition-all duration-200"
          style={{
            left: ring.left - 5,
            top: ring.top - 5,
            width: ring.width + 10,
            height: ring.height + 10,
            boxShadow: "0 0 0 2px var(--fg), 0 0 0 6px color-mix(in srgb, var(--fg) 12%, transparent)",
          }}
        />
      )}
      <div
        role="dialog"
        aria-label="Walk through the app"
        className="fixed inset-x-3 bottom-[5.5rem] z-40 max-h-[calc(100dvh-7.5rem)] overflow-y-auto rounded-[calc(var(--radius)+4px)] border border-[var(--line-strong)] bg-[var(--card)] p-5 shadow-[0_20px_80px_rgba(0,0,0,0.18)] md:inset-x-auto md:bottom-6 md:right-6 md:w-[26rem]"
      >
        <div className="flex items-center gap-3">
          <span className="font-mono text-[11px] text-[var(--faint)]">
            {i + 1} of {list.length}
          </span>
          <span className="h-[3px] flex-1 overflow-hidden bg-[var(--line)]">
            <span
              className="block h-full transition-all"
              style={{ width: `${((i + 1) / list.length) * 100}%`, background: "var(--fg)" }}
            />
          </span>
          <button onClick={finish} title="Close the walkthrough" className="text-[var(--faint)] hover:text-[var(--fg)]">
            <X className="h-4 w-4" />
          </button>
        </div>
        <h2 className="font-tight mt-4 text-lg font-medium">{step.title}</h2>
        <p className="mt-2 text-[14px] leading-relaxed text-[var(--muted)]">{step.body}</p>
        {step.tailor && (
          <div className="mt-4">
            <TailorForm autoFocus />
          </div>
        )}
        <div className="mt-5 flex flex-wrap items-center gap-2">
          {i > 0 && (
            <Button variant="quiet" icon={ArrowLeft} onClick={() => setI(i - 1)}>
              Back
            </Button>
          )}
          <span className="flex-1" />
          {last ? (
            <>
              <Button icon={Mail} onClick={askForLogins}>
                {askLabel}
              </Button>
              <Button variant={step.tailor ? "quiet" : "primary"} onClick={finish}>
                Explore on my own
              </Button>
            </>
          ) : (
            <Button variant="primary" trailing={ArrowRight} onClick={() => setI(i + 1)}>
              {i === 0 ? "Start" : "Next"}
            </Button>
          )}
        </div>
      </div>
    </>
  );
}
