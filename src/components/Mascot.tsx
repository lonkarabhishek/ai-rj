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
    <svg viewBox="0 0 120 120" className={cx("mascot", `mascot-${state}`, blink && "is-blink", className)} role="img" aria-label="MyRJ radio mascot">
      <defs>
        <linearGradient id="mbody" x1="0" y1="0" x2="0.4" y2="1"><stop offset="0" stopColor="#ffa494" /><stop offset="1" stopColor="#ff7a6b" /></linearGradient>
      </defs>
      <g className="m-body">
        <line x1="74" y1="40" x2="86" y2="17" stroke="#ff8a7a" strokeWidth="6" strokeLinecap="round" />
        <circle className="m-tip" cx="87" cy="15" r="7" fill="#7fe0c0" />
        <rect x="16" y="36" width="88" height="70" rx="30" fill="url(#mbody)" />
        <g className="m-eyes" fill="#1a1312">
          <rect x="40" y="58" width="9" height="15" rx="4.5" />
          <rect x="62" y="58" width="9" height="15" rx="4.5" />
        </g>
        <circle cx="88" cy="88" r="5" fill="#fff" opacity=".35" />
      </g>
    </svg>
  );
}
