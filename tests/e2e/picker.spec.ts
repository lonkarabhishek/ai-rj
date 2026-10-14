import { test, expect } from "@playwright/test";
import { setup, goLive, realErrors, diag } from "./fake";

const MODES = [["default", "My Mix"], ["gym", "Gym"], ["drive", "Driving"], ["focus", "Focus"]] as const;
const LANGS: string[][] = [["any"], ["hindi", "english"], ["marathi"], ["tamil"]];
const combos: [string, string, string[]][] = [];
for (const [m, label] of MODES) for (const l of LANGS) combos.push([m, label, l]);
combos.push(["focus", "Focus", ["hindi"]]);
const uniq = new Map(combos.map((c) => [`${c[0]}|${c[2].join("+")}`, c]));

for (const [mode, label, langs] of uniq.values()) {
  test(`picker ${label} x ${langs.join("+")}: first song < 5s, right language${mode === "focus" ? ", instrumental only" : ""}`, async ({ context, page }, ti) => {
    const w = await setup(context, page, { mobile: ti.project.name === "mobile", prefs: { songLangs: langs, defaultMode: "default" }, songMs: 9000 });
    await page.goto("/live");
    await page.getByRole("radio", { name: label }).click();
    await expect(page.getByRole("radio", { name: label })).toHaveAttribute("aria-checked", "true");
    await goLive(page, w);
    await expect.poll(() => w.plays.length, { timeout: 8000 }).toBeGreaterThan(0);
    if (w.firstPlayMs() > 3500) console.log(`SLOW ${ti.project.name} ${label} ${langs} ${w.firstPlayMs()}ms: ${(await diag(page)).timings}`);
    expect(w.firstPlayMs(), "first song start (ms)").toBeLessThan(5000);
    // let a couple more songs go by
    for (let i = 0; i < 2; i++) { await page.getByRole("button", { name: "Next" }).click().catch(() => {}); await expect.poll(() => w.plays.length, { timeout: 25000 }).toBeGreaterThan(i + 1); }
    const played = w.playedTracks();
    if (!langs.includes("any")) {
      const bad = played.filter((t) => t.lang !== "unknown" && !langs.includes(t.lang));
      expect(bad.map((t) => `${t.name} (${t.lang})`), "wrong-language songs").toEqual([]);
      for (const l of langs) expect(w.searches.some((q) => new RegExp({ hindi: "hindi|bollywood|arijit|filmi", english: "pop|indie|english|r&b|rock|lofi|piano|ambient", marathi: "marathi|ajay atul", tamil: "tamil|kollywood|anirudh|ilaiyaraaja" }[l] ?? l, "i").test(q)), `searched for ${l}`).toBe(true);
    }
    if (mode === "focus") expect(played.filter((t) => !t.instrumental).map((t) => t.name), "vocal songs in Focus").toEqual([]);
    expect(realErrors(w)).toEqual([]);
  });
}
