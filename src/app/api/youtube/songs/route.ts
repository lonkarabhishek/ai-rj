import { connection } from "next/server";
import { youtubeEnabled, ytAccessToken, youtubeSongs } from "@/lib/youtube";

/** GET ?status -> {configured, connected}; GET -> songs from liked music videos + your playlists. */
export async function GET(req: Request) {
  await connection();
  if (!youtubeEnabled()) return Response.json({ configured: false, connected: false });
  let token: string | null = null;
  try { token = await ytAccessToken(); } catch { /* revoked */ }
  if (new URL(req.url).searchParams.has("status")) return Response.json({ configured: true, connected: !!token });
  if (!token) return Response.json({ error: "YouTube isn't connected" }, { status: 401 });
  try { return Response.json(await youtubeSongs(token)); }
  catch (e) { return Response.json({ error: String(e instanceof Error ? e.message : e) }, { status: 502 }); }
}
