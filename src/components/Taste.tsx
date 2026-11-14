"use client";
import { useEffect, useMemo, useState } from "react";
import { GENRE_ARTISTS, VIBE_TAGS, type Prefs } from "@/lib/prefs";
import { cx } from "@/components/ui";
import type { Up } from "@/components/prefs";
export interface ChartPick { id: string; label: string; sub?: string; kind: "top" | "trending"; chart?: string; region?: string; tint: string }
export type TasteRequest = { artist?: string; chart?: ChartPick };

export const CHART_PICKS: ChartPick[] = [
  { id: "top-global", label: "Top 100", sub: "Global", kind: "top", chart: "global", tint: "#4f7cff" },
  { id: "trend-us", label: "Trending", sub: "USA", kind: "trending", region: "US", tint: "#ff5c7a" },
  { id: "trend-mx", label: "Trending", sub: "Mexico", kind: "trending", region: "MX", tint: "#22c58b" },
  { id: "trend-jm", label: "Trending", sub: "Jamaica", kind: "trending", region: "JM", tint: "#f5b82e" },
  { id: "trend-gt", label: "Trending", sub: "Guatemala", kind: "trending", region: "GT", tint: "#38bdf8" },
  { id: "top-us", label: "Top 100", sub: "USA", kind: "top", chart: "us", tint: "#8b5cf6" },
  { id: "latin", label: "Top Latin", kind: "top", chart: "latin", tint: "#f97316" },
  { id: "dancehall", label: "Top Dancehall", kind: "top", chart: "dancehall", tint: "#16a34a" },
  { id: "soca", label: "Soca hits", kind: "top", chart: "soca", tint: "#e11d48" },
];

/* ── artist pictures (looked up once, remembered on this phone) ── */
const IMG_KEY = "myrj.artimg.v1";
const imgs: Record<string, string | null> = (() => { try { return typeof window === "undefined" ? {} : JSON.parse(localStorage.getItem(IMG_KEY) ?? "{}"); } catch { return {}; } })();
function useArtistImages(names: string[]) {
  const [, bump] = useState(0);
  const key = names.join("|");
  useEffect(() => {
    const missing = names.filter((n) => !(n.toLowerCase() in imgs)).slice(0, 30);
    if (!missing.length) return;
    let live = true;
    fetch(`/api/artists?names=${encodeURIComponent(missing.join(","))}`).then((r) => (r.ok ? r.json() : null)).then((j) => {
      for (const a of j?.artists ?? []) imgs[String(a.name).toLowerCase()] = a.image ?? null;
      // Only real pictures are remembered across visits: a miss (or a lookup hiccup) is tried again next time.
      try { localStorage.setItem(IMG_KEY, JSON.stringify(Object.fromEntries(Object.entries(imgs).filter(([, v]) => v)))); } catch { /* ignore */ }
      if (live) bump((x) => x + 1);
    }).catch(() => {});
    return () => { live = false; };
  }, [key]); // eslint-disable-line react-hooks/exhaustive-deps
  return (n: string) => imgs[n.toLowerCase()] ?? null;
}

function Avatar({ name, image, size = 66, on }: { name: string; image?: string | null; size?: number; on?: boolean }) {
  const [bad, setBad] = useState(false);
  const initials = name.split(/\s+/).filter((w) => /\w/.test(w)).slice(0, 2).map((w) => w[0]).join("").toUpperCase();
  return (
    <span className={cx("artist-avatar relative block shrink-0 overflow-hidden rounded-full", on && "is-on")} style={{ width: size, height: size }}>
      {image && !bad
        ? <img src={image} alt="" loading="lazy" onError={() => setBad(true)} className="h-full w-full object-cover" />
        : <span className="flex h-full w-full items-center justify-center bg-gradient-to-br from-[#2b4a9e] to-[#0b1636] text-[18px] font-semibold text-white/85">{initials}</span>}
      {on && <span className="absolute bottom-0.5 right-0.5 flex h-6 w-6 items-center justify-center rounded-full bg-[#e8efff] text-[13px] text-[#06102a]" aria-hidden>♥</span>}
    </span>
  );
}

function ArtistTile({ name, image, on, onClick }: { name: string; image?: string | null; on?: boolean; onClick: () => void }) {
  return (
    <button type="button" onClick={onClick} className="flex w-[76px] shrink-0 flex-col items-center gap-1.5 text-center active:scale-95 transition" aria-label={name}>
      <Avatar name={name} image={image} on={on} />
      <span className="line-clamp-2 text-[12px] leading-tight text-white/80">{name}</span>
    </button>
  );
}

/** The card for one artist: picture, "<Artist> mix" and favourite. */
function ArtistCard({ name, image, fav, onPlay, onFav, onClose }: { name: string; image?: string | null; fav: boolean; onPlay?: () => void; onFav: () => void; onClose: () => void }) {
  return (
    <div className="grouped flex items-center gap-4 rounded-[22px] p-4" data-testid="artist-card">
      <Avatar name={name} image={image} size={88} />
      <div className="min-w-0 flex-1 space-y-2">
        <p className="truncate text-[18px] font-semibold text-white">{name}</p>
        {onPlay && <button type="button" onClick={onPlay} className="flex h-10 w-full items-center justify-center gap-2 rounded-full bg-[#e8efff] text-[14px] font-semibold text-[#06102a]" aria-label={`Play ${name} mix`}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" aria-hidden><path d="M8 5.5v13a1 1 0 0 0 1.5.86l10.5-6.5a1 1 0 0 0 0-1.72L9.5 4.64A1 1 0 0 0 8 5.5Z" /></svg>
          <span className="truncate">{name} mix</span>
        </button>}
        <div className="flex gap-2">
          <button type="button" onClick={onFav} aria-pressed={fav} className="tag-chip h-9 flex-1 rounded-full text-[13px] font-medium">{fav ? "♥ Favourite" : "♡ Add to favourites"}</button>
          <button type="button" onClick={onClose} className="tag-chip h-9 rounded-full px-3 text-[13px]" aria-label="Close">✕</button>
        </div>
      </div>
    </div>
  );
}

export function ChartRow({ onPick, busy }: { onPick: (c: ChartPick) => void; busy?: boolean }) {
  return (
    <div className="-mx-5 flex gap-3 overflow-x-auto px-5 pb-1 [scrollbar-width:none]" data-testid="charts">
      {CHART_PICKS.map((c) => (
        <button key={c.id} type="button" disabled={busy} onClick={() => onPick(c)} aria-label={`${c.label}${c.sub ? ` ${c.sub}` : ""}`}
          className="chart-card relative flex h-[104px] w-[132px] shrink-0 flex-col justify-end overflow-hidden rounded-[20px] p-3 text-left transition active:scale-95 disabled:opacity-50"
          style={{ background: `linear-gradient(150deg, ${c.tint}, #0a1430 92%)` }}>
          <span className="absolute right-3 top-3 text-[11px] font-semibold uppercase tracking-[0.12em] text-white/70">{c.kind === "trending" ? "Live" : "Chart"}</span>
          <span className="text-[17px] font-bold leading-tight text-white">{c.label}</span>
          {c.sub && <span className="text-[13px] text-white/75">{c.sub}</span>}
        </button>
      ))}
    </div>
  );
}

/** Top of the Request sheet: charts, his favourite artists, and a nudge to set his taste. */
export function ForYou({ p, onRequest, onOpenTaste, busy }: { p: Prefs; onRequest: (r: TasteRequest) => void; onOpenTaste: () => void; busy?: boolean }) {
  const favs = p.favArtists ?? [];
  const img = useArtistImages(favs.filter((a) => !a.image).map((a) => a.name));
  const [sel, setSel] = useState<string | null>(null);
  return (
    <div className="space-y-5">
      <div>
        <p className="mb-2 text-[12px] font-semibold uppercase tracking-[0.12em] text-white/45">Charts &amp; trending</p>
        <ChartRow busy={busy} onPick={(c) => onRequest({ chart: c })} />
      </div>
      {favs.length ? (
        <div>
          <div className="mb-2 flex items-center justify-between">
            <p className="text-[12px] font-semibold uppercase tracking-[0.12em] text-white/45">Your artists</p>
            <button type="button" onClick={onOpenTaste} className="text-[13px] font-medium text-[#9fc0ff]">Edit taste</button>
          </div>
          <div className="-mx-5 flex gap-2 overflow-x-auto px-5 pb-1 [scrollbar-width:none]">
            {favs.map((a) => <ArtistTile key={a.name} name={a.name} image={a.image ?? img(a.name)} onClick={() => setSel(a.name)} />)}
          </div>
          {sel && (
            <div className="mt-3"><ArtistCard name={sel} image={favs.find((a) => a.name === sel)?.image ?? img(sel)} fav onClose={() => setSel(null)}
              onPlay={() => { onRequest({ artist: sel }); setSel(null); }} onFav={onOpenTaste} /></div>
          )}
        </div>
      ) : (
        <button type="button" onClick={onOpenTaste} className="grouped flex w-full items-center gap-3 rounded-[22px] p-4 text-left" data-testid="taste-prompt">
          <span className="flex -space-x-3">{["#4f7cff", "#ff5c7a", "#22c58b"].map((c) => <span key={c} className="h-10 w-10 rounded-full border-2 border-[#0a1430]" style={{ background: c }} />)}</span>
          <span className="min-w-0 flex-1">
            <span className="block text-[15px] font-semibold text-white">Tell MyRJ what you like</span>
            <span className="block text-[13px] text-white/55">Pick your genres and artists. Your mix follows them.</span>
          </span>
          <span className="text-white/40" aria-hidden>›</span>
        </button>
      )}
    </div>
  );
}

/** "Your taste": favourite genres, suggested artists with pictures, artist search. */
export function TastePanel({ p, up, onRequest, bare }: { p: Prefs; up: Up; onRequest?: (r: TasteRequest) => void; bare?: boolean }) {
  const genres = p.favGenres ?? [];
  const favs = p.favArtists ?? [];
  const isFav = (n: string) => favs.some((a) => a.name.toLowerCase() === n.toLowerCase());
  const [q, setQ] = useState("");
  const [found, setFound] = useState<{ name: string; image: string | null }[] | null>(null);
  const [searching, setSearching] = useState(false);
  const [sel, setSel] = useState<string | null>(null);

  const suggested = useMemo(() => {
    const from = genres.length ? genres : ["punta", "reggae", "dancehall", "reggaeton", "pop", "worship"];
    const seen = new Set<string>(), out: string[] = [];
    for (let i = 0; i < 6; i++) for (const g of from) { const n = GENRE_ARTISTS[g]?.[i]; if (n && !seen.has(n) && !!seen.add(n)) out.push(n); }
    return out.slice(0, 18);
  }, [genres]);
  const img = useArtistImages([...suggested, ...favs.filter((a) => !a.image).map((a) => a.name)]);
  const imageOf = (n: string) => favs.find((a) => a.name === n)?.image ?? found?.find((a) => a.name === n)?.image ?? img(n);

  const toggleGenre = (id: string) => up("favGenres", genres.includes(id) ? genres.filter((x) => x !== id) : [...genres, id]);
  const toggleFav = (n: string) => up("favArtists", isFav(n) ? favs.filter((a) => a.name.toLowerCase() !== n.toLowerCase()) : [...favs, { name: n, image: imageOf(n) }].slice(-20));

  async function search(e: React.FormEvent) {
    e.preventDefault(); const t = q.trim(); if (!t) return;
    setSearching(true);
    try { const j = await fetch(`/api/artists?q=${encodeURIComponent(t)}`).then((r) => r.json()); setFound(j.artists?.length ? j.artists : [{ name: t, image: null }]); }
    catch { setFound([{ name: t, image: null }]); }
    finally { setSearching(false); }
  }

  return (
    <div className="space-y-6 pt-1" data-testid="taste">
      {!bare && <div>
        <h2 className="text-[28px] font-bold tracking-tight text-white">Your taste</h2>
        <p className="mt-1 text-[14px] text-white/55">Pick genres and artists you love. Your mix plays more of them, and you can start any artist&apos;s mix from here.</p>
      </div>}
      <div>
        <p className="mb-2 text-[12px] font-semibold uppercase tracking-[0.12em] text-white/45">Favourite genres</p>
        <div className="flex flex-wrap gap-2">
          {VIBE_TAGS.filter((t) => t.kind === "genre").map((t) => (
            <button key={t.id} type="button" aria-pressed={genres.includes(t.id)} onClick={() => toggleGenre(t.id)}
              className={cx("tag-chip h-10 rounded-full px-4 text-[14px] font-medium transition active:scale-95", genres.includes(t.id) && "is-on")}>{t.label}</button>
          ))}
        </div>
      </div>
      {sel && <ArtistCard name={sel} image={imageOf(sel)} fav={isFav(sel)} onClose={() => setSel(null)} onFav={() => toggleFav(sel)}
        onPlay={onRequest ? () => { onRequest({ artist: sel }); setSel(null); } : undefined} />}
      {favs.length > 0 && (
        <div>
          <p className="mb-2 text-[12px] font-semibold uppercase tracking-[0.12em] text-white/45">Your artists</p>
          <div className="grid grid-cols-4 gap-y-3">{favs.map((a) => <ArtistTile key={a.name} name={a.name} image={a.image ?? img(a.name)} on onClick={() => setSel(a.name)} />)}</div>
        </div>
      )}
      <div>
        <p className="mb-2 text-[12px] font-semibold uppercase tracking-[0.12em] text-white/45">Find an artist</p>
        <form onSubmit={search} className="request-field flex items-center gap-2 rounded-[20px] p-1.5 pl-4">
          <input value={q} onChange={(e) => setQ(e.target.value)} maxLength={60} enterKeyHint="search" aria-label="Artist name" placeholder="Jhexx, Supa G, Bad Bunny…"
            className="h-11 min-w-0 flex-1 bg-transparent text-[16px] text-white placeholder:text-white/35 outline-none" />
          <button type="submit" disabled={!q.trim() || searching} className="h-11 shrink-0 rounded-[15px] bg-[#e8efff] px-4 text-[15px] font-semibold text-[#06102a] disabled:opacity-35">Search</button>
        </form>
        {found && <div className="mt-3 grid grid-cols-4 gap-y-3" data-testid="artist-results">{found.map((a) => <ArtistTile key={a.name} name={a.name} image={a.image} on={isFav(a.name)} onClick={() => setSel(a.name)} />)}</div>}
      </div>
      <div>
        <p className="mb-2 text-[12px] font-semibold uppercase tracking-[0.12em] text-white/45">{genres.length ? "Suggested for you" : "Popular artists"}</p>
        <div className="grid grid-cols-4 gap-y-3" data-testid="suggested-artists">
          {suggested.map((n) => <ArtistTile key={n} name={n} image={img(n)} on={isFav(n)} onClick={() => setSel(n)} />)}
        </div>
      </div>
    </div>
  );
}
