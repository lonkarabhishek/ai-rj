import { ytLinks } from "@/lib/ytmusic";
/** POST {urls} — videos from imported YouTube / YouTube Music playlist links (public page, no API quota). */
export const maxDuration = 60;

export async function POST(req: Request) {
  const { urls } = (await req.json().catch(() => ({}))) as { urls?: string[] };
  return Response.json({ videos: await ytLinks(urls ?? []) });
}
