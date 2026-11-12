import { useEffect, useMemo, useState } from "react";
import { Blocks, Hammer, Search, Database } from "lucide-react";
import type { PolkadotClient } from "polkadot-api";
import { checked, hubClient, type Chain } from "../../lib/hub";
import { callTemplate, pretty, readBlock, runtimeOf, template, toChain, toJson, typeName, type BlockView, type Runtime } from "../../lib/runtime";
import { CHAIN_LABEL, chainProps, requestSign, signable, type SignProgress } from "../../lib/signer";
import { accountKey, addressFor } from "../../lib/account";
import { formatAmount, readAddress } from "../../lib/swap";
import { Button, Card, Empty, Facts, Field, List, Notice, Row, Section, Status, Waiting, inputClass } from "../../ui";

/**
 * Any chain the app follows, read through its own light client and described by
 * its own metadata (lib/runtime.ts). Nothing here knows one chain from another.
 *
 * A light client keeps recent blocks only, so the block list fills as blocks
 * arrive rather than reaching back. Old history needs a full node or an archive.
 */

export const CHAINS: Chain[] = ["kreivo", "kusama", "paseo"];

export function useRuntime(chain: Chain) {
  const [client, setClient] = useState<PolkadotClient | null>(null);
  const [rt, setRt] = useState<Runtime | null>(null);
  const [block, setBlock] = useState<{ number: number; hash: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    let sub: { unsubscribe(): void } | null = null;
    setClient(null);
    setRt(null);
    setBlock(null);
    setError(null);
    hubClient(chain)
      .then(async (c) => {
        if (!live) return;
        setClient(c);
        sub = c.finalizedBlock$.subscribe((b) => live && setBlock({ number: b.number, hash: b.hash }));
        const r = await runtimeOf(c);
        if (live) setRt(r);
      })
      .catch((e) => live && setError(String(e?.message ?? e)));
    return () => {
      live = false;
      sub?.unsubscribe();
    };
  }, [chain]);
  return { client, rt, block, error };
}

export function ChainPicker({ chain, onPick }: { chain: Chain; onPick: (c: Chain) => void }) {
  return (
    <div className="flex flex-wrap gap-1">
      {CHAINS.map((c) => (
        <Button key={c} variant={c === chain ? "primary" : "secondary"} onClick={() => onPick(c)}>
          {CHAIN_LABEL[c]}
        </Button>
      ))}
    </div>
  );
}

const short = (a: string) => (a.length > 20 ? `${a.slice(0, 8)}…${a.slice(-6)}` : a);
const selectClass = inputClass + " pr-8";

// ── the browser ─────────────────────────────────────────────────────────────

export function ChainBrowser({ chain }: { chain: Chain }) {
  const { client, rt, block, error } = useRuntime(chain);
  return (
    <>
      <Card tone="quiet">
        <div className="mb-3">
          {checked ? (
            <Status tone={block ? "ok" : "warn"} pulse={!block}>
              {block ? "checked on this computer" : "catching up with the chain"}
            </Status>
          ) : (
            <Status tone="warn">read from a public server (preview only)</Status>
          )}
        </div>
        <Facts
          items={[
            ["chain", CHAIN_LABEL[chain]],
            ["final block", block ? `#${block.number.toLocaleString("en-GB")}` : "-"],
            ["runtime", rt ? `${rt.specName ?? "?"} ${rt.specVersion ?? ""}` : "-"],
            ["pallets", rt ? String(rt.pallets.length) : "-"],
          ]}
        />
      </Card>
      {error && <Notice tone="danger">{error}</Notice>}
      {client && rt && (
        <>
          <LiveBlocks client={client} rt={rt} />
          <AccountLookup client={client} chain={chain} />
          <Reader client={client} rt={rt} />
        </>
      )}
      {!error && !rt && <Waiting>Reading what the chain says about itself…</Waiting>}
    </>
  );
}

function LiveBlocks({ client, rt }: { client: PolkadotClient; rt: Runtime }) {
  const [blocks, setBlocks] = useState<BlockView[]>([]);
  const [open, setOpen] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    setBlocks([]);
    const sub = client.finalizedBlock$.subscribe((b) => {
      readBlock(client, rt, b)
        .then((v) => live && setBlocks((xs) => [v, ...xs.filter((x) => x.hash !== v.hash)].sort((a, b) => b.number - a.number).slice(0, 12)))
        .catch(() => {});
    });
    return () => {
      live = false;
      sub.unsubscribe();
    };
  }, [client, rt]);

  return (
    <Section label="Blocks as they arrive" icon={Blocks} lede="Every call and event in each final block, decoded here from the chain's own description of itself.">
      {!blocks.length ? (
        <Waiting>Waiting for the next final block</Waiting>
      ) : (
        <List>
          {blocks.map((b) => {
            const signed = b.extrinsics.filter((x) => "signer" in x && x.signer);
            const shown = open === b.hash;
            return (
              <div key={b.hash}>
                <Row
                  title={`#${b.number.toLocaleString("en-GB")}`}
                  detail={`${b.extrinsics.length} calls, ${signed.length} signed by people · ${b.events.length} events${signed.length ? ` · ${[...new Set(signed.map((x) => ("name" in x ? x.name : "")))].join(", ")}` : ""}`}
                  action={<Button variant="quiet" onClick={() => setOpen(shown ? null : b.hash)}>{shown ? "Close" : "Open"}</Button>}
                />
                {shown && <BlockDetail b={b} />}
              </div>
            );
          })}
        </List>
      )}
    </Section>
  );
}

function BlockDetail({ b }: { b: BlockView }) {
  return (
    <div className="mt-3 space-y-3 text-[12px]">
      <p className="break-all text-[var(--faint)]">{b.hash}</p>
      {b.extrinsics.map((x) => (
        <div key={x.index} className="rounded-[var(--radius)] border border-[var(--line)] p-3">
          {"error" in x ? (
            <span className="text-[var(--danger)]">Call {x.index}: couldn't read it ({x.error})</span>
          ) : (
            <>
              <div className="font-medium">
                {x.index}. {x.name}
                <span className="ml-2 font-normal text-[var(--muted)]">{x.signer ? `signed by ${short(x.signer)}` : "the chain's own"}</span>
              </div>
              <pre className="mt-1 max-h-40 overflow-auto font-mono text-[11px] text-[var(--muted)]">{JSON.stringify(x.args, null, 2)}</pre>
            </>
          )}
        </div>
      ))}
      {b.events.length > 0 && (
        <div className="rounded-[var(--radius)] border border-[var(--line)] p-3">
          <div className="mb-1 font-medium">Events</div>
          <ul className="space-y-0.5 font-mono text-[11px] text-[var(--muted)]">
            {b.events.map((e, i) => (
              <li key={i}>
                {e.phase}: {e.name}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

function AccountLookup({ client, chain }: { client: PolkadotClient; chain: Chain }) {
  const [text, setText] = useState("");
  const [out, setOut] = useState<{ facts: [string, string][] } | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    const k = accountKey();
    setOut(null);
    setErr(null);
    if (k && !text) chainProps(client).then((p) => setText(addressFor(k, { ss58: p.ss58 } as any)));
  }, [client]);
  const look = async () => {
    setBusy(true);
    setErr(null);
    try {
      const p = await chainProps(client);
      const addr = readAddress(text, { ss58: p.ss58 } as any);
      if (!addr) throw new Error("That isn't an address on any Polkadot-family chain.");
      const a = await (client.getUnsafeApi() as any).query.System.Account.getValue(addr);
      const f = (v: bigint) => `${formatAmount(v, p.decimals, 6)} ${p.symbol}`;
      setOut({
        facts: [
          ["address", short(addr)],
          ["free", f(a.data.free)],
          ["reserved", f(a.data.reserved)],
          ["frozen", f(a.data.frozen)],
          ["calls made", String(a.nonce)],
          ["open", a.providers > 0 ? "yes" : "no, it holds nothing"],
        ],
      });
    } catch (e: any) {
      setErr(String(e?.message ?? e));
      setOut(null);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Section label="Look up an account" icon={Search}>
      <Card>
        <div className="flex gap-2">
          <input className={inputClass + " font-mono"} value={text} placeholder="An address" onChange={(e) => setText(e.target.value)} onKeyDown={(e) => e.key === "Enter" && void look()} />
          <Button busy={busy} onClick={() => void look()}>
            Look up
          </Button>
        </div>
        {err && <div className="mt-3"><Notice tone="danger">{err}</Notice></div>}
        {out && <div className="mt-3"><Facts items={out.facts} /></div>}
        <p className="mt-2 text-[12px] text-[var(--faint)]">On {CHAIN_LABEL[chain]}, at the latest final block.</p>
      </Card>
    </Section>
  );
}

function Reader({ client, rt }: { client: PolkadotClient; rt: Runtime }) {
  const [mode, setMode] = useState<"storage" | "constant">("storage");
  const withItems = rt.pallets.filter((p) => (mode === "storage" ? p.storage.length : p.constants.length));
  const [pallet, setPallet] = useState(withItems[0]?.name ?? "");
  const p = withItems.find((x) => x.name === pallet) ?? withItems[0];
  const items = mode === "storage" ? p?.storage ?? [] : p?.constants ?? [];
  const [item, setItem] = useState(items[0]?.name ?? "");
  const it = items.find((x) => x.name === item) ?? items[0];
  const keys = mode === "storage" && it && "keys" in it ? it.keys : [];
  const [keyText, setKeyText] = useState<string[]>([]);
  const [out, setOut] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    setKeyText(keys.map((k) => JSON.stringify(template(k))));
    setOut(null);
    setErr(null);
  }, [p?.name, it?.name, mode]);

  const read = async () => {
    if (!p || !it) return;
    setBusy(true);
    setErr(null);
    setOut(null);
    try {
      const api = client.getUnsafeApi() as any;
      if (mode === "constant") {
        setOut(pretty(await api.constants[p.name][it.name]()));
        return;
      }
      const given = keyText.map((t) => t.trim()).filter(Boolean);
      const args = given.map((t, i) => {
        let v: unknown;
        try {
          v = JSON.parse(t);
        } catch {
          v = t;
        }
        return toChain(keys[i], v, `key ${i + 1}`);
      });
      const entry = api.query[p.name][it.name];
      if (args.length === keys.length) {
        setOut(pretty(await entry.getValue(...args)));
      } else if (args.length > 0) {
        const all = await entry.getEntries(...args);
        setOut(pretty(all.slice(0, 50).map((e: any) => ({ key: toJson(e.keyArgs), value: toJson(e.value) }))) + (all.length > 50 ? `\n… and ${all.length - 50} more` : ""));
      } else {
        throw new Error("This keeps one value per key. Give the first key at least, so it doesn't read the whole map.");
      }
    } catch (e: any) {
      setErr(String(e?.message ?? e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Section label="Read the chain's state" icon={Database} lede="Anything a pallet keeps, or any of its fixed settings, read at the latest final block.">
      <Card>
        <div className="mb-3 flex gap-1">
          <Button variant={mode === "storage" ? "primary" : "secondary"} onClick={() => setMode("storage")}>
            Storage
          </Button>
          <Button variant={mode === "constant" ? "primary" : "secondary"} onClick={() => setMode("constant")}>
            Settings (constants)
          </Button>
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Pallet">
            <select className={selectClass} value={p?.name ?? ""} onChange={(e) => setPallet(e.target.value)}>
              {withItems.map((x) => (
                <option key={x.name}>{x.name}</option>
              ))}
            </select>
          </Field>
          <Field label={mode === "storage" ? "Item" : "Setting"}>
            <select className={selectClass} value={it?.name ?? ""} onChange={(e) => setItem(e.target.value)}>
              {items.map((x) => (
                <option key={x.name}>{x.name}</option>
              ))}
            </select>
          </Field>
        </div>
        {it?.docs?.length ? <p className="mt-2 text-[12px] text-[var(--muted)]">{it.docs.join(" ")}</p> : null}
        {keys.map((k, i) => (
          <div key={i} className="mt-3">
            <Field label={`Key ${i + 1}: ${typeName(k)}`}>
              <input className={inputClass + " font-mono"} value={keyText[i] ?? ""} onChange={(e) => setKeyText((xs) => xs.map((x, j) => (j === i ? e.target.value : x)))} />
            </Field>
          </div>
        ))}
        <div className="mt-3">
          <Button busy={busy} onClick={() => void read()}>
            Read
          </Button>
        </div>
        {err && <div className="mt-3"><Notice tone="danger">{err}</Notice></div>}
        {out != null && <pre className="mt-3 max-h-96 overflow-auto rounded-[var(--radius)] border border-[var(--line)] bg-[var(--raise)] p-3 font-mono text-[11px]">{out}</pre>}
      </Card>
    </Section>
  );
}

// ── the call builder ────────────────────────────────────────────────────────

export function CallBuilder({ chain, open }: { chain: Chain; open: (id: string) => void }) {
  const { client, rt, error } = useRuntime(chain);
  const callable = useMemo(() => rt?.pallets.filter((p) => p.calls.length) ?? [], [rt]);
  const [pallet, setPallet] = useState("System");
  const p = callable.find((x) => x.name === pallet) ?? callable[0];
  const [call, setCall] = useState("remark");
  const c = p?.calls.find((x) => x.name === call) ?? p?.calls[0];
  const [text, setText] = useState("");
  const [problem, setProblem] = useState<string | null>(null);
  const [progress, setProgress] = useState<SignProgress | null>(null);
  const hasAccount = !!accountKey();
  const can = signable(chain);
  const busy = progress != null && !["final", "failed", "declined"].includes(progress.stage);

  useEffect(() => {
    if (c) setText(JSON.stringify(callTemplate(c), null, 2));
    setProblem(null);
    setProgress(null);
  }, [p?.name, c?.name]);

  const ask = async () => {
    if (!client || !p || !c) return;
    setProblem(null);
    let args: Record<string, unknown>;
    try {
      const json = JSON.parse(text || "{}");
      args = Object.fromEntries(c.fields.map((f) => [f.name, toChain(f.type, json[f.name], f.name)]));
    } catch (e: any) {
      setProblem(e instanceof SyntaxError ? `That isn't valid JSON: ${e.message}` : e.message);
      return;
    }
    const api = client.getUnsafeApi() as any;
    let tx: any;
    try {
      tx = c.fields.length ? api.tx[p.name][c.name](args) : api.tx[p.name][c.name]();
      await tx.getEncodedData();
    } catch (e: any) {
      setProblem(`The chain's description doesn't accept those values: ${e?.message ?? e}`);
      return;
    }
    await requestSign({ plugin: "onchain", chain, tx, why: "You built this call yourself in On chain." }, setProgress);
  };

  return (
    <Section label="Build a call" icon={Hammer} lede="Pick any call the chain takes, fill in its values, and the app shows you what it does before anything is signed.">
      {!can && <Notice tone="warn">Calls can only be signed on the test network for now. Pick "{CHAIN_LABEL.paseo}" to send one. You can still build and read calls here.</Notice>}
      {!hasAccount && (
        <Card tone="dashed">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <span className="text-[13px] text-[var(--muted)]">Signing needs an account on this computer. Swap makes one from twelve words you write down.</span>
            <Button onClick={() => open("swap")}>Open Swap</Button>
          </div>
        </Card>
      )}
      {error && <Notice tone="danger">{error}</Notice>}
      {!rt && !error && <Waiting>Reading what the chain takes…</Waiting>}
      {rt && p && c && (
        <Card>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Pallet">
              <select className={selectClass} value={p.name} onChange={(e) => setPallet(e.target.value)}>
                {callable.map((x) => (
                  <option key={x.name}>{x.name}</option>
                ))}
              </select>
            </Field>
            <Field label="Call">
              <select className={selectClass} value={c.name} onChange={(e) => setCall(e.target.value)}>
                {p.calls.map((x) => (
                  <option key={x.name}>{x.name}</option>
                ))}
              </select>
            </Field>
          </div>
          {c.docs.length > 0 && <p className="mt-3 max-h-32 overflow-auto text-[12px] leading-relaxed text-[var(--muted)]">{c.docs.join(" ")}</p>}
          {c.fields.length > 0 ? (
            <>
              <ul className="mt-3 space-y-0.5 font-mono text-[11px] text-[var(--muted)]">
                {c.fields.map((f) => (
                  <li key={f.name}>
                    {f.name}: {typeName(f.type)}
                  </li>
                ))}
              </ul>
              <div className="mt-2">
                <Field label="Values" hint="Numbers in the chain's smallest unit, as text. Bytes as 0x hex, or plain text. Choices as { &quot;type&quot;: …, &quot;value&quot;: … }.">
                  <textarea className={inputClass + " font-mono text-[12px]"} rows={Math.min(14, text.split("\n").length + 1)} value={text} onChange={(e) => setText(e.target.value)} spellCheck={false} />
                </Field>
              </div>
            </>
          ) : (
            <p className="mt-3 text-[12px] text-[var(--muted)]">This call takes no values.</p>
          )}
          {problem && <div className="mt-3"><Notice tone="danger">{problem}</Notice></div>}
          <div className="mt-3 flex items-center gap-3">
            <Button variant="primary" disabled={!can || !hasAccount || busy} busy={busy} onClick={() => void ask()}>
              Ask to sign
            </Button>
            {progress && <BuilderProgress p={progress} />}
          </div>
        </Card>
      )}
      {!callable.length && rt && <Empty>This chain takes no calls.</Empty>}
    </Section>
  );
}

function BuilderProgress({ p }: { p: SignProgress }) {
  switch (p.stage) {
    case "waiting":
      return <Status tone="warn" pulse>waiting for you to approve it</Status>;
    case "declined":
      return <Status>not signed</Status>;
    case "signing":
    case "sent":
      return <Status tone="warn" pulse>sent, waiting for a block</Status>;
    case "in-block":
      return <Status tone="warn" pulse>in a block, waiting for it to be final</Status>;
    case "final":
      return <Status tone="ok">final in block #{p.number.toLocaleString("en-GB")}, call {p.index}</Status>;
    case "failed":
      return <Status tone="danger">{p.reason}</Status>;
  }
}
