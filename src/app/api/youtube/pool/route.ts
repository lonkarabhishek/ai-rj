import { connection } from "next/server";
import { youtubeEnabled, ytAccessToken } from "@/lib/youtube";
import { ytPool } from "@/lib/ytmusic";

/** His YouTube likes + playlists as playable videos (≈10-15 quota units). Client caches it for a day. */
export const maxDuration = 60;

export async function GET() {
  await connection();
  if (!youtubeEnabled()) return Response.json({ error: "YouTube isn't configured" }, { status: 501 });
  const token = await ytAccessToken().catch(() => null);
  if (!token) return Response.json({ error: "YouTube isn't connected" }, { status: 401 });
  try { return Response.json({ videos: await ytPool(token) }); }
  catch (e) { return Response.json({ error: String(e instanceof Error ? e.message : e) }, { status: 502 }); }
}
