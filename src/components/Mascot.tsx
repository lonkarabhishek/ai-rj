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
      <g className="m-body">
        {/* antenna */}
        <line x1="78" y1="34" x2="90" y2="12" stroke="#f3efe8" strokeWidth="3" strokeLinecap="round" />
        <circle className="m-tip" cx="90" cy="12" r="5" fill="#ff8a7a" />
        {/* body */}
        <rect x="18" y="32" width="84" height="66" rx="22" fill="#f3efe8" />
        <rect x="18" y="32" width="84" height="66" rx="22" fill="url(#mshade)" />
        {/* face panel */}
        <rect x="27" y="41" width="50" height="48" rx="15" fill="#1a1715" />
        <g className="m-eyes">
          <ellipse cx="41" cy="58" rx="4" ry="4.6" fill="#f3efe8" />
          <ellipse cx="63" cy="58" rx="4" ry="4.6" fill="#f3efe8" />
        </g>
        <circle cx="34" cy="68" r="3" fill="#ff8a7a" opacity=".55" />
        <circle cx="70" cy="68" r="3" fill="#ff8a7a" opacity=".55" />
        {/* speaker-grille smile */}
        <g className="m-grille" fill="#7fe0c0">
          {[0, 1, 2, 3, 4].map((i) => <rect key={i} className="m-bar" x={40 + i * 5} y={71 + [1.5, 3, 3.6, 3, 1.5][i]} width="2.6" height="5" rx="1.3" style={{ animationDelay: `${i * 0.09}s` }} />)}
        </g>
        {/* dial + buttons */}
        <circle cx="90" cy="58" r="7.5" fill="#8cc8ff" />
        <line className="m-dial" x1="90" y1="58" x2="90" y2="52.5" stroke="#1a1715" strokeWidth="2" strokeLinecap="round" />
        <rect x="84" y="73" width="12" height="4" rx="2" fill="#7fe0c0" />
        <rect x="84" y="80" width="12" height="4" rx="2" fill="#ff8a7a" opacity=".8" />
        {/* feet */}
        <rect x="32" y="96" width="14" height="6" rx="3" fill="#d9d3ca" />
        <rect x="74" y="96" width="14" height="6" rx="3" fill="#d9d3ca" />
      </g>
      <defs>
        <linearGradient id="mshade" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#fff" stopOpacity=".35" /><stop offset="1" stopColor="#000" stopOpacity=".08" /></linearGradient>
      </defs>
    </svg>
  );
}
