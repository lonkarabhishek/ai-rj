import { test, expect } from "@playwright/test";
import { setup, goLive, realErrors, diag } from "./fake";
import { setupYt, vid } from "./fakeYt";

const mob = (n: string) => n === "mobile";
const POOL = () => [
  vid("english", "Shape of You", { channel: "Ed Sheeran", audioLang: "en" }),
  vid("english", "Blinding Lights", { channel: "The Weeknd - Topic", audioLang: "en-US" }),
  vid("hindi", "Kesariya | Brahmastra | Arijit Singh", { channel: "Sony Music India" }),
  vid("hindi", "तुम ही हो", { channel: "T-Series" }),
  vid("hindi", "Apna Bana Le", { channel: "Zee Music Company" }),
  vid("tamil", "Vaathi Coming", { channel: "Sony Music South", audioLang: "ta" }),
  vid("punjabi", "Lover - Diljit Dosanjh", { channel: "Diljit Dosanjh" }),
  vid("unknown", "Late Night Drive", { channel: "Random Uploader" }), // no language signal: must be dropped when a language is chosen
  vid("unknown", "Untitled Track 3", { channel: "Someone" }),
  vid("hindi", "Long Bollywood Mashup 2026", { channel: "DJ", seconds: 1800 }), // too long
];
const prefsYt = (extra = {}) => ({ music: "youtube", songLangs: ["hindi", "english"], ...extra });

test("YouTube: Hindi+English plays only those, fast, in a visible ≥200px player, with RJ breaks", async ({ context, page }, ti) => {
  const w = await setup(context, page, { mobile: mob(ti.project.name), prefs: prefsYt(), segmentMs: 600, ttsMs: 400 });
  const y = await setupYt(page, { pool: POOL(), songSec: 8 });
  await page.goto("/live");
  await expect(page.getByRole("radio", { name: "YouTube" })).toHaveAttribute("aria-checked", "true");
  await expect(page.getByText(/Ad-free if signed in to YouTube Premium in this browser/)).toBeVisible();
  w.clickAt = Date.now(); await page.getByRole("button", { name: "Go Live", exact: true }).click();
  await expect.poll(() => y.loads.length, { timeout: 8000 }).toBeGreaterThan(0);
  expect(y.loads[0].t - w.clickAt, "first video (ms)").toBeLessThan(5000);
  const box = await page.locator("#fake-yt").boundingBox();
  expect(box!.width).toBeGreaterThanOrEqual(200); expect(box!.height).toBeGreaterThanOrEqual(200);
  await page.screenshot({ path: ti.outputPath("yt-playing.png") });
  await expect.poll(() => y.loads.length, { timeout: 40000 }).toBeGreaterThan(2);
  const langs = y.loads.map((l) => y.videos.get(l.id)!.lang);
  expect(langs.filter((l) => l !== "hindi" && l !== "english"), "wrong/uncertain language videos").toEqual([]);
  expect(y.loads.map((l) => y.videos.get(l.id)!.seconds).every((s) => s <= 600)).toBe(true);
  expect(w.tts.length, "RJ spoke").toBeGreaterThan(0);
  for (const t of w.tts) expect(t.length).toBeGreaterThan(30);
  expect(w.spotifyCalls, "no Spotify calls on the YouTube source").toEqual([]);
  expect(realErrors(w)).toEqual([]);
});

test("YouTube: English only means English only", async ({ context, page }, ti) => {
  const w = await setup(context, page, { mobile: mob(ti.project.name), prefs: prefsYt({ songLangs: ["english"] }), segmentMs: 400 });
  const y = await setupYt(page, { pool: POOL(), songSec: 5, search: (q) => [vid("english", `Pop Hit ${q.length}`, { channel: "Pop Artist", audioLang: "en" }), vid("hindi", "Tum Hi Ho Lofi", { channel: "T-Series" })] });
  await page.goto("/live"); await goLive(page, w);
  await expect.poll(() => y.loads.length, { timeout: 40000 }).toBeGreaterThan(3);
  expect(y.loads.map((l) => y.videos.get(l.id)!.lang).filter((l) => l !== "english")).toEqual([]);
});

test("YouTube: pause/resume/next/stop and MediaSession drive the player", async ({ context, page }, ti) => {
  const w = await setup(context, page, { mobile: mob(ti.project.name), prefs: prefsYt(), segmentMs: 400 });
  const y = await setupYt(page, { pool: POOL(), songSec: 60 });
  await page.goto("/live"); await goLive(page, w);
  await expect.poll(() => y.loads.length, { timeout: 8000 }).toBeGreaterThan(0);
  await expect(page.getByRole("button", { name: "Pause", exact: true })).toBeEnabled({ timeout: 10000 });
  await page.waitForTimeout(1500);
  for (let i = 0; i < 5; i++) await page.getByRole("button", { name: /^(Pause|Play)$/ }).click();
  await expect(page.getByRole("button", { name: "Play", exact: true })).toBeVisible();
  await expect.poll(() => page.evaluate(() => (window as any).__yt.players[0].state), { timeout: 4000 }).toBe(2);
  await page.evaluate(() => (window as any).__ms.play());
  await expect.poll(() => page.evaluate(() => (window as any).__yt.players[0].state), { timeout: 4000 }).toBe(1);
  // external pause (YouTube's own controls) syncs the UI
  await page.waitForTimeout(2000);
  await page.evaluate(() => (window as any).__yt.players[0].pauseVideo());
  await expect(page.getByRole("button", { name: "Play", exact: true })).toBeVisible({ timeout: 4000 });
  await page.getByRole("button", { name: "Play", exact: true }).click();
  const n = y.loads.length;
  await page.getByRole("button", { name: "Next" }).click();
  await expect.poll(() => y.loads.length, { timeout: 20000 }).toBeGreaterThan(n);
  await page.getByRole("button", { name: "Stop, go off air" }).click();
  await expect(page.getByRole("button", { name: "Go Live" })).toBeVisible();
});

test("YouTube: non-embeddable video (error 150) is skipped and remembered", async ({ context, page }, ti) => {
  const w = await setup(context, page, { mobile: mob(ti.project.name), prefs: prefsYt({ songLangs: ["any"] }), segmentMs: 400 });
  const pool = [vid("english", "Blocked Song", { id: "bad1", audioLang: "en" }), vid("english", "Good Song", { id: "good1", audioLang: "en" })];
  const y = await setupYt(page, { pool, songSec: 30 });
  await page.goto("/live"); await goLive(page, w);
  await expect.poll(() => y.loads.map((l) => l.id), { timeout: 20000 }).toContain("good1");
  const bad = await page.evaluate(() => localStorage.getItem("myrj.yt.bad"));
  if (y.loads.some((l) => l.id === "bad1")) expect(bad).toContain("bad1");
});

test("YouTube: Focus plays instrumentals only", async ({ context, page }, ti) => {
  const w = await setup(context, page, { mobile: mob(ti.project.name), prefs: prefsYt({ songLangs: ["hindi"], defaultMode: "focus" }), segmentMs: 400 });
  const y = await setupYt(page, { pool: POOL(), songSec: 5, search: () => [vid("hindi", "Bollywood Flute Instrumental 1", { channel: "Flute Hub", instrumental: true }), vid("hindi", "Bollywood Piano Instrumental", { channel: "Keys", instrumental: true }), vid("hindi", "Kesariya Lyrics Video", { channel: "T-Series" })] });
  await page.goto("/live"); await goLive(page, w);
  await expect.poll(() => y.loads.length, { timeout: 30000 }).toBeGreaterThan(1);
  expect(y.loads.map((l) => y.videos.get(l.id)!).filter((v) => !v.instrumental).map((v) => v.title)).toEqual([]);
});

test("YouTube: Spotify quota used up → auto-switch to YouTube with a notice", async ({ context, page }, ti) => {
  const w = await setup(context, page, { mobile: mob(ti.project.name), prefs: { songLangs: ["hindi", "english"] } });
  await page.route("https://api.spotify.com/**", (r) => r.fulfill({ status: 429, json: { error: { status: 429, message: "Quota", reason: "QUOTA_EXCEEDED" } } }));
  const y = await setupYt(page, { pool: POOL(), songSec: 30 });
  await page.goto("/live"); await goLive(page, w);
  await expect(page.getByText(/playing from YouTube instead/)).toBeVisible({ timeout: 10000 });
  await expect.poll(() => y.loads.length, { timeout: 12000 }).toBeGreaterThan(0);
  expect((await diag(page)).output).toMatch(/YouTube/);
});

test("YouTube quota: searches capped per session and cached for the next one", async ({ context, page }, ti) => {
  const w = await setup(context, page, { mobile: mob(ti.project.name), prefs: prefsYt({ songLangs: ["english"] }), segmentMs: 300 });
  const y = await setupYt(page, { pool: [], songSec: 3, search: (q) => [vid("english", `Hit A ${q}`, { audioLang: "en" }), vid("english", `Hit B ${q}`, { audioLang: "en" })] });
  await page.goto("/live"); await goLive(page, w);
  await expect.poll(() => y.loads.length, { timeout: 30000 }).toBeGreaterThan(3);
  await page.waitForTimeout(8000);
  expect(y.searches.length, "searches this session").toBeLessThanOrEqual(4);
  expect(y.poolCalls).toBe(1);
  const s1 = y.searches.length;
  await page.reload(); await goLive(page, w);
  await expect.poll(() => y.loads.length, { timeout: 15000 }).toBeGreaterThan(5);
  console.log(`YT searches: session1 ${s1}, session2 ${y.searches.length - s1}; pool calls ${y.poolCalls}`);
});

test("YouTube: his library + imported links come first; recommendations are from his artists, not generic charts", async ({ context, page }, ti) => {
  // Real-world library: no defaultAudioLanguage, plain Latin titles; the server labels languages.
  const lib = [
    vid("english", "Yellow", { channel: "Coldplay - Topic", label: "english" }),
    vid("english", "Fix You", { channel: "Coldplay", label: "english" }),
    vid("hindi", "Tum Se Hi", { channel: "Mohit Chauhan - Topic", label: "hindi" }),
    vid("hindi", "Agar Tum Saath Ho", { channel: "A.R. Rahman - Topic", label: "hindi" }),
    vid("tamil", "Why This Kolaveri Di", { channel: "Dhanush - Topic", label: "tamil" }),
    vid("other", "Despacito", { channel: "Luis Fonsi", label: "other" }),
  ];
  const links = [vid("english", "Viva La Vida", { channel: "Coldplay - Topic", label: "english" }), vid("hindi", "Kun Faya Kun", { channel: "A.R. Rahman - Topic", label: "hindi" })];
  const mine = new Set([...lib, ...links].map((v) => v.id));
  const w = await setup(context, page, { mobile: mob(ti.project.name), prefs: prefsYt({ externalPlaylists: [{ url: "https://music.youtube.com/playlist?list=PLx", name: "Mine" }] }), segmentMs: 300 });
  const y = await setupYt(page, { pool: lib, links, songSec: 3, search: (q) => [vid("english", `${q} A`, { channel: "Coldplay", label: "english" }), vid("hindi", `${q} B`, { channel: "A.R. Rahman", label: "hindi" })] });
  await page.goto("/live"); await goLive(page, w);
  await expect.poll(() => y.loads.length, { timeout: 40000 }).toBeGreaterThan(5);
  const ids = y.loads.map((l) => l.id);
  expect(ids.slice(0, 3).every((id) => mine.has(id)), "first songs are his").toBe(true);
  expect(ids.filter((id) => mine.has(id)).length / ids.length).toBeGreaterThanOrEqual(0.6);
  expect(ids.some((id) => links.some((l) => l.id === id)), "imported links play").toBe(true);
  expect(y.loads.map((l) => y.videos.get(l.id)!.lang).filter((l) => l !== "hindi" && l !== "english")).toEqual([]);
  for (const q of y.searches) expect(q, "taste search, not generic").toMatch(/^(Coldplay|Coldplay - Topic|Mohit Chauhan - Topic|A\.R\. Rahman - Topic|Mohit Chauhan|A\.R\. Rahman) songs$/);
  console.log("searches:", y.searches);
});

test("YouTube on iOS (no setVolume): the RJ line plays to the very end and never overlaps the video", async ({ context, page }, ti) => {
  const w = await setup(context, page, { mobile: mob(ti.project.name), prefs: prefsYt({ songLangs: ["any"] }), segmentMs: 300, ttsMs: 200 });
  const y = await setupYt(page, { pool: POOL(), songSec: 10 });
  await page.addInitScript(() => {
    (window as any).__noDuck = true;
    const W = window as any; W.__voice = { ended: [] as number[][], overlap: 0 };
    const orig = HTMLMediaElement.prototype.play;
    HTMLMediaElement.prototype.play = function (this: HTMLMediaElement) {
      if (!(this as any).__w) { (this as any).__w = true; this.addEventListener("ended", () => W.__voice.ended.push([this.currentTime, this.duration])); }
      return orig.call(this);
    };
    setInterval(() => {
      const p = W.__yt?.players?.[0]; if (!p || p.state !== 1) return;
      for (const a of Array.from(document.querySelectorAll("audio")) as HTMLAudioElement[]) if (!a.paused && !a.ended) { W.__voice.overlap++; (W.__voice.dbg ??= []).push([Date.now(), "el", a.src.slice(-20), a.currentTime, p.t, p.id]); }
      for (const a of (W.__audios ?? [])) if (!a.paused && !a.ended) { W.__voice.overlap++; (W.__voice.dbg ??= []).push([Date.now() % 100000, a.src.slice(-15), a.currentTime, a.duration, p.t, p.id, p.state]); }
    }, 50);
    const A = window.Audio; (window as any).__audios = [];
    (window as any).Audio = function (...args: any[]) { const a = new (A as any)(...args); W.__audios.push(a); return a; } as any;
  });
  await page.goto("/live"); await goLive(page, w);
  await expect.poll(() => y.loads.length, { timeout: 60000 }).toBeGreaterThan(3);
  const v = await page.evaluate(() => (window as any).__voice);
  expect(v.ended.length, "RJ lines finished").toBeGreaterThan(0);
  const real = v.ended.filter(([, d]: number[]) => d > 0);
  expect(real.length, "voice lines that ended").toBeGreaterThan(0);
  for (const [t, d] of real) expect(t, "voice played to its end").toBeGreaterThanOrEqual(d - 0.3);
  expect(v.overlap, "voice samples while the video was playing").toBe(0);
});

test("YouTube on iOS (strict: playVideo/load ignored without a tap): Tap to play appears, works, and keeps playing", async ({ context, page }, ti) => {
  const w = await setup(context, page, { mobile: mob(ti.project.name), prefs: prefsYt({ songLangs: ["any"] }), segmentMs: 300, ttsMs: 200 });
  const y = await setupYt(page, { pool: POOL(), songSec: 60 });
  await page.addInitScript(() => { (window as any).__noDuck = true; (window as any).__ytStrict = true; });
  await page.goto("/live"); await goLive(page, w);
  const tap = page.getByTestId("tap-to-play");
  await expect(tap).toBeVisible({ timeout: 30000 });
  await expect(page.getByRole("button", { name: "Play", exact: true })).toBeVisible(); // UI follows the real player: not "Pause"
  await tap.click();
  await expect.poll(() => page.evaluate(() => (window as any).__yt.players[0].state), { timeout: 5000 }).toBe(1);
  await expect(tap).toBeHidden();
  await expect(page.getByRole("button", { name: "Pause", exact: true })).toBeVisible();
  await page.waitForTimeout(4000);
  expect(await page.evaluate(() => (window as any).__yt.players[0].state), "still playing").toBe(1);
  await expect(tap).toBeHidden();
});
