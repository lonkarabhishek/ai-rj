import { connection } from "next/server";
import { ytAccessToken } from "@/lib/youtube";
import { ytSearch } from "@/lib/ytmusic";

/** GET ?q=&focus=1 — 101 quota units. The client caches results for 24h and caps searches per session. */
export const maxDuration = 60;

export async function GET(req: Request) {
  await connection();
  const u = new URL(req.url), q = (u.searchParams.get("q") ?? "").slice(0, 120);
  if (!q) return Response.json({ videos: [] });
  const token = await ytAccessToken().catch(() => null);
  if (!token && !process.env.YOUTUBE_API_KEY) return Response.json({ error: "YouTube isn't connected" }, { status: 401 });
  try { return Response.json({ videos: await ytSearch(q, token, u.searchParams.get("focus") === "1") }); }
  catch (e) { const m = String(e instanceof Error ? e.message : e); return Response.json({ error: m }, { status: /quota/i.test(m) ? 429 : 502 }); }
}
