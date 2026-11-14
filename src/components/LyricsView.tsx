"use client";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { useEffect, useRef, useState } from "react";
import { activeLine, parseLrc, type LrcLine } from "@/lib/lrc";
import { cx } from "./ui";

type State = { status: "loading" } | { status: "synced"; lines: LrcLine[] } | { status: "plain"; text: string } | { status: "none"; instrumental?: boolean };
const cache = new Map<string, State>();

/**
 * Fullscreen lyrics. Timing comes only from the real playback clock (`clock()` reads the player's position), so pause, seeking
 * and song changes are followed automatically. Word highlighting appears only when the lyrics file has word timestamps.
 */
export function LyricsView({ open, onClose, trackId, title, artist, durationS, clock, art, color }: {
  open: boolean; onClose: () => void; trackId: string | null; title: string; artist: string; durationS?: number;
  clock: () => number | null; art?: string | null; color?: string | null;
}) {
  const reduce = useReducedMotion();
  const [st, setSt] = useState<State>({ status: "loading" });
  const [idx, setIdx] = useState(-1);
  const [t, setT] = useState(0);
  const listRef = useRef<HTMLDivElement>(null);
  const [userScroll, setUserScroll] = useState(0);

  useEffect(() => {
    if (!open || !trackId || !title) return;
    const hit = cache.get(trackId);
    if (hit) { setSt(hit); return; }
    setSt({ status: "loading" }); setIdx(-1);
    const q = new URLSearchParams({ title, artist, ...(durationS ? { duration: String(Math.round(durationS)) } : {}) });
    let off = false;
    fetch(`/api/lyrics?${q}`).then((r) => (r.ok ? r.json() : null)).then((j) => {
      const s: State = j?.synced ? { status: "synced", lines: parseLrc(j.synced).filter((l) => l.text || l.words) }
        : j?.plain ? { status: "plain", text: j.plain } : { status: "none", instrumental: !!j?.instrumental };
      if (s.status === "synced" && !s.lines.length) Object.assign(s, { status: "none" });
      cache.set(trackId, s); if (!off) setSt(s);
    }).catch(() => { if (!off) setSt({ status: "none" }); });
    return () => { off = true; };
  }, [open, trackId, title, artist, durationS]);

  // Follow the player. Re-render only when the line (or, with word timings, the time) actually changes.
  useEffect(() => {
    if (!open || st.status !== "synced") return;
    const words = st.lines.some((l) => l.words);
    let raf = 0, last = -2, lastT = 0;
    const tick = () => {
      raf = requestAnimationFrame(tick);
      const now = clock();
      if (now === null) return;
      const i = activeLine(st.lines, now);
      if (i !== last) { last = i; setIdx(i); }
      if (words && Math.abs(now - lastT) > 0.08) { lastT = now; setT(now); }
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [open, st, clock]);

  // Keep the active line centred (unless the listener is scrolling by hand: then wait 3s).
  useEffect(() => {
    if (Date.now() - userScroll < 3000) return;
    const box = listRef.current, el = box?.querySelector<HTMLElement>(`[data-line="${idx}"]`);
    if (!box || !el) return;
    box.scrollTo({ top: el.offsetTop - box.clientHeight / 2 + el.clientHeight / 2, behavior: reduce ? "auto" : "smooth" });
  }, [idx, reduce, userScroll]);

  return (
    <AnimatePresence>
      {open && (
        <motion.div key="lyrics" role="dialog" aria-modal="true" aria-label="Lyrics" data-testid="lyrics"
          initial={reduce ? { opacity: 0 } : { opacity: 0, y: 40, scale: 0.98 }} animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={reduce ? { opacity: 0 } : { opacity: 0, y: 40, scale: 0.98 }} transition={{ type: "spring", stiffness: 260, damping: 30 }}
          className="lyrics-screen fixed inset-0 z-[60] flex flex-col"
          style={{ ["--art-rgb" as string]: color ?? "70 110 220" }}>
          {art && <div aria-hidden className="pointer-events-none absolute inset-0 -z-10 scale-125 bg-cover bg-center opacity-35 blur-[70px]" style={{ backgroundImage: `url(${art})` }} />}
          <header className="flex items-center gap-3 px-5 pt-[max(1rem,env(safe-area-inset-top))] pb-3">
            <div className="min-w-0 flex-1">
              <p className="truncate text-[15px] font-semibold text-white">{title}</p>
              <p className="truncate text-[13px] text-white/55">{artist}</p>
            </div>
            <button onClick={onClose} className="glass flex h-11 w-11 items-center justify-center rounded-full text-white" aria-label="Close lyrics">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" aria-hidden><path d="m6 9 6 6 6-6" /></svg>
            </button>
          </header>
          <div ref={listRef} onWheel={() => setUserScroll(Date.now())} onTouchMove={() => setUserScroll(Date.now())}
            className="lyrics-list relative flex-1 overflow-y-auto overscroll-contain px-6 pb-[40vh] pt-[30vh] no-scrollbar">
            {st.status === "loading" && <p className="text-[26px] font-semibold text-white/40">Finding lyrics…</p>}
            {st.status === "none" && <p className="text-[22px] font-semibold text-white/60" data-testid="lyrics-none">{st.instrumental ? "Instrumental. Just enjoy it." : "No lyrics found for this one."}</p>}
            {st.status === "plain" && (
              <>
                <p className="mb-6 text-[12px] uppercase tracking-[0.14em] text-white/40" data-testid="lyrics-unsynced">Lyrics (not time-synced)</p>
                {st.text.split(/\n/).map((l, i) => <p key={i} className="mb-3 text-[24px] font-semibold leading-snug text-white/80">{l || " "}</p>)}
              </>
            )}
            {st.status === "synced" && st.lines.map((l, i) => {
              const on = i === idx, past = i < idx;
              return (
                <p key={`${l.t}-${i}`} data-line={i} data-active={on || undefined}
                  className={cx("lyric-line mb-5 text-[27px] font-bold leading-[1.22] tracking-tight", on ? "is-active" : past ? "is-past" : "is-next")}>
                  {on && l.words ? l.words.map((w, j) => <span key={j} className={cx("lyric-word", w.t <= t ? "is-sung" : "")}>{w.text}</span>) : (l.text || "♪")}
                </p>
              );
            })}
          </div>
          {st.status === "synced" && <p className="pointer-events-none absolute inset-x-0 bottom-[max(1rem,env(safe-area-inset-bottom))] text-center text-[11px] text-white/35">Lyrics from LRCLIB</p>}
        </motion.div>
      )}
    </AnimatePresence>
  );
}
