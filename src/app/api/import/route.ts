// Extract song/artist pairs from screenshots, a playlist link, or a typed list using Claude (vision).
type Block = { type: "text"; text: string } | { type: "image"; source: { type: "base64"; media_type: string; data: string } };

async function pageText(url: string): Promise<string> {
  const u = new URL(url);
  if (!/^https?:$/.test(u.protocol)) throw new Error("bad url");
  if (/^(localhost|127\.|10\.|192\.168\.|169\.254\.|172\.(1[6-9]|2\d|3[01])\.|\[|0\.)/i.test(u.hostname)) throw new Error("private address");
  const r = await fetch(u, { headers: { "User-Agent": "Mozilla/5.0 (MyRJ playlist import)", "Accept-Language": "en" }, signal: AbortSignal.timeout(8000) });
  const html = await r.text();
  const meta = [...html.matchAll(/<meta[^>]+(?:property|name)="(?:og:title|og:description|description|music:song)"[^>]+content="([^"]*)"/g)].map((m) => m[1]);
  const title = html.match(/<title>([\s\S]*?)<\/title>/)?.[1] ?? "";
  const body = html.replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/g, " ").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");
  // JSON blobs often contain track names (e.g. "name":"Song","byArtist")
  const jsonNames = [...html.matchAll(/"(?:name|title|trackName|artistName)"\s*:\s*"([^"]{2,80})"/g)].slice(0, 400).map((m) => m[1]);
  return [title, ...meta, jsonNames.join(" | "), body].join("\n").slice(0, 20000);
}

export async function POST(req: Request) {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) return Response.json({ error: "Song import needs ANTHROPIC_API_KEY" }, { status: 501 });
  const { images = [], text = "" } = (await req.json()) as { images?: string[]; text?: string };
  if (!images.length && !text.trim()) return Response.json({ error: "Add a screenshot, link or list" }, { status: 400 });

  const content: Block[] = [];
  for (const d of images.slice(0, 6)) {
    const m = d.match(/^data:(image\/(?:png|jpeg|webp|gif));base64,(.+)$/);
    if (m) content.push({ type: "image", source: { type: "base64", media_type: m[1], data: m[2] } });
  }
  let extra = text.trim();
  const urls = extra.match(/https?:\/\/\S+/g) ?? [];
  for (const u of urls.slice(0, 2)) {
    try { extra += `\n\n--- Content of ${u} ---\n${await pageText(u)}`; } catch { extra += `\n\n(Could not open ${u})`; }
  }
  content.push({ type: "text", text: `Extract every song from the screenshots and/or text below (music app screenshots, playlists, listening history, or a typed list). Return ONLY a JSON array like [{"title":"...","artist":"..."}], max 100 items, no duplicates, no commentary. Use the main artist only. If you can't find any songs, return [].\n\n${extra}` });

  try {
    const r = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST", signal: AbortSignal.timeout(45000),
      headers: { "x-api-key": key, "anthropic-version": "2023-06-01", "content-type": "application/json" },
      body: JSON.stringify({ model: process.env.ANTHROPIC_MODEL || "claude-haiku-5-5", max_tokens: 4096, thinking: { type: "disabled" }, messages: [{ role: "user", content }] }),
    });
    if (!r.ok) return Response.json({ error: `Claude ${r.status}` }, { status: 502 });
    const j = await r.json();
    const out = (j.content ?? []).filter((c: { type: string }) => c.type === "text").map((c: { text: string }) => c.text).join("");
    const arr = JSON.parse(out.slice(out.indexOf("["), out.lastIndexOf("]") + 1) || "[]") as { title: string; artist: string }[];
    const songs = arr.filter((s) => s?.title).map((s) => ({ title: String(s.title).slice(0, 120), artist: String(s.artist ?? "").slice(0, 80) }));
    return Response.json({ songs });
  } catch (e) {
    return Response.json({ error: `Couldn't read that: ${e instanceof Error ? e.message : e}` }, { status: 502 });
  }
}
