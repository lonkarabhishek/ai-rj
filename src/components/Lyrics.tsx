"use client";
import { useEffect, useMemo, useRef, useState } from "react";

/**
 * Synced "lyrics" for the RJ's speech. Azure's REST TTS gives no word timings, so we estimate:
 * each word's share of the clip ~ its length (+ pauses after punctuation). Works for Devanagari too.
 * `clock` returns [currentTime, duration] in seconds (from the <audio> element or an estimate).
 */
export function Lyrics({ text, clock }: { text: string; clock: () => [number, number] }) {
  const lines = useMemo(() => {
    const sentences = text.match(/[^.!?।]+[.!?।]*["”']?/g)?.map((s) => s.trim()).filter(Boolean) ?? [text];
    let total = 0;
    const out = sentences.map((s) => s.split(/\s+/).map((w) => {
      const weight = [...w].length + 1 + (/[,;:]$/.test(w) ? 3 : 0) + (/[.!?।]["”']?$/.test(w) ? 6 : 0);
      const start = total; total += weight; return { w, start, end: total };
    }));
    return { out, total };
  }, [text]);
  const [pos, setPos] = useState(0); // 0..1 progress through the speech
  const raf = useRef(0);
  useEffect(() => {
    const tick = () => {
      const [t, d] = clock();
      if (d > 0) setPos(Math.min(1, t / d));
      raf.current = requestAnimationFrame(tick);
    };
    raf.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf.current);
  }, [clock]);

  const at = pos * lines.total;
  const cur = Math.max(0, lines.out.findIndex((l) => l[l.length - 1].end > at));
  const lineIdx = cur === -1 ? lines.out.length - 1 : cur;
  const boxRef = useRef<HTMLDivElement>(null);
  const [offset, setOffset] = useState(0);
  useEffect(() => {
    const el = boxRef.current?.children[lineIdx] as HTMLElement | undefined;
    if (el) setOffset(el.offsetTop + el.offsetHeight / 2);
  }, [lineIdx, lines]);

  return (
    <div className="relative h-[clamp(116px,21svh,200px)] w-full overflow-hidden [mask-image:linear-gradient(transparent,black_22%,black_78%,transparent)]">
      <div ref={boxRef} className="absolute inset-x-0 top-1/2 space-y-3 transition-transform duration-700 ease-[cubic-bezier(.2,.8,.2,1)]" style={{ transform: `translateY(${-offset}px)` }}>
        {lines.out.map((l, i) => (
          <p key={i} className={`text-left text-[22px] font-semibold leading-snug tracking-tight transition-all duration-500 ${i === lineIdx ? "opacity-100" : i < lineIdx ? "opacity-25 blur-[0.3px]" : "opacity-40"}`}>
            {l.map((x, j) => {
              const spoken = i < lineIdx || (i === lineIdx && x.start <= at);
              const active = i === lineIdx && x.start <= at && x.end > at;
              return (
                <span key={j} className={`transition-colors duration-200 ${spoken ? "text-white" : "text-white/45"}`}
                  style={active ? { textShadow: "0 0 18px rgba(243,239,232,.6), 0 0 2px rgba(255,255,255,.9)" } : undefined}>
                  {x.w}{" "}
                </span>
              );
            })}
          </p>
        ))}
      </div>
    </div>
  );
}
