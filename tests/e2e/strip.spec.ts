import { test, expect } from "@playwright/test";
import { setup, goLive } from "./fake";
// Visual strip of the main states (saved under tests/e2e/.strip/<project>-NN-name.png).
test("screenshot strip", async ({ context, page }, ti) => {
  const w = await setup(context, page, { mobile: ti.project.name === "mobile", prefs: { songLangs: ["hindi", "english"] }, segmentMs: 2500, ttsMs: 600, songMs: 30000 });
  const shot = (n: string) => page.screenshot({ path: `tests/e2e/.strip/${ti.project.name}-${n}.png` });
  await page.goto("/live"); await page.waitForTimeout(600); await shot("1-picker");
  await goLive(page, w); await page.waitForTimeout(700); await shot("2-tuning");
  await expect.poll(() => w.plays.length, { timeout: 8000 }).toBeGreaterThan(0); await page.waitForTimeout(800); await shot("3-song");
  await page.getByRole("button", { name: "Next" }).click();
  await expect(page.getByText("Riya", { exact: true }).first()).toBeVisible({ timeout: 20000 }); await page.waitForTimeout(500); await shot("4-rj");
  await page.getByRole("button", { name: "Pause", exact: true }).click(); await page.waitForTimeout(400); await shot("5-paused");
  await page.getByRole("button", { name: "Play", exact: true }).click();
  await page.getByRole("button", { name: "Change" }).click(); await page.waitForTimeout(500); await shot("6-change");
});
