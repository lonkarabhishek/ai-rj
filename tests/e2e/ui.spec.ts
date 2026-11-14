import { test, expect } from "@playwright/test";
import { setup, goLive, realErrors, noHorizontalOverflow } from "./fake";

const mob = (n: string) => n === "mobile";

test("live screen: frosted dock with every control in thumb reach, visualizer runs with the song and stops when paused", async ({ context, page }, ti) => {
  const w = await setup(context, page, { mobile: mob(ti.project.name), segmentMs: 300, ttsMs: 300, songMs: 30000 });
  await page.goto("/live"); await goLive(page, w);
  const dock = page.getByTestId("dock");
  await expect(dock).toBeVisible({ timeout: 20000 });
  for (const name of ["Request a song or mood", "Library and playlists", "Station and songs", "Host and voice settings", "Stop, go off air"]) await expect(dock.getByRole("button", { name, exact: true })).toBeVisible();
  // touch targets: at least 44x44 CSS px, all inside the viewport, dock clear of the bottom edge
  const vp = page.viewportSize()!;
  for (const b of [...await dock.getByRole("button").all(), page.getByRole("button", { name: "Previous" }), page.getByRole("button", { name: "Next", exact: true }), page.getByTestId("playpause")]) {
    const r = (await b.boundingBox())!;
    expect(Math.min(r.width, r.height), "touch target").toBeGreaterThanOrEqual(44);
    expect(r.x).toBeGreaterThanOrEqual(0); expect(r.x + r.width).toBeLessThanOrEqual(vp.width); expect(r.y + r.height).toBeLessThanOrEqual(vp.height);
  }
  await expect.poll(() => w.plays.length, { timeout: 30000 }).toBeGreaterThan(0);
  const viz = page.getByTestId("visualizer");
  await expect(viz).toHaveClass(/is-on/, { timeout: 15000 });
  const anim = () => viz.locator("span").first().evaluate((el) => { const s = getComputedStyle(el); return `${s.animationName}:${s.animationPlayState}`; });
  if (vp.height > 700) await expect.poll(anim).toBe("viz:running");
  await page.getByTestId("playpause").click();
  await expect(page.getByTestId("playpause")).toHaveAttribute("aria-label", "Play");
  await expect(viz).toHaveClass(/is-paused/);
  if (vp.height > 700) await expect.poll(anim).toBe("viz:paused"); // nothing animates (or burns battery) while paused
  await expect(page.locator(".aurora")).toHaveClass(/is-paused/);
  await page.getByTestId("playpause").click();
  await expect(page.getByTestId("playpause")).toHaveAttribute("aria-label", "Pause");
  await noHorizontalOverflow(page);
  // the dock opens the two sheets (playback keeps going underneath)
  const playsBefore = w.plays.length;
  await dock.getByRole("button", { name: "Station and songs" }).click();
  await expect(page.getByRole("dialog", { name: "Station and songs" })).toBeVisible();
  await page.getByRole("button", { name: "Done", exact: true }).click();
  await dock.getByRole("button", { name: "Host and voice settings" }).click();
  await expect(page.getByRole("dialog", { name: "Your RJ" })).toBeVisible();
  await page.getByRole("dialog", { name: "Your RJ" }).getByRole("button", { name: "Done" }).click();
  await expect(page.getByTestId("playpause")).toHaveAttribute("aria-label", "Pause");
  expect(w.plays.length).toBeGreaterThanOrEqual(playsBefore);
  expect(realErrors(w)).toEqual([]);
});

test("reduced motion: decorative animation is off, the radio still works", async ({ context, page }, ti) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  const w = await setup(context, page, { mobile: mob(ti.project.name), segmentMs: 300, ttsMs: 300 });
  await page.goto("/live"); await goLive(page, w);
  await expect.poll(() => w.plays.length, { timeout: 30000 }).toBeGreaterThan(0);
  const names = await page.evaluate(() => [".aurora i", ".viz span", ".play-btn"].map((s) => { const el = document.querySelector(s); return el ? getComputedStyle(el, s === ".play-btn" ? "::before" : null).animationName : "missing"; }));
  expect(names).toEqual(["none", "none", "none"]);
  expect(realErrors(w)).toEqual([]);
});

for (const [wd, ht] of [[320, 568], [360, 740], [430, 932]] as const) {
  test(`narrow phones ${wd}x${ht}: idle and live screens fit with no sideways scroll, controls on screen`, async ({ context, page }, ti) => {
    test.skip(!mob(ti.project.name), "phone sizes");
    await page.setViewportSize({ width: wd, height: ht });
    const w = await setup(context, page, { mobile: true, segmentMs: 300, ttsMs: 300, songMs: 30000 });
    await page.goto("/live");
    await page.waitForTimeout(500);
    await noHorizontalOverflow(page);
    const go = (await page.getByRole("button", { name: "Go Live", exact: true }).boundingBox())!;
    expect(go.y + go.height).toBeLessThanOrEqual(ht);
    await goLive(page, w);
    await expect.poll(() => w.plays.length, { timeout: 30000 }).toBeGreaterThan(0);
    await noHorizontalOverflow(page);
    const pp = (await page.getByTestId("playpause").boundingBox())!;
    expect(pp.y + pp.height, "play button on screen without scrolling").toBeLessThanOrEqual(ht);
    expect(pp.x + pp.width).toBeLessThanOrEqual(wd);
    await page.screenshot({ path: ti.outputPath(`live-${wd}x${ht}.png`) });
    expect(realErrors(w)).toEqual([]);
  });
}

test("device voice chosen: no voice requests leave the phone, breaks are spoken one at a time in the RJ's language", async ({ context, page }, ti) => {
  await context.addInitScript(() => {
    (window as any).__utt = [];
    const S = window.SpeechSynthesisUtterance;
    if (S) (window as any).SpeechSynthesisUtterance = class extends S { constructor(t?: string) { super(t); (window as any).__utt.push(this); } };
  });
  const w = await setup(context, page, { mobile: mob(ti.project.name), prefs: { voiceId: "browser", language: "spanish" }, segmentMs: 300, songMs: 6000 });
  await page.goto("/live"); await goLive(page, w);
  await expect.poll(() => page.evaluate(() => (window as any).__speech.filter((t: string) => t.trim().length > 3).length), { timeout: 30000 }).toBeGreaterThan(1);
  expect(w.tts, "the server voice must not be called when the device voice is selected").toEqual([]);
  expect(w.segments[0].prefs.language).toBe("spanish");
  const langs = await page.evaluate(() => (window as any).__utt.filter((u: SpeechSynthesisUtterance) => u.text.trim().length > 3).map((u: SpeechSynthesisUtterance) => u.lang));
  expect(new Set(langs)).toEqual(new Set(["es-MX"]));
  await expect.poll(() => w.plays.length, { timeout: 30000 }).toBeGreaterThan(0); // music still starts after the spoken opener
  expect(realErrors(w)).toEqual([]);
});

test("voice quota used up mid-show: one notice, device voice fills in, no repeated requests every break", async ({ context, page }, ti) => {
  const w = await setup(context, page, { mobile: mob(ti.project.name), segmentMs: 300, songMs: 5000 });
  let hits = 0;
  await page.route("**/api/tts", (r) => { hits++; return r.fulfill({ status: 502, json: { error: "The free voice allowance is used up for now", code: "quota_exceeded", failures: ["gemini:quota_exceeded"] } }); });
  await page.goto("/live"); await goLive(page, w);
  await expect.poll(() => page.evaluate(() => (window as any).__speech.filter((t: string) => t.trim().length > 3).length), { timeout: 40000 }).toBeGreaterThan(2);
  await expect.poll(() => w.segments.length, { timeout: 40000 }).toBeGreaterThan(2);
  expect(hits, "after the quota answer the app rests the neural voice instead of asking again each break").toBeLessThanOrEqual(2);
  await expect.poll(() => w.plays.length, { timeout: 30000 }).toBeGreaterThan(0);
});

test("installable: manifest linked, iOS home-screen tags present, settings picker offers Automatic and the device voice", async ({ context, page }, ti) => {
  const w = await setup(context, page, { mobile: mob(ti.project.name) });
  await page.goto("/settings");
  await expect(page.locator('link[rel="manifest"]')).toHaveAttribute("href", /manifest\.webmanifest/);
  await expect(page.locator('link[rel="apple-touch-icon"]')).toHaveAttribute("href", /apple-touch-icon/);
  expect(await page.locator('meta[name="apple-mobile-web-app-capable"], meta[name="mobile-web-app-capable"]').count()).toBeGreaterThan(0);
  expect(await page.locator('meta[name="viewport"]').getAttribute("content")).toContain("viewport-fit=cover");
  await expect(page.locator('[data-voice="auto"]')).toBeVisible({ timeout: 15000 });
  await expect(page.locator('[data-voice="browser"]')).toBeVisible();
  await page.locator('[data-voice="browser"]').click();
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem("myrj.prefs.v1")!).voiceId)).toBe("browser");
  await expect(page.getByRole("button", { name: "Español" })).toBeVisible();
  await noHorizontalOverflow(page);
  expect(realErrors(w)).toEqual([]);
});
