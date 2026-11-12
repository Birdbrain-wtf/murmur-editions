import { useEffect, useState } from "react";
import {
  UserPlus,
  Copy,
  Check,
  Link2,
  Palette,
  ChevronDown,
  KeyRound,
} from "lucide-react";
import type { MurmurPlugin, PluginContext } from "../../host/types";
import { issues } from "../../host/support";
import { getModule } from "../../host/registry";
import { useSkin, encodeSkin, EMPTY_SKIN } from "../../host/useSkin";
import { edition } from "../../edition";
import { approve } from "../../identity/participation";
import { LEVELS, LEVEL_LABEL, LEVEL_LINE, accessSupported, signInvite, useAccess, type Level } from "../../lib/access";
import { inviteIdOf } from "../../lib/simplex/inviteGraph";
import { Page, PageHeader, PageBody, Section, Card, Field, inputClass, Button, Notice } from "../../ui";

/**
 * Invite plugin: grow the collective person to person.
 *
 * This is the onboarding surface for headless, person-to-person growth. An
 * established user mints an invite that bundles (a) BOOTSTRAP — where to get the
 * *signed* Decent app — and (b) MEMBERSHIP — the instance, the inviter, and an
 * optional room/community to land in. The newcomer redeems it and becomes a
 * seed + inviter themselves, so the network expands without a central gate.
 *
 * Resilience line: distribution is decentralised, trust is not. The app a
 * newcomer installs is verified against the signing key baked into every
 * Decent build, so receiving the build from a peer is exactly as safe as from the
 * central site — the central endpoint becomes one seed among many. The invite
 * is dependency-free and works offline: it's just an encoded payload + a link.
 *
 * Role and permissions (2026-10-18). Where the collective keeps who can use what
 * (`edition.access`, lib/access.ts), the inviter also sets the newcomer's role and
 * their own level on each plugin. That part of the invite is signed with the
 * inviter's check-in key when the link is copied (session invite:<id>:<hash of
 * role + levels>), so nobody can change it in transit. It is a proposal: when the
 * newcomer signs in and pastes the link under Profile → Membership, the
 * collective's server files it in the inviter's name and applies it at once only
 * if the inviter decides at the collective's stage (its operator while incubated).
 */

const INVITE_VERSION = 1;

interface Spec {
  invitee: string;
  note: string;
  room: string;
  community: string;
}

interface InvitePayload {
  v: number;
  from: string | null;
  fromDid: string | null;
  inst: {
    slug: string;
    name: string;
    birdbrainBase: string;
    matrixHomeserver: string;
  };
  /**
   * How the newcomer arrives. "desktop" (the default) hands over the Decent
   * Mac app — a single-tenant client pointed at this instance's backends, which
   * is what the current cohort gets. "surface" bootstraps the keyless mobile
   * Surface app onto *their own* Zo, pointed at *their own* vault.
   */
  mode: "surface" | "desktop";
  /** machine-readable seed: the Surface deploy bundle a newcomer's agent fetches + deploys
   *  (surface mode only; a desktop invite carries none) */
  bundle?: string;
  /** machine-readable seed: the signed desktop-build manifest (desktop mode) */
  app: string;
  room?: string;
  community?: string;
  note?: string;
  /**
   * Optional brand skin (a `decent-skin:` code). When the inviter's client is
   * skinned and they choose to carry it, the newcomer's /join page renders in
   * the group's colours and they adopt the same brand on first launch — the
   * skin travels with the invite instead of being pasted separately.
   */
  skin?: string;
  /** the role set for them, their own level on named plugins, and the inviter's
   *  participation key whose check-in signs both (infra/services/access) */
  role?: string;
  access?: Record<string, Level>;
  grant?: string;
  ts: number;
}

/** url-safe base64 of a UTF-8 JSON payload (small invites only). */
function encodePayload(p: InvitePayload): string {
  const bytes = new TextEncoder().encode(JSON.stringify(p));
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin)
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

function Panel({ instance, identity, installed }: PluginContext) {
  const { skin } = useSkin();
  const [spec, setSpec] = useState<Spec>({
    invitee: "",
    note: "",
    room: "",
    community: "",
  });
  const [copied, setCopied] = useState<"msg" | "link" | null>(null);
  const skinCode = encodeSkin(skin);
  const hasSkin = encodeSkin(EMPTY_SKIN) !== skinCode;
  const [carrySkin, setCarrySkin] = useState(true);
  const brandName = skin.name?.trim() || instance.name;
  // One invite per visit: the id is a hash over the payload including ts, and the
  // signature over the role is bound to that id, so ts must not move between renders.
  const [ts] = useState(() => Date.now());

  // Role and permissions, where the collective keeps them.
  const { grid, me } = useAccess(accessSupported ? identity.session : null);
  const [role, setRole] = useState<string | null>(null);
  const [own, setOwn] = useState<Record<string, Level>>({});
  const [signed, setSigned] = useState<{ key: string; grant: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<{ ok: boolean; text: string; turnOn?: boolean } | null>(null);
  const [inviteId, setInviteId] = useState<string | null>(null);

  // An invite lands at the collective's own door, never at the API host the app
  // happens to talk to (which may be rented). No door, no link.
  const door = edition.invite;
  if (!door) {
    return (
      <Page>
        <PageHeader
          icon={UserPlus}
          eyebrow="invite"
          title="Invite someone in"
          lede={`Invites to ${instance.name} open once it has its own address for them. Until then, nobody gets a link that points anywhere else.`}
        />
      </Page>
    );
  }
  const origin = door.base;
  const appManifest = door.update;

  // The role they arrive with, and their own level where it differs from that role's.
  const defaultRole = grid?.roles.find((r) => r.default)?.id ?? "member";
  const roleId = role ?? defaultRole;
  const roleName = grid?.roles.find((r) => r.id === roleId)?.name ?? roleId;
  const plugins = grid ? Object.keys(grid.plugins).filter((id) => getModule(id) && (!installed || installed.includes(id))) : [];
  const roleLevel = (id: string): Level => grid?.plugins[id]?.[roleId] ?? "none";
  const access: Record<string, Level> = {};
  for (const id of plugins) if (own[id] && own[id] !== roleLevel(id)) access[id] = own[id];
  const hasAccess = !!grid && !!identity.session && (roleId !== defaultRole || Object.keys(access).length > 0);
  const accessKey = `${roleId}:${JSON.stringify(Object.keys(access).sort().map((k) => [k, access[k]]))}`;

  const base: Omit<InvitePayload, "grant"> = {
    v: INVITE_VERSION,
    from: identity.handle,
    fromDid: identity.did,
    inst: {
      slug: instance.slug,
      name: instance.name,
      birdbrainBase: instance.birdbrainBase,
      matrixHomeserver: instance.matrixHomeserver,
    },
    mode: "desktop",
    app: appManifest,
    ...(spec.room.trim() ? { room: spec.room.trim() } : {}),
    ...(spec.community.trim() ? { community: spec.community.trim() } : {}),
    ...(spec.note.trim() ? { note: spec.note.trim() } : {}),
    ...(hasSkin && carrySkin ? { skin: skinCode } : {}),
    ...(hasAccess && roleId !== defaultRole ? { role: roleId } : {}),
    ...(hasAccess && Object.keys(access).length ? { access } : {}),
    ts,
  };
  // The id covers from, the collective, room, community, note and ts only (the
  // ledger's contract), so it is known before the role is signed.
  useEffect(() => {
    let live = true;
    inviteIdOf({ v: base.v, from: base.from, fromDid: base.fromDid, inst: { slug: base.inst.slug }, room: base.room ?? null, community: base.community ?? null, note: base.note ?? null, ts }).then((id) => live && setInviteId(id));
    return () => {
      live = false;
    };
  }, [base.from, base.fromDid, base.inst.slug, base.room, base.community, base.note, ts]);
  const signatureKey = `${inviteId}:${accessKey}`;
  const grant = hasAccess && signed?.key === signatureKey ? signed.grant : null;
  const payload: InvitePayload = { ...base, ...(grant ? { grant } : {}) };

  const link = `${origin}/join#${encodePayload(payload)}`;
  const fromName = identity.handle ? ` from ${identity.handle}` : "";
  const room = spec.room.trim();
  const community = spec.community.trim();
  const invitee = spec.invitee.trim();
  const note = spec.note.trim();
  // "Decent" invites to Decent, "FTTF" invites to Four To The Floor on the FTTF app.
  const where =
    edition.productName === instance.name
      ? instance.name
      : `${instance.name} on the ${edition.productName} app`;
  const joins = [room ? `the ${room} chat room` : "", community ? `the ${community} collective` : ""]
    .filter(Boolean)
    .join(" and ");
  const notesLine = edition.vaultSync
    ? `Your notes are kept in ${edition.vaultName}.`
    : "Your notes stay on your own machine.";

  const message = `${invitee ? `${invitee}, you're` : "You're"} invited to ${where}.
${note ? `\n${note}\n` : ""}
The app is your own space for notes, and for shared notes you write with the people you invite. This invite${fromName} gets you set up:

1. Open this link: ${link}
2. Download the ${edition.productName} Mac app (Apple-silicon Mac, M1 or newer) and drag it into Applications.
3. The first time you open it, Control-click the app icon and choose Open. Apple has not notarised the app yet, so this one-time step gets you past Gatekeeper.
4. Start writing. ${notesLine} Shared notes are end-to-end encrypted, so not even the server that syncs them can read them.${joins ? `\n5. You'll also join ${joins}.` : ""}${
    hasAccess
      ? `\n${joins ? 6 : 5}. Once you're signed in, open Profile → Membership and paste this link. ${identity.handle || "Whoever invited you"} set you up as ${roleName.toLowerCase()}${
          Object.keys(access).length ? `, with your own access to ${Object.keys(access).map((id) => getModule(id)?.title ?? id).join(", ")}` : ""
        }, and that is how it comes through.`
      : ""
  }

Once you're in, you can invite people too. We keep a record of who invited whom.`;

  function set<K extends keyof Spec>(k: K, v: string) {
    setSpec((s) => ({ ...s, [k]: v }));
  }

  /** Sign the role and levels with the check-in key, so the link carries the inviter's signature over them. */
  async function sign(): Promise<string | null> {
    if (!inviteId) return null;
    const r = await signInvite(inviteId, roleId, access);
    if (!r.ok) {
      setNotice({ ok: false, text: r.error, turnOn: r.needsCheckIns });
      return null;
    }
    setSigned({ key: signatureKey, grant: r.grant });
    setNotice(null);
    return r.grant;
  }

  async function copy(which: "msg" | "link") {
    let text = which === "msg" ? message : link;
    if (hasAccess && !grant) {
      setBusy(true);
      const g = await sign();
      setBusy(false);
      if (!g) return;
      // The link just changed: it now carries the signature's key id.
      const signedLink = `${origin}/join#${encodePayload({ ...base, grant: g })}`;
      text = which === "msg" ? message.replace(link, signedLink) : signedLink;
    }
    await navigator.clipboard.writeText(text);
    // Lets the setup list in the app's own agent tick "invite someone" off.
    localStorage.setItem("murmur.invited.v1", new Date().toISOString());
    setCopied(which);
    setTimeout(() => setCopied(null), 1600);
  }

  async function turnOn(which: "msg" | "link") {
    if (!identity.session) return;
    setBusy(true);
    try {
      await approve(identity.session);
      setNotice(null);
      await copy(which);
    } catch (e: any) {
      setNotice({ ok: false, text: e?.message || "That did not work." });
    } finally {
      setBusy(false);
    }
  }

  const server = (() => {
    try {
      return new URL(instance.matrixHomeserver).host || "matrix.org";
    } catch {
      return "matrix.org";
    }
  })();

  const fields: {
    k: keyof Spec;
    label: string;
    hint: string;
    placeholder: string;
    area?: boolean;
  }[] = [
    {
      k: "invitee",
      label: "Who you're inviting",
      hint: "Optional. Their name opens the message.",
      placeholder: "Alice",
    },
    {
      k: "note",
      label: "A note",
      hint: "Optional. A line in your own words about why.",
      placeholder: "",
      area: true,
    },
    {
      k: "room",
      label: "A chat room to add them to",
      hint: "Optional. The room's Matrix address.",
      placeholder: `#welcome:${server}`,
    },
    {
      k: "community",
      label: "Which collective they join",
      hint: `Optional. Leave it blank and they join ${instance.name}.`,
      placeholder: instance.slug,
    },
  ];

  return (
    <Page>
      <PageHeader
        icon={UserPlus}
        eyebrow="invite"
        title="Invite someone in"
        lede={`Send someone a link that installs the app and brings them into ${instance.name}. Once they're in, they can invite people too.`}
      />

      <PageBody width="read">
        <div className="space-y-5">
          {fields.map((f) => (
            <Field key={f.k} label={f.label} hint={f.hint}>
              {f.area ? (
                <textarea
                  value={spec[f.k]}
                  onChange={(e) => set(f.k, e.target.value)}
                  placeholder={f.placeholder}
                  rows={2}
                  className={`${inputClass} resize-y`}
                />
              ) : (
                <input
                  value={spec[f.k]}
                  onChange={(e) => set(f.k, e.target.value)}
                  placeholder={f.placeholder}
                  spellCheck={f.k === "invitee"}
                  className={inputClass}
                />
              )}
            </Field>
          ))}

          {hasSkin && (
            <button
              type="button"
              onClick={() => setCarrySkin((v) => !v)}
              aria-pressed={carrySkin}
              className="prism-hover flex w-full items-center gap-3 rounded-[var(--radius)] border border-[var(--line)] bg-[var(--card)] px-4 py-3 text-left"
            >
              <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-[var(--radius)] border border-[var(--line-strong)]">
                <Palette className="h-4 w-4 text-[var(--muted)]" />
              </span>
              <span className="min-w-0 flex-1">
                <span className="font-tight block text-sm font-medium">Carry the {brandName} look</span>
                <span className="block text-xs leading-snug text-[var(--muted)]">
                  They see the invite in your colours and can keep them in one tap.
                </span>
              </span>
              <span
                data-on={carrySkin}
                className="relative h-5 w-9 shrink-0 rounded-full border border-[var(--line-strong)] transition data-[on=true]:border-[var(--fg)]"
              >
                <span
                  data-on={carrySkin}
                  className="absolute top-0.5 left-0.5 h-3.5 w-3.5 rounded-full bg-[var(--faint)] transition data-[on=true]:translate-x-4 data-[on=true]:bg-[var(--fg)]"
                />
              </span>
            </button>
          )}

          {accessSupported && (
            <Section
              label="what they can do"
              icon={KeyRound}
              lede={
                !identity.session
                  ? `Sign in to set their role and what they can use in ${instance.name}.`
                  : !grid
                    ? `Reading ${instance.name}'s roles.`
                    : me?.approver
                      ? `Their role, and their own level on each plugin where it should differ. You decide changes in ${instance.name}, so this takes effect when they sign in and paste the invite.`
                      : `Their role, and their own level on each plugin where it should differ. ${grid.approvers} decides it when they arrive; until then they're a member.`
              }
            >
              {identity.session && grid && (
                <div className="flex flex-col gap-4">
                  <Field label="Role" hint={grid.roles.find((r) => r.id === roleId)?.line}>
                    <select aria-label="Role" value={roleId} onChange={(e) => setRole(e.target.value)} className={inputClass + " w-auto"}>
                      {grid.roles
                        .filter((r) => r.id !== "operator")
                        .map((r) => (
                          <option key={r.id} value={r.id}>
                            {r.name}
                          </option>
                        ))}
                    </select>
                  </Field>
                  <ul className="flex flex-col divide-y divide-[var(--line)] rounded-[var(--radius)] border border-[var(--line)]">
                    {plugins.map((id) => {
                      const level = own[id] ?? roleLevel(id);
                      return (
                        <li key={id} className="flex flex-wrap items-center gap-x-4 gap-y-2 px-3 py-2 text-[13px]">
                          <span className="min-w-28 font-medium">{getModule(id)!.title}</span>
                          <span className="flex flex-wrap gap-1">
                            {LEVELS.map((l) => (
                              <button
                                key={l}
                                type="button"
                                aria-pressed={level === l}
                                title={LEVEL_LINE[l]}
                                onClick={() =>
                                  setOwn((o) => {
                                    const next = { ...o, [id]: l };
                                    if (l === roleLevel(id)) delete next[id];
                                    return next;
                                  })
                                }
                                className="prism-hover rounded-[var(--radius)] border border-[var(--line)] px-2 py-0.5 text-[12px] aria-pressed:border-[var(--fg)] aria-pressed:font-medium"
                              >
                                {LEVEL_LABEL[l]}
                              </button>
                            ))}
                          </span>
                          {access[id] && <span className="text-[11px] text-[var(--faint)]">their own, not {roleName.toLowerCase()}'s</span>}
                        </li>
                      );
                    })}
                  </ul>
                  <p className="text-[12px] leading-relaxed text-[var(--faint)]">
                    {hasAccess
                      ? `Signed with your check-in key when you copy, so nobody can change it on the way. Operations and Files keep their own list, and the other plugins don't check levels yet.`
                      : `Leave it as it is and they arrive as ${roleName.toLowerCase()}, like everyone who signs in.`}
                  </p>
                </div>
              )}
            </Section>
          )}

          {notice && (
            <Notice tone={notice.ok ? "ok" : "danger"}>
              <span className="flex flex-wrap items-center gap-3">
                {notice.text}
                {notice.turnOn && (
                  <Button variant="primary" busy={busy} onClick={() => void turnOn("msg")}>
                    Turn on check-ins and copy
                  </Button>
                )}
              </span>
            </Notice>
          )}

          <div className="flex flex-wrap items-center gap-2 pt-1">
            <Button variant="primary" size="md" icon={copied === "msg" ? Check : UserPlus} busy={busy} onClick={() => copy("msg")}>
              {copied === "msg" ? "Copied" : "Copy invite"}
            </Button>
            <Button size="md" icon={copied === "link" ? Check : Link2} busy={busy} onClick={() => copy("link")}>
              {copied === "link" ? "Copied" : "Copy link"}
            </Button>
          </div>
        </div>

        <Section
          label="the invite"
          lede={`Send it any way you like: chat, email or in person. The app checks every download against ${edition.productName}'s signing key, so it is safe whoever passes it on.`}
        >
          <Card tone="quiet">
            <p className="max-h-80 overflow-y-auto whitespace-pre-wrap text-[13px] leading-relaxed text-[var(--fg)] [overflow-wrap:anywhere]">
              {message}
            </p>
          </Card>
        </Section>

        <details className="group rounded-[var(--radius)] border border-[var(--line)] bg-[var(--card)]">
          <summary className="prism-hover flex cursor-pointer list-none items-center justify-between gap-4 rounded-[var(--radius)] px-5 py-3 text-sm [&::-webkit-details-marker]:hidden">
            <span className="font-tight font-medium">For their agent</span>
            <ChevronDown className="h-4 w-4 text-[var(--muted)] transition group-open:rotate-180" />
          </summary>
          <div className="space-y-3 border-t border-[var(--line)] px-5 py-4">
            <p className="text-[13px] leading-relaxed text-[var(--muted)]">
              The same invite as data, for someone who sets up with their own AI agent. The link opens a page that reads it and walks them in.
            </p>
            <pre className="font-mono max-h-64 overflow-y-auto whitespace-pre-wrap rounded-[var(--radius)] border border-[var(--line)] bg-[var(--raise)] px-4 py-3 text-[11px] leading-relaxed text-[var(--muted)] [overflow-wrap:anywhere]">
              {JSON.stringify(payload, null, 2)}
            </pre>
          </div>
        </details>

        <p className="text-[13px] leading-relaxed text-[var(--muted)]">
          {identity.handle
            ? `Your invites carry your name, ${identity.handle}, so ${instance.name} knows who brought them in.`
            : `Sign in first so your invites show who brought them in.`}
        </p>
      </PageBody>
    </Page>
  );
}

export const invitePlugin: MurmurPlugin = {
  id: "invite",
  title: "Invite",
  tagline: `Invite someone into ${edition.instance.name}`,
  icon: UserPlus,
  order: 70,
  kind: "plugin",
  support: issues("invite"),
  backend: "Peer-to-peer (signed build · this instance)",
  Panel,
};
