/* Fake world for E2E: Spotify (with today's real limits), Claude /api/segment, TTS and news, with realistic latencies. */
import { expect, type BrowserContext, type Page } from "@playwright/test";
import fs from "fs";
import path from "path";

export const MP3 = fs.readFileSync(path.join(__dirname, "tone.mp3"));
export const IPHONE_UA = "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1";
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const jitter = (a: number, b: number) => a + Math.random() * (b - a);

export type Lang = "hindi" | "english" | "punjabi" | "marathi" | "tamil" | "telugu" | "unknown";
export interface FakeTrack { id: string; uri: string; name: string; lang: Lang; instrumental: boolean; durationMs: number; sensual?: boolean }

export interface Faults {
  token401Once?: boolean;      // first /me answers 401: the app must refresh the token and retry
  play404Once?: boolean;       // first play: 404 device not found
  rate429?: number;            // first N Spotify calls answer 429 Retry-After: 1
  play502Once?: boolean;       // first play answers 502
  claudeHang?: boolean;        // /api/segment never answers within the client timeout
  tts502?: boolean;            // /api/tts fails (Azure down)
  noDevices?: boolean;
  mood500?: boolean;           // /api/songmood fails (classification down)
}
export interface Opts { mobile: boolean; prefs?: Record<string, unknown> | null; faults?: Faults; songMs?: number; segmentMs?: number; ttsMs?: number; trivia?: boolean } // trivia: the first full break after the opener asks a question

export const BASE_PREFS = { onboarded: true, rjName: "Riya", listenerName: "Abhishek", voiceId: "en-IN-NeerjaNeural", newsTopics: ["AI"] };

const SENSUAL_Q = /murder|jism|hate story|intehaan|race|aashiq|baadal|emraan|sensual|seductive|\bhot\b/i;
const LANG_WORDS: [RegExp, Lang][] = [[/hindi|bollywood|filmi|arijit|murder|jism|hate story|intehaan|race 2|aashiq|baadal|emraan|seductive/i, "hindi"], [/punjabi|bhangra|desi hip hop|diljit/i, "punjabi"], [/marathi|lavani|ajay atul/i, "marathi"], [/tamil|kollywood|anirudh|ilaiyaraaja/i, "tamil"], [/telugu|tollywood/i, "telugu"], [/english|pop|indie|rock|r&b|lofi|piano|ambient/i, "english"]];
const SCRIPT: Partial<Record<Lang, string>> = { tamil: "பாடல்", telugu: "పాట", hindi: "गाना" };

export class World {
  tracks = new Map<string, FakeTrack>();
  plays: { t: number; uri: string }[] = [];
  segments: any[] = [];
  tts: string[] = [];
  searches: string[] = [];
  moodCalls: string[][] = [];
  spotifyCalls: string[] = [];
  consoleErrors: string[] = [];
  player = { uri: "", startedAt: 0, pausedAt: 0, isPlaying: false, device: "", queue: [] as string[] };
  playBodies: string[][] = []; // uris of every explicit play request
  gate: Promise<void> | null = null; // while set, the page's Spotify calls hang (a frozen or stalled page); the device keeps playing
  externalPause = false;
  clickAt = 0;
  private n = 0;
  constructor(public o: Opts) {}
  track(lang: Lang, instrumental = false, scriptName = false): FakeTrack {
    const i = ++this.n;
    const base = instrumental ? `Calm Keys ${i} (Instrumental)` : `${lang === "unknown" ? "Fav" : lang[0].toUpperCase() + lang.slice(1)} Song ${i}`;
    const t: FakeTrack = { id: `t${i}`, uri: `spotify:track:t${i}`, name: scriptName && SCRIPT[lang] ? `${SCRIPT[lang]} ${i}` : base, lang, instrumental, durationMs: this.o.songMs ?? 20000 };
    this.tracks.set(t.uri, t); return t;
  }
  json(t: FakeTrack) {
    return { type: "track", id: t.id, uri: t.uri, name: t.name, duration_ms: t.durationMs, artists: [{ name: `Artist ${t.lang} ${Number(t.id.slice(1)) % 9}`, id: `ar_${t.lang}_${Number(t.id.slice(1)) % 9}` }], album: { name: "Album", images: [] }, external_urls: { spotify: "https://open.spotify.com/track/" + t.id }, preview_url: null };
  }
  position() {
    const p = this.player; if (!p.uri) return 0;
    return Math.min((p.isPlaying ? Date.now() : p.pausedAt) - p.startedAt, this.tracks.get(p.uri)?.durationMs ?? 0);
  }
  state() {
    const p = this.player;
    // Like the real app: a song queued behind the current one starts by itself when the current one ends.
    for (let cur = this.tracks.get(p.uri); cur && p.isPlaying && p.queue.length && Date.now() - p.startedAt >= cur.durationMs; cur = this.tracks.get(p.uri)) {
      const nx = p.queue.shift()!; p.startedAt += cur.durationMs; p.uri = nx;
    }
    const t = this.tracks.get(p.uri);
    if (!t) return null;
    const pos = this.position(); const ended = pos >= t.durationMs;
    return { is_playing: p.isPlaying && !ended, progress_ms: ended ? 0 : pos, item: this.json(t), device: { id: p.device } };
  }
  playedTracks() { return this.plays.map((p) => this.tracks.get(p.uri)!).filter(Boolean); }
  firstPlayMs() { return this.plays.length ? this.plays[0].t - this.clickAt : Infinity; }
}

function sdkSource(mobile: boolean) {
  // Fake Web Playback SDK: reads/writes the same fake Spotify world through the routed API.
  return `(() => {
    const api = (p, m) => fetch('https://api.spotify.com/v1' + p, { method: m || 'GET', headers: { Authorization: 'Bearer sdk' } }).then(r => r.status === 200 ? r.json() : null).catch(() => null);
    window.Spotify = { Player: class { constructor(o) { this.l = {}; this.vol = 0.8; }
      addListener(e, f) { this.l[e] = f; return true; }
      async connect() { ${mobile ? "" : "setTimeout(() => this.l.ready && this.l.ready({ device_id: 'web1' }), 700);"} return true; }
      disconnect() {} activateElement() { return Promise.resolve(); }
      async pause() { await api('/me/player/pause?device_id=web1&sdk=1', 'PUT'); }
      async resume() { await api('/me/player/play?device_id=web1&sdk=1', 'PUT'); }
      async setVolume(v) { this.vol = v; (window.__vols = window.__vols || []).push([Date.now(), v]); } async getVolume() { return this.vol; }
      async getCurrentState() { const s = await api('/me/player?sdk=1'); if (!s || !s.item) return null;
        return { paused: !s.is_playing, position: s.progress_ms, duration: s.item.duration_ms, track_window: { current_track: { uri: s.item.uri } } }; }
    } };
    setTimeout(() => window.onSpotifyWebPlaybackSDKReady && window.onSpotifyWebPlaybackSDKReady(), 50);
  })();`;
}

export function segScript(b: any) {
  const nm = b.next?.name ?? "this next one";
  const talk = Object.assign({ news: true, jokes: true, facts: true }, b.prefs?.talk);
  if (b.prefs?.justMusic) { talk.news = talk.jokes = talk.facts = false; }
  if (b.kind === "switch") return `Switching gears now, Abhishek, ${b.mode} mode it is. Settle in, ${nm} is up.`;
  const bits = [`That's the mood right there, Abhishek, it's your girl ${b.prefs?.rjName ?? "Riya"} keeping you company this evening.`];
  if (talk.news && b.withNews !== false) bits.push("[NEWS] Quick one from the AI world: models are getting faster again.");
  if (talk.jokes && b.withJoke) bits.push("[JOKE] Why did the playlist go to therapy? Too many unresolved tracks.");
  if (talk.facts) bits.push("[FACT] This one was recorded in a single take.");
  bits.push(`Coming up, ${nm}.`);
  return bits.join(" ");
}

export async function setup(ctx: BrowserContext, page: Page, o: Opts) {
  const w = new World(o);
  const f = o.faults ?? {};
  let rate = f.rate429 ?? 0, me401 = !!f.token401Once, p404 = !!f.play404Once, p502 = !!f.play502Once, tokenForced = false;
  const prefs = o.prefs === null ? null : { ...BASE_PREFS, ...(o.prefs ?? {}) };
  await ctx.addInitScript((v) => { if (v && !sessionStorage.getItem("e2e-seeded")) { localStorage.setItem("myrj.prefs.v1", v); sessionStorage.setItem("e2e-seeded", "1"); } }, prefs ? JSON.stringify(prefs) : "");
  // MediaSession spy: record handlers so tests can fire lock-screen actions.
  await ctx.addInitScript(() => {
    (window as any).__ms = {};
    try { const ms = navigator.mediaSession; if (ms) { const orig = ms.setActionHandler.bind(ms); ms.setActionHandler = (a: any, h: any) => { (window as any).__ms[a] = h; try { orig(a, h); } catch {} }; } } catch {}
    // Track audible RJ audio: element plays + their muted/volume state.
    (window as any).__audio = [];
    const op = HTMLMediaElement.prototype.play;
    HTMLMediaElement.prototype.play = function () { (window as any).__audio.push({ src: this.src.slice(0, 30), muted: this.muted, volume: this.volume, at: Date.now() }); return op.call(this); };
    (window as any).__speech = [];
    if (window.speechSynthesis) { const os = speechSynthesis.speak.bind(speechSynthesis); speechSynthesis.speak = (u: SpeechSynthesisUtterance) => { (window as any).__speech.push(u.text); setTimeout(() => { u.onend?.(new Event("end") as any); }, 1500); try { os(u); } catch {} }; }
  });
  // Safety net: nothing may ever reach the real Spotify (page routes below take precedence; anything else is aborted).
  await ctx.route(/https:\/\/(api|accounts)\.spotify\.com\/.*/, (r) => { w.consoleErrors.push(`LEAKED real Spotify call: ${r.request().url()}`); r.abort(); });
  page.on("console", (m) => { if (m.type() === "error") w.consoleErrors.push(m.text()); });
  page.on("pageerror", (e) => w.consoleErrors.push(String(e)));

  await page.route("https://sdk.scdn.co/**", (r) => r.fulfill({ contentType: "application/javascript", body: sdkSource(o.mobile) }));
  await page.route("**/api/spotify/token**", async (r) => {
    if (r.request().url().includes("force=1")) tokenForced = true;
    await sleep(jitter(60, 150));
    r.fulfill({ json: { accessToken: "tok", expiresAt: Date.now() + 3600e3, scope: "streaming user-read-email user-read-private user-read-playback-state user-modify-playback-state user-top-read user-library-read playlist-read-private" } });
  });
  const favs = () => [...Array(40)].map((_, i) => w.json(i % 10 === 0 ? w.track("tamil", false, true) : i % 7 === 0 ? w.track("hindi", false, true) : w.track("unknown")));
  await page.route("https://api.spotify.com/**", async (r) => {
    const u = new URL(r.request().url()), m = r.request().method(), p = u.pathname.replace("/v1", "");
    const sdk = u.searchParams.get("sdk") === "1";
    if (!sdk) w.spotifyCalls.push(`${m} ${p}`);
    if (w.gate) await w.gate;
    await sleep(sdk ? 30 : jitter(120, 380));
    if (!sdk && rate > 0) { rate--; return r.fulfill({ status: 429, headers: { "Retry-After": "1" }, json: { error: { status: 429 } } }); }
    if (p === "/me" && me401) { me401 = false; return r.fulfill({ status: 401, json: { error: { status: 401, message: "The access token expired" } } }); }
    if (p === "/me") return r.fulfill({ json: { display_name: "Abhishek", product: "premium", id: "u1" } });
    if (p === "/me/player/devices") {
      const devs = f.noDevices ? [] : o.mobile ? [{ id: "phone1", name: "iPhone", type: "Smartphone", is_active: true, is_restricted: false }] : [{ id: "web1", name: "MyRJ Web Player", type: "Computer", is_active: false, is_restricted: false }];
      return r.fulfill({ json: { devices: devs } });
    }
    if (p === "/me/player/play") {
      const body = r.request().postDataJSON?.() ?? null;
      if (body?.uris) {
        if (p404) { p404 = false; return r.fulfill({ status: 404, json: { error: { status: 404, message: "Device not found", reason: "NO_ACTIVE_DEVICE" } } }); }
        if (p502) { p502 = false; return r.fulfill({ status: 502, json: { error: { status: 502 } } }); }
        w.plays.push({ t: Date.now(), uri: body.uris[0] }); w.playBodies.push(body.uris);
        Object.assign(w.player, { uri: body.uris[0], startedAt: Date.now(), isPlaying: true, device: u.searchParams.get("device_id") ?? "", queue: body.uris.slice(1) });
      } else if (w.player.uri && !w.player.isPlaying) { w.player.startedAt += Date.now() - w.player.pausedAt; w.player.isPlaying = true; }
      return r.fulfill({ status: 204 });
    }
    if (p === "/me/player/pause") { if (w.player.isPlaying) { w.player.pausedAt = Date.now(); w.player.isPlaying = false; } return r.fulfill({ status: 204 }); }
    if (p.startsWith("/me/player/volume") || (p === "/me/player" && m === "PUT")) return r.fulfill({ status: 204 });
    if (p === "/me/player") { const s = w.state(); return s ? r.fulfill({ json: s }) : r.fulfill({ status: 204 }); }
    if (p.startsWith("/me/top/tracks")) return r.fulfill({ json: { items: favs().slice(0, 20) } });
    if (p === "/me/tracks") return r.fulfill({ json: { items: favs().slice(0, 20).map((t) => ({ track: t })) } });
    if (p === "/me/playlists") return r.fulfill({ json: { items: [0, 1, 2].map((i) => ({ id: "pl" + i, name: "PL" + i, owner: { id: "u1" } })) } });
    if (p.startsWith("/playlists/")) { await sleep(600); return r.fulfill({ json: { items: favs().slice(0, 25).map((t) => ({ item: t, track: t })) } }); }
    if (p.startsWith("/me/top/artists")) return r.fulfill({ json: { items: [0, 1, 2, 3].map((i) => ({ id: "ar" + i, name: "Top Artist " + i, genres: [] })) } }); // genres are empty for dev-mode apps now
    if (/^\/artists\/[^/]+\/top-tracks/.test(p)) return r.fulfill({ status: 403, json: { error: { status: 403 } } }); // removed for dev-mode apps
    if (p === "/artists") return r.fulfill({ status: 403, json: { error: { status: 403, message: "Forbidden" } } });
    if (p === "/audio-features" || p === "/recommendations") return r.fulfill({ status: 403, json: { error: { status: 403 } } });
    if (p === "/search") {
      const limit = Number(u.searchParams.get("limit") ?? 20), q = u.searchParams.get("q") ?? "";
      w.searches.push(q);
      if (limit > 10) return r.fulfill({ status: 400, json: { error: { status: 400, message: "Invalid limit" } } });
      await sleep(jitter(150, 400));
      const lang = SENSUAL_Q.test(q) ? "hindi" : LANG_WORDS.find(([re]) => re.test(q))?.[1] ?? "unknown"; // every sensual search is a Bollywood song or film
      const instr = /instrumental|lofi|lo-fi|piano|ambient|study|focus|classical|beats/i.test(q);
      // Focus searches still return a few vocal tracks (as Spotify does): the app must filter them out.
      // Sensual searches: half the results are sensual, half plain love songs (the app must keep only the sensual ones).
      const items = [...Array(limit)].map((_, i) => { const t = instr ? (i % 3 === 0 ? w.track(lang) : w.track(lang, true)) : w.track(lang); if (SENSUAL_Q.test(q) && i % 2 === 0) { t.sensual = true; t.name = `Sensual ${t.name}`; } if (!t.instrumental && i % 5 === 4) t.name = `${t.name} (Remix)`; return w.json(t); }); // like real search: some remixes in the mix
      return r.fulfill({ json: { tracks: { items } } });
    }
    return r.fulfill({ json: {} });
  });
  await page.route("**/api/segment", async (r) => {
    const b = r.request().postDataJSON(); w.segments.push(b);
    if (f.claudeHang) { await sleep(25000); return r.fulfill({ status: 504, body: "timeout" }).catch(() => {}); }
    await sleep(o.segmentMs ?? jitter(1800, 3200));
    const talk = Object.assign({ news: true, jokes: true, facts: true }, b.prefs?.talk);
    const minimal = b.prefs?.justMusic || (!talk.news && !talk.jokes && !talk.facts);
    if (minimal && b.kind !== "switch" && b.mode === "focus") return r.fulfill({ json: { script: "", mood: "calm", kind: b.kind, mode: "skip", headlines: [] } }).catch(() => {});
    const ask = o.trivia && b.kind === "full" && b.index > 0 && !w.segments.some((x) => x !== b && x.kind === "full" && x.index > 0 && x.segment !== "trivia_a" && x.asked);
    if (ask) b.asked = true;
    const script = minimal && b.kind !== "switch" ? `Next up, ${b.next?.name ?? "more music"}, stay with me.` : b.segment === "trivia_a" && b.trivia ? `Toh jawab hai ${b.trivia.a}! Coming up, ${b.next?.name ?? "more"}.` : segScript(b);
    r.fulfill({ json: { script, mood: "warm", kind: b.kind ?? "full", mode: "llm", segment: ask ? "trivia_q" : b.segment ?? "vibe", trivia: ask ? { q: "Which year did this one come out?", a: "twenty nineteen" } : null, headlines: [] } }).catch(() => {});
  });
  await page.route("**/api/tts", async (r) => {
    const b = r.request().postDataJSON(); w.tts.push(b.text);
    await sleep(o.ttsMs ?? jitter(700, 1400));
    if (f.tts502) return r.fulfill({ status: 502, json: { error: "Azure TTS failed: 502" } }).catch(() => {});
    r.fulfill({ status: 200, contentType: "audio/mpeg", headers: { "x-tts-provider": "azure" }, body: MP3 }).catch(() => {});
  });
  // Haiku mood/language labelling of his own songs: the fake world knows each track's true language; romantic unless the title says party/dance.
  await page.route("**/api/songmood", async (r) => {
    const b = r.request().postDataJSON(); w.moodCalls.push(b.items.map((x: any) => x.id));
    await sleep(jitter(150, 400));
    if (f.mood500) return r.fulfill({ status: 502, json: { labels: {} } });
    const labels: Record<string, any> = {};
    for (const it of b.items) { const t = w.tracks.get(it.id); if (t) labels[it.id] = { lang: t.lang, romantic: !/party|dance|remix/i.test(t.name), sensual: !!t.sensual }; }
    r.fulfill({ json: { labels } });
  });
  await page.route("**/api/news**", async (r) => { await sleep(jitter(300, 700)); r.fulfill({ json: { headlines: [{ title: "Models get faster again, says a new benchmark today", source: "Wire" }] } }); });
  (w as any).tokenForced = () => tokenForced;
  return w;
}

export async function goLive(page: Page, w: World) {
  const btn = page.getByRole("button", { name: "Go Live", exact: true });
  await expect(btn).toBeVisible();
  w.clickAt = Date.now();
  await btn.click();
}

export async function noHorizontalOverflow(page: Page) {
  const o = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(o, "horizontal overflow (px)").toBeLessThanOrEqual(0);
}

/** Console errors that are ours (ignore aborted media loads from blob revocation and the fake SDK). */
export function realErrors(w: World) {
  return w.consoleErrors.filter((e) => !/Failed to load resource: the server responded with a status of (400|403|404|429|502)|net::ERR_ABORTED|NotAllowedError|AbortError|favicon|status of 401/i.test(e));
}

export async function diag(page: Page): Promise<Record<string, string>> {
  const btn = page.getByRole("button", { name: /Playback details/ });
  if (!(await page.locator("dl").isVisible().catch(() => false))) await btn.click();
  const rows = await page.locator("dl > *").allInnerTexts();
  const out: Record<string, string> = {};
  for (let i = 0; i + 1 < rows.length; i += 2) out[rows[i].trim()] = rows[i + 1].trim();
  return out;
}

export const BARE_TITLE = /^(up next|next up|here'?s|now playing)[:,]?\s.{0,60}$/i;
