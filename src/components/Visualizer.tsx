"use client";
import { useEffect, useRef } from "react";
import { cx } from "./ui";

const BARS = 22;
// Deterministic "random" timing per bar so server and client render the same markup (no hydration mismatch).
const seed = (i: number) => { const x = Math.sin((i + 1) * 12.9898) * 43758.5453; return x - Math.floor(x); };

/**
 * Music visualizer. Songs play inside Spotify's and YouTube's own players, whose audio a web page is not allowed to read,
 * so during songs the bars dance on pure CSS (GPU transforms, paused with the music). When the RJ's voice level is available
 * (`getLevel`), the bars follow the real signal instead.
 */
export function Visualizer({ active, paused, getLevel, className }: { active: boolean; paused?: boolean; getLevel?: () => number | null; className?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el || !getLevel || !active || paused) return;
    if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return;
    let raf = 0, last = 0, reactive = false;
    const bars = Array.from(el.children) as HTMLElement[];
    const tick = (t: number) => {
      raf = requestAnimationFrame(tick);
      if (t - last < 50 || document.hidden) return; // ~20 fps is plenty and easy on the battery
      last = t;
      const lvl = getLevel();
      if (lvl === null) { if (reactive) { reactive = false; el.dataset.reactive = "0"; bars.forEach((b) => { b.style.transform = ""; }); } return; }
      if (!reactive) { reactive = true; el.dataset.reactive = "1"; }
      const mid = (bars.length - 1) / 2;
      bars.forEach((b, i) => { const shape = 1 - Math.abs(i - mid) / (mid + 1) * 0.55; b.style.transform = `scaleY(${Math.max(0.12, Math.min(1, lvl * shape * (0.7 + seed(i + Math.floor(t / 120)) * 0.6))).toFixed(3)})`; });
    };
    raf = requestAnimationFrame(tick);
    return () => { cancelAnimationFrame(raf); el.dataset.reactive = "0"; bars.forEach((b) => { b.style.transform = ""; }); };
  }, [active, paused, getLevel]);
  return (
    <div ref={ref} aria-hidden data-testid="visualizer" className={cx("viz", active && "is-on", paused && "is-paused", className)}>
      {Array.from({ length: BARS }, (_, i) => (
        <span key={i} style={{ animationDuration: `${(0.7 + seed(i) * 0.9).toFixed(2)}s`, animationDelay: `${(-seed(i + 40) * 1.2).toFixed(2)}s` }} />
      ))}
    </div>
  );
}
