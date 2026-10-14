// Server-side readers for playlist links. YouTube/YouTube Music are parsed directly (no LLM needed).
export interface Song { title: string; artist: string; videoId?: string; seconds?: number }

const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0 Safari/537.36";

export function cleanTitle(raw: string): string {
  return raw
    .replace(/\s*[([](?:official|lyric|lyrics|audio|video|full|hd|4k|visualizer|music video|from)[^)\]]*[)\]]/gi, "")
    .replace(/\s*\|.*$/, "")
    .replace(/\s*(?:official (?:music )?video|full (?:video )?song|lyrical(?: video)?|lyrics?)\s*$/i, "")
    .replace(/\s+/g, " ").trim();
}
function cleanArtist(a: string) {
  return a.replace(/\s*-\s*Topic$/i, "").replace(/VEVO$/i, "").split(/,|&| x | feat\.? /i)[0].trim();
}
/** Split "Artist - Title" when the uploader is a label/channel rather than the artist. */
export function toSong(title: string, channel: string): Song | null {
  let t = cleanTitle(title), a = cleanArtist(channel);
  const label = /t-series|zee music|sony music|saregama|tips|yrf|speed records|eros|times music|desi melodies|vevo|records|music$/i.test(channel);
  const dash = t.match(/^(.+?)\s+[-–]\s+(.+)$/);
  if (dash && (label || dash[1].toLowerCase().includes(a.toLowerCase()) || !a)) { a = cleanArtist(dash[1]); t = cleanTitle(dash[2]); }
  else if (dash && dash[2].toLowerCase().includes(a.toLowerCase())) t = cleanTitle(dash[1]);
  if (label && !dash) a = "";
  return t ? { title: t, artist: a } : null;
}

export function youtubeListId(url: string): string | null {
  try {
    const u = new URL(url);
    if (!/(^|\.)youtube\.com$|(^|\.)youtu\.be$/.test(u.hostname)) return null;
    return u.searchParams.get("list");
  } catch { return null; }
}

export async function readYoutubePlaylist(listId: string): Promise<Song[]> {
  const songs: Song[] = [];
  // 1) Playlist page: ytInitialData (lockupViewModel in new layout, playlistVideoRenderer in old)
  try {
    const r = await fetch(`https://www.youtube.com/playlist?list=${encodeURIComponent(listId)}&hl=en`, {
      headers: { "User-Agent": UA, "Accept-Language": "en-US,en;q=0.9", Cookie: "CONSENT=YES+1" }, signal: AbortSignal.timeout(10000),
    });
    const html = await r.text();
    const m = html.match(/var ytInitialData = (\{[\s\S]*?\});<\/script>/) ?? html.match(/ytInitialData"\]\s*=\s*(\{[\s\S]*?\});/);
    if (m) {
      const data = JSON.parse(m[1]);
      const walk = (o: unknown): void => {
        if (!o || typeof o !== "object") return;
        if (Array.isArray(o)) { o.forEach(walk); return; }
        const rec = o as Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
        if (rec.playlistVideoRenderer) {
          const v = rec.playlistVideoRenderer;
          const s = toSong(v.title?.runs?.[0]?.text ?? v.title?.simpleText ?? "", v.shortBylineText?.runs?.[0]?.text ?? "");
          if (s) songs.push({ ...s, videoId: v.videoId, seconds: Number(v.lengthSeconds) || undefined });
        } else if (rec.lockupViewModel && JSON.stringify(rec.lockupViewModel).includes(listId)) {
          const md = rec.lockupViewModel.metadata?.lockupMetadataViewModel;
          const rows = md?.metadata?.contentMetadataViewModel?.metadataRows ?? [];
          const s = toSong(md?.title?.content ?? "", rows[0]?.metadataParts?.[0]?.text?.content ?? "");
          if (s) songs.push({ ...s, videoId: rec.lockupViewModel.contentId });
        } else Object.values(rec).forEach(walk);
      };
      walk(data);
    }
  } catch { /* fall through to RSS */ }
  // 2) RSS feed (first 15) as fallback / top-up
  try {
    const r = await fetch(`https://www.youtube.com/feeds/videos.xml?playlist_id=${encodeURIComponent(listId)}`, { headers: { "User-Agent": UA }, signal: AbortSignal.timeout(8000) });
    if (r.ok) {
      const xml = await r.text();
      for (const e of xml.split("<entry>").slice(1)) {
        const dec = (x = "") => x.replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">");
        const s = toSong(dec(e.match(/<title>([^<]*)<\/title>/)?.[1]), dec(e.match(/<author>\s*<name>([^<]*)<\/name>/)?.[1]));
        if (s) songs.push({ ...s, videoId: e.match(/<yt:videoId>([^<]*)</)?.[1] });
      }
    }
  } catch { /* ignore */ }
  const seen = new Set<string>();
  return songs.filter((s) => { const k = s.title.toLowerCase(); if (seen.has(k)) return false; seen.add(k); return true; });
}
