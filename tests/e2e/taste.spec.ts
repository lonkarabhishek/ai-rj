import { test, expect } from "@playwright/test";
import { setup, realErrors } from "./fake";
import { setupYt, vid, type FV } from "./fakeYt";
import { POOL, S, loadsOf, lastLoad, mob, startYt } from "./playerKit";

test("charts: Trending plays right away, in chart order", async ({ context, page }, ti) => {
  const w = await setup(context, page, { mobile: mob(ti.project.name), prefs: { music: "youtube", songLangs: ["any"], justMusic: true }, segmentMs: 150, ttsMs: 150 });
  const chart: FV[] = [vid("english", "Hit One - Star A", { id: "c1", channel: "Star A", seconds: S }), vid("english", "Hit Two - Star B", { id: "c2", channel: "Star B", seconds: S }), vid("english", "Hit Three - Star C", { id: "c3", channel: "Star C", seconds: S })];
  const y = await setupYt(page, { pool: POOL(), songSec: S, charts: (k) => (k === "trending:US" ? chart : []) });
  await startYt(page, w, y);
  await page.getByRole("button", { name: "Request a song or mood" }).click();
  await page.getByRole("button", { name: "Trending USA" }).click();
  await expect(page.getByTestId("request-status")).toContainText("Trending · USA", { timeout: 15000 });
  await expect.poll(() => lastLoad(page), { timeout: 20000 }).toBe("c1");
  await page.getByRole("dialog", { name: "Request" }).getByRole("button", { name: "Skip song" }).click();
  await expect.poll(() => lastLoad(page), { timeout: 20000 }).toBe("c2");
  expect(y.charts).toContain("trending:US");
  expect(realErrors(w)).toEqual([]);
});

test("taste: pick a genre, see artists with pictures, favourite one and play their mix", async ({ context, page }, ti) => {
  const w = await setup(context, page, { mobile: mob(ti.project.name), prefs: { music: "youtube", songLangs: ["any"], justMusic: true }, segmentMs: 150, ttsMs: 150 });
  const supa: FV[] = [vid("other", "Supa G - Song One", { id: "sg1", channel: "Supa G", seconds: S }), vid("other", "Supa G - Song Two", { id: "sg2", channel: "Supa G", seconds: S }), vid("other", "Supa G - Song Three", { id: "sg3", channel: "Supa G", seconds: S })];
  const y = await setupYt(page, { pool: POOL(), songSec: S, search: (q) => (/supa g/i.test(q) ? supa : []) });
  await startYt(page, w, y);
  await page.getByRole("button", { name: "Request a song or mood" }).click();
  await page.getByTestId("taste-prompt").click();
  const taste = page.getByRole("dialog", { name: "Your taste" });
  await taste.getByRole("button", { name: "Punta", exact: true }).click();
  const tile = taste.getByTestId("suggested-artists").getByRole("button", { name: "Supa G", exact: true });
  await expect(tile.locator("img")).toHaveAttribute("src", /covers\.test\/artist-Supa/);
  await tile.click();
  await taste.getByRole("button", { name: "♡ Add to favourites" }).click();
  await expect(taste.getByRole("button", { name: "♥ Favourite" })).toBeVisible();
  const saved = await page.evaluate(() => JSON.parse(localStorage.getItem("myrj.prefs.v1")!));
  expect(saved.favGenres).toEqual(["punta"]);
  expect(saved.favArtists.map((a: { name: string }) => a.name)).toEqual(["Supa G"]);
  await taste.getByRole("button", { name: "Play Supa G mix" }).click();
  await expect(page.getByTestId("request-status")).toContainText("Supa G mix", { timeout: 15000 });
  await expect.poll(async () => y.videos.get((await lastLoad(page))!)?.channel, { timeout: 20000 }).toBe("Supa G");
  expect((await loadsOf(page)).length).toBeGreaterThan(1);
  expect(realErrors(w)).toEqual([]);
});
