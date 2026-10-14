"use client";
import type { ListenMode, SongLang, TrackInfo } from "./prefs";

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

// Client-side token cache: avoids hammering /api/spotify/token, refreshes before expiry.
let cached: { token: string; until: number } | null = null;
let inflight: Promise<string | null> | null = null;

async function fetchToken(force: boolean): Promise<string | null> {
  for (let i = 0; i < 3; i++) {
    try {
      const r = await fetch(`/api/spotify/token${force ? "?force=1" : ""}`, { cache: "no-store" });
      if (r.status === 401) { cached = null; return null; }
      if (!r.ok) throw new Error(String(r.status));
      const j = await r.json();
      cached = { token: j.accessToken, until: Math.min(j.expiresAt ?? 0, Date.now() + 45 * 60 * 1000) };
      return j.accessToken;
    } catch { await wait(800 * (i + 1)); }
  }
  return cached?.token ?? null;
}

export async function getToken(force = false): Promise<string | null> {
  if (!force && cached && cached.until > Date.now()) return cached.token;
  if (!inflight) inflight = fetchToken(force).finally(() => { inflight = null; });
  return inflight;
}

export async function getTokenInfo(): Promise<{ accessToken: string; scope: string | null } | null> {
  try {
    const r = await fetch("/api/spotify/token", { cache: "no-store" });
    if (!r.ok) return null;
    return r.json();
  } catch { return null; }
}

export class SpotifyError extends Error {
  constructor(public status: number, msg: string) { super(`Spotify ${status}: ${msg}`); }
}

// ---- shared rate limiter: one backoff window for the whole app, honouring Retry-After; max 3 calls in flight ----
let blockedUntil = 0;
let inFlight = 0;
const waiters: (() => void)[] = [];
export function spotifyBackoffMs() { return Math.max(0, blockedUntil - Date.now()); }
function announce() {
  try { window.dispatchEvent(new CustomEvent("spotify-backoff", { detail: { until: blockedUntil } })); } catch { /* ssr */ }
}
async function slot() {
  if (inFlight < 3) { inFlight++; return; }
  await new Promise<void>((r) => waiters.push(r)); inFlight++;
}
function release() { inFlight--; waiters.shift()?.(); }

/** Spotify Web API call: token refresh on 401, backoff on network/5xx. A 429 opens a global backoff window (Retry-After)
 *  and is never retried; every call during the window fails fast without touching Spotify. */
export async function sp<T = unknown>(path: string, init: RequestInit = {}): Promise<T> {
  let lastErr: unknown;
  for (let attempt = 0; attempt < 3; attempt++) {
    if (Date.now() < blockedUntil) throw new SpotifyError(429, `backing off ${Math.ceil(spotifyBackoffMs() / 1000)}s`);
    const token = await getToken(attempt > 0 && lastErr instanceof SpotifyError && lastErr.status === 401);
    if (!token) throw new SpotifyError(401, "not connected");
    let r: Response;
    await slot();
    try {
      r = await fetch(`https://api.spotify.com/v1${path}`, {
        ...init,
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json", ...(init.headers ?? {}) },
      });
    } catch (e) { release(); lastErr = e; await wait(1000 * 2 ** attempt); continue; }
    release();
    if (r.status === 204 || r.status === 202) return undefined as T;
    if (r.ok) { const text = await r.text(); return (text ? JSON.parse(text) : undefined) as T; }
    const body = (await r.text()).slice(0, 200);
    lastErr = new SpotifyError(r.status, body);
    if (r.status === 401) continue; // refresh token and retry
    if (r.status === 429) {
      const ra = Number(r.headers.get("Retry-After"));
      blockedUntil = Math.max(blockedUntil, Date.now() + (Number.isFinite(ra) && ra > 0 ? ra : 5) * 1000);
      announce();
      throw lastErr;
    }
    if (r.status >= 500) { await wait(1000 * 2 ** attempt); continue; }
    throw lastErr; // 400/403/404: caller decides
  }
  throw lastErr instanceof Error ? lastErr : new Error(String(lastErr));
}

/* eslint-disable @typescript-eslint/no-explicit-any */
function slim(t: any) {
  return t && { type: t.type, id: t.id, uri: t.uri, name: t.name, duration_ms: t.duration_ms, preview_url: t.preview_url, external_urls: t.external_urls,
    album: { name: t.album?.name, images: (t.album?.images ?? []).slice(0, 1) }, artists: (t.artists ?? []).map((a: any) => ({ id: a.id, name: a.name })) };
}
function pruneSearchCache() {
  try { Object.keys(localStorage).filter((k) => k.startsWith("myrj.sq.")).forEach((k) => localStorage.removeItem(k)); } catch { /* ignore */ }
}
function toTrack(t: any): TrackInfo | null {
  if (!t || t.type !== "track") return null;
  return {
    name: t.name,
    artists: (t.artists ?? []).map((a: any) => a.name).join(", "),
    uri: t.uri,
    durationMs: t.duration_ms,
    previewUrl: t.preview_url,
    spotifyUrl: t.external_urls?.spotify,
    image: t.album?.images?.[0]?.url,
    artistIds: (t.artists ?? []).map((a: any) => a.id).filter(Boolean),
  };
}

export async function getMe() {
  return sp<{ display_name: string; product: string; id: string }>("/me");
}
export async function getPlaylists() {
  const j = await sp<any>("/me/playlists?limit=50");
  return (j.items ?? []).filter(Boolean).map((p: any) => ({ id: p.id, name: p.name, owner: p.owner?.display_name }));
}
export async function getTracks(source: string): Promise<TrackInfo[]> {
  let raw: any[] = [];
  if (source === "top") {
    raw = (await sp<any>("/me/top/tracks?limit=50&time_range=medium_term")).items ?? [];
  } else {
    // Newer API uses /items (item field); older /tracks (track field). Try both.
    try {
      raw = ((await sp<any>(`/playlists/${source}/items?limit=100`)).items ?? []).map((i: any) => i.item ?? i.track);
    } catch {
      raw = ((await sp<any>(`/playlists/${source}/tracks?limit=100`)).items ?? []).map((i: any) => i.track);
    }
  }
  const tracks = raw.map(toTrack).filter(Boolean) as TrackInfo[];
  return tracks.sort(() => Math.random() - 0.5);
}

/**
 * Endless, no-repeat auto-curated stream. Mixes top tracks (3 time ranges), saved tracks,
 * the user's playlists, and discovery (top artists' top tracks + genre/artist searches).
 * Each source is wrapped in try/catch since Spotify restricts some endpoints for dev-mode apps.
 */
const MODE_QUERIES: Record<"gym" | "drive", string[]> = {
  gym: ["workout motivation", "gym hype", "beast mode", "running anthems", "bollywood workout", "edm workout", "hip hop workout"],
  drive: ["road trip singalong", "bollywood road trip", "feel good hits", "summer drive", "punjabi party", "throwback singalong"],
};

/** Find the best Spotify match for a title/artist pair. */
export async function matchTrack(title: string, artist: string): Promise<TrackInfo | null> {
  const q = artist ? `track:${title} artist:${artist}` : title;
  try {
    let j = await sp<any>(`/search?type=track&limit=3&q=${encodeURIComponent(q)}`);
    if (!j.tracks?.items?.length && artist) j = await sp<any>(`/search?type=track&limit=3&q=${encodeURIComponent(`${title} ${artist}`)}`);
    return toTrack(j.tracks?.items?.[0]);
  } catch { return null; }
}

const FOCUS_QUERIES = [
  "instrumental lofi", "lofi beats", "lofi hip hop instrumental", "piano instrumental", "peaceful piano", "ambient instrumental",
  "post-rock instrumental", "deep focus instrumental", "study beats", "chillhop instrumental", "neo classical piano",
  "acoustic guitar instrumental", "lofi hindi instrumental", "sitar instrumental", "flute instrumental", "cinematic instrumental",
  'genre:"lo-fi"', "genre:ambient", 'genre:"post-rock"', 'genre:"neo-classical"',
];
/** Text signals that a track has no vocals. */
export const INSTRUMENTAL_RE = /instrumental|lo-?fi|chillhop|piano|ambient|lofi beats|study beats|post-?rock|neo-?classical|classical|orchestr|symphon|soundtrack|\bscore\b|sitar|flute|santoor|guitar instrumental|cello|violin|meditation|concentration|karaoke|no vocals|bgm|\binst\b/i;
const VOCAL_RE = /\b(feat\.?|ft\.?|featuring)\b|\(lyrics?\)|\bvocal(s)? (mix|version)\b|acapella|a cappella/i;
const INSTRUMENTAL_GENRE_RE = /lo-?fi|ambient|post-rock|neo-?classical|classical|chillhop|instrumental|soundtrack|focus|study|piano|new age|drone|minimal/i;
let audioFeaturesOk: boolean | null = null; // Spotify blocks audio-features for newer apps; detect once.

/** Song-language steering: search terms per language (+ instrumental form for Focus) and detection signals. */
const LANG_TERMS: Record<Exclude<SongLang, "any">, { q: string[]; genre: string[]; focus: string[] }> = {
  hindi: { q: ["bollywood", "hindi songs", "arijit singh", "bollywood hits", "hindi indie"], genre: ["filmi", "bollywood"], focus: ["bollywood instrumental", "hindi lofi instrumental", "bollywood flute instrumental", "bollywood piano"] },
  english: { q: ["pop hits", "indie pop", "english hits", "r&b", "alt rock"], genre: ["pop", "indie pop"], focus: ["lofi beats", "piano instrumental", "ambient instrumental", "post-rock instrumental"] },
  punjabi: { q: ["punjabi", "punjabi hits", "desi hip hop", "punjabi pop", "diljit dosanjh"], genre: ["punjabi pop", "desi hip hop"], focus: ["punjabi instrumental", "punjabi lofi instrumental"] },
  marathi: { q: ["marathi songs", "marathi hits", "marathi pop", "ajay atul"], genre: ["marathi pop"], focus: ["marathi instrumental", "marathi flute instrumental"] },
  tamil: { q: ["tamil songs", "tamil hits", "kollywood", "anirudh ravichander"], genre: ["tamil pop", "kollywood"], focus: ["tamil instrumental", "tamil bgm", "ilaiyaraaja instrumental"] },
  telugu: { q: ["telugu songs", "telugu hits", "tollywood", "dsp telugu"], genre: ["telugu pop", "tollywood"], focus: ["telugu instrumental", "telugu bgm"] },
};
const LANG_GENRE_RE: Record<string, RegExp> = {
  hindi: /bollywood|filmi|hindi|hindustani|indian pop|sufi|ghazal/i,
  punjabi: /punjabi|bhangra|desi hip hop|desi pop/i,
  marathi: /marathi|lavani/i,
  tamil: /tamil|kollywood/i,
  telugu: /telugu|tollywood/i,
};
const LANG_SCRIPT_RE: [string, RegExp][] = [["hindi", /[\u0900-\u097F]/], ["punjabi", /[\u0A00-\u0A7F]/], ["tamil", /[\u0B80-\u0BFF]/], ["telugu", /[\u0C00-\u0C7F]/]];
const INDIC_RE = /bollywood|filmi|hindi|punjabi|bhangra|desi|marathi|tamil|kollywood|telugu|tollywood|indian|carnatic|hindustani|sufi|ghazal|bengali|kannada|malayalam/i;

export class Curator {
  private langs: Exclude<SongLang, "any">[];
  constructor(private mode: ListenMode = "default", private seeds: TrackInfo[] = [], langs: SongLang[] = ["any"]) {
    this.langs = langs.filter((l) => l !== "any") as Exclude<SongLang, "any">[];
  }
  private genreCache = new Map<string, string[]>();
  private genresDown = false; // Spotify refused artist lookups (dev-mode restrictions): genre signal unavailable
  private async genresFor(tracks: TrackInfo[]) {
    const ids = [...new Set(tracks.map((t) => t.artistIds?.[0]).filter((x): x is string => !!x && !this.genreCache.has(x)))];
    for (let i = 0; i < ids.length; i += 50) {
      try {
        const j = await sp<any>(`/artists?ids=${ids.slice(i, i + 50).join(",")}`);
        for (const a of j.artists ?? []) if (a) this.genreCache.set(a.id, a.genres ?? []);
      } catch { this.genresDown = true; ids.slice(i, i + 50).forEach((x) => this.genreCache.set(x, [])); }
    }
  }
  /** Keep tracks matching the chosen song languages. trusted = came from a language search (keep when undetectable). */
  private async byLang(tracks: TrackInfo[], trusted: boolean): Promise<TrackInfo[]> {
    if (!this.langs.length || !tracks.length) return tracks;
    await this.genresFor(tracks);
    return tracks.filter((t) => {
      const text = `${t.name} ${t.artists}`;
      const g = (t.artistIds?.[0] && this.genreCache.get(t.artistIds[0])) || [];
      const gs = g.join(" | ");
      const found = new Set<string>();
      for (const [l, re] of LANG_SCRIPT_RE) if (re.test(text)) found.add(l);
      for (const [l, re] of Object.entries(LANG_GENRE_RE)) if (re.test(gs)) found.add(l);
      if (found.has("hindi") && /marathi|lavani/i.test(gs)) found.add("marathi");
      if (this.langs.some((l) => found.has(l))) return true;
      if (this.langs.includes("english") && !found.size && !INDIC_RE.test(gs) && !/[\u0900-\u0DFF]/.test(text)) return g.length > 0 || trusted;
      if (this.genresDown && !found.size && !g.length) return true; // can't tell: don't drop the listener's own songs
      return trusted && !found.size && !g.length; // no signal at all: only trust language-search results
    });
  }
  private async langTracks(flavour: string[] = [""]): Promise<TrackInfo[]> {
    if (!this.langs.length) return [];
    const qs: string[] = [];
    for (const l of this.langs) {
      const T = LANG_TERMS[l];
      const base = this.mode === "focus" ? T.focus : T.q;
      const picks = [...base].sort(() => Math.random() - 0.5).slice(0, this.mode === "focus" ? 2 : 1);
      for (const b of picks) qs.push(`${b} ${this.mode === "focus" ? "" : flavour[Math.floor(Math.random() * flavour.length)]}`.trim());
      if (this.mode !== "focus" && Math.random() < 0.5) qs.push(`genre:"${T.genre[Math.floor(Math.random() * T.genre.length)]}"`);
    }
    const raw = (await Promise.all(qs.slice(0, 5).map((q) => this.search(q, 20, this.mode === "focus" ? 20 : 60)))).flat();
    if (this.mode === "focus") return this.instrumentalOnly(raw);
    return this.byLang(this.map(raw), true);
  }
  private played = new Set<string>();
  private queue: TrackInfo[] = [];
  private pools: Record<string, TrackInfo[]> = {};
  private round = 0;
  private artists: { id: string; name: string; genres: string[] }[] = [];
  private discP: Promise<TrackInfo[]> | null = null;

  private async safe(fn: () => Promise<TrackInfo[]>) {
    try { return await fn(); } catch { return []; }
  }
  private map(items: any[]) { return items.map(toTrack).filter(Boolean) as TrackInfo[]; }
  private searchBudget = 6; // searches per queue build
  private async search(q: string, _limit = 10, maxOffset = 60): Promise<any[]> {
    // One 10-result page (Spotify's cap), offsets on a coarse grid so the cache hits; results cached for 6h.
    const off = maxOffset ? 10 * Math.floor(Math.random() * Math.min(3, maxOffset / 10 + 1)) : 0;
    const key = `myrj.sq.${q}|${off}`;
    try { const c = JSON.parse(localStorage.getItem(key) ?? "null"); if (c && Date.now() - c.at < 6 * 3600e3) return c.items; } catch { /* ignore */ }
    if (this.searchBudget <= 0 || spotifyBackoffMs() > 0) return [];
    this.searchBudget--;
    try {
      const items = (await sp<any>(`/search?type=track&limit=10&offset=${off}&q=${encodeURIComponent(q)}`)).tracks?.items ?? [];
      try { localStorage.setItem(key, JSON.stringify({ at: Date.now(), items: items.map(slim) })); } catch { pruneSearchCache(); }
      return items;
    } catch { return []; }
  }

  /** Strict instrumental filter for Focus: audio-features if Spotify allows it, else text + artist-genre signals. Unsure = out. */
  private async instrumentalOnly(raw: any[]): Promise<TrackInfo[]> {
    const vocalTaste = new Set([...this.seeds, ...(this.pools.top ?? []), ...(this.pools.saved ?? [])].map((t) => t.uri));
    let items = raw.filter((t) => t?.type === "track" && t.uri && !vocalTaste.has(t.uri) && !VOCAL_RE.test(t.name ?? ""));
    const seen = new Set<string>(); items = items.filter((t) => !seen.has(t.uri) && seen.add(t.uri));
    if (!items.length) return [];
    if (audioFeaturesOk !== false) {
      try {
        const ids = items.map((t) => t.id).slice(0, 100);
        const j = await sp<any>(`/audio-features?ids=${ids.join(",")}`);
        const f = new Map<string, any>((j.audio_features ?? []).filter(Boolean).map((x: any) => [x.id, x]));
        if (f.size) {
          audioFeaturesOk = true;
          return this.map(items.filter((t) => { const x = f.get(t.id); return x && x.instrumentalness > 0.5 && x.speechiness < 0.33; }));
        }
      } catch { audioFeaturesOk = false; }
    }
    // Fallback: name/album/artist signals, or every artist tagged with an instrumental genre.
    const text = (t: any) => `${t.name} ${t.album?.name ?? ""} ${(t.artists ?? []).map((a: any) => a.name).join(" ")}`;
    const sure = items.filter((t) => INSTRUMENTAL_RE.test(text(t)));
    const unsure = items.filter((t) => !INSTRUMENTAL_RE.test(text(t)));
    let byGenre: any[] = [];
    if (unsure.length) {
      try {
        const ids = [...new Set(unsure.map((t) => t.artists?.[0]?.id).filter(Boolean))].slice(0, 50);
        const g = new Map<string, string[]>(((await sp<any>(`/artists?ids=${ids.join(",")}`)).artists ?? []).filter(Boolean).map((a: any) => [a.id, a.genres ?? []]));
        byGenre = unsure.filter((t) => { const gs = g.get(t.artists?.[0]?.id) ?? []; return gs.length > 0 && gs.some((x) => INSTRUMENTAL_GENRE_RE.test(x)) && !gs.some((x) => /pop|rap|hip hop$|filmi|vocal|singer/i.test(x) && !INSTRUMENTAL_GENRE_RE.test(x)); });
      } catch { /* no genres: unsure tracks stay out */ }
    }
    return this.map([...sure, ...byGenre]);
  }

  private async loadBase() {
    // Playlists are slow (one request each): load them in the background so the first songs come fast.
    const plsP = this.safe(async () => {
      const lists = (await getPlaylists()).slice(0, 4);
      const all = await Promise.all(lists.map((pl: { id: string }) => getTracks(pl.id).catch(() => [])));
      return all.flat();
    });
    plsP.then((pls) => { this.pools.playlists = pls; });
    const [s, m, l, saved, artists] = await Promise.all([
      this.safe(async () => this.map((await sp<any>("/me/top/tracks?limit=50&time_range=short_term")).items ?? [])),
      this.safe(async () => this.map((await sp<any>("/me/top/tracks?limit=50&time_range=medium_term")).items ?? [])),
      this.safe(async () => this.map((await sp<any>("/me/top/tracks?limit=50&time_range=long_term")).items ?? [])),
      this.safe(async () => {
        const offs = [0, 50];
        const pages = await Promise.all(offs.map((o) => sp<any>(`/me/tracks?limit=50&offset=${o}`).catch(() => ({ items: [] }))));
        return this.map(pages.flatMap((p) => (p.items ?? []).map((i: any) => i.track)));
      }),
      sp<any>("/me/top/artists?limit=20&time_range=medium_term").then((j) => j.items ?? []).catch(() => []),
    ]);
    this.pools = { top: [...s, ...m, ...l], saved, playlists: this.pools.playlists ?? [], seeds: this.seeds };
    this.artists = artists.map((a: any) => ({ id: a.id, name: a.name, genres: a.genres ?? [] }));
  }


  private async discovery(): Promise<TrackInfo[]> {
    // imported taste seeds guide discovery too: search their artists
    const seedArtists = [...new Set(this.seeds.map((t) => t.artists.split(",")[0].trim()))].sort(() => Math.random() - 0.5).slice(0, 2);
    const viaSeeds = (await Promise.all(seedArtists.map((a) => this.safe(async () =>
      this.map(await this.search(`artist:${a}`, 10, 0)))))).flat();
    if (!this.artists.length) return viaSeeds;
    const shuffled = [...this.artists].sort(() => Math.random() - 0.5).slice(0, 2);
    const results = await Promise.all(shuffled.map(async (a) => {
      const viaTop = await this.safe(async () => this.map((await sp<any>(`/artists/${a.id}/top-tracks?market=from_token`)).tracks ?? []));
      const genre = a.genres[Math.floor(Math.random() * a.genres.length)];
      const q = genre ? `genre:"${genre}"` : a.name;
      const viaSearch = this.map(await this.search(q, 10, 20));
      return [...viaTop.slice(0, 4), ...viaSearch];
    }));
    return [...viaSeeds, ...results.flat()];
  }

  private take(pool: TrackInfo[] | undefined, n: number) {
    const fresh = (pool ?? []).filter((t) => t.uri && !this.played.has(t.uri) && !this.queue.some((q) => q.uri === t.uri));
    return fresh.sort(() => Math.random() - 0.5).slice(0, n);
  }

  private async modeTracks(): Promise<TrackInfo[]> {
    if (this.mode === "default") return [];
    if (this.mode === "focus") {
      const qs = [...FOCUS_QUERIES].sort(() => Math.random() - 0.5).slice(0, 4);
      let raw = (await Promise.all(qs.map((q) => this.search(q, 20, 60)))).flat();
      let out = await this.instrumentalOnly(raw);
      if (out.length < 6) { // page offsets missed: retry the safest queries from the top
        raw = (await Promise.all(["instrumental lofi", "peaceful piano", "ambient instrumental"].map((q) => this.search(q, 20, 0)))).flat();
        out = [...out, ...(await this.instrumentalOnly(raw))];
      }
      return out;
    }
    const qs = [...MODE_QUERIES[this.mode as "gym" | "drive"]].sort(() => Math.random() - 0.5).slice(0, 3);
    return this.map((await Promise.all(qs.map((q) => this.search(q)))).flat());
  }

  private async refill() {
    this.searchBudget = 6;
    if (this.mode === "focus") {
      // Focus: instrumental only. Never fall back to vocal favourites. With song languages: instrumental takes on them.
      const modeT = this.langs.length ? await this.langTracks() : await this.modeTracks();
      this.round++;
      const batch = [...this.take(modeT, 12)].sort(() => Math.random() - 0.5);
      this.queue.push(...batch);
      if (!batch.length && this.played.size) this.played.clear();
      return;
    }
    const poolsEmpty = !Object.values(this.pools).some((p) => p?.length);
    if (this.round === 0 || poolsEmpty) await this.loadBase();
    this.round++;
    if (this.mode !== "default") {
      const flav = this.mode === "gym" ? ["workout", "party", "gym", ""] : ["road trip", "hits", "party", ""];
      const modeT = this.langs.length ? await this.langTracks(flav) : await this.modeTracks();
      const [top, saved, seeds] = await Promise.all([this.byLang(this.take(this.pools.top, 10), false), this.byLang(this.take(this.pools.saved, 6), false), this.byLang(this.take(this.pools.seeds, 6), false)]);
      const batch = [...this.take(modeT, 8), ...top.slice(0, 2), ...saved.slice(0, 1), ...seeds.slice(0, 1)].sort(() => Math.random() - 0.5);
      if (!batch.length) batch.push(...top.slice(0, 6), ...saved.slice(0, 6)); // mode search failed: fall back to (language-matching) favourites
      this.queue.push(...batch);
      if (!batch.length && this.played.size) this.played.clear();
      return;
    }
    // First batch: don't wait for discovery searches; they feed the next batch.
    let disc: TrackInfo[] = [];
    if (this.round <= 1) { this.discP = this.discovery().catch(() => []); }
    else { disc = await (this.discP ?? this.discovery()); this.discP = this.discovery().catch(() => []); }
    // Interleave: familiar favourites with ~1/3 discovery. With song languages, everything is language-filtered
    // and language searches stand in for most of the discovery.
    const L = this.langs.length > 0, k = L ? 3 : 1; // oversample before filtering
    const [langT, seeds, top, saved, pls, dsc] = await Promise.all([
      this.langTracks(["", "hits", "new", "romantic", "party"]),
      this.byLang(this.take(this.pools.seeds, (this.seeds.length ? 3 : 0) * k), false),
      this.byLang(this.take(this.pools.top, (this.seeds.length ? 3 : 4) * k), false),
      this.byLang(this.take(this.pools.saved, 3 * k), false),
      this.byLang(this.take(this.pools.playlists, 3 * k), false),
      this.byLang(this.take(disc, 5 * k), false),
    ]);
    const batch = [
      ...this.take(langT, L ? 6 : 0), ...seeds.slice(0, 3), ...top.slice(0, this.seeds.length ? 3 : 4), ...saved.slice(0, 3),
      ...pls.slice(0, L ? 2 : 3), ...dsc.slice(0, L ? 2 : 5),
    ].sort(() => Math.random() - 0.5);
    // Avoid two songs by the same artist back to back.
    for (let i = 1; i < batch.length; i++) if (batch[i].artists === batch[i - 1].artists) batch.push(...batch.splice(i, 1));
    this.queue.push(...batch);
    if (!batch.length && this.played.size) this.played.clear(); // exhausted everything: allow repeats rather than stop
  }

  async next(): Promise<TrackInfo | null> {
    for (let tries = 0; this.queue.length < 3 && tries < 2 && !spotifyBackoffMs(); tries++) {
      try { await this.refill(); } catch { await new Promise((r) => setTimeout(r, 1500)); }
    }
    if (!this.queue.length) {
      // Never block start: the language filter (or every search) came up empty, so relax it and play favourites.
      const relaxed = [...this.take(this.pools.top, 6), ...this.take(this.pools.saved, 4), ...this.take(this.pools.seeds, 3), ...this.take(this.pools.playlists, 3)];
      this.queue.push(...relaxed.sort(() => Math.random() - 0.5));
      if (relaxed.length) this.relaxed = true;
    }
    const t = this.queue.shift() ?? null;
    if (t?.uri) this.played.add(t.uri);
    return t;
  }
  relaxed = false;
  peek() { return this.queue[0] ?? null; }
}
