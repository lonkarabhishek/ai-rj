import type { Language } from "./prefs";

export interface Headline { title: string; source?: string; link?: string; topic: string }

const LOCALE: Record<Language, { hl: string; ceid: string; gl: string }> = {
  english: { hl: "en-US", ceid: "US:en", gl: "US" },
  spanish: { hl: "es-419", ceid: "MX:es-419", gl: "MX" },
  hinglish: { hl: "en-IN", ceid: "IN:en", gl: "IN" },
  hindi: { hl: "hi", ceid: "IN:hi", gl: "IN" },
  marathi: { hl: "mr", ceid: "IN:mr", gl: "IN" },
};

function decode(s: string) {
  return s
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&#39;/g, "'")
    .replace(/&lt;/g, "<").replace(/&gt;/g, ">").trim();
}

// Belizean newsrooms with public RSS feeds, read directly so local stories show up even when Google News is slow to pick them up.
const BELIZE_FEEDS = [
  "https://www.breakingbelizenews.com/feed/",
  "https://amandala.com.bz/news/feed/",
  "https://lovefm.com/feed/",
  "https://edition.channel5belize.com/feed/",
];
const FRESH_MS = 2 * 86_400_000;
const FEED_NAMES: [RegExp, string][] = [[/breakingbelizenews/i, "Breaking Belize News"], [/amandala/i, "Amandala"], [/lovefm/i, "Love FM"], [/channel5/i, "News 5"]];
// Not stories: a newspaper's issue listing ("Amandala #3976 Friday, November 13"), e-paper and edition posts.
const NOT_NEWS = /#\s?\d{3,}|\be-?paper\b|\b(today'?s|this week'?s) (edition|issue)\b|^edition\b/i;

async function rss(url: string, n: number, topic: string, fixedSource?: string): Promise<Headline[]> {
  const res = await fetch(url, { headers: { "User-Agent": "Mozilla/5.0 MyRJ" }, signal: AbortSignal.timeout(5000) });
  if (!res.ok) return [];
  const xml = await res.text();
  const channel = decode(xml.match(/<channel>[\s\S]*?<title>([\s\S]*?)<\/title>/)?.[1] ?? "");
  const out: Headline[] = [];
  for (const it of xml.split("<item>").slice(1)) {
    if (out.length >= n) break;
    const date = Date.parse(decode(it.match(/<pubDate>([\s\S]*?)<\/pubDate>/)?.[1] ?? ""));
    if (date && Date.now() - date > FRESH_MS) continue; // up to date only
    const rawTitle = decode(it.match(/<title>([\s\S]*?)<\/title>/)?.[1] ?? "");
    const source = fixedSource ?? decode(it.match(/<source[^>]*>([\s\S]*?)<\/source>/)?.[1] ?? "") ?? channel;
    const link = decode(it.match(/<link>([\s\S]*?)<\/link>/)?.[1] ?? "");
    // Google News titles end with " - Source"
    const title = source && rawTitle.endsWith(` - ${source}`) ? rawTitle.slice(0, -(source.length + 3)) : rawTitle;
    if (title && !NOT_NEWS.test(title)) out.push({ title, source: FEED_NAMES.find(([re]) => re.test(url))?.[1] ?? (source || channel), link, topic });
  }
  return out;
}

const WMO: Record<number, string> = { 0: "clear skies", 1: "mostly clear", 2: "partly cloudy", 3: "cloudy", 45: "fog", 48: "fog", 51: "light drizzle", 53: "drizzle", 55: "heavy drizzle",
  61: "light rain", 63: "rain", 65: "heavy rain", 80: "rain showers", 81: "rain showers", 82: "heavy showers", 95: "thunderstorms", 96: "thunderstorms", 99: "thunderstorms" };

/** "Weather" or "Weather in Orange Walk": today's forecast from Open-Meteo (free, no key). Belize City by default. */
async function weather(topic: string): Promise<Headline[]> {
  const place = topic.match(/weather\s+(?:in|for)?\s*(.+)$/i)?.[1]?.trim() || "Belize City";
  const g = await fetch(`https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(place)}&count=1`, { signal: AbortSignal.timeout(5000) }).then((r) => r.json()).catch(() => null);
  const loc = g?.results?.[0]; if (!loc) return [];
  const w = await fetch(`https://api.open-meteo.com/v1/forecast?latitude=${loc.latitude}&longitude=${loc.longitude}&current=temperature_2m,weather_code&daily=temperature_2m_max,temperature_2m_min,precipitation_probability_max&timezone=auto&forecast_days=1`,
    { signal: AbortSignal.timeout(5000) }).then((r) => r.json()).catch(() => null);
  if (!w?.current) return [];
  const now = Math.round(w.current.temperature_2m), hi = Math.round(w.daily?.temperature_2m_max?.[0]), lo = Math.round(w.daily?.temperature_2m_min?.[0]);
  const rain = w.daily?.precipitation_probability_max?.[0];
  const sky = WMO[w.current.weather_code] ?? "";
  return [{ topic, source: "Open-Meteo", title: `Weather in ${loc.name}: ${now}°C now${sky ? ` with ${sky}` : ""}, high of ${hi}, low of ${lo}${typeof rain === "number" ? `, ${rain}% chance of rain today` : ""}` }];
}

export async function fetchHeadlines(topics: string[], language: Language, perTopic = 3): Promise<Headline[]> {
  const { hl, ceid, gl } = LOCALE[language] ?? LOCALE.english;
  const out: Headline[] = [];
  await Promise.all(
    topics.slice(0, 8).map(async (topic) => {
      if (/^weather\b/i.test(topic.trim())) { out.push(...await weather(topic).catch(() => [])); return; }
      if (/^belize( news)?$/i.test(topic.trim())) { // straight from Belizean newsrooms, then Google News to fill in
        const local = (await Promise.all(BELIZE_FEEDS.map((f) => rss(f, 2, topic).catch(() => [])))).flat();
        const g = await rss(`https://news.google.com/rss/search?q=${encodeURIComponent("Belize when:1d")}&hl=en-US&gl=US&ceid=US:en`, perTopic, topic).catch(() => []);
        const seen = new Set<string>();
        out.push(...[...local, ...g].filter((h) => { const k = h.title.toLowerCase().slice(0, 50); return !seen.has(k) && !!seen.add(k); }).slice(0, perTopic + 1));
        return;
      }
      const q = /^ai$/i.test(topic.trim()) ? '"artificial intelligence" OR OpenAI OR "AI model"' : topic;
      const url = `https://news.google.com/rss/search?q=${encodeURIComponent(q + " when:2d")}&hl=${hl}&gl=${gl}&ceid=${ceid}`;
      try {
        const res = await fetch(url, { headers: { "User-Agent": "Mozilla/5.0 MyRJ" }, signal: AbortSignal.timeout(5000) });
        if (!res.ok) return;
        const xml = await res.text();
        const items = xml.split("<item>").slice(1, perTopic + 1);
        for (const it of items) {
          const rawTitle = decode(it.match(/<title>([\s\S]*?)<\/title>/)?.[1] ?? "");
          const source = decode(it.match(/<source[^>]*>([\s\S]*?)<\/source>/)?.[1] ?? "");
          const link = decode(it.match(/<link>([\s\S]*?)<\/link>/)?.[1] ?? "");
          // Google News titles end with " - Source"
          const title = source && rawTitle.endsWith(` - ${source}`) ? rawTitle.slice(0, -(source.length + 3)) : rawTitle;
          if (title) out.push({ title, source, link, topic });
        }
      } catch { /* ignore one topic failing */ }
    })
  );
  return out;
}
