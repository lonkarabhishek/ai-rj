import { guard, isPrivateHost, readJson } from "@/lib/guard";
import { readYoutubePlaylist, youtubeListId, type Song } from "@/lib/linkimport";
import { extractJson, llmAvailable, llmTask, type LlmImage } from "@/lib/llm";

export const maxDuration = 60;

// Extract song/artist pairs from screenshots, a playlist link, or a typed list using a vision LLM (Gemini free tier, else Claude).

async function pageText(url: string): Promise<string> {
  // Follow redirects by hand so every hop is checked: a public URL must not bounce the server into a private address.
  let u = new URL(url), r: Response | null = null;
  for (let hop = 0; hop < 4; hop++) {
    if (!/^https?:$/.test(u.protocol)) throw new Error("bad url");
    if (isPrivateHost(u.hostname)) throw new Error("private address");
    r = await fetch(u, { redirect: "manual", headers: { "User-Agent": "Mozilla/5.0 (MyRJ playlist import)", "Accept-Language": "en" }, signal: AbortSignal.timeout(8000) });
    const loc = r.status >= 300 && r.status < 400 ? r.headers.get("location") : null;
    if (!loc) break;
    u = new URL(loc, u); r = null;
  }
  if (!r) throw new Error("too many redirects");
  if (Number(r.headers.get("content-length") ?? 0) > 3_000_000) throw new Error("page too large");
  const html = (await r.text()).slice(0, 3_000_000);
  const meta = [...html.matchAll(/<meta[^>]+(?:property|name)="(?:og:title|og:description|description|music:song)"[^>]+content="([^"]*)"/g)].map((m) => m[1]);
  const title = html.match(/<title>([\s\S]*?)<\/title>/)?.[1] ?? "";
  const body = html.replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/g, " ").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");
  // JSON blobs often contain track names (e.g. "name":"Song","byArtist")
  const jsonNames = [...html.matchAll(/"(?:name|title|trackName|artistName)"\s*:\s*"([^"]{2,80})"/g)].slice(0, 400).map((m) => m[1]);
  return [title, ...meta, jsonNames.join(" | "), body].join("\n").slice(0, 20000);
}

export async function POST(req: Request) {
  const no = guard(req, "import", 8); if (no) return no;
  const body = await readJson<{ images?: unknown; text?: unknown }>(req, 4_000_000); // Vercel caps request bodies at 4.5 MB
  if (!body) return Response.json({ error: "That's too large to read. Try fewer or smaller screenshots." }, { status: 413 });
  const images = (Array.isArray(body.images) ? body.images : []).filter((x): x is string => typeof x === "string").slice(0, 6);
  const text = typeof body.text === "string" ? body.text.slice(0, 20000) : "";
  if (!images.length && !text.trim()) return Response.json({ error: "Add a screenshot, link or list" }, { status: 400 });

  // YouTube / YouTube Music playlist links: parse directly, no AI needed.
  const allUrls = text.match(/https?:\/\/\S+/g) ?? [];
  const ytIds = allUrls.map(youtubeListId).filter(Boolean) as string[];
  const fromYt: Song[] = [];
  for (const id of ytIds.slice(0, 3)) fromYt.push(...(await readYoutubePlaylist(id)));
  const rest = allUrls.filter((u) => !youtubeListId(u));
  const leftoverText = text.replace(/https?:\/\/\S+/g, (u) => (youtubeListId(u) ? "" : u)).trim();
  if (ytIds.length && !images.length && !leftoverText) {
    if (!fromYt.length) return Response.json({ error: "Couldn't read that YouTube playlist. Is it public or unlisted? If it's private, add a screenshot instead." }, { status: 422 });
    return Response.json({ songs: fromYt.slice(0, 200), source: "youtube" });
  }

  if (!llmAvailable()) {
    if (fromYt.length) return Response.json({ songs: fromYt, source: "youtube" });
    return Response.json({ error: "Reading screenshots, lists and other links needs GEMINI_API_KEY on the server" }, { status: 501 });
  }

  const pics: LlmImage[] = [];
  for (const d of images) {
    const m = d.match(/^data:(image\/(?:png|jpeg|webp|gif));base64,([A-Za-z0-9+/=]+)$/);
    if (m) pics.push({ mimeType: m[1], data: m[2] });
  }
  let extra = leftoverText;
  let unreadable = 0;
  for (const u of rest.slice(0, 2)) {
    try { const t = await pageText(u); if (t.replace(/\s/g, "").length < 200) unreadable++; extra += `\n\n--- Content of ${u} ---\n${t}`; }
    catch { unreadable++; extra += `\n\n(Could not open ${u})`; }
  }
  const prompt = `Extract every song from the screenshots and/or text below (music app screenshots, playlists, listening history, or a typed list). Return ONLY a JSON array like [{"title":"...","artist":"..."}], max 100 items, no duplicates, no commentary. Use the main artist only. If you can't find any songs, return [].\n\n${extra}`;
  const r = await llmTask(prompt, { images: pics, maxTokens: 4096, timeoutMs: 45000, json: true });
  if (!r) {
    if (fromYt.length) return Response.json({ songs: fromYt, source: "youtube" });
    return Response.json({ error: "The AI reader is unavailable right now (quota or network). Try again in a minute." }, { status: 502 });
  }
  const arr = extractJson<{ title: string; artist: string }[]>(r.text, "array", []);
  const songs = [...fromYt, ...(Array.isArray(arr) ? arr : []).filter((s) => s?.title).map((s) => ({ title: String(s.title).slice(0, 120), artist: String(s.artist ?? "").slice(0, 80) }))];
  if (!songs.length && rest.length && !images.length)
    return Response.json({ error: unreadable ? "Couldn't read that link (the site blocks it or needs a login). Try a screenshot of the playlist instead." : "Didn't find songs on that page. Try a screenshot of the playlist instead." }, { status: 422 });
  return Response.json({ songs });
}
