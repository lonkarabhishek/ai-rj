/** POST {items:[{id,title,artist}]} -> {labels:{id:{lang,romantic,sensual}}}. One Claude Haiku call labels each song's sung language and mood (sensual songs count as romantic too). */
export const maxDuration = 30;
const LANGS = ["hindi", "english", "punjabi", "marathi", "tamil", "telugu", "instrumental", "other"];

export async function POST(req: Request) {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) return Response.json({ labels: {}, error: "no key" }, { status: 501 });
  const { items = [] } = (await req.json().catch(() => ({}))) as { items?: { id: string; title: string; artist?: string }[] };
  const list = items.filter((x) => x && typeof x.id === "string" && typeof x.title === "string").slice(0, 60);
  if (!list.length) return Response.json({ labels: {} });
  try {
    const r = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST", signal: AbortSignal.timeout(14000),
      headers: { "x-api-key": key, "anthropic-version": "2023-06-01", "content-type": "application/json" },
      body: JSON.stringify({ model: process.env.ANTHROPIC_MODEL || "claude-haiku-5-5", max_tokens: 2048, thinking: { type: "disabled" },
        messages: [{ role: "user", content: `For each song below (index|title|artist) give [language, mood]. language = the language its vocals are sung in: one of ${LANGS.join(", ")}, or "unknown" if not confident. mood = "sensual" for seductive, sensual, steamy love songs (the Bheegey Honth Tere, Be Intehaan, Zara Zara Touch Me, Murder/Jism/Hate Story kind), "romantic" for other love songs, soft ballads, sad love, ghazal, unplugged romance, or "other" for party, dance, rap, item numbers, workout, devotional, patriotic, comedy, kids. Return ONLY a JSON object mapping index to [language, mood].\n\n${list.map((x, k) => `${k}|${x.title.slice(0, 120)}|${(x.artist ?? "").slice(0, 80)}`).join("\n")}` }] }),
    });
    if (!r.ok) return Response.json({ labels: {}, error: `llm ${r.status}` }, { status: 502 });
    const j = await r.json();
    const t = (j.content ?? []).filter((c: { type: string }) => c.type === "text").map((c: { text: string }) => c.text).join("");
    const m = JSON.parse(t.slice(t.indexOf("{"), t.lastIndexOf("}") + 1) || "{}") as Record<string, unknown>;
    const labels: Record<string, { lang: string; romantic: boolean; sensual: boolean }> = {};
    list.forEach((x, k) => {
      const v = m[k]; if (!Array.isArray(v)) return;
      const lang = String(v[0] ?? "").toLowerCase(), mood = String(v[1] ?? "").toLowerCase();
      if (mood !== "romantic" && mood !== "sensual" && mood !== "other") return;
      labels[x.id] = { lang: LANGS.includes(lang) ? lang : "unknown", romantic: mood !== "other", sensual: mood === "sensual" };
    });
    return Response.json({ labels });
  } catch (e) { return Response.json({ labels: {}, error: String(e instanceof Error ? e.message : e) }, { status: 502 }); }
}
