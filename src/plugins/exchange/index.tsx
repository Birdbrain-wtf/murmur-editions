import { useEffect, useMemo, useState } from "react";
import { ArrowLeftRight, Copy, KeyRound, Power, RefreshCw, Store, Wallet } from "lucide-react";
import type { MurmurModule, PluginContext } from "../../host/types";
import { issues } from "../../host/support";
import { edition } from "../../edition";
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
  DUSD,
  KSM,
  MATCH_STATUS,
  ORDER_STATUS,
  exchangeApi,
  exchangeBook,
  hasExchange,
  setExchangeEnabled,
  fromMsgRate,
  toMsgRate,
  useExchange,
  useExchangeUser,
  type BookOrder,
} from "../../lib/exchange";

/**
 * Exchange: KSM and dUSD between members, settled by atomic swap.
 *
 * The engine runs on this computer (src-tauri/src/exchange.rs) and holds the
 * member's exchange wallet. A market is joined with an invite code from whoever
 * runs it, which grants trading without a deposit. Each trade settles directly
 * between two members' wallets: both payments complete, or both come back.
 * Test money only until a market runs on the live chain.
 */

const mb = (n?: number | null) => (n ? (n / 1e6).toFixed(0) : "0");

function Panel(_: PluginContext) {
  const status = useExchange();
  const ready = status?.phase === "ready";
  const { user, error, refresh } = useExchangeUser(ready);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  const toggle = async (on: boolean) => {
    setBusy(true);
    setProblem(null);
    try {
      await setExchangeEnabled(on);
    } catch (e) {
      setProblem(String(e));
    } finally {
      setBusy(false);
    }
  };

  const header = (
    <PageHeader
      icon={ArrowLeftRight}
      eyebrow="exchange"
      title="Exchange"
      lede="Trade KSM and dUSD with other members. Each trade settles directly between two wallets: both payments complete, or both come back. Test money only for now."
      actions={ready ? <Button icon={RefreshCw} onClick={refresh}>Refresh</Button> : undefined}
    />
  );

  if (!hasExchange) {
    return (
      <Page>
        {header}
        <PageBody>
          <Gate icon={ArrowLeftRight} title="The exchange runs in the desktop app">
            <p>It keeps your exchange wallet on your own computer, which a browser tab can't do.</p>
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
            title="Switch on the exchange"
            action={<Button variant="primary" icon={Power} busy={busy} onClick={() => toggle(true)}>Switch on</Button>}
          >
            <p>
              This computer fetches the exchange engine, checks it against Birdbrain's release key, and runs it here. Your
              exchange wallet is kept on this computer. Nobody who runs a market ever holds your money.
            </p>
          </Gate>
        ) : status.phase === "fetching" ? (
          <Waiting>Fetching the exchange engine ({mb(status.fetchedBytes)} of {mb(status.fetchTotal)} MB)</Waiting>
        ) : status.phase === "starting" ? (
          <Waiting>Starting the exchange engine</Waiting>
        ) : status.phase === "error" ? (
          <Card>
            <Notice tone="danger">{status.error ?? "The exchange engine stopped."}</Notice>
            <div className="mt-3 flex gap-2">
              <Button icon={RefreshCw} busy={busy} onClick={() => toggle(true)}>Try again</Button>
              <Button variant="quiet" onClick={() => toggle(false)}>Switch off</Button>
            </div>
          </Card>
        ) : (
          <>
            {error && <Notice tone="warn">{error}</Notice>}
            {user && <Wallets user={user} onChange={refresh} />}
            {user && <Markets user={user} onChange={refresh} />}
            <Section label="This computer" icon={KeyRound}>
              <Card tone="quiet">
                <Facts items={[["engine", status.version ?? "-"], ["network", status.network]]} />
                <div className="mt-3">
                  <Button variant="quiet" busy={busy} onClick={() => toggle(false)}>Switch off the exchange</Button>
                </div>
              </Card>
            </Section>
          </>
        )}
      </PageBody>
    </Page>
  );
}

function amount(user: any, id: number, atoms: number) {
  const f = user.assets?.[id]?.unitInfo?.conventional?.conversionFactor ?? 1;
  return (atoms / f).toLocaleString(undefined, { maximumFractionDigits: 4 });
}

function Wallets({ user, onChange }: { user: any; onChange: () => void }) {
  const ksm = user.assets?.[KSM]?.wallet;
  const dusd = user.assets?.[DUSD]?.wallet;
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const setUp = async () => {
    setBusy(true);
    setProblem(null);
    try {
      await exchangeApi("/newwallet", { assetID: KSM, walletType: "rpc", config: {} });
      onChange();
    } catch (e) {
      setProblem(String(e));
    } finally {
      setBusy(false);
    }
  };

  if (!ksm) {
    return (
      <Section label="Wallet" icon={Wallet}>
        <Gate
          icon={Wallet}
          title="Set up your exchange wallet"
          action={<Button variant="primary" busy={busy} onClick={setUp}>Set up</Button>}
        >
          <p>One wallet on this computer holds both KSM and dUSD. It pays the network's small fee in KSM on every trade.</p>
          {problem && <Notice tone="danger">{problem}</Notice>}
        </Gate>
      </Section>
    );
  }

  const copy = async () => {
    await navigator.clipboard.writeText(ksm.address);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  return (
    <Section label="Wallet" icon={Wallet} lede="Send KSM and dUSD to this address to trade with them. Keep a little KSM for fees.">
      <List>
        <Row
          title={`${amount(user, KSM, ksm.balance?.available ?? 0)} KSM`}
          detail={ksm.balance?.locked ? `${amount(user, KSM, ksm.balance.locked + (ksm.balance.contractlocked ?? 0))} held in open trades` : undefined}
          status={<Status tone={ksm.synced ? "ok" : "warn"} pulse={!ksm.synced}>{ksm.synced ? "up to date" : "catching up"}</Status>}
        />
        <Row
          title={`${amount(user, DUSD, dusd?.balance?.available ?? 0)} dUSD`}
          detail={dusd?.balance?.locked ? `${amount(user, DUSD, dusd.balance.locked + (dusd.balance.contractlocked ?? 0))} held in open trades` : undefined}
        />
        <Row
          title="Address"
          detail={<span className="font-mono break-all">{ksm.address}</span>}
          action={<Button icon={Copy} onClick={copy}>{copied ? "Copied" : "Copy"}</Button>}
        />
      </List>
    </Section>
  );
}

function Markets({ user, onChange }: { user: any; onChange: () => void }) {
  const hosts = Object.values(user.exchanges ?? {}) as any[];
  return (
    <>
      {hosts.map((x) =>
        Object.values(x.markets ?? {}).map((m: any) => (
          <Market key={`${x.host}/${m.name}`} user={user} host={x.host} tier={x.auth?.effectiveTier ?? 0} market={m} onChange={onChange} />
        )),
      )}
      <Join first={hosts.length === 0} onJoined={onChange} />
    </>
  );
}

function Join({ first, onJoined }: { first: boolean; onJoined: () => void }) {
  const [open, setOpen] = useState(first);
  const [host, setHost] = useState(edition.exchangeMarket ?? "");
  const [code, setCode] = useState("");
  const [cert, setCert] = useState("");
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  useEffect(() => setOpen(first), [first]);

  const join = async () => {
    setBusy(true);
    setProblem(null);
    try {
      await exchangeApi("/redeemprepaidbond", { host: host.trim(), code: code.trim(), cert });
      setHost("");
      setCode("");
      setCert("");
      onJoined();
    } catch (e) {
      setProblem(String(e));
    } finally {
      setBusy(false);
    }
  };

  if (!open) {
    return <Button variant="quiet" onClick={() => setOpen(true)}>Join another market</Button>;
  }
  return (
    <Section label="Join a market" icon={Store} lede="Whoever runs a market gives its members an address and an invite code. The code lets you trade without putting down a deposit.">
      <Card>
        <div className="space-y-4">
          <Field label="Market address">
            <input className={inputClass} value={host} onChange={(e) => setHost(e.target.value)} placeholder="market.example:7232" />
          </Field>
          <Field label="Invite code">
            <input className={inputClass} value={code} onChange={(e) => setCode(e.target.value)} />
          </Field>
          <Field label="Certificate" hint="Only if the market gave you one.">
            <textarea className={`${inputClass} font-mono h-24 text-xs`} value={cert} onChange={(e) => setCert(e.target.value)} />
          </Field>
          {problem && <Notice tone="danger">{problem}</Notice>}
          <Button variant="primary" busy={busy} disabled={!host.trim() || !code.trim()} onClick={join}>Join</Button>
        </div>
      </Card>
    </Section>
  );
}

function Market({ user, host, tier, market, onChange }: { user: any; host: string; tier: number; market: any; onChange: () => void }) {
  const base = market.baseid as number;
  const quote = market.quoteid as number;
  const baseUnit = user.assets?.[base]?.unitInfo?.conventional;
  const quoteUnit = user.assets?.[quote]?.unitInfo?.conventional;
  const bf = baseUnit?.conversionFactor ?? 1;
  const qf = quoteUnit?.conversionFactor ?? 1;
  const lot = market.lotsize as number;

  const [book, setBook] = useState<{ sells: BookOrder[] | null; buys: BookOrder[] | null } | null>(null);
  const [bookError, setBookError] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    const tick = () =>
      exchangeBook(host, base, quote)
        .then((b) => { if (live) { setBook(b); setBookError(null); } })
        .catch((e) => live && setBookError(String(e)));
    tick();
    const t = setInterval(tick, 5000);
    return () => { live = false; clearInterval(t); };
  }, [host, base, quote]);

  const [sell, setSell] = useState(false);
  const [lots, setLots] = useState("1");
  const [price, setPrice] = useState("");
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  // The buyer pays in the quote token, which the swap contract may spend only
  // once the member allows it. 0 = allowed, 1 = waiting, 2 = not yet.
  const approval = user.assets?.[quote]?.wallet?.approved?.[1];
  const needsApproval = !sell && user.assets?.[quote]?.token && approval !== 0;

  const allow = async () => {
    setBusy(true);
    setProblem(null);
    try {
      await exchangeApi("/approvetoken", { assetID: quote, dexAddr: host });
      onChange();
    } catch (e) {
      setProblem(String(e));
    } finally {
      setBusy(false);
    }
  };

  const place = async () => {
    setBusy(true);
    setProblem(null);
    try {
      const n = Math.max(1, Math.floor(Number(lots)));
      await exchangeApi("/trade", {
        order: {
          host,
          isLimit: true,
          sell,
          base,
          quote,
          qty: n * lot,
          rate: toMsgRate(Number(price), bf, qf, market.ratestep),
          tifnow: false,
          options: {},
        },
      });
      onChange();
    } catch (e) {
      setProblem(String(e));
    } finally {
      setBusy(false);
    }
  };

  const cancel = async (id: string) => {
    try {
      await exchangeApi("/cancel", { orderID: id });
      onChange();
    } catch (e) {
      setProblem(String(e));
    }
  };

  // The member's recent orders on this market, finished ones included: the
  // engine's own view of the member carries only those still open.
  const [history, setHistory] = useState<any[]>([]);
  useEffect(() => {
    let live = true;
    const tick = () =>
      exchangeApi("/orders", { n: 12, hosts: [host], market: { baseID: base, quoteID: quote } })
        .then((r) => live && setHistory(r.orders ?? []))
        .catch(() => {});
    tick();
    const t = setInterval(tick, 5000);
    return () => { live = false; clearInterval(t); };
  }, [host, base, quote, market.orders?.length]);
  const orders = useMemo(() => {
    const byId = new Map<string, any>();
    for (const o of [...history, ...((market.orders ?? []) as any[])]) byId.set(o.id, o);
    return [...byId.values()].sort((a, b) => b.submitTime - a.submitTime).slice(0, 12);
  }, [history, market.orders]);
  const pair = `${baseUnit?.unit ?? "?"} for ${quoteUnit?.unit ?? "?"}`;
  const priceOk = Number(price) > 0 && Number(lots) >= 1;

  return (
    <Section
      label={pair}
      icon={ArrowLeftRight}
      aside={<Status tone={tier > 0 ? "ok" : "warn"}>{tier > 0 ? host : `${host}: no trading access`}</Status>}
    >
      <div className="grid gap-4 md:grid-cols-2">
        <Card>
          <div className="font-mono mb-2 grid grid-cols-2 text-[11px] text-[var(--faint)]">
            <span>price ({quoteUnit?.unit})</span>
            <span className="text-right">amount ({baseUnit?.unit})</span>
          </div>
          {bookError ? (
            <Notice tone="warn">{bookError}</Notice>
          ) : !book ? (
            <Waiting>Reading the book</Waiting>
          ) : !book.sells?.length && !book.buys?.length ? (
            <Empty>Nobody has an order in yet.</Empty>
          ) : (
            <div className="font-mono space-y-0.5 text-[13px]">
              {(book.sells ?? []).slice().reverse().map((o) => (
                <div key={o.token} className="grid grid-cols-2" style={{ color: "var(--danger)" }}>
                  <span>{o.rate}</span>
                  <span className="text-right">{o.qty}</span>
                </div>
              ))}
              <div className="my-1 border-t border-[var(--line)]" />
              {(book.buys ?? []).map((o) => (
                <div key={o.token} className="grid grid-cols-2" style={{ color: "var(--ok)" }}>
                  <span>{o.rate}</span>
                  <span className="text-right">{o.qty}</span>
                </div>
              ))}
            </div>
          )}
        </Card>

        <Card>
          <div className="mb-4 flex gap-2">
            <Button variant={!sell ? "primary" : "secondary"} onClick={() => setSell(false)}>Buy {baseUnit?.unit}</Button>
            <Button variant={sell ? "primary" : "secondary"} onClick={() => setSell(true)}>Sell {baseUnit?.unit}</Button>
          </div>
          <div className="space-y-4">
            <Field label={`Amount (${baseUnit?.unit})`} hint={`In whole lots of ${lot / bf} ${baseUnit?.unit}.`}>
              <input className={inputClass} inputMode="numeric" value={lots} onChange={(e) => setLots(e.target.value)} />
            </Field>
            <Field label={`Price (${quoteUnit?.unit} per ${baseUnit?.unit})`}>
              <input className={inputClass} inputMode="decimal" value={price} onChange={(e) => setPrice(e.target.value)} />
            </Field>
            {problem && <Notice tone="danger">{problem}</Notice>}
            {needsApproval ? (
              approval === 1 ? (
                <Waiting>Waiting for the network to confirm your permission</Waiting>
              ) : (
                <Button variant="primary" busy={busy} onClick={allow}>Allow trading with your {quoteUnit?.unit}</Button>
              )
            ) : (
              <Button variant="primary" busy={busy} disabled={!priceOk || tier < 1} onClick={place}>
                {sell ? "Sell" : "Buy"} {Number(lots) || 0} {baseUnit?.unit}
                {priceOk ? ` for ${(Number(lots) * Number(price)).toLocaleString()} ${quoteUnit?.unit}` : ""}
              </Button>
            )}
          </div>
        </Card>
      </div>

      <div className="mt-4">
        {orders.length === 0 ? null : (
          <List>
            {orders.map((o: any) => {
              // A cancel is recorded as a match of its own: not a trade.
              const m = (o.matches ?? []).find((x: any) => !x.isCancel);
              return (
                <Row
                  key={o.id}
                  title={`${o.sell ? "Sell" : "Buy"} ${amount(user, base, o.qty)} ${baseUnit?.unit} at ${fromMsgRate(o.rate, bf, qf)} ${quoteUnit?.unit}`}
                  detail={m ? `Trade ${MATCH_STATUS[m.status] ?? m.status}` : undefined}
                  status={<Status tone={o.status === 3 ? "ok" : o.status === 2 || o.status === 1 ? "live" : "idle"}>{ORDER_STATUS[o.status] ?? o.status}</Status>}
                  action={o.status === 2 && !o.cancelling ? <Button variant="quiet" onClick={() => cancel(o.id)}>Cancel</Button> : undefined}
                />
              );
            })}
          </List>
        )}
      </div>
    </Section>
  );
}

export const exchangePlugin: MurmurModule = {
  id: "exchange",
  title: "Exchange",
  tagline: "Trade KSM and dUSD with other members, wallet to wallet. Test money only",
  icon: ArrowLeftRight,
  order: 27,
  kind: "plugin",
  lab: true,
  support: issues("exchange"),
  backend: "An engine on this computer",
  Panel,
};
