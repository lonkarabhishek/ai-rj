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

test("errors: huge Retry-After is capped at 60s, probe clears it, 'Try now' works, nothing persists", async ({ context, page }, ti) => {
  const w = await setup(context, page, { mobile: ti.project.name === "mobile", songMs: 60000 });
  await page.goto("/live"); await goLive(page, w);
  await expect.poll(() => w.plays.length, { timeout: 10000 }).toBeGreaterThan(0);
  let limited = true;
  await page.route("https://api.spotify.com/**", (r) => (limited ? r.fulfill({ status: 429, headers: { "Retry-After": "86400" }, json: { error: { status: 429 } } }) : r.fallback()));
  await page.getByRole("button", { name: "Next" }).click();
  const n = page.getByText(/Spotify needs a breather, resuming in (\d+)s/);
  await expect(n).toBeVisible({ timeout: 15000 });
  const secs = Number((await n.innerText()).match(/in (\d+)s/)![1]);
  expect(secs, "wait is capped").toBeLessThanOrEqual(60);
  limited = false; // Spotify is fine again
  await page.getByRole("button", { name: "Try now" }).click();
  await expect(n).toHaveCount(0);
  const p = w.plays.length;
  await expect.poll(() => w.plays.length, { timeout: 25000 }).toBeGreaterThan(p);
  const stored = await page.evaluate(() => JSON.stringify({ ...localStorage, ...sessionStorage }));
  expect(stored).not.toMatch(/backoff|blockedUntil|retry/i);
});

test("errors: reload after a 429 starts clean (backoff not persisted)", async ({ context, page }, ti) => {
  const w = await setup(context, page, { mobile: ti.project.name === "mobile", faults: { rate429: 1 } });
  await page.goto("/live"); await goLive(page, w);
  await expect.poll(() => w.plays.length, { timeout: 12000 }).toBeGreaterThan(0);
  await page.reload(); w.plays = []; await goLive(page, w);
  await expect.poll(() => w.plays.length, { timeout: 8000 }).toBeGreaterThan(0);
  await expect(page.getByText(/breather/)).toHaveCount(0);
});

test("errors: 403 (account not allowlisted in dev mode) says so plainly, never 'breather'", async ({ context, page }, ti) => {
  const w = await setup(context, page, { mobile: ti.project.name === "mobile" });
  await page.route("https://api.spotify.com/v1/me", (r) => r.fulfill({ status: 403, body: "User not registered in the Developer Dashboard" }));
  await page.goto("/live"); await goLive(page, w);
  await expect(page.getByText(/isn't on the app's allowed users.*Spotify Developer Dashboard/)).toBeVisible({ timeout: 10000 });
  await expect(page.getByText(/breather/)).toHaveCount(0);
});

test("errors: /me rate-limited → one request at a time, endpoint shown, no flood, recovers", async ({ context, page }, ti) => {
  const w = await setup(context, page, { mobile: ti.project.name === "mobile" });
  let meHits = 0, limited = 2;
  const other: string[] = [];
  await page.route("https://api.spotify.com/**", (r) => {
    const u = new URL(r.request().url());
    if (u.pathname === "/v1/me") { meHits++; if (limited-- > 0) return r.fulfill({ status: 429, headers: { "Retry-After": "3" }, json: { error: { status: 429 } } }); }
    else if (limited > 0) other.push(u.pathname);
    return r.fallback();
  });
  await page.goto("/live"); await goLive(page, w);
  await expect(page.getByText(/Spotify needs a breather/)).toBeVisible({ timeout: 5000 });
  await expect.poll(() => w.plays.length, { timeout: 20000 }).toBeGreaterThan(0);
  expect(meHits, "/me calls").toBeLessThanOrEqual(4);
  expect(other, "no other Spotify calls while /me is limited").toEqual([]);
  const logs = await page.evaluate(() => document.body.innerText);
  await page.getByRole("button", { name: /Playback details/ }).click();
  await expect(page.locator("pre")).toContainText("GET /me");
});

test("errors: 429 QUOTA_EXCEEDED stops all Spotify calls and says so plainly", async ({ context, page }, ti) => {
  const w = await setup(context, page, { mobile: ti.project.name === "mobile" });
  let hits = 0;
  await page.route("https://api.spotify.com/**", (r) => { hits++; r.fulfill({ status: 429, json: { error: { status: 429, message: "Quota exceeded", reason: "QUOTA_EXCEEDED" } } }); });
  await page.goto("/live"); await goLive(page, w);
  await expect(page.getByText(/daily developer quota is used up, try again later/)).toBeVisible({ timeout: 10000 });
  const h = hits; await page.waitForTimeout(8000);
  expect(hits - h, "Spotify calls after quota hit").toBe(0);
  expect(h, "calls before stopping").toBeLessThanOrEqual(3);
  await expect(page.getByText(/breather/)).toHaveCount(0);
  await page.getByRole("button", { name: /Playback details/ }).click();
  await expect(page.locator("dl")).toContainText("QUOTA_EXCEEDED on GET /me");
});

test("budget: second session reuses cached taste and searches (few Spotify calls)", async ({ context, page }, ti) => {
  const w = await setup(context, page, { mobile: ti.project.name === "mobile", songMs: 60000 });
  await page.goto("/live"); await goLive(page, w);
  await expect.poll(() => w.plays.length, { timeout: 10000 }).toBeGreaterThan(0);
  await page.waitForTimeout(16000);
  const first = w.spotifyCalls.length;
  await page.reload(); w.spotifyCalls = []; w.plays = []; await goLive(page, w);
  await expect.poll(() => w.plays.length, { timeout: 10000 }).toBeGreaterThan(0);
  await page.waitForTimeout(3000);
  console.log(`BUDGET ${ti.project.name}: first session start ${first} calls, second ${w.spotifyCalls.length}: ${w.spotifyCalls.join(", ")}`);
  expect(w.spotifyCalls.filter((c) => /top|tracks|playlists|artists/.test(c)).length, "taste refetched").toBe(0);
});
