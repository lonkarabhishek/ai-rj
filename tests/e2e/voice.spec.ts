import { test, expect } from "@playwright/test";
import { setup, goLive, realErrors, diag } from "./fake";

const mob = (n: string) => n === "mobile";

test("voice: the Go Live tap unlocks audio, RJ clip plays audibly, mascot never reroutes/mutes it", async ({ context, page }, ti) => {
  await context.addInitScript(() => {
    (window as any).__mes = 0;
    const AC = (window as any).AudioContext; if (AC) { const o = AC.prototype.createMediaElementSource; AC.prototype.createMediaElementSource = function (...a: any[]) { (window as any).__mes++; return o.apply(this, a); }; }
  });
  const w = await setup(context, page, { mobile: mob(ti.project.name), segmentMs: 400, ttsMs: 400 });
  await page.goto("/live"); await goLive(page, w);
  await expect.poll(() => page.evaluate(() => (window as any).__audio.length), { timeout: 3000 }).toBeGreaterThan(0); // unlock inside the tap
  await expect.poll(() => page.evaluate(() => (window as any).__audio.some((a: any) => a.src.startsWith("blob:"))), { timeout: 15000 }).toBe(true);
  const clip = await page.evaluate(() => (window as any).__audio.find((a: any) => a.src.startsWith("blob:")));
  expect(clip.muted).toBe(false); expect(clip.volume).toBeGreaterThan(0.5);
  expect(await page.evaluate(() => (window as any).__mes), "createMediaElementSource calls").toBe(0);
  const d = await diag(page);
  expect(d["rj voice"]).toMatch(/azure|ok/i);
  expect(d.audio ?? "-").toMatch(/^(ok|-)$/);
  expect(realErrors(w)).toEqual([]);
});

test("voice: Azure failing (TTS 502) falls back to the browser voice and the show continues", async ({ context, page }, ti) => {
  const w = await setup(context, page, { mobile: mob(ti.project.name), faults: { tts502: true }, segmentMs: 400, songMs: 8000 });
  await page.goto("/live"); await goLive(page, w);
  await expect.poll(() => page.evaluate(() => (window as any).__speech.length), { timeout: 20000 }).toBeGreaterThan(1);
  const said = await page.evaluate(() => (window as any).__speech.reduce((a: string, b: string) => (b.length > a.length ? b : a), ""));
  expect(said.length).toBeGreaterThan(30);
  await expect.poll(() => w.plays.length, { timeout: 20000 }).toBeGreaterThan(0);
  const d = await diag(page);
  expect(d["rj voice"]).toMatch(/failed/);
});
