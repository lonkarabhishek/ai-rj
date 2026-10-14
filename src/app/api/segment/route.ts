import { fetchHeadlines } from "@/lib/news";
import { llmScript, splitMood, templateScript, type SegmentInput } from "@/lib/script";

export async function POST(req: Request) {
  const body = (await req.json()) as Omit<SegmentInput, "headlines">;
  const { prefs, index } = body;
  const wantNews = body.withNews ?? ((!body.mode || body.mode === "default" || body.mode === "drive") && index % 2 === 0);
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
  const llm = await llmScript(input);
  const { mood, text } = splitMood(llm ?? templateScript(input));
  const defaultMood = { default: "cheerful", drive: "cheerful", gym: "hype", focus: "calm" }[body.mode ?? "default"];
  return Response.json({ script: text, mood: mood ?? defaultMood, kind: body.kind ?? "full", mode: llm !== null ? "llm" : "template", headlines: headlines.slice(0, 2) });
}
