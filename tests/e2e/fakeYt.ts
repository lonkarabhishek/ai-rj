/* Fake YouTube IFrame API + our /api/youtube/* routes. Videos carry their true language for assertions. */
import type { Page } from "@playwright/test";

export interface FV { id: string; title: string; channel: string; seconds: number; audioLang?: string; lang: string; instrumental?: boolean }
export class YtWorld {
  loads: { t: number; id: string }[] = [];
  searches: string[] = [];
  poolCalls = 0;
  calls: string[] = [];
  videos = new Map<string, FV>();
  add(v: FV) { this.videos.set(v.id, v); return v; }
}
const SDK = (songSec: number) => `(() => {
  const st = { ON: 1 };
  window.__yt = { calls: [], players: [] };
  window.YT = { PlayerState: { ENDED: 0, PLAYING: 1, PAUSED: 2, BUFFERING: 3, CUED: 5 }, Player: class {
    constructor(el, o) { this.o = o; this.vol = 100; this.state = -1; this.t = 0; this.id = ""; this.dur = 0; window.__yt.players.push(this);
      const f = document.createElement('div'); f.id = 'fake-yt'; f.style.cssText = 'width:100%;height:100%;background:#111'; el.replaceWith(f); this.el = f;
      setTimeout(() => o.events.onReady && o.events.onReady({ target: this }), 150);
      setInterval(() => { if (this.state === 1) { this.t += 0.25; if (this.t >= this.dur) this.set(0); } }, 250); }
    set(s) { this.state = s; this.o.events.onStateChange && this.o.events.onStateChange({ data: s, target: this }); }
    loadVideoById(a) { const id = a.videoId || a; this.id = id; this.t = 0; window.__yt.calls.push('load:' + id);
      fetch('/__yt/load?id=' + id).catch(() => {});
      if (id.startsWith('bad')) { setTimeout(() => this.o.events.onError && this.o.events.onError({ data: 150 }), 300); return; }
      this.dur = ${songSec}; this.set(3); setTimeout(() => { if (this.id === id && !window.__ytBlock) this.set(1); }, 400); }
    cueVideoById(a) { this.id = a.videoId || a; this.set(5); }
    playVideo() { window.__yt.calls.push('play'); if (this.id && this.dur) this.set(1); }
    pauseVideo() { window.__yt.calls.push('pause'); if (this.state === 1) this.set(2); }
    stopVideo() { this.set(0); }
    setVolume(v) { this.vol = v; } getVolume() { return this.vol; }
    getCurrentTime() { return this.t; } getDuration() { return this.dur; }
    getVideoData() { return { video_id: this.id }; }
  } };
  setTimeout(() => window.onYouTubeIframeAPIReady && window.onYouTubeIframeAPIReady(), 50);
})();`;

export async function setupYt(page: Page, o: { songSec?: number; connected?: boolean; pool?: FV[]; search?: (q: string) => FV[] } = {}) {
  const w = new YtWorld();
  for (const v of o.pool ?? []) w.add(v);
  const out = (v: FV) => ({ id: v.id, title: v.title, channel: v.channel, seconds: v.seconds, audioLang: v.audioLang });
  await page.route("https://www.youtube.com/iframe_api", (r) => r.fulfill({ contentType: "application/javascript", body: SDK(o.songSec ?? 20) }));
  await page.route(/https:\/\/(www\.)?(youtube\.com|googleapis\.com|ytimg\.com)\/.*/, (r) => r.request().url().includes("iframe_api") ? r.fallback() : r.fulfill({ status: 204 }));
  await page.route("**/__yt/load**", (r) => { w.loads.push({ t: Date.now(), id: new URL(r.request().url()).searchParams.get("id")! }); r.fulfill({ status: 204 }); });
  await page.route("**/api/youtube/songs?status", (r) => r.fulfill({ json: { configured: true, connected: o.connected ?? true } }));
  await page.route("**/api/youtube/pool", async (r) => { w.poolCalls++; await new Promise((x) => setTimeout(x, 500)); r.fulfill({ json: { videos: (o.pool ?? []).map(out) } }); });
  await page.route("**/api/youtube/links", (r) => r.fulfill({ json: { videos: [] } }));
  await page.route("**/api/youtube/search**", async (r) => {
    const q = new URL(r.request().url()).searchParams.get("q") ?? ""; w.searches.push(q);
    await new Promise((x) => setTimeout(x, 600));
    const vs = (o.search?.(q) ?? []).map((v) => w.add(v));
    r.fulfill({ json: { videos: vs.map(out) } });
  });
  return w;
}

let n = 0;
export const vid = (lang: string, title: string, extra: Partial<FV> = {}): FV => ({ id: `v${++n}`, title, channel: extra.channel ?? "Some Channel", seconds: 200, lang, ...extra, ...(extra.id ? { id: extra.id } : {}) });
