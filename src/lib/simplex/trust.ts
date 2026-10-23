/**
 * The trust flow for a private-message invite (lab/simplex-comms, ADR 0069).
 *
 * SimpleX carries no identity, so a connection proves nothing about who is on
 * the other end. The invite graph learns it from two signed check-ins instead,
 * both into the session `chat:simplex:<inviteId>`:
 *
 *   1. The inviter mints a one-time link, records `mint`, and checks in.
 *   2. When the contact connects, the inviter sends a Decent hello naming the session.
 *   3. The invitee checks in to that session and replies with a hello saying so.
 *   4. The inviter posts `claim` with the invitee's handle and DID and the
 *      collective. The route re-verifies both check-ins from the participation
 *      ledger and marks the edge `verified` only if both are there.
 *
 * Hello lines are control messages: they are never shown as messages.
 * State lives in localStorage (`murmur.simplex.trust.v1`): the invite payloads
 * (which hold a hash of the link, never the link), and which steps are done.
 */
import type { Outcome } from "../../identity/participation";
import type { Chat, Contact, Item } from "./index";
import {
  DECENT_HELLO_PREFIX,
  buildSimplexPayload,
  decodeDecentHello,
  encodeDecentHello,
  inviteIdOf,
  simplexSession,
  type DecentIdentity,
  type InvitePayload,
  type InviteSink,
} from "./inviteGraph";

export interface Pending {
  inviteId: string;
  payload: InvitePayload;
  /** the connection the invitee will arrive on */
  connId: string;
  /** the inviter's own check-in is recorded */
  checkedIn: boolean;
  mintError?: string | null;
  contactId?: number;
  helloSent?: boolean;
  /** the invitee's reply: whether it said its check-in was recorded */
  theyCheckedIn?: boolean;
  claim?: { verified: boolean; at: number } | { error: string; at: number };
}

export interface TrustState {
  invites: Pending[];
  /** invitee side: the connections this side joined with someone's link */
  joinedConns: string[];
  /** invitee side: the session each contact handed us, and how our check-in went */
  joined: Record<number, { session: string; outcome?: "recorded" | "already" | "failed"; replied?: boolean }>;
  /** who each contact said they are, from their hello */
  peers: Record<number, DecentIdentity>;
}

const KEY = "murmur.simplex.trust.v1";

export function loadTrust(): TrustState {
  try {
    const s = JSON.parse(localStorage.getItem(KEY) || "null");
    if (s && Array.isArray(s.invites)) return { invites: s.invites, joinedConns: s.joinedConns ?? [], joined: s.joined ?? {}, peers: s.peers ?? {} };
  } catch {
    /* fresh */
  }
  return { invites: [], joinedConns: [], joined: {}, peers: {} };
}

export function saveTrust(s: TrustState) {
  localStorage.setItem(KEY, JSON.stringify(s));
}

/** Never show a hello, or anything wearing its prefix, as a message. */
export function isControl(text: string): boolean {
  return text.startsWith(DECENT_HELLO_PREFIX);
}

export interface TrustDeps {
  chat: Chat;
  me: DecentIdentity;
  sink: InviteSink;
  participate: (session: string) => Promise<Outcome>;
  /** the collective whose participation ledger holds the check-ins (the grant's) */
  collective: () => string | null;
  slug: string;
  name: string;
  load?: () => TrustState;
  save?: (s: TrustState) => void;
  onChange?: () => void;
}

export class Trust {
  state: TrustState;
  /** sessions waiting on the member to turn check-ins on */
  waiting = new Set<string>();
  private busy = Promise.resolve();

  constructor(private d: TrustDeps) {
    this.state = (d.load ?? loadTrust)();
  }

  private commit() {
    (this.d.save ?? saveTrust)(this.state);
    this.d.onChange?.();
  }

  /** One step at a time: events arrive together and must not race each other. */
  private serial<T>(f: () => Promise<T>): Promise<T> {
    const next = this.busy.then(f, f);
    this.busy = next.then(() => {}, () => {});
    return next;
  }

  private async checkIn(session: string): Promise<Outcome> {
    const o = await this.d.participate(session);
    if (o.status === "needs-approval") this.waiting.add(session);
    else this.waiting.delete(session);
    return o;
  }

  /** Inviter, step 1: a link to hand to one person. */
  mint(): Promise<{ link: string; pending: Pending; outcome: Outcome }> {
    return this.serial(async () => {
      const { link, connId } = await this.d.chat.invite();
      const payload = await buildSimplexPayload({ link, inviter: this.d.me, slug: this.d.slug, name: this.d.name });
      const inviteId = await inviteIdOf(payload);
      const pending: Pending = { inviteId, payload, connId, checkedIn: false };
      this.state.invites = [pending, ...this.state.invites].slice(0, 50);
      this.commit();
      try {
        await this.d.sink({ type: "mint", payload });
      } catch (e: any) {
        pending.mintError = e?.message ?? String(e);
      }
      const outcome = await this.checkIn(simplexSession(inviteId));
      pending.checkedIn = outcome.status === "recorded" || outcome.status === "already";
      this.commit();
      return { link, pending, outcome };
    });
  }

  /** Invitee: join with a link someone handed us. */
  join(link: string): Promise<void> {
    return this.serial(async () => {
      const connId = await this.d.chat.join(link);
      if (connId) this.state.joinedConns = [connId, ...this.state.joinedConns].slice(0, 100);
      this.commit();
    });
  }

  /** Inviter, step 2: the contact arrived on an invite's connection. Say hello, but
   *  only once our own check-in is in, so ours is the earlier one in the ledger. */
  connected(c: Contact): Promise<void> {
    return this.serial(async () => {
      const p = this.state.invites.find((x) => x.connId && x.connId === c.connId);
      if (!p) return;
      if (p.contactId !== c.id) {
        p.contactId = c.id;
        this.commit();
      }
      if (!p.checkedIn || p.helloSent) return;
      await this.d.chat.send(c.id, encodeDecentHello(this.d.me, { session: simplexSession(p.inviteId) }));
      p.helloSent = true;
      this.commit();
    });
  }

  /** A message from a contact. Hellos are acted on; everything else is left alone. */
  received(it: Item, contact: Contact | undefined): Promise<void> {
    if (it.mine || !isControl(it.text)) return Promise.resolve();
    const hello = decodeDecentHello(it.text);
    if (!hello) return Promise.resolve();
    return this.serial(async () => {
      const known = this.state.peers[it.contactId];
      if (!known || known.handle !== hello.handle || known.did !== hello.did) {
        this.state.peers[it.contactId] = { handle: hello.handle, did: hello.did };
        this.commit();
      }

      // Invitee, step 3: the inviter handed us its session. Only from a contact we
      // joined with a link, and only the first session it names, so a contact can't
      // steer our check-ins into someone else's invite.
      if (hello.session) {
        if (!contact?.connId || !this.state.joinedConns.includes(contact.connId)) return;
        const j = this.state.joined[it.contactId];
        if (j && j.session !== hello.session) return;
        if (j?.replied) return;
        this.state.joined[it.contactId] = { session: hello.session };
        await this.answer(it.contactId);
        return;
      }

      // Inviter, step 4: the invitee's reply. Claim the edge.
      const p = this.state.invites.find((x) => x.contactId === it.contactId);
      if (!p || !p.helloSent || (p.claim && "verified" in p.claim)) return;
      p.theyCheckedIn = hello.checkedIn === true;
      try {
        const r = await this.d.sink({
          type: "claim",
          payload: p.payload,
          to: hello.handle,
          toDid: hello.did,
          collective: this.d.collective(),
        });
        p.claim = { verified: !!r.verified, at: Date.now() };
      } catch (e: any) {
        p.claim = { error: e?.message ?? String(e), at: Date.now() };
      }
      this.commit();
    });
  }

  /** Invitee: check in to the session we were handed, then tell the inviter how it went. */
  private async answer(contactId: number) {
    const j = this.state.joined[contactId];
    if (!j || j.replied) return;
    const o = await this.checkIn(j.session);
    if (o.status === "needs-approval") {
      this.commit();
      return; // asked again once check-ins are on (retry)
    }
    const done = o.status === "recorded" || o.status === "already";
    j.outcome = done ? (o.status as "recorded" | "already") : "failed";
    await this.d.chat.send(contactId, encodeDecentHello(this.d.me, { checkedIn: done }));
    j.replied = true;
    this.commit();
  }

  /** After check-ins are turned on: finish whatever was waiting for them. */
  retry(): Promise<Contact[]> {
    return this.serial(async () => {
      for (const p of this.state.invites) {
        if (p.checkedIn) continue;
        const o = await this.checkIn(simplexSession(p.inviteId));
        p.checkedIn = o.status === "recorded" || o.status === "already";
      }
      this.commit();
      for (const id of Object.keys(this.state.joined)) await this.answer(Number(id));
    }).then(() => this.reconcile());
  }

  /** On opening: catch up with whatever happened while the window was closed. */
  async reconcile(): Promise<Contact[]> {
    const contacts = await this.d.chat.contacts();
    for (const c of contacts) {
      await this.connected(c);
      const involved = this.state.invites.some((p) => p.contactId === c.id) || (!!c.connId && this.state.joinedConns.includes(c.connId));
      if (!involved) continue;
      for (const it of await this.d.chat.history(c.id, 50)) await this.received(it, c);
    }
    return contacts;
  }

  /** The invite a contact came in on, if this side made it. */
  inviteFor(contactId: number): Pending | undefined {
    return this.state.invites.find((p) => p.contactId === contactId);
  }
}
