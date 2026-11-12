import { useEffect, useRef, useState } from "react";

/**
 * The opening a window plays before the app shows, chosen per edition
 * (`edition.intro`). Birdbrain's is a murmuration: a flock wheels on white,
 * then settles into the edition's mark. Plays once per launch, a tap skips it,
 * and anyone who asks their system for reduced motion never sees it.
 */
export type IntroKind = "murmuration";

const FLOCK_MS = 1700;
const SETTLE_MS = 1100;
const HOLD_MS = 350;
const FADE_MS = 450;
const SEEN = "intro.seen";

export function Intro({ kind, logo }: { kind: IntroKind; logo?: string }) {
  const [done, setDone] = useState(() => !shouldPlay());
  const [fading, setFading] = useState(false);
  const canvas = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    if (done || kind !== "murmuration" || !canvas.current) return;
    sessionStorage.setItem(SEEN, "1");
    const stop = murmuration(canvas.current, logo, () => setFading(true));
    return stop;
  }, [done, kind, logo]);

  useEffect(() => {
    if (!fading) return;
    const t = setTimeout(() => setDone(true), FADE_MS);
    return () => clearTimeout(t);
  }, [fading]);

  if (done) return null;
  return (
    <div
      onClick={() => setFading(true)}
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 1000,
        background: "var(--bg, #fff)",
        opacity: fading ? 0 : 1,
        transition: `opacity ${FADE_MS}ms ease`,
        cursor: "pointer",
      }}
    >
      <canvas ref={canvas} style={{ width: "100%", height: "100%", display: "block" }} />
    </div>
  );
}

function shouldPlay() {
  if (typeof window === "undefined") return false;
  if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return false;
  return sessionStorage.getItem(SEEN) !== "1";
}

interface Bird {
  x: number;
  y: number;
  vx: number;
  vy: number;
  phase: number;
  arrival: number;
  tx: number;
  ty: number;
}

function murmuration(el: HTMLCanvasElement, logo: string | undefined, onEnd: () => void) {
  const ctx = el.getContext("2d")!;
  const dpr = window.devicePixelRatio || 1;
  const w = el.clientWidth;
  const h = el.clientHeight;
  el.width = w * dpr;
  el.height = h * dpr;
  ctx.scale(dpr, dpr);

  const n = Math.round(Math.min(700, Math.max(350, (w * h) / 1400)));
  const cx = w / 2;
  const cy = h / 2;
  const birds: Bird[] = Array.from({ length: n }, () => {
    const a = Math.random() * Math.PI * 2;
    const r = Math.random() * Math.min(w, h) * 0.25;
    return {
      x: cx + Math.cos(a) * r - w * 0.15,
      y: cy + Math.sin(a) * r * 0.5,
      vx: 2 + Math.random(),
      vy: (Math.random() - 0.5) * 2,
      phase: Math.random() * Math.PI * 2,
      arrival: Math.random() * 450 - 250,
      tx: cx,
      ty: cy,
    };
  });

  // Where the flock lands: points sampled from the mark, or a ring if it has none.
  const size = Math.min(w, h) * 0.32;
  const ring = () =>
    birds.forEach((b, i) => {
      const a = (i / n) * Math.PI * 2;
      b.tx = cx + Math.cos(a) * size * 0.4;
      b.ty = cy + Math.sin(a) * size * 0.4;
    });
  ring();
  let mark: HTMLImageElement | null = null;
  if (logo) {
    const img = new Image();
    img.onload = () => {
      const pts = sample(img, size);
      if (!pts.length) return;
      mark = img;
      shuffle(birds).forEach((b, i) => {
        const p = pts[Math.floor((i * pts.length) / n)];
        b.tx = cx - size / 2 + p[0];
        b.ty = cy - size / 2 + p[1];
      });
    };
    img.src = logo;
  }

  const start = performance.now();
  let raf = 0;
  let ended = false;
  let previous = start;

  const frame = (now: number) => {
    const t = now - start;
    const dt = Math.min(2, (now - previous) / (1000 / 60));
    previous = now;
    const settle = clamp((t - FLOCK_MS) / SETTLE_MS);
    const pull = ease(settle);

    if (settle < 1) flock(birds, w, h, t, dt);

    const reveal = clamp((t - FLOCK_MS - SETTLE_MS * 0.7) / (SETTLE_MS * 0.3 + HOLD_MS));

    ctx.clearRect(0, 0, w, h);
    ctx.fillStyle = "#0a0a0a";
    ctx.globalAlpha = 1 - ease(reveal);
    const r = 1.1 + (1 - pull) * 0.5;
    for (const b of birds) {
      ctx.beginPath();
      ctx.ellipse(b.x, b.y, r * 1.6, r, Math.atan2(b.vy, b.vx), 0, Math.PI * 2);
      ctx.fill();
    }

    // Colour is the consequence: the mark arrives once the flock has landed.
    if (mark && reveal > 0) {
      ctx.globalAlpha = ease(reveal);
      ctx.filter = "contrast(1.12)";
      ctx.drawImage(mark, cx - size / 2, cy - size / 2, size, size);
      ctx.filter = "none";
      ctx.globalAlpha = 1;
    }

    if (!ended && t > FLOCK_MS + SETTLE_MS + HOLD_MS) {
      ended = true;
      onEnd();
    }
    raf = requestAnimationFrame(frame);
  };
  raf = requestAnimationFrame(frame);
  return () => cancelAnimationFrame(raf);
}

/** Boids on a coarse grid: cohesion, alignment, separation, and a wandering
 *  centre the flock is drawn round, which gives the folding, pulsing shape. */
function flock(birds: Bird[], w: number, h: number, t: number, dt: number) {
  const cell = 40;
  const grid = new Map<number, Bird[]>();
  const key = (x: number, y: number) => Math.floor(x / cell) * 10007 + Math.floor(y / cell);
  for (const b of birds) {
    const k = key(b.x, b.y);
    const list = grid.get(k);
    if (list) list.push(b);
    else grid.set(k, [b]);
  }
  const ax = w / 2 + Math.cos(t / 520) * w * 0.22;
  const ay = h / 2 + Math.sin(t / 380) * h * 0.16;

  const velocities = new Map(birds.map(b => [b, [b.vx, b.vy]]));
  for (const b of birds) {
    const gather = ease(clamp((t - FLOCK_MS - b.arrival) / (SETTLE_MS - b.arrival)));
    const oldVx = b.vx, oldVy = b.vy;
    let cxs = 0, cys = 0, vxs = 0, vys = 0, sx = 0, sy = 0, c = 0;
    const gx = Math.floor(b.x / cell);
    const gy = Math.floor(b.y / cell);
    for (let i = -1; i <= 1; i++)
      for (let j = -1; j <= 1; j++) {
        const list = grid.get((gx + i) * 10007 + gy + j);
        if (!list) continue;
        for (const o of list) {
          if (o === b) continue;
          const dx = o.x - b.x;
          const dy = o.y - b.y;
          const d2 = dx * dx + dy * dy;
          if (d2 > cell * cell) continue;
          cxs += o.x; cys += o.y; vxs += velocities.get(o)![0]; vys += velocities.get(o)![1]; c++;
          if (d2 < 64) { sx -= dx / (d2 + 1); sy -= dy / (d2 + 1); }
        }
      }
    if (c) {
      b.vx += (cxs / c - b.x) * 0.004 + (vxs / c - b.vx) * 0.06;
      b.vy += (cys / c - b.y) * 0.004 + (vys / c - b.vy) * 0.06;
    }
    const wave = t / 700 + b.phase + b.x / 180;
    b.vx += sx * 1.4 + (ax - b.x) * 0.0009 + Math.cos(wave) * 0.12;
    b.vy += sy * 1.4 + (ay - b.y) * 0.0009 + Math.sin(wave * 1.3) * 0.16;
    b.vx = oldVx + (b.vx - oldVx) * (1 - gather) * dt;
    b.vy = oldVy + (b.vy - oldVy) * (1 - gather) * dt;
    b.vx += ((b.tx - b.x) * 0.045 - b.vx * 0.38) * gather * dt;
    b.vy += ((b.ty - b.y) * 0.045 - b.vy * 0.38) * gather * dt;
    const s = Math.hypot(b.vx, b.vy);
    const max = 4.2 + gather * 10, min = 2.2 * (1 - gather);
    const k = s > max ? max / s : s < min ? min / (s || 1) : 1;
    b.vx *= k;
    b.vy *= k;
  }
  for (const b of birds) {
    b.x += b.vx * dt;
    b.y += b.vy * dt;
  }
}

function sample(img: HTMLImageElement, size: number): [number, number][] {
  const c = document.createElement("canvas");
  c.width = c.height = Math.round(size);
  const g = c.getContext("2d")!;
  g.drawImage(img, 0, 0, size, size);
  const { data } = g.getImageData(0, 0, c.width, c.height);
  const pts: [number, number][] = [];
  const step = Math.max(2, Math.round(size / 90));
  for (let y = 0; y < c.height; y += step)
    for (let x = 0; x < c.width; x += step) {
      const i = (y * c.width + x) * 4;
      const ink = data[i + 3] > 128 && Math.min(data[i], data[i + 1], data[i + 2]) < 235;
      if (ink) pts.push([x, y]);
    }
  return pts;
}

function shuffle<T>(a: T[]) {
  const b = [...a];
  for (let i = b.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [b[i], b[j]] = [b[j], b[i]];
  }
  return b;
}

const clamp = (v: number) => Math.max(0, Math.min(1, v));
const ease = (v: number) => v * v * (3 - 2 * v);
