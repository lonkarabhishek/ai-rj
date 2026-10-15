export type Language = "english" | "hindi" | "hinglish" | "marathi";
export type Humor = "off" | "clean" | "normal" | "witty" | "dark";
export type Energy = "chill" | "balanced" | "hype";

export interface Prefs {
  rjName: string;
  listenerName: string;
  voiceId: string;
  voiceName?: string;
  energy: Energy;
  language: Language;
  humor: Humor;
  newsTopics: string[];
  source: "top" | string; // "top" or a Spotify playlist id
  externalPlaylists: { url: string; note?: string; addedAt: string }[];
  onboarded: boolean;
  tasteSeeds: TrackInfo[]; // songs imported from screenshots/links/lists, matched on Spotify
  defaultMode: ListenMode;
  vibe?: string; // retired feature; old saved values are ignored
  songLangs: SongLang[]; // song language(s) for curation; ["any"] = no filter. Separate from the RJ's speaking language.
  talk: { news: boolean; jokes: boolean; facts: boolean };
  music: "spotify" | "youtube"; // playback source
  justMusic: boolean; // RJ keeps to minimal intros (silent in Focus)
}

export const DEFAULT_PREFS: Prefs = {
  rjName: "RJ Jockey",
  listenerName: "friend",
  voiceId: "",
  energy: "balanced",
  language: "hinglish",
  humor: "normal",
  newsTopics: ["AI"],
  source: "top",
  externalPlaylists: [],
  onboarded: false,
  tasteSeeds: [],
  defaultMode: "default",
  songLangs: ["any"],
  talk: { news: true, jokes: true, facts: true },
  justMusic: false,
  music: "spotify",
};
export type SongLang = "any" | "hindi" | "english" | "punjabi" | "marathi" | "tamil" | "telugu";
export const SONG_LANGS: { id: SongLang; label: string }[] = [
  { id: "any", label: "Any" }, { id: "hindi", label: "Hindi" }, { id: "english", label: "English" }, { id: "punjabi", label: "Punjabi" },
  { id: "marathi", label: "Marathi" }, { id: "tamil", label: "Tamil" }, { id: "telugu", label: "Telugu" },
];
export function toggleSongLang(cur: SongLang[], id: SongLang): SongLang[] {
  if (id === "any") return ["any"];
  const base = cur.filter((x) => x !== "any");
  const next = base.includes(id) ? base.filter((x) => x !== id) : [...base, id];
  return next.length ? next : ["any"];
}

export const LANGUAGES: { id: Language; label: string }[] = [
  { id: "english", label: "English" },
  { id: "hindi", label: "हिन्दी (Hindi)" },
  { id: "hinglish", label: "Hinglish" },
  { id: "marathi", label: "मराठी (Marathi)" },
];
export const HUMORS: Humor[] = ["off", "clean", "normal", "witty", "dark"];
export const ENERGIES: Energy[] = ["chill", "balanced", "hype"];

const KEY = "myrj.prefs.v1";
export function loadPrefs(): Prefs {
  if (typeof window === "undefined") return DEFAULT_PREFS;
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return DEFAULT_PREFS;
    const j = JSON.parse(raw);
    return { ...DEFAULT_PREFS, ...j, talk: { ...DEFAULT_PREFS.talk, ...(j.talk ?? {}) }, songLangs: Array.isArray(j.songLangs) && j.songLangs.length ? j.songLangs : ["any"] };
  } catch {
    return DEFAULT_PREFS;
  }
}
export function savePrefs(p: Prefs) {
  localStorage.setItem(KEY, JSON.stringify(p));
  window.dispatchEvent(new Event("myrj:prefs"));
}
/** Treat existing users who already picked a voice as onboarded. */
export function isOnboarded(p: Prefs) { return p.onboarded || !!p.voiceId; }

export interface TrackInfo {
  name: string;
  artists: string;
  uri?: string;
  durationMs?: number;
  ytId?: string; // YouTube video id when the track plays from YouTube
  previewUrl?: string | null;
  spotifyUrl?: string;
  image?: string;
  artistIds?: string[];
}

export type ListenMode = "default" | "gym" | "drive" | "focus";
export const MODES: { id: ListenMode; label: string; emoji: string; blurb: string; talkEvery: number; energy?: Energy }[] = [
  { id: "default", label: "My Mix", emoji: "📻", blurb: "Your favourites + discoveries", talkEvery: 1 },
  { id: "gym", label: "Gym", emoji: "🏋️", blurb: "High-energy, hype RJ", talkEvery: 1, energy: "hype" },
  { id: "drive", label: "Driving", emoji: "🚗", blurb: "Road-trip singalongs", talkEvery: 1, energy: "hype" },
  { id: "focus", label: "Focus", emoji: "🎧", blurb: "Work mode: instrumental, RJ stays quiet", talkEvery: 4, energy: "chill" },
];
