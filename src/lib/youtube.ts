// YouTube connect: Google OAuth (youtube.readonly) -> liked music videos + your playlists as taste seeds.
import { cookies } from "next/headers";
import { cookieOpts } from "@/lib/spotify";
import { currentUserId } from "@/lib/supabase/server";
import { loadProviderToken } from "@/lib/tokens";
import { toSong, type Song } from "@/lib/linkimport";

export const YT_SCOPE = "https://www.googleapis.com/auth/youtube.readonly";
export const youtubeEnabled = () => !!(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET);
export const ytRedirect = (origin: string) => process.env.GOOGLE_REDIRECT_URI || `${origin}/api/auth/callback/youtube`;

export async function googleToken(params: Record<string, string>) {
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ client_id: process.env.GOOGLE_CLIENT_ID!, client_secret: process.env.GOOGLE_CLIENT_SECRET!, ...params }),
  });
  if (!res.ok) throw new Error(`Google token error ${res.status}: ${(await res.text()).slice(0, 200)}`);
  return (await res.json()) as { access_token: string; expires_in: number; refresh_token?: string; scope?: string };
}

export async function ytAccessToken(): Promise<string | null> {
  const jar = await cookies();
  const at = jar.get("yt_at")?.value;
  if (at) return at;
  let rt = jar.get("yt_rt")?.value;
  if (!rt) { const uid = await currentUserId(); rt = uid ? (await loadProviderToken(uid, "google"))?.refreshToken : undefined; }
  if (!rt) return null;
  const t = await googleToken({ grant_type: "refresh_token", refresh_token: rt });
  jar.set("yt_at", t.access_token, { ...cookieOpts(), maxAge: t.expires_in - 60 });
  jar.set("yt_rt", rt, { ...cookieOpts(), maxAge: 60 * 60 * 24 * 180 });
  return t.access_token;
}

type Snip = { title: string; videoOwnerChannelTitle?: string; channelTitle?: string; categoryId?: string };
async function yt<T>(token: string, path: string): Promise<T> {
  const r = await fetch(`https://www.googleapis.com/youtube/v3/${path}`, { headers: { Authorization: `Bearer ${token}` } });
  if (!r.ok) throw new Error(`YouTube ${r.status}: ${(await r.text()).slice(0, 200)}`);
  return r.json() as Promise<T>;
}

export async function youtubeSongs(token: string, max = 150): Promise<{ songs: Song[]; liked: number; playlists: number }> {
  const out: Song[] = [], seen = new Set<string>();
  const add = (s: Snip) => {
    if (/^(private|deleted) video$/i.test(s.title)) return;
    const song = toSong(s.title, s.videoOwnerChannelTitle ?? s.channelTitle ?? "");
    const k = song?.title.toLowerCase();
    if (song && k && !seen.has(k)) { seen.add(k); out.push(song); }
  };
  // Liked videos, music category only (so vlogs/tutorials don't pollute your radio).
  let page = "", liked = 0;
  for (let i = 0; i < 4 && out.length < max; i++) {
    const j = await yt<{ items: { snippet: Snip }[]; nextPageToken?: string }>(token, `videos?myRating=like&part=snippet&maxResults=50${page && `&pageToken=${page}`}`);
    for (const it of j.items) if (it.snippet.categoryId === "10") { add(it.snippet); liked++; }
    if (!j.nextPageToken) break; page = j.nextPageToken;
  }
  const pls = await yt<{ items: { id: string }[] }>(token, "playlists?mine=true&part=id&maxResults=25").catch(() => ({ items: [] }));
  for (const pl of pls.items) {
    if (out.length >= max) break;
    const j = await yt<{ items: { snippet: Snip }[] }>(token, `playlistItems?playlistId=${pl.id}&part=snippet&maxResults=50`).catch(() => ({ items: [] }));
    j.items.forEach((it) => add(it.snippet));
  }
  return { songs: out.slice(0, max), liked, playlists: pls.items.length };
}
