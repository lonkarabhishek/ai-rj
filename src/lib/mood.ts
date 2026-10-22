"use client";
/* Romantic-Hindi classification of his own songs (client): one Haiku call via /api/songmood, results cached 24h in one localStorage entry. */
export interface MoodItem { id: string; title: string; artist: string }
export interface Mood { lang: string; romantic: boolean; sensual?: boolean } // sensual songs are also romantic
const KEY = "myrj.mood3", DAY = 24 * 3600e3;
type Store = Record<string, [number, string, 0 | 1, (0 | 1)?]>;
function load(): Store { try { return JSON.parse(localStorage.getItem(KEY) ?? "{}") as Store; } catch { return {}; } }
function save(s: Store) {
  const e = Object.entries(s).filter(([, v]) => Date.now() - v[0] < DAY).sort((a, b) => b[1][0] - a[1][0]).slice(0, 1500);
  try { localStorage.setItem(KEY, JSON.stringify(Object.fromEntries(e))); } catch { /* full */ }
}
/** Cached labels for what is known; fetches the rest (max 60, one call, short timeout). Never throws: on any failure returns just the cache. */
export async function classifyMood(items: MoodItem[], timeoutMs = 7000): Promise<Map<string, Mood>> {
  const store = load(), out = new Map<string, Mood>();
  const need: MoodItem[] = [];
  for (const it of items) { const c = store[it.id]; if (c && Date.now() - c[0] < DAY) out.set(it.id, { lang: c[1], romantic: !!c[2], sensual: !!c[3] }); else need.push(it); }
  if (!need.length) return out;
  try {
    const r = await fetch("/api/songmood", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ items: need.slice(0, 60) }), signal: AbortSignal.timeout(timeoutMs) });
    if (!r.ok) return out;
    const labels = ((await r.json()).labels ?? {}) as Record<string, Mood>;
    for (const [id, l] of Object.entries(labels)) { out.set(id, l); store[id] = [Date.now(), l.lang, l.romantic ? 1 : 0, l.sensual ? 1 : 0]; }
    save(store);
  } catch { /* classification failed: caller falls back */ }
  return out;
}
