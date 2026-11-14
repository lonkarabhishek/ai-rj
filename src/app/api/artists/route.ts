import { guard, str } from "@/lib/guard";

/** GET ?q=name (search) or ?names=a,b,c (pictures for a list). Artist pictures from Deezer's free public API. */
interface Artist { name: string; image: string | null; fans?: number }
const cache = new Map<string, { at: number; v: Artist[] }>();

async function lookup(q: string, limit: number): Promise<Artist[]> {
  const k = `${q.toLowerCase()}|${limit}`, c = cache.get(k);
  if (c && Date.now() - c.at < 86_400_000) return c.v;
  try {
    const r = await fetch(`https://api.deezer.com/search/artist?q=${encodeURIComponent(q)}&limit=${limit}`, { signal: AbortSignal.timeout(5000) });
    const j = r.ok ? await r.json() : null;
    const v: Artist[] = (j?.data ?? []).map((a: { name: string; picture_medium?: string; picture_big?: string; nb_fan?: number }) =>
      ({ name: a.name, image: a.picture_big || a.picture_medium || null, fans: a.nb_fan }));
    // Deezer's placeholder for artists without a photo is a grey silhouette: treat it as none.
    for (const a of v) if (a.image && /\/artist\/\/|images\/artist\/?$/.test(a.image)) a.image = null;
    cache.set(k, { at: Date.now(), v });
    return v;
  } catch { return []; }
}

export async function GET(req: Request) {
  const no = guard(req, "artists", 40); if (no) return no;
  const u = new URL(req.url);
  const q = str(u.searchParams.get("q") ?? "", 60).trim();
  if (q) return Response.json({ artists: await lookup(q, 8) });
  const names = str(u.searchParams.get("names") ?? "", 1200).split(",").map((s) => s.trim()).filter(Boolean).slice(0, 30);
  const found = await Promise.all(names.map(async (n) => {
    const a = (await lookup(n, 3)).find((x) => x.name.toLowerCase() === n.toLowerCase()) ?? null;
    return { name: n, image: a?.image ?? null, fans: a?.fans };
  }));
  return Response.json({ artists: found });
}
