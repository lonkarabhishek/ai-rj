import { test } from "@playwright/test";
import { setup, goLive } from "./fake";
// Before/after screenshots at fixed sizes. Only runs with SHOTS=<label> (e.g. SHOTS=after npx playwright test shots --project=desktop).
const SIZES = [[360, 740], [375, 667], [390, 844], [1280, 800]] as const;
test.skip(!process.env.SHOTS, "set SHOTS=label");
test("size screenshots", async ({ browser }) => {
  test.setTimeout(240_000);
  for (const [w, h] of SIZES) {
    const mobile = w < 800;
    const context = await browser.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: 2, isMobile: mobile, hasTouch: mobile });
    const page = await context.newPage();
    const world = await setup(context, page, { mobile, prefs: { songLangs: ["hindi", "english"] }, segmentMs: 2500, ttsMs: 600, songMs: 30000 });
    const out = (n: string) => `docs/shots/${process.env.SHOTS}/${w}x${h}-${n}.png`;
    await page.goto("/live"); await page.waitForTimeout(700); await page.screenshot({ path: out("1-picker") });
    await goLive(page, world); await page.waitForTimeout(500); await page.screenshot({ path: out("2-loading") });
    for (let i = 0; i < 30 && world.plays.length === 0; i++) await page.waitForTimeout(300);
    await page.waitForTimeout(1200); await page.screenshot({ path: out("3-live") });
    await page.goto("/settings"); await page.waitForTimeout(800); await page.screenshot({ path: out("4-settings") });
    await context.close();
  }
});
