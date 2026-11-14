"use client";
/* eslint-disable @next/next/no-img-element */
import { AnimatePresence, motion, useDragControls, useReducedMotion, type DragControls, type PanInfo } from "motion/react";
import { useState, type ReactNode } from "react";
import { VIBE_TAGS, type Prefs, type TrackInfo } from "@/lib/prefs";
import { ExternalPlaylists, MusicImport, type Up } from "./prefs";
import { cx, Spinner } from "./ui";

/** iOS-style sheet: springs up, drag the grabber (or the top area) down to close, backdrop tap closes, page behind stays put. */
export function Sheet({ open, onClose, label, children, footer }: { open: boolean; onClose: () => void; label: string; children: ReactNode; footer?: ReactNode }) {
  const reduce = useReducedMotion();
  const drag = useDragControls();
  return (
    <AnimatePresence>
      {open && (
        <div className="fixed inset-0 z-50" key={label}>
          <motion.div className="absolute inset-0 bg-[#020611]/60 backdrop-blur-[2px]" onClick={onClose}
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.25 }} />
          <motion.div role="dialog" aria-modal="true" aria-label={label}
            className="sheet glass-sheet absolute inset-x-0 bottom-0 mx-auto flex max-h-[90dvh] max-w-xl flex-col rounded-t-[30px]"
            initial={reduce ? { opacity: 0 } : { y: "100%" }} animate={reduce ? { opacity: 1 } : { y: 0 }} exit={reduce ? { opacity: 0 } : { y: "100%" }}
            transition={{ type: "spring", stiffness: 320, damping: 34, mass: 0.9 }}
            drag={reduce ? false : "y"} dragControls={drag} dragConstraints={{ top: 0, bottom: 0 }} dragElastic={{ top: 0, bottom: 0.6 }} dragListener={false}
            onDragEnd={(_: unknown, i: PanInfo) => { if (i.offset.y > 120 || i.velocity.y > 600) onClose(); }}>
            <SheetGrabber controls={drag} />
            <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-5 pb-6 no-scrollbar">{children}</div>
            {footer}
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  );
}
function SheetGrabber({ controls }: { controls: DragControls }) {
  return <div onPointerDown={(e) => controls.start(e)} className="flex touch-none justify-center pb-3 pt-2.5"><span className="h-[5px] w-10 rounded-full bg-white/25" /></div>;
}

/** Compact player pinned to the bottom of a sheet: the show keeps playing, and one tap returns to the full player. */
export function MiniPlayer({ track, art, paused, onToggle, onNext, onExpand, speaking, rjName }: {
  track: TrackInfo | null; art: string | null; paused: boolean; speaking: boolean; rjName: string;
  onToggle: () => void; onNext: () => void; onExpand: () => void;
}) {
  if (!track && !speaking) return null;
  return (
    <div className="mini-player mx-3 mb-[max(0.75rem,env(safe-area-inset-bottom))] flex items-center gap-3 rounded-[22px] p-2 pr-3" data-testid="mini-player">
      <button onClick={onExpand} className="flex min-w-0 flex-1 items-center gap-3 text-left" aria-label="Open the full player">
        {art ? <img src={art} alt="" className="h-11 w-11 rounded-xl object-cover" /> : <span className="h-11 w-11 rounded-xl bg-white/10" />}
        <span className="min-w-0">
          <span className="block truncate text-[14px] font-semibold text-white">{speaking ? `${rjName} on air` : track?.name}</span>
          <span className="block truncate text-[12px] text-white/55">{speaking ? "Talking" : track?.artists}</span>
        </span>
      </button>
      <button onClick={onToggle} className="flex h-10 w-10 items-center justify-center rounded-full text-white" aria-label={paused ? "Resume" : "Hold"}>
        {paused ? <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" aria-hidden><path d="M8 5.5v13a1 1 0 0 0 1.5.86l10.5-6.5a1 1 0 0 0 0-1.72L9.5 4.64A1 1 0 0 0 8 5.5Z" /></svg>
          : <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" aria-hidden><rect x="6" y="5" width="4" height="14" rx="1.3" /><rect x="14" y="5" width="4" height="14" rx="1.3" /></svg>}
      </button>
      <button onClick={onNext} className="flex h-10 w-10 items-center justify-center rounded-full text-white/80" aria-label="Skip song">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" aria-hidden><path d="M5 6.2v11.6a1 1 0 0 0 1.55.83L15 13v4.5a1 1 0 0 0 2 0v-11a1 1 0 0 0-2 0V11L6.55 5.37A1 1 0 0 0 5 6.2Z" /></svg>
      </button>
    </div>
  );
}

/** Ask for a song, an artist or a feeling; or tap a mood/genre tag. */
export function DiscoverPanel({ p, up, busy, last, onRequest, live }: {
  p: Prefs; up: Up; busy: boolean; last: string | null; live: boolean;
  onRequest: (r: { text?: string; tag?: string }) => void;
}) {
  const [text, setText] = useState("");
  const tags = p.vibeTags ?? [];
  const toggle = (id: string) => {
    const on = tags.includes(id), next = on ? tags.filter((x) => x !== id) : [...tags, id].slice(-3);
    up("vibeTags", next);
    if (!on) onRequest({ tag: id });
  };
  return (
    <div className="space-y-6 pt-1">
      <div>
        <h2 className="text-[28px] font-bold tracking-tight text-white">Request</h2>
        <p className="mt-1 text-[14px] text-white/55">Name a song, an artist or how you feel. {live ? "It plays next, then similar songs." : "It starts when you go live."}</p>
      </div>
      <form onSubmit={(e) => { e.preventDefault(); if (text.trim() && !busy) { onRequest({ text: text.trim() }); setText(""); } }} className="request-field flex items-center gap-2 rounded-[20px] p-1.5 pl-4">
        <input value={text} onChange={(e) => setText(e.target.value)} maxLength={200} enterKeyHint="send" aria-label="What do you want to hear?"
          placeholder="Play Bendiciones by Jhexx… or “feeling chill”" className="h-11 min-w-0 flex-1 bg-transparent text-[16px] text-white placeholder:text-white/35 outline-none" />
        <button type="submit" disabled={!text.trim() || busy} className="h-11 shrink-0 rounded-[15px] bg-[#e8efff] px-4 text-[15px] font-semibold text-[#06102a] disabled:opacity-35" aria-label="Send request">
          {busy ? <Spinner className="border-[#06102a]/25 border-t-[#06102a]" /> : "Play"}
        </button>
      </form>
      {last && <p className="text-[13px] text-[#9fc0ff]" data-testid="request-status" aria-live="polite">{last}</p>}
      <div>
        <p className="mb-2 text-[12px] font-semibold uppercase tracking-[0.12em] text-white/45">Moods</p>
        <div className="flex flex-wrap gap-2">{VIBE_TAGS.filter((t) => t.kind === "mood").map((t) => <Tag key={t.id} on={tags.includes(t.id)} onClick={() => toggle(t.id)}>{t.label}</Tag>)}</div>
      </div>
      <div>
        <p className="mb-2 text-[12px] font-semibold uppercase tracking-[0.12em] text-white/45">Genres</p>
        <div className="flex flex-wrap gap-2">{VIBE_TAGS.filter((t) => t.kind === "genre").map((t) => <Tag key={t.id} on={tags.includes(t.id)} onClick={() => toggle(t.id)}>{t.label}</Tag>)}</div>
      </div>
      {tags.length > 0 && <button onClick={() => { up("vibeTags", []); onRequest({ tag: "" }); }} className="text-[14px] text-white/55 underline-offset-2 hover:text-white hover:underline">Clear tags, back to my mix</button>}
    </div>
  );
}
function Tag({ on, onClick, children }: { on: boolean; onClick: () => void; children: ReactNode }) {
  return <button type="button" aria-pressed={on} onClick={onClick} className={cx("tag-chip h-10 rounded-full px-4 text-[14px] font-medium transition active:scale-95", on && "is-on")}>{children}</button>;
}

function StationOpt({ st, onStation, id, title, sub }: { st: string | null; onStation: (s: string | null) => void; id: string | null; title: string; sub: string }) {
  return (
    <button role="radio" aria-checked={st === id} onClick={() => onStation(id)} className={cx("list-row flex w-full items-center gap-3 px-4 py-3 text-left", st === id && "is-on")}>
      <span className="min-w-0 flex-1"><span className="block truncate text-[16px] text-white">{title}</span><span className="block truncate text-[13px] text-white/50">{sub}</span></span>
      {st === id && <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#9fc0ff" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d="m5 12.5 4.5 4.5L19 7" /></svg>}
    </button>
  );
}

/** Your music: which station to play (mix, your library, one playlist), what's coming up, and adding playlists. */
export function LibraryPanel({ p, up, upcoming, onStation, source }: {
  p: Prefs; up: Up; upcoming: TrackInfo[]; source: "spotify" | "youtube"; onStation: (s: string | null) => void;
}) {
  const st = p.station ?? null;
  const yt = p.externalPlaylists.filter((x) => /youtu/.test(x.url));
  return (
    <div className="space-y-7 pt-1">
      <div><h2 className="text-[28px] font-bold tracking-tight text-white">Library</h2><p className="mt-1 text-[14px] text-white/55">Choose what the radio plays from.</p></div>
      <section>
        <p className="mb-2 px-1 text-[12px] font-semibold uppercase tracking-[0.12em] text-white/45">Station</p>
        <div className="grouped" role="radiogroup" aria-label="Station">
          <StationOpt st={st} onStation={onStation} id={null} title="My Mix" sub="Your music plus new finds" />
          {source === "youtube" && <StationOpt st={st} onStation={onStation} id="library" title="My library" sub="Your YouTube likes and playlists, a few similar songs" />}
          {source === "youtube" && yt.map((x) => <StationOpt st={st} onStation={onStation} key={x.url} id={x.url} title={x.note || "Imported playlist"} sub={x.url.replace(/^https?:\/\/(www\.)?/, "")} />)}
        </div>
        {source !== "youtube" && <p className="mt-2 px-1 text-[13px] text-white/45">Playlist stations work with YouTube as the music source.</p>}
      </section>
      {upcoming.length > 0 && (
        <section>
          <p className="mb-2 px-1 text-[12px] font-semibold uppercase tracking-[0.12em] text-white/45">Up next</p>
          <div className="grouped">{upcoming.map((t, i) => (
            <div key={(t.uri ?? t.name) + i} className="list-row flex items-center gap-3 px-4 py-2.5">
              {t.image ? <img src={t.image} alt="" className="h-10 w-10 rounded-lg object-cover" /> : <span className="h-10 w-10 rounded-lg bg-white/10" />}
              <span className="min-w-0"><span className="block truncate text-[15px] text-white">{t.name}</span><span className="block truncate text-[13px] text-white/50">{t.artists}</span></span>
            </div>
          ))}</div>
        </section>
      )}
      <section>
        <p className="mb-2 px-1 text-[12px] font-semibold uppercase tracking-[0.12em] text-white/45">Add a playlist</p>
        <div className="grouped space-y-3 p-4">
          <p className="text-[14px] text-white/60">Paste a public YouTube or YouTube Music playlist link. It becomes a station above.</p>
          <ExternalPlaylists p={p} up={up} />
        </div>
      </section>
      <section>
        <p className="mb-2 px-1 text-[12px] font-semibold uppercase tracking-[0.12em] text-white/45">Add songs</p>
        <div className="grouped p-4"><MusicImport p={p} up={up} /></div>
      </section>
    </div>
  );
}
