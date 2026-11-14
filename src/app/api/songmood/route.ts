/** POST {items:[{id,title,artist}]} -> {labels:{id:{lang,romantic,sensual}}}. One LLM call (Gemini free tier, else Claude) labels each song's sung language and mood (sensual songs count as romantic too). */
import { guard, readJson } from "@/lib/guard";
import { extractJson, llmAvailable, llmTask } from "@/lib/llm";

export const maxDuration = 30;
const LANGS = ["hindi", "english", "spanish", "punjabi", "marathi", "tamil", "telugu", "instrumental", "other"];

export async function POST(req: Request) {
  const no = guard(req, "songmood", 40); if (no) return no;
  if (!llmAvailable()) return Response.json({ labels: {}, error: "no key" }, { status: 501 });
  const { items = [] } = (await readJson<{ items?: { id: string; title: string; artist?: string }[] }>(req, 60_000)) ?? {};
  const list = (Array.isArray(items) ? items : []).filter((x) => x && typeof x.id === "string" && typeof x.title === "string").slice(0, 60);
  if (!list.length) return Response.json({ labels: {} });
  const r = await llmTask(`For each song below (index|title|artist) give [language, mood]. language = the language its vocals are sung in: one of ${LANGS.join(", ")}, or "unknown" if not confident. mood = "sensual" for seductive, sensual, steamy love songs (the Bheegey Honth Tere, Be Intehaan, Zara Zara Touch Me, Murder/Jism/Hate Story kind), "romantic" for other love songs, soft ballads, sad love, ghazal, unplugged romance, or "other" for party, dance, rap, item numbers, workout, devotional, patriotic, comedy, kids. Return ONLY a JSON object mapping index to [language, mood].\n\n${list.map((x, k) => `${k}|${x.title.slice(0, 120)}|${String(x.artist ?? "").slice(0, 80)}`).join("\n")}`, { timeoutMs: 14000, json: true });
  if (!r) return Response.json({ labels: {}, error: "labelling unavailable" }, { status: 502 });
  const m = extractJson<Record<string, unknown>>(r.text, "object", {});
  const labels: Record<string, { lang: string; romantic: boolean; sensual: boolean }> = {};
  list.forEach((x, k) => {
    const v = m[k]; if (!Array.isArray(v)) return;
    const lang = String(v[0] ?? "").toLowerCase(), mood = String(v[1] ?? "").toLowerCase();
    if (mood !== "romantic" && mood !== "sensual" && mood !== "other") return;
    labels[x.id] = { lang: LANGS.includes(lang) ? lang : "unknown", romantic: mood !== "other", sensual: mood === "sensual" };
  });
  return Response.json({ labels });
}
