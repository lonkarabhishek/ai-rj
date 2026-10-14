"use client";
import { useEffect, useRef, useState } from "react";
import { cx } from "./ui";

type State = "idle" | "live" | "talking";
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

/**
 * Off-white pill mascot. Always: calm sway + random blinks + glances (follows cursor / last tap).
 * Talking: body squash-stretch, eye lift and antenna glow driven by getLevel() (0..1 voice amplitude),
 * or a soft syllable-like rhythm when getLevel returns null (browser TTS fallback).
 */
export function Mascot({ state = "idle", className, getLevel }: { state?: State; className?: string; getLevel?: () => number | null }) {
  const [blink, setBlink] = useState(false);
  const [happy, setHappy] = useState(false);
  const svgRef = useRef<SVGSVGElement>(null);
  const voiceRef = useRef<SVGGElement>(null);
  const eyesRef = useRef<SVGGElement>(null);
  const tipRef = useRef<SVGCircleElement>(null);
  const stateRef = useRef(state); stateRef.current = state;
  const levelRef = useRef(getLevel); levelRef.current = getLevel;

  // random blinks (calm), occasional happy squint while talking
  useEffect(() => {
    let t: ReturnType<typeof setTimeout>;
    const loop = () => {
      t = setTimeout(() => {
        if (stateRef.current === "talking" && Math.random() < 0.25) { setHappy(true); setTimeout(() => setHappy(false), 700 + Math.random() * 500); }
        else { setBlink(true); setTimeout(() => setBlink(false), 130); }
        loop();
      }, 2800 + Math.random() * 3500);
    };
    loop();
    return () => clearTimeout(t);
  }, []);

  useEffect(() => {
    if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return;
    let raf = 0, lvl = 0, ex = 0, ey = 0, tx = 0, ty = 0, pointerUntil = 0, glanceUntil = 0;
    let nextGlance = performance.now() + 4000 + Math.random() * 6000;
    const aim = (cx: number, cy: number, hold: number) => {
      const r = svgRef.current?.getBoundingClientRect(); if (!r) return;
      const dx = cx - (r.left + r.width / 2), dy = cy - (r.top + r.height / 2), d = Math.hypot(dx, dy) || 1;
      const k = Math.min(1, d / 300);
      tx = (dx / d) * 3.2 * k; ty = (dy / d) * 2.4 * k; pointerUntil = performance.now() + hold;
    };
    const onMove = (e: PointerEvent) => { if (e.pointerType === "mouse") aim(e.clientX, e.clientY, 2500); };
    const onDown = (e: PointerEvent) => { if (e.pointerType !== "mouse") aim(e.clientX, e.clientY, 1600); };
    window.addEventListener("pointermove", onMove); window.addEventListener("pointerdown", onDown);
    const tick = (now: number) => {
      // gaze: pointer > glance > rest
      if (now > pointerUntil) {
        if (now > nextGlance) {
          const a = Math.random() * Math.PI * 2; tx = Math.cos(a) * 2.6; ty = Math.sin(a) * 1.8;
          if (Math.random() < 0.35) { tx = -1.2; ty = 1; } // toward the viewer
          glanceUntil = now + 700 + Math.random() * 900; nextGlance = now + 4000 + Math.random() * 6000;
        } else if (now > glanceUntil) { tx = 0; ty = 0; }
      }
      // voice level
      const talking = stateRef.current === "talking";
      let target = 0;
      if (talking) {
        const real = levelRef.current?.();
        target = real ?? Math.max(0, Math.sin(now / 95) * 0.5 + Math.sin(now / 37) * 0.25 + 0.2); // syllable-ish rhythm
      }
      lvl = lerp(lvl, Math.min(1, target), target > lvl ? 0.35 : 0.12);
      ex = lerp(ex, tx, 0.08); ey = lerp(ey, ty - lvl * 1.6, 0.12);
      const sy = 1 + lvl * 0.04, sx = 1 - lvl * 0.025;
      voiceRef.current?.setAttribute("transform", `translate(60 94) scale(${sx.toFixed(4)} ${sy.toFixed(4)}) translate(-60 -94)`);
      eyesRef.current?.setAttribute("transform", `translate(${ex.toFixed(2)} ${ey.toFixed(2)})`);
      if (tipRef.current) {
        tipRef.current.setAttribute("r", (3.4 + lvl * 1.6).toFixed(2));
        tipRef.current.style.filter = lvl > 0.05 ? `drop-shadow(0 0 ${(2 + lvl * 6).toFixed(1)}px rgba(243,239,232,${(0.4 + lvl * 0.5).toFixed(2)}))` : "";
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => { cancelAnimationFrame(raf); window.removeEventListener("pointermove", onMove); window.removeEventListener("pointerdown", onDown); };
  }, []);

  return (
    <svg ref={svgRef} viewBox="0 0 120 120" className={cx("mascot", `mascot-${state}`, blink && "is-blink", happy && "is-happy", className)} role="img" aria-label="MyRJ mascot">
      <g className="m-body">
        <g ref={voiceRef}>
          <g transform="rotate(-15 60 64)">
            <line x1="78" y1="36" x2="82" y2="22" stroke="#f3efe8" strokeWidth="2.5" strokeLinecap="round" />
            <circle ref={tipRef} className="m-tip" cx="82.6" cy="20" r="3.4" fill="#f3efe8" />
            <rect x="14" y="36" width="92" height="58" rx="29" fill="#f3efe8" />
          </g>
          <g ref={eyesRef}>
            <g className="m-eyes" fill="#141212">
              <rect x="66" y="45" width="7" height="17" rx="3.5" transform="rotate(-22 69.5 53.5)" />
              <rect x="83" y="40" width="7" height="17" rx="3.5" transform="rotate(-22 86.5 48.5)" />
            </g>
          </g>
        </g>
      </g>
    </svg>
  );
}
