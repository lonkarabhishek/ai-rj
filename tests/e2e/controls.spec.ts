import { test, expect, type Page } from "@playwright/test";
import { setup, goLive, realErrors, type World } from "./fake";

const mob = (n: string) => n === "mobile";
const pauseBtn = (p: Page) => p.getByRole("button", { name: /^(Pause|Play)$/ });
async function live(page: Page, w: World) {
  await page.goto("/live"); await goLive(page, w);
  await expect.poll(() => w.plays.length, { timeout: 10000 }).toBeGreaterThan(0);
  await expect(pauseBtn(page)).toBeEnabled();
}

test("rapid play/pause taps settle on the last state with no racing calls", async ({ context, page }, ti) => {
  const w = await setup(context, page, { mobile: mob(ti.project.name), songMs: 60000 });
  await live(page, w);
  const before = w.spotifyCalls.length;
  for (let i = 0; i < 7; i++) await pauseBtn(page).click({ delay: 10 }); // odd count: ends paused
  await expect(page.getByRole("button", { name: "Play", exact: true })).toBeVisible(); // flips instantly
  await expect.poll(() => w.player.isPlaying, { timeout: 5000 }).toBe(false);
  const ctl = w.spotifyCalls.slice(before).filter((c) => /player\/(pause|play)$/.test(c.split("?")[0]));
  expect(ctl.length, "debounced control calls").toBeLessThanOrEqual(2);
  await pauseBtn(page).click();
  await expect.poll(() => w.player.isPlaying, { timeout: 5000 }).toBe(true);
  await expect(page.getByRole("button", { name: "Pause", exact: true })).toBeVisible();
  expect(realErrors(w)).toEqual([]);
});

test("pause mid-RJ stops the voice; resume continues it", async ({ context, page }, ti) => {
  const w = await setup(context, page, { mobile: mob(ti.project.name), segmentMs: 300, ttsMs: 300 });
  await page.goto("/live"); await goLive(page, w);
  await expect(page.getByText("Riya", { exact: true }).first()).toBeVisible({ timeout: 15000 }); // RJ on air pill
  await pauseBtn(page).click();
  await page.waitForTimeout(700);
  const st = await page.evaluate(() => [...document.querySelectorAll("audio")].map((a) => a.paused));
  expect(st.every(Boolean), "all audio paused").toBe(true);
  const ctxState = await page.evaluate(() => (window as any).__lastCtx?.state ?? "n/a");
  expect(["suspended", "n/a"]).toContain(ctxState);
  await pauseBtn(page).click();
  await expect.poll(() => w.plays.length, { timeout: 25000 }).toBeGreaterThan(1); // the show goes on
});

test("external pause (Spotify app / headphones) syncs the UI", async ({ context, page }, ti) => {
  test.skip(ti.project.name !== "mobile", "Connect path polls /me/player; SDK path tested via state too");
  const w = await setup(context, page, { mobile: true, songMs: 120000 });
  await live(page, w);
  await page.waitForTimeout(3000);
  w.player.pausedAt = Date.now(); w.player.isPlaying = false; // paused from the Spotify app
  await expect(page.getByRole("button", { name: "Play", exact: true })).toBeVisible({ timeout: 16000 });
  w.player.startedAt += Date.now() - w.player.pausedAt; w.player.isPlaying = true; // resumed from lock screen
  await expect(page.getByRole("button", { name: "Pause", exact: true })).toBeVisible({ timeout: 16000 });
});

test("MediaSession lock-screen handlers pause, play and skip", async ({ context, page }, ti) => {
  const w = await setup(context, page, { mobile: mob(ti.project.name), songMs: 60000 });
  await live(page, w);
  const has = await page.evaluate(() => Object.keys((window as any).__ms));
  expect(has).toEqual(expect.arrayContaining(["play", "pause", "nexttrack", "stop"]));
  await page.evaluate(() => (window as any).__ms.pause());
  await expect(page.getByRole("button", { name: "Play", exact: true })).toBeVisible();
  await expect.poll(() => w.player.isPlaying, { timeout: 5000 }).toBe(false);
  await page.evaluate(() => (window as any).__ms.play());
  await expect.poll(() => w.player.isPlaying, { timeout: 5000 }).toBe(true);
  const n = w.plays.length;
  await page.evaluate(() => (window as any).__ms.nexttrack());
  await expect.poll(() => w.plays.length, { timeout: 25000 }).toBeGreaterThan(n);
});

test("next and stop", async ({ context, page }, ti) => {
  const w = await setup(context, page, { mobile: mob(ti.project.name), songMs: 60000 });
  await live(page, w);
  const n = w.plays.length;
  await page.getByRole("button", { name: "Next" }).click();
  await expect.poll(() => w.plays.length, { timeout: 25000 }).toBeGreaterThan(n);
  await page.getByRole("button", { name: "Stop, go off air" }).click();
  await expect(page.getByRole("button", { name: "Go Live" })).toBeVisible();
  await expect(page.getByText(/Off air/)).toBeVisible();
  await expect.poll(() => w.player.isPlaying, { timeout: 5000 }).toBe(false);
  expect(realErrors(w)).toEqual([]);
});
