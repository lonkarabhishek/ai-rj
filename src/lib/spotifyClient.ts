"use client";
import type { ListenMode, TrackInfo } from "./prefs";

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

/** Spotify Web API call with token refresh on 401, Retry-After on 429, and backoff on network/5xx errors. */
export async function sp<T = unknown>(path: string, init: RequestInit = {}): Promise<T> {
  let lastErr: unknown;
  for (let attempt = 0; attempt < 4; attempt++) {
    const token = await getToken(attempt > 0 && lastErr instanceof SpotifyError && lastErr.status === 401);
    if (!token) throw new SpotifyError(401, "not connected");
    let r: Response;
    try {
      r = await fetch(`https://api.spotify.com/v1${path}`, {
        ...init,
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json", ...(init.headers ?? {}) },
      });
    } catch (e) { lastErr = e; await wait(1000 * 2 ** attempt); continue; }
    if (r.status === 204 || r.status === 202) return undefined as T;
    if (r.ok) { const text = await r.text(); return (text ? JSON.parse(text) : undefined) as T; }
    const body = (await r.text()).slice(0, 200);
    lastErr = new SpotifyError(r.status, body);
    if (r.status === 401) continue; // refresh token and retry
    if (r.status === 429) { await wait(Math.min(30, Number(r.headers.get("Retry-After") ?? 2)) * 1000); continue; }
    if (r.status >= 500) { await wait(1000 * 2 ** attempt); continue; }
    throw lastErr; // 400/403/404: caller decides
  }
  throw lastErr instanceof Error ? lastErr : new Error(String(lastErr));
}

/* eslint-disable @typescript-eslint/no-explicit-any */
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
const MODE_QUERIES: Record<Exclude<ListenMode, "default">, string[]> = {
  gym: ["workout motivation", "gym hype", "beast mode", "running anthems", "bollywood workout", "edm workout", "hip hop workout"],
  drive: ["road trip singalong", "bollywood road trip", "feel good hits", "summer drive", "punjabi party", "throwback singalong"],
  focus: ["lofi beats", "instrumental focus", "deep focus", "piano focus", "ambient study", "lofi hindi instrumental", "chillhop"],
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

export class Curator {
  constructor(private mode: ListenMode = "default", private seeds: TrackInfo[] = []) {}
  private played = new Set<string>();
  private queue: TrackInfo[] = [];
  private pools: Record<string, TrackInfo[]> = {};
  private round = 0;
  private artists: { id: string; name: string; genres: string[] }[] = [];

  private async safe(fn: () => Promise<TrackInfo[]>) {
    try { return await fn(); } catch { return []; }
  }
  private map(items: any[]) { return items.map(toTrack).filter(Boolean) as TrackInfo[]; }

  private async loadBase() {
    const [s, m, l, saved, pls, artists] = await Promise.all([
      this.safe(async () => this.map((await sp<any>("/me/top/tracks?limit=50&time_range=short_term")).items ?? [])),
      this.safe(async () => this.map((await sp<any>("/me/top/tracks?limit=50&time_range=medium_term")).items ?? [])),
      this.safe(async () => this.map((await sp<any>("/me/top/tracks?limit=50&time_range=long_term")).items ?? [])),
      this.safe(async () => {
        const offs = [0, 50, 100, 150];
        const pages = await Promise.all(offs.map((o) => sp<any>(`/me/tracks?limit=50&offset=${o}`).catch(() => ({ items: [] }))));
        return this.map(pages.flatMap((p) => (p.items ?? []).map((i: any) => i.track)));
      }),
      this.safe(async () => {
        const lists = (await getPlaylists()).slice(0, 8);
        const all = await Promise.all(lists.map((pl: { id: string }) => getTracks(pl.id).catch(() => [])));
        return all.flat();
      }),
      sp<any>("/me/top/artists?limit=20&time_range=medium_term").then((j) => j.items ?? []).catch(() => []),
    ]);
    this.pools = { top: [...s, ...m, ...l], saved, playlists: pls, seeds: this.seeds };
    this.artists = artists.map((a: any) => ({ id: a.id, name: a.name, genres: a.genres ?? [] }));
  }

  private async discovery(): Promise<TrackInfo[]> {
    // imported taste seeds guide discovery too: search their artists
    const seedArtists = [...new Set(this.seeds.map((t) => t.artists.split(",")[0].trim()))].sort(() => Math.random() - 0.5).slice(0, 2);
    const viaSeeds = (await Promise.all(seedArtists.map((a) => this.safe(async () =>
      this.map((await sp<any>(`/search?type=track&limit=10&q=${encodeURIComponent(`artist:${a}`)}`)).tracks?.items ?? []))))).flat();
    if (!this.artists.length) return viaSeeds;
    const shuffled = [...this.artists].sort(() => Math.random() - 0.5).slice(0, 3);
    const results = await Promise.all(shuffled.map(async (a) => {
      const viaTop = await this.safe(async () => this.map((await sp<any>(`/artists/${a.id}/top-tracks?market=from_token`)).tracks ?? []));
      const genre = a.genres[Math.floor(Math.random() * a.genres.length)];
      const q = genre ? `genre:"${genre}"` : a.name;
      const viaSearch = await this.safe(async () => this.map((await sp<any>(`/search?type=track&limit=20&offset=${Math.floor(Math.random() * 100)}&q=${encodeURIComponent(q)}`)).tracks?.items ?? []));
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
    const qs = [...MODE_QUERIES[this.mode]].sort(() => Math.random() - 0.5).slice(0, 3);
    const res = await Promise.all(qs.map((q) => this.safe(async () =>
      this.map((await sp<any>(`/search?type=track&limit=20&offset=${Math.floor(Math.random() * 60)}&q=${encodeURIComponent(q)}`)).tracks?.items ?? []))));
    let tracks = res.flat();
    if (this.mode === "focus") {
      // No audio-features for new apps: keep tracks that look instrumental/lofi by name, else trust the query.
      const looks = tracks.filter((t) => /lo-?fi|instrumental|piano|ambient|beats|study|focus|chill/i.test(`${t.name} ${t.artists}`));
      if (looks.length >= 5) tracks = looks;
    }
    return tracks;
  }

  private async refill() {
    const poolsEmpty = !Object.values(this.pools).some((p) => p?.length);
    if ((this.round === 0 || poolsEmpty) && (this.mode !== "focus" || poolsEmpty && this.round > 1)) await this.loadBase();
    this.round++;
    if (this.mode !== "default") {
      const modeT = await this.modeTracks();
      const batch = this.mode === "focus"
        ? this.take(modeT, 12) // focus: only instrumental-style tracks, no lyrics-heavy favourites
        : [...this.take(modeT, 8), ...this.take(this.pools.top, 2), ...this.take(this.pools.saved, 1), ...this.take(this.pools.seeds, 1)].sort(() => Math.random() - 0.5);
      if (!batch.length) batch.push(...this.take(this.pools.top, 6), ...this.take(this.pools.saved, 6)); // mode search failed: fall back to favourites
      this.queue.push(...batch);
      if (!batch.length && this.played.size) this.played.clear();
      return;
    }
    const disc = await this.discovery();
    // Interleave: familiar favourites with ~1/3 discovery.
    const batch = [
      ...this.take(this.pools.seeds, this.seeds.length ? 3 : 0),
      ...this.take(this.pools.top, this.seeds.length ? 3 : 4), ...this.take(this.pools.saved, 3),
      ...this.take(this.pools.playlists, 3), ...this.take(disc, 5),
    ].sort(() => Math.random() - 0.5);
    // Avoid two songs by the same artist back to back.
    for (let i = 1; i < batch.length; i++) if (batch[i].artists === batch[i - 1].artists) batch.push(...batch.splice(i, 1));
    this.queue.push(...batch);
    if (!batch.length && this.played.size) this.played.clear(); // exhausted everything: allow repeats rather than stop
  }

  async next(): Promise<TrackInfo | null> {
    for (let tries = 0; this.queue.length < 3 && tries < 3; tries++) {
      try { await this.refill(); } catch { await new Promise((r) => setTimeout(r, 1500)); }
    }
    const t = this.queue.shift() ?? null;
    if (t?.uri) this.played.add(t.uri);
    return t;
  }
  peek() { return this.queue[0] ?? null; }
}
