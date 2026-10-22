import { test, expect, type Page } from "@playwright/test";
import { setup, goLive, realErrors } from "./fake";
import { setupYt, vid, type FV } from "./fakeYt";
import { buildSsml } from "../../src/lib/tts";
import { llmScript, systemPrompt, templateScript } from "../../src/lib/script";
import { DEFAULT_PREFS, ROMANTIC_MODES, SENSUAL_QUERIES } from "../../src/lib/prefs";

const mob = (n: string) => n === "mobile";
const NAME = "Romantic Hindi · Sensual", DHRUV = "azure:hi-IN-Dhruv:MAI-Voice-2.1-Flash";
const DEVANAGARI = /[ऀ-ॿ]/;
const ttsBodies = (page: Page) => { const out: any[] = []; page.on("request", (r) => { if (r.url().endsWith("/api/tts")) out.push(r.postDataJSON()); }); return out; };

test("Sensual preset: Masculine's voice, its own picker button, persists, fits the screen", async ({ context, page }, ti) => {
  const s = ROMANTIC_MODES.find((m) => m.id === "romantic_s")!;
  expect(s.voiceId).toBe(ROMANTIC_MODES.find((m) => m.id === "romantic_m")!.voiceId);
  await setup(context, page, { mobile: mob(ti.project.name), prefs: { voiceId: "azure:en-IN-NeerjaNeural" } });
  await page.goto("/live");
  const btn = page.getByRole("radio", { name: NAME });
  await expect(btn).toBeVisible();
  for (const n of ["Romantic Hindi · Masculine", "Romantic Hindi · Sultry"]) await expect(page.getByRole("radio", { name: n })).toBeVisible();
  const box = await btn.boundingBox(), vw = page.viewportSize()!.width;
  expect(box!.x + box!.width, "button inside the viewport").toBeLessThanOrEqual(vw);
  expect(await page.evaluate(() => document.documentElement.scrollHeight - window.innerHeight), "no page scroll").toBeLessThanOrEqual(0);
  await btn.click();
  await expect(btn).toHaveAttribute("aria-checked", "true");
  await expect(page.getByTestId("songs-hindi-only")).toHaveText(/Hindi sensual only/);
  await page.reload();
  await expect(page.getByRole("radio", { name: NAME })).toHaveAttribute("aria-checked", "true");
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem("myrj.prefs.v1")!).defaultMode)).toBe("romantic_s");
});

test("Sensual RJ: seductive Hindi prompt that is never explicit; Hindi template lines; deep voice SSML; no news or jokes", async ({ request }) => {
  const prefs = { ...DEFAULT_PREFS, language: "hindi" as const, humor: "off" as const };
  const sp = systemPrompt(prefs, "romantic_s");
  expect(sp).toMatch(/Sensual/); expect(sp).toMatch(/teasing/i); expect(sp).toMatch(/NEVER explicit/); expect(sp).toMatch(/Devanagari/); expect(sp).toMatch(/reply with exactly SKIP/);
  const t = templateScript({ prefs, mode: "romantic_s", index: 1, headlines: [], next: { name: "Bheegey Honth Tere", artists: "Kunal Ganjawala" }, kind: "full" });
  expect(t).toMatch(DEVANAGARI);
  expect(buildSsml("नमस्ते", "hi-IN-Dhruv:MAI-Voice-2.1-Flash", "chill", "romantic_s", [])).toMatch(/pitch="-5%"/); // same as Masculine
  expect(SENSUAL_QUERIES.some((q) => /bheegey honth tere/.test(q)) && SENSUAL_QUERIES.some((q) => /be intehaan/.test(q))).toBe(true);
  // real route on the template server (broken Claude key): forced Hindi, no headlines even if asked
  const j = await (await request.post("http://localhost:3124/api/segment", { data: { prefs: { ...DEFAULT_PREFS, language: "english", humor: "dark", newsTopics: ["AI"] }, mode: "romantic_s", index: 1, kind: "full", withNews: true, withJoke: true, next: { name: "Be Intehaan", artists: "Atif Aslam" }, recent: [] } })).json();
  expect(j.script).toMatch(DEVANAGARI); expect(j.headlines).toEqual([]);
});

const hv = (title: string, o: Partial<FV> = {}) => vid("hindi", title, { channel: "T-Series", label: "hindi", ...o });

test("Sensual on YouTube: only sensual Hindi songs (his first), plain love songs and party songs stay out, RJ in the Dhruv voice", async ({ context, page }, ti) => {
  const w = await setup(context, page, { mobile: mob(ti.project.name), prefs: { music: "youtube", defaultMode: "romantic_s", songLangs: ["english"], voiceId: "azure:en-IN-NeerjaNeural" }, segmentMs: 300, ttsMs: 200 });
  const tts = ttsBodies(page);
  const lib = [
    hv("Bheegey Honth Tere (Murder)", { sensual: true }), hv("Be Intehaan (Race 2)", { sensual: true }), hv("Kaho Na Kaho (Murder)", { sensual: true }),
    hv("Tum Hi Ho (Aashiqui 2)"), hv("Channa Mereya"), hv("Raabta"), hv("Kala Chashma Dance", { romantic: false }),
    vid("english", "Perfect", { channel: "Ed Sheeran", label: "english", audioLang: "en" }),
  ];
  const y = await setupYt(page, { pool: lib, songSec: 4, search: (q) => [hv(`Hot ${q.length} A`, { sensual: true, channel: "Sony Music" }), hv(`Plain Love ${q.length}`, { channel: "Zee Music Company" }), hv(`Hot ${q.length} B`, { sensual: true, channel: "Tips Official" })] });
  await page.goto("/live"); await goLive(page, w);
  await expect.poll(() => y.loads.length, { timeout: 40000 }).toBeGreaterThan(4);
  const vs = y.loads.map((l) => y.videos.get(l.id)!);
  expect(vs.filter((v) => !v.sensual).map((v) => v.title), "non-sensual songs played").toEqual([]);
  expect(vs.slice(0, 3).every((v) => lib.includes(v)), "his own sensual songs come first").toBe(true);
  expect(y.searches.every((q) => SENSUAL_QUERIES.includes(q)), `searches: ${y.searches.join(" | ")}`).toBe(true);
  await expect.poll(() => tts.length, { timeout: 20000 }).toBeGreaterThan(0);
  for (const b of tts) { expect(b.mode).toBe("romantic_s"); expect(b.voiceId).toBe(DHRUV); expect(b.language).toBe("hindi"); }
  const saved = await page.evaluate(() => JSON.parse(localStorage.getItem("myrj.prefs.v1")!).voiceId);
  expect(saved, "saved voice untouched").toBe("azure:en-IN-NeerjaNeural");
  expect(w.spotifyCalls).toEqual([]);
});

test("Sensual on Spotify: only sensual Hindi tracks, even though his favourites are plain romantic", async ({ context, page }, ti) => {
  const w = await setup(context, page, { mobile: mob(ti.project.name), prefs: { defaultMode: "romantic_s", songLangs: ["english"] }, segmentMs: 300, ttsMs: 200, songMs: 6000 });
  await page.goto("/live"); await goLive(page, w);
  await expect.poll(() => w.plays.length, { timeout: 15000 }).toBeGreaterThan(0);
  expect(w.firstPlayMs(), "first song (ms)").toBeLessThan(9000);
  await expect.poll(() => w.plays.length, { timeout: 45000 }).toBeGreaterThan(2);
  const t = w.playedTracks();
  expect(t.filter((x) => !x.sensual).map((x) => x.name), "non-sensual tracks played").toEqual([]);
  expect(t.filter((x) => x.lang !== "hindi").map((x) => x.name), "non-Hindi").toEqual([]);
  expect(w.searches.length, "Spotify searches").toBeLessThanOrEqual(4);
  expect(realErrors(w)).toEqual([]);
});

test("Sensual stories: a 30-60s story every 2-3 songs, told between songs (never over one)", async ({ context, page }, ti) => {
  const w = await setup(context, page, { mobile: mob(ti.project.name), prefs: { defaultMode: "romantic_s" }, segmentMs: 300, ttsMs: 200, songMs: 5000 });
  await page.goto("/live"); await goLive(page, w);
  await expect.poll(() => w.segments.filter((x) => x.segment === "sensual_story").length, { timeout: 90000 }).toBeGreaterThan(2);
  const idx = w.segments.filter((x) => x.segment === "sensual_story").map((x) => x.index);
  for (const x of w.segments.filter((x) => x.segment === "sensual_story")) { expect(x.kind).toBe("full"); expect(x.mode).toBe("romantic_s"); }
  expect(idx[0], "first story after 2 songs").toBe(2);
  for (let i = 1; i < idx.length; i++) expect([2, 3], `gap between stories: ${idx.join(",")}`).toContain(idx[i] - idx[i - 1]);
  expect(realErrors(w)).toEqual([]);
});

test("Sensual stories: Hindi fallback story when Claude is down, and the writing rules say story length and never explicit", async ({ request }) => {
  const prefs = { ...DEFAULT_PREFS, language: "hindi" as const, humor: "off" as const };
  const j = await (await request.post("http://localhost:3124/api/segment", { data: { prefs, mode: "romantic_s", index: 4, kind: "full", segment: "sensual_story", next: { name: "Be Intehaan", artists: "Atif Aslam" }, recent: [] } })).json();
  expect(j.script).toMatch(DEVANAGARI); expect(j.script.length, j.script).toBeGreaterThan(200); expect(j.script).toMatch(/Be Intehaan/);
  // The prompt the writer gets for a story break (no key here, so capture it from the request instead of calling Claude).
  const sent: any[] = []; const orig = globalThis.fetch;
  process.env.ANTHROPIC_API_KEY = "test";
  globalThis.fetch = (async (_u: any, init: any) => { sent.push(JSON.parse(init.body)); return new Response("{}", { status: 500 }); }) as any;
  try { await llmScript({ prefs, mode: "romantic_s", index: 4, kind: "full", segment: "sensual_story", headlines: [], next: { name: "Be Intehaan", artists: "Atif Aslam" } }); }
  finally { globalThis.fetch = orig; delete process.env.ANTHROPIC_API_KEY; }
  expect(sent[0].model).toBe("claude-sonnet-5-5");
  const user = sent[0].messages[0].content as string;
  expect(user).toMatch(/70 to 140 words/); expect(user).toMatch(/NEVER explicit/); expect(user).toMatch(/Do not SKIP/);
});
