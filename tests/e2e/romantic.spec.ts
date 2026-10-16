import { test, expect } from "@playwright/test";
import { setup, goLive, realErrors } from "./fake";
import { setupYt, vid } from "./fakeYt";
import { buildSsml } from "../../src/lib/tts";
import { systemPrompt, templateScript } from "../../src/lib/script";
import { DEFAULT_PREFS, ROMANTIC_MODES } from "../../src/lib/prefs";

const mob = (n: string) => n === "mobile";
const OPTS = [
  { name: "Romantic Hindi · Masculine", mode: "romantic_m", voice: "azure:hi-IN-Dhruv:MAI-Voice-2.1-Flash" },
  { name: "Romantic Hindi · Sultry", mode: "romantic_f", voice: "azure:hi-IN-Priya:MAI-Voice-2.1-Flash" },
] as const;
const DEVANAGARI = /[\u0900-\u097F]/;

test("picker shows both Romantic Hindi options, they persist, and the page doesn't scroll", async ({ context, page }, ti) => {
  await setup(context, page, { mobile: mob(ti.project.name), prefs: { voiceId: "azure:en-IN-NeerjaNeural" } });
  await page.goto("/live");
  for (const o of OPTS) await expect(page.getByRole("radio", { name: o.name })).toBeVisible();
  const scroll = await page.evaluate(() => document.documentElement.scrollHeight - window.innerHeight);
  expect(scroll, "picker must fit the viewport without scrolling").toBeLessThanOrEqual(0);
  await page.getByRole("radio", { name: OPTS[1].name }).click();
  await expect(page.getByRole("radio", { name: OPTS[1].name })).toHaveAttribute("aria-checked", "true");
  await expect(page.getByRole("radio", { name: "My Mix" })).toHaveAttribute("aria-checked", "false");
  await expect(page.getByTestId("songs-hindi-only")).toBeVisible();
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem("myrj.prefs.v1")!).defaultMode)).toBe("romantic_f");
  await page.reload();
  await expect(page.getByRole("radio", { name: OPTS[1].name })).toHaveAttribute("aria-checked", "true");
  await page.getByRole("radio", { name: OPTS[0].name }).click();
  await page.reload();
  await expect(page.getByRole("radio", { name: OPTS[0].name })).toHaveAttribute("aria-checked", "true");
  // choosing a normal mode again leaves the romantic presets
  await page.getByRole("radio", { name: "Gym" }).click();
  await expect(page.getByRole("radio", { name: OPTS[0].name })).toHaveAttribute("aria-checked", "false");
  await expect(page.getByRole("button", { name: "Go Live", exact: true })).toBeVisible();
});

for (const o of OPTS) {
  test(`${o.name}: Spotify plays Hindi only, RJ uses ${o.voice} and Hindi prompts, saved voice untouched`, async ({ context, page }, ti) => {
    const w = await setup(context, page, { mobile: mob(ti.project.name), prefs: { defaultMode: o.mode, songLangs: ["english", "tamil"], language: "english", voiceId: "azure:en-IN-NeerjaNeural" }, segmentMs: 500, ttsMs: 300, songMs: 9000 });
    const tts: any[] = [];
    await page.route("**/api/tts", (r) => { tts.push(r.request().postDataJSON()); r.fallback(); });
    await page.goto("/live");
    await expect(page.getByRole("radio", { name: o.name })).toHaveAttribute("aria-checked", "true");
    await goLive(page, w);
    await expect.poll(() => w.plays.length, { timeout: 10000 }).toBeGreaterThan(0);
    for (let i = 0; i < 2; i++) { await page.getByRole("button", { name: "Next" }).click().catch(() => {}); await expect.poll(() => w.plays.length, { timeout: 25000 }).toBeGreaterThan(i + 1); }
    const played = w.playedTracks();
    expect(played.filter((t) => t.lang !== "hindi").map((t) => `${t.name} (${t.lang})`), "non-Hindi songs").toEqual([]);
    expect(w.searches.length).toBeGreaterThan(0);
    expect(w.searches.filter((q) => !/hindi|bollywood|arijit|ghazal|ishq|atif|jubin|shreya|sonu/i.test(q)), "non-Hindi searches").toEqual([]);
    expect(w.searches.some((q) => /romantic|love|ishq|ghazal|ballad/i.test(q)), "romantic search terms").toBe(true);
    await expect.poll(() => tts.length, { timeout: 15000 }).toBeGreaterThan(0);
    for (const t of tts) { expect(t.voiceId).toBe(o.voice); expect(t.mode).toBe(o.mode); expect(t.language).toBe("hindi"); }
    for (const s of w.segments) { expect(s.mode).toBe(o.mode); expect(s.prefs.language).toBe("hindi"); }
    expect(await page.evaluate(() => JSON.parse(localStorage.getItem("myrj.prefs.v1")!))).toMatchObject({ voiceId: "azure:en-IN-NeerjaNeural", language: "english", songLangs: ["english", "tamil"] });
    expect(realErrors(w)).toEqual([]);
  });

  test(`${o.name}: YouTube plays Hindi romantic only`, async ({ context, page }, ti) => {
    const w = await setup(context, page, { mobile: mob(ti.project.name), prefs: { music: "youtube", defaultMode: o.mode, songLangs: ["english"] }, segmentMs: 400, ttsMs: 300 });
    const pool = [vid("english", "Shape of You", { channel: "Ed Sheeran", audioLang: "en" }), vid("hindi", "Party Anthem Dance Mix", { channel: "T-Series" })];
    const y = await setupYt(page, { pool, songSec: 5, search: (q) => [
      vid("hindi", `Tum Hi Ho ${q.length}`, { channel: "T-Series", audioLang: "hi" }), vid("hindi", `Kesariya ${q.length}`, { channel: "Sony Music India" }),
      vid("hindi", "Hindi Love Song Remix DJ Party", { channel: "DJ" }), vid("english", "Love Story English", { channel: "Taylor", audioLang: "en" }),
    ] });
    await page.goto("/live"); await goLive(page, w);
    await expect.poll(() => y.loads.length, { timeout: 40000 }).toBeGreaterThan(2);
    const played = y.loads.map((l) => y.videos.get(l.id)!);
    expect(played.filter((v) => v.lang !== "hindi" || /remix|party|dance/i.test(v.title)).map((v) => v.title)).toEqual([]);
    expect(y.searches.length).toBeGreaterThan(0);
    expect(y.searches.filter((q) => !/hindi|bollywood|arijit|ghazal|ishq|atif|jubin|shreya|sonu/i.test(q)), "non-Hindi searches").toEqual([]);
    expect(w.spotifyCalls).toEqual([]);
  });
}

test("Romantic Hindi: Hindi prompt, Devanagari template lines, no news or jokes; talk toggles respected", async ({ request }) => {
  for (const o of OPTS) {
    const prefs = { ...DEFAULT_PREFS, language: "hindi" as const, humor: "off" as const };
    const sp = systemPrompt(prefs, o.mode);
    expect(sp).toMatch(/Romantic Hindi/); expect(sp).toMatch(/Devanagari/); expect(sp).toMatch(/shayari/i); expect(sp).toMatch(/never explicit/i); expect(sp).toMatch(/reply with exactly SKIP/);
    const t = templateScript({ prefs, mode: o.mode, index: 1, headlines: [{ title: "Some long headline about markets today", source: "x" } as any], next: { name: "Tum Hi Ho", artists: "Arijit Singh" }, kind: "full" });
    expect(t).toMatch(DEVANAGARI); expect(t).not.toMatch(/Some long headline/);
    // real server route (port 3124 has a broken Claude key, so this is the template path): language forced to Hindi, no jokes/news even if asked
    const r = await request.post("http://localhost:3124/api/segment", { data: { prefs: { ...DEFAULT_PREFS, language: "english", humor: "dark", newsTopics: ["AI"] }, mode: o.mode, index: 1, kind: "full", withNews: true, withJoke: true, next: { name: "Tum Hi Ho", artists: "Arijit Singh" }, recent: [] } });
    const j = await r.json();
    expect(j.script).toMatch(DEVANAGARI); expect(j.headlines).toEqual([]);
    const off = await (await request.post("http://localhost:3124/api/segment", { data: { prefs: { ...DEFAULT_PREFS, talk: { news: false, jokes: false, facts: false }, justMusic: true }, mode: o.mode, index: 1, kind: "stinger", next: { name: "Tum Hi Ho", artists: "Arijit Singh" }, recent: [] } })).json();
    expect(off.script === "" || DEVANAGARI.test(off.script) || /Tum Hi Ho/.test(off.script)).toBe(true);
  }
});

test("Romantic Hindi voices: SSML uses the right voice, slow/low prosody, style only if supported", () => {
  expect(ROMANTIC_MODES.map((m) => m.voiceId)).toEqual(OPTS.map((o) => o.voice));
  const m = buildSsml("नमस्ते", "hi-IN-Dhruv:MAI-Voice-2.1-Flash", "chill", "romantic_m", ["softvoice", "whispering"]);
  expect(m).toContain('<voice name="hi-IN-Dhruv:MAI-Voice-2.1-Flash">'); expect(m).toContain('xml:lang="hi-IN"'); expect(m).toMatch(/pitch="-5%"/); expect(m).toMatch(/rate="-8%"/); expect(m).not.toContain("express-as");
  const f = buildSsml("नमस्ते", "hi-IN-Priya:MAI-Voice-2.1-Flash", "chill", "romantic_f", ["softvoice", "whispering"]);
  expect(f).toContain('<voice name="hi-IN-Priya:MAI-Voice-2.1-Flash">'); expect(f).toContain('style="softvoice"'); expect(f).toMatch(/pitch="-3%"/);
  const noStyle = buildSsml("नमस्ते", "hi-IN-AartiNeural", "chill", "romantic_f", []);
  expect(noStyle).not.toContain("express-as"); expect(noStyle).toMatch(/rate="-10%"/);
});
