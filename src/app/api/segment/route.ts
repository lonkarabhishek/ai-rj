import { fetchHeadlines } from "@/lib/news";
import { llmScript, templateScript, type SegmentInput } from "@/lib/script";

export async function POST(req: Request) {
  const body = (await req.json()) as Omit<SegmentInput, "headlines">;
  const { prefs, index } = body;
  const headlines = (!body.mode || body.mode === "default") && index % 2 === 0 && prefs.newsTopics?.length ? await fetchHeadlines(prefs.newsTopics, prefs.language, 6) : [];
  // shuffle so repeated segments vary
  headlines.sort(() => Math.random() - 0.5);
  // drop headlines already read out recently
  const recent = (body.recent ?? []).join(" ");
  const freshNews = headlines.filter((h) => !recent.includes(h.title.slice(0, 40)));
  headlines.splice(0, headlines.length, ...freshNews);
  const input = { ...body, headlines };
  const llm = await llmScript(input);
  return Response.json({ script: llm ?? templateScript(input), mode: llm ? "llm" : "template", headlines: headlines.slice(0, 2) });
}
