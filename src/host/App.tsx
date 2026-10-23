import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Plus, X, Fingerprint, ArrowUpRight, ArrowUp, ArrowDown, RotateCcw } from "lucide-react";
import type { MurmurModule } from "./types";
import {
  coreModules,
  pluginCatalog,
  instance,
  getModule,
  isStandard,
} from "./registry";
import { useInstalled } from "./useInstalled";
import { arrange, useRailOrder } from "./useRailOrder";
import { useIdentity } from "../identity/useIdentity";
import { logoUrl, useSkin } from "./useSkin";
import { useUpdater } from "./useUpdater";
import { UpdateBanner } from "./UpdateBanner";
import { PluginFeedback } from "./PluginFeedback";
import { CollectiveSwitcher } from "./Collectives";
import { edition, shaped, TIERS, tierOf } from "../edition";
import { Button, Status } from "../ui";
import { DemoBar, isDemo, Tour, tourSeen } from "../demo";
import { AccessTable } from "../demo/access";
import { LiveAccess } from "./Access";
import { accessSupported } from "../lib/access";
import { useReach } from "../lib/reach";
import { TailorDialog } from "../demo/tailor";
import { colourful, inkVars } from "../demo/ink";
import { AskForm, AsksSection, SearchBox, SearchResults, useRegistry } from "./Asks";
import type { Identity } from "./types";

const UPGRADE_DOT = "#af52de";

export default function App() {
  const { installed, install, uninstall, isInstalled } = useInstalled();
  const rail = useRailOrder();
  const { identity } = useIdentity();
  const { skin } = useSkin();
  const updater = useUpdater();
  const [activeId, setActiveId] = useState(edition.home);
  // Which part of the Plugins sheet is open: the list, or (in a demo) who can use what.
  const [catalogOpen, setCatalogOpen] = useState<false | CatalogTab>(false);
  // A demo edition walks a newcomer through the app the first time it opens.
  const [touring, setTouring] = useState(() => isDemo && !tourSeen());
  // "What are you looking for?", from the demo bar of an invented organisation.
  const [tailoring, setTailoring] = useState(false);

  // notes is the body core surface; settings + identity are pinned to the foot.
  const notes = getModule("notes")!;
  const settingsMod = getModule("settings")!;
  const identityMod = getModule("identity")!;
  // only in the invented demo: what's underneath, and why it matters
  const howMod = getModule("how");

  // The active skin can rename and rebrand the instance — propagate to every panel.
  const skinnedInstance = useMemo(
    () =>
      // A visitor's own sketch wears their name and its first letter, not the demo's mark.
      // A group's pack keeps that group's own mark.
      shaped && shaped.source !== "pack"
        ? { ...instance, name: instance.name, logo: "" }
        : { ...instance, name: skin.name || instance.name, logo: skin.logo ? logoUrl(skin.logo) : "" },
    [skin.name, skin.logo],
  );

  // The rail shows only what this sign-in can use (lib/reach.ts); the Plugins sheet still lists everything installed.
  const { visible } = useReach(installed, identity.session);
  const installedPlugins = useMemo(
    () => arrange(pluginCatalog.filter((p) => visible.includes(p.id)), rail.order),
    [visible, rail.order],
  );
  const shownIds = installedPlugins.map((p) => p.id);
  const moveTo = useCallback(
    (id: string, to: number) => rail.move(shownIds, id, to),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [rail.move, shownIds.join(",")],
  );
  // Dragging a plugin in the rail: which one, and the slot it would land in.
  const [dragging, setDragging] = useState<string | null>(null);
  const [slot, setSlot] = useState<number | null>(null);

  const active = useMemo(() => {
    const m = getModule(activeId);
    if (m && (m.kind === "core" || installed.includes(m.id))) return m;
    return notes; // active plugin was uninstalled — fall back
  }, [activeId, installed, notes]);

  const open = useCallback((id: string) => {
    setActiveId(id);
    setCatalogOpen(false);
  }, []);

  return (
    <div className="flex h-full flex-col bg-[var(--bg)]">
      <div className="spectrum-bar shrink-0" />
      {isDemo && (
        <DemoBar
          installed={installed}
          onTour={() => setTouring(true)}
          onTailor={() => setTailoring(true)}
        />
      )}
      {/* On phones the rail folds down into a bottom tab bar (flex-col-reverse
          puts it under the panel); md+ restores the vertical left rail. */}
      <div className="flex min-h-0 flex-1 flex-col-reverse md:flex-row">
        {/* ── rail / bottom tab bar ── */}
        <nav aria-label="App navigation" className="app-nav">
          <CollectiveSwitcher name={skinnedInstance.name} logo={skinnedInstance.logo} />

          {/* body: core (notes) + installed plugins + add */}
          {/* On a phone the plugins scroll sideways when there are more than fit. */}
          <div className="nav-plugins">
            {/* In a demo, Notes sits at the foot with Profile: yours, not the group's. */}
            {!isDemo && <RailButton mod={notes} active={active.id === notes.id} onClick={open} />}

            {!isDemo && <div className="hidden h-px w-6 bg-[var(--line)] md:my-1.5 md:block" />}

            {installedPlugins.map((p, i) => (
              <RailButton
                key={p.id}
                mod={p}
                active={active.id === p.id}
                onClick={open}
                drag={{
                  dragging: dragging === p.id,
                  before: slot === i && dragging !== null && dragging !== p.id,
                  after: slot === installedPlugins.length && i === installedPlugins.length - 1 && dragging !== p.id,
                  onStart: () => setDragging(p.id),
                  onOver: (after) => setSlot(after ? i + 1 : i),
                  onDrop: () => {
                    if (dragging && slot !== null) {
                      const from = shownIds.indexOf(dragging);
                      moveTo(dragging, slot > from ? slot - 1 : slot);
                    }
                    setDragging(null);
                    setSlot(null);
                  },
                  onEnd: () => {
                    setDragging(null);
                    setSlot(null);
                  },
                  onKeyMove: (by) => moveTo(p.id, i + by),
                }}
              />
            ))}

            <button
              onClick={() => setCatalogOpen("plugins")}
              title="Add a plugin"
              aria-label="Plugins"
              data-tour="catalog"
              className="rail-button prism-hover border border-dashed border-[var(--line-strong)] text-[var(--muted)]"
            >
              <Plus className="h-5 w-5" />
              <span className="rail-label">Plugins</span>
            </button>
          </div>

          {/* foot: settings + identity */}
          <div className="nav-personal">
            {howMod && <RailButton mod={howMod} active={active.id === howMod.id} onClick={open} />}
            <RailButton
              mod={settingsMod}
              active={active.id === settingsMod.id}
              onClick={open}
            />
            {isDemo && (
              <>
                <div className="hidden h-px w-6 bg-[var(--line)] md:my-1.5 md:block" />
                <RailButton mod={notes} active={active.id === notes.id} onClick={open} />
              </>
            )}
            <button
              onClick={() => open(identityMod.id)}
              title={
                identity.signedIn
                  ? `Profile: signed in as ${identity.handle}`
                  : `Profile: sign in to ${edition.productName}`
              }
              data-active={active.id === identityMod.id}
              aria-current={active.id === identityMod.id ? "page" : undefined}
              aria-label="Profile"
              data-tour={identityMod.id}
              className="rail-button prism-hover text-[var(--muted)] data-[active=true]:bg-[var(--raise)] data-[active=true]:text-[var(--fg)]"
            >
              {identity.signedIn ? (
                <span className="font-tight text-sm font-semibold uppercase">
                  {(identity.handle ?? "?").slice(0, 2)}
                </span>
              ) : (
                <Fingerprint className="h-5 w-5" />
              )}
              <span className="rail-label">Profile</span>
            </button>
          </div>
        </nav>

        {/* ── panel ── */}
        <main className={`relative min-h-0 min-w-0 flex-1 ${colourful ? "inked" : ""} ${!edition.showcase ? "live-surface" : ""}`} style={inkVars(active.id)}>
          <active.Panel identity={identity} instance={skinnedInstance} open={open} installed={installed} />
          <PluginFeedback
            pluginId={active.id}
            pluginTitle={active.title}
            identity={identity}
            instance={skinnedInstance}
            lab={active.lab}
            support={active.support}
          />
        </main>
      </div>

      {catalogOpen && (
        <Catalog
          tab={catalogOpen}
          setTab={setCatalogOpen}
          installed={installed}
          isInstalled={isInstalled}
          install={install}
          uninstall={uninstall}
          onOpen={open}
          onClose={() => setCatalogOpen(false)}
          identity={identity}
          railPlugins={installedPlugins}
          moveTo={moveTo}
          resetOrder={rail.custom ? rail.reset : undefined}
        />
      )}

      {tailoring && <TailorDialog onClose={() => setTailoring(false)} />}

      {touring && (
        <Tour installed={installed} open={open} setCatalog={setCatalogOpen} onClose={() => setTouring(false)} />
      )}

      <UpdateBanner
        state={updater.state}
        onInstall={updater.install}
        onDismiss={updater.dismiss}
      />
    </div>
  );
}

type RailDrag = {
  dragging: boolean;
  before: boolean;
  after: boolean;
  onStart: () => void;
  onOver: (after: boolean) => void;
  onDrop: () => void;
  onEnd: () => void;
  /** Alt with an arrow key moves the plugin one place, for keyboards. */
  onKeyMove: (by: number) => void;
};

function RailButton({
  mod,
  active,
  onClick,
  drag,
}: {
  mod: MurmurModule;
  active: boolean;
  onClick: (id: string) => void;
  drag?: RailDrag;
}) {
  const Icon = mod.icon;
  return (
    <button
      onClick={() => onClick(mod.id)}
      draggable={!!drag}
      data-dragging={drag?.dragging || undefined}
      data-drop={drag?.before ? "before" : drag?.after ? "after" : undefined}
      onDragStart={
        drag &&
        ((e) => {
          e.dataTransfer.effectAllowed = "move";
          e.dataTransfer.setData("text/plain", mod.id);
          drag.onStart();
        })
      }
      onDragOver={
        drag &&
        ((e) => {
          e.preventDefault();
          const r = e.currentTarget.getBoundingClientRect();
          const vertical = r.height >= r.width * 0.6 && window.matchMedia("(min-width: 768px)").matches;
          drag.onOver(vertical ? e.clientY > r.top + r.height / 2 : e.clientX > r.left + r.width / 2);
        })
      }
      onDrop={drag && ((e) => { e.preventDefault(); drag.onDrop(); })}
      onDragEnd={drag?.onEnd}
      onKeyDown={
        drag &&
        ((e) => {
          if (!e.altKey) return;
          const by = e.key === "ArrowUp" || e.key === "ArrowLeft" ? -1 : e.key === "ArrowDown" || e.key === "ArrowRight" ? 1 : 0;
          if (!by) return;
          e.preventDefault();
          drag.onKeyMove(by);
          requestAnimationFrame(() => document.querySelector<HTMLButtonElement>(`[data-tour="${mod.id}"]`)?.focus());
        })
      }
      title={`${mod.title}${mod.lab ? " (lab)" : ""}: ${mod.tagline}${drag ? ". Drag to move it" : ""}`}
      data-active={active}
      aria-current={active ? "page" : undefined}
      aria-label={`${mod.title}${mod.lab ? " (lab)" : ""}`}
      data-tour={mod.id}
      style={inkVars(mod.id)}
      className="rail-button prism-hover group relative text-[var(--muted)] hover:bg-[var(--ink-wash,var(--raise))] hover:text-[var(--fg)] data-[active=true]:bg-[var(--ink-soft,var(--raise))] data-[active=true]:text-[var(--fg)]"
    >
      <Icon className="h-5 w-5" />
      <span className="rail-label">{mod.title}{mod.lab ? " (lab)" : ""}</span>
      {mod.needsUpgrade && (
        <span
          className="absolute right-1.5 top-1.5 h-1.5 w-1.5 rounded-full"
          style={{ background: UPGRADE_DOT }}
        />
      )}
    </button>
  );
}

export type CatalogTab = "plugins" | "access";

function Catalog({
  tab,
  setTab,
  installed,
  isInstalled,
  install,
  uninstall,
  onOpen,
  onClose,
  identity,
  railPlugins,
  moveTo,
  resetOrder,
}: {
  identity: Identity;
  railPlugins: MurmurModule[];
  moveTo: (id: string, to: number) => void;
  resetOrder?: () => void;
  tab: CatalogTab;
  setTab: (t: CatalogTab) => void;
  installed: string[];
  isInstalled: (id: string) => boolean;
  install: (id: string) => void;
  uninstall: (id: string) => void;
  onOpen: (id: string) => void;
  onClose: () => void;
}) {
  // The demo shows a sample grid; an edition with its own access server shows the live one.
  const hasAccess = isDemo || accessSupported;
  const access = hasAccess && tab === "access";
  // Search every plugin that exists; anything this app lacks becomes an ask (ADR 0078).
  // The invented demos keep their own sheet: they have no collective to ask.
  const asking = !isDemo;
  const [q, setQ] = useState("");
  const [ask, setAsk] = useState<null | { plugin: string | null; title: string }>(null);
  const [filed, setFiled] = useState(0);
  const registry = useRegistry();
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const trigger = document.querySelector<HTMLButtonElement>('[data-tour="catalog"]');
    dialog.current?.showModal();
    return () => trigger?.focus();
  }, []);
  const row = (p: MurmurModule) => (
    <CatalogRow
      key={p.id}
      p={p}
      on={isInstalled(p.id)}
      fixed={isStandard(p.id)}
      market={tierOf(edition, p.id) === "market"}
      install={install}
      uninstall={uninstall}
      onOpen={onOpen}
    />
  );
  return (
    <dialog
      ref={dialog}
      aria-label="Plugins"
      onCancel={onClose}
      className="fixed inset-0 m-0 h-full max-h-none w-full max-w-none items-center justify-center border-0 bg-transparent p-3 text-[var(--fg)] open:flex backdrop:bg-black/25 md:p-6"
      onClick={onClose}
    >
      <div
        className="max-h-[80vh] w-full max-w-2xl overflow-y-auto rounded-[calc(var(--radius)+4px)] border border-[var(--line-strong)] bg-[var(--card)] shadow-[0_20px_80px_rgba(0,0,0,0.18)]"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between border-b border-[var(--line)] px-6 py-4">
          <div>
            <h2 className="font-tight text-xl font-medium">Plugins</h2>
            <p className="text-xs text-[var(--muted)]">
              {access
                ? `Who in ${edition.instance.name} can use each plugin, and how much.`
                : `${installed.length} of ${pluginCatalog.length} added. Notes, Settings and Profile are always here.`}
              {!access &&
                pluginCatalog.some((p) => p.lab) &&
                " Lab plugins are early and here for testing, so they may change or go away."}
            </p>
            {hasAccess && (
              <div className="mt-3 flex gap-1" role="tablist">
                {(
                  [
                    ["plugins", "Plugins"],
                    ["access", "Who can use what"],
                  ] as const
                ).map(([id, label]) => (
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
            )}
          </div>
          <button
            onClick={onClose}
            aria-label="Close plugins"
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-[var(--muted)] hover:bg-[var(--raise)] hover:text-[var(--fg)]"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="flex flex-col gap-5 p-4">
          {access && (isDemo ? <AccessTable installed={installed} /> : <LiveAccess installed={installed} identity={identity} />)}
          {!access && asking && ask && (
            <AskForm
              plugin={ask.plugin}
              initialTitle={ask.title}
              registry={registry}
              carried={pluginCatalog}
              identity={identity}
              onBack={() => setAsk(null)}
              onFiled={() => setFiled((n) => n + 1)}
            />
          )}
          {!access && asking && !ask && <SearchBox q={q} setQ={setQ} />}
          {!access && asking && !ask && q.trim() && (
            <SearchResults q={q} carried={pluginCatalog} renderRow={row} registry={registry} onAsk={(plugin, title) => setAsk({ plugin, title })} />
          )}
          {!access && !ask && !q.trim() && railPlugins.length > 1 && (
            <RailOrder plugins={railPlugins} moveTo={moveTo} reset={resetOrder} />
          )}
          {!access && !ask && !q.trim() && TIERS.map((t) => {
            const list = pluginCatalog.filter((p) => tierOf(edition, p.id) === t.id);
            return (
              <section key={t.id} className="flex flex-col gap-2">
                <div className="flex items-baseline gap-2 px-1">
                  <span className="font-tight text-sm font-medium">{t.title}</span>
                  <span className="text-xs text-[var(--faint)]">
                    {t.id === "custom" ? `Made for ${edition.instance.name}` : t.line}
                  </span>
                </div>
                {list.length === 0 && (
                  <p className="px-1 text-xs text-[var(--faint)]">
                    {t.id === "custom"
                      ? `Nothing made for ${edition.instance.name} yet. A plugin for your own process or rituals goes here.`
                      : t.id === "market"
                        ? "Nothing from other collectives yet. Plugins they make and share will show here."
                        : "None."}
                  </p>
                )}
                {list.map((p) => (
                  <CatalogRow
                    key={p.id}
                    p={p}
                    on={isInstalled(p.id)}
                    fixed={isStandard(p.id)}
                    market={t.id === "market"}
                    install={install}
                    uninstall={uninstall}
                    onOpen={onOpen}
                  />
                ))}
              </section>
            );
          })}
          {!access && asking && !ask && !q.trim() && (
            <AsksSection onAsk={() => setAsk({ plugin: null, title: "" })} refreshKey={filed} />
          )}
        </div>

      </div>
    </dialog>
  );
}

function CatalogRow({
  p,
  on,
  fixed,
  market,
  install,
  uninstall,
  onOpen,
}: {
  p: MurmurModule;
  on: boolean;
  fixed: boolean;
  market: boolean;
  install: (id: string) => void;
  uninstall: (id: string) => void;
  onOpen: (id: string) => void;
}) {
  const Icon = p.icon;
  return (
    <article className="flex flex-wrap items-center gap-3 rounded-[var(--radius)] border border-[var(--line)] px-4 py-4 sm:flex-nowrap">
      <div
        style={inkVars(p.id)}
        className="flex h-10 w-10 shrink-0 items-center justify-center rounded-[var(--radius)] border border-[var(--line-strong)] bg-[var(--ink-wash,var(--raise))]"
      >
        <Icon className="h-5 w-5 text-[var(--fg)]" />
      </div>
      <div className="min-w-[10rem] flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-tight text-sm font-medium">{p.title}</span>
          {p.lab && <Status>lab</Status>}
          {p.needsUpgrade && <Status tone="warn">needs the larger app</Status>}
        </div>
        <div className="mt-1 text-xs leading-relaxed text-[var(--muted)]">
          {market ? `By ${p.by ?? "Decent"} · ${isDemo ? "priced by use" : "free"} · ` : ""}
          {p.tagline}
        </div>
      </div>
      {on ? (
        <div className="flex items-center gap-1">
          {!fixed && (
            <Button variant="quiet" onClick={() => uninstall(p.id)} title={`Remove ${p.title}`}>
              Remove
            </Button>
          )}
          <Button onClick={() => onOpen(p.id)} trailing={ArrowUpRight}>
            Open
          </Button>
        </div>
      ) : (
        <Button variant="primary" icon={Plus} onClick={() => install(p.id)}>
          Add
        </Button>
      )}
    </article>
  );
}

/** The rail's order, with a move up and down for each plugin. Dragging in the
 *  rail does the same; this is the way on a phone or a keyboard. */
function RailOrder({
  plugins,
  moveTo,
  reset,
}: {
  plugins: MurmurModule[];
  moveTo: (id: string, to: number) => void;
  reset?: () => void;
}) {
  return (
    <section className="flex flex-col gap-2" aria-label="Order in the sidebar">
      <div className="flex items-baseline gap-2 px-1">
        <span className="font-tight text-sm font-medium">Order</span>
        <span className="text-xs text-[var(--faint)]">
          How they sit in the sidebar on this computer. You can also drag them there.
        </span>
        {reset && (
          <button
            onClick={reset}
            className="ml-auto inline-flex shrink-0 items-center gap-1 text-xs text-[var(--muted)] hover:text-[var(--fg)]"
          >
            <RotateCcw className="h-3 w-3" />
            Usual order
          </button>
        )}
      </div>
      <ol className="flex flex-col overflow-hidden rounded-[var(--radius)] border border-[var(--line)]">
        {plugins.map((p, i) => {
          const Icon = p.icon;
          return (
            <li key={p.id} className="flex items-center gap-3 border-b border-[var(--line)] px-3 py-1.5 last:border-b-0">
              <span className="w-4 text-right text-xs tabular-nums text-[var(--faint)]">{i + 1}</span>
              <Icon className="h-4 w-4 text-[var(--muted)]" />
              <span className="flex-1 text-sm">{p.title}</span>
              <button
                onClick={() => moveTo(p.id, i - 1)}
                disabled={i === 0}
                aria-label={`Move ${p.title} up`}
                className="flex h-8 w-8 items-center justify-center rounded-lg text-[var(--muted)] hover:bg-[var(--raise)] hover:text-[var(--fg)] disabled:opacity-30"
              >
                <ArrowUp className="h-4 w-4" />
              </button>
              <button
                onClick={() => moveTo(p.id, i + 1)}
                disabled={i === plugins.length - 1}
                aria-label={`Move ${p.title} down`}
                className="flex h-8 w-8 items-center justify-center rounded-lg text-[var(--muted)] hover:bg-[var(--raise)] hover:text-[var(--fg)] disabled:opacity-30"
              >
                <ArrowDown className="h-4 w-4" />
              </button>
            </li>
          );
        })}
      </ol>
    </section>
  );
}
