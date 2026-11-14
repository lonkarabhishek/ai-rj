"use client";
// Cover art for the Now Playing screen: Spotify tracks already carry album art; YouTube videos get real album covers via /api/art
// (iTunes Search), falling back to the video thumbnail. Also derives an ambient colour from the image for the background glow.
import type { TrackInfo } from "./prefs";

export interface Art { url: string | null; color: string | null; kind: "album" | "thumb" | "none" }
const mem = new Map<string, Art>();
const KEY = "myrj.art.v1";
function store(): Record<string, { u: string | null; c: string | null; k: Art["kind"]; at: number }> {
  try { return JSON.parse(localStorage.getItem(KEY) || "{}"); } catch { return {}; }
}
function save(id: string, a: Art) {
  try {
    const s = store(); s[id] = { u: a.url, c: a.color, k: a.kind, at: Date.now() };
    const keys = Object.keys(s); if (keys.length > 400) for (const k of keys.sort((x, y) => s[x].at - s[y].at).slice(0, 100)) delete s[k];
    localStorage.setItem(KEY, JSON.stringify(s));
  } catch { /* storage full or blocked: memory cache still works */ }
}
export const trackKey = (t: TrackInfo) => t.uri ?? t.ytId ?? `${t.name}|${t.artists}`;

/** Average of the image's colourful pixels, as "r g b". Null when the image host doesn't allow reading pixels (CORS). */
export function dominantColor(url: string): Promise<string | null> {
  return new Promise((res) => {
    const img = new Image(); img.crossOrigin = "anonymous"; img.decoding = "async";
    const done = (v: string | null) => { img.onload = img.onerror = null; res(v); };
    img.onload = () => {
      try {
        const c = document.createElement("canvas"); c.width = c.height = 16;
        const x = c.getContext("2d", { willReadFrequently: true }); if (!x) return done(null);
        x.drawImage(img, 0, 0, 16, 16);
        const d = x.getImageData(0, 0, 16, 16).data;
        let r = 0, g = 0, b = 0, w = 0;
        for (let i = 0; i < d.length; i += 4) {
          const R = d[i], G = d[i + 1], B = d[i + 2], max = Math.max(R, G, B), min = Math.min(R, G, B);
          const sat = max ? (max - min) / max : 0, wt = 0.15 + sat * (max > 40 && max < 245 ? 1 : 0.2);
          r += R * wt; g += G * wt; b += B * wt; w += wt;
        }
        if (!w) return done(null);
        // Keep it a mid-tone so text stays readable on top of the glow.
        let [R, G, B] = [r / w, g / w, b / w];
        const l = (Math.max(R, G, B) + Math.min(R, G, B)) / 2, k = l > 150 ? 150 / l : l < 70 ? 70 / Math.max(l, 1) : 1;
        [R, G, B] = [R * k, G * k, B * k].map((v) => Math.round(Math.min(255, v)));
        done(`${R} ${G} ${B}`);
      } catch { done(null); } // tainted canvas: cross-origin image without CORS
    };
    img.onerror = () => done(null);
    setTimeout(() => done(null), 4000);
    img.src = url;
  });
}

const inflight = new Map<string, Promise<Art>>();
export function getArt(t: TrackInfo): Promise<Art> {
  const id = trackKey(t);
  const m = mem.get(id); if (m) return Promise.resolve(m);
  const s = store()[id];
  if (s && Date.now() - s.at < 14 * 86400_000) { const a = { url: s.u, color: s.c, kind: s.k }; mem.set(id, a); return Promise.resolve(a); }
  const p0 = inflight.get(id); if (p0) return p0;
  const p = (async (): Promise<Art> => {
    let url: string | null = null, kind: Art["kind"] = "none";
    if (t.image && !t.ytId) { url = t.image; kind = "album"; } // Spotify: real album art already
    else {
      try {
        const q = new URLSearchParams({ title: t.name, artist: t.artists ?? "" });
        const r = await fetch(`/api/art?${q}`);
        const j = r.ok ? await r.json() : null;
        if (j?.art) { url = j.art; kind = "album"; }
      } catch { /* offline: fall back below */ }
      if (!url && t.ytId) { url = `https://i.ytimg.com/vi/${t.ytId}/hqdefault.jpg`; kind = "thumb"; }
      else if (!url && t.image) { url = t.image; kind = "thumb"; }
    }
    const color = url ? await dominantColor(url) : null;
    const a = { url, color, kind };
    mem.set(id, a); save(id, a); inflight.delete(id);
    return a;
  })();
  inflight.set(id, p);
  return p;
}
