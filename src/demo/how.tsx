import { useEffect, useMemo, useState } from "react";
import { ArrowDown, Lightbulb, Mail } from "lucide-react";
import type { MurmurModule } from "../host/types";
import { Button, Page, PageBody, PageHeader } from "../ui";
import { RISO } from "./sample";
import { askForLogins, askLabel } from "./note";
import { TailorForm } from "./tailor";

/**
 * How it works: the closing chapter of the invented demo, told in pictures.
 * One thing Alice did (the £80 answer she gave Common Loaf) is followed down
 * through each layer: the ledger that keeps it, the digital money that pays
 * it, the intelligence it may or may not teach, the group's own chat and calls,
 * how Decent is paid, and why
 * any of it matters. It ends on "What are you looking for?".
 *
 * Every claim carries what is live today and what is in the works, because
 * this is a public page (contributor promise: no present-tense compensation).
 * The facts behind it: Kreivo on Kusama Asset Hub (proof of stake, fees paid
 * in dUSD), dUSD issued by Brale, the query meter (priced, settled between our
 * own keys), ADR 0058 (the Network Rate), ADR 0059 and 0064 (the intelligence),
 * one Matrix server and call relay per collective (chat v0.1 has no end-to-end
 * encryption yet, so the page never claims it).
 */

const INK = { ...RISO, violet: "#7b4fc4", green: "#1f9d6b", ink: "#1a1a1a" };
const still = () => typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;

const LAYERS = [
  { id: "you", label: "You", line: "your key, your notes, your record", ink: INK.pink },
  { id: "groups", label: "Your groups", line: "chat, calls, a publication, the books", ink: INK.blue },
  { id: "intelligence", label: "The intelligence", line: "each group's own, and one we share", ink: INK.violet },
  { id: "money", label: "The money", line: "digital money, one for one", ink: INK.yellow },
  { id: "ledger", label: "The ledger", line: "a record nobody can quietly change", ink: INK.ink },
];

const go = (id: string) =>
  document.querySelector(`[data-how="${id}"]`)?.scrollIntoView({ behavior: "smooth", block: "start" });

// ── the stack, exploded ─────────────────────────────────────────────────────

function Stack() {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    const t = setTimeout(() => setOpen(true), 350);
    return () => clearTimeout(t);
  }, []);
  const gap = open ? 64 : 16;
  const top = open ? 58 : 150;
  const cx = 170, w = 140, h = 48, depth = 10;
  const last = top + gap * (LAYERS.length - 1);
  return (
    <div className="relative">
      <svg viewBox="0 0 560 360" className="w-full" role="img" aria-label="The layers under the app, from you at the top to the ledger at the foot">
        {/* the thread: one answer, falling through every layer */}
        <line x1={cx} y1={top - h} x2={cx} y2={last + h} stroke="var(--line-strong)" strokeDasharray="2 5" style={{ transition: "all .9s cubic-bezier(.2,.8,.2,1)" }} />
        {[...LAYERS].reverse().map((l, ri) => {
          const i = LAYERS.length - 1 - ri;
          const cy = top + gap * i;
          return (
            <g
              key={l.id}
              onClick={() => go(l.id === "groups" ? "talk" : l.id)}
              className="cursor-pointer"
              style={{ transform: `translateY(${cy}px)`, transition: "transform .9s cubic-bezier(.2,.8,.2,1)" }}
            >
              <polygon
                points={`${cx - w},0 ${cx},${h} ${cx + w},0 ${cx + w},${depth} ${cx},${h + depth} ${cx - w},${depth}`}
                fill={l.ink}
                opacity={0.9}
              />
              <polygon
                points={`${cx},${-h} ${cx + w},0 ${cx},${h} ${cx - w},0`}
                fill={l.id === "ledger" ? "#fbf7ee" : l.ink}
                stroke={l.id === "ledger" ? INK.ink : "none"}
                strokeWidth={1.5}
                style={{ mixBlendMode: "multiply" }}
                opacity={l.id === "ledger" ? 1 : 0.82}
              />
              {l.id === "ledger" &&
                [0, 1, 2, 3].map((k) => (
                  <line key={k} x1={cx - 92 + k * 26} y1={-14 + k * 9} x2={cx - 40 + k * 26} y2={6 + k * 9} stroke={INK.ink} strokeWidth={1} opacity={0.5} />
                ))}
              <g style={{ opacity: open ? 1 : 0, transition: "opacity .5s .6s" }}>
                <line x1={cx + w + 6} y1={0} x2={cx + w + 26} y2={0} stroke="var(--line-strong)" />
                <text x={cx + w + 34} y={-2} className="font-tight" fontSize="16" fontWeight={500} fill="var(--fg)">{l.label}</text>
                <text x={cx + w + 34} y={16} fontSize="12" fill="var(--muted)">{l.line}</text>
              </g>
            </g>
          );
        })}
        {open && !still() && (
          <circle r={6} fill={INK.pink} stroke="#fff" strokeWidth={2}>
            <animate attributeName="cx" values={`${cx};${cx}`} dur="4s" repeatCount="indefinite" />
            <animate attributeName="cy" values={`${top - h - 4};${last + 8};${last + 8}`} keyTimes="0;0.8;1" dur="4s" begin="1s" repeatCount="indefinite" />
            <animate attributeName="opacity" values="0;1;1;0" keyTimes="0;0.1;0.8;1" dur="4s" begin="1s" repeatCount="indefinite" />
          </circle>
        )}
      </svg>
      <div className="mt-1 flex flex-wrap gap-2">
        <Button variant="quiet" onClick={() => setOpen((o) => !o)}>
          {open ? "Fold it" : "Explode it"}
        </Button>
        <span className="self-center text-[12px] text-[var(--faint)]">Tap a layer.</span>
      </div>
    </div>
  );
}

// ── shared pieces ───────────────────────────────────────────────────────────

function Chapter({
  id,
  n,
  ink,
  kicker,
  title,
  thread,
  art,
  children,
  today,
  next,
}: {
  id: string;
  n: number;
  ink: string;
  kicker: string;
  title: string;
  thread?: string;
  art: React.ReactNode;
  children: React.ReactNode;
  today: string;
  next?: string;
}) {
  return (
    <section data-how={id} data-tour-section={id} className="scroll-mt-6 overflow-hidden rounded-[calc(var(--radius)+4px)] border border-[var(--line)] bg-[var(--card)]">
      <div className="h-1.5" style={{ background: ink }} />
      <div className="p-6 md:p-8">
        <div className="font-mono flex items-center gap-3 text-[11px] uppercase tracking-[0.16em] text-[var(--faint)]">
          <span className="flex h-6 w-6 items-center justify-center rounded-full text-[11px] font-medium" style={{ background: ink, color: ink === INK.yellow ? INK.ink : "#fff" }}>
            {n}
          </span>
          {kicker}
        </div>
        <h2 className="font-tight mt-3 text-2xl font-medium tracking-[-0.01em] md:text-[28px]">{title}</h2>
        {thread && (
          <p className="mt-3 max-w-prose border-l-2 pl-3 text-[14px] leading-relaxed text-[var(--fg)]" style={{ borderColor: ink }}>
            {thread}
          </p>
        )}
        <div className="mt-6 rounded-[var(--radius)] p-3 md:p-5" style={{ background: INK.paper }}>
          {art}
        </div>
        <div className="mt-6 grid gap-4 md:grid-cols-3">{children}</div>
        <div className="mt-6 flex flex-col gap-1.5 border-t border-[var(--line)] pt-4 text-[12.5px] leading-relaxed">
          <p>
            <span className="font-mono mr-2 text-[10.5px] uppercase tracking-[0.14em]" style={{ color: INK.green }}>Live today</span>
            <span className="text-[var(--muted)]">{today}</span>
          </p>
          {next && (
            <p>
              <span className="font-mono mr-2 text-[10.5px] uppercase tracking-[0.14em] text-[var(--faint)]">In the works</span>
              <span className="text-[var(--muted)]">{next}</span>
            </p>
          )}
        </div>
      </div>
    </section>
  );
}

function Point({ ink, title, children }: { ink: string; title: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="h-0.5 w-8" style={{ background: ink }} />
      <h3 className="font-tight mt-2.5 text-[15px] font-medium">{title}</h3>
      <p className="mt-1 text-[13px] leading-relaxed text-[var(--muted)]">{children}</p>
    </div>
  );
}

/** A dot running along a path, again and again. Nothing moves for people who ask for less motion. */
function Pulse({ path, ink, dur = 2.4, begin = 0, r = 4 }: { path: string; ink: string; dur?: number; begin?: number; r?: number }) {
  if (still()) return null;
  return (
    <circle r={r} fill={ink} visibility="hidden">
      <set attributeName="visibility" to="visible" begin={`${begin}s`} />
      <animateMotion path={path} dur={`${dur}s`} begin={`${begin}s`} repeatCount="indefinite" />
    </circle>
  );
}

// ── 1 · the ledger ──────────────────────────────────────────────────────────

function LedgerArt() {
  const nodes = Array.from({ length: 10 }, (_, k) => {
    const a = (k / 10) * Math.PI * 2 - Math.PI / 2;
    return { x: 260 + Math.cos(a) * 205, y: 125 + Math.sin(a) * 98 };
  });
  return (
    <svg viewBox="0 0 520 270" className="w-full" role="img" aria-label="Ten computers around one record, each holding a copy and checking the others">
      {nodes.map((p, k) => (
        <line key={`l${k}`} x1={p.x} y1={p.y} x2={260} y2={125} stroke={INK.ink} strokeOpacity={0.18} strokeDasharray="3 4" />
      ))}
      {nodes.map((p, k) => (
        <line key={`r${k}`} x1={p.x} y1={p.y} x2={nodes[(k + 1) % 10].x} y2={nodes[(k + 1) % 10].y} stroke={INK.ink} strokeOpacity={0.12} />
      ))}
      {nodes.map((p, k) => (
        <Pulse key={`p${k}`} path={`M${p.x},${p.y} L260,125`} ink={k % 3 === 0 ? INK.pink : k % 3 === 1 ? INK.blue : INK.ink} dur={2.2 + (k % 4) * 0.3} begin={k * 0.25} r={3} />
      ))}
      {/* the record: pages, the newest on top */}
      {[2, 1, 0].map((k) => (
        <g key={k} transform={`translate(${232 + k * 6},${92 - k * 6})`}>
          <rect width={56} height={68} rx={3} fill="#fff" stroke={INK.ink} strokeWidth={1.2} />
          {k === 0 && (
            <>
              <line x1={9} y1={16} x2={46} y2={16} stroke={INK.ink} strokeOpacity={0.5} />
              <line x1={9} y1={26} x2={40} y2={26} stroke={INK.ink} strokeOpacity={0.5} />
              <line x1={9} y1={36} x2={44} y2={36} stroke={INK.ink} strokeOpacity={0.5} />
              <circle cx={40} cy={54} r={7} fill={INK.pink} />
              <path d="M36.5 54 l2.5 2.5 l4.5 -5" stroke="#fff" strokeWidth={1.6} fill="none" />
            </>
          )}
        </g>
      ))}
      {nodes.map((p, k) => (
        <g key={`n${k}`} transform={`translate(${p.x - 15},${p.y - 11})`}>
          <rect width={30} height={20} rx={3} fill="#fff" stroke={INK.ink} strokeWidth={1.2} />
          <rect x={4} y={4} width={22} height={2.5} fill={k % 2 ? INK.blue : INK.pink} opacity={0.7} />
          <rect x={4} y={9} width={16} height={2.5} fill={INK.ink} opacity={0.25} />
          <rect x={-3} y={20} width={36} height={3} rx={1.5} fill={INK.ink} opacity={0.75} />
        </g>
      ))}
      <text x={260} y={262} textAnchor="middle" fontSize="11.5" fill={INK.ink} opacity={0.7}>
        Many computers keep the same copy and check each other.
      </text>
    </svg>
  );
}

// ── 2 · the money ───────────────────────────────────────────────────────────

function MoneyArt() {
  const box = (x: number, y: number, w: number, title: string, sub: string, ink: string, dark = false) => (
    <g transform={`translate(${x},${y})`}>
      <rect width={w} height={46} rx={6} fill={ink} />
      <text x={12} y={20} fontSize="13" fontWeight={600} fill={dark ? INK.ink : "#fff"} className="font-tight">{title}</text>
      <text x={12} y={36} fontSize="11" fill={dark ? INK.ink : "#fff"} opacity={0.85}>{sub}</text>
    </g>
  );
  const coin = (x: number, y: number, label: string) => (
    <g transform={`translate(${x},${y})`}>
      <circle r={17} fill="#fff" stroke={INK.ink} strokeWidth={1.2} />
      <text textAnchor="middle" y={4} fontSize="11" fontWeight={600} fill={INK.ink}>{label}</text>
    </g>
  );
  return (
    <svg viewBox="0 0 560 250" className="w-full" role="img" aria-label="Eighty pounds moving from Common Loaf: seventy-two to Alice, eight to the Network Rate, split three ways">
      <path id="m1" d="M130,70 C190,70 200,70 250,70" stroke={INK.ink} strokeOpacity={0.3} fill="none" />
      <path d="M290,70 C340,70 350,40 400,40" stroke={INK.ink} strokeOpacity={0.3} fill="none" />
      <path d="M290,70 C340,70 350,140 400,140" stroke={INK.ink} strokeOpacity={0.3} fill="none" />
      <path d="M470,166 C470,190 200,180 170,212" stroke={INK.ink} strokeOpacity={0.25} fill="none" />
      <path d="M470,166 C470,195 340,190 330,212" stroke={INK.ink} strokeOpacity={0.25} fill="none" />
      <path d="M470,166 C475,195 455,190 450,212" stroke={INK.ink} strokeOpacity={0.25} fill="none" />
      <Pulse path="M130,70 C190,70 200,70 250,70" ink={INK.yellow} r={6} dur={2.4} />
      <Pulse path="M290,70 C340,70 350,40 400,40" ink={INK.pink} r={6} dur={2.4} begin={1.2} />
      <Pulse path="M290,70 C340,70 350,140 400,140" ink={INK.blue} r={4} dur={2.4} begin={1.2} />
      <Pulse path="M470,166 C470,190 200,180 170,212" ink={INK.blue} r={3} dur={2} begin={2} />
      <Pulse path="M470,166 C470,195 340,190 330,212" ink={INK.blue} r={3} dur={2} begin={2.3} />
      <Pulse path="M470,166 C475,195 455,190 450,212" ink={INK.blue} r={3} dur={2} begin={2.6} />
      {box(10, 47, 120, "Common Loaf", "marks it useful", INK.green)}
      {coin(270, 70, "£80")}
      <text x={270} y={108} textAnchor="middle" fontSize="11" fill={INK.ink} opacity={0.7}>in seconds</text>
      {box(400, 17, 150, "Alice · £72", "paid that minute", INK.pink)}
      {box(400, 117, 150, "Network Rate · £8", "the 10%, split three ways", INK.blue)}
      {[
        [170, "£3.50", "the invite line"],
        [330, "£2.40", "running it"],
        [450, "£2.10", "her group's fund"],
      ].map(([x, a, l]) => (
        <g key={String(l)} transform={`translate(${x},212)`}>
          <text x={0} y={14} fontSize="13" fontWeight={600} fill={INK.ink} className="font-tight">{a}</text>
          <text x={0} y={29} fontSize="10.5" fill={INK.ink} opacity={0.7}>{l}</text>
        </g>
      ))}
    </svg>
  );
}

// ── 3 · the intelligence ────────────────────────────────────────────────────

const GROUP_DOTS = [
  { name: "Huxley", ink: INK.ink, shares: true },
  { name: "Halfmoon", ink: INK.blue, shares: true },
  { name: "Northside", ink: INK.green, shares: false },
  { name: "Common Loaf", ink: INK.yellow, shares: true },
  { name: "", ink: INK.pink, shares: true },
  { name: "", ink: INK.violet, shares: false },
  { name: "", ink: INK.blue, shares: true },
];

function MindArt() {
  return (
    <svg viewBox="0 0 560 260" className="w-full" role="img" aria-label="Each group has its own intelligence. Groups that agree send signed reasoning to one shared model, and the rest send nothing">
      {GROUP_DOTS.map((g, k) => {
        const x = 50 + k * 77;
        const path = `M${x},70 C${x},140 280,130 280,190`;
        return (
          <g key={k}>
            <path d={path} fill="none" stroke={g.shares ? g.ink : INK.ink} strokeOpacity={g.shares ? 0.45 : 0.18} strokeDasharray={g.shares ? undefined : "3 5"} />
            {g.shares && <Pulse path={path} ink={g.ink === INK.ink ? INK.pink : g.ink} r={3.5} dur={2.6} begin={k * 0.35} />}
          </g>
        );
      })}
      {GROUP_DOTS.map((g, k) => {
        const x = 50 + k * 77;
        return (
          <g key={`g${k}`} transform={`translate(${x},50)`}>
            <circle r={22} fill={g.ink} opacity={0.18} />
            <circle r={13} fill={g.ink} style={{ mixBlendMode: "multiply" }} />
            {!g.shares && (
              <g transform="translate(13,13)">
                <circle r={8} fill="#fff" stroke={INK.ink} strokeWidth={1} />
                <rect x={-3.5} y={-1} width={7} height={5.5} rx={1} fill={INK.ink} />
                <path d="M-2,-1 v-2 a2,2 0 0 1 4,0 v2" stroke={INK.ink} fill="none" strokeWidth={1.2} />
              </g>
            )}
            {g.name && (
              <text y={-30} textAnchor="middle" fontSize="11" fill={INK.ink} opacity={0.8}>{g.name}</text>
            )}
          </g>
        );
      })}
      <g transform="translate(280,210)">
        <ellipse rx={120} ry={30} fill={INK.violet} style={{ mixBlendMode: "multiply" }} />
        <ellipse rx={120} ry={30} fill="none" stroke={INK.violet} strokeOpacity={0.4} transform="scale(1.12)" />
        <text textAnchor="middle" y={-2} fontSize="14" fontWeight={600} fill="#fff" className="font-tight">The shared model</text>
        <text textAnchor="middle" y={14} fontSize="11" fill="#fff" opacity={0.85}>learns only from what people agreed to</text>
      </g>
    </svg>
  );
}

// ── 4 · how Decent is paid ──────────────────────────────────────────────────

function PaidArt() {
  const cols: { big: string; ink: string; title: string; line: string }[] = [
    { big: "0%", ink: INK.green, title: "of what you raise, give or spend", line: "The roof's £18,420 all went to the roof." },
    { big: "10%", ink: INK.blue, title: "of what you earn through the network", line: "Like Alice's answer. Capped, split three ways, and it ends if you leave." },
    { big: "£0", ink: INK.pink, title: "from selling your data", line: "Nothing here is sold or used to target anyone." },
  ];
  return (
    <div className="grid gap-3 md:grid-cols-3">
      {cols.map((c) => (
        <div key={c.big} className="rounded-[var(--radius)] bg-white p-4">
          <div className="font-tight text-[44px] font-medium leading-none tracking-[-0.03em]" style={{ color: c.ink }}>{c.big}</div>
          <div className="font-tight mt-2 text-[14px] font-medium text-[#1a1a1a]">{c.title}</div>
          <p className="mt-1.5 text-[12.5px] leading-relaxed text-[#1a1a1a]/70">{c.line}</p>
        </div>
      ))}
    </div>
  );
}

function RailsArt() {
  // Where the margin on money usually goes, and where it goes here.
  const row = (y: number, label: string, parts: { w: number; ink: string; t: string }[]) => {
    let x = 130;
    return (
      <g transform={`translate(0,${y})`}>
        <text x={0} y={18} fontSize="12" fontWeight={600} fill={INK.ink} className="font-tight">{label}</text>
        {parts.map((p) => {
          const at = x;
          x += p.w;
          return (
            <g key={p.t}>
              <rect x={at} y={0} width={p.w - 3} height={28} rx={3} fill={p.ink} />
              <text x={at + 8} y={18} fontSize="11" fill={p.ink === INK.yellow ? INK.ink : "#fff"}>{p.t}</text>
            </g>
          );
        })}
      </g>
    );
  };
  return (
    <svg viewBox="0 0 560 120" className="mt-4 w-full" role="img" aria-label="The margin a bank and card company usually keep, shared here between the card network and Decent">
      {row(8, "The usual way", [
        { w: 210, ink: "#9a9a9a", t: "the bank keeps the interest" },
        { w: 210, ink: "#b8b8b8", t: "card companies keep the fees" },
      ])}
      {row(56, "Here", [
        { w: 210, ink: INK.yellow, t: "reserve interest, shared" },
        { w: 210, ink: INK.blue, t: "card fees, shared" },
      ])}
      <text x={0} y={112} fontSize="11" fill={INK.ink} opacity={0.7}>Same price to you. The margin pays for the network, not a bank.</text>
    </svg>
  );
}

// ── 5 · why it matters ──────────────────────────────────────────────────────

function Constellation() {
  const { nodes, edges } = useMemo(() => {
    let s = 7;
    const rnd = () => ((s = (s * 16807) % 2147483647) / 2147483647);
    const inks = [INK.pink, INK.blue, INK.yellow, INK.violet, INK.green, INK.ink];
    const nodes = Array.from({ length: 64 }, (_, k) => ({
      x: 20 + rnd() * 520,
      y: 16 + rnd() * 188,
      r: 3 + rnd() * 6,
      ink: inks[k % inks.length],
      at: k * 0.06,
    }));
    const edges: [number, number][] = [];
    nodes.forEach((a, i) => {
      const near = nodes
        .map((b, j) => ({ j, d: (a.x - b.x) ** 2 + (a.y - b.y) ** 2 }))
        .filter((n) => n.j < i)
        .sort((p, q) => p.d - q.d)
        .slice(0, 2);
      near.forEach((n) => edges.push([i, n.j]));
    });
    return { nodes, edges };
  }, []);
  const calm = still();
  return (
    <svg viewBox="0 0 560 220" className="w-full" role="img" aria-label="Many groups, linked to each other, appearing one by one">
      <style>{`@keyframes how-in{from{opacity:0;transform:scale(.2)}to{opacity:1;transform:scale(1)}}`}</style>
      {edges.map(([i, j], k) => (
        <line
          key={k}
          x1={nodes[i].x}
          y1={nodes[i].y}
          x2={nodes[j].x}
          y2={nodes[j].y}
          stroke={INK.ink}
          strokeOpacity={0.16}
          style={calm ? undefined : { opacity: 0, animation: `how-in .6s ${nodes[i].at + 0.2}s forwards` }}
        />
      ))}
      {nodes.map((n, k) => (
        <circle
          key={k}
          cx={n.x}
          cy={n.y}
          r={n.r}
          fill={n.ink}
          style={{
            mixBlendMode: "multiply",
            transformOrigin: `${n.x}px ${n.y}px`,
            ...(calm ? {} : { opacity: 0, animation: `how-in .5s ${n.at}s forwards` }),
          }}
        />
      ))}
    </svg>
  );
}

const CONTRAST: [string, string][] = [
  ["Someone else decides what's done with it", "You decide, piece by piece"],
  ["The value leaves, and nobody tells you", "Value can come back to whoever made it"],
  ["You can't check what was taken", "Anyone can check the record"],
  ["Your conversations sit on a platform's servers", "Your group's chat runs on its own server"],
  ["Each person alone", "Groups set their terms together"],
];

// ── 4 · the conversations ───────────────────────────────────────────────────

function TalkArt() {
  const group = (x: number, name: string, ink: string) => (
    <g transform={`translate(${x},150)`}>
      {[0, 1, 2, 3, 4].map((k) => {
        const a = (k / 5) * Math.PI * 2 - Math.PI / 2;
        const px = Math.cos(a) * 68, py = Math.sin(a) * 50;
        return (
          <g key={k}>
            <line x1={0} y1={0} x2={px} y2={py} stroke={ink} strokeOpacity={0.35} />
            <circle cx={px} cy={py} r={9} fill={ink} opacity={0.85} style={{ mixBlendMode: "multiply" }} />
          </g>
        );
      })}
      <rect x={-34} y={-20} width={68} height={40} rx={6} fill="#fff" stroke={INK.ink} strokeWidth={1.3} />
      <rect x={-26} y={-12} width={52} height={3} fill={ink} />
      <rect x={-26} y={-5} width={36} height={3} fill={INK.ink} opacity={0.25} />
      <text y={14} textAnchor="middle" fontSize="10" fontWeight={600} fill={INK.ink}>{name}</text>
    </g>
  );
  const link = "M144,150 C230,150 330,150 416,150";
  return (
    <svg viewBox="0 0 560 270" className="w-full" role="img" aria-label="Two groups, each with its own chat server, talking directly. The platform that would usually sit in the middle is crossed out">
      <g transform="translate(280,42)" opacity={0.55}>
        <rect x={-70} y={-20} width={140} height={40} rx={6} fill="none" stroke={INK.ink} strokeDasharray="4 4" />
        <text y={4} textAnchor="middle" fontSize="11.5" fill={INK.ink}>a platform in the middle</text>
        <line x1={-78} y1={-26} x2={78} y2={26} stroke={INK.pink} strokeWidth={2.5} />
      </g>
      <path d={link} stroke={INK.ink} strokeOpacity={0.35} fill="none" />
      <Pulse path={link} ink={INK.pink} r={4.5} dur={2.2} />
      <Pulse path="M416,150 C330,150 230,150 144,150" ink={INK.blue} r={4.5} dur={2.2} begin={1.1} />
      {group(110, "Huxley", INK.pink)}
      {group(450, "Halfmoon", INK.blue)}
      <text x={280} y={262} textAnchor="middle" fontSize="11.5" fill={INK.ink} opacity={0.7}>
        Each group's chat runs on its own server. Servers talk to each other directly.
      </text>
    </svg>
  );
}

// ── the page ────────────────────────────────────────────────────────────────

function Panel() {
  return (
    <Page>
      <PageHeader
        icon={Lightbulb}
        eyebrow="How it works"
        title="What's underneath, and why it matters"
        lede="Follow one thing Alice did, her £80 answer to Common Loaf, all the way down."
      />
      <PageBody width="wide">
        <section className="grid items-center gap-6 md:grid-cols-[1.4fr_1fr]">
          <Stack />
          <div className="space-y-3 text-[14px] leading-relaxed text-[var(--muted)]">
            <p>
              <span className="font-medium text-[var(--fg)]">The app is the top layer.</span> Nothing under it is borrowed from a
              bank, a big tech company or a crypto exchange.
            </p>
            <p>No coin to buy, and nothing sold about you.</p>
            <Button variant="quiet" icon={ArrowDown} onClick={() => go("ledger")}>
              Start at the foot
            </Button>
          </div>
        </section>

        <Chapter
          id="ledger"
          n={1}
          ink={INK.ink}
          kicker="The ledger"
          title="A record nobody can quietly change"
          thread="Alice signed her answer. The ledger keeps a page saying it's hers, when she gave it and who may use it."
          art={<LedgerArt />}
          today="Memberships are on a public ledger. Joining with a passkey writes the first page."
          next="Every contribution kept the same way."
        >
          <Point ink={INK.ink} title="No mining">
            No electricity burned racing to solve puzzles. The computers just check each other.
          </Point>
          <Point ink={INK.pink} title="Nothing to speculate on">
            You never buy a coin. Your group pays the small fees in the same digital money.
          </Point>
          <Point ink={INK.blue} title="Built for groups">
            Memberships, votes and shared accounts are built in, not bolted on.
          </Point>
        </Chapter>

        <Chapter
          id="money"
          n={2}
          ink={INK.yellow}
          kicker="The money"
          title="Digital money, one for one"
          thread="Common Loaf marked the answer useful. Its £80 moved in seconds: £72 to Alice, £8 to the Network Rate."
          art={<MoneyArt />}
          today="Paid questions have settled in digital dollars, so far only between our own accounts."
          next="Payments, cards and a treasury for every group, and digital pounds."
        >
          <Point ink={INK.yellow} title="Backed one for one">
            A regulated company issues each digital dollar and holds a real one in reserve. Its price doesn't swing.
          </Point>
          <Point ink={INK.pink} title="Moves like a message">
            Seconds, any hour, any border, for a fraction of a penny. So even 50p up an invite line is worth sending.
          </Point>
          <Point ink={INK.blue} title="Pounds in the works">
            The demo shows pounds. The digital money is in dollars today.
          </Point>
        </Chapter>

        <Chapter
          id="intelligence"
          n={3}
          ink={INK.violet}
          kicker="The intelligence"
          title="Intelligence we run together"
          thread="Alice marked her answer “members, but not for training AI”. It helped Common Loaf and taught the shared model nothing."
          art={<MindArt />}
          today="The sketch at the end of this tour runs on our own model and server. Nothing you type is kept."
          next="Every agent on machines the network runs, and a shared model trained only on what groups agree to share. Both in testing."
        >
          <Point ink={INK.violet} title="Each group's own">
            It reads only your group's documents and record, and answers only its members.
          </Point>
          <Point ink={INK.blue} title="Kept private">
            Built to run on machines the network shares, not rented from a big AI company. What you ask is never sold.
          </Point>
          <Point ink={INK.pink} title="Smarter from your reasoning">
            Every piece it learns from is signed, so it's clear who taught it what, and who could share in what it earns.
          </Point>
        </Chapter>

        <Chapter
          id="talk"
          n={4}
          ink={INK.blue}
          kicker="The conversations"
          title="No platform in the middle"
          thread="Alice talked her answer through with Bob first, in Huxley's chat. That conversation lives on Huxley's server, nobody else's."
          art={<TalkArt />}
          today="Each group gets its own chat server, opened with its passkey, and calls run on it too. We host the machines for now."
          next="End-to-end encryption in the app, and groups running their own machine if they want one."
        >
          <Point ink={INK.blue} title="Your group's own server">
            Chat and calls sit under your group's name, not a tech company's. Nothing is mined for adverts or sold.
          </Point>
          <Point ink={INK.pink} title="An open standard">
            It speaks Matrix, an open way for chat servers to talk. Any Matrix app works, and you can bring an account you already have.
          </Point>
          <Point ink={INK.yellow} title="Easy to leave">
            Your group can move its server elsewhere, history and all.
          </Point>
        </Chapter>

        <Chapter
          id="paid"
          n={5}
          ink={INK.green}
          kicker="How Decent is paid"
          title="We don't take a cut of your money"
          art={
            <>
              <PaidArt />
              <RailsArt />
            </>
          }
          today="The 10% Network Rate is agreed. Its three-way split is still open."
          next="The card and treasury, where a bank's margin pays for the network instead."
        >
          <Point ink={INK.green} title="Who we are">
            Decent incubates groups like Huxley and sets you up, from nothing to a company, charity or co-op.
          </Point>
          <Point ink={INK.yellow} title="Where our money comes from">
            Reserve interest and card fees a bank would keep, and a share of the 10%.
          </Point>
          <Point ink={INK.blue} title="What we never charge">
            No joining fee, nothing paid upward, no cut of gifts or investment. The 10% ends if a group leaves.
          </Point>
        </Chapter>

        <section data-how="why" data-tour-section="why" className="scroll-mt-6 overflow-hidden rounded-[calc(var(--radius)+4px)] bg-[#1a1a1a] text-white">
          <div className="p-6 md:p-10">
            <div className="font-mono text-[11px] uppercase tracking-[0.16em] text-white/50">6 · Why it matters</div>
            <h2 className="font-tight mt-3 max-w-2xl text-[28px] font-medium leading-tight tracking-[-0.015em] md:text-[36px]">
              The most valuable thing in the world now is original judgement that people agreed to share.
            </h2>
            <p className="mt-4 max-w-2xl text-[15px] leading-relaxed text-white/75">
              Most of it is taken without asking, and the people who made it get nothing back. Here, each group keeps its record
              and sets its own terms.
            </p>
            <div className="mt-6 rounded-[var(--radius)] p-2" style={{ background: INK.paper }}>
              <Constellation />
            </div>
            <div className="mt-6 grid gap-px overflow-hidden rounded-[var(--radius)] bg-white/15 md:grid-cols-2">
              <div className="font-mono bg-[#1a1a1a] px-4 py-2.5 text-[10.5px] uppercase tracking-[0.14em] text-white/50">When your data is sold</div>
              <div className="font-mono hidden bg-[#1a1a1a] px-4 py-2.5 text-[10.5px] uppercase tracking-[0.14em] md:block" style={{ color: INK.yellow }}>Here</div>
              {CONTRAST.map(([a, b]) => (
                <div key={a} className="contents">
                  <div className="bg-[#1a1a1a] px-4 py-3 text-[13.5px] text-white/55 line-through decoration-white/25">{a}</div>
                  <div className="bg-[#1a1a1a] px-4 py-3 text-[13.5px] text-white">{b}</div>
                </div>
              ))}
            </div>
            <p className="font-tight mt-8 max-w-2xl text-[22px] leading-snug md:text-[26px]">
              An intelligence that is public, answers to the people who made it, and could pay them for what it learns.
            </p>
            <p className="mt-3 text-[12.5px] text-white/50">
              Figures here are samples. Nobody is paid through the network today.
            </p>
          </div>
        </section>

        <section data-how="ask" className="rounded-[calc(var(--radius)+4px)] border border-[var(--line-strong)] p-6 md:p-8">
          <h2 className="font-tight text-xl font-medium">What are you looking for?</h2>
          <p className="mt-1.5 max-w-prose text-[14px] leading-relaxed text-[var(--muted)]">
            Describe your group in a sentence and this demo becomes yours.
          </p>
          <div className="mt-4 max-w-xl">
            <TailorForm />
          </div>
          <div className="mt-5">
            <Button icon={Mail} onClick={askForLogins}>
              {askLabel}
            </Button>
          </div>
        </section>
      </PageBody>
    </Page>
  );
}

export const howSurface: MurmurModule = {
  id: "how",
  title: "How it works",
  tagline: "What's underneath the app, and why it matters",
  icon: Lightbulb,
  order: 0,
  kind: "core",
  Panel,
};
