import { test, expect } from "@playwright/test";
import { setup, goLive, realErrors } from "./fake";
import { modelFor, segmentFor, splitAnswer, type SegmentInput } from "../../src/lib/script";
import { DEFAULT_PREFS } from "../../src/lib/prefs";

const mob = (n: string) => n === "mobile";
const base = (o: Partial<SegmentInput> = {}): SegmentInput => ({ prefs: { ...DEFAULT_PREFS }, index: 3, kind: "full", mode: "default", headlines: [], ...o });

test("show bits: hidden trivia answers, segment fallbacks and model choice", () => {
  expect(splitAnswer("[cheerful] Sawaal: kis saal aaya ye gaana? Jawab gaane ke baad!\nANSWER: Twenty nineteen.")).toEqual({ text: "[cheerful] Sawaal: kis saal aaya ye gaana? Jawab gaane ke baad!", answer: "Twenty nineteen" });
  expect(splitAnswer("No question here.")).toEqual({ text: "No question here." });
  expect(segmentFor(base({ segment: "story" }))).toBe("story");
  expect(segmentFor(base({ segment: "story", prefs: { ...DEFAULT_PREFS, talk: { news: true, jokes: true, facts: false } } }))).toBe("vibe"); // facts off
  expect(segmentFor(base({ segment: "trivia_a" }))).toBe("vibe"); // no question was asked
  expect(segmentFor(base({ segment: "trivia_a", trivia: { q: "q", a: "a" } }))).toBe("trivia_a");
  expect(segmentFor(base({ segment: "callback", history: [{ name: "a", artists: "x" }] }))).toBe("vibe"); // not enough history yet
  expect(segmentFor(base({ segment: "hot_take", mode: "gym" }))).toBe("vibe");
  expect(segmentFor(base({ segment: "dedication", mode: "romantic_m" }))).toBe("vibe");
  expect(segmentFor(base({ segment: "story", kind: "stinger" }))).toBe("vibe");
  expect(segmentFor(base({ segment: "story", index: 0 }))).toBe("vibe"); // the opener is its own thing
  const env = { m: process.env.ANTHROPIC_MODEL, f: process.env.ANTHROPIC_MODEL_FULL };
  delete process.env.ANTHROPIC_MODEL; delete process.env.ANTHROPIC_MODEL_FULL;
  expect(modelFor({ kind: "full", index: 2 })).toBe("claude-sonnet-5-5");
  expect(modelFor({ kind: "full", index: 0 })).toBe("claude-sonnet-5-5");
  expect(modelFor({ kind: "stinger", index: 2 })).toBe("claude-haiku-5-5");
  expect(modelFor({ kind: "switch", index: 2 })).toBe("claude-haiku-5-5");
  Object.assign(process.env, env.m ? { ANTHROPIC_MODEL: env.m } : {}, env.f ? { ANTHROPIC_MODEL_FULL: env.f } : {});
});

test("show memory: breaks carry the songs played so far, and a trivia question is answered at the next break", async ({ context, page }, ti) => {
  const w = await setup(context, page, { mobile: mob(ti.project.name), songMs: 7000, trivia: true, segmentMs: 400, ttsMs: 300 });
  await page.goto("/live"); await goLive(page, w);
  await expect.poll(() => w.segments.some((s) => s.asked), { timeout: 40000 }).toBe(true);
  await expect.poll(() => w.segments.find((s) => s.segment === "trivia_a"), { timeout: 45000 }).toBeTruthy();
  const ans = w.segments.find((s) => s.segment === "trivia_a");
  expect(ans.trivia).toEqual({ q: "Which year did this one come out?", a: "twenty nineteen" });
  expect(ans.kind).toBe("full");
  await expect.poll(() => w.tts.some((t) => /jawab hai twenty nineteen/i.test(t)), { timeout: 20000 }).toBe(true);
  expect(w.segments.filter((s) => s.segment === "trivia_a").length, "answered once, not every break").toBe(1);
  const later = w.segments[w.segments.length - 1];
  expect(later.history.length, "history of played songs").toBeGreaterThan(0);
  expect(later.history[0]).toMatchObject({ name: expect.any(String), artists: expect.any(String) });
  expect(realErrors(w)).toEqual([]);
});

test("in-browser player: every song comes back to full volume (no stale fade leaves it quiet)", async ({ context, page }, ti) => {
  test.skip(mob(ti.project.name), "volume control is the in-browser player only");
  const w = await setup(context, page, { mobile: false, songMs: 9000, segmentMs: 400, ttsMs: 300 });
  await page.goto("/live"); await goLive(page, w);
  await expect.poll(() => w.plays.length, { timeout: 60000 }).toBeGreaterThan(3);
  const vols: [number, number][] = await page.evaluate(() => (window as any).__vols ?? []);
  for (let i = 1; i < w.plays.length - 1; i++) {
    const [a, b] = [w.plays[i].t, w.plays[i + 1].t];
    const peak = Math.max(0, ...vols.filter(([t]) => t > a && t < b).map(([, v]) => v));
    expect(peak, `song ${i + 1} peak volume`).toBeGreaterThanOrEqual(0.8);
  }
  expect(realErrors(w)).toEqual([]);
});

test("Next while the RJ break is still being written moves straight on", async ({ context, page }, ti) => {
  test.skip(mob(ti.project.name), "same loop on both; desktop has precise song ends");
  const w = await setup(context, page, { mobile: false, songMs: 6000, segmentMs: 300, ttsMs: 300 });
  await page.goto("/live"); await goLive(page, w);
  await expect.poll(() => w.plays.length, { timeout: 15000 }).toBeGreaterThan(0);
  // From now on every break takes 20s to write: the first junction has to wait for it.
  await page.route("**/api/segment", async (r) => { w.segments.push(r.request().postDataJSON()); await new Promise((x) => setTimeout(x, 20000)); r.fulfill({ json: { script: "", mood: "calm", kind: "full", mode: "llm", headlines: [] } }).catch(() => {}); });
  const n = w.plays.length, segs = w.segments.length;
  await page.getByRole("button", { name: "Next" }).click(); // ends song 1 (its break was written before the slow route)
  await expect.poll(() => w.plays.length, { timeout: 15000 }).toBeGreaterThan(n);
  await page.waitForTimeout(9000); // song 2 (6s) is over; the show now waits on its 20s break
  test.skip(w.segments.length === segs, "this junction was planned as pure music (no break to wait for)");
  const m = w.plays.length;
  expect(m, "still waiting on the break").toBe(n + 1);
  await page.getByRole("button", { name: "Next" }).click();
  await expect.poll(() => w.plays.length, { timeout: 4000, message: "Next must not wait for the 20s break" }).toBeGreaterThan(m);
});

test("phone Spotify: next song is queued on the device, and if the page was frozen the show adopts it instead of restarting it", async ({ context, page }, ti) => {
  test.skip(!mob(ti.project.name), "Spotify Connect is the phone path");
  const w = await setup(context, page, { mobile: true, songMs: 8000, segmentMs: 300, ttsMs: 300 });
  await page.goto("/live"); await goLive(page, w);
  await expect.poll(() => w.playBodies.length, { timeout: 15000 }).toBeGreaterThan(0);
  await expect.poll(() => w.playBodies.some((b) => b.length === 2), { timeout: 20000, message: "song + the next one queued" }).toBe(true);
  // Freeze the page (iOS does this when the screen locks) right after a song starts, past the end of that song.
  await expect.poll(() => w.player.isPlaying && w.player.queue.length === 1, { timeout: 30000 }).toBe(true);
  const playsBefore = w.plays.length, queued = w.player.queue[0];
  const cdp = await context.newCDPSession(page);
  await cdp.send("Page.setWebLifecycleState", { state: "frozen" });
  await page.waitForTimeout(9500);
  expect(w.state()?.item.uri, "Spotify moved on by itself").toBe(queued);
  await cdp.send("Page.setWebLifecycleState", { state: "active" });
  await page.waitForTimeout(4000);
  expect(w.plays.slice(playsBefore).some((p) => p.uri === queued), "the auto-started song is not restarted").toBe(false);
  await expect.poll(() => w.plays.length, { timeout: 25000, message: "the show carries on after it" }).toBeGreaterThan(playsBefore);
  expect(realErrors(w)).toEqual([]);
});
