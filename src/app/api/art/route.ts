import { guard, str } from "@/lib/guard";
import { overlap, songMeta } from "@/lib/songmeta";

/** GET ?title=&artist= → {art, album, title, artist} from the iTunes Search API (free, no key). art is null when nothing matches well. */
type It = { trackName?: string; artistName?: string; collectionName?: string; artworkUrl100?: string };
const cache = new Map<string, { at: number; v: unknown }>();

export async function GET(req: Request) {
  const no = guard(req, "art", 120); if (no) return no;
  const u = new URL(req.url);
  const { title, artist } = songMeta(str(u.searchParams.get("title"), 200), str(u.searchParams.get("artist"), 120));
  if (!title) return Response.json({ art: null });
  const key = `${title}|${artist}`.toLowerCase();
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < 24 * 3600_000) return Response.json(hit.v);
  let out: { art: string | null; album?: string; title: string; artist: string } = { art: null, title, artist };
  try {
    const q = new URLSearchParams({ term: `${artist} ${title}`.trim().slice(0, 150), media: "music", entity: "song", limit: "10" });
    const r = await fetch(`https://itunes.apple.com/search?${q}`, { signal: AbortSignal.timeout(5000), headers: { "User-Agent": "MyRJ/1.0" } });
    if (r.ok) {
      const j = (await r.json()) as { results?: It[] };
      let best: It | null = null, top = 0;
      for (const it of j.results ?? []) {
        const s = overlap(title, it.trackName ?? "") * 2 + (artist ? overlap(artist, it.artistName ?? "") : 0.5);
        if (s > top) { top = s; best = it; }
      }
      // Needs a real title match (and an artist match when we know the artist), or the art would belong to another song.
      if (best?.artworkUrl100 && top >= (artist ? 2 : 1.5)) out = { art: best.artworkUrl100.replace(/\/\d+x\d+bb\./, "/600x600bb."), album: best.collectionName, title, artist };
    }
  } catch { /* art is decoration: never fail the page for it */ }
  if (cache.size > 2000) cache.clear();
  cache.set(key, { at: Date.now(), v: out });
  return Response.json(out);
}
