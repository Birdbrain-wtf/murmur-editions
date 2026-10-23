import { colourful, inkOf } from "./ink";
import { edition, shaped } from "../edition";
import { getModule } from "../host/registry";
import { Button } from "../ui";
import { demoNote } from "./note";

/**
 * What it costs, as a sample (demo editions only). The app costs what a group
 * uses, line by line, and the running total is always in view under Billing in
 * Settings. Usage and prices are invented for the demo
 * and say so. The one real rule shown is the Network Rate
 * (core/state/architecture/the-stack.md §5): 10% of what a collective earns
 * through the infrastructure, never of what merely passes through it.
 */

const people = shaped?.size ?? 25;
const gbp = (n: number) =>
  new Intl.NumberFormat("en-GB", { style: "currency", currency: "GBP", minimumFractionDigits: 2 }).format(n);
const count = (n: number) => new Intl.NumberFormat("en-GB").format(Math.round(n));

interface Line {
  id: string;
  what: string;
  cost: number;
  /** people's time (an expert's hours), shown apart from what the software costs */
  people?: boolean;
}

/** This month's sample use, one line per plugin that is in the rail. */
function lines(installed: string[]): Line[] {
  const has = (id: string) => installed.includes(id);
  const nextStep = shaped ? shaped.stage.next !== "none" : true;
  const out: Line[] = [];
  out.push({ id: "agent", what: `${count(people * 9)} questions answered, from ${edition.instance.name}'s own documents`, cost: people * 9 * 0.02 });
  if (has("magazine")) out.push({ id: "magazine", what: "5 pieces published, read 640 times", cost: 0.8 });
  if (has("fundraise")) out.push({ id: "fundraise", what: "3 initiatives kept up to date", cost: 0.3 });
  if (has("spend")) out.push({ id: "spend", what: "3 cards, 34 payments matched to receipts", cost: 3 * 0.5 + 34 * 0.02 });
  if (has("meet")) out.push({ id: "meet", what: "4 calls, 6 hours, recorded and transcribed", cost: 6 * 0.4 });
  if (has("chat")) out.push({ id: "chat", what: `${count(people * 50)} messages and 2 GB of files`, cost: 1.1 });
  if (has("operations")) out.push({ id: "operations", what: "86 transactions reconciled, one VAT return drafted", cost: 86 * 0.05 });
  for (const id of installed.filter((i) => i.startsWith("made-")))
    out.push({ id, what: "Made for you, kept up and hosted", cost: 1.5 });
  if (has("structure"))
    out.push(
      nextStep
        ? { id: "structure", what: "The agent's drafts of the papers", cost: 0.6 }
        : { id: "structure", what: "Registers and filing dates kept in step", cost: 0.4 },
    );
  out.push({ id: "record", what: "The record, 3.2 GB, kept in two places", cost: 0.64 });
  if (edition.showcase && !shaped)
    out.push({
      id: "asked",
      what: "3 answers on pricing care-home sessions, £45 each, paid when the stewards marked them useful. Who answered stays private",
      cost: 135,
      people: true,
    });
  if (has("structure") && nextStep)
    out.push({ id: "structure", what: "1.5 hours of an expert checking the papers, agreed first", cost: 1.5 * 60, people: true });
  return out;
}

export function monthTotal(installed: string[]): number {
  return lines(installed).reduce((n, l) => n + l.cost, 0);
}

function CostRow({ l }: { l: Line }) {
  const m = l.id === "record" || l.id === "asked" ? null : getModule(l.id);
  const Icon = m?.icon;
  return (
    <tr className="border-b border-[var(--line)] align-top">
      <td className="px-3 py-2">
        <span className="flex items-center gap-2">
          {Icon && <Icon className="h-4 w-4 shrink-0" style={{ color: colourful ? inkOf(l.id) : "var(--muted)" }} />}
          <span className="font-tight text-[13px]">{m?.title ?? (l.id === "asked" ? "Asking the network" : "Your record")}</span>
        </span>
      </td>
      <td className="px-3 py-2 text-[var(--muted)]">{l.what}</td>
      <td className="font-mono px-3 py-2 text-right">{gbp(l.cost)}</td>
    </tr>
  );
}

function Subtotal({ label, n }: { label: string; n: number }) {
  return (
    <tr className="border-b border-[var(--line)] bg-[var(--raise)]">
      <td className="px-3 py-2 text-[12px] text-[var(--muted)]" colSpan={2}>
        {label}
      </td>
      <td className="font-mono px-3 py-2 text-right text-[12px]">{gbp(n)}</td>
    </tr>
  );
}

export function CostsTable({ installed }: { installed: string[] }) {
  const name = edition.instance.name;
  const list = lines(installed);
  const total = list.reduce((n, l) => n + l.cost, 0);
  const app = list.filter((l) => !l.people).reduce((n, l) => n + l.cost, 0);
  return (
    <div className="flex flex-col gap-4">
      <p className="px-1 text-[13px] leading-relaxed text-[var(--muted)]">
        {name} pays only for what it uses, line by line.
      </p>

      {colourful && total > 0 && (
        <div className="px-1">
          <div className="flex h-3 overflow-hidden rounded-full">
            {[...list.filter((l) => !l.people), ...list.filter((l) => l.people)].map((l) => (
              <span
                key={`${l.id}-${l.people ? "p" : "a"}`}
                title={`${getModule(l.id)?.title ?? l.id}: ${gbp(l.cost)}`}
                style={{ width: `${(l.cost / total) * 100}%`, background: inkOf(l.id), opacity: l.people ? 0.55 : 1 }}
              />
            ))}
          </div>
          <div className="mt-1.5 flex justify-between text-[11px] text-[var(--faint)]">
            <span>Running the app · {gbp(app)}</span>
            <span>People's time · {gbp(total - app)}</span>
          </div>
        </div>
      )}

      <div className="overflow-hidden rounded-[var(--radius)] border border-[var(--line)]">
        <table className="w-full border-collapse text-left text-[12px]">
          <thead>
            <tr className="border-b border-[var(--line)] text-[var(--faint)]">
              <th className="px-3 py-2.5 font-normal">Plugin</th>
              <th className="px-3 py-2.5 font-normal">What was used</th>
              <th className="px-3 py-2.5 text-right font-normal">This month</th>
            </tr>
          </thead>
          <tbody>
            {list.filter((l) => !l.people).map((l) => (
              <CostRow key={l.id} l={l} />
            ))}
            <tr className="border-b border-[var(--line)] align-top">
              <td className="px-3 py-2 font-tight text-[13px]">Network Rate</td>
              <td className="px-3 py-2 text-[var(--muted)]">
                10% of what {name} earns through the app, never of money passing through. Nothing earned this month.
              </td>
              <td className="font-mono px-3 py-2 text-right">{gbp(0)}</td>
            </tr>
            <Subtotal label="Running the app" n={app} />
            {list.some((l) => l.people) && (
              <>
                {list.filter((l) => l.people).map((l) => (
                  <CostRow key={`${l.id}-people`} l={l} />
                ))}
                <Subtotal label="People's time" n={total - app} />
              </>
            )}
            <tr>
              <td className="px-3 py-2.5 font-tight text-[13px] font-medium" colSpan={2}>
                The month so far
              </td>
              <td className="font-mono px-3 py-2.5 text-right font-medium">{gbp(total)}</td>
            </tr>
          </tbody>
        </table>
      </div>

      <div className="flex flex-wrap items-center gap-2 px-1">
        <Button onClick={() => demoNote(`In your own app the stewards are asked before ${name} passes its monthly limit.`)}>
          Set a monthly limit
        </Button>
        <span className="text-[12px] text-[var(--faint)]">Every line also goes into the books.</span>
      </div>

      <p className="px-1 text-[12px] leading-relaxed text-[var(--faint)]">
        Sample use and prices. People's time is agreed before anyone spends it.
      </p>
    </div>
  );
}
