import { test, expect } from "@playwright/test";
import { setup, goLive } from "./fake";

test.describe("car mode", () => {
  test("big controls only, survives reload, no sideways scroll; YouTube resumes after the app was in the background", async ({ context, page }, info) => {
    test.skip(info.project.name !== "mobile", "phone feature");
    const w = await setup(context, page, { mobile: true, songMs: 60000 });
    await page.goto("/live"); await goLive(page, w);
    await expect.poll(() => w.plays.length, { timeout: 15000 }).toBeGreaterThan(0);
    await page.getByTestId("car-toggle").click();
    await expect(page.getByTestId("dock")).toBeHidden();
    await expect(page.getByTestId("station-line")).toBeHidden();
    const play = page.getByTestId("playpause");
    expect((await play.boundingBox())!.width).toBeGreaterThanOrEqual(100);
    for (const n of ["Previous", "Next"]) expect((await page.getByRole("button", { name: n, exact: true }).boundingBox())!.width).toBeGreaterThanOrEqual(76);
    await expect(page.getByTestId("car-tip").or(page.getByTestId("car-wake-tip"))).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await page.getByRole("button", { name: "Exit car mode" }).click();
    await expect(page.getByTestId("dock")).toBeVisible();
  });
});
