import { useEffect, useState } from "react";
import { SlidersHorizontal, Palette, Plus, X, Copy, Check, RotateCcw, KeyRound, Trash2, Lock, BookOpen, Info, PenLine, Fingerprint, Library, Receipt, Eye } from "lucide-react";
import { deleteSecret, listSecrets, persistent, saveSecret, validName, type SecretMeta } from "../lib/secrets";
import { isTauri, getUpdateChannel, setUpdateChannel, type UpdateChannel } from "../host/useUpdater";
import { Page, PageHeader, PageBody, Section, Card, List, Row, Status, Notice, Button, Field, Facts, inputClass } from "../ui";
import { hasLightClient, removeCopy, setKeepCopy, useChain, useNode, type NodeStatus } from "../lib/chain";
import type { MurmurModule, PluginContext } from "../host/types";
import {
  useSkin,
  encodeSkin,
  decodeSkin,
  DECENT_DEFAULTS,
  SKIN_PRESETS,
  BRAND_PRESETS,
  logoUrl,
  EMPTY_SKIN,
  type Skin,
} from "../host/useSkin";
import { app, edition } from "../edition";
import { isDemo } from "../demo";
import { CostsTable, monthTotal } from "../demo/costs";
import { LensPrompt } from "../demo/lens";
import { useInstalled } from "../host/useInstalled";

/**
 * Settings: this computer, in plain words. How the app looks, the ledger (the
 * chain, which the app checks itself), passwords for other services kept in the
 * system's secure store, and which version this is. Who you
 * are and your roles (membership, check-ins, the operations console) live in
 * Profile, beside the rest of your identity.
 */
function Panel({ instance, open }: PluginContext) {
  return (
    <Page>
      <PageHeader
        icon={SlidersHorizontal}
        eyebrow="settings"
        title="Settings"
        lede={isDemo ? "How it looks, what it costs, and the ledger that keeps your record." : "How it looks, the ledger, and passwords for other services."}
      />
      <PageBody>
        <Appearance instance={instance} />
        {isDemo && <YourWay open={open} />}
        {isDemo && <Billing />}
        <LedgerSection />
        <Secrets />
        <About />
      </PageBody>
    </Page>
  );
}

function About() {
  const [version, setVersion] = useState<string | null>(null);
  useEffect(() => {
    if (!isTauri) return setVersion(null);
    import("@tauri-apps/api/app")
      .then(({ getVersion }) => getVersion())
      .then(setVersion)
      .catch(() => setVersion(null));
  }, []);
  const [channel, setChannel] = useState<UpdateChannel>(getUpdateChannel);
  const host = new URL(app.signIn.approve).host;
  function choose(next: UpdateChannel) {
    setUpdateChannel(next);
    setChannel(next);
  }
  return (
    <Section label="Your version" icon={Info}>
      <List>
          <Row
            title={`${app.productName}${version ? ` ${version}` : ""}`}
            status={isTauri ? <Status tone="ok">desktop app</Status> : <Status tone="warn">trying it in a browser</Status>}
            detail={
              isTauri
                ? `Updates come from ${host}, signed by ${app.instance.name}. A new one shows at the bottom of the window.`
                : "The desktop app adds a locked password store, its own check of the ledger, and automatic updates."
            }
          />
          {isTauri && (
            <Row
              title="Early updates"
              status={channel === "early" ? <Status tone="ok">on</Status> : <Status>off</Status>}
              detail={
                channel === "early"
                  ? "You get each update the day it is made, before everyone else. If something breaks, tell us and you help everyone who updates after you."
                  : "You get an update once it has run for a week on early installs without trouble. Turn this on to get them sooner and help test them."
              }
              action={
                <Button onClick={() => choose(channel === "early" ? "stable" : "early")}>
                  {channel === "early" ? "Turn off" : "Turn on"}
                </Button>
              }
            />
          )}
      </List>
    </Section>
  );
}

function Appearance({ instance }: { instance: PluginContext["instance"] }) {
  const { skin, update, set, reset } = useSkin();

  // Each edition offers its own brand and the neutral skins, never another
  // edition's or a client's look.
  const ownBrand = BRAND_PRESETS.filter((p) => p.id === (edition.defaultSkin || "decent"));
  const presets = [...ownBrand, ...SKIN_PRESETS];
  const activePreset =
    presets.find((p) => encodeSkin({ ...EMPTY_SKIN, ...p.skin }) === encodeSkin(skin))?.id ?? null;

  return (
    <Section
      label="Appearance"
      icon={Palette}
      lede="Your group's name, logo, colours and corners. Changes stay on this computer."
      aside={
        <Button variant="quiet" icon={RotateCcw} onClick={reset}>
          Reset to {edition.productName}
        </Button>
      }
    >
      <div className="flex flex-wrap gap-2">
        {presets.map((p) => {
          const on = activePreset === p.id;
          const swatches = (p.skin.spectrum ?? DECENT_DEFAULTS.spectrum).slice(0, 4);
          return (
            <button
              key={p.id}
              onClick={() => set({ ...EMPTY_SKIN, ...p.skin })}
              data-active={on}
              className="prism-hover flex items-center gap-2 rounded-[var(--radius)] border border-[var(--line-strong)] bg-[var(--card)] px-3 py-1.5 text-xs transition data-[active=true]:border-[var(--fg)]"
            >
              {p.skin.logo ? (
                <img src={logoUrl(p.skin.logo as string)} alt="" className="h-4 w-4 rounded-sm object-cover" />
              ) : (
                <span className="flex">
                  {swatches.map((c, i) => (
                    <span
                      key={i}
                      className="h-3 w-3 rounded-full ring-1 ring-white"
                      style={{ background: c, marginLeft: i ? -4 : 0 }}
                    />
                  ))}
                </span>
              )}
              {p.label}
              {on && <Check className="h-3 w-3" />}
            </button>
          );
        })}
      </div>

      <details className="group mt-5 rounded-[var(--radius)] border border-[var(--line)] bg-[var(--card)]">
        <summary className="font-tight flex cursor-pointer list-none items-center justify-between px-5 py-3 text-sm font-medium">
          Customise
          <span className="font-mono text-[11px] text-[var(--faint)] group-open:hidden">name, logo, colours, corners</span>
        </summary>
        <div className="space-y-5 border-t border-[var(--line)] px-5 py-5">
          <Field label="Name" hint="Shown in the rail and headings.">
            <input
              value={skin.name}
              onChange={(e) => update({ name: e.target.value })}
              placeholder={instance.name}
              className={inputClass}
            />
          </Field>

          <Field label="Logo" hint="A link to an image. Leave blank to use the first letter.">
            <input
              value={skin.logo}
              onChange={(e) => update({ logo: e.target.value })}
              placeholder="/brand/logo.png"
              className={inputClass}
            />
          </Field>

          <SpectrumEditor />

          <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
            <Field label="Highlight" hint="Links, buttons and whatever is selected.">
              <ColorRow
                value={skin.accent || DECENT_DEFAULTS.accent}
                isDefault={!skin.accent}
                onChange={(v) => update({ accent: v })}
              />
            </Field>
            <Field label="Background" hint="Keep it close to white.">
              <ColorRow
                value={skin.bg || DECENT_DEFAULTS.bg}
                isDefault={!skin.bg}
                onChange={(v) => update({ bg: v })}
              />
            </Field>
          </div>

          <Field
            label={`Corners: ${skin.radius ?? DECENT_DEFAULTS.radius}px`}
            hint="Soft and rounded, or tight and square."
          >
            <input
              type="range"
              min={0}
              max={20}
              step={1}
              value={skin.radius ?? DECENT_DEFAULTS.radius}
              onChange={(e) => update({ radius: Number(e.target.value) })}
              className="w-full accent-[var(--accent)]"
            />
          </Field>

          <ShareSkin skin={skin} onApply={set} />
        </div>
      </details>
    </Section>
  );
}

function SpectrumEditor() {
  const { skin, update } = useSkin();
  const stops = skin.spectrum.length ? skin.spectrum : DECENT_DEFAULTS.spectrum;
  return (
    <Field label="Colours" hint="Runs along the top and shows on hover.">
      <div className="rounded-[var(--radius)] border border-[var(--line)] p-3">
        <div
          className="mb-3 h-2 w-full rounded-full"
          style={{ background: stops.length === 1 ? stops[0] : `linear-gradient(90deg, ${stops.join(", ")})` }}
        />
        <div className="flex flex-wrap items-center gap-2">
          {stops.map((c, i) => (
            <div key={i} className="group relative">
              <input
                type="color"
                value={c}
                onChange={(e) => {
                  const next = [...stops];
                  next[i] = e.target.value;
                  update({ spectrum: next });
                }}
                className="h-8 w-8 cursor-pointer rounded-[var(--radius)] border border-[var(--line-strong)] bg-transparent p-0.5"
                title={c}
              />
              {stops.length > 1 && (
                <button
                  type="button"
                  onClick={() => update({ spectrum: stops.filter((_, j) => j !== i) })}
                  className="absolute -right-1 -top-1 hidden h-4 w-4 items-center justify-center rounded-full border border-[var(--line-strong)] bg-[var(--card)] text-[var(--fg)] group-hover:flex"
                  title="Remove this colour"
                >
                  <X className="h-2.5 w-2.5" />
                </button>
              )}
            </div>
          ))}
          <button
            type="button"
            onClick={() => update({ spectrum: [...stops, skin.accent || "#007aff"] })}
            className="prism-hover flex h-8 w-8 items-center justify-center rounded-[var(--radius)] border border-dashed border-[var(--line-strong)] text-[var(--faint)] hover:text-[var(--fg)]"
            title="Add a colour"
          >
            <Plus className="h-4 w-4" />
          </button>
        </div>
      </div>
    </Field>
  );
}

function Secrets() {
  const [list, setList] = useState<SecretMeta[]>(listSecrets);
  const [name, setName] = useState("");
  const [value, setValue] = useState("");
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState<string | null>(null);

  useEffect(() => {
    const on = () => setList(listSecrets());
    window.addEventListener("murmur:secrets", on);
    return () => window.removeEventListener("murmur:secrets", on);
  }, []);

  async function save() {
    setError(null);
    try {
      await saveSecret(name.trim(), value, note);
      setSaved(name.trim());
      setName("");
      setValue("");
      setNote("");
      setTimeout(() => setSaved(null), 1800);
    } catch (e) {
      setError((e as Error).message);
    }
  }

  return (
    <Section
      label="Passwords for other services"
      icon={KeyRound}
      lede={
        persistent
          ? "For plugins that use another service, such as an AI model. Kept in this computer's locked store (the Keychain on a Mac) and never shown again."
          : "For plugins that use another service, such as an AI model. A browser has no locked store, so these are forgotten on reload. The desktop app keeps them."
      }
    >
      {list.length > 0 && (
        <div className="mb-4">
          <List>
            {list.map((s) => (
              <Row
                key={s.name}
                icon={Lock}
                title={<span className="font-mono text-[13px] font-normal">{s.name}</span>}
                detail={s.note || undefined}
                status={
                  <span className="font-mono text-[11px] text-[var(--faint)]">
                    saved {new Date(s.savedAt).toLocaleDateString("en-GB", { day: "numeric", month: "short" })}
                  </span>
                }
                action={
                  <Button
                    variant="quiet"
                    icon={Trash2}
                    title={`Remove ${s.name}`}
                    onClick={() => {
                      if (confirm(`Remove ${s.name} from this computer?`)) void deleteSecret(s.name);
                    }}
                  >
                    Remove
                  </Button>
                }
              />
            ))}
          </List>
        </div>
      )}

      <Card>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-[1fr_1.4fr]">
          <Field label="Name" hint="The name the plugin asks for, such as ANTHROPIC_API_KEY.">
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              spellCheck={false}
              className={`${inputClass} font-mono text-xs`}
            />
          </Field>
          <Field label="Password or key" hint="Hidden once saved.">
            <input
              value={value}
              onChange={(e) => setValue(e.target.value)}
              type="password"
              autoComplete="off"
              className={`${inputClass} font-mono text-xs`}
            />
          </Field>
        </div>
        <div className="mt-3 flex items-end gap-2">
          <div className="min-w-0 flex-1">
            <Field label="What it's for" hint="Optional.">
              <input value={note} onChange={(e) => setNote(e.target.value)} className={inputClass} />
            </Field>
          </div>
          <Button
            variant="primary"
            size="md"
            onClick={() => void save()}
            disabled={!name.trim() || !value || !validName(name.trim())}
          >
            {list.some((s) => s.name === name.trim()) ? "Replace" : "Save"}
          </Button>
        </div>
        <div className="mt-3 space-y-1 empty:hidden">
          {name.trim() && !validName(name.trim()) && (
            <Notice tone="danger">Use letters, numbers, dots, dashes or underscores, starting with a letter.</Notice>
          )}
          {error && <Notice tone="danger">{error}</Notice>}
          {saved && <Notice tone="ok">Saved {saved}.</Notice>}
        </div>
      </Card>
    </Section>
  );
}

const STEPS = [
  { icon: PenLine, title: "You do something", line: "Write a piece, join a call, cast a vote." },
  { icon: Fingerprint, title: "Your key signs it", line: "Your passkey signs it, so it's provably yours." },
  { icon: Library, title: "The ledger keeps it", line: "Anyone can check it. Nobody can rewrite it." },
];

/**
 * The ledger is the chain (ADR 0068), named for what it does for a member. The
 * explanation comes first; block numbers, peers and hashes sit behind a fold
 * for anyone who wants them.
 */
/** What the group pays for the app, line by line (demo editions show a sample). */
/**
 * How you see things: each person tells the app, in their own words, how they
 * like things explained, and the sections that can change follow. Demo only:
 * "Her record" on Profile is the first section that reads it (demo/lens.tsx).
 */
function YourWay({ open }: { open: PluginContext["open"] }) {
  return (
    <div data-tour-section="lens" className="scroll-mt-6">
      <Section
        label="How you see things"
        icon={Eye}
        lede="Say how you like things explained, and sections show themselves that way, just for you."
      >
        <LensPrompt
          onSeen={() => {
            open("identity");
            setTimeout(() => document.querySelector('[data-tour-section="record"]')?.scrollIntoView({ behavior: "smooth", block: "start" }), 300);
          }}
          seenLabel="See Alice's record"
        />
      </Section>
    </div>
  );
}

function Billing() {
  const { installed } = useInstalled();
  return (
    <div data-tour-section="billing" className="scroll-mt-6">
      <Section
        label="Billing"
        icon={Receipt}
        aside={
          <span className="font-mono text-[13px]">
            {new Intl.NumberFormat("en-GB", { style: "currency", currency: "GBP" }).format(monthTotal(installed))}
            <span className="font-sans text-[12px] text-[var(--faint)]"> so far this month</span>
          </span>
        }
      >
        <CostsTable installed={installed} />
      </Section>
    </div>
  );
}

function LedgerSection() {
  const c = useChain();
  const ago = c?.finalizedAt ? Math.max(0, Math.round((Date.now() - c.finalizedAt) / 1000)) : null;
  const short = (h?: string | null) => (h ? `${h.slice(0, 8)}…${h.slice(-4)}` : "…");
  let line: string;
  if (!c) line = "Checking…";
  else if (!hasLightClient)
    line = "The desktop app checks the ledger itself. A browser can't, so this is sample data.";
  else if (c.finalized == null)
    line = c.error && c.error !== "the light client is starting" ? `Can't reach the ledger yet: ${c.error}` : "Connecting to the ledger…";
  else
    line = `Up to date. Checked to page ${c.finalized.toLocaleString()}${ago != null ? `, ${ago} seconds ago` : ""}.`;
  const tone = !c ? "idle" : !hasLightClient ? "idle" : c.finalized == null ? "warn" : "ok";
  return (
    <Section
      label="The ledger"
      icon={BookOpen}
      lede="Who joined, who made what, how it may be used, how votes went. Many computers hold copies and check each other, so nobody, including us, can quietly change it."
    >
      <div className="mb-4 grid grid-cols-1 gap-2 sm:grid-cols-3">
        {STEPS.map((step, i) => (
          <div key={step.title} className="rounded-[var(--radius)] border border-[var(--line)] bg-[var(--card)] px-4 py-3">
            <div className="flex items-center gap-2">
              <span className="font-mono flex h-5 w-5 items-center justify-center rounded-full border border-[var(--line-strong)] text-[10px] text-[var(--muted)]">
                {i + 1}
              </span>
              <step.icon className="h-4 w-4 text-[var(--muted)]" />
            </div>
            <div className="font-tight mt-2 text-sm font-medium">{step.title}</div>
            <div className="mt-1 text-[12px] leading-relaxed text-[var(--muted)]">{step.line}</div>
          </div>
        ))}
      </div>
      <List>
        <div className="space-y-3">
          <Row
            title="Checking it for itself"
            status={
              <Status tone={tone} pulse={hasLightClient && c?.finalized == null}>
                {!hasLightClient ? "in the desktop app" : c?.finalized == null ? "connecting" : "up to date"}
              </Status>
            }
            detail={
              <>
                {line} It takes no server's word for it.
              </>
            }
          />
          {hasLightClient && c?.finalized != null && (
            <details className="group">
              <summary className="cursor-pointer list-none text-[12px] text-[var(--faint)] hover:text-[var(--fg)]">
                <span className="group-open:hidden">Show the technical details</span>
                <span className="hidden group-open:inline">Hide the technical details</span>
              </summary>
              <div className="mt-3">
                <Facts
                  items={[
                    ["network", c.chain],
                    ["newest page", `#${c.best?.toLocaleString() ?? "…"}`],
                    ["connections", String(c.peers ?? "…")],
                    ["ledger software", c.specName ? `${c.specName} ${c.specVersion}` : "…"],
                    ["last sealed page", short(c.finalizedHash)],
                    ["first page", short(c.genesis)],
                  ]}
                />
              </div>
            </details>
          )}
        </div>
        {hasLightClient && <KeepCopy />}
      </List>
    </Section>
  );
}

const mb = (n?: number | null) => (n == null ? "…" : n < 1e9 ? `${Math.round(n / 1e6)} MB` : `${(n / 1e9).toFixed(1)} GB`);

function nodeLine(n: NodeStatus): string {
  switch (n.phase) {
    case "off":
      return "Off. Keep a whole copy here to make tampering harder.";
    case "fetching":
      return n.fetchTotal ? `Downloading what it needs, ${mb(n.fetchedBytes)} of ${mb(n.fetchTotal)}…` : "Downloading what it needs…";
    case "waiting-for-power":
      return "Paused on battery. Resumes when plugged in.";
    case "starting":
      return "Starting…";
    case "syncing":
      return n.best != null && n.highest ? `Copying the ledger: page ${n.best.toLocaleString()} of ${n.highest.toLocaleString()}.` : "Copying the ledger…";
    case "synced":
      return `Holding a whole copy, up to page ${n.best?.toLocaleString() ?? "…"}.`;
    case "error":
      return `Stopped: ${n.error ?? "it wouldn't run"}`;
  }
}

const PHASE: Record<NodeStatus["phase"], string> = {
  off: "off",
  fetching: "downloading",
  "waiting-for-power": "paused",
  starting: "starting",
  syncing: "copying",
  synced: "holding a copy",
  error: "stopped",
};

function KeepCopy() {
  const [n, setN] = useNode();
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  if (!n) return null;
  const act = async (f: () => Promise<NodeStatus>) => {
    setBusy(true);
    setErr(null);
    try {
      setN(await f());
    } catch (e) {
      setErr(String(e));
    } finally {
      setBusy(false);
    }
  };
  const on = n.phase === "synced" || n.phase === "syncing";
  return (
    <div className="space-y-3">
      <Row
        title="Help keep the ledger"
        status={
          <Status tone={n.phase === "error" ? "danger" : on ? "ok" : n.enabled ? "warn" : "idle"} pulse={n.phase === "syncing"}>
            {n.enabled ? PHASE[n.phase] : "off"}
          </Status>
        }
        detail={nodeLine(n)}
        action={
          <Button busy={busy} onClick={() => void act(() => setKeepCopy(!n.enabled))}>
            {n.enabled ? "Switch off" : "Switch on"}
          </Button>
        }
      />
      {on && (
        <Facts
          items={[
            ["connections", String(n.peers ?? "…")],
            ["space used", mb(n.diskBytes)],
            ["version", n.version ?? "…"],
            ["power", n.onMains ? "plugged in" : "on battery"],
          ]}
        />
      )}
      {err && <Notice tone="danger">{err}</Notice>}
      <p className="text-xs leading-relaxed text-[var(--faint)]">
        It helps others check their copies. It only reads, never writes, runs only when plugged in and stops when the
        app quits. The app checks who made it before it runs.
      </p>
      {!n.enabled && n.version && (
        <Button variant="quiet" disabled={busy} onClick={() => void act(removeCopy)}>
          Delete the copy and free {mb(n.diskBytes)}
        </Button>
      )}
    </div>
  );
}

function ShareSkin({
  skin,
  onApply,
}: {
  skin: Skin;
  onApply: (s: Skin) => void;
}) {
  const [copied, setCopied] = useState(false);
  const [paste, setPaste] = useState("");
  const [error, setError] = useState(false);

  const code = encodeSkin(skin);

  async function copy() {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    } catch {
      /* clipboard unavailable */
    }
  }

  function applyPaste() {
    const decoded = decodeSkin(paste);
    if (!decoded) {
      setError(true);
      return;
    }
    onApply(decoded);
    setPaste("");
    setError(false);
  }

  return (
    <Field label="Share with your group" hint="Send this code. Anyone who pastes it gets the same look.">
      <div className="space-y-2">
        <div className="flex items-center gap-2">
          <code className="font-mono min-w-0 flex-1 truncate rounded-[var(--radius)] border border-[var(--line)] bg-[var(--raise)] px-3 py-2 text-[11px] text-[var(--muted)]">
            {code}
          </code>
          <Button icon={copied ? Check : Copy} onClick={copy}>
            {copied ? "Copied" : "Copy"}
          </Button>
        </div>
        <div className="flex items-center gap-2">
          <input
            value={paste}
            onChange={(e) => {
              setPaste(e.target.value);
              setError(false);
            }}
            placeholder="Paste a code"
            className={`${inputClass} text-xs`}
          />
          <Button onClick={applyPaste} disabled={!paste.trim()}>
            Apply
          </Button>
        </div>
        {error && <Notice tone="danger">That code didn't work. Was it copied in full?</Notice>}
      </div>
    </Field>
  );
}

function ColorRow({
  value,
  isDefault,
  onChange,
}: {
  value: string;
  isDefault: boolean;
  onChange: (v: string) => void;
}) {
  return (
    <div className="prism-hover flex items-center gap-2 rounded-[var(--radius)] border border-[var(--line-strong)] px-2 py-1.5">
      <input
        type="color"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="h-7 w-7 shrink-0 cursor-pointer rounded-[var(--radius)] border border-[var(--line)] bg-transparent p-0.5"
      />
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        spellCheck={false}
        className="font-mono w-full bg-transparent text-xs uppercase outline-none"
      />
      {isDefault && (
        <span className="font-mono shrink-0 pr-1 text-[9px] uppercase tracking-wider text-[var(--faint)]">
          default
        </span>
      )}
    </div>
  );
}

export const settingsSurface: MurmurModule = {
  id: "settings",
  title: "Settings",
  tagline: "How it looks, the ledger and passwords for other services",
  icon: SlidersHorizontal,
  order: 2,
  kind: "core",
  Panel,
};
