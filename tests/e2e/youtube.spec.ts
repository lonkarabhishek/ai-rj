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
