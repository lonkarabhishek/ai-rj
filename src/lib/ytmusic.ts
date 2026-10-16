// YouTube as a playback source (server side). Quota-aware: list calls cost 1 unit, search costs 100.
import { readYoutubePlaylist, youtubeListId } from "@/lib/linkimport";

export interface YtVideo { id: string; title: string; channel: string; seconds: number; image?: string; audioLang?: string; topic?: boolean; lang?: string; src?: "like" | "playlist" | "link" }

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
      if (/\b(full album|compilation|jukebox|non[- ]?stop|reaction|reacts?|live ?stream|livestream|podcast|interview|trailer|full movie|\d+ hours?)\b/i.test(v.snippet?.title ?? "") || v.snippet?.liveBroadcastContent === "live" || v.snippet?.liveBroadcastContent === "upcoming") continue;
      if (sec < 60 || (!allowLong && sec > 600)) continue;
      out.push({ id: v.id, title: v.snippet?.title ?? "", channel: (v.snippet?.channelTitle ?? "").replace(/\s*-\s*Topic$/i, ""), seconds: sec, image: v.snippet?.thumbnails?.high?.url ?? v.snippet?.thumbnails?.medium?.url,
        audioLang: (v.snippet?.defaultAudioLanguage ?? v.snippet?.defaultLanguage ?? "").toLowerCase() || undefined, topic: / - Topic$/i.test(v.snippet?.channelTitle ?? "") });
    }
  }
  return out;
}

const MUSICY = /official (music )?video|lyric|audio|song|feat\.|ft\.|remix|\bmv\b/i;
/** His likes (music: category 10, Topic/VEVO channels or music-looking titles) + up to 15 of his playlists (~20 units), languages tagged. */
export async function ytPool(token: string): Promise<YtVideo[]> {
  const likes = new Set<string>(), pl = new Set<string>();
  let page = "";
  for (let i = 0; i < 4; i++) {
    const j = await yt<{ items: any[]; nextPageToken?: string }>(`videos?myRating=like&part=snippet&maxResults=50${page && `&pageToken=${page}`}`, token).catch(() => ({ items: [] as any[], nextPageToken: undefined }));
    for (const v of j.items) { const sn = v.snippet ?? {}; if (sn.categoryId === "10" || / - Topic$|VEVO$/i.test(sn.channelTitle ?? "") || MUSICY.test(sn.title ?? "")) likes.add(v.id); }
    if (!j.nextPageToken) break; page = j.nextPageToken;
  }
  const pls = await yt<{ items: { id: string }[] }>("playlists?mine=true&part=id&maxResults=50", token).catch(() => ({ items: [] }));
  await Promise.all(pls.items.slice(0, 15).map(async (p) => {
    const j = await yt<{ items: any[] }>(`playlistItems?playlistId=${p.id}&part=contentDetails&maxResults=50`, token).catch(() => ({ items: [] }));
    for (const it of j.items) if (it.contentDetails?.videoId) pl.add(it.contentDetails.videoId);
  }));
  const ids = [...new Set([...likes, ...pl])].slice(0, 400);
  const vids = (await details(ids, token)).map((v) => ({ ...v, src: likes.has(v.id) ? "like" as const : "playlist" as const }));
  return tagLangs(vids);
}

const LANGS = ["english", "hindi", "punjabi", "marathi", "tamil", "telugu"];
/** One Claude Haiku call labels each song's sung language (strict filter needs a positive signal; titles rarely carry one). Unknown stays unlabelled. */
export async function tagLangs(vids: YtVideo[]): Promise<YtVideo[]> {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key || !vids.length) return vids;
  const out = vids.map((v) => ({ ...v }));
  for (let i = 0; i < out.length; i += 150) {
    const chunk = out.slice(i, i + 150);
    try {
      const r = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST", signal: AbortSignal.timeout(25000),
        headers: { "x-api-key": key, "anthropic-version": "2023-06-01", "content-type": "application/json" },
        body: JSON.stringify({ model: process.env.ANTHROPIC_MODEL || "claude-haiku-5-5", max_tokens: 4096, thinking: { type: "disabled" },
          messages: [{ role: "user", content: `For each YouTube song below (index|title|channel), give the language its vocals are sung in: one of ${LANGS.join(", ")}, "instrumental", "other", or "unknown" if you are not confident. Return ONLY a JSON object mapping index to label.\n\n${chunk.map((v, k) => `${k}|${v.title}|${v.channel}`).join("\n")}` }] }),
      });
      if (!r.ok) continue;
      const j = await r.json();
      const t = (j.content ?? []).filter((c: { type: string }) => c.type === "text").map((c: { text: string }) => c.text).join("");
      const m = JSON.parse(t.slice(t.indexOf("{"), t.lastIndexOf("}") + 1) || "{}") as Record<string, string>;
      chunk.forEach((v, k) => { const l = String(m[k] ?? "").toLowerCase(); if (LANGS.includes(l) || l === "instrumental" || l === "other") v.lang = l; });
    } catch { /* unlabelled → falls back to title/channel signals */ }
  }
  return out;
}

/** One search (100 units) + one videos.list (1 unit). Music category, embeddable only. */
export async function ytSearch(q: string, token: string | null, focus = false): Promise<YtVideo[]> {
  const j = await yt<{ items: any[] }>(`search?part=id&type=video&videoCategoryId=10&videoEmbeddable=true&videoSyndicated=true&safeSearch=none&maxResults=25&q=${encodeURIComponent(q)}`, token);
  return tagLangs(await details(j.items.map((x) => x.id?.videoId).filter(Boolean), token, focus));
}

/** Imported YouTube / YouTube Music playlist links: read the public page (no API quota). */
export async function ytLinks(urls: string[]): Promise<YtVideo[]> {
  const out: YtVideo[] = [];
  for (const u of urls.slice(0, 10)) {
    const id = youtubeListId(u); if (!id) continue;
    const songs = await readYoutubePlaylist(id).catch(() => []);
    for (const s of songs) if (s.videoId && (!s.seconds || (s.seconds >= 60 && s.seconds <= 600))) out.push({ id: s.videoId, title: s.title, channel: s.artist, seconds: s.seconds ?? 0, image: `https://i.ytimg.com/vi/${s.videoId}/hqdefault.jpg`, src: "link" });
  }
  return tagLangs(out);
}
