// Turns messy YouTube titles/channels into a clean "title / artist" pair (for cover art, lyrics and the DJ). Safe on client and server.

const NOISE = /\s*[([](?:official|lyric|lyrics|letra|audio|video|videoclip|full|hd|4k|hq|visualizer|music video|mv|en vivo|live|remaster(?:ed)?|explicit|clean)[^)\]]*[)\]]/gi;
const TRAIL = /\s*(?:\||｜|•|\/\/).*$/; // "Song | Album | Label"
const FEAT = /\s*[([]?\s*(?:feat\.?|ft\.?|featuring|con|with)\s+[^)\]]*[)\]]?\s*$/i;

export function cleanArtist(a: string): string {
  return (a || "")
    .replace(/\s*-\s*Topic$/i, "")
    .replace(/VEVO$/i, "")
    .replace(/\s*(official|oficial)(\s+(music|channel|account|youtube))?\s*$/i, "")
    .trim()
    .replace(/^(.+\S)\s+(music|records|tv)$/i, "$1"); // "Jhexx Music" → "Jhexx", but a one-word name stays
}

export function cleanTitle(t: string): string {
  return (t || "").replace(NOISE, "").replace(TRAIL, "").replace(/\s{2,}/g, " ").replace(/["“”]/g, "").trim();
}

/** Best guess at {title, artist}. YouTube titles are often "Artist - Song (Official Video)" with a label as the channel. */
export function songMeta(rawTitle: string, rawArtist = ""): { title: string; artist: string } {
  let title = cleanTitle(rawTitle);
  let artist = cleanArtist(rawArtist);
  const m = title.match(/^(.{1,80}?)\s+[-–—]\s+(.{1,120})$/);
  if (m) {
    const [, left, right] = m;
    // "Artist - Song" is by far the common shape; trust it unless the right side is clearly the channel name.
    if (!artist || !right.toLowerCase().includes(artist.toLowerCase())) { artist = left.trim(); title = right.trim(); }
    else { title = left.trim(); }
  }
  title = title.replace(FEAT, "").trim() || title;
  return { title: title.slice(0, 120), artist: artist.slice(0, 80) };
}

/** Lower-case word set, for fuzzy matching search results. */
export function words(s: string): Set<string> {
  return new Set(s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9ऀ-ॿ\s]/g, " ").split(/\s+/).filter((w) => w.length > 1));
}
export function overlap(a: string, b: string): number {
  const A = words(a), B = words(b);
  if (!A.size || !B.size) return 0;
  let n = 0; for (const w of A) if (B.has(w)) n++;
  return n / Math.min(A.size, B.size);
}
