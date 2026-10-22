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

export type ListenMode = "default" | "gym" | "drive" | "focus" | "romantic_m" | "romantic_f" | "romantic_s";
export const MODES: { id: ListenMode; label: string; emoji: string; blurb: string; talkEvery: number; energy?: Energy }[] = [
  { id: "default", label: "My Mix", emoji: "📻", blurb: "Your favourites + discoveries", talkEvery: 1 },
  { id: "gym", label: "Gym", emoji: "🏋️", blurb: "High-energy, hype RJ", talkEvery: 1, energy: "hype" },
  { id: "drive", label: "Driving", emoji: "🚗", blurb: "Road-trip singalongs", talkEvery: 1, energy: "hype" },
  { id: "focus", label: "Focus", emoji: "🎧", blurb: "Work mode: instrumental, RJ stays quiet", talkEvery: 4, energy: "chill" },
];

/**
 * Romantic Hindi session presets: a session type next to the four modes. They force Hindi songs (romantic only), a Hindi-speaking RJ and a
 * dedicated Azure voice for that session only (the saved voice setting is untouched).
 * Voices checked against the live Azure list (hi-IN): MAI-Voice-2.1-Flash Dhruv (deep male, ~90 Hz) and Priya (lowest-pitched female, supports softvoice).
 */
export type RomanticMode = "romantic_m" | "romantic_f" | "romantic_s";
export const ROMANTIC_MODES: { id: RomanticMode; label: string; sub: string; voiceId: string; fallbackVoiceId: string; blurb: string }[] = [
  { id: "romantic_m", label: "Romantic Hindi", sub: "Masculine", voiceId: "azure:hi-IN-Dhruv:MAI-Voice-2.1-Flash", fallbackVoiceId: "azure:hi-IN-KunalNeural", blurb: "Deep, confident male Hindi RJ · romantic Hindi songs" },
  { id: "romantic_f", label: "Romantic Hindi", sub: "Sultry", voiceId: "azure:hi-IN-Priya:MAI-Voice-2.1-Flash", fallbackVoiceId: "azure:hi-IN-AartiNeural", blurb: "Warm, sultry female Hindi RJ · romantic Hindi songs" },
  // Same deep voice as Masculine; only sensual, seductive Hindi songs, and a teasing RJ (suggestive, never explicit).
  { id: "romantic_s", label: "Romantic Hindi", sub: "Sensual", voiceId: "azure:hi-IN-Dhruv:MAI-Voice-2.1-Flash", fallbackVoiceId: "azure:hi-IN-KunalNeural", blurb: "Deep male Hindi RJ, seductive · sensual Hindi songs only" },
];
export const isRomantic = (m?: ListenMode | string | null): m is RomanticMode => m === "romantic_m" || m === "romantic_f" || m === "romantic_s";
/** Romantic Hindi · Sensual: only songs tagged sensual (not every love song). */
export const isSensual = (m?: ListenMode | string | null) => m === "romantic_s";
export const romanticVoice = (m?: ListenMode | string | null) => ROMANTIC_MODES.find((x) => x.id === m)?.voiceId;
/** Display info for any mode, including the romantic presets. */
export function modeInfo(id: ListenMode) {
  const m = MODES.find((x) => x.id === id);
  if (m) return m;
  const r = ROMANTIC_MODES.find((x) => x.id === id);
  return { id, label: r ? `${r.label} · ${r.sub}` : id, emoji: "🌙", blurb: r?.blurb ?? "", talkEvery: 1, energy: "chill" as Energy };
}
/** Song languages actually used for a session: romantic sessions are Hindi only. */
export const effectiveSongLangs = (m: ListenMode, langs: SongLang[]): SongLang[] => (isRomantic(m) ? ["hindi"] : langs);

/** Search terms for the Romantic Hindi sessions (Spotify and YouTube). Each says Hindi/Bollywood so results stay Hindi. */
export const ROMANTIC_QUERIES = [
  "hindi romantic songs", "bollywood love songs", "arijit singh romantic hindi", "atif aslam romantic hindi songs", "jubin nautiyal love songs hindi",
  "shreya ghoshal romantic bollywood", "sonu nigam romantic hindi songs", "bollywood romantic ballads", "hindi ghazal love songs", "soft bollywood love songs",
  "ishq hindi songs", "hindi sad romantic arijit", "bollywood unplugged love songs", "pehla nasha hindi love", "hindi lofi-free romantic acoustic songs",
];
/** Search terms for Romantic Hindi · Sensual: songs in the vein of Bheegey Honth Tere and Be Intehaan. Each says Hindi/Bollywood or names the film. */
export const SENSUAL_QUERIES = [
  "bheegey honth tere murder", "be intehaan race 2", "kaho na kaho murder", "zara zara touch me race", "dil sambhal ja zara murder 2",
  "aa zara murder 2", "haal e dil murder 2", "jaadu hai nasha hai jism", "abhi abhi jism 2", "aaj phir hate story 2",
  "tu isaq mera hate story 3", "neendein khul jaati hain hate story 3", "aashiq banaya aapne", "kabhi jo baadal barse",
  "emraan hashmi sensual hindi songs", "bollywood sensual songs", "hot romantic bollywood songs", "seductive hindi songs",
];
export const romanticQueries = (m?: ListenMode | string | null) => (isSensual(m) ? SENSUAL_QUERIES : ROMANTIC_QUERIES);
/** Titles that break the soft, late-night mood (or are not a clean song): skipped in Romantic Hindi sessions. */
export const NOT_ROMANTIC_RE = /remix|\bdj\b|party|mashup|bass boosted|slowed|reverb|lofi|lo-fi|item song|\brap\b|\btrap\b|club|dance|workout|edm|\bhype\b/i;
