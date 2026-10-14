"use client";
import type { TrackInfo } from "./prefs";

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
