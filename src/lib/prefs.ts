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
}

export const DEFAULT_PREFS: Prefs = {
  rjName: "RJ Jockey",
  listenerName: "Abhishek",
  voiceId: "",
  energy: "balanced",
  language: "hinglish",
  humor: "normal",
  newsTopics: ["AI"],
  source: "top",
  externalPlaylists: [],
};

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
    return raw ? { ...DEFAULT_PREFS, ...JSON.parse(raw) } : DEFAULT_PREFS;
  } catch {
    return DEFAULT_PREFS;
  }
}
export function savePrefs(p: Prefs) {
  localStorage.setItem(KEY, JSON.stringify(p));
}

export interface TrackInfo {
  name: string;
  artists: string;
  uri?: string;
  durationMs?: number;
  previewUrl?: string | null;
  spotifyUrl?: string;
  image?: string;
}

export type ListenMode = "default" | "gym" | "drive" | "focus";
export const MODES: { id: ListenMode; label: string; emoji: string; blurb: string; talkEvery: number; energy?: Energy }[] = [
  { id: "default", label: "My Mix", emoji: "📻", blurb: "Your favourites + discoveries", talkEvery: 1 },
  { id: "gym", label: "Gym", emoji: "🏋️", blurb: "High-energy, hype RJ", talkEvery: 1, energy: "hype" },
  { id: "drive", label: "Driving", emoji: "🚗", blurb: "Road-trip singalongs", talkEvery: 1, energy: "hype" },
  { id: "focus", label: "Work / Focus", emoji: "🎧", blurb: "Instrumental, RJ stays quiet", talkEvery: 4, energy: "chill" },
];
