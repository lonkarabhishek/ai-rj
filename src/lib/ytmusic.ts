// YouTube as a playback source (server side). Quota-aware: list calls cost 1 unit, search costs 100.
import { readYoutubePlaylist, youtubeListId } from "@/lib/linkimport";

export interface YtVideo { id: string; title: string; channel: string; seconds: number; image?: string; audioLang?: string; topic?: boolean }

async function yt<T>(path: string, token: string | null): Promise<T> {
  const key = process.env.YOUTUBE_API_KEY;
  const url = `https://www.googleapis.com/youtube/v3/${path}${!token && key ? `&key=${key}` : ""}`;
  const r = await fetch(url, { headers: token ? { Authorization: `Bearer ${token}` } : {}, signal: AbortSignal.timeout(10000) });
  if (!r.ok) throw new Error(`YouTube ${r.status}: ${(await r.text()).slice(0, 200)}`);
  return r.json() as Promise<T>;
}
const iso = (d = "") => { const m = d.match(/PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/); return m ? (+(m[1] ?? 0)) * 3600 + (+(m[2] ?? 0)) * 60 + (+(m[3] ?? 0)) : 0; };

/** videos.list (1 unit per 50 ids): keep embeddable, not age-restricted, 1-10 min (any length ≥1 min if long is allowed). */
export async function details(ids: string[], token: string | null, allowLong = false): Promise<YtVideo[]> {
  const out: YtVideo[] = [];
  for (let i = 0; i < ids.length; i += 50) {
    const j = await yt<{ items: any[] }>(`videos?part=snippet,contentDetails,status&id=${ids.slice(i, i + 50).join(",")}&maxResults=50`, token).catch(() => ({ items: [] }));
    for (const v of j.items) {
      const sec = iso(v.contentDetails?.duration);
      if (!v.status?.embeddable || v.contentDetails?.contentRating?.ytRating === "ytAgeRestricted" || v.status?.privacyStatus === "private") continue;
      if (sec < 60 || (!allowLong && sec > 600)) continue;
      out.push({ id: v.id, title: v.snippet?.title ?? "", channel: (v.snippet?.channelTitle ?? "").replace(/\s*-\s*Topic$/i, ""), seconds: sec, image: v.snippet?.thumbnails?.high?.url ?? v.snippet?.thumbnails?.medium?.url,
        audioLang: (v.snippet?.defaultAudioLanguage ?? v.snippet?.defaultLanguage ?? "").toLowerCase() || undefined, topic: / - Topic$/i.test(v.snippet?.channelTitle ?? "") });
    }
  }
  return out;
}

/** His likes (music only) + up to 6 of his playlists: ~2 + 1 + 6 + ~4 units. */
export async function ytPool(token: string): Promise<YtVideo[]> {
  const ids = new Set<string>();
  let page = "";
  for (let i = 0; i < 2; i++) {
    const j = await yt<{ items: any[]; nextPageToken?: string }>(`videos?myRating=like&part=snippet&maxResults=50${page && `&pageToken=${page}`}`, token).catch(() => ({ items: [] as any[], nextPageToken: undefined }));
    for (const v of j.items) if (v.snippet?.categoryId === "10") ids.add(v.id);
    if (!j.nextPageToken) break; page = j.nextPageToken;
  }
  const pls = await yt<{ items: { id: string }[] }>("playlists?mine=true&part=id&maxResults=25", token).catch(() => ({ items: [] }));
  for (const pl of pls.items.slice(0, 6)) {
    const j = await yt<{ items: any[] }>(`playlistItems?playlistId=${pl.id}&part=contentDetails&maxResults=50`, token).catch(() => ({ items: [] }));
    for (const it of j.items) if (it.contentDetails?.videoId) ids.add(it.contentDetails.videoId);
  }
  return details([...ids].slice(0, 200), token);
}

/** One search (100 units) + one videos.list (1 unit). Music category, embeddable only. */
export async function ytSearch(q: string, token: string | null, focus = false): Promise<YtVideo[]> {
  const j = await yt<{ items: any[] }>(`search?part=id&type=video&videoCategoryId=10&videoEmbeddable=true&videoSyndicated=true&safeSearch=none&maxResults=25&q=${encodeURIComponent(q)}`, token);
  return details(j.items.map((x) => x.id?.videoId).filter(Boolean), token, focus);
}

/** Imported YouTube / YouTube Music playlist links: read the public page (no API quota). */
export async function ytLinks(urls: string[]): Promise<YtVideo[]> {
  const out: YtVideo[] = [];
  for (const u of urls.slice(0, 6)) {
    const id = youtubeListId(u); if (!id) continue;
    const songs = await readYoutubePlaylist(id).catch(() => []);
    for (const s of songs) if (s.videoId && (!s.seconds || (s.seconds >= 60 && s.seconds <= 600))) out.push({ id: s.videoId, title: s.title, channel: s.artist, seconds: s.seconds ?? 0, image: `https://i.ytimg.com/vi/${s.videoId}/hqdefault.jpg` });
  }
  return out;
}
