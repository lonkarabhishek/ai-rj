import { test, expect } from "@playwright/test";
import { setup, goLive, realErrors, diag } from "./fake";

const mob = (n: string) => n === "mobile";
const cases: [string, any, number][] = [
  ["Spotify 401 → token refresh", { token401Once: true }, 8000],
  ["404 device on first play → re-acquire + retry", { play404Once: true }, 10000],
  ["502 on first play → retry", { play502Once: true }, 10000],
  ["429 Retry-After → backoff, then plays", { rate429: 2 }, 12000],
];
for (const [name, faults, within] of cases) {
  test(`errors: ${name}`, async ({ context, page }, ti) => {
    const w = await setup(context, page, { mobile: mob(ti.project.name), faults });
    await page.goto("/live"); await goLive(page, w);
    await expect.poll(() => w.plays.length, { timeout: within }).toBeGreaterThan(0);
    await expect(page.getByRole("button", { name: /^(Pause|Play)$/ })).toBeEnabled();
    if (faults.token401Once) expect((w as any).tokenForced()).toBe(true);
    expect(realErrors(w)).toEqual([]);
  });
}

test("errors: 429 shows the friendly breather notice and makes no calls during the window", async ({ context, page }, ti) => {
  const w = await setup(context, page, { mobile: mob(ti.project.name), songMs: 60000 });
  await page.goto("/live"); await goLive(page, w);
  await expect.poll(() => w.plays.length, { timeout: 10000 }).toBeGreaterThan(0);
  // Rate limit everything for a while
  await page.route("https://api.spotify.com/**", (r) => r.fulfill({ status: 429, headers: { "Retry-After": "8" }, json: { error: { status: 429 } } }));
  let hits = 0; page.on("request", (r) => { if (r.url().startsWith("https://api.spotify.com")) hits++; });
  await page.getByRole("button", { name: "Next" }).click();
  await expect(page.getByText(/Spotify needs a breather, resuming in \d+s/)).toBeVisible({ timeout: 15000 });
  const h0 = hits; await page.waitForTimeout(4000);
  expect(hits - h0, "Spotify calls during backoff").toBe(0);
  await page.unroute("https://api.spotify.com/**");
});

test("errors: Claude timeout → music still starts, no bare-title line", async ({ context, page }, ti) => {
  const w = await setup(context, page, { mobile: mob(ti.project.name), faults: { claudeHang: true } });
  await page.goto("/live"); await goLive(page, w);
  await expect.poll(() => w.plays.length, { timeout: 6000 }).toBeGreaterThan(0);
  expect(w.firstPlayMs()).toBeLessThan(5000);
  await page.waitForTimeout(3000);
  for (const t of w.tts) expect(t.length).toBeGreaterThan(30);
  await expect(page.getByRole("button", { name: /^(Pause|Play)$/ })).toBeEnabled();
});

test("errors: offline → friendly notice; online → recovers", async ({ context, page }, ti) => {
  const w = await setup(context, page, { mobile: mob(ti.project.name), songMs: 10000 });
  await page.goto("/live"); await goLive(page, w);
  await expect.poll(() => w.plays.length, { timeout: 10000 }).toBeGreaterThan(0);
  await context.setOffline(true);
  await expect(page.locator(".glass.mb-3")).toBeVisible({ timeout: 5000 });
  const msg = await page.locator(".glass.mb-3").innerText();
  expect(msg).toMatch(/offline|connection|internet/i);
  await page.waitForTimeout(3000);
  await context.setOffline(false);
  const n = w.plays.length;
  await expect.poll(() => w.plays.length, { timeout: 40000 }).toBeGreaterThan(n);
  await expect(page.getByText(/offline/i)).toHaveCount(0);
});

test("errors: no Spotify device → friendly nudge, never stuck", async ({ context, page }, ti) => {
  test.skip(ti.project.name !== "mobile");
  const w = await setup(context, page, { mobile: true, faults: { noDevices: true } });
  await page.goto("/live"); await goLive(page, w);
  await expect(page.getByText(/Open the Spotify app/)).toBeVisible({ timeout: 10000 });
  await expect(page.getByText(/Taking a bit longer/)).toBeVisible({ timeout: 15000 });
  await expect(page.getByRole("button", { name: "Retry" })).toBeVisible();
});
