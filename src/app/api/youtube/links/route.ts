import { guard, readJson } from "@/lib/guard";
import { ytLinks } from "@/lib/ytmusic";
/** POST {urls} — videos from imported YouTube / YouTube Music playlist links (public page, no API quota). */
export const maxDuration = 60;

export async function POST(req: Request) {
  const no = guard(req, "yt-links", 10); if (no) return no;
  const { urls } = (await readJson<{ urls?: unknown }>(req, 20_000)) ?? {};
  const list = (Array.isArray(urls) ? urls : []).filter((u): u is string => typeof u === "string" && u.length < 500).slice(0, 10);
  return Response.json({ videos: await ytLinks(list).catch(() => []) });
}
