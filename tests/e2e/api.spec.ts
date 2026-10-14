import { test, expect } from "@playwright/test";
// Local server API checks (real Claude/Azure from .env.local on :3123; broken Claude key on :3124 for the template path).
const prefs = { rjName: "Riya", listenerName: "Abhishek", language: "english", humor: 2, energy: 2, newsTopics: ["AI"], voiceId: "en-IN-NeerjaNeural", songLangs: ["hindi"] };
const next = { name: "Kesariya", artists: "Arijit Singh", uri: "spotify:track:x" };
const seg = (base: string, body: any) => fetch(`${base}/api/segment`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }).then((r) => r.json());

test("template fallback (Claude down) never returns a bare title, respects toggles", async () => {
  for (const kind of ["full", "stinger"]) {
    const j = await seg("http://localhost:3124", { prefs: { ...prefs, talk: { news: false, jokes: false, facts: true } }, next, index: 2, kind, mode: "default", withNews: true, withJoke: true });
    expect(j.mode).toBe("template");
    if (kind === "full") expect(j.script.length, j.script).toBeGreaterThan(25);
    else expect(j.script === "" || j.script.length > 25, `stinger: silent or a real line, got "${j.script}"`).toBe(true);
    expect(j.script).not.toMatch(/^(up next|next up)[:,]?\s*kesariya\.?$/i);
    expect(j.headlines).toEqual([]);
  }
  const fo = await seg("http://localhost:3124", { prefs: { ...prefs, justMusic: true }, next, index: 3, kind: "full", mode: "focus" });
  expect(fo.mode).toBe("skip");
});
