"use client";
import { useEffect, useState } from "react";
import { cx } from "./ui";

/** Friendly radio mascot. state: idle (slow blink + float), live (bobs to a beat), talking (antenna pulses, grille animates). */
export function Mascot({ state = "idle", className }: { state?: "idle" | "live" | "talking"; className?: string }) {
  const [blink, setBlink] = useState(false);
  useEffect(() => {
    let t: ReturnType<typeof setTimeout>;
    const loop = () => {
      t = setTimeout(() => { setBlink(true); setTimeout(() => setBlink(false), 140); loop(); }, (state === "idle" ? 3200 : 2200) + Math.random() * 3000);
    };
    loop();
    return () => clearTimeout(t);
  }, [state]);
  return (
    <svg viewBox="0 0 120 120" className={cx("mascot", `mascot-${state}`, blink && "is-blink", className)} role="img" aria-label="MyRJ mascot">
      <g className="m-body">
        <g transform="rotate(-15 60 64)">
          <line x1="78" y1="36" x2="82" y2="22" stroke="#f3efe8" strokeWidth="2.5" strokeLinecap="round" />
          <circle className="m-tip" cx="82.6" cy="20" r="3.4" fill="#f3efe8" />
          <rect x="14" y="36" width="92" height="58" rx="29" fill="#f3efe8" />
        </g>
        <g className="m-eyes" fill="#141212">
          <rect x="66" y="45" width="7" height="17" rx="3.5" transform="rotate(-22 69.5 53.5)" />
          <rect x="83" y="40" width="7" height="17" rx="3.5" transform="rotate(-22 86.5 48.5)" />
        </g>
      </g>
    </svg>
  );
}
