import { fetchHeadlines } from "@/lib/news";
import type { Language } from "@/lib/prefs";

export async function GET(req: Request) {
  const u = new URL(req.url);
  const topics = (u.searchParams.get("topics") ?? "AI").split(",").map((s) => s.trim()).filter(Boolean);
  const lang = (u.searchParams.get("lang") ?? "english") as Language;
  return Response.json({ headlines: await fetchHeadlines(topics, lang) });
}
