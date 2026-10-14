import { test, expect } from "@playwright/test";
import { setup, goLive, realErrors, diag, BARE_TITLE } from "./fake";

const mob = (n: string) => n === "mobile";

test("RJ opener and breaks are real lines, not bare titles", async ({ context, page }, ti) => {
  const w = await setup(context, page, { mobile: mob(ti.project.name), songMs: 8000 });
  await page.goto("/live"); await goLive(page, w);
  await expect.poll(() => w.tts.length, { timeout: 20000 }).toBeGreaterThan(0);
  for (let i = 0; i < 3; i++) { await expect.poll(() => w.plays.length, { timeout: 30000 }).toBeGreaterThan(i); await page.getByRole("button", { name: "Next" }).click().catch(() => {}); }
  await expect.poll(() => w.tts.length, { timeout: 30000 }).toBeGreaterThan(1);
  for (const t of w.tts) { expect(t.length, `line: ${t}`).toBeGreaterThan(30); expect(t).not.toMatch(BARE_TITLE); }
  expect(w.segments[0].index).toBe(0);
  const d = await diag(page);
  expect(d.breaks ?? "").not.toMatch(/skip/);
  expect(realErrors(w)).toEqual([]);
});

test("topic toggles are sent to /api/segment and respected", async ({ context, page }, ti) => {
  const w = await setup(context, page, { mobile: mob(ti.project.name), prefs: { talk: { news: false, jokes: false, facts: true } } });
  await page.goto("/live");
  await expect(page.getByRole("button", { name: /News/ })).toHaveAttribute("aria-pressed", "false");
  await goLive(page, w);
  await expect.poll(() => w.tts.length, { timeout: 20000 }).toBeGreaterThan(0);
  for (const b of w.segments) { expect(b.prefs.talk).toMatchObject({ news: false, jokes: false, facts: true }); expect(b.withNews ?? false).toBeFalsy(); expect(b.withJoke ?? false).toBeFalsy(); }
  for (const t of w.tts) expect(t).not.toMatch(/\[NEWS\]|\[JOKE\]/);
});

test("Just music: only minimal intros", async ({ context, page }, ti) => {
  const w = await setup(context, page, { mobile: mob(ti.project.name), songMs: 7000 });
  await page.goto("/live");
  await page.getByRole("button", { name: "Just music" }).click();
  await goLive(page, w);
  await expect.poll(() => w.plays.length, { timeout: 10000 }).toBeGreaterThan(0);
  await page.waitForTimeout(6000);
  for (const b of w.segments) expect(b.prefs.justMusic).toBe(true);
  for (const t of w.tts) { expect(t).not.toMatch(/\[NEWS\]|\[JOKE\]|\[FACT\]/); expect(t.length).toBeLessThan(80); }
  await expect(page.getByText("Just music")).toBeVisible();
});

test("mid-session Change sheet: mode switch line + new languages", async ({ context, page }, ti) => {
  const w = await setup(context, page, { mobile: mob(ti.project.name), prefs: { songLangs: ["english"] }, songMs: 30000 });
  await page.goto("/live"); await goLive(page, w);
  await expect.poll(() => w.plays.length, { timeout: 10000 }).toBeGreaterThan(0);
  await page.getByRole("button", { name: "Change" }).click();
  const sheet = page.locator(".sheet-up");
  await sheet.getByRole("radio", { name: "Gym" }).click();
  await sheet.getByRole("button", { name: "Punjabi", exact: true }).click();
  await page.screenshot({ path: ti.outputPath("change-sheet.png") });
  await sheet.getByRole("button", { name: "Done" }).click();
  await expect.poll(() => w.segments.some((s) => s.kind === "switch" && s.mode === "gym"), { timeout: 15000 }).toBe(true);
  await expect.poll(() => w.tts.some((t) => /Switching gears/.test(t)), { timeout: 15000 }).toBe(true);
  await expect(page.getByText(/^Gym$/)).toBeVisible();
  const saved = await page.evaluate(() => JSON.parse(localStorage.getItem("myrj.prefs.v1") || "{}"));
  expect(saved.songLangs).toContain("punjabi");
  expect(realErrors(w)).toEqual([]);
});
