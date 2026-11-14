import { guard, int, oneOf, readJson, str } from "@/lib/guard";
import { fetchHeadlines } from "@/lib/news";
import { DEFAULT_PREFS, ENERGIES, HUMORS, isRomantic, LANGUAGES, MODES, ROMANTIC_MODES, type ListenMode, type Prefs, type TrackInfo } from "@/lib/prefs";
import { llmScriptWith, SEGMENTS, segmentFor, splitAnswer, splitMood, templateScript, type SegmentInput } from "@/lib/script";

export const maxDuration = 30; // fits Vercel Hobby; the script writer's own budget is far shorter

const ALL_MODES = [...MODES.map((m) => m.id), ...ROMANTIC_MODES.map((m) => m.id)] as ListenMode[];
const track = (v: unknown): TrackInfo | null => {
  if (!v || typeof v !== "object") return null;
  const t = v as Record<string, unknown>, name = str(t.name, 200).trim();
  return name ? { name, artists: str(t.artists, 200).trim() } : null;
};
/** Everything the client sends is untrusted: clamp lengths, whitelist enums, drop anything unexpected before it reaches a prompt. */
function parse(b: Record<string, unknown>): Omit<SegmentInput, "headlines"> {
  const p = (b.prefs && typeof b.prefs === "object" ? b.prefs : {}) as Record<string, unknown>;
  const talk = (p.talk && typeof p.talk === "object" ? p.talk : {}) as Record<string, unknown>;
  const prefs: Prefs = {
    ...DEFAULT_PREFS,
    rjName: str(p.rjName, 40).trim() || DEFAULT_PREFS.rjName,
    listenerName: str(p.listenerName, 40).trim() || DEFAULT_PREFS.listenerName,
    language: oneOf(p.language, LANGUAGES.map((l) => l.id), "english"),
    humor: oneOf(p.humor, HUMORS, "normal"),
    energy: oneOf(p.energy, ENERGIES, "balanced"),
    newsTopics: (Array.isArray(p.newsTopics) ? p.newsTopics : []).map((x) => str(x, 40).trim()).filter(Boolean).slice(0, 5),
    talk: { news: talk.news !== false, jokes: talk.jokes !== false, facts: talk.facts !== false },
    justMusic: p.justMusic === true,
  };
  const trivia = b.trivia && typeof b.trivia === "object" ? (b.trivia as Record<string, unknown>) : null;
  return {
    prefs, next: track(b.next), prev: track(b.prev),
    index: int(b.index, 0, 100000, 0),
    mode: oneOf(b.mode, ALL_MODES, "default"),
    kind: b.kind === undefined ? undefined : oneOf(b.kind, ["stinger", "full", "switch"] as const, "full"),
    recent: (Array.isArray(b.recent) ? b.recent : []).map((x) => str(x, 700)).filter(Boolean).slice(-6),
    hour: b.hour === undefined ? undefined : int(b.hour, 0, 23, 12),
    withNews: typeof b.withNews === "boolean" ? b.withNews : undefined,
    withJoke: typeof b.withJoke === "boolean" ? b.withJoke : undefined,
    segment: SEGMENTS.includes(b.segment as never) ? (b.segment as SegmentInput["segment"]) : undefined,
    history: (Array.isArray(b.history) ? b.history : []).map(track).filter((t): t is TrackInfo => !!t).slice(-12).map((t) => ({ name: t.name, artists: t.artists })),
    trivia: trivia && str(trivia.q, 300) && str(trivia.a, 150) ? { q: str(trivia.q, 300), a: str(trivia.a, 150) } : null,
    minutes: b.minutes === undefined ? undefined : int(b.minutes, 0, 24 * 60, 0),
    request: str(b.request, 120).trim() || undefined,
  };
}

export async function POST(req: Request) {
  const no = guard(req, "segment", 90); if (no) return no;
  const raw = await readJson(req, 200_000);
  if (!raw) return Response.json({ error: "Invalid request body" }, { status: 400 });
  const body = parse(raw);
  const { prefs, index } = body;
  // Per-session "RJ talks about" toggles: turned-off types never happen (LLM and template alike).
  const romantic = isRomantic(body.mode);
  if (romantic) { prefs.language = "hindi"; prefs.humor = "off"; } // Romantic Hindi: Devanagari Hindi, poetic, no jokes
  const talk = prefs.talk;
  if (prefs.justMusic) { talk.news = false; talk.jokes = false; talk.facts = false; }
  if (!talk.jokes) body.withJoke = false;
  if (!talk.news || romantic) body.withNews = false;
  const minimal = !talk.news && !talk.jokes && !talk.facts;
  if (minimal && body.kind !== "switch") {
    if (body.mode === "focus" || (prefs.justMusic && body.kind === "stinger")) return Response.json({ script: "", mood: "calm", kind: body.kind ?? "full", mode: "skip", headlines: [] });
    body.kind = "stinger"; body.index = Math.max(1, index); // just a short transition naming the next song
  }
  const wantNews = body.withNews ?? (!romantic && (!body.mode || body.mode === "default" || body.mode === "drive") && index % 2 === 0);
  const headlines = wantNews && body.kind !== "stinger" && prefs.newsTopics?.length ? await fetchHeadlines(prefs.newsTopics, prefs.language, 6).catch(() => []) : [];
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
  // The AI writer is optional: any failure (no key, quota used up, timeout, outage) lands on the built-in templates, so the radio never goes quiet.
  const llm = await llmScriptWith({ ...input, segment }).catch((e) => { console.error("script writer failed:", e instanceof Error ? e.name : "error"); return null; });
  // A trivia question carries its answer on a hidden last line: keep it for the next break, never speak it.
  const { text: rawText, answer } = splitAnswer(llm ? llm.text : templateScript({ ...input, segment }));
  const { mood, text } = splitMood(rawText.replace(/\s+/g, " "));
  const trivia = llm && segment === "trivia_q" && answer && text ? { q: text.slice(-220), a: answer } : null;
  const defaultMood = { default: "cheerful", drive: "cheerful", gym: "hype", focus: "calm", romantic_m: "warm", romantic_f: "warm", romantic_s: "warm" }[body.mode ?? "default"];
  return Response.json({ script: text.slice(0, 1500), mood: mood ?? defaultMood, kind: body.kind ?? "full", mode: llm ? "llm" : "template", provider: llm?.provider ?? "template", segment: llm ? segment : "vibe", trivia, headlines: headlines.slice(0, 2) });
}
