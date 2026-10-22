import { fetchHeadlines } from "@/lib/news";
import { isRomantic } from "@/lib/prefs";
import { llmScript, segmentFor, splitAnswer, splitMood, templateScript, type SegmentInput } from "@/lib/script";

export async function POST(req: Request) {
  const body = (await req.json()) as Omit<SegmentInput, "headlines">;
  const { prefs, index } = body;
  // Per-session "RJ talks about" toggles: turned-off types never happen (LLM and template alike).
  const romantic = isRomantic(body.mode);
  if (romantic) { prefs.language = "hindi"; prefs.humor = "off"; } // Romantic Hindi: Devanagari Hindi, poetic, no jokes
  const talk = Object.assign({ news: true, jokes: true, facts: true }, prefs.talk);
  if (prefs.justMusic) { talk.news = false; talk.jokes = false; talk.facts = false; }
  prefs.talk = talk;
  if (!talk.jokes) body.withJoke = false;
  if (!talk.news || romantic) body.withNews = false;
  const minimal = !talk.news && !talk.jokes && !talk.facts;
  if (minimal && body.kind !== "switch") {
    if (body.mode === "focus" || (prefs.justMusic && body.kind === "stinger")) return Response.json({ script: "", mood: "calm", kind: body.kind ?? "full", mode: "skip", headlines: [] });
    body.kind = "stinger"; body.index = Math.max(1, index); // just a short transition naming the next song
  }
  const wantNews = body.withNews ?? (!romantic && (!body.mode || body.mode === "default" || body.mode === "drive") && index % 2 === 0);
  const headlines = wantNews && body.kind !== "stinger" && prefs.newsTopics?.length ? await fetchHeadlines(prefs.newsTopics, prefs.language, 6) : [];
  // shuffle so repeated segments vary
  headlines.sort(() => Math.random() - 0.5);
  // drop headlines already read out recently
  const recent = (body.recent ?? []).join(" ");
  const seen = new Set<string>();
  const freshNews = headlines.filter((h) => {
    if (h.title.split(/\s+/).length < 5 || recent.includes(h.title.slice(0, 40))) return false; // junk or already read
    const key = h.title.toLowerCase().split(/\s+/).slice(0, 2).join(" "); // near-duplicate stories
    if (seen.has(key)) return false; seen.add(key); return true;
  });
  headlines.splice(0, headlines.length, ...freshNews);
  const input = { ...body, headlines };
  const segment = segmentFor(input);
  const llm = await llmScript({ ...input, segment });
  // A trivia question carries its answer on a hidden last line: keep it for the next break, never speak it.
  const { text: raw, answer } = splitAnswer(llm ?? templateScript(input));
  const { mood, text } = splitMood(raw.replace(/\s+/g, " "));
  const trivia = llm && segment === "trivia_q" && answer && text ? { q: text.slice(-220), a: answer } : null;
  const defaultMood = { default: "cheerful", drive: "cheerful", gym: "hype", focus: "calm", romantic_m: "warm", romantic_f: "warm", romantic_s: "warm" }[body.mode ?? "default"];
  return Response.json({ script: text, mood: mood ?? defaultMood, kind: body.kind ?? "full", mode: llm !== null ? "llm" : "template", segment: llm ? segment : "vibe", trivia, headlines: headlines.slice(0, 2) });
}
