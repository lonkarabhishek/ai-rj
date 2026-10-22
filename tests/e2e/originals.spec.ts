import { test, expect } from "@playwright/test";
import { setup, goLive, realErrors } from "./fake";
import { setupYt, vid } from "./fakeYt";
import { isOriginal } from "../../src/lib/prefs";

const mob = (n: string) => n === "mobile";

test("originals only: remixes, lofi/slowed edits, covers, reprises and alternate versions are recognised; originals pass", () => {
  const notOriginal = ["Kesariya (Remix)", "Raataan Lambiyan - Lofi Flip", "Kesariya Slowed + Reverb", "Tum Hi Ho (Reprise)", "Apna Bana Le Unplugged", "Channa Mereya Female Version",
    "Bheegey Honth Tere | 8D Audio", "Be Intehaan Sped Up", "Tera Ban Jaunga Cover by Someone", "Pehla Nasha Jhankar Beats", "Mashup 2026 Bollywood", "Tum Se Hi Karaoke", "Kaho Na Kaho Lo-Fi", "Dil Diyan Gallan Recreated", "Zara Zara Bass Boosted", "Hawayein Acoustic Version", "Nightcore Mix"];
  const original = ["Kesariya (Official Video)", "DJ Waley Babu", "Bheegey Honth Tere", "Be Intehaan", "Tum Hi Ho", "Undercover Lover", "Discovery", "Remembering You", "Acoustic Soul"];
  for (const t of notOriginal) expect(isOriginal(t), t).toBe(false);
  for (const t of original) expect(isOriginal(t), t).toBe(true);
});

test("YouTube plays original recordings only (his library has remixes and versions)", async ({ context, page }, ti) => {
  const w = await setup(context, page, { mobile: mob(ti.project.name), prefs: { music: "youtube", songLangs: ["hindi"] }, segmentMs: 300, ttsMs: 200 });
  const hv = (t: string) => vid("hindi", t, { channel: "T-Series", label: "hindi" });
  const lib = [hv("Kesariya"), hv("Kesariya (Remix)"), hv("Raabta"), hv("Raabta Lofi Flip"), hv("Channa Mereya"), hv("Channa Mereya Unplugged"), hv("Tum Hi Ho"), hv("Tum Hi Ho Slowed + Reverb"), hv("Phir Le Aaya Dil"), hv("Hawayein Reprise")];
  const y = await setupYt(page, { pool: lib, songSec: 3, search: (q) => [hv(`Rec ${q.length}`), hv(`Rec ${q.length} (DJ Remix)`)] });
  await page.goto("/live"); await goLive(page, w);
  await expect.poll(() => y.loads.length, { timeout: 40000 }).toBeGreaterThan(4);
  const titles = y.loads.map((l) => y.videos.get(l.id)!.title);
  expect(titles.filter((t) => !isOriginal(t)), `played: ${titles.join(" | ")}`).toEqual([]);
});

test("Spotify plays original recordings only (searches return some remixes)", async ({ context, page }, ti) => {
  const w = await setup(context, page, { mobile: mob(ti.project.name), prefs: { songLangs: ["hindi"] }, segmentMs: 300, ttsMs: 200, songMs: 5000 });
  await page.goto("/live"); await goLive(page, w);
  await expect.poll(() => w.plays.length, { timeout: 45000 }).toBeGreaterThan(3);
  const names = w.playedTracks().map((t) => t.name);
  expect(names.filter((n) => !isOriginal(n)), `played: ${names.join(" | ")}`).toEqual([]);
  expect(realErrors(w)).toEqual([]);
});
