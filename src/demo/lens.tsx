import { useEffect, useState } from "react";
import { Image, AlignLeft, Table2, Sparkles, ArrowRight, Check } from "lucide-react";
import type { LucideIcon } from "lucide-react";

/**
 * How a person likes to see things. Each person can ask the app to explain
 * itself their way: in pictures, in a few plain words, or as the raw numbers.
 * The choice is theirs, kept on their computer, and every section that can
 * change reads it. A section can also be switched on its own.
 *
 * In the demo a sentence is matched to a lens by its words. In a member's own
 * app the agent reads the sentence, so it can go further than three lenses.
 */

export type Lens = "pictures" | "words" | "numbers";

export const LENSES: { id: Lens; label: string; icon: LucideIcon; line: string }[] = [
  { id: "pictures", label: "Pictures", icon: Image, line: "Shapes and colour, few words" },
  { id: "words", label: "Words", icon: AlignLeft, line: "Plain sentences" },
  { id: "numbers", label: "Numbers", icon: Table2, line: "Raw figures you can copy" },
];

export const LENS_EXAMPLES = ["Make this more visual", "Show me the raw numbers", "Explain it in plain words"];

const KEY = "murmur.demo.lens";
const EVENT = "murmur-lens";

function read(): Lens {
  const v = typeof localStorage !== "undefined" ? localStorage.getItem(KEY) : null;
  return v === "words" || v === "numbers" ? v : "pictures";
}

export function setLens(l: Lens) {
  localStorage.setItem(KEY, l);
  window.dispatchEvent(new CustomEvent(EVENT));
}

/** The lens this person chose in Settings, kept in step across the app. */
export function useLens(): Lens {
  const [lens, set] = useState<Lens>(read);
  useEffect(() => {
    const on = () => set(read());
    window.addEventListener(EVENT, on);
    window.addEventListener("storage", on);
    return () => {
      window.removeEventListener(EVENT, on);
      window.removeEventListener("storage", on);
    };
  }, []);
  return lens;
}

/** Read a sentence for the lens it asks for, or null when it's unclear. */
export function lensFor(text: string): Lens | null {
  const t = text.toLowerCase();
  if (/number|raw|spreadsheet|excel|table|figure|data|csv|exact|detail|stat/.test(t)) return "numbers";
  if (/visual|picture|image|colour|color|chart|diagram|graph|draw|see it|show me|icon|shape/.test(t)) return "pictures";
  if (/word|plain|explain|simple|sentence|read|story|text|tell me|short/.test(t)) return "words";
  return null;
}

/** Three small buttons that change how one section shows itself. */
export function LensSwitch({ value, onChange }: { value: Lens; onChange: (l: Lens) => void }) {
  return (
    <div role="radiogroup" aria-label="How to show this" className="flex rounded-[var(--radius)] border border-[var(--line-strong)] bg-[var(--card)] p-0.5">
      {LENSES.map(({ id, label, icon: Icon }) => (
        <button
          key={id}
          role="radio"
          aria-checked={value === id}
          onClick={() => onChange(id)}
          title={label}
          className="flex items-center gap-1.5 rounded-[calc(var(--radius)-2px)] px-2 py-1 text-[11px] text-[var(--muted)] transition aria-checked:bg-[var(--fg)] aria-checked:text-[var(--bg)]"
        >
          <Icon className="h-3.5 w-3.5" />
          <span className="hidden sm:inline">{label}</span>
        </button>
      ))}
    </div>
  );
}

/**
 * Tell the app how you like to see things, in your own words. Sets the lens
 * for every section that can change; `onSeen` offers a place to see it.
 */
export function LensPrompt({ onSeen, seenLabel }: { onSeen?: () => void; seenLabel?: string }) {
  const lens = useLens();
  const [text, setText] = useState("");
  const [said, setSaid] = useState<{ text: string; lens: Lens | null } | null>(null);

  function ask(t: string) {
    const l = lensFor(t);
    setSaid({ text: t, lens: l });
    if (l) setLens(l);
    setText("");
  }

  return (
    <div className="space-y-4">
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (text.trim()) ask(text.trim());
        }}
        className="flex items-center gap-2 rounded-[var(--radius)] border border-[var(--line-strong)] bg-[var(--card)] py-1.5 pl-3 pr-1.5"
      >
        <Sparkles className="h-4 w-4 shrink-0 text-[var(--muted)]" />
        <input
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="How do you like to see things?"
          className="min-w-0 flex-1 bg-transparent text-[13px] outline-none placeholder:text-[var(--faint)]"
        />
        <button
          type="submit"
          aria-label="Ask"
          className="flex h-7 w-7 items-center justify-center rounded-[calc(var(--radius)-2px)] bg-[var(--fg)] text-[var(--bg)] disabled:opacity-30"
          disabled={!text.trim()}
        >
          <ArrowRight className="h-3.5 w-3.5" />
        </button>
      </form>
      <div className="flex flex-wrap gap-2">
        {LENS_EXAMPLES.map((x) => (
          <button
            key={x}
            onClick={() => ask(x)}
            className="prism-hover rounded-full border border-[var(--line-strong)] bg-[var(--card)] px-3 py-1 text-[12px] text-[var(--muted)]"
          >
            “{x}”
          </button>
        ))}
      </div>

      {said && (
        <div className="rounded-[var(--radius)] border border-[var(--line)] bg-[var(--raise)] px-4 py-3 text-[13px] leading-relaxed">
          {said.lens ? (
            <>
              <span className="text-[var(--muted)]">You said “{said.text}”.</span> Done. Sections that can change now
              show <b>{LENSES.find((l) => l.id === said.lens)!.label.toLowerCase()}</b> for you.
              {onSeen && (
                <button onClick={onSeen} className="ml-1 inline-flex items-center gap-1 underline underline-offset-2">
                  {seenLabel ?? "See it"} <ArrowRight className="h-3 w-3" />
                </button>
              )}
            </>
          ) : (
            <>
              <span className="text-[var(--muted)]">You said “{said.text}”.</span> This demo knows three ways: pictures,
              words and numbers. In your own app the agent reads what you say and can go further.
            </>
          )}
        </div>
      )}

      <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
        {LENSES.map(({ id, label, icon: Icon, line }) => (
          <button
            key={id}
            onClick={() => setLens(id)}
            data-active={lens === id}
            className="prism-hover flex items-start gap-3 rounded-[var(--radius)] border border-[var(--line)] bg-[var(--card)] px-3 py-2.5 text-left transition data-[active=true]:border-[var(--fg)]"
          >
            <Icon className="mt-0.5 h-4 w-4 shrink-0" />
            <span className="min-w-0">
              <span className="font-tight flex items-center gap-1.5 text-[13px] font-medium">
                {label} {lens === id && <Check className="h-3 w-3" />}
              </span>
              <span className="block text-[11px] leading-snug text-[var(--faint)]">{line}</span>
            </span>
          </button>
        ))}
      </div>
    </div>
  );
}
