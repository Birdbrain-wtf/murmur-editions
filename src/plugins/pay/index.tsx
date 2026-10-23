import { useState } from "react";
import {
  Wallet,
  CreditCard,
  Plus,
  RefreshCw,
  Coins,
  Eye,
  EyeOff,
} from "lucide-react";
import type { MurmurPlugin, PluginContext } from "../../host/types";
import { issues } from "../../host/support";
import { openInBrowser } from "../../identity/passkey";
import {
  walletBalance,
  walletInit,
  walletTransactions,
  walletCard,
  accountUrn,
  accountBalance,
  accountName,
  cardInfo,
  isCardAccount,
  WalletVerificationError,
  type WalletAccount,
  type WalletVerification,
  type WalletTx,
} from "../../lib/wallet";
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

function Panel({ instance, identity }: PluginContext) {
  // Wallet calls share the instance's Decent space origin (same as birdbrain).
  const base = instance.birdbrainBase;

  const [alias, setAlias] = useState((identity.handle ?? "").replace(/^@/, ""));
  const [phase, setPhase] = useState<"idle" | "loading" | "ready">("idle");
  const [error, setError] = useState<string | null>(null);
  const [accounts, setAccounts] = useState<WalletAccount[] | null>(null);
  const [creating, setCreating] = useState(false);
  const [verification, setVerification] = useState<WalletVerification | null>(null);

  const [selected, setSelected] = useState<string | null>(null);
  const [txLoading, setTxLoading] = useState(false);
  const [txs, setTxs] = useState<WalletTx[] | null>(null);

  // Reveal the live card face (Pomelo secure iframe) — fetched fresh on click.
  const [revealUrn, setRevealUrn] = useState<string | null>(null);
  const [revealUrl, setRevealUrl] = useState<string | null>(null);
  const [revealLoading, setRevealLoading] = useState(false);

  async function connect(e?: React.FormEvent) {
    e?.preventDefault();
    const a = alias.trim().replace(/^@/, "");
    if (!a) return;
    setPhase("loading");
    setError(null);
    setTxs(null);
    setSelected(null);
    try {
      setAccounts(await walletBalance(base, a));
      setPhase("ready");
    } catch (err) {
      setError(err instanceof Error ? err.message : "could not reach Decent Pay");
      setPhase("idle");
    }
  }

  // Provisions a real Bloque pocket + card — only on explicit request.
  async function createWallet() {
    const a = alias.trim().replace(/^@/, "");
    if (!a) return;
    setCreating(true);
    setError(null);
    setVerification(null);
    try {
      setAccounts(await walletInit(base, a));
    } catch (err) {
      if (err instanceof WalletVerificationError) {
        setVerification(err.verification);
        return;
      }
      setError(err instanceof Error ? err.message : "could not create wallet");
    } finally {
      setCreating(false);
    }
  }

  async function openAccount(a: WalletAccount) {
    const urn = accountUrn(a);
    if (!urn) return;
    setSelected(urn);
    setTxLoading(true);
    setTxs(null);
    try {
      setTxs(await walletTransactions(base, urn));
    } catch {
      setTxs([]);
    } finally {
      setTxLoading(false);
    }
  }

  async function toggleReveal(a: WalletAccount) {
    const urn = accountUrn(a);
    if (!urn) return;
    if (revealUrn === urn) {
      setRevealUrn(null);
      setRevealUrl(null);
      return;
    }
    const a2 = alias.trim().replace(/^@/, "");
    setRevealUrn(urn);
    setRevealUrl(null);
    setRevealLoading(true);
    try {
      const face = await walletCard(base, a2, urn);
      setRevealUrl(face.cardUrl ?? null);
    } catch {
      setRevealUrl(null);
    } finally {
      setRevealLoading(false);
    }
  }

  const shownAlias = alias.trim().replace(/^@/, "");

  // The alias form: inside the gate until a wallet is connected, then a quiet
  // bar above it (so the alias can still be changed or the balances refreshed).
  const aliasForm = (
    <form onSubmit={connect} className="flex items-end gap-2" data-active={phase === "loading"}>
      <div className="min-w-0 flex-1">
        <Field label="Alias" hint="The handle your wallet is under.">
          <input
            value={alias}
            onChange={(e) => setAlias(e.target.value)}
            placeholder="alice"
            className={inputClass}
          />
        </Field>
      </div>
      <Button
        type="submit"
        variant={phase === "ready" ? "secondary" : "primary"}
        size="md"
        icon={phase === "ready" ? RefreshCw : undefined}
        busy={phase === "loading"}
        disabled={!alias.trim()}
      >
        {phase === "ready" ? "Refresh" : "Connect"}
      </Button>
    </form>
  );

  return (
    <Page>
      <PageHeader
        icon={Wallet}
        eyebrow="pay"
        title="Your wallet"
        lede="Your balances, a card and your payments, through Decent Pay."
        actions={phase === "ready" && shownAlias ? <Status tone="ok">{shownAlias}</Status> : undefined}
      />
      <PageBody>
        {phase === "ready" ? (
          <Card tone="quiet">{aliasForm}</Card>
        ) : (
          <Gate icon={Coins} title="Connect your wallet">
            <p>Type your alias to see your balances, your card and your payments.</p>
            <div className="text-[var(--fg)]">{aliasForm}</div>
          </Gate>
        )}

        {error && <Notice tone="danger">Decent Pay: {error}</Notice>}

        {verification && (
          <Notice tone="warn">
            {verification.url ? (
              <>
                Bloque, who hold the money behind Decent Pay, need you to accept their terms
                before they open a wallet.{" "}
                <button
                  type="button"
                  className="underline"
                  onClick={() => openInBrowser(verification.url!)}
                >
                  Accept Bloque's terms
                </button>
                , then come back and press Create wallet again.
              </>
            ) : verification.retryable ? (
              <>
                Bloque, who hold the money behind Decent Pay, are still setting up your account
                for their new checks. Nothing was created. Try again later.
              </>
            ) : (
              <>
                Bloque need more checks before they open a wallet (
                {verification.missing.join(", ") || "verification"}). Nothing was created.
              </>
            )}
          </Notice>
        )}

        {phase === "ready" && accounts && accounts.length === 0 && (
          <Gate
            icon={CreditCard}
            title="No wallet yet"
            action={
              <Button variant="primary" size="md" icon={Plus} busy={creating} onClick={createWallet}>
                {creating ? "Creating" : "Create wallet"}
              </Button>
            }
          >
            <p>
              Create a wallet for <span className="font-mono text-[var(--fg)]">{shownAlias}</span>: a
              pocket for your balance and a card linked to it.
            </p>
          </Gate>
        )}

        {accounts &&
          accounts.length > 0 &&
          (() => {
            const cards = accounts.filter(isCardAccount);
            const others = accounts.filter((a) => !isCardAccount(a));
            return (
              <>
                {cards.length > 0 && (
                  <Section label="Cards" icon={CreditCard}>
                    <div className="space-y-4">
                      {cards.map((a, i) => {
                        const urn = accountUrn(a);
                        const bal = accountBalance(a);
                        const info = cardInfo(a);
                        const name = accountName(a) || "Decent Card";
                        const isOpen = urn != null && urn === selected;
                        const isRevealed = urn != null && urn === revealUrn;
                        const kind = info?.card_type === "VIRTUAL" ? "Virtual debit" : "Debit";
                        const active = info?.card_status?.toUpperCase() === "ACTIVE";
                        return (
                          <div key={urn ?? `card-${i}`}>
                            <button
                              onClick={() => openAccount(a)}
                              data-active={isOpen}
                              aria-label={`${name}, ${info?.card_provider ?? "VISA"} ${kind}`}
                              className="prism-hover block w-full rounded-[var(--radius)] border border-[var(--line)] bg-[var(--card)] px-5 py-4 text-left data-[active=true]:border-[var(--line-strong)]"
                            >
                              <Row
                                icon={CreditCard}
                                title={name}
                                status={
                                  info?.card_status ? (
                                    <Status tone={active ? "ok" : "idle"}>{info.card_status.toLowerCase()}</Status>
                                  ) : undefined
                                }
                                detail={kind}
                              />
                              <div className="font-tight mt-3 text-2xl font-medium">{bal ?? "–"}</div>
                              <div className="mt-3">
                                <Facts
                                  items={[
                                    ["card", `···· ${info?.card_last_four ?? "····"}`],
                                    ["network", info?.card_provider ?? "VISA"],
                                  ]}
                                />
                              </div>
                            </button>
                            <div className="mt-3 flex justify-end">
                              <Button icon={isRevealed ? EyeOff : Eye} onClick={() => toggleReveal(a)}>
                                {isRevealed ? "Hide card" : "Reveal card"}
                              </Button>
                            </div>
                            {isRevealed && (
                              <div className="mt-3 overflow-hidden rounded-[var(--radius)] border border-[var(--line)] bg-[var(--card)]">
                                {revealLoading ? (
                                  <div className="px-5 py-6">
                                    <Waiting>Loading the card</Waiting>
                                  </div>
                                ) : revealUrl ? (
                                  <iframe
                                    src={revealUrl}
                                    title="Card details"
                                    className="block h-[230px] w-full border-0 bg-white"
                                  />
                                ) : (
                                  <div className="px-5 py-6">
                                    <Notice>Card details are not available right now.</Notice>
                                  </div>
                                )}
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  </Section>
                )}

                {others.length > 0 && (
                  <Section label="Accounts" icon={Wallet}>
                    <div className="grid gap-3 sm:grid-cols-2">
                      {others.map((a, i) => {
                        const urn = accountUrn(a);
                        const bal = accountBalance(a);
                        const name = accountName(a) || "Wallet";
                        return (
                          <button
                            key={urn ?? `acct-${i}`}
                            onClick={() => openAccount(a)}
                            data-active={urn != null && urn === selected}
                            className="prism-hover block w-full rounded-[var(--radius)] border border-[var(--line)] bg-[var(--card)] px-5 py-4 text-left data-[active=true]:border-[var(--line-strong)]"
                          >
                            <Row icon={Wallet} title={name} />
                            <div className="font-tight mt-3 text-2xl font-medium">{bal ?? "–"}</div>
                            {urn && (
                              <div className="font-mono mt-2 w-full truncate text-[10px] text-[var(--faint)]">{urn}</div>
                            )}
                          </button>
                        );
                      })}
                    </div>
                  </Section>
                )}
              </>
            );
          })()}

        {selected && (
          <Section label="Payments" icon={RefreshCw}>
            {txLoading && <Waiting>Loading payments</Waiting>}
            {!txLoading && txs && txs.length === 0 && <Empty>No payments yet.</Empty>}
            {!txLoading && txs && txs.length > 0 && (
              <List>
                {txs.map((t, i) => (
                  <Row
                    key={t.id ?? i}
                    title={t.description || t.direction || t.status || "Payment"}
                    detail={t.createdAt ? <span className="font-mono text-[11px]">{fmtDate(t.createdAt)}</span> : undefined}
                    action={
                      t.amount != null ? (
                        <span className="font-mono text-sm">
                          {String(t.amount)}
                          {t.currency ? ` ${t.currency}` : ""}
                        </span>
                      ) : undefined
                    }
                  />
                ))}
              </List>
            )}
          </Section>
        )}
      </PageBody>
    </Page>
  );
}

function fmtDate(s: string): string {
  const d = new Date(s);
  return isNaN(d.getTime())
    ? s
    : d.toLocaleString([], {
        month: "short",
        day: "numeric",
        hour: "2-digit",
        minute: "2-digit",
      });
}

export const payPlugin: MurmurPlugin = {
  id: "pay",
  title: "Pay",
  tagline: "Your wallet: balances, a card and payments",
  icon: Wallet,
  order: 25,
  kind: "plugin",
  support: issues("pay"),
  backend: "Decent Pay",
  Panel,
};
