import { connection } from "next/server";
import { guard, oneOf } from "@/lib/guard";
import { ytAccessToken } from "@/lib/youtube";
import { ytChartPlaylist, ytTrending, type YtVideo } from "@/lib/ytmusic";

/** GET ?kind=trending&region=US | ?kind=top&chart=global — music charts as playable YouTube videos. */
export const maxDuration = 60;
const CHARTS = {
  global: "Top 100 Songs Global YouTube Charts",
  us: "Top 100 Songs United States YouTube Charts",
  latin: "Top Latin Songs this week playlist",
  dancehall: "Top Dancehall Songs this week playlist",
  soca: "Soca 2026 hits playlist",
} as const;
const REGIONS = ["US", "MX", "JM", "GT", "GB", "CA"] as const;
const cache = new Map<string, { at: number; v: YtVideo[] }>();

export async function GET(req: Request) {
  await connection();
  const no = guard(req, "charts", 20); if (no) return no;
  const u = new URL(req.url);
  const kind = oneOf(u.searchParams.get("kind"), ["trending", "top"] as const, "trending");
  const key = kind === "trending" ? `t:${oneOf(u.searchParams.get("region"), REGIONS, "US")}` : `c:${oneOf(u.searchParams.get("chart"), Object.keys(CHARTS) as (keyof typeof CHARTS)[], "global")}`;
  const c = cache.get(key);
  if (c && Date.now() - c.at < 3 * 3600_000) return Response.json({ videos: c.v });
  const token = await ytAccessToken().catch(() => null);
  if (!token && !process.env.YOUTUBE_API_KEY) return Response.json({ error: "YouTube isn't connected" }, { status: 401 });
  try {
    const v = kind === "trending" ? await ytTrending(key.slice(2), token) : await ytChartPlaylist(CHARTS[key.slice(2) as keyof typeof CHARTS], token);
    if (v.length) cache.set(key, { at: Date.now(), v });
    return Response.json({ videos: v });
  } catch (e) {
    const m = String(e instanceof Error ? e.message : e);
    return Response.json({ error: m }, { status: /quota/i.test(m) ? 429 : 502 });
  }
}
