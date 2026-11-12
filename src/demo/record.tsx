import { useEffect, useState } from "react";
import { Lock, Users, BotOff, Handshake, ShieldCheck, ScrollText, Copy, Check, HardDrive } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { Section, Card } from "../ui";
import { KINDS, type Kind } from "../identity/hero";
import { demoNote } from "./note";
import { LensSwitch, useLens, type Lens } from "./lens";

/**
 * "Her record" on the sample Profile: what Alice contributed, where, who may
 * use it, and her signature on each. It shows itself the way the reader chose
 * in Settings (pictures, words or numbers), and each reader can switch it here.
 * Whichever way it's shown, "who may use it" is the same choice underneath.
 */

export interface RecordItem {
  what: string;
  where: string;
  when: string;
  consent: number;
  proof: string;
  kind?: Kind;
}

export const CONSENT: { label: string; short: string; icon: LucideIcon; colour: string }[] = [
  { label: "Only me", short: "Only her", icon: Lock, colour: "#8a8a8a" },
  { label: "Members of the group", short: "Members", icon: Users, colour: "#007aff" },
  { label: "Members, not to train AI", short: "Members, not AI", icon: BotOff, colour: "#5856d6" },
  { label: "Group may license it, on members' terms", short: "Group may license", icon: Handshake, colour: "#34c759" },
];

/** Alice's 48 contributions by who may use them, before any change here. */
const BASE = [9, 24, 9, 6];

const CHANGED =
  "In your own app, your passkey signs this change. Past use under the old terms stays on the record.";

export function RecordSection({ items, group }: { items: RecordItem[]; group: string }) {
  const chosen = useLens();
  const [lens, setLocal] = useState<Lens>(chosen);
  useEffect(() => setLocal(chosen), [chosen]);
  const [consent, setConsent] = useState(items.map((r) => r.consent));
  const change = (i: number, c: number) => {
    setConsent((all) => all.map((x, j) => (j === i ? c : x)));
    demoNote(CHANGED);
  };
  const totals = BASE.map((n, c) =>
    items.reduce((t, r, i) => t - (r.consent === c ? 1 : 0) + (consent[i] === c ? 1 : 0), n),
  );

  return (
    <div data-tour-section="record" className="scroll-mt-6">
      <Section
        label="Her record"
        icon={ScrollText}
        lede="What she made and who may use it. She can change her mind any time."
        aside={<LensSwitch value={lens} onChange={setLocal} />}
      >
        {lens === "pictures" && <Pictures items={items} consent={consent} totals={totals} onChange={change} />}
        {lens === "words" && <Words items={items} consent={consent} group={group} onChange={change} />}
        {lens === "numbers" && <Numbers items={items} consent={consent} totals={totals} onChange={change} />}
      </Section>
    </div>
  );
}

// ── pictures ────────────────────────────────────────────────────────────────

function Pictures({
  items,
  consent,
  totals,
  onChange,
}: {
  items: RecordItem[];
  consent: number[];
  totals: number[];
  onChange: (i: number, c: number) => void;
}) {
  const all = totals.reduce((a, b) => a + b, 0);
  return (
    <div className="space-y-3">
      <Card>
        <div className="flex items-baseline justify-between gap-3">
          <div className="font-tight text-sm font-medium">Who may use her {all} contributions</div>
          <div className="text-[11px] text-[var(--faint)]">each one signed</div>
        </div>
        <div className="mt-3 flex h-3 overflow-hidden rounded-full bg-[var(--line)]">
          {totals.map((n, c) => (
            <span key={c} className="h-full transition-all" style={{ width: `${(n / all) * 100}%`, background: CONSENT[c].colour }} />
          ))}
        </div>
        <div className="mt-3 grid grid-cols-2 gap-x-4 gap-y-2 sm:grid-cols-4">
          {CONSENT.map(({ short, icon: Icon, colour }, c) => (
            <div key={short} className="flex items-center gap-2">
              <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full" style={{ background: `${colour}1f`, color: colour }}>
                <Icon className="h-3.5 w-3.5" />
              </span>
              <span className="min-w-0 leading-tight">
                <span className="font-tight block text-[13px] font-medium">{totals[c]}</span>
                <span className="block truncate text-[11px] text-[var(--faint)]">{short}</span>
              </span>
            </div>
          ))}
        </div>
      </Card>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        {items.map((r, i) => {
          const k = KINDS[r.kind ?? "work"];
          const KindIcon = k.icon;
          const c = CONSENT[consent[i]];
          const mine = r.kind === "private";
          return (
            <div key={r.what} className={`flex flex-col rounded-[var(--radius)] border border-[var(--line)] bg-[var(--card)] ${mine && items.length % 2 ? "sm:col-span-2" : ""}`}>
              <div className="h-1 rounded-t-[var(--radius)]" style={{ background: k.colour }} />
              <div className="flex flex-1 flex-col px-4 py-3">
                <div className="flex items-start gap-3">
                  <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full" style={{ background: `${k.colour}1f`, color: k.colour }}>
                    <KindIcon className="h-4 w-4" />
                  </span>
                  <div className="min-w-0">
                    <div className="font-tight text-[13px] font-medium leading-snug">{r.what}</div>
                    <div className="mt-0.5 text-[11px] text-[var(--faint)]">
                      {r.where} · {r.when}
                    </div>
                  </div>
                </div>
                <div className="mt-auto flex items-center justify-between gap-2 pt-3">
                  {mine ? (
                    <span className="flex h-7 w-7 items-center justify-center rounded-full text-white" style={{ background: CONSENT[0].colour }}>
                      <Lock className="h-3.5 w-3.5" />
                    </span>
                  ) : (
                  <div className="flex gap-1" role="radiogroup" aria-label="Who may use it">
                    {CONSENT.map(({ label, icon: Icon, colour }, n) => {
                      const on = consent[i] === n;
                      return (
                        <button
                          key={label}
                          role="radio"
                          aria-checked={on}
                          title={label}
                          onClick={() => !on && onChange(i, n)}
                          className="flex h-7 w-7 items-center justify-center rounded-full border transition"
                          style={on ? { background: colour, borderColor: colour, color: "#fff" } : { borderColor: "var(--line)", color: "var(--faint)" }}
                        >
                          <Icon className="h-3.5 w-3.5" />
                        </button>
                      );
                    })}
                  </div>
                  )}
                  <span
                    title={mine ? "Never leaves her computer" : `Signed by Alice · ${r.proof}`}
                    className="flex items-center gap-1 rounded-full bg-[var(--raise)] px-2 py-0.5 text-[11px] text-[var(--muted)]"
                  >
                    {mine ? <HardDrive className="h-3 w-3" /> : <ShieldCheck className="h-3 w-3" />}
                    {mine ? "on her computer" : "signed"}
                  </span>
                </div>
                <div className="mt-1.5 text-[11px]" style={{ color: c.colour }}>
                  {c.label}
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ── words ───────────────────────────────────────────────────────────────────

function sentence(r: RecordItem, c: number, group: string) {
  if (r.kind === "private") return "Only she can read these. They never leave her computer.";
  const who = [
    "Only she may use it.",
    `Members of ${group} may use it.`,
    "Members may use it, but not to train AI.",
    `${group} may license it, on members' terms.`,
  ][c];
  return who;
}

function Words({
  items,
  consent,
  group,
  onChange,
}: {
  items: RecordItem[];
  consent: number[];
  group: string;
  onChange: (i: number, c: number) => void;
}) {
  return (
    <Card>
      <ol className="space-y-4">
        {items.map((r, i) => (
          <li key={r.what} className="text-[14px] leading-relaxed">
            <span className="font-tight font-medium">{r.when.charAt(0).toUpperCase() + r.when.slice(1)}.</span> {r.what}, in{" "}
            {r.where}. <span className="text-[var(--muted)]">{sentence(r, consent[i], group)}</span>
            {r.kind !== "private" && (
              <select
                aria-label="Who may use it"
                value={consent[i]}
                onChange={(e) => onChange(i, Number(e.target.value))}
                className="ml-1.5 cursor-pointer bg-transparent text-[12px] text-[var(--faint)] underline decoration-dotted underline-offset-2"
              >
                {CONSENT.map((c, n) => (
                  <option key={c.label} value={n}>
                    {n === consent[i] ? "change" : c.short}
                  </option>
                ))}
              </select>
            )}
          </li>
        ))}
      </ol>
      <p className="mt-4 border-t border-[var(--line)] pt-3 text-[13px] text-[var(--muted)]">
        Each is signed with her key, proof it was hers.
      </p>
    </Card>
  );
}

// ── numbers ─────────────────────────────────────────────────────────────────

function Numbers({
  items,
  consent,
  totals,
  onChange,
}: {
  items: RecordItem[];
  consent: number[];
  totals: number[];
  onChange: (i: number, c: number) => void;
}) {
  const [copied, setCopied] = useState(false);
  const all = totals.reduce((a, b) => a + b, 0);
  const rows = items.map((r, i) => [r.when, r.what, KINDS[r.kind ?? "work"].label, r.where, CONSENT[consent[i]].label, r.proof]);
  const csv = [["date", "contribution", "kind", "where", "who may use it", "proof"], ...rows]
    .map((row) => row.map((v) => `"${v.replace(/"/g, '""')}"`).join(","))
    .join("\n");
  const th = "px-3 py-2 text-left font-mono text-[10px] font-normal uppercase tracking-wider text-[var(--faint)]";
  const td = "border-t border-[var(--line)] px-3 py-2 align-top";
  return (
    <div className="space-y-3">
      <div className="overflow-x-auto rounded-[var(--radius)] border border-[var(--line)] bg-[var(--card)]">
        <table className="w-full min-w-[640px] text-[12px]">
          <thead>
            <tr>
              {["Date", "Contribution", "Kind", "Where", "Who may use it", "Proof"].map((h) => (
                <th key={h} className={th}>
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {items.map((r, i) => (
              <tr key={r.what}>
                <td className={`${td} whitespace-nowrap font-mono`}>{r.when}</td>
                <td className={`${td} min-w-[11rem]`}>{r.what}</td>
                <td className={td}>{KINDS[r.kind ?? "work"].label}</td>
                <td className={td}>{r.where}</td>
                <td className={td}>
                  {r.kind === "private" ? (
                    CONSENT[0].short
                  ) : (
                    <select
                      aria-label="Who may use it"
                      value={consent[i]}
                      onChange={(e) => onChange(i, Number(e.target.value))}
                      className="bg-transparent text-[12px]"
                    >
                      {CONSENT.map((c, n) => (
                        <option key={c.label} value={n}>
                          {c.short}
                        </option>
                      ))}
                    </select>
                  )}
                </td>
                <td className={`${td} whitespace-nowrap font-mono text-[11px] text-[var(--faint)]`}>{r.proof}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="overflow-x-auto rounded-[var(--radius)] border border-[var(--line)] bg-[var(--card)]">
        <table className="w-full text-[12px]">
          <thead>
            <tr>
              <th className={th}>Who may use it</th>
              <th className={`${th} text-right`}>Count</th>
              <th className={`${th} text-right`}>Share</th>
            </tr>
          </thead>
          <tbody>
            {CONSENT.map((c, n) => (
              <tr key={c.label}>
                <td className={td}>{c.label}</td>
                <td className={`${td} text-right font-mono`}>{totals[n]}</td>
                <td className={`${td} text-right font-mono`}>{((totals[n] / all) * 100).toFixed(1)}%</td>
              </tr>
            ))}
            <tr>
              <td className={`${td} font-medium`}>All her contributions</td>
              <td className={`${td} text-right font-mono font-medium`}>{all}</td>
              <td className={`${td} text-right font-mono`}>100.0%</td>
            </tr>
          </tbody>
        </table>
      </div>

      <button
        onClick={() => {
          void navigator.clipboard?.writeText(csv).then(() => {
            setCopied(true);
            setTimeout(() => setCopied(false), 2000);
          });
        }}
        className="prism-hover flex items-center gap-1.5 rounded-[var(--radius)] border border-[var(--line-strong)] bg-[var(--card)] px-3 py-1.5 text-[12px]"
      >
        {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
        {copied ? "Copied" : "Copy as a spreadsheet"}
      </button>
    </div>
  );
}
