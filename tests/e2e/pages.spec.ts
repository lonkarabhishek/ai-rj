import { test, expect } from "@playwright/test";
import { setup, goLive, noHorizontalOverflow, realErrors } from "./fake";

const mob = (n: string) => n === "mobile";

test("onboarding: /welcome from empty storage through to live", async ({ context, page }, ti) => {
  const w = await setup(context, page, { mobile: mob(ti.project.name), prefs: null });
  await page.goto("/live");
  await expect(page).toHaveURL(/\/welcome/);
  await page.getByRole("button", { name: "Let's go" }).click();
  for (let i = 0; i < 12 && !(await page.getByRole("button", { name: "Go Live" }).isVisible()); i++) {
    const inputs = page.locator("input[type=text], input:not([type])");
    for (const inp of await inputs.all()) if (await inp.isVisible() && !(await inp.inputValue())) await inp.fill(i === 0 ? "Riya" : "Abhishek");
    if (/step=voice/.test(page.url())) { const pick = page.locator("[data-voice], button[role=radio], button:has-text('Neerja')").first(); if (await pick.isVisible().catch(() => false)) await pick.click(); }
    await noHorizontalOverflow(page);
    const cont = page.getByRole("button", { name: "Continue" });
    if (await cont.isEnabled().catch(() => false)) await cont.click(); else await page.getByRole("button", { name: "Skip" }).click();
    await page.waitForTimeout(150);
  }
  await page.screenshot({ path: ti.outputPath("welcome-mode.png") });
  await page.getByRole("button", { name: "Go Live" }).click();
  page.on("framenavigated", (f) => f === page.mainFrame() && console.log("NAV", f.url()));
  await expect(page).toHaveURL(/\/live/);
  console.log("PREFS", await page.evaluate(() => localStorage.getItem("myrj.prefs.v1")));
  await expect.poll(() => w.plays.length, { timeout: 15000 }).toBeGreaterThan(0);
  const saved = await page.evaluate(() => JSON.parse(localStorage.getItem("myrj.prefs.v1") || "{}"));
  expect(saved.onboarded).toBe(true);
  expect(realErrors(w)).toEqual([]);
});

test("/login renders; Google button goes to Supabase Google OAuth with our callback", async ({ context, page }, ti) => {
  const w = await setup(context, page, { mobile: mob(ti.project.name) });
  let authUrl = "";
  await page.route("**/auth/v1/authorize**", (r) => { authUrl = r.request().url(); r.fulfill({ status: 200, body: "ok" }); });
  await page.goto("/login");
  await noHorizontalOverflow(page);
  await page.getByRole("button", { name: /Continue with Google/ }).click();
  await expect.poll(() => authUrl).toContain("provider=google");
  const u = new URL(authUrl);
  expect(u.hostname).toMatch(/supabase\.co$/);
  expect(decodeURIComponent(u.searchParams.get("redirect_to") ?? "")).toMatch(/^http:\/\/localhost:3123\/auth\/callback/);
  expect(realErrors(w)).toEqual([]);
});

test("/settings edits persist across reload", async ({ context, page }, ti) => {
  const w = await setup(context, page, { mobile: mob(ti.project.name), prefs: { songLangs: ["hindi"] } });
  await page.goto("/settings");
  await noHorizontalOverflow(page);
  const name = page.locator("input").first();
  await name.fill("Kiran");
  const sec = page.locator("section", { hasText: "Song language" });
  await sec.getByRole("button", { name: "Tamil", exact: true }).click();
  await page.locator("section", { hasText: "Your RJ talks about" }).getByRole("button", { name: /Jokes/ }).click();
  await page.waitForTimeout(400);
  await page.reload();
  await expect(page.locator("input").first()).toHaveValue("Kiran");
  const saved = await page.evaluate(() => JSON.parse(localStorage.getItem("myrj.prefs.v1") || "{}"));
  expect(saved.songLangs).toEqual(expect.arrayContaining(["hindi", "tamil"]));
  expect(saved.talk.jokes).toBe(false);
  expect(realErrors(w)).toEqual([]);
});

for (const path of ["/live", "/welcome", "/login", "/settings"]) {
  test(`layout ${path}: no horizontal overflow, Go Live/primary visible, no console errors`, async ({ context, page }, ti) => {
    const w = await setup(context, page, { mobile: mob(ti.project.name) });
    await page.goto(path);
    await page.waitForTimeout(800);
    await noHorizontalOverflow(page);
    if (path === "/live") {
      const b = await page.getByRole("button", { name: "Go Live" }).boundingBox();
      const vh = page.viewportSize()!.height;
      expect(b!.y + b!.height, "Go Live within the first screen").toBeLessThanOrEqual(vh);
    }
    await page.screenshot({ path: ti.outputPath(`page-${path.slice(1)}.png`) });
    expect(realErrors(w)).toEqual([]);
  });
}
