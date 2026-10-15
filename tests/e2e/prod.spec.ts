import { test, expect } from "@playwright/test";
// Runs against a deployed copy: PROD_URL=https://your-app.vercel.app npm run e2e:prod
const prefs = { rjName: "Riya", listenerName: "Sam", language: "english", humor: 2, energy: 2, newsTopics: ["AI"], voiceId: "en-IN-NeerjaNeural", songLangs: ["hindi", "english"], talk: { news: true, jokes: false, facts: true } };
const next = { name: "Kesariya", artists: "Arijit Singh", uri: "spotify:track:x" };

test("prod /api/segment returns a real RJ line quickly", async ({ request }) => {
  const t0 = Date.now();
  const r = await request.post("/api/segment", { data: { prefs, next, index: 0, kind: "full", mode: "default", withNews: true } });
  expect(r.status()).toBe(200);
  const j = await r.json();
  console.log(`segment ${Date.now() - t0}ms mode=${j.mode}: ${j.script.slice(0, 120)}`);
  expect(j.script.length).toBeGreaterThan(40);
  expect(Date.now() - t0).toBeLessThan(12000);
});
test("prod /api/tts returns audio", async ({ request }) => {
  const r = await request.post("/api/tts", { data: { text: "Hey there, this is a quick test from your RJ.", voiceId: "en-IN-NeerjaNeural", energy: 2, language: "english" } });
  expect(r.status()).toBe(200);
  expect(r.headers()["content-type"]).toMatch(/audio/);
  expect((await r.body()).length).toBeGreaterThan(5000);
});
test("prod /api/news returns headlines", async ({ request }) => {
  const r = await request.get("/api/news?topics=AI&lang=english");
  expect(r.status()).toBe(200);
  const j = await r.json();
  expect(Array.isArray(j.headlines)).toBe(true);
  console.log(`news: ${j.headlines.length} headlines`);
});
for (const p of ["/", "/login", "/welcome", "/live", "/settings"]) {
  test(`prod page ${p}: 200, no console errors`, async ({ page }) => {
    const errs: string[] = [];
    page.on("console", (m) => m.type() === "error" && errs.push(m.text())); page.on("pageerror", (e) => errs.push(String(e)));
    await page.route(/https:\/\/(api|accounts)\.spotify\.com\/.*/, (r) => r.abort()); // never touch real Spotify
    const res = await page.goto(p);
    expect(res!.status()).toBe(200);
    await page.waitForTimeout(1500);
    expect(errs.filter((e) => !/net::ERR_FAILED|ERR_ABORTED|status of 401/.test(e))).toEqual([]);
  });
}
