import { expect, type Page } from "@playwright/test";
import { goLive, type setup } from "./fake";
import { vid, type setupYt } from "./fakeYt";

/* Shared helpers for the Now Playing specs (player, taste). */
export const mob = (n: string) => n === "mobile";
export const S = 60; // fake song length in seconds; videos report the same length so none looks like an ad
export const POOL = () => [
  vid("english", "Shape of You", { channel: "Ed Sheeran", seconds: S }), vid("english", "Blinding Lights", { channel: "The Weeknd - Topic", seconds: S }),
  vid("english", "Levitating", { channel: "Dua Lipa", seconds: S }), vid("english", "Perfect", { channel: "Ed Sheeran", seconds: S }),
  vid("english", "Stay", { channel: "Justin Bieber", seconds: S }), vid("english", "Peaches", { channel: "Justin Bieber", seconds: S }),
  vid("english", "Believer", { channel: "Imagine Dragons", seconds: S }), vid("english", "Thunder", { channel: "Imagine Dragons", seconds: S }),
];
// Videos the player was asked to load, read from the fake IFrame player itself (exact, in order).
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const loadsOf = (p: Page) => p.evaluate(() => ((window as any).__yt?.calls ?? []).filter((c: string) => c.startsWith("load:")).map((c: string) => c.slice(5)) as string[]);
export const lastLoad = async (p: Page, k = 1) => { const l = await loadsOf(p); return l[l.length - k]; };
export async function startYt(page: Page, w: Awaited<ReturnType<typeof setup>>, _y: Awaited<ReturnType<typeof setupYt>>) {
  await page.goto("/live"); await goLive(page, w);
  await expect.poll(async () => (await loadsOf(page)).length, { timeout: 30000 }).toBeGreaterThan(0);
  await expect(page.getByTestId("now-title").first()).toBeVisible({ timeout: 20000 });
}
