import { useEffect, useState, type ReactNode } from "react";
import { Link2, ExternalLink } from "lucide-react";
import { edition } from "../../edition";
import type { MurmurPlugin, PluginContext } from "../../host/types";
import { issues } from "../../host/support";
import { openInBrowser } from "../../identity/passkey";
import { PasskeySignIn } from "../../identity/SignIn";
import { sessionRejected } from "../../identity/session";
import { useIdentity } from "../../identity/useIdentity";
import { hasHub, checked, hubClient, type Chain } from "../../lib/hub";
import { CallBuilder, ChainBrowser, ChainPicker } from "./chains";
import { countMembers } from "../../lib/kreivo";
import { Button, Card, Empty, Facts, List, Notice, Page, PageBody, PageHeader, Row, Section, Status, Waiting } from "../../ui";

/**
 * On chain: the collective as the chains see it (infra/services/explorer).
 *
 * The group's own explorer, served from the collective's own address
 * (`edition.explorer`): where it came from, who can change it, what it holds and
 * which of its claims the chains confirm, all read when asked. Members are counted
 * in public. Inside the app a member also sees who else is in the group: the app
 * sends its session, the door checks on chain that the member holds a membership,
 * and only then are names joined to holders.
 *
 * Two more tabs read any chain the app follows directly, through the light
 * client on this computer (./chains.tsx): live blocks, accounts, storage and
 * constants. In Birdbrain a third builds any call the chain takes and hands it
 * to the app's signer, which shows the member what it does before signing.
 * Signing works on the test network only for now (lib/signer.ts, `signable`).
 */

/** The call builder is a power tool: Birdbrain first (the lab). */
const BUILDS = edition.id === "murmur";
type Tab = "group" | "chains" | "build";

const base = edition.explorer?.base ?? null;

type Check = { ok: boolean | null; detail: string; link: string };
type Explorer = {
  readAt: string;
  group: any;
  recorded?: { registered?: string; line?: string };
  assetHub: any;
  seeds: any;
  proofs: { label: string; date?: string; note?: string; check: Check }[];
};
type Members = { block: number; members: { name: string | null; address: string; memberships: number[]; you: boolean }[]; unnamed: number; line: string };

/**
 * The member count again, read through the light client on this computer
 * (src/lib/kreivo.ts) the same way the explorer reads it.
 */
function Recount({ community, claimed }: { community: number; claimed: number }) {
  const [state, setState] = useState<"idle" | "reading" | "done" | "error">("idle");
  const [result, setResult] = useState<{ count: number; block: number } | null>(null);
  const [err, setErr] = useState<string | null>(null);
  if (!hasHub) return null;
  const run = async () => {
    setState("reading");
    setErr(null);
    try {
      const r = await countMembers(await hubClient("kreivo"), community);
      setResult({ count: r.count, block: r.block });
      setState("done");
    } catch (e: any) {
      setErr(String(e?.message ?? e));
      setState("error");
    }
  };
  const agrees = result && result.count === claimed;
  return (
    <Row
      title={checked ? "Counted on this computer" : "Counted again from a public server"}
      status={
        state === "done" ? (
          <Status tone={agrees ? "ok" : "danger"}>{agrees ? "agrees" : "differs"}</Status>
        ) : state === "reading" ? (
          <Status tone="warn" pulse>reading</Status>
        ) : undefined
      }
      detail={
        state === "done" && result
          ? `${result.count} members at block ${result.block.toLocaleString("en-GB")}${agrees ? ", the same as the explorer." : `. The explorer said ${claimed}. It may have read an earlier block, so count again in a moment.`}`
          : state === "error"
            ? `Couldn't count: ${err}`
            : state === "reading"
              ? "Following Kusama and Kreivo to read the memberships. The first time takes a minute or two."
              : checked
                ? "Read the memberships from Kreivo yourself, checked against the chain's own proofs, and compare."
                : "In the desktop app this is checked against the chain's own proofs."
      }
      action={state !== "reading" && <Button onClick={() => void run()}>{state === "done" ? "Count again" : "Count here"}</Button>}
    />
  );
}

const short = (a: string) => (a.length > 20 ? `${a.slice(0, 8)}…${a.slice(-6)}` : a);

function GroupView({ identity, switcher }: PluginContext & { switcher: ReactNode }) {
  const { signIn } = useIdentity();
  const [data, setData] = useState<Explorer | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [members, setMembers] = useState<Members | null>(null);
  const [membersError, setMembersError] = useState<string | null>(null);
  const [asking, setAsking] = useState(false);
  const session = identity.session ?? null;

  const [attempt, setAttempt] = useState(0);
  const [showAll, setShowAll] = useState(false);

  useEffect(() => {
    if (!base) return;
    let live = true;
    setError(null);
    fetch(`${base}/api/explorer`, { headers: { Accept: "application/json" }, signal: AbortSignal.timeout(60_000) })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`it answered ${r.status}`))))
      .then((d) => live && setData(d))
      .catch((e) => live && setError(e.name === "TimeoutError" ? "no answer in a minute" : e.message));
    return () => {
      live = false;
    };
  }, [attempt]);

  useEffect(() => {
    if (!base || !session) return;
    let live = true;
    setMembersError(null);
    fetch(`${base}/api/explorer/members`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({ session }),
    })
      .then(async (r) => {
        const j = await r.json().catch(() => ({}));
        if (r.status === 401) sessionRejected(session);
        if (!r.ok) throw new Error(j.error || `The explorer answered ${r.status}.`);
        return j as Members;
      })
      .then((m) => live && setMembers(m))
      .catch((e) => live && setMembersError(e.message));
    return () => {
      live = false;
    };
  }, [session]);

  if (!base)
    return (
      <Page>
        <PageHeader icon={Link2} eyebrow="on chain" title={edition.instance.name} />
        <PageBody>
          {switcher}
          <Empty>{edition.instance.name} has no explorer of its own yet. It comes with the collective's own address.</Empty>
        </PageBody>
      </Page>
    );

  const g = data?.group && !data.group.error ? data.group : null;
  const ah = data?.assetHub && !data.assetHub.error ? data.assetHub : null;
  const seeds = data?.seeds && !data.seeds.error ? data.seeds : null;
  const host = base.replace(/^https:\/\//, "");
  const atBlock = (n: number) => `Read at block ${n.toLocaleString("en-GB")}`;
  const chainRow = (name: string, what: string, read: any, raw: any) => (
    <Row
      key={name}
      title={name}
      detail={read ? `${what}. ${atBlock(read.block.number)}.` : raw?.error ? `${what}. ${raw.error.replace(/^Could not read [^:]+: /, "Couldn't read it: ")}` : what}
      status={read ? <Status tone="ok">read now</Status> : raw?.error ? <Status tone="danger">not read</Status> : <Status tone="warn" pulse>reading</Status>}
    />
  );
  const LIMIT = 8;
  const shown = members ? (showAll ? members.members : members.members.slice(0, LIMIT)) : [];

  return (
    <Page>
      <PageHeader
        icon={Link2}
        eyebrow="on chain"
        title={edition.instance.name}
        lede="Where the group came from, who can change it, what it holds and what it can prove, read from the chains when you open this."
        actions={
          <Button variant="quiet" icon={ExternalLink} onClick={() => void openInBrowser(`${base}/explorer`)}>
            Public page
          </Button>
        }
      />
      <PageBody width="wide">
        {switcher}
        {error && (
          <Card tone="dashed">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="min-w-0">
                <div className="font-tight text-sm font-medium">Couldn't reach the explorer</div>
                <div className="mt-1 text-[13px] leading-relaxed text-[var(--muted)]">
                  {host} didn't answer ({error}). Nothing below is a stored figure, so there is nothing to show until it does.
                </div>
              </div>
              <Button variant="primary" onClick={() => setAttempt((n) => n + 1)}>
                Try again
              </Button>
            </div>
          </Card>
        )}
        {!data && !error && <Waiting>Reading the chains…</Waiting>}

        {data && (
          <Section label="The chains" lede="Each is read when you open this. A chain that doesn't answer says so and never falls back to an old number.">
            <List>
              {chainRow("Kreivo", "Membership and governance", g, data.group)}
              {chainRow("Kusama Asset Hub", "Money, contracts and anchors", ah, data.assetHub)}
              {data.seeds !== null && data.seeds !== undefined && chainRow("Seeds chain", "Contributions anchored by the group", seeds, data.seeds)}
            </List>
          </Section>
        )}

        {g && (
          <Section label="The group">
            <List>
              <Row title={`${g.members.count} members`} detail={`Community ${g.community} on Kreivo`} status={<Status tone="ok">{g.state}</Status>} />
              <Recount community={g.community} claimed={g.members.count} />
              <Row
                title="Who can change it"
                detail={
                  g.governedBy?.kind === "key"
                    ? `One key, ${short(g.governedBy.address)}${g.governedBy.isOperator ? ", the collective's own operator" : ", not the operator we recorded"}`
                    : g.governedBy?.kind === "community"
                      ? `Community ${g.governedBy.community} governs itself`
                      : "No origin maps to this community"
                }
              />
              {g.lineage.map((l: any) => (
                <Row key={l.community} title={`Part of ${l.name}`} detail={`Its community account holds membership ${l.item} of community ${l.community}`} status={<Status tone="ok">on chain</Status>} />
              ))}
              {data?.recorded?.registered && <Row title="Registered" detail={`${data.recorded.registered}. ${data.recorded.line ?? ""}`} status={<Status>recorded</Status>} />}
              <Row title={`${g.openProposals} open proposals`} detail={g.decisionMethod === "membership" ? "One member, one vote" : g.decisionMethod ?? undefined} />
            </List>
          </Section>
        )}


        {data && (
          <Section label="What it can prove">
            {data.proofs.length ? (
              <List>
                {data.proofs.map((p) => (
                  <Row
                    key={p.label}
                    title={p.label}
                    detail={`${p.check.detail}${p.note ? `. ${p.note}` : ""}`}
                    status={<Status tone={p.check.ok === true ? "ok" : p.check.ok === false ? "danger" : "idle"}>{p.check.ok === true ? "checked" : p.check.ok === false ? "does not hold" : "not read"}</Status>}
                    action={p.check.link ? <Button variant="quiet" icon={ExternalLink} onClick={() => void openInBrowser(p.check.link)}>Chain</Button> : undefined}
                  />
                ))}
              </List>
            ) : (
              <Empty>Nothing recorded yet. The first proof shows here the moment one is written down.</Empty>
            )}
          </Section>
        )}

        {ah && (
          <Section label="What it holds" lede="On Kusama Asset Hub: the group's accounts and the contracts it owns.">
            <List>
              {ah.accounts.map((a: any) => (
                <Row key={a.address} title={a.label} detail={`${a.what} · ${short(a.address)}`} status={<Status>{a.dUSD} dUSD</Status>} />
              ))}
              {ah.contracts.map((x: any) => (
                <Row key={x.address} title={x.label} detail={`${x.what} · ${short(x.address)}`} status={<Status tone={x.deployed ? "ok" : x.deployed === false ? "danger" : "idle"}>{x.deployed ? "deployed" : x.deployed === false ? "no code" : "not read"}</Status>} />
              ))}
            </List>
          </Section>
        )}

        <Section label="Who is in it" lede="Only members see names. Each name is the one the door holds for an account that holds a membership now.">
          {!session && !asking && (
            <Card tone="dashed">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <span className="text-[13px] text-[var(--muted)]">Sign in to see who else is in {edition.instance.name}.</span>
                <Button variant="primary" onClick={() => setAsking(true)}>
                  Sign in
                </Button>
              </div>
            </Card>
          )}
          {!session && asking && <PasskeySignIn onSignedIn={(who) => { signIn(who); setAsking(false); }} title={`Sign in to ${edition.instance.name}`} />}
          {session && !members && !membersError && <Waiting>Asking the door…</Waiting>}
          {membersError && <Notice tone="warn">{membersError}</Notice>}
          {members && (
            <>
              <List>
                {shown.map((m) => (
                  <Row
                    key={m.address}
                    title={m.name ?? "Unnamed"}
                    detail={`${short(m.address)} · membership ${m.memberships.join(", ")}`}
                    status={m.you ? <Status tone="live">you</Status> : undefined}
                  />
                ))}
              </List>
              {members.members.length > LIMIT && (
                <div className="mt-3">
                  <Button variant="quiet" onClick={() => setShowAll((v) => !v)}>
                    {showAll ? "Show fewer" : `Show all ${members.members.length}`}
                  </Button>
                </div>
              )}
              <Notice>{members.line}</Notice>
            </>
          )}
        </Section>

        {data && <Facts items={[["read", new Date(data.readAt).toLocaleString("en-GB")], ["from", host]]} />}
      </PageBody>
    </Page>
  );
}

const CHAIN_KEY = "murmur.onchain.chain.v1";

function Panel(ctx: PluginContext) {
  const tabs: [Tab, string][] = [
    ["group", "Your group"],
    ...(hasHub ? ([["chains", "Chains"]] as [Tab, string][]) : []),
    ...(hasHub && BUILDS ? ([["build", "Build a call"]] as [Tab, string][]) : []),
  ];
  const [tab, setTab] = useState<Tab>("group");
  const [chain, setChainState] = useState<Chain>(() => (localStorage.getItem(CHAIN_KEY) as Chain) || "kreivo");
  const setChain = (c: Chain) => {
    localStorage.setItem(CHAIN_KEY, c);
    setChainState(c);
  };
  const switcher =
    tabs.length > 1 ? (
      <div className="mb-6 flex gap-1" role="tablist">
        {tabs.map(([id, label]) => (
          <button
            key={id}
            role="tab"
            aria-selected={tab === id}
            onClick={() => setTab(id)}
            data-active={tab === id}
            className="rounded-full border border-[var(--line)] px-3 py-1 text-xs text-[var(--muted)] transition hover:text-[var(--fg)] data-[active=true]:border-[var(--fg)] data-[active=true]:text-[var(--fg)]"
          >
            {label}
          </button>
        ))}
      </div>
    ) : null;
  if (tab === "group") return <GroupView {...ctx} switcher={switcher} />;
  return (
    <Page>
      <PageHeader
        icon={Link2}
        eyebrow="on chain"
        title={tab === "chains" ? "Chains" : "Build a call"}
        lede={
          tab === "chains"
            ? "Any chain this app follows, read on this computer: blocks as they arrive, accounts, and everything the chain keeps."
            : "Any call the chain takes. The app reads it back to you in plain words before you sign."
        }
        actions={<ChainPicker chain={chain} onPick={setChain} />}
      />
      <PageBody width="wide">
        {switcher}
        {tab === "chains" ? <ChainBrowser key={chain} chain={chain} /> : <CallBuilder key={chain} chain={chain} open={ctx.open} />}
      </PageBody>
    </Page>
  );
}

export const onchainPlugin: MurmurPlugin = {
  id: "onchain",
  title: "On chain",
  tagline: "Your group as the chains see it",
  icon: Link2,
  order: 60,
  kind: "plugin",
  support: issues("onchain"),
  backend: "infra/services/explorer, on the collective's own address, and the light client on this computer",
  signs: ["paseo"],
  Panel,
};
