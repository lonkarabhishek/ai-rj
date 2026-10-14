"use client";
import type { ListenMode, TrackInfo } from "./prefs";

export async function getToken(): Promise<string | null> {
  const r = await fetch("/api/spotify/token", { cache: "no-store" });
  if (!r.ok) return null;
  return (await r.json()).accessToken ?? null;
}

export async function sp<T = unknown>(path: string, init: RequestInit = {}): Promise<T> {
  const token = await getToken();
  if (!token) throw new Error("Spotify not connected");
  const r = await fetch(`https://api.spotify.com/v1${path}`, {
    ...init,
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json", ...(init.headers ?? {}) },
  });
  if (r.status === 204) return undefined as T;
  if (!r.ok) throw new Error(`Spotify ${r.status}: ${(await r.text()).slice(0, 200)}`);
  const text = await r.text();
  return (text ? JSON.parse(text) : undefined) as T;
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

export class Curator {
  constructor(private mode: ListenMode = "default") {}
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
    this.pools = { top: [...s, ...m, ...l], saved, playlists: pls };
    this.artists = artists.map((a: any) => ({ id: a.id, name: a.name, genres: a.genres ?? [] }));
  }

  private async discovery(): Promise<TrackInfo[]> {
    if (!this.artists.length) return [];
    const shuffled = [...this.artists].sort(() => Math.random() - 0.5).slice(0, 3);
    const results = await Promise.all(shuffled.map(async (a) => {
      const viaTop = await this.safe(async () => this.map((await sp<any>(`/artists/${a.id}/top-tracks?market=from_token`)).tracks ?? []));
      const genre = a.genres[Math.floor(Math.random() * a.genres.length)];
      const q = genre ? `genre:"${genre}"` : a.name;
      const viaSearch = await this.safe(async () => this.map((await sp<any>(`/search?type=track&limit=20&offset=${Math.floor(Math.random() * 100)}&q=${encodeURIComponent(q)}`)).tracks?.items ?? []));
      return [...viaTop.slice(0, 4), ...viaSearch];
    }));
    return results.flat();
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
    if (this.round === 0 && this.mode !== "focus") await this.loadBase();
    this.round++;
    if (this.mode !== "default") {
      const modeT = await this.modeTracks();
      const batch = this.mode === "focus"
        ? this.take(modeT, 12) // focus: only instrumental-style tracks, no lyrics-heavy favourites
        : [...this.take(modeT, 8), ...this.take(this.pools.top, 2), ...this.take(this.pools.saved, 2)].sort(() => Math.random() - 0.5);
      this.queue.push(...batch);
      if (!batch.length && this.played.size) this.played.clear();
      return;
    }
    const disc = await this.discovery();
    // Interleave: familiar favourites with ~1/3 discovery.
    const batch = [
      ...this.take(this.pools.top, 4), ...this.take(this.pools.saved, 3),
      ...this.take(this.pools.playlists, 3), ...this.take(disc, 5),
    ].sort(() => Math.random() - 0.5);
    // Avoid two songs by the same artist back to back.
    for (let i = 1; i < batch.length; i++) if (batch[i].artists === batch[i - 1].artists) batch.push(...batch.splice(i, 1));
    this.queue.push(...batch);
    if (!batch.length && this.played.size) this.played.clear(); // exhausted everything: allow repeats rather than stop
  }

  async next(): Promise<TrackInfo | null> {
    for (let tries = 0; this.queue.length < 3 && tries < 3; tries++) await this.refill();
    const t = this.queue.shift() ?? null;
    if (t?.uri) this.played.add(t.uri);
    return t;
  }
  peek() { return this.queue[0] ?? null; }
}
