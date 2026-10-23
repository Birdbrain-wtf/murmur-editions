import { useEffect, useRef, useState } from "react";
import { ArrowRight, RotateCcw, Sparkles, X } from "lucide-react";
import { packed, shaped, showcaseName } from "../edition";
import { Button, inputClass, Notice } from "../ui";
import { applyShape, clearShape, composeShape, FORM_INFO, STAGES, type Shape } from "./shape";

/**
 * "What are you looking for?": the visitor says what their group is and needs,
 * and the demo comes back as theirs (`./shape.ts`). It sits at the end of the
 * walkthrough and behind "Make it yours" in the demo bar.
 */

/** Our own model, on our own server. The web build is served beside it. */
const SHAPE_URL =
  import.meta.env.BASE_URL === "/try/" ? "/try/api/shape" : "https://www.decent.partners/try/api/shape";

export const EXAMPLES = [
  "We're an artists' collective raising money for a shared workshop",
  "We're a production company that wants simpler ways of working",
  "I'm starting a local community with a place for events",
];

const WORKING = [
  "Reading what you need",
  "Choosing the plugins and their order",
  "Writing the first issue of your publication",
  "Working out who can use what",
  "Finding the stage you're at",
];

const TITLES: Record<string, string> = {
  magazine: "a publication",
  fundraise: "initiatives",
  meet: "a regular call",
  chat: "chat",
  operations: "the books",
  structure: "structure",
};

async function ask(text: string): Promise<Shape> {
  try {
    const r = await fetch(SHAPE_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({ text }),
      signal: AbortSignal.timeout(75_000),
    });
    if (!r.ok) throw new Error(String(r.status));
    const j = (await r.json()) as { shape?: Shape };
    if (!j.shape?.name) throw new Error("empty");
    return j.shape;
  } catch {
    // Offline or busy: the templates always answer.
    return composeShape(text);
  }
}

function Preview({ s, onAgain }: { s: Shape; onAgain: () => void }) {
  const what = s.plugins.map((p) => (p.startsWith("made-") ? s.made[Number(p.slice(5)) - 1]?.title : TITLES[p])).filter(Boolean);
  return (
    <div className="flex flex-col gap-3">
      <div>
        <div className="font-tight text-lg font-medium">{s.name}</div>
        <p className="mt-1 text-[13px] leading-relaxed text-[var(--muted)]">{s.summary}</p>
      </div>
      <dl className="grid gap-1.5 text-[12px]">
        <div className="flex gap-2">
          <dt className="w-20 shrink-0 text-[var(--faint)]">Its app</dt>
          <dd>{["its own agent", ...what].join(", ")}</dd>
        </div>
        <div className="flex gap-2">
          <dt className="w-20 shrink-0 text-[var(--faint)]">Stage</dt>
          <dd>
            {STAGES[s.stage.now].title} now
            {s.stage.next !== "none" && `. Next, ${FORM_INFO[s.stage.next].title.toLowerCase()}`}
          </dd>
        </div>
        <div className="flex gap-2">
          <dt className="w-20 shrink-0 text-[var(--faint)]">People</dt>
          <dd>{s.roles.map((r) => r.name).join(", ")}</dd>
        </div>
      </dl>
      <div className="flex flex-wrap items-center gap-2">
        <Button variant="primary" trailing={ArrowRight} onClick={() => applyShape(s)}>
          Open {s.name}
        </Button>
        <Button variant="quiet" onClick={onAgain}>
          Try different words
        </Button>
      </div>
      {s.source === "template" && (
        <p className="text-[11px] text-[var(--faint)]">Sketched from a template while our model was busy. Try again for your own.</p>
      )}
    </div>
  );
}

export function TailorForm({ autoFocus }: { autoFocus?: boolean }) {
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [tick, setTick] = useState(0);
  const [result, setResult] = useState<Shape | null>(null);
  const field = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (autoFocus) field.current?.focus();
  }, [autoFocus]);
  useEffect(() => {
    if (!busy) return;
    const t = setInterval(() => setTick((n) => n + 1), 2200);
    return () => clearInterval(t);
  }, [busy]);

  async function go(words = text) {
    const t = words.trim();
    if (t.length < 8 || busy) return;
    setText(t);
    setBusy(true);
    setTick(0);
    setResult(await ask(t));
    setBusy(false);
  }

  if (result) return <Preview s={result} onAgain={() => setResult(null)} />;

  return (
    <div className="flex flex-col gap-3">
      <textarea
        ref={field}
        value={text}
        onChange={(e) => setText(e.target.value.slice(0, 600))}
        onKeyDown={(e) => {
          if (e.key === "Enter" && !e.shiftKey) {
            e.preventDefault();
            void go();
          }
          e.stopPropagation();
        }}
        rows={3}
        disabled={busy}
        placeholder="Who you are and what you need. One sentence is enough."
        className={`${inputClass} resize-none`}
      />
      {busy ? (
        <Notice tone="live">{WORKING[tick % WORKING.length]}…</Notice>
      ) : (
        <div className="flex flex-col gap-1.5">
          {EXAMPLES.map((x) => (
            <button
              key={x}
              onClick={() => void go(x)}
              className="prism-hover rounded-[var(--radius)] border border-[var(--line)] px-3 py-1.5 text-left text-[12px] text-[var(--muted)] transition hover:text-[var(--fg)]"
            >
              “{x}”
            </button>
          ))}
        </div>
      )}
      <div className="flex items-center gap-2">
        <span className="flex-1 text-[11px] leading-snug text-[var(--faint)]">
          Goes to our own model. Nothing is kept.
        </span>
        <Button variant="primary" icon={Sparkles} busy={busy} disabled={text.trim().length < 8} onClick={() => void go()}>
          Show me
        </Button>
      </div>
    </div>
  );
}

/** "Make it yours", from the demo bar. */
export function TailorDialog({ onClose }: { onClose: () => void }) {
  return (
    <div className="fixed inset-0 z-30 flex items-center justify-center bg-black/20 p-4" onClick={onClose}>
      <div
        role="dialog"
        aria-label="What are you looking for?"
        className="w-full max-w-md rounded-[calc(var(--radius)+4px)] border border-[var(--line-strong)] bg-[var(--card)] p-5 shadow-[0_20px_80px_rgba(0,0,0,0.18)]"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2 className="font-tight text-lg font-medium">What are you looking for?</h2>
            <p className="mt-1 text-[13px] leading-relaxed text-[var(--muted)]">
              {packed ? `Describe ${showcaseName} in your own words and the demo redraws itself. You can come back to this version.` : "Describe your group and this demo becomes yours."}
            </p>
          </div>
          <button onClick={onClose} className="text-[var(--faint)] hover:text-[var(--fg)]" title="Close">
            <X className="h-5 w-5" />
          </button>
        </div>
        <div className="mt-4">
          <TailorForm autoFocus />
        </div>
        {shaped && !shaped.alice && shaped.source !== "pack" && (
          <div className="mt-4 border-t border-[var(--line)] pt-3">
            <Button variant="quiet" icon={RotateCcw} onClick={clearShape}>
              Back to {showcaseName}
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}
