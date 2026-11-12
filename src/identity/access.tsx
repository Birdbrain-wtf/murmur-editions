import { useState } from "react";
import { ArrowUpRight, KeyRound } from "lucide-react";
import { edition } from "../edition";
import { getModule } from "../host/registry";
import { openInBrowser } from "./passkey";
import { Button, Facts, List, Notice, Row, Section, Status } from "../ui";
import { LEVEL_LABEL, accessSupported, setWeekly, useAccess, useConsents } from "../lib/access";

/**
 * Profile → Your access and consent. Two halves, from two places:
 *
 * - What you can do: your roles in this collective and the level each plugin
 *   gives you, read from the collective's own server (lib/access.ts). Changes are
 *   proposed in Plugins → Who can use what, never made here.
 * - What you have agreed to: read from the door, from the records it already keeps.
 *   Each line says what it allows and how to take it back. The app can turn off
 *   what is safe to turn off with its session (the weekly dispatch, check-ins,
 *   recordings). Leaving and deleting your record needs your passkey, so it is
 *   never done from the app.
 */

const day = (iso: string) => new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" });
const contact = edition.id === "murmur" ? "hello@birdbrain.wtf" : "hello@decent.partners";

export function AccessAndConsent({ session, installed, open }: { session: string; installed: string[]; open: (id: string) => void }) {
  const [n, setN] = useState(0);
  const { grid, me, error: accessError } = useAccess(session, n);
  const { consents, error: consentError } = useConsents(session, n);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const name = edition.instance.name;
  const site = new URL(edition.signIn.approve).origin;

  async function weekly(on: boolean) {
    setBusy(true);
    setNote(null);
    try {
      await setWeekly(session, on);
      setN((x) => x + 1);
    } catch (e: any) {
      setNote(e.message);
    } finally {
      setBusy(false);
    }
  }

  const roleNames = me && grid ? me.roles.map((r) => grid.roles.find((x) => x.id === r)?.name ?? r) : [];
  const plugins = grid ? Object.keys(grid.plugins).filter((id) => installed.includes(id) && getModule(id)) : [];
  const elsewhere = grid ? Object.entries(grid.elsewhere).filter(([id]) => installed.includes(id) && getModule(id)) : [];
  const a = consents?.agreement;

  return (
    <Section
      label="Your access and consent"
      icon={KeyRound}
      lede={`What you can do in ${name}, and everything you have agreed to, with how to take each one back.`}
    >
      <div className="flex flex-col gap-4">
        <List>
          {!accessSupported ? (
            <Row title="Your roles" status={<Status>not set up yet</Status>} detail={`${name} doesn't keep roles yet. Every member can use every plugin here.`} />
          ) : !me || !grid ? (
            <Row title="Your roles" status={<Status>{accessError ? "couldn't read" : "reading"}</Status>} detail={accessError ?? `Asking ${name}'s server.`} />
          ) : (
            <>
              <Row
                title={roleNames.join(" · ")}
                status={me.approver ? <Status tone="ok">you decide changes</Status> : undefined}
                detail={grid.roles
                  .filter((r) => me.roles.includes(r.id))
                  .map((r) => `${r.name}: ${r.line}.`)
                  .join(" ")}
              />
              <div>
                <div className="font-tight text-sm font-medium">What they let you do</div>
                <ul className="mt-2 grid grid-cols-1 gap-x-6 gap-y-1 text-[13px] sm:grid-cols-2">
                  {plugins.map((id) => (
                    <li key={id} className="flex justify-between gap-3">
                      <span className="text-[var(--muted)]">{getModule(id)!.title}</span>
                      <span className="font-mono text-[12px]">{LEVEL_LABEL[me.levels[id] ?? "none"]}</span>
                    </li>
                  ))}
                  {elsewhere.map(([id, line]) => (
                    <li key={id} className="flex justify-between gap-3" title={line}>
                      <span className="text-[var(--muted)]">{getModule(id)!.title}</span>
                      <span className="text-[12px] text-[var(--faint)]">its own list</span>
                    </li>
                  ))}
                </ul>
                <p className="mt-3 text-[12px] leading-relaxed text-[var(--faint)]">
                  {grid.line} Changes are proposed under Plugins → Who can use what. These levels are the record of what each role
                  may do. Operations and Files keep their own list, and the other plugins don't check levels yet.
                </p>
              </div>
            </>
          )}
        </List>

        <List>
          {!consents ? (
            <Row title="What you have agreed to" status={<Status>{consentError ? "couldn't read" : "reading"}</Status>} detail={consentError ?? "Asking your door."} />
          ) : (
            <>
              <Row
                title="The agreement"
                status={
                  a?.upToDate ? (
                    <Status tone="ok">accepted</Status>
                  ) : a?.accepted ? (
                    <Status tone="warn">a newer version is waiting</Status>
                  ) : (
                    <Status>not accepted here</Status>
                  )
                }
                detail={
                  <>
                    {a?.accepted
                      ? `You accepted it on ${day(a.accepted.at)}${a.history.length > 1 ? `, and ${a.history.length - 1} earlier ${a.history.length === 2 ? "version" : "versions"} before that` : ""}. `
                      : "Your door has no record of you accepting it. "}
                    It says what happens to what you contribute and what you're owed. Leaving and deleting your record takes your
                    passkey, so it is never done from the app: write to {contact} until your door has its own button.
                  </>
                }
                action={
                  <Button variant="quiet" onClick={() => void openInBrowser(`${site}/what-youre-joining`)} trailing={ArrowUpRight}>
                    Read it
                  </Button>
                }
              />
              <Row
                title="The weekly dispatch"
                status={consents.weekly.on ? <Status tone="ok">on</Status> : <Status>off</Status>}
                detail={
                  consents.weekly.email
                    ? `Sent to ${consents.weekly.email}${consents.weekly.confirmed ? "" : " (that address has not been confirmed)"}.`
                    : "No address on record, so nothing is sent."
                }
                action={
                  consents.weekly.email && (
                    <Button variant={consents.weekly.on ? "danger" : "secondary"} busy={busy} onClick={() => void weekly(!consents.weekly.on)}>
                      {consents.weekly.on ? "Turn off" : "Turn on"}
                    </Button>
                  )
                }
              />
              <Row
                title="Check-ins"
                status={consents.checkins.live ? <Status tone="ok">on</Status> : <Status>off</Status>}
                detail="Lets the app record that you took part in a call, chat or venue, and sign what you propose. Turn it off above under Membership, or by signing out."
              />
              {consents.calls && (
                <Row
                  title="Call recordings"
                  status={<Status tone={consents.calls.count ? "ok" : "idle"}>{consents.calls.count} kept</Status>}
                  detail={`Your own voice in project calls is yours: take a copy or withdraw it from Chat.${consents.calls.withdrawn ? ` You have withdrawn ${consents.calls.withdrawn}.` : ""}`}
                  action={
                    <Button onClick={() => open("chat")} trailing={ArrowUpRight}>
                      Open
                    </Button>
                  }
                />
              )}
            </>
          )}
        </List>
        {note && <Notice tone="danger">{note}</Notice>}
        {a?.accepted && <Facts items={[["agreement", a.accepted.version], ["accepted at", a.accepted.surface]]} />}
      </div>
    </Section>
  );
}
