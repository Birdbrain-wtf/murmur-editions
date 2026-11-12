import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ArrowLeft, Copy, KeyRound, Link2, LockKeyhole, MessageSquareLock, Power, RefreshCw, Send, Trash2, UserPlus, Users } from "lucide-react";
import type { ReactNode } from "react";
import type { PluginContext } from "../../host/types";
import { edition } from "../../edition";
import { approve, participate, supported as checkInsSupported, useParticipation } from "../../identity/participation";
import {
  Button,
  Card,
  Empty,
  Facts,
  Field,
  Gate,
  List,
  Notice,
  Page,
  PageBody,
  PageHeader,
  Row,
  Section,
  Status,
  Waiting,
  inputClass,
} from "../../ui";
import {
  Chat,
  appFetch,
  contactOf,
  hasSimplex,
  itemsOf,
  removeSimplex,
  setSimplexEnabled,
  simplexWs,
  useSimplex,
  type Contact,
  type Item,
  type SimplexStatus,
} from "../../lib/simplex";
import { Composer } from "./conversation";
import { httpInviteSink } from "../../lib/simplex/inviteGraph";
import { Trust, isControl, type Pending } from "../../lib/simplex/trust";

/**
 * Private chats: one-to-one conversations over SimpleX, on the collective's own
 * relay (Birdbrain's on birdbrain.wtf, Decent's on Decent's box). They sit inside
 * Chat beside the group rooms (Matrix), one tap away, and never mix with them:
 * group rooms are where a group talks and is remembered, a private chat is where
 * two people talk and nothing is kept anywhere but their own computers. One plugin
 * for the member, two engines underneath (rich 2026-10-16; was the separate
 * `chat-p2p` plugin until then). Only editions with `privateChats` offer it.
 *
 * The SimpleX core runs on this computer (src-tauri/src/simplex.rs). Inviting
 * someone makes a one-time link and an entry in the invite graph, and the trust
 * flow in src/lib/simplex/trust.ts proves the invite with two signed check-ins
 * (ADR 0069), so the edge is recorded as verified. Private messages are never
 * read into any world model.
 */

const mb = (n?: number | null) => (n ? (n / 1e6).toFixed(0) : "0");

/** The private side of Chat. `switcher` is the group rooms / private chats switch. */
export function PrivateChats({ ctx, switcher }: { ctx: PluginContext; switcher: ReactNode }) {
  const status = useSimplex();
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const { identity } = ctx;

  const toggle = async (on: boolean) => {
    setBusy(true);
    setProblem(null);
    try {
      await setSimplexEnabled(on, identity.handle);
    } catch (e) {
      setProblem(String(e));
    } finally {
      setBusy(false);
    }
  };

  const header = (
    <PageHeader
      icon={MessageSquareLock}
      eyebrow="chat"
      title="Private chats"
      lede={`Talk one to one with another member. Messages are end-to-end encrypted, so only the two of you and your devices can read them. ${edition.productName}'s relay carries them sealed and never learns who is talking. They are never read into ${edition.productName}'s memory, and they never appear in the group rooms.`}
      actions={switcher}
    />
  );

  if (!hasSimplex) {
    return (
      <Page>
        {header}
        <PageBody>
          <Gate icon={MessageSquareLock} title="Private chats run in the desktop app">
            <p>Your keys and your conversations are kept on your own computer, which a browser tab can't do.</p>
          </Gate>
        </PageBody>
      </Page>
    );
  }

  if (!identity.signedIn || !identity.handle) {
    return (
      <Page>
        {header}
        <PageBody>
          <Gate
            icon={KeyRound}
            title="Sign in first"
            action={<Button variant="primary" onClick={() => ctx.open("identity")}>Go to Profile</Button>}
          >
            <p>The people you invite see who you are by the name you signed in with.</p>
          </Gate>
        </PageBody>
      </Page>
    );
  }

  return (
    <Page>
      {header}
      <PageBody width="wide">
        {problem && <Notice tone="danger">{problem}</Notice>}
        {!status || status.phase === "off" ? (
          <Gate
            icon={Power}
            title="Switch on private chats"
            action={<Button variant="primary" icon={Power} busy={busy} onClick={() => toggle(true)}>Switch on</Button>}
          >
            <p>
              This computer fetches the messaging program, checks it against {edition.productName}'s release key, and runs it here.
              Your contacts and messages stay on this computer. Private chats are new and still being tested.
            </p>
          </Gate>
        ) : status.phase === "fetching" ? (
          <Waiting>Fetching the messaging program ({mb(status.fetchedBytes)} of {mb(status.fetchTotal)} MB)</Waiting>
        ) : status.phase === "starting" ? (
          <Waiting>Starting private chats</Waiting>
        ) : status.phase === "error" ? (
          <Card>
            <Notice tone="danger">{status.error ?? "Private chats stopped."}</Notice>
            <div className="mt-3 flex gap-2">
              <Button icon={RefreshCw} busy={busy} onClick={() => toggle(true)}>Try again</Button>
              <Button variant="quiet" onClick={() => toggle(false)}>Switch off</Button>
            </div>
          </Card>
        ) : (
          <Ready ctx={ctx} status={status} />
        )}
        {status && status.phase !== "off" && <ThisComputer status={status} />}
      </PageBody>
    </Page>
  );
}

function Ready({ ctx, status }: { ctx: PluginContext; status: SimplexStatus }) {
  const { identity, instance } = ctx;
  const { grant, approving } = useParticipation();
  const grantRef = useRef(grant);
  grantRef.current = grant;
  const [chat, setChat] = useState<Chat | null>(null);
  const [trust, setTrust] = useState<Trust | null>(null);
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [open, setOpen] = useState<number | null>(null);
  const [live, setLive] = useState<Item[]>([]);
  const [, bump] = useState(0);
  const [problem, setProblem] = useState<string | null>(null);

  // The same door the invite plugin uses for /api/murmur/invite: the
  // collective's own, even in dev where birdbrainBase is "".
  const inviteBase = edition.invite?.base || instance.birdbrainBase || edition.origin;

  useEffect(() => {
    let gone = false;
    let c: Chat | null = null;
    (async () => {
      for (let i = 0; i < 30 && !gone; i++) {
        const url = await simplexWs();
        if (url) {
          try {
            c = await Chat.open(url);
            break;
          } catch {
            /* the core is still opening its socket */
          }
        }
        await new Promise((r) => setTimeout(r, 1000));
      }
      if (gone) return c?.close();
      if (!c) return setProblem("Couldn't reach private chats on this computer. Switch it off and on again.");
      const t = new Trust({
        chat: c,
        me: { handle: identity.handle!, did: identity.did ?? null },
        sink: httpInviteSink(inviteBase, appFetch),
        participate: (session) => participate("chat", session),
        collective: () => grantRef.current?.collective ?? null,
        slug: instance.slug,
        name: instance.name,
        onChange: () => bump((n) => n + 1),
      });
      const chatNow = c;
      chatNow.client.onEvent(async (resp) => {
        try {
          if (resp?.type === "contactConnected" && resp.contact) {
            const ct = contactOf(resp.contact);
            setContacts((cs) => (cs.some((x) => x.id === ct.id) ? cs : [...cs, ct]));
            await t.connected(ct);
          }
          const items = itemsOf(resp);
          if (!items.length) return;
          setLive((l) => [...l, ...items]);
          const cs = await chatNow.contacts();
          setContacts(cs);
          for (const it of items) await t.received(it, cs.find((x) => x.id === it.contactId));
        } catch (e) {
          setProblem(String(e));
        }
      });
      setChat(chatNow);
      setTrust(t);
      try {
        setContacts(await t.reconcile());
      } catch (e) {
        setProblem(String(e));
      }
    })();
    return () => {
      gone = true;
      c?.close();
    };
  }, [identity.handle, identity.did, inviteBase, instance.slug, instance.name]);

  // Check-ins just came on: finish what was waiting for them.
  useEffect(() => {
    if (grant && trust && (trust.waiting.size > 0 || trust.state.invites.some((p) => !p.checkedIn))) {
      trust.retry().then(setContacts).catch((e) => setProblem(String(e)));
    }
  }, [grant, trust]);

  const peerName = useCallback(
    (c: Contact) => trust?.state.peers[c.id]?.handle ?? c.name,
    [trust, trust?.state],
  );

  if (!chat || !trust) {
    return problem ? <Notice tone="danger">{problem}</Notice> : <Waiting>Opening your conversations</Waiting>;
  }

  const current = open != null ? contacts.find((c) => c.id === open) : undefined;
  const needsCheckIns = checkInsSupported && (!grant || trust.waiting.size > 0);

  return (
    <>
      {problem && <Notice tone="danger">{problem}</Notice>}
      {needsCheckIns && (
        <Card tone="quiet">
          <Row
            icon={KeyRound}
            title="Check-ins are off"
            detail="Turn them on so an invite you make or accept is recorded as a real one. One passkey tap, for up to 12 hours. Your messages are not part of it."
            action={
              identity.session ? (
                <Button variant="primary" busy={approving} onClick={() => approve(identity.session!).catch((e) => setProblem(e?.message ?? String(e)))}>
                  {approving ? "Waiting for your passkey" : "Turn on"}
                </Button>
              ) : (
                <Button onClick={() => ctx.open("identity")}>Turn on in Profile</Button>
              )
            }
          />
        </Card>
      )}
      {current ? (
        <Conversation
          chat={chat}
          contact={current}
          name={peerName(current)}
          invite={trust.inviteFor(current.id)}
          live={live.filter((i) => i.contactId === current.id)}
          onBack={() => setOpen(null)}
        />
      ) : (
        <>
          {status.canConnect ? (
            <div className="grid gap-8 md:grid-cols-2">
              <Invite trust={trust} />
              <Join trust={trust} />
            </div>
          ) : (
            <Notice tone="warn">
              This copy of the app can't start new conversations, so inviting and joining are off. Update the app to
              use them.
            </Notice>
          )}
          <Section label="Conversations" icon={Users}>
            {contacts.length === 0 ? (
              <Empty>No one yet. Invite someone, or join with a link someone gave you.</Empty>
            ) : (
              <List>
                {contacts.map((c) => (
                  <Row
                    key={c.id}
                    title={peerName(c)}
                    detail={inviteLine(trust.inviteFor(c.id))}
                    action={<Button onClick={() => setOpen(c.id)}>Open</Button>}
                  />
                ))}
              </List>
            )}
          </Section>
        </>
      )}
    </>
  );
}

/** What happened to the invite a contact came in on, in a member's words. */
function inviteLine(p: Pending | undefined): string | undefined {
  if (!p) return undefined;
  if (p.claim && "verified" in p.claim) return p.claim.verified ? "You invited them. Recorded as a real invite." : "You invited them. Recorded, not yet confirmed by both check-ins.";
  if (p.claim) return "You invited them. The invite couldn't be recorded yet.";
  if (!p.checkedIn) return "You invited them. Waiting for your check-in.";
  if (p.helloSent) return "You invited them. Waiting for them to check in.";
  return "You invited them.";
}

function Invite({ trust }: { trust: Trust }) {
  const [busy, setBusy] = useState(false);
  const [link, setLink] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const mint = async () => {
    setBusy(true);
    setProblem(null);
    setNote(null);
    setLink(null);
    try {
      const { link, pending, outcome } = await trust.mint();
      setLink(link);
      if (pending.mintError) setNote("The link works, but the invite couldn't be recorded. Try another later.");
      else if (outcome.status === "needs-approval") setNote("Turn check-ins on above, so this invite is recorded as a real one.");
      else if (outcome.status === "failed") setNote(`Your check-in didn't go through: ${outcome.error}`);
    } catch (e) {
      setProblem(String(e));
    } finally {
      setBusy(false);
    }
  };

  const copy = async () => {
    if (!link) return;
    await navigator.clipboard.writeText(link);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  return (
    <Section label="Invite someone" icon={UserPlus} lede="A link for one person. Send it to them however you like. It works once.">
      <Card>
        {link ? (
          <div className="space-y-3">
            <div className="font-mono max-h-24 overflow-auto break-all rounded-[var(--radius)] border border-[var(--line-strong)] p-3 text-[11px] text-[var(--muted)]">
              {link}
            </div>
            <div className="flex flex-wrap gap-2">
              <Button variant="primary" icon={Copy} onClick={copy}>{copied ? "Copied" : "Copy the link"}</Button>
              <Button variant="quiet" busy={busy} onClick={mint}>Make another</Button>
            </div>
          </div>
        ) : (
          <Button variant="primary" icon={Link2} busy={busy} onClick={mint}>Make an invite link</Button>
        )}
        {note && <div className="mt-3"><Notice tone="warn">{note}</Notice></div>}
        {problem && <div className="mt-3"><Notice tone="danger">{problem}</Notice></div>}
      </Card>
    </Section>
  );
}

function Join({ trust }: { trust: Trust }) {
  const [link, setLink] = useState("");
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  const join = async () => {
    setBusy(true);
    setProblem(null);
    setDone(false);
    try {
      await trust.join(link);
      setLink("");
      setDone(true);
    } catch (e) {
      setProblem(String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Section label="Join with a link" icon={Link2} lede="Paste the link another member sent you.">
      <Card>
        <Field label="Their link">
          <textarea
            value={link}
            onChange={(e) => setLink(e.target.value)}
            rows={3}
            spellCheck={false}
            placeholder="simplex:/invitation#…"
            className={`${inputClass} font-mono resize-y text-[11px]`}
          />
        </Field>
        <div className="mt-3">
          <Button variant="primary" busy={busy} disabled={!link.trim().startsWith("simplex:")} onClick={join}>Join</Button>
        </div>
        {done && <div className="mt-3"><Notice tone="ok">Asked to connect. They appear below once their app answers.</Notice></div>}
        {problem && <div className="mt-3"><Notice tone="danger">{problem}</Notice></div>}
      </Card>
    </Section>
  );
}

function Conversation({
  chat,
  contact,
  name,
  invite,
  live,
  onBack,
}: {
  chat: Chat;
  contact: Contact;
  name: string;
  invite: Pending | undefined;
  live: Item[];
  onBack: () => void;
}) {
  const [history, setHistory] = useState<Item[] | null>(null);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const end = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let gone = false;
    chat.history(contact.id).then((h) => !gone && setHistory(h)).catch((e) => !gone && setProblem(String(e)));
    return () => {
      gone = true;
    };
  }, [chat, contact.id]);

  // History plus anything that arrived since, once each, hellos left out.
  const items = useMemo(() => {
    const seen = new Set<number>();
    return [...(history ?? []), ...live]
      .filter((i) => (seen.has(i.id) ? false : (seen.add(i.id), true)))
      .filter((i) => !isControl(i.text));
  }, [history, live]);

  useEffect(() => end.current?.scrollIntoView({ block: "end" }), [items.length]);

  const send = async () => {
    const t = text.trim();
    if (!t || busy) return;
    if (isControl(t)) return setProblem("That line can't be sent as a message.");
    setBusy(true);
    setProblem(null);
    try {
      await chat.send(contact.id, t);
      setText("");
    } catch (e) {
      setProblem(String(e));
    } finally {
      setBusy(false);
    }
  };

  const verified = invite?.claim && "verified" in invite.claim && invite.claim.verified;

  return (
    <Section label={name} icon={LockKeyhole} lede={inviteLine(invite) ?? "End-to-end encrypted. Kept only on your two computers."}>
      <div className="mb-3 flex items-center gap-3">
        <Button variant="quiet" icon={ArrowLeft} onClick={onBack}>All conversations</Button>
        {verified && <Status tone="ok">verified invite</Status>}
      </div>
      <Card>
        {history === null ? (
          <Waiting>Loading the conversation</Waiting>
        ) : items.length === 0 ? (
          <p className="text-[13px] text-[var(--muted)]">No messages yet. Say hello.</p>
        ) : (
          <div className="max-h-[50vh] space-y-2 overflow-auto">
            {items.map((i) => (
              <div key={i.id} className={i.mine ? "flex justify-end" : "flex justify-start"}>
                <div
                  className={`max-w-[75%] whitespace-pre-wrap break-words rounded-[var(--radius)] border px-3 py-2 text-sm ${
                    i.mine ? "border-[var(--line-strong)]" : "border-[var(--line)] bg-[var(--raise)]"
                  }`}
                >
                  {i.text}
                </div>
              </div>
            ))}
            <div ref={end} />
          </div>
        )}
        <Composer value={text} onChange={setText} name={name} busy={busy} onSend={() => void send()} />
        {problem && <div className="mt-3"><Notice tone="danger">{problem}</Notice></div>}
      </Card>
    </Section>
  );
}

function ThisComputer({ status }: { status: SimplexStatus }) {
  const [busy, setBusy] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  const act = async (f: () => Promise<unknown>) => {
    setBusy(true);
    setProblem(null);
    try {
      await f();
      setConfirm(false);
    } catch (e) {
      setProblem(String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Section label="This computer" icon={KeyRound}>
      <Card tone="quiet">
        <Facts items={[["program", status.version ?? "-"], ["relay", status.relayHost]]} />
        <div className="mt-3 flex flex-wrap gap-2">
          <Button variant="quiet" busy={busy} onClick={() => act(() => setSimplexEnabled(false))}>Switch off private chats</Button>
          {confirm ? (
            <Button variant="danger" icon={Trash2} busy={busy} onClick={() => act(removeSimplex)}>Delete them from this computer</Button>
          ) : (
            <Button variant="quiet" onClick={() => setConfirm(true)}>Remove</Button>
          )}
        </div>
        {confirm && (
          <p className="mt-2 text-[13px] text-[var(--muted)]">
            This deletes your contacts and messages on this computer. The people you talked to keep their own copies.
          </p>
        )}
        {problem && <div className="mt-3"><Notice tone="danger">{problem}</Notice></div>}
      </Card>
    </Section>
  );
}
