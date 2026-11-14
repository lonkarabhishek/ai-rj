import { guard, readJson, str } from "@/lib/guard";
import { geminiEnabled, geminiTextChain, geminiFastModel } from "@/lib/gemini";
import { extractJson } from "@/lib/llm";
import { VIBE_TAGS, type Steer } from "@/lib/prefs";

/**
 * POST {text} → Steer. Understands "play Bendiciones by Jhexx", "I'm feeling chill and a bit sad", "more reggaeton", or a bare song name.
 * Gemini (free tier) when available; otherwise simple rules. Search terms only: the client finds the real videos/tracks, so nothing here
 * can invent a song that then plays.
 */
export const maxDuration = 20;

function rules(text: string): Steer {
  const t = text.trim().replace(/[.!?]+$/, "");
  const tag = VIBE_TAGS.find((x) => new RegExp(`\\b${x.label.replace(/[^a-z0-9]/gi, ".?")}\\b`, "i").test(t) || new RegExp(`\\b${x.id}\\b`, "i").test(t));
  const play = t.match(/^(?:please\s+)?(?:play|put on|pon|ponme|toca)\s+(.+?)(?:\s+(?:by|de|from)\s+(.+))?$/i);
  if (play) {
    const title = play[1].replace(/^(?:the song|la canci[oó]n)\s+/i, "").trim(), artist = (play[2] ?? "").trim();
    return { kind: "song", label: artist ? `${title} · ${artist}` : title, song: { title, artist }, queries: [artist ? `${artist} songs` : `${title} similar songs`] };
  }
  const dash = t.match(/^(.{1,80}?)\s+[-–]\s+(.{1,80})$/);
  if (dash) return { kind: "song", label: `${dash[2]} · ${dash[1]}`, song: { title: dash[2], artist: dash[1] }, queries: [`${dash[1]} songs`] };
  if (tag) return { kind: "mood", label: tag.label, queries: tag.q, song: null };
  if (/\b(feel|feeling|mood|vibe|something|me siento|tengo ganas)\b/i.test(t)) return { kind: "mood", label: t.slice(0, 40), queries: [`${t.replace(/^(i'?m|i am)\s+/i, "").slice(0, 60)} songs`], song: null };
  return { kind: "search", label: t.slice(0, 40), queries: [t.slice(0, 80)], song: { title: t.slice(0, 80), artist: "" } };
}

export async function POST(req: Request) {
  const no = guard(req, "request", 20); if (no) return no;
  const b = await readJson(req, 4000);
  const text = str(b?.text, 200).trim();
  if (!text) return Response.json({ error: "Say what you want to hear" }, { status: 400 });
  const tags = (Array.isArray(b?.tags) ? b.tags : []).filter((x): x is string => typeof x === "string").slice(0, 6);
  if (!geminiEnabled()) return Response.json({ ...rules(text), via: "rules" });
  const prompt = `A listener of a personal radio station typed a request. Work out what they want.
Request: "${text}"${tags.length ? `\nTheir current vibe tags: ${tags.join(", ")}` : ""}

Return ONLY JSON:
{"kind": "song" | "artist" | "mood", "song": {"title": "...", "artist": "..."} or null, "label": "2-5 word summary", "queries": ["...", "..."]}
- kind "song": they named a specific song. Put it in "song" exactly as they wrote it (fix obvious spelling only). If you are not sure who the artist is, leave artist "".
- kind "artist": they want an artist or band; song null.
- kind "mood": a feeling, activity, genre or vibe; song null.
- "queries": 2 short YouTube/Spotify search phrases (under 8 words) that find MORE songs in the same vibe: the artist's other songs, similar artists, the genre or mood. Use only artists and genres you are confident exist. Never invent song titles.
- Keep the request's language and region in mind (for example Belizean, Caribbean, Latin or Spanish music).`;
  const r = await geminiTextChain({ user: prompt, json: true, temperature: 0.3, maxOutputTokens: 400 }, [geminiFastModel()], 8000, (e) => console.error("request:", e.code));
  const j = r ? extractJson<Partial<Steer> & { song?: { title?: string; artist?: string } | null }>(r.text, "object", {}) : {};
  const kind = j.kind === "song" || j.kind === "artist" || j.kind === "mood" ? j.kind : null;
  const queries = (Array.isArray(j.queries) ? j.queries : []).map((q) => str(q, 80).trim()).filter(Boolean).slice(0, 2);
  if (!kind || !queries.length) return Response.json({ ...rules(text), via: "rules" });
  const song = kind === "song" && j.song?.title ? { title: str(j.song.title, 120).trim(), artist: str(j.song.artist, 80).trim() } : null;
  return Response.json({ kind, song, label: str(j.label, 40).trim() || text.slice(0, 40), queries, via: "gemini" } satisfies Steer & { via: string });
}
