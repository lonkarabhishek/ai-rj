import { fetchHeadlines } from "@/lib/news";
import { llmScript, templateScript, type SegmentInput } from "@/lib/script";

export async function POST(req: Request) {
  const body = (await req.json()) as Omit<SegmentInput, "headlines">;
  const { prefs, index } = body;
  const headlines = index % 2 === 0 && prefs.newsTopics?.length ? await fetchHeadlines(prefs.newsTopics, prefs.language, 2) : [];
  // shuffle so repeated segments vary
  headlines.sort(() => Math.random() - 0.5);
  const input = { ...body, headlines };
  const llm = await llmScript(input);
  return Response.json({ script: llm ?? templateScript(input), mode: llm ? "llm" : "template", headlines: headlines.slice(0, 2) });
}
