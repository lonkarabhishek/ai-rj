import { guard, oneOf, str } from "@/lib/guard";
import { fetchHeadlines } from "@/lib/news";
import { LANGUAGES, type Language } from "@/lib/prefs";

export async function GET(req: Request) {
  const no = guard(req, "news", 20); if (no) return no;
  const u = new URL(req.url);
  const topics = str(u.searchParams.get("topics") ?? "AI", 300).split(",").map((s) => s.trim().slice(0, 40)).filter(Boolean).slice(0, 8);
  const lang = oneOf<Language>(u.searchParams.get("lang"), LANGUAGES.map((l) => l.id), "english");
  return Response.json({ headlines: await fetchHeadlines(topics, lang) });
}
