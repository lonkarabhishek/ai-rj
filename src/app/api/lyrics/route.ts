import { guard, int, str } from "@/lib/guard";
import { songMeta } from "@/lib/songmeta";

/** GET ?title=&artist=&duration=(s) → {synced, plain, instrumental, source} from LRCLIB (free, open lyrics database). */
type L = { syncedLyrics?: string | null; plainLyrics?: string | null; instrumental?: boolean; duration?: number };
const UA = { "User-Agent": "MyRJ personal radio (https://github.com/kyobze12/ai-rj)" };

export async function GET(req: Request) {
  const no = guard(req, "lyrics", 60); if (no) return no;
  const u = new URL(req.url);
  const { title, artist } = songMeta(str(u.searchParams.get("title"), 200), str(u.searchParams.get("artist"), 120));
  const duration = int(Number(u.searchParams.get("duration")), 0, 3600, 0);
  if (!title) return Response.json({ synced: null, plain: null });
  const get = async (path: string) => {
    const r = await fetch(`https://lrclib.net/api/${path}`, { headers: UA, signal: AbortSignal.timeout(6000) }).catch(() => null);
    return r?.ok ? r.json() : null;
  };
  try {
    let hit: L | null = null;
    if (artist) hit = await get(`get?${new URLSearchParams({ track_name: title, artist_name: artist, ...(duration ? { duration: String(duration) } : {}) })}`);
    if (!hit?.syncedLyrics) {
      const list = ((await get(`search?${new URLSearchParams({ track_name: title, ...(artist ? { artist_name: artist } : {}) })}`)) ?? []) as L[];
      // Prefer synced lyrics whose length is close to the song's (a different edit drifts out of sync).
      const fits = (x: L) => !duration || !x.duration || Math.abs(x.duration - duration) <= 4;
      hit = list.find((x) => x.syncedLyrics && fits(x)) ?? (hit?.plainLyrics ? hit : list.find((x) => x.plainLyrics && fits(x))) ?? hit;
    }
    return Response.json({ synced: hit?.syncedLyrics ?? null, plain: hit?.plainLyrics ?? null, instrumental: !!hit?.instrumental, source: hit ? "LRCLIB" : null, title, artist });
  } catch { return Response.json({ synced: null, plain: null, title, artist }); }
}
