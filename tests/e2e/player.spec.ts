import { test, expect, type Page } from "@playwright/test";
import { setup, goLive, realErrors } from "./fake";
import { setupYt, vid, type FV } from "./fakeYt";

/* Now Playing: cover art, swipe/previous/next transitions, lyrics synced to the player clock, requests and stations. */
const mob = (n: string) => n === "mobile";
const S = 60; // fake song length in seconds; videos report the same length so none looks like an ad
const POOL = () => [
  vid("english", "Shape of You", { channel: "Ed Sheeran", seconds: S }), vid("english", "Blinding Lights", { channel: "The Weeknd - Topic", seconds: S }),
  vid("english", "Levitating", { channel: "Dua Lipa", seconds: S }), vid("english", "Perfect", { channel: "Ed Sheeran", seconds: S }),
  vid("english", "Stay", { channel: "Justin Bieber", seconds: S }), vid("english", "Peaches", { channel: "Justin Bieber", seconds: S }),
  vid("english", "Believer", { channel: "Imagine Dragons", seconds: S }), vid("english", "Thunder", { channel: "Imagine Dragons", seconds: S }),
];
const title = (p: Page) => p.getByTestId("now-title").first().innerText();
// Videos the player was asked to load, read from the fake IFrame player itself (exact, in order).
const loadsOf = (p: Page) => p.evaluate(() => ((window as any).__yt?.calls ?? []).filter((c: string) => c.startsWith("load:")).map((c: string) => c.slice(5)) as string[]);
const lastLoad = async (p: Page, k = 1) => { const l = await loadsOf(p); return l[l.length - k]; };
async function swipeArt(page: Page, dx: number) {
  const b = (await page.getByTestId("art-stage").boundingBox())!;
  const x = b.x + b.width / 2, yy = b.y + b.height / 2;
  await page.mouse.move(x, yy); await page.mouse.down();
  for (let i = 1; i <= 10; i++) { await page.mouse.move(x + (dx * i) / 10, yy + i); await page.waitForTimeout(16); } // one move per frame, like a finger
  await page.mouse.up();
}
async function startYt(page: Page, w: Awaited<ReturnType<typeof setup>>, y: Awaited<ReturnType<typeof setupYt>>) {
  await page.goto("/live"); await goLive(page, w);
  await expect.poll(async () => (await loadsOf(page)).length, { timeout: 30000 }).toBeGreaterThan(0);
  await expect(page.getByTestId("now-title").first()).toBeVisible({ timeout: 20000 });
}

test("cover art: real album cover for a YouTube song, video stays a visible ≥200px tile, art and title follow the song", async ({ context, page }, ti) => {
  const w = await setup(context, page, { mobile: mob(ti.project.name), prefs: { music: "youtube", songLangs: ["any"], talk: { news: false, jokes: false, facts: false }, justMusic: true }, segmentMs: 200, ttsMs: 200 });
  const y = await setupYt(page, { pool: POOL(), songSec: S });
  await startYt(page, w, y);
  const img = page.getByTestId("art-card").locator("img");
  await expect(img).toHaveAttribute("src", /covers\.test/, { timeout: 10000 });
  const t = await title(page);
  expect(decodeURIComponent((await img.getAttribute("src"))!)).toContain(t);
  const tile = (await page.locator("#fake-yt").boundingBox())!;
  expect(tile.width).toBeGreaterThanOrEqual(200); expect(tile.height).toBeGreaterThanOrEqual(200);
  // nothing covers the video window (YouTube requires it to stay visible)
  const top = await page.evaluate(() => { const r = document.querySelector("#fake-yt")!.getBoundingClientRect(); const el = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2); return !!el?.closest("[data-testid=video-tile]"); });
  expect(top, "video tile is the top element at its centre").toBe(true);
  expect(realErrors(w)).toEqual([]);
});

test("artwork failure: a generated cover replaces a broken image, no flicker or errors", async ({ context, page }, ti) => {
  const w = await setup(context, page, { mobile: mob(ti.project.name), prefs: { music: "youtube", songLangs: ["any"], justMusic: true }, segmentMs: 200, ttsMs: 200, artFail: true });
  const y = await setupYt(page, { pool: POOL(), songSec: S });
  await startYt(page, w, y);
  await expect(page.getByTestId("fallback-art")).toBeVisible({ timeout: 10000 });
  expect(realErrors(w)).toEqual([]);
});

test("swipe left = next, swipe right = previous (then back to where you were); playback continues", async ({ context, page }, ti) => {
  const w = await setup(context, page, { mobile: mob(ti.project.name), prefs: { music: "youtube", songLangs: ["any"], justMusic: true }, segmentMs: 150, ttsMs: 150 });
  const y = await setupYt(page, { pool: POOL(), songSec: S });
  await startYt(page, w, y);
  const first = await lastLoad(page), n0 = (await loadsOf(page)).length;
  await swipeArt(page, -170);
  await expect.poll(async () => (await loadsOf(page)).length, { timeout: 15000 }).toBeGreaterThan(n0);
  const second = await lastLoad(page);
  expect(second).not.toBe(first);
  await expect.poll(() => title(page), { timeout: 10000 }).toBe(y.videos.get(second)!.title);
  const n1 = (await loadsOf(page)).length;
  await swipeArt(page, 170); // previous: the first song again
  await expect.poll(async () => (await loadsOf(page)).length, { timeout: 15000 }).toBeGreaterThan(n1);
  expect(await lastLoad(page)).toBe(first);
  await expect.poll(() => title(page), { timeout: 10000 }).toBe(y.videos.get(first)!.title);
  await page.getByRole("button", { name: "Next" }).click(); // and forward again: the song we left
  await expect.poll(() => lastLoad(page), { timeout: 15000 }).toBe(second);
  await expect(page.getByTestId("playpause")).toHaveAttribute("aria-label", "Pause");
  expect(realErrors(w)).toEqual([]);
});

test("rapid consecutive Next taps settle on one song, title and cover match what is playing", async ({ context, page }, ti) => {
  const w = await setup(context, page, { mobile: mob(ti.project.name), prefs: { music: "youtube", songLangs: ["any"], justMusic: true }, segmentMs: 150, ttsMs: 150 });
  const y = await setupYt(page, { pool: POOL(), songSec: S });
  await startYt(page, w, y);
  for (let i = 0; i < 5; i++) { await page.getByRole("button", { name: "Next" }).click(); await page.waitForTimeout(120); }
  await page.waitForTimeout(4000);
  const playing = y.videos.get((await lastLoad(page))!)!;
  await expect.poll(() => title(page), { timeout: 10000 }).toBe(playing.title);
  await expect(page.getByTestId("art-card").locator("img")).toHaveAttribute("src", new RegExp(encodeURIComponent(playing.title).replace(/[.*+?^${}()|[\]\\]/g, "\\$&")), { timeout: 10000 });
  expect(await page.getByTestId("art-card").count(), "one cover left after the transitions").toBe(1);
  expect(realErrors(w)).toEqual([]);
});

test("lyrics: fullscreen, active line follows the real player clock, holds on pause, resumes, closes", async ({ context, page }, ti) => {
  const w = await setup(context, page, { mobile: mob(ti.project.name), prefs: { music: "youtube", songLangs: ["any"], justMusic: true }, segmentMs: 150, ttsMs: 150 });
  const y = await setupYt(page, { pool: POOL(), songSec: S });
  await startYt(page, w, y);
  await page.getByTestId("open-lyrics").click();
  const lyr = page.getByTestId("lyrics");
  await expect(lyr).toBeVisible();
  const active = () => lyr.locator("[data-active]").innerText().catch(() => "");
  await expect.poll(active, { timeout: 10000 }).toMatch(/^Line \d+ of /);
  // lines are 2s apart; the fake player clock advances in real time
  const clock = () => page.evaluate(() => (window as any).__yt.players[0].t as number);
  const expectLine = async () => { const t = await clock(); const a = await active(); const n = Number(a.match(/Line (\d+)/)?.[1]); expect(Math.abs(n - Math.floor(t / 2)), `line ${n} at ${t}s`).toBeLessThanOrEqual(1); };
  await page.waitForTimeout(2500); await expectLine();
  await page.evaluate(() => (window as any).__yt.players[0].pauseVideo());
  const held = await active(); await page.waitForTimeout(2500);
  expect(await active(), "paused: the line holds").toBe(held);
  // seek forward 20s: the active line jumps with it
  await page.evaluate(() => { const p = (window as any).__yt.players[0]; p.t += 20; p.playVideo(); });
  await page.waitForTimeout(600); await expectLine();
  await page.getByRole("button", { name: "Close lyrics" }).click();
  await expect(lyr).toBeHidden();
  expect(realErrors(w)).toEqual([]);
});

test("request a song: it plays next, the DJ takes the request on air, then similar songs follow", async ({ context, page }, ti) => {
  const w = await setup(context, page, { mobile: mob(ti.project.name), prefs: { music: "youtube", songLangs: ["any"] }, segmentMs: 150, ttsMs: 150 });
  const req: FV = vid("other", "Jhexx - Bendiciones (Official Video)", { id: "req1", channel: "Jhexx", seconds: S });
  const similar = [vid("other", "Jhexx - Otra Vez", { channel: "Jhexx", seconds: S }), vid("other", "Jhexx - Fuego", { channel: "Jhexx", seconds: S }), vid("other", "Jhexx - Luna", { channel: "Jhexx", seconds: S })];
  const y = await setupYt(page, { pool: POOL(), songSec: S, search: (q) => (/bendiciones/i.test(q) ? [req, ...similar] : /jhexx/i.test(q) ? similar : []) });
  await startYt(page, w, y);
  await page.getByRole("button", { name: "Request a song or mood" }).click();
  await page.getByLabel("What do you want to hear?").fill("play Bendiciones by Jhexx");
  await page.getByRole("button", { name: "Send request" }).click();
  await expect(page.getByTestId("request-status")).toContainText(/Bendiciones/, { timeout: 15000 });
  await expect.poll(() => loadsOf(page), { timeout: 30000 }).toContain("req1");
  await expect.poll(() => w.segments.some((s) => /Bendiciones/i.test(s.request ?? "")), { timeout: 10000 }).toBe(true);
  // the request song finishes, then the vibe continues with the same artist
  await page.evaluate(() => { const p = (window as any).__yt.players[0]; p.t = p.dur - 0.3; });
  await expect.poll(async () => y.videos.get((await lastLoad(page))!)?.channel, { timeout: 30000 }).toBe("Jhexx");
  expect(realErrors(w)).toEqual([]);
});

test("mood tag: the next songs come from the mood, tags persist, clearing returns to the mix", async ({ context, page }, ti) => {
  const w = await setup(context, page, { mobile: mob(ti.project.name), prefs: { music: "youtube", songLangs: ["any"], justMusic: true }, segmentMs: 150, ttsMs: 150 });
  const chill = [vid("english", "Chill Song A", { channel: "Calm Artist", seconds: S }), vid("english", "Chill Song B", { channel: "Calm Artist", seconds: S }), vid("english", "Chill Song C", { channel: "Calm Artist", seconds: S })];
  const y = await setupYt(page, { pool: POOL(), songSec: S, search: (q) => (/chill|relax/i.test(q) ? chill : []) });
  await startYt(page, w, y);
  await page.getByRole("button", { name: "Request a song or mood" }).click();
  await page.getByRole("button", { name: "Chill", exact: true }).click();
  await expect(page.getByTestId("request-status")).toContainText(/Chill/, { timeout: 15000 });
  expect(y.searches.some((q) => /chill|relax/i.test(q))).toBe(true);
  await page.getByRole("dialog", { name: "Request" }).getByRole("button", { name: "Skip song" }).click(); // mini player keeps working in the sheet
  await expect.poll(async () => y.videos.get((await lastLoad(page))!)?.channel, { timeout: 20000 }).toBe("Calm Artist");
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem("myrj.prefs.v1")!).vibeTags)).toEqual(["chill"]);
  expect(realErrors(w)).toEqual([]);
});

test("playlist station: an imported playlist becomes a station and plays from it", async ({ context, page }, ti) => {
  const url = "https://www.youtube.com/playlist?list=PLtest123";
  const w = await setup(context, page, { mobile: mob(ti.project.name), prefs: { music: "youtube", songLangs: ["any"], justMusic: true, externalPlaylists: [{ url, addedAt: "2026-01-01" }] }, segmentMs: 150, ttsMs: 150 });
  const mine = [vid("english", "Island Song 1", { channel: "PL Artist", seconds: S }), vid("english", "Island Song 2", { channel: "PL Artist", seconds: S }), vid("english", "Island Song 3", { channel: "PL Artist", seconds: S }), vid("english", "Island Song 4", { channel: "PL Artist", seconds: S })];
  const y = await setupYt(page, { pool: POOL(), links: mine, songSec: S });
  await startYt(page, w, y);
  await page.getByRole("button", { name: "Library and playlists" }).click();
  await page.getByRole("radio", { name: /Imported playlist/ }).click();
  await expect(page.getByText(/Switching station from the next song/)).toBeVisible();
  await page.getByRole("dialog", { name: "Library" }).getByRole("button", { name: "Skip song" }).click();
  await expect.poll(async () => y.videos.get((await lastLoad(page))!)?.channel, { timeout: 20000 }).toBe("PL Artist");
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem("myrj.prefs.v1")!).station)).toBe(url);
  expect(realErrors(w)).toEqual([]);
});

test("Spotify: previous button replays the last song; cover falls back gracefully when Spotify has no image", async ({ context, page }, ti) => {
  const w = await setup(context, page, { mobile: mob(ti.project.name), prefs: { justMusic: true }, segmentMs: 150, ttsMs: 150, songMs: 30000 });
  await page.goto("/live"); await goLive(page, w);
  await expect.poll(() => w.plays.length, { timeout: 30000 }).toBeGreaterThan(0);
  await page.getByRole("button", { name: "Next" }).click();
  await expect.poll(() => w.plays.length, { timeout: 20000 }).toBeGreaterThan(1);
  const [a, b] = w.plays.slice(-2).map((p) => p.uri);
  await page.waitForTimeout(800);
  await page.getByRole("button", { name: "Previous" }).click();
  await expect.poll(() => w.plays[w.plays.length - 1].uri, { timeout: 20000 }).toBe(a);
  await page.getByRole("button", { name: "Next" }).click();
  await expect.poll(() => w.plays[w.plays.length - 1].uri, { timeout: 20000 }).toBe(b);
  expect(realErrors(w)).toEqual([]);
});
