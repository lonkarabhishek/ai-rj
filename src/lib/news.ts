import type { Language } from "./prefs";

export interface Headline { title: string; source?: string; link?: string; topic: string }

const LOCALE: Record<Language, { hl: string; ceid: string }> = {
  english: { hl: "en-IN", ceid: "IN:en" },
  hinglish: { hl: "en-IN", ceid: "IN:en" },
  hindi: { hl: "hi", ceid: "IN:hi" },
  marathi: { hl: "mr", ceid: "IN:mr" },
};

function decode(s: string) {
  return s
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&#39;/g, "'")
    .replace(/&lt;/g, "<").replace(/&gt;/g, ">").trim();
}

export async function fetchHeadlines(topics: string[], language: Language, perTopic = 3): Promise<Headline[]> {
  const { hl, ceid } = LOCALE[language];
  const out: Headline[] = [];
  await Promise.all(
    topics.slice(0, 5).map(async (topic) => {
      const url = `https://news.google.com/rss/search?q=${encodeURIComponent(topic + " when:2d")}&hl=${hl}&gl=IN&ceid=${ceid}`;
      try {
        const res = await fetch(url, { headers: { "User-Agent": "Mozilla/5.0 MyRJ" } });
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
