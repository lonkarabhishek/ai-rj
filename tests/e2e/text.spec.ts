import { test, expect } from "@playwright/test";
import { stripTags } from "../../src/lib/text";
import { looksLikeSong } from "../../src/lib/ytClient";

test("stray [NEWS]/[mood] tags never reach displayed or spoken text", () => {
  expect(stripTags("[hype] [NEWS] Big headline today, folks.")).toBe("Big headline today, folks.");
  expect(stripTags("Here we go [news] and the news [Cheerful] continues .")).toBe("Here we go and the news continues.");
  expect(stripTags("No tags here, just words.")).toBe("No tags here, just words.");
  expect(stripTags("Keep [1] numbers and [2024] years")).toBe("Keep [1] numbers and [2024] years");
});

test("YouTube non-song results are rejected", () => {
  const bad = ["Arijit Singh Full Album", "Reacting to Kesariya", "lofi hip hop radio 24/7", "Best of Arijit 2 hours", "Bollywood Songs Jukebox", "Nonstop Punjabi Hits", "Artist Interview", "Movie Trailer"];
  for (const t of bad) expect(looksLikeSong({ title: t, seconds: 200 }), t).toBe(false);
  expect(looksLikeSong({ title: "Kesariya (Official Video)", seconds: 270 })).toBe(true);
  expect(looksLikeSong({ title: "Fine song", seconds: 1500 })).toBe(false);
});
