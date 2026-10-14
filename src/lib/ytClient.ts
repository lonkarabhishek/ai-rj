"use client";
/* YouTube source (client): curation from his likes/playlists/imported links + sparing, cached searches; IFrame player wrapper. */
import type { ListenMode, SongLang, TrackInfo } from "./prefs";

export interface YtVideo { id: string; title: string; channel: string; seconds: number; image?: string; audioLang?: string; topic?: boolean }
type Tagged = YtVideo & { via?: SongLang | "mode" | "focus" };

const DAY = 24 * 3600e3;
const SEARCH_CAP = 4; // per session: 4 × 101 units
let searchesThisSession = 0;
export let ytQuotaHit = false;
export function ytSearchesUsed() { return searchesThisSession; }

function cacheGet<T>(k: string): T | null { try { const c = JSON.parse(localStorage.getItem(k) ?? "null"); return c && Date.now() - c.at < DAY ? c.v : null; } catch { return null; } }
function cacheSet(k: string, v: unknown) { try { localStorage.setItem(k, JSON.stringify({ at: Date.now(), v })); } catch { /* full */ } }

export async function ytConnected(): Promise<boolean> {
  try { const j = await fetch("/api/youtube/songs?status", { cache: "no-store" }).then((r) => r.json()); return !!j.connected; } catch { return false; }
}

// ---- strict language detection ----
const SCRIPT: [SongLang, RegExp][] = [["tamil", /[\u0B80-\u0BFF]/], ["telugu", /[\u0C00-\u0C7F]/], ["punjabi", /[\u0A00-\u0A7F]/], ["hindi", /[\u0900-\u097F]/]];
const WORDS: [SongLang, RegExp][] = [
  ["punjabi", /\bpunjabi\b|diljit|sidhu moose|karan aujla|ap dhillon|ammy virk|guru randhawa|bhangra/i],
  ["marathi", /\bmarathi\b|ajay[- ]atul|lavani/i],
  ["tamil", /\btamil\b|kollywood|anirudh|ilaiyaraaja/i],
  ["telugu", /\btelugu\b|tollywood|devi sri prasad|\bdsp\b|aditya music|lahari/i],
  ["hindi", /\bhindi\b|bollywood|t-series|arijit|zee music company|\byrf\b|tips official|saregama music|shreya ghoshal|atif aslam|pritam/i],
];
const AUDIO: Record<string, SongLang> = { en: "english", hi: "hindi", pa: "punjabi", mr: "marathi", ta: "tamil", te: "telugu" };

/** Strict: a specific language must be positively signalled; uncertain videos are dropped. */
export function videoLang(v: Tagged): { lang: SongLang | null; sure: boolean } {
  const text = `${v.title} ${v.channel}`;
  const al = v.audioLang ? AUDIO[v.audioLang.split("-")[0]] : undefined;
  if (al && al !== "hindi" && al !== "english") return { lang: al, sure: true };
  for (const [l, re] of SCRIPT) if (re.test(text)) return { lang: l === "hindi" && /marathi/i.test(text) ? "marathi" : l, sure: true };
  for (const [l, re] of WORDS) if (re.test(text)) return { lang: l, sure: true };
  if (al) return { lang: al, sure: true };
  // No Indic signal at all: English only if it came from an English search on a Latin-only title.
  if (v.via === "english" && !/[^\u0000-\u024F\u2000-\u206F\s]/.test(text)) return { lang: "english", sure: true };
  if (v.via && v.via !== "mode" && v.via !== "focus") return { lang: v.via as SongLang, sure: false };
  return { lang: null, sure: false };
}
export function matchesLangs(v: Tagged, langs: SongLang[]) {
  if (!langs.length || langs.includes("any")) return true;
  const { lang, sure } = videoLang(v);
  if (!lang || !langs.includes(lang)) return false;
  // Searched-for Indic language without a contradicting signal is accepted (its queries are specific); English needs a sure signal.
  return sure || (lang !== "english" && v.via === lang);
}

const LQ: Record<Exclude<SongLang, "any">, { q: string[]; focus: string }> = {
  hindi: { q: ["new hindi songs", "bollywood hits", "arijit singh songs", "hindi romantic songs"], focus: "bollywood instrumental flute" },
  english: { q: ["english pop hits", "top english songs", "indie pop songs", "english acoustic songs"], focus: "piano instrumental study" },
  punjabi: { q: ["punjabi hit songs", "new punjabi songs"], focus: "punjabi instrumental" },
  marathi: { q: ["marathi songs", "ajay atul songs"], focus: "marathi instrumental flute" },
  tamil: { q: ["tamil hit songs", "anirudh songs"], focus: "tamil bgm instrumental" },
  telugu: { q: ["telugu hit songs", "dsp telugu songs"], focus: "telugu bgm instrumental" },
};
const MODEQ: Record<ListenMode, string> = { default: "", gym: "workout", drive: "road trip", focus: "" };
const INSTR = /instrumental|lofi|lo-fi|piano|flute|ambient|bgm|study|beats|guitar|sitar|santoor|violin/i;
const VOCALY = /lyric|lyrics|feat\.|ft\.|official (music )?video|vocal|cover|\bsong\b/i;

function toTrack(v: YtVideo): TrackInfo {
  return { name: v.title.replace(/\s*[([](official|lyric|lyrics|audio|video|full|hd|4k|visualizer|music video)[^)\]]*[)\]]/gi, "").replace(/\s*\|.*$/, "").trim() || v.title,
    artists: v.channel, uri: `yt:${v.id}`, ytId: v.id, durationMs: v.seconds * 1000 || undefined, image: v.image ?? `https://i.ytimg.com/vi/${v.id}/hqdefault.jpg`, spotifyUrl: `https://www.youtube.com/watch?v=${v.id}` };
}

export class YtCurator {
  private queue: TrackInfo[] = [];
  private played = new Set<string>();
  private bad: Set<string>;
  private pool: Tagged[] | null = null;
  private langs: SongLang[];
  constructor(private mode: ListenMode, langs: SongLang[], private links: string[] = []) {
    this.langs = langs.filter((l) => l !== "any");
    let b: string[] = []; try { b = JSON.parse(localStorage.getItem("myrj.yt.bad") || "[]"); } catch { /* ignore */ }
    this.bad = new Set(b);
  }
  markBad(id: string) { this.bad.add(id); try { localStorage.setItem("myrj.yt.bad", JSON.stringify([...this.bad].slice(-300))); } catch { /* ignore */ } }

  private async loadPool(): Promise<Tagged[]> {
    if (this.pool) return this.pool;
    let base = cacheGet<YtVideo[]>("myrj.yt.pool");
    if (!base) {
      const [mine, links] = await Promise.all([
        fetch("/api/youtube/pool").then((r) => (r.ok ? r.json() : { videos: [] })).then((j) => j.videos ?? []).catch(() => []),
        this.links.length ? fetch("/api/youtube/links", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ urls: this.links }) }).then((r) => r.json()).then((j) => j.videos ?? []).catch(() => []) : Promise.resolve([]),
      ]);
      base = [...mine, ...links];
      if (base.length) cacheSet("myrj.yt.pool", base);
    }
    this.pool = base;
    return base;
  }

  private async search(q: string, via: Tagged["via"], focus = false): Promise<Tagged[]> {
    const key = `myrj.yt.sq.${focus ? "f:" : ""}${q}`;
    const c = cacheGet<YtVideo[]>(key);
    if (c) return c.map((v) => ({ ...v, via }));
    if (searchesThisSession >= SEARCH_CAP || ytQuotaHit) return [];
    searchesThisSession++;
    const r = await fetch(`/api/youtube/search?q=${encodeURIComponent(q)}${focus ? "&focus=1" : ""}`).catch(() => null);
    if (!r?.ok) { if (r?.status === 429) ytQuotaHit = true; return []; }
    const v: YtVideo[] = (await r.json()).videos ?? [];
    cacheSet(key, v);
    return v.map((x) => ({ ...x, via }));
  }

  private ok(v: Tagged) {
    if (this.bad.has(v.id) || this.played.has(`yt:${v.id}`) || this.queue.some((q) => q.ytId === v.id)) return false;
    if (this.mode === "focus") return INSTR.test(v.title) && !VOCALY.test(v.title) && matchesLangsFocus(v, this.langs);
    if (v.seconds > 600) return false;
    return matchesLangs(v, this.langs);
  }

  private async refill() {
    const pool = (await this.loadPool()).filter((v) => this.ok(v));
    let picks: Tagged[] = [...pool].sort(() => Math.random() - 0.5).slice(0, 8);
    if (picks.length < 4) {
      // Not enough from his own library: one cached/capped search per language (max 2).
      const langs: SongLang[] = this.langs.length ? [...this.langs].sort(() => Math.random() - 0.5) : ["any"];
      const qs: [string, Tagged["via"]][] = [];
      for (const l of langs) {
        if (this.mode === "focus") qs.push([l === "any" ? "lofi piano instrumental study" : LQ[l].focus, "focus"]);
        else { const base = l === "any" ? ["top hits songs", "new songs"] : LQ[l].q; const q = base[Math.floor(Math.random() * base.length)]; qs.push([`${q} ${MODEQ[this.mode]}`.trim(), l === "any" ? "mode" : l]); }
      }
      const found = (await Promise.all(qs.slice(0, 2).map(([q, via]) => this.search(q, via, this.mode === "focus")))).flat().filter((v) => this.ok(v));
      const seen = new Set(picks.map((p) => p.id));
      picks = [...picks, ...found.filter((v) => !seen.has(v.id) && !!seen.add(v.id)).sort(() => Math.random() - 0.5).slice(0, 10)];
    }
    this.queue.push(...picks.map(toTrack));
  }

  async next(): Promise<TrackInfo | null> {
    if (this.queue.length < 2) await this.refill().catch(() => {});
    if (!this.queue.length && this.played.size) { this.played.clear(); await this.refill().catch(() => {}); }
    const t = this.queue.shift() ?? null;
    if (t?.uri) this.played.add(t.uri);
    return t;
  }
  peek() { return this.queue[0] ?? null; }
}
function matchesLangsFocus(v: Tagged, langs: SongLang[]) {
  if (!langs.length) return true;
  const { lang } = videoLang(v);
  return (!!lang && langs.includes(lang)) || v.via === "focus";
}

// ---- IFrame player ----
let apiP: Promise<void> | null = null;
export function loadYtApi(): Promise<void> {
  if (apiP) return apiP;
  apiP = new Promise<void>((res, rej) => {
    const w = window as any; // eslint-disable-line @typescript-eslint/no-explicit-any
    if (w.YT?.Player) return res();
    const prev = w.onYouTubeIframeAPIReady;
    w.onYouTubeIframeAPIReady = () => { prev?.(); res(); };
    const s = document.createElement("script"); s.src = "https://www.youtube.com/iframe_api"; s.async = true;
    s.onerror = () => { apiP = null; rej(new Error("YouTube player failed to load")); };
    document.head.appendChild(s);
  });
  return apiP;
}

export type YtState = -1 | 0 | 1 | 2 | 3 | 5;
/* eslint-disable @typescript-eslint/no-explicit-any */
export class YtPlayer {
  p: any = null;
  state: YtState = -1;
  error: number | null = null;
  current = "";
  onState: (s: YtState) => void = () => {};
  private ready: Promise<void> | null = null;
  mount(el: HTMLElement) {
    if (this.ready) return this.ready;
    this.ready = (async () => {
      await loadYtApi();
      await new Promise<void>((res) => {
        const w = window as any;
        this.p = new w.YT.Player(el, {
          width: "100%", height: "100%",
          playerVars: { playsinline: 1, controls: 1, rel: 0, iv_load_policy: 3, origin: location.origin },
          events: {
            onReady: () => res(),
            onStateChange: (e: any) => { this.state = e.data; this.onState(e.data); },
            onError: (e: any) => { this.error = e.data; this.onState(this.state); },
          },
        });
      });
    })().catch((e) => { this.ready = null; throw e; });
    return this.ready;
  }
  isReady() { return !!this.p?.loadVideoById; }
  load(id: string) { this.error = null; this.current = id; this.state = -1; this.p?.loadVideoById({ videoId: id }); }
  cue(id: string) { this.current = id; this.p?.cueVideoById?.({ videoId: id }); }
  play() { this.p?.playVideo?.(); }
  pause() { this.p?.pauseVideo?.(); }
  stop() { this.p?.stopVideo?.(); }
  setVolume01(v: number) { this.p?.setVolume?.(Math.round(Math.max(0, Math.min(1, v)) * 100)); }
  getVolume01() { const v = this.p?.getVolume?.(); return typeof v === "number" ? v / 100 : 0.85; }
  time() { return Number(this.p?.getCurrentTime?.() ?? 0); }
  duration() { return Number(this.p?.getDuration?.() ?? 0); }
  videoId(): string { return this.p?.getVideoData?.()?.video_id ?? ""; }
}
