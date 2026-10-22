import { test, expect } from "@playwright/test";
import { setup, goLive, realErrors } from "./fake";
import { setupYt, vid } from "./fakeYt";
import { buildSsml } from "../../src/lib/tts";
import { systemPrompt, templateScript } from "../../src/lib/script";
import { DEFAULT_PREFS, ROMANTIC_MODES } from "../../src/lib/prefs";

const mob = (n: string) => n === "mobile";
const OPTS = [
  { name: "Romantic Hindi · Masculine", mode: "romantic_m", voice: "azure:hi-IN-Dhruv:MAI-Voice-2.1-Flash" },
  { name: "Romantic Hindi · Sultry", mode: "romantic_f", voice: "azure:hi-IN-Priya:MAI-Voice-2.1-Flash" },
] as const;
const DEVANAGARI = /[\u0900-\u097F]/;

test("picker shows both Romantic Hindi options, they persist, and the page doesn't scroll", async ({ context, page }, ti) => {
  await setup(context, page, { mobile: mob(ti.project.name), prefs: { voiceId: "azure:en-IN-NeerjaNeural" } });
  await page.goto("/live");
  for (const o of OPTS) await expect(page.getByRole("radio", { name: o.name })).toBeVisible();
  const scroll = await page.evaluate(() => document.documentElement.scrollHeight - window.innerHeight);
  expect(scroll, "picker must fit the viewport without scrolling").toBeLessThanOrEqual(0);
  await page.getByRole("radio", { name: OPTS[1].name }).click();
  await expect(page.getByRole("radio", { name: OPTS[1].name })).toHaveAttribute("aria-checked", "true");
  await expect(page.getByRole("radio", { name: "My Mix" })).toHaveAttribute("aria-checked", "false");
  await expect(page.getByTestId("songs-hindi-only")).toBeVisible();
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem("myrj.prefs.v1")!).defaultMode)).toBe("romantic_f");
  await page.reload();
  await expect(page.getByRole("radio", { name: OPTS[1].name })).toHaveAttribute("aria-checked", "true");
  await page.getByRole("radio", { name: OPTS[0].name }).click();
  await page.reload();
  await expect(page.getByRole("radio", { name: OPTS[0].name })).toHaveAttribute("aria-checked", "true");
  // choosing a normal mode again leaves the romantic presets
  await page.getByRole("radio", { name: "Gym" }).click();
  await expect(page.getByRole("radio", { name: OPTS[0].name })).toHaveAttribute("aria-checked", "false");
  await expect(page.getByRole("button", { name: "Go Live", exact: true })).toBeVisible();
});

for (const o of OPTS) {
  test(`${o.name}: Spotify plays Hindi only, RJ uses ${o.voice} and Hindi prompts, saved voice untouched`, async ({ context, page }, ti) => {
    const w = await setup(context, page, { mobile: mob(ti.project.name), prefs: { defaultMode: o.mode, songLangs: ["english", "tamil"], language: "english", voiceId: "azure:en-IN-NeerjaNeural" }, segmentMs: 500, ttsMs: 300, songMs: 9000 });
    const tts: any[] = [];
    await page.route("**/api/tts", (r) => { tts.push(r.request().postDataJSON()); r.fallback(); });
    await page.goto("/live");
    await expect(page.getByRole("radio", { name: o.name })).toHaveAttribute("aria-checked", "true");
    await goLive(page, w);
    await expect.poll(() => w.plays.length, { timeout: 10000 }).toBeGreaterThan(0);
    for (let i = 0; i < 2; i++) { await page.getByRole("button", { name: "Next" }).click().catch(() => {}); await expect.poll(() => w.plays.length, { timeout: 25000 }).toBeGreaterThan(i + 1); }
    const played = w.playedTracks();
    expect(played.filter((t) => t.lang !== "hindi").map((t) => `${t.name} (${t.lang})`), "non-Hindi songs").toEqual([]);
    expect(w.searches.length).toBeGreaterThan(0);
    expect(w.searches.filter((q) => !/hindi|bollywood|arijit|ghazal|ishq|atif|jubin|shreya|sonu/i.test(q)), "non-Hindi searches").toEqual([]);
    expect(w.searches.some((q) => /romantic|love|ishq|ghazal|ballad/i.test(q)), "romantic search terms").toBe(true);
    await expect.poll(() => tts.length, { timeout: 15000 }).toBeGreaterThan(0);
    for (const t of tts) { expect(t.voiceId).toBe(o.voice); expect(t.mode).toBe(o.mode); expect(t.language).toBe("hindi"); }
    for (const s of w.segments) { expect(s.mode).toBe(o.mode); expect(s.prefs.language).toBe("hindi"); }
    expect(await page.evaluate(() => JSON.parse(localStorage.getItem("myrj.prefs.v1")!))).toMatchObject({ voiceId: "azure:en-IN-NeerjaNeural", language: "english", songLangs: ["english", "tamil"] });
    expect(realErrors(w)).toEqual([]);
  });

  test(`${o.name}: YouTube plays Hindi romantic only`, async ({ context, page }, ti) => {
    const w = await setup(context, page, { mobile: mob(ti.project.name), prefs: { music: "youtube", defaultMode: o.mode, songLangs: ["english"] }, segmentMs: 400, ttsMs: 300 });
    const pool = [vid("english", "Shape of You", { channel: "Ed Sheeran", audioLang: "en" }), vid("hindi", "Party Anthem Dance Mix", { channel: "T-Series" })];
    const y = await setupYt(page, { pool, songSec: 5, search: (q) => [
      vid("hindi", `Tum Hi Ho ${q.length}`, { channel: "T-Series", audioLang: "hi" }), vid("hindi", `Kesariya ${q.length}`, { channel: "Sony Music India" }),
      vid("hindi", "Hindi Love Song Remix DJ Party", { channel: "DJ" }), vid("english", "Love Story English", { channel: "Taylor", audioLang: "en" }),
    ] });
    await page.goto("/live"); await goLive(page, w);
    await expect.poll(() => y.loads.length, { timeout: 40000 }).toBeGreaterThan(2);
    const played = y.loads.map((l) => y.videos.get(l.id)!);
    expect(played.filter((v) => v.lang !== "hindi" || /remix|party|dance/i.test(v.title)).map((v) => v.title)).toEqual([]);
    expect(y.searches.length).toBeGreaterThan(0);
    expect(y.searches.filter((q) => !/hindi|bollywood|arijit|ghazal|ishq|atif|jubin|shreya|sonu/i.test(q)), "non-Hindi searches").toEqual([]);
    expect(w.spotifyCalls).toEqual([]);
  });
}

test("Romantic Hindi: Hindi prompt, Devanagari template lines, no news or jokes; talk toggles respected", async ({ request }) => {
  for (const o of OPTS) {
    const prefs = { ...DEFAULT_PREFS, language: "hindi" as const, humor: "off" as const };
    const sp = systemPrompt(prefs, o.mode);
    expect(sp).toMatch(/Romantic Hindi/); expect(sp).toMatch(/Devanagari/); expect(sp).toMatch(/shayari/i); expect(sp).toMatch(/never explicit/i); expect(sp).toMatch(/reply with exactly SKIP/);
    const t = templateScript({ prefs, mode: o.mode, index: 1, headlines: [{ title: "Some long headline about markets today", source: "x" } as any], next: { name: "Tum Hi Ho", artists: "Arijit Singh" }, kind: "full" });
    expect(t).toMatch(DEVANAGARI); expect(t).not.toMatch(/Some long headline/);
    // real server route (port 3124 has a broken Claude key, so this is the template path): language forced to Hindi, no jokes/news even if asked
    const r = await request.post("http://localhost:3124/api/segment", { data: { prefs: { ...DEFAULT_PREFS, language: "english", humor: "dark", newsTopics: ["AI"] }, mode: o.mode, index: 1, kind: "full", withNews: true, withJoke: true, next: { name: "Tum Hi Ho", artists: "Arijit Singh" }, recent: [] } });
    const j = await r.json();
    expect(j.script).toMatch(DEVANAGARI); expect(j.headlines).toEqual([]);
    const off = await (await request.post("http://localhost:3124/api/segment", { data: { prefs: { ...DEFAULT_PREFS, talk: { news: false, jokes: false, facts: false }, justMusic: true }, mode: o.mode, index: 1, kind: "stinger", next: { name: "Tum Hi Ho", artists: "Arijit Singh" }, recent: [] } })).json();
    expect(off.script === "" || DEVANAGARI.test(off.script) || /Tum Hi Ho/.test(off.script)).toBe(true);
  }
});

test("Romantic Hindi voices: SSML uses the right voice, slow/low prosody, style only if supported", () => {
  expect(OPTS.map((o) => ROMANTIC_MODES.find((m) => m.id === o.mode)?.voiceId)).toEqual(OPTS.map((o) => o.voice)); // Sensual is covered in sensual.spec.ts
  const m = buildSsml("नमस्ते", "hi-IN-Dhruv:MAI-Voice-2.1-Flash", "chill", "romantic_m", ["softvoice", "whispering"]);
  expect(m).toContain('<voice name="hi-IN-Dhruv:MAI-Voice-2.1-Flash">'); expect(m).toContain('xml:lang="hi-IN"'); expect(m).toMatch(/pitch="-5%"/); expect(m).toMatch(/rate="-8%"/); expect(m).not.toContain("express-as");
  const f = buildSsml("नमस्ते", "hi-IN-Priya:MAI-Voice-2.1-Flash", "chill", "romantic_f", ["softvoice", "whispering"]);
  expect(f).toContain('<voice name="hi-IN-Priya:MAI-Voice-2.1-Flash">'); expect(f).toContain('style="softvoice"'); expect(f).toMatch(/pitch="-3%"/);
  const noStyle = buildSsml("नमस्ते", "hi-IN-AartiNeural", "chill", "romantic_f", []);
  expect(noStyle).not.toContain("express-as"); expect(noStyle).toMatch(/rate="-10%"/);
});

// ---------------- his own songs first (YouTube + Spotify), classification fallbacks ----------------
const hv = (title: string, o: Partial<import("./fakeYt").FV> = {}) => vid("hindi", title, { channel: "Arijit Singh - Topic", label: "hindi", ...o });
const lib = () => [
  hv("Tum Hi Ho (Aashiqui 2)"), hv("Raabta"), hv("Kesariya"), hv("Phir Le Aaya Dil"), hv("Channa Mereya"), hv("Tera Ban Jaunga"), hv("Humnava Mere"),
  hv("Badtameez Dil Party Song", { romantic: false }), hv("Kala Chashma Dance", { romantic: false }),
  vid("english", "Perfect", { channel: "Ed Sheeran", label: "english", audioLang: "en" }), vid("punjabi", "Lover", { channel: "Diljit", label: "punjabi" }),
];

for (const o of OPTS) {
  test(`${o.name}: YouTube plays HIS romantic Hindi songs first, ~1 recommendation per 3, never party/English, searches capped`, async ({ context, page }, ti) => {
    const w = await setup(context, page, { mobile: mob(ti.project.name), prefs: { music: "youtube", defaultMode: o.mode, songLangs: ["english"] }, segmentMs: 300, ttsMs: 200 });
    const L = lib(); const mineIds = new Set(L.filter((v) => v.lang === "hindi" && v.romantic !== false).map((v) => v.id));
    const y = await setupYt(page, { pool: L, songSec: 4, search: (q) => [hv(`Rec ${q.length} A`, { channel: "Sony Music" }), hv(`Rec ${q.length} B`, { channel: "T-Series" }), hv(`Rec ${q.length} C`, { channel: "Zee Music Company" })] });
    await page.goto("/live"); await goLive(page, w);
    await expect.poll(() => y.loads.length, { timeout: 20000 }).toBeGreaterThan(0);
    expect(y.loads[0].t - w.clickAt, "first video (ms)").toBeLessThan(6000);
    await expect.poll(() => y.loads.length, { timeout: 60000 }).toBeGreaterThan(7);
    const ids = y.loads.map((l) => l.id), vs = ids.map((id) => y.videos.get(id)!);
    expect(vs.filter((v) => v.lang !== "hindi" || v.romantic === false).map((v) => v.title), "party/non-Hindi songs").toEqual([]);
    expect(ids.slice(0, 3).every((id) => mineIds.has(id)), "first three are his").toBe(true);
    const firstRec = ids.findIndex((id) => !mineIds.has(id));
    expect(firstRec === -1 || firstRec >= 3, "recommendation comes after 3 of his").toBe(true);
    expect(ids.filter((id) => mineIds.has(id)).length, "his songs dominate").toBeGreaterThanOrEqual(Math.ceil(ids.length * 0.6));
    expect(y.searches.length, "YouTube search cap").toBeLessThanOrEqual(4);
    expect(y.moodCalls, "classified").toBeGreaterThan(0);
    expect(w.spotifyCalls).toEqual([]);
  });

  test(`${o.name}: YouTube still starts and stays Hindi when classification is down`, async ({ context, page }, ti) => {
    const w = await setup(context, page, { mobile: mob(ti.project.name), prefs: { music: "youtube", defaultMode: o.mode }, segmentMs: 300, ttsMs: 200 });
    const y = await setupYt(page, { pool: lib(), moodFail: true, songSec: 4, search: (q) => [hv(`Rec ${q.length} A`, { channel: "Sony Music" }), hv(`Rec ${q.length} B`, { channel: "T-Series" })] });
    await page.goto("/live"); await goLive(page, w);
    await expect.poll(() => y.loads.length, { timeout: 20000 }).toBeGreaterThan(2);
    expect(y.loads[0].t - w.clickAt).toBeLessThan(8000);
    expect(y.loads.map((l) => y.videos.get(l.id)!).filter((v) => v.lang !== "hindi" || v.romantic === false)).toEqual([]);
  });

  test(`${o.name}: YouTube with no library and everything failing still has a search fallback, and skips unplayable videos`, async ({ context, page }, ti) => {
    const w = await setup(context, page, { mobile: mob(ti.project.name), prefs: { music: "youtube", defaultMode: o.mode }, segmentMs: 300, ttsMs: 200 });
    const y = await setupYt(page, { pool: [], moodFail: true, songSec: 4, search: () => [hv("Blocked", { id: "bad77" }), hv("Playable One"), hv("Playable Two"), hv("Playable Three")] });
    await page.goto("/live"); await goLive(page, w);
    await expect.poll(() => y.loads.filter((l) => !l.id.startsWith("bad")).length, { timeout: 25000 }).toBeGreaterThan(1);
    expect(y.searches.length).toBeLessThanOrEqual(4);
  });

  test(`${o.name}: Spotify plays HIS Hindi romantic songs first, searches stay minimal, falls back when classification is down`, async ({ context, page }, ti) => {
    for (const down of [false, true]) {
      const w = await setup(context, page, { mobile: mob(ti.project.name), prefs: { defaultMode: o.mode, songLangs: ["english"] }, segmentMs: 300, ttsMs: 200, songMs: 6000, faults: { mood500: down } });
      await page.goto("/live"); await goLive(page, w);
      await expect.poll(() => w.plays.length, { timeout: 12000 }).toBeGreaterThan(0);
      expect(w.firstPlayMs(), "first song (ms)").toBeLessThan(7000);
      await expect.poll(() => w.plays.length, { timeout: 40000 }).toBeGreaterThan(2);
      const t = w.playedTracks();
      expect(t.filter((x) => x.lang !== "hindi").map((x) => x.name), "non-Hindi").toEqual([]);
      if (!down) { expect(w.moodCalls.length).toBeGreaterThan(0); expect(t[0].name, "starts with his own (script-named favourites)").toMatch(/गाना/); }
      expect(w.searches.length, "Spotify searches").toBeLessThanOrEqual(down ? 6 : 3);
      await page.getByRole("button", { name: "Stop, go off air" }).click().catch(() => {});
      await page.goto("about:blank");
    }
  });
}

// ---------------- reliability for the drive ----------------
for (const o of OPTS) {
  test(`${o.name}: Spotify quota used up → switches to YouTube (his songs), keeps the right voice`, async ({ context, page }, ti) => {
    const w = await setup(context, page, { mobile: mob(ti.project.name), prefs: { defaultMode: o.mode }, segmentMs: 300, ttsMs: 200 });
    await page.route("https://api.spotify.com/**", (r) => r.fulfill({ status: 429, json: { error: { status: 429, message: "Quota", reason: "QUOTA_EXCEEDED" } } }));
    const y = await setupYt(page, { pool: lib(), songSec: 6 });
    const tts: any[] = []; await page.route("**/api/tts", (r) => { tts.push(r.request().postDataJSON()); r.fallback(); });
    await page.goto("/live"); await goLive(page, w);
    await expect(page.getByText(/playing from YouTube instead/)).toBeVisible({ timeout: 15000 });
    await expect.poll(() => y.loads.length, { timeout: 15000 }).toBeGreaterThan(0);
    await expect.poll(() => tts.length, { timeout: 20000 }).toBeGreaterThan(0);
    for (const t of tts) expect(t.voiceId).toBe(o.voice);
    expect(y.loads.map((l) => y.videos.get(l.id)!).filter((v) => v.lang !== "hindi")).toEqual([]);
  });

  test(`${o.name}: YouTube drive soak: TTS down → fallback voice then browser speech; no dead air; wake lock held`, async ({ context, page }, ti) => {
    await context.addInitScript(() => { (window as any).__wl = { req: 0, rel: 0 }; Object.defineProperty(navigator, "wakeLock", { configurable: true, value: { request: async () => { (window as any).__wl.req++; return { release: async () => { (window as any).__wl.rel++; } }; } } }); });
    const w = await setup(context, page, { mobile: mob(ti.project.name), prefs: { music: "youtube", defaultMode: o.mode }, segmentMs: 300, ttsMs: 200, faults: { tts502: true } });
    const y = await setupYt(page, { pool: lib(), songSec: 5 });
    await page.goto("/live"); await goLive(page, w);
    await expect.poll(() => y.loads.length, { timeout: 50000 }).toBeGreaterThan(3);
    expect(await page.evaluate(() => (window as any).__wl.req), "wake lock requested").toBeGreaterThan(0);
    // screen was locked and unlocked: wake lock is re-requested when visible again
    const r0 = await page.evaluate(() => (window as any).__wl.req);
    await page.evaluate(() => document.dispatchEvent(new Event("visibilitychange")));
    expect(await page.evaluate(() => (window as any).__wl.req)).toBeGreaterThan(r0);
    // TTS failing (server-side chain Dhruv/Priya -> classic voice -> ElevenLabs already failed): the browser voice speaks the line instead
    await expect.poll(() => page.evaluate(() => (window as any).__speech.length), { timeout: 40000 }).toBeGreaterThan(0);
    const speech = await page.evaluate(() => (window as any).__speech as string[]);
    expect(w.tts.length, "TTS attempted").toBeGreaterThan(0);
    // dead air: after a song ends, sound (next song or RJ) must follow within 3s
    const ev: [number, number, string][] = await page.evaluate(() => (window as any).__yt.ev);
    const audio: { at: number }[] = await page.evaluate(() => (window as any).__audio);
    const sounds = [...ev.filter((e) => e[1] === 1).map((e) => e[0]), ...audio.map((a) => a.at), ...(await page.evaluate(() => 0) ? [] : [])];
    const gaps = ev.filter((e) => e[1] === 0).map((e) => { const nx = sounds.filter((t) => t >= e[0] - 3000).sort((a, b) => a - b)[0]; return nx === undefined ? 99999 : nx - e[0]; }).filter((g) => g < 90000);
    console.log("dead-air gaps (ms):", gaps, "speech lines:", speech.length);
    expect(Math.max(0, ...gaps)).toBeLessThan(3500);
  });
}

test("Romantic Hindi: /api/songmood responds sanely without a usable key (no crash, empty labels)", async ({ request }) => {
  const r = await request.post("http://localhost:3124/api/songmood", { data: { items: [{ id: "a", title: "Tum Hi Ho", artist: "Arijit Singh" }] } });
  expect([200, 502, 501]).toContain(r.status());
  expect((await r.json()).labels).toBeDefined();
  expect((await request.post("http://localhost:3124/api/songmood", { data: {} })).status()).toBeLessThan(600);
});

test("Romantic Hindi YouTube: network drop mid-drive recovers and keeps going", async ({ context, page }, ti) => {
  const w = await setup(context, page, { mobile: mob(ti.project.name), prefs: { music: "youtube", defaultMode: "romantic_f" }, segmentMs: 300, ttsMs: 200 });
  const y = await setupYt(page, { pool: lib(), songSec: 6 });
  await page.goto("/live"); await goLive(page, w);
  await expect.poll(() => y.loads.length, { timeout: 20000 }).toBeGreaterThan(1);
  await context.setOffline(true); await page.waitForTimeout(8000); await context.setOffline(false);
  const n = y.loads.length;
  await expect.poll(() => y.loads.length, { timeout: 60000 }).toBeGreaterThan(n + 1);
  expect(y.loads.map((l) => y.videos.get(l.id)!).filter((v) => v.lang !== "hindi" || v.romantic === false)).toEqual([]);
});

// ---- the reported drive bug: YouTube pauses itself right after starting (autoplay blocked) ----
for (const o of OPTS) {
  test(`${o.name}: YouTube that pauses itself 0.7s after every start keeps playing (auto-resume, UI never flips to paused)`, async ({ context, page }, ti) => {
    await context.addInitScript(() => { (window as any).__ytPauseAfterPlay = true; });
    const w = await setup(context, page, { mobile: mob(ti.project.name), prefs: { music: "youtube", defaultMode: o.mode }, segmentMs: 300, ttsMs: 200 });
    const y = await setupYt(page, { pool: lib(), songSec: 12 });
    await page.goto("/live"); await goLive(page, w);
    await expect.poll(() => y.loads.length, { timeout: 20000 }).toBeGreaterThan(0);
    await page.waitForTimeout(4000);
    expect(await page.evaluate(() => (window as any).__yt.players[0].state), "playing, not paused").toBe(1);
    await expect(page.getByRole("button", { name: "Pause", exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: "Play", exact: true })).toHaveCount(0);
    await expect.poll(() => y.loads.length, { timeout: 60000 }).toBeGreaterThan(1);
    await expect.poll(() => page.evaluate(() => (window as any).__yt.players[0].state), { timeout: 10000 }).toBe(1);
  });

  test(`${o.name}: pause/play responds at once (big button, mascot tap, lock-screen), also during an RJ break`, async ({ context, page }, ti) => {
    const w = await setup(context, page, { mobile: mob(ti.project.name), prefs: { music: "youtube", defaultMode: o.mode }, segmentMs: 200, ttsMs: 200 });
    const y = await setupYt(page, { pool: lib(), songSec: 30 });
    await page.goto("/live"); await goLive(page, w);
    await expect.poll(() => y.loads.length, { timeout: 20000 }).toBeGreaterThan(0);
    await expect(page.getByRole("button", { name: "Pause", exact: true })).toBeEnabled({ timeout: 10000 });
    await page.waitForTimeout(1500);
    const btn = page.getByTestId("playpause"); const bb = await btn.boundingBox();
    expect(bb!.width).toBeGreaterThanOrEqual(64); expect(bb!.height).toBeGreaterThanOrEqual(64);
    const st = () => page.evaluate(() => (window as any).__yt.players[0].state);
    await btn.click(); await expect.poll(st, { timeout: 700 }).toBe(2); // within 700ms (no debounce)
    await btn.click(); await expect.poll(st, { timeout: 700 }).toBe(1);
    await page.evaluate(() => (window as any).__ms.pause()); await expect.poll(st, { timeout: 700 }).toBe(2);
    await page.evaluate(() => (window as any).__ms.play()); await expect.poll(st, { timeout: 700 }).toBe(1);
    expect(await page.evaluate(() => typeof (window as any).__ms.nexttrack)).toBe("function");
  });
}

test("Spotify Connect never picks a speaker: only an Alexa device → YouTube with a clear message", async ({ context, page }, ti) => {
  test.skip(ti.project.name !== "mobile");
  const w = await setup(context, page, { mobile: true, prefs: { defaultMode: "romantic_f" }, segmentMs: 300, ttsMs: 200 });
  await page.route("https://api.spotify.com/v1/me/player/devices", (r) => r.fulfill({ json: { devices: [{ id: "echo1", name: "Echo Dot", type: "CastAudio", is_active: true, is_restricted: false }] } }));
  const y = await setupYt(page, { pool: lib(), songSec: 8 });
  await page.goto("/live"); await goLive(page, w);
  await expect(page.getByText(/No Spotify device on your phone, playing from YouTube instead/)).toBeVisible({ timeout: 40000 });
  await expect.poll(() => y.loads.length, { timeout: 20000 }).toBeGreaterThan(0);
  expect(w.plays, "nothing was sent to the Echo").toEqual([]);
});
