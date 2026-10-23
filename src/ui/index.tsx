import type { ButtonHTMLAttributes, ReactNode } from "react";
import type { LucideIcon } from "lucide-react";
import { Loader2 } from "lucide-react";

/**
 * The app's one design kit. Every surface (core and plugin) draws its page,
 * header, sections, buttons, fields and states from here, so they read as one
 * app across every edition. Prism's rule holds: white is the resting state,
 * colour is the consequence. Nothing here fills a button with colour or puts a
 * gradient at rest; state at rest is a 6px dot or a line of text.
 *
 * Widths: `read` for forms and prose (the default), `wide` for tables and
 * lists, `full` for embedded pages (magazine, channel) and chat.
 */

const cx = (...c: (string | false | null | undefined)[]) => c.filter(Boolean).join(" ");

export function Page({ children }: { children: ReactNode }) {
  return <div className="flex h-full min-h-0 flex-col">{children}</div>;
}

export function PageHeader({
  icon: Icon,
  eyebrow,
  title,
  lede,
  actions,
  children,
}: {
  icon: LucideIcon;
  eyebrow: string;
  title: ReactNode;
  lede?: ReactNode;
  actions?: ReactNode;
  children?: ReactNode;
}) {
  return (
    <header className="page-header relative shrink-0 border-b border-[var(--line)] bg-[var(--ink-wash,transparent)] px-5 pt-6 pb-5 md:px-8">
      {/* In the demo each surface wears its own ink (demo/ink.ts): a band, a chip and a wash. */}
      <span aria-hidden className="absolute inset-x-0 top-0 h-1 bg-[var(--ink,transparent)]" />
      {/* On phones the actions drop under the title and wrap, so a header with
          several buttons never pushes the page sideways. */}
      <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between md:gap-6">
        <div className="min-w-0">
          <div className="[.inked_&_svg]:hidden">
            <Eyebrow icon={Icon}>{eyebrow}</Eyebrow>
          </div>
          <h1 className="font-tight mt-2 flex items-center gap-3 text-2xl font-medium tracking-[-0.025em] md:text-[28px]">
            <span className="header-icon hidden h-10 w-10 shrink-0 items-center justify-center rounded-[12px] bg-[var(--ink)] text-[var(--ink-on)] [.inked_&]:flex">
              <Icon className="h-[18px] w-[18px]" />
            </span>
            <span className="min-w-0">{title}</span>
          </h1>
          {lede && <p className="mt-1.5 max-w-xl text-sm leading-relaxed text-[var(--muted)]">{lede}</p>}
        </div>
        {actions && <div className="flex flex-wrap items-center gap-2 md:shrink-0 md:pt-5">{actions}</div>}
      </div>
      {children}
    </header>
  );
}

const WIDTH = { read: "max-w-2xl", wide: "max-w-4xl", full: "" } as const;

/** The scrolling body under a header. Leaves room at the foot for the host's
 *  floating controls so nothing sits underneath them. */
export function PageBody({
  width = "read",
  children,
  className,
}: {
  width?: keyof typeof WIDTH;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className="min-h-0 flex-1 overflow-y-auto px-5 pt-6 pb-20 md:px-8">
      <div className={cx(WIDTH[width], "space-y-8", className)}>{children}</div>
    </div>
  );
}

export function Eyebrow({ icon: Icon, children }: { icon?: LucideIcon; children: ReactNode }) {
  return (
    <div className="font-mono flex items-center gap-2 text-[11px] uppercase tracking-[0.16em] text-[var(--faint)]">
      {Icon && <Icon className="h-3.5 w-3.5 text-[var(--ink,currentColor)]" />}
      {children}
    </div>
  );
}

export function Section({
  label,
  icon,
  lede,
  aside,
  children,
}: {
  label: string;
  icon?: LucideIcon;
  lede?: ReactNode;
  aside?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section>
      <div className="mb-3 flex items-center justify-between gap-4">
        <Eyebrow icon={icon}>{label}</Eyebrow>
        {aside}
      </div>
      {lede && <p className="-mt-1 mb-4 max-w-prose text-[13px] leading-relaxed text-[var(--muted)]">{lede}</p>}
      {children}
    </section>
  );
}

/** A bordered white block. `quiet` sits one shade off the page (for status
 *  read-outs); `dashed` is for something not here yet. */
export function Card({
  tone = "plain",
  className,
  children,
}: {
  tone?: "plain" | "quiet" | "dashed";
  className?: string;
  children: ReactNode;
}) {
  return (
    <div
      className={cx(
        "rounded-[var(--radius)] border px-5 py-4",
        tone === "plain" && "border-[var(--line)] bg-[var(--card)]",
        tone === "quiet" && "border-[var(--line)] bg-[var(--raise)]",
        tone === "dashed" && "border-dashed border-[var(--line-strong)] bg-[var(--raise)]",
        className,
      )}
    >
      {children}
    </div>
  );
}

/** One row of a card: title and line on the left, an action on the right. */
export function Row({
  icon: Icon,
  title,
  detail,
  status,
  action,
}: {
  icon?: LucideIcon;
  title: ReactNode;
  detail?: ReactNode;
  status?: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-start justify-between gap-4">
      <div className="flex min-w-0 items-start gap-3">
        {Icon && <Icon className="mt-0.5 h-4 w-4 shrink-0 text-[var(--ink,var(--muted))]" />}
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <span className="font-tight text-sm font-medium">{title}</span>
            {status}
          </div>
          {detail && <div className="mt-1 text-[13px] leading-relaxed text-[var(--muted)]">{detail}</div>}
        </div>
      </div>
      {action && <div className="flex shrink-0 items-center gap-2">{action}</div>}
    </div>
  );
}

/** Rows in one card, divided by hairlines. */
export function List({ children }: { children: ReactNode }) {
  return (
    <div className="divide-y divide-[var(--line)] overflow-hidden rounded-[var(--radius)] border border-[var(--line)] bg-[var(--card)] [&>*]:px-5 [&>*]:py-4">
      {children}
    </div>
  );
}

type Tone = "ok" | "warn" | "danger" | "idle" | "live";
const TONE: Record<Tone, string> = {
  ok: "var(--ok)",
  warn: "var(--warn)",
  danger: "var(--danger)",
  idle: "var(--faint)",
  live: "var(--ink, var(--accent))",
};

export function Dot({ tone = "idle", pulse }: { tone?: Tone; pulse?: boolean }) {
  return (
    <span
      className={cx("inline-block h-1.5 w-1.5 shrink-0 rounded-full", pulse && "pulse-dot")}
      style={{ background: TONE[tone] }}
    />
  );
}

/** State at rest: a dot and a quiet mono label. Replaces coloured pills. */
export function Status({ tone = "idle", pulse, children }: { tone?: Tone; pulse?: boolean; children: ReactNode }) {
  return (
    <span className="font-mono inline-flex items-center gap-1.5 text-[11px] text-[var(--muted)]">
      <Dot tone={tone} pulse={pulse} />
      {children}
    </span>
  );
}

/** A line that reports something: an error, a saved confirmation, a caveat. */
export function Notice({ tone = "idle", children }: { tone?: Tone; children: ReactNode }) {
  const colour = tone === "danger" ? "var(--danger)" : tone === "ok" ? "var(--ok)" : "var(--muted)";
  return (
    <p className="flex items-start gap-2 text-[13px] leading-relaxed" style={{ color: colour }}>
      <span className="mt-[7px]">
        <Dot tone={tone} />
      </span>
      <span>{children}</span>
    </p>
  );
}

type Variant = "primary" | "secondary" | "quiet" | "danger";

/**
 * Buttons are white. `primary` carries the ink border (the one thing to do
 * here), `secondary` a hairline, `quiet` none (inline actions), `danger` the
 * hairline with red text. Colour arrives on hover, through prism-hover.
 */
export function Button({
  variant = "secondary",
  size = "sm",
  icon: Icon,
  trailing: Trailing,
  busy,
  children,
  className,
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: Variant;
  size?: "sm" | "md";
  icon?: LucideIcon;
  trailing?: LucideIcon;
  busy?: boolean;
}) {
  return (
    <button
      {...rest}
      disabled={rest.disabled || busy}
      className={cx(
        "inline-flex min-h-9 shrink-0 items-center justify-center gap-1.5 rounded-[var(--radius)] transition disabled:cursor-default disabled:opacity-45",
        variant !== "quiet" && "prism-hover border bg-[var(--card)]",
        size === "sm" ? "px-3 py-1.5 text-xs" : "px-4 py-2.5 text-sm",
        variant === "primary" && "border-[var(--fg)] font-medium text-[var(--fg)]",
        variant === "secondary" && "border-[var(--line-strong)] text-[var(--fg)]",
        variant === "danger" && "border-[var(--line-strong)] text-[var(--danger)]",
        variant === "quiet" && "px-1 text-[var(--muted)] underline-offset-4 hover:text-[var(--fg)] hover:underline",
        className,
      )}
    >
      {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : Icon && <Icon className="h-3.5 w-3.5" />}
      {children}
      {Trailing && <Trailing className="h-3.5 w-3.5" />}
    </button>
  );
}

/** The class every text input and textarea uses. */
export const inputClass =
  "prism-hover w-full rounded-[var(--radius)] border border-[var(--line-strong)] bg-[var(--card)] px-3 py-2 text-sm outline-none placeholder:text-[var(--faint)] focus:border-[var(--accent)]";

export function Field({ label, hint, children }: { label: string; hint?: ReactNode; children: ReactNode }) {
  return (
    <label className="block">
      <span className="font-tight block text-sm font-medium">{label}</span>
      {hint && <span className="mt-0.5 block text-xs text-[var(--faint)]">{hint}</span>}
      <span className="mt-2 block">{children}</span>
    </label>
  );
}

/**
 * The one pattern for "this needs something first": sign in, pair, connect.
 * Sits at the top of the page body, the same width as everything else, so a
 * locked screen and an open one have the same shape.
 */
export function Gate({
  icon: Icon,
  title,
  children,
  action,
}: {
  icon: LucideIcon;
  title: ReactNode;
  children?: ReactNode;
  action?: ReactNode;
}) {
  return (
    <Card className="px-6 py-6">
      <div className="flex h-10 w-10 items-center justify-center rounded-[var(--radius)] border border-[var(--line-strong)]">
        <Icon className="h-5 w-5 text-[var(--muted)]" />
      </div>
      <h2 className="font-tight mt-4 text-lg font-medium">{title}</h2>
      {children && <div className="mt-1.5 space-y-3 text-[13px] leading-relaxed text-[var(--muted)]">{children}</div>}
      {action && <div className="mt-5 flex flex-wrap items-center gap-2">{action}</div>}
    </Card>
  );
}

/** A pairing code the member checks against their browser. */
export function Code({ children }: { children: ReactNode }) {
  return (
    <div className="font-mono rounded-[var(--radius)] border border-[var(--line-strong)] py-3 text-center text-2xl tracking-[0.18em] text-[var(--fg)]">
      {children}
    </div>
  );
}

export function Waiting({ children }: { children: ReactNode }) {
  return (
    <p className="flex items-center gap-2 text-xs text-[var(--faint)]">
      <Loader2 className="h-3.5 w-3.5 animate-spin" /> {children}
    </p>
  );
}

export function Empty({ children }: { children: ReactNode }) {
  return (
    <div className="rounded-[var(--radius)] border border-dashed border-[var(--line-strong)] px-5 py-8 text-center text-[13px] text-[var(--muted)]">
      {children}
    </div>
  );
}

/** Small mono facts: ids, counts, versions. */
export function Facts({ items }: { items: [string, ReactNode][] }) {
  return (
    <dl className="font-mono grid grid-cols-2 gap-x-6 gap-y-1 text-[11px] text-[var(--faint)]">
      {items.map(([k, v]) => (
        <div key={k} className="flex gap-2">
          <dt>{k}</dt>
          <dd className="truncate text-[var(--muted)]">{v}</dd>
        </div>
      ))}
    </dl>
  );
}
