"use client";
/* eslint-disable @next/next/no-img-element */
import { AnimatePresence, motion, useReducedMotion, type PanInfo } from "motion/react";
import { useRef, useState, type ReactNode } from "react";
import { cx } from "./ui";

export type Dir = 1 | -1 | 0; // 1 = forward (next), -1 = back (previous), 0 = no swipe (first song, DJ break)

const spring = { type: "spring" as const, stiffness: 260, damping: 30, mass: 0.9 };
const variants = {
  enter: (d: Dir) => ({ x: d === 0 ? 0 : `${d * 62}%`, scale: d === 0 ? 0.92 : 0.82, rotateY: d * -24, opacity: 0, filter: "blur(6px)" }),
  center: { x: 0, scale: 1, rotateY: 0, opacity: 1, filter: "blur(0px)" },
  exit: (d: Dir) => ({ x: d === 0 ? 0 : `${d * -58}%`, scale: d === 0 ? 1.04 : 0.8, rotateY: d * 22, opacity: 0, filter: "blur(6px)" }),
};

/**
 * The album cover, as the centrepiece. Each track gets its own layer: the outgoing cover slides away with depth while the
 * incoming one scales into place (spring physics, perspective, crossfade). Horizontal swipes skip forward/back; vertical
 * gestures pass through to the page, so it never fights scrolling. Playback itself is never touched here: the parent decides.
 */
export function ArtStage({ id, src, dir, playing, dim, onSwipe, onTap, fallback, label }: {
  id: string; src: string | null; dir: Dir; playing: boolean; dim?: boolean; label: string;
  onSwipe: (d: 1 | -1) => void; onTap?: () => void; fallback: ReactNode;
}) {
  const reduce = useReducedMotion();
  const [failed, setFailed] = useState<string | null>(null);
  const dragged = useRef(0); // a drag must never also count as a tap (pause)
  const showImg = !!src && failed !== src;
  function end(_: unknown, i: PanInfo) {
    dragged.current = Date.now();
    const pass = Math.abs(i.offset.x) > 70 || Math.abs(i.velocity.x) > 450;
    if (pass && Math.abs(i.offset.x) > Math.abs(i.offset.y)) onSwipe(i.offset.x < 0 ? 1 : -1);
  }
  return (
    <div className="art-stage relative aspect-square w-full [perspective:1100px]" data-testid="art-stage">
      <AnimatePresence initial={false} custom={dir} mode="popLayout">
        <motion.div
          key={id}
          custom={dir}
          variants={reduce ? undefined : variants}
          initial={reduce ? { opacity: 0 } : "enter"}
          animate={reduce ? { opacity: 1 } : "center"}
          exit={reduce ? { opacity: 0 } : "exit"}
          transition={reduce ? { duration: 0.2 } : spring}
          drag={reduce ? false : "x"}
          dragDirectionLock
          dragSnapToOrigin
          dragElastic={0.5}
          onDragStart={() => { dragged.current = Date.now(); }}
          onDragEnd={end}
          onTap={() => { if (Date.now() - dragged.current > 350) onTap?.(); }}
          className="absolute inset-0 cursor-grab touch-pan-y select-none active:cursor-grabbing [transform-style:preserve-3d]"
          style={{ willChange: "transform, opacity" }}
          data-testid="art-card"
          aria-label={label}
          role="img"
        >
          <div className={cx("art-card h-full w-full overflow-hidden rounded-[30px]", playing && !reduce && "is-breathing", dim && "is-dim")}>
            {showImg ? (
              <img key={src} src={src!} alt="" draggable={false} decoding="async" onError={() => setFailed(src)}
                className="art-img-in h-full w-full object-cover" />
            ) : fallback}
            <span aria-hidden className="art-gloss" />
          </div>
        </motion.div>
      </AnimatePresence>
    </div>
  );
}

/** Title and artist, sliding in step with the cover so they never disagree with it. */
export function TrackTitle({ id, title, artist, dir }: { id: string; title: string; artist: string; dir: Dir }) {
  const reduce = useReducedMotion();
  return (
    <div className="relative h-[58px] w-full overflow-hidden">
      <AnimatePresence initial={false} custom={dir} mode="popLayout">
        <motion.div key={id} custom={dir}
          initial={reduce ? { opacity: 0 } : { opacity: 0, x: dir * 40, y: dir === 0 ? 8 : 0 }}
          animate={{ opacity: 1, x: 0, y: 0 }}
          exit={reduce ? { opacity: 0 } : { opacity: 0, x: dir * -40 }}
          transition={reduce ? { duration: 0.15 } : { type: "spring", stiffness: 300, damping: 32 }}
          className="absolute inset-x-0 text-left">
          <h1 className="truncate text-[22px] font-semibold tracking-tight text-white sm:text-[24px]" data-testid="now-title">{title}</h1>
          <p className="mt-0.5 truncate text-[16px] text-white/60">{artist}</p>
        </motion.div>
      </AnimatePresence>
    </div>
  );
}

/** Generated cover when a song has no artwork: soft gradient from the title, with its initials. */
export function FallbackArt({ title, seed }: { title: string; seed: string }) {
  let h = 0; for (const c of seed) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  const a = 200 + (h % 60), b = (a + 40 + (h % 50)) % 360;
  const initials = title.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]).join("").toUpperCase() || "♪";
  return (
    <div className="relative flex h-full w-full items-center justify-center" data-testid="fallback-art"
      style={{ background: `radial-gradient(120% 90% at 20% 10%, hsl(${a} 70% 55% / .9), transparent 60%), radial-gradient(100% 80% at 90% 100%, hsl(${b} 70% 45% / .85), transparent 65%), #0b1630` }}>
      <span className="text-[64px] font-semibold tracking-tight text-white/85 drop-shadow-[0_6px_30px_rgba(0,0,0,.35)]">{initials}</span>
    </div>
  );
}
