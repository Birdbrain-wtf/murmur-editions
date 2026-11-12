import { Mail, ShieldCheck, Server, KeyRound } from "lucide-react";
import type { MurmurModule, PluginContext } from "../../host/types";
import { issues } from "../../host/support";

/**
 * Mail plugin.
 *
 * The collective's own email, moving off Google a step at a time
 * (lab/mail/AGENTS.md). The server receives, signs and sends on
 * lab.decent.partners; decent.partners itself still runs on Google until the
 * cutover. Held from every edition until the app can read and send mail.
 */

const STAGES = [
  {
    icon: Server,
    title: "Our own mail server",
    body: "Running on a Decent-owned box since October 2026. It receives, stores, signs and sends mail on lab.decent.partners, and mirrors the calendar.",
  },
  {
    icon: ShieldCheck,
    title: "Earn deliverability",
    body: "SPF, DKIM and DMARC are in place, on the subdomain and on decent.partners. A new address starts in the spam folder, so it warms up slowly before anything depends on it.",
  },
  {
    icon: KeyRound,
    title: "Forward first, then move",
    body: "New mail is forwarded from Google to our own server while it proves itself. Old mail and years of spam are never copied across. Once everything works, the domain moves and forwarding stops, with Google kept for a month so nothing in flight is lost.",
  },
];

function Panel({ instance }: PluginContext) {
  return (
    <div className="flex h-full flex-col">
      <header className="border-b border-[var(--line)] px-8 pt-7 pb-5">
        <div className="flex items-center gap-2 text-[11px] uppercase tracking-[0.18em] text-[var(--faint)]">
          <Mail className="h-3.5 w-3.5" />
          mail
        </div>
        <h1 className="font-tight mt-2 text-2xl font-medium">
          Your own mail
        </h1>
        <p className="mt-1 max-w-xl text-sm text-[var(--muted)]">
          Email under{" "}
          <span className="font-mono text-[var(--fg)]">{instance.slug}.partners</span>{" "}
          on a server the collective owns. The server is running. Reading and
          sending from here comes next.
        </p>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto px-8 py-6">
        <div className="flex flex-col gap-2">
          {STAGES.map((s, i) => {
            const Icon = s.icon;
            return (
              <article
                key={s.title}
                className="prism-hover flex gap-4 rounded-[var(--radius)] border border-[var(--line)] bg-[var(--card)] px-5 py-4"
              >
                <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-[var(--line-strong)]">
                  <Icon className="h-4 w-4 text-[var(--muted)]" />
                </div>
                <div>
                  <div className="flex items-center gap-2">
                    <span className="font-mono text-[10px] text-[var(--faint)]">
                      {String(i + 1).padStart(2, "0")}
                    </span>
                    <span className="font-tight text-sm font-medium">
                      {s.title}
                    </span>
                  </div>
                  <p className="mt-1 text-[13px] leading-relaxed text-[var(--muted)]">
                    {s.body}
                  </p>
                </div>
              </article>
            );
          })}
        </div>

        <p className="font-mono mt-6 text-[11px] leading-relaxed text-[var(--faint)]">
          Each step is its own go-ahead. Until the inbox works here, this
          surface stays a plan, not a promise.
        </p>
      </div>
    </div>
  );
}

export const mailPlugin: MurmurModule = {
  id: "mail",
  title: "Mail",
  tagline: "Your collective's own email, on a server it owns",
  icon: Mail,
  order: 40,
  kind: "plugin",
  support: issues("mail"),
  backend: "Self-hosted email",
  Panel,
};
