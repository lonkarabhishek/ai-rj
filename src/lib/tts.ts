// Server-only TTS providers. Free path: Gemini TTS (neural, small free daily allowance) and/or your own self-hosted voice server;
// optional: Azure Speech, ElevenLabs. When none can speak, the client falls back to the device's built-in voice. Env is read per call.
import { GEMINI_VOICES, GeminiError, geminiSpeech, geminiTtsEnabled } from "./gemini";
import { isRomantic, ROMANTIC_MODES, type Energy, type Language, type ListenMode } from "./prefs";

export interface VoiceInfo {
  id: string;            // "gemini:<Voice>", "local:<voice>", "azure:<ShortName>", "auto", "browser", or an ElevenLabs voice id (no prefix, for backward compat)
  provider: "gemini" | "local" | "azure" | "elevenlabs" | "system";
  name: string;
  locale?: string;
  gender?: string;
  styles?: string[];
  labels: Record<string, string>;
  previewUrl?: string;
}

export const isAzureId = (id: string) => id.startsWith("azure:");
export type TtsProvider = "gemini" | "local" | "azure" | "elevenlabs";
/** Which provider a saved voice id belongs to. Unknown / "auto" / empty = let the server choose. Un-prefixed ids are legacy ElevenLabs ids. */
export function voiceProvider(id?: string | null): TtsProvider | null {
  if (!id || id === "auto" || id === "browser") return null;
  if (id.startsWith("gemini:")) return "gemini";
  if (id.startsWith("local:")) return "local";
  if (id.startsWith("azure:")) return "azure";
  return /^[A-Za-z0-9]{16,40}$/.test(id) ? "elevenlabs" : null; // anything else (e.g. an old bare Azure name) is treated as "auto"
}
const azureKey = () => process.env.AZURE_SPEECH_KEY;
const azureRegion = () => process.env.AZURE_SPEECH_REGION || "centralindia";
// Test hook: lets us point at a mock server. Not needed in production.
const azureBase = () => process.env.AZURE_TTS_BASE || `https://${azureRegion()}.tts.speech.microsoft.com`;
export const azureEnabled = () => !!azureKey();
export const elevenEnabled = () => !!process.env.ELEVENLABS_API_KEY;

/** Curated Indian voices, used when the live list can't be fetched. Calm female first = default. */
export const AZURE_CURATED: VoiceInfo[] = [
  ["en-IN-NeerjaNeural", "Neerja", "en-IN", "Female", ["newscast", "cheerful", "empathetic"]],
  ["hi-IN-SwaraNeural", "Swara", "hi-IN", "Female", ["newscast", "cheerful", "empathetic"]],
  ["en-IN-PrabhatNeural", "Prabhat", "en-IN", "Male", []],
  ["hi-IN-MadhurNeural", "Madhur", "hi-IN", "Male", []],
  ["en-IN-AartiNeural", "Aarti", "en-IN", "Female", []],
  ["en-IN-ArjunNeural", "Arjun", "en-IN", "Male", []],
  ["hi-IN-AartiNeural", "Aarti (Hindi)", "hi-IN", "Female", []],
  ["hi-IN-ArjunNeural", "Arjun (Hindi)", "hi-IN", "Male", []],
  ["mr-IN-AarohiNeural", "Aarohi", "mr-IN", "Female", []],
  ["mr-IN-ManoharNeural", "Manohar", "mr-IN", "Male", []],
  ["en-US-AvaMultilingualNeural", "Ava (multilingual)", "en-US", "Female", []],
  ["es-MX-DaliaNeural", "Dalia (Spanish)", "es-MX", "Female", []],
  ["es-MX-JorgeNeural", "Jorge (Spanish)", "es-MX", "Male", []],
  ["en-US-AndrewMultilingualNeural", "Andrew (multilingual)", "en-US", "Male", []],
].map(([short, name, locale, gender, styles]) => ({
  id: `azure:${short}`, provider: "azure" as const, name: name as string, locale: locale as string, gender: gender as string,
  styles: styles as string[], labels: { gender: (gender as string).toLowerCase(), accent: localeLabel(locale as string) },
}));

function localeLabel(l: string) {
  return ({ "en-IN": "English (India)", "hi-IN": "Hindi", "mr-IN": "Marathi", "en-US": "English (US)", "es-MX": "Spanish (Mexico)", "es-US": "Spanish (US)" } as Record<string, string>)[l] ?? l;
}

/** Best default Azure voice per RJ language (calm Indian female). */
export function defaultAzureVoice(lang: Language) {
  return lang === "hindi" ? "azure:hi-IN-SwaraNeural" : lang === "marathi" ? "azure:mr-IN-AarohiNeural" : lang === "spanish" ? "azure:es-MX-DaliaNeural" : lang === "english" ? "azure:en-US-AvaMultilingualNeural" : "azure:en-IN-NeerjaNeural";
}

export async function listAzureVoices(): Promise<VoiceInfo[]> {
  if (!azureEnabled()) return [];
  try {
    const r = await fetch(`${azureBase()}/cognitiveservices/voices/list`, { headers: { "Ocp-Apim-Subscription-Key": azureKey()! } });
    if (!r.ok) throw new Error(String(r.status));
    const all = (await r.json()) as { ShortName: string; DisplayName: string; Locale: string; Gender: string; StyleList?: string[]; SecondaryLocaleList?: string[] }[];
    const live = all.filter((v) => ["hi-IN", "mr-IN", "en-IN", "es-MX", "es-US"].includes(v.Locale) || (/Multilingual/.test(v.ShortName) && v.SecondaryLocaleList?.includes("hi-IN")) || (/Multilingual/.test(v.ShortName) && v.Locale === "en-US"))
      .map((v) => ({ id: `azure:${v.ShortName}`, provider: "azure" as const, name: v.DisplayName + (v.Locale.startsWith("es-") ? " (Spanish)" : v.Locale === "hi-IN" ? " (Hindi)" : v.Locale === "mr-IN" ? " (Marathi)" : /Multilingual/.test(v.ShortName) ? " (multilingual)" : ""),
        locale: v.Locale, gender: v.Gender, styles: v.StyleList ?? [], labels: { gender: v.Gender.toLowerCase(), accent: localeLabel(v.Locale) } }));
    // keep curated ordering first (so Neerja stays default), then the rest
    const order = AZURE_CURATED.map((c) => c.id);
    return live.sort((a, b) => (order.indexOf(a.id) + 1 || 999) - (order.indexOf(b.id) + 1 || 999));
  } catch {
    return AZURE_CURATED;
  }
}

export async function listElevenVoices(): Promise<VoiceInfo[]> {
  if (!elevenEnabled()) return [];
  try {
    const res = await fetch("https://api.elevenlabs.io/v2/voices?page_size=100", { headers: { "xi-api-key": process.env.ELEVENLABS_API_KEY! } });
    if (!res.ok) return [];
    const j = await res.json();
    return (j.voices ?? []).map((v: { voice_id: string; name: string; labels?: Record<string, string>; preview_url?: string }) => ({
      id: v.voice_id, provider: "elevenlabs" as const, name: v.name, labels: v.labels ?? {}, previewUrl: v.preview_url,
    }));
  } catch { return []; }
}

// ---------- SSML ----------
export type Mood = "hype" | "cheerful" | "warm" | "calm";
const MOOD: Record<Mood, { rate: number; pitch: number; styles: string[]; degree: number }> = {
  hype: { rate: 18, pitch: 6, styles: ["excited", "cheerful", "happy", "joyful"], degree: 1.4 },
  cheerful: { rate: 10, pitch: 3, styles: ["cheerful", "friendly", "happy", "joyful"], degree: 1.2 },
  warm: { rate: 7, pitch: 1, styles: ["friendly", "cheerful", "empathetic", "hopeful"], degree: 0.9 },
  calm: { rate: -4, pitch: -1, styles: ["calm", "gentle", "softvoice", "empathetic"], degree: 0.8 },
};
export const MODE_MOOD: Record<ListenMode, Mood> = { default: "cheerful", drive: "cheerful", gym: "hype", focus: "calm", romantic_m: "calm", romantic_f: "calm", romantic_s: "calm" };
const ENERGY_SHIFT: Record<Energy, number> = { chill: -5, balanced: 0, hype: 5 };
const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&apos;");

/** Mood (from the script writer, else the mode default) drives style/rate/pitch; energy nudges. Never slower than normal outside Focus/chill. */
export function buildSsml(text: string, shortName: string, energy: Energy = "balanced", mode: ListenMode = "default", styles: string[] = [], mood?: Mood) {
  const locale = shortName.split(/[-:]/).slice(0, 2).join("-");
  const m = MOOD[mood ?? MODE_MOOD[mode]] ?? MOOD.cheerful;
  let rate = m.rate + (ENERGY_SHIFT[energy] ?? 0);
  if (mode !== "focus" && energy !== "chill") rate = Math.max(rate, 4);
  if (mode === "gym") rate = Math.max(rate, 15);
  let pitch = m.pitch;
  let style = m.styles.find((s) => styles.includes(s));
  let degree = m.degree;
  if (isRomantic(mode)) {
    // Romantic Hindi: slow, low and intimate. Style only when this voice's StyleList really has it.
    // MAI voices already speak slowly (they run ~40% longer than classic neural), so only a gentle slowdown there.
    const mai = /MAI-Voice/.test(shortName);
    rate = mai ? (mode === "romantic_f" ? 8 : -8) : -10;
    pitch = mode === "romantic_f" ? -3 : -5; // Masculine and Sensual share the deep voice
    style = mode === "romantic_f" ? ["softvoice", "gentle", "affectionate", "calm"].find((x) => styles.includes(x)) : undefined;
    degree = 1;
  }
  const sign = (n: number) => (n >= 0 ? `+${n}%` : `${n}%`);
  const inner = `<prosody rate="${sign(rate)}" pitch="${sign(pitch)}">${esc(text)}</prosody>`;
  return `<speak version="1.0" xmlns="http://www.w3.org/2001/10/synthesis" xmlns:mstts="https://www.w3.org/2001/mstts" xml:lang="${locale}">` +
    `<voice name="${shortName}">${style ? `<mstts:express-as style="${style}" styledegree="${degree}">${inner}</mstts:express-as>` : inner}</voice></speak>`;
}

// live style lists (cached), so styles work for any voice that supports them
let styleCache: { at: number; map: Map<string, string[]> } | null = null;
async function stylesFor(short: string): Promise<string[]> {
  if (!styleCache || Date.now() - styleCache.at > 6 * 3600_000) {
    try {
      const r = await fetch(`${azureBase()}/cognitiveservices/voices/list`, { headers: { "Ocp-Apim-Subscription-Key": azureKey()! } });
      const all = r.ok ? ((await r.json()) as { ShortName: string; StyleList?: string[] }[]) : [];
      styleCache = { at: Date.now(), map: new Map(all.map((v) => [v.ShortName, v.StyleList ?? []])) };
    } catch { styleCache = { at: Date.now() - 5.9 * 3600_000, map: new Map() }; }
  }
  return styleCache.map.get(short) ?? AZURE_CURATED.find((v) => v.id === `azure:${short}`)?.styles ?? [];
}

// ---------- Gemini TTS (free tier) ----------
const GEMINI_STYLE: Record<Mood, string> = {
  hype: "High-energy radio host firing up the listener: bright, punchy and grinning, quick pace, a real person on a live mic, never shouting.",
  cheerful: "Upbeat, friendly radio host with a smile in the voice: conversational, easy pace, natural little pauses between thoughts.",
  warm: "Warm, heartfelt radio host talking to one close friend: relaxed pace, gentle emphasis, unhurried pauses.",
  calm: "Soft, calm late-night radio voice: slow, quiet and soothing, long relaxed pauses.",
};
/** Delivery direction for the voice model: mood first, then mode and energy nudges. The transcript itself is never changed. */
export function geminiStyle(mood: Mood | undefined, mode: ListenMode, energy: Energy): string {
  if (isRomantic(mode)) return mode === "romantic_f"
    ? "Intimate late-night Hindi radio host: soft, sultry and unhurried, close to the microphone, tender pauses."
    : "Intimate late-night Hindi radio host: deep, slow and confident, close to the microphone, long pauses.";
  const m = mood && GEMINI_STYLE[mood] ? mood : MODE_MOOD[mode] ?? "cheerful";
  const nudge = mode === "gym" ? " Gym-floor coach energy." : mode === "focus" ? " Barely above a murmur, so it never breaks concentration." : mode === "drive" ? " Road-trip buddy riding along." : "";
  const en = energy === "chill" && m !== "calm" ? " Keep it mellow." : energy === "hype" && m !== "hype" ? " A little extra spark." : "";
  return GEMINI_STYLE[m] + nudge + en;
}
/** Default Gemini voice per session type (the listener can pick any other in Settings). */
export function defaultGeminiVoice(mode: ListenMode = "default"): string {
  return mode === "romantic_f" ? "Despina" : isRomantic(mode) ? "Algieba" : "Sulafat";
}
export const geminiVoiceList = (): VoiceInfo[] => geminiTtsEnabled() ? GEMINI_VOICES.map((v) => ({
  id: `gemini:${v.name}`, provider: "gemini" as const, name: v.name, gender: v.gender, labels: { gender: v.gender, accent: v.tone, age: "follows your language" },
})) : [];
export async function geminiTts(text: string, voiceId: string | undefined, energy: Energy, mode: ListenMode, mood?: Mood): Promise<{ audio: ArrayBuffer; mime: string }> {
  if (!geminiTtsEnabled()) throw new TtsError("gemini", "not_configured", "Gemini TTS not set up");
  const asked = voiceId?.startsWith("gemini:") ? voiceId.slice(7) : "";
  const voice = GEMINI_VOICES.some((v) => v.name === asked) ? asked : defaultGeminiVoice(mode);
  try { return await geminiSpeech(text, voice, geminiStyle(mood, mode, energy), 20000); }
  catch (e) {
    const code = e instanceof GeminiError ? e.code : "error";
    throw new TtsError("gemini", code === "quota_exhausted" || code === "rate_limited" ? "quota_exceeded" : code, e instanceof GeminiError ? e.message : "Gemini TTS failed");
  }
}

// ---------- Self-hosted voice server (free, unlimited): any OpenAI-compatible /v1/audio/speech endpoint, e.g. Kokoro-FastAPI or a Piper wrapper ----------
const localUrl = () => (process.env.LOCAL_TTS_URL ?? "").replace(/\/+$/, "");
export const localEnabled = () => /^https?:\/\//.test(localUrl());
const localVoices = () => (process.env.LOCAL_TTS_VOICES ?? "").split(",").map((x) => x.trim()).filter(Boolean);
/** LOCAL_TTS_VOICE is the default; LOCAL_TTS_VOICE_ES / _HI / _MR / _EN override it per RJ language. */
function localVoiceFor(language: Language): string {
  const k = language === "spanish" ? "ES" : language === "hindi" || language === "hinglish" ? "HI" : language === "marathi" ? "MR" : "EN";
  return process.env[`LOCAL_TTS_VOICE_${k}`] || process.env.LOCAL_TTS_VOICE || "af_heart";
}
export const localVoiceList = (): VoiceInfo[] => localEnabled() ? [...new Set([process.env.LOCAL_TTS_VOICE || "af_heart", ...localVoices()])].map((v) => ({
  id: `local:${v}`, provider: "local" as const, name: v, labels: { accent: "self-hosted" },
})) : [];
export async function localTts(text: string, voiceId: string | undefined, language: Language, mood?: Mood): Promise<{ audio: ArrayBuffer; mime: string }> {
  if (!localEnabled()) throw new TtsError("local", "not_configured", "LOCAL_TTS_URL not set");
  const voice = voiceId?.startsWith("local:") ? voiceId.slice(6).replace(/[^\w.+-]/g, "").slice(0, 60) : localVoiceFor(language);
  const speed = mood === "hype" ? 1.08 : mood === "calm" ? 0.92 : 1;
  const r = await fetch(`${localUrl()}/v1/audio/speech`, {
    method: "POST", signal: AbortSignal.timeout(Number(process.env.LOCAL_TTS_TIMEOUT_MS ?? 15000)),
    headers: { "Content-Type": "application/json", ...(process.env.LOCAL_TTS_API_KEY ? { Authorization: `Bearer ${process.env.LOCAL_TTS_API_KEY}` } : {}) },
    body: JSON.stringify({ model: process.env.LOCAL_TTS_MODEL || "kokoro", input: text, voice, response_format: "mp3", speed }),
  }).catch(() => null);
  if (!r?.ok) throw new TtsError("local", r ? `http_${r.status}` : "network", `Voice server ${r?.status ?? "unreachable"}`);
  const audio = await r.arrayBuffer();
  if (audio.byteLength < 200) throw new TtsError("local", "empty", "Voice server returned no audio");
  const ct = (r.headers.get("content-type") ?? "").split(";")[0];
  return { audio, mime: /^audio\//.test(ct) ? ct : "audio/mpeg" };
}

export class TtsError extends Error { constructor(public provider: string, public code: string, msg: string) { super(msg); } }

export async function azureTts(text: string, voiceId: string, energy: Energy, mode: ListenMode, mood?: Mood): Promise<ArrayBuffer> {
  try { return await azureTtsOnce(text, voiceId, energy, mode, mood); }
  catch (e) {
    // Romantic presets use newer MAI voices: if one is unavailable in the region, fall back to a classic hi-IN neural voice.
    const fb = ROMANTIC_MODES.find((x) => x.voiceId === voiceId)?.fallbackVoiceId;
    if (fb && e instanceof TtsError && e.code !== "not_configured") return azureTtsOnce(text, fb, energy, mode, mood);
    throw e;
  }
}
async function azureTtsOnce(text: string, voiceId: string, energy: Energy, mode: ListenMode, mood?: Mood): Promise<ArrayBuffer> {
  if (!azureEnabled()) throw new TtsError("azure", "not_configured", "Azure Speech key not set");
  const short = voiceId.replace(/^azure:/, "");
  const styles = await stylesFor(short);
  let last: TtsError | null = null;
  for (let attempt = 0; attempt < 2; attempt++) {
    const r = await fetch(`${azureBase()}/cognitiveservices/v1`, {
      method: "POST",
      headers: {
        "Ocp-Apim-Subscription-Key": azureKey()!, "Content-Type": "application/ssml+xml",
        "X-Microsoft-OutputFormat": "audio-24khz-96kbitrate-mono-mp3", "User-Agent": "MyRJ",
      },
      body: buildSsml(text, short, energy, mode, styles, mood),
    }).catch(() => null);
    if (r?.ok) return r.arrayBuffer();
    last = new TtsError("azure", r ? `http_${r.status}` : "network", `Azure ${r?.status ?? "network error"}`);
    if (r && r.status < 500 && r.status !== 429) break;
    await new Promise((res) => setTimeout(res, 700));
  }
  throw last!;
}

const EL_SETTINGS = {
  chill: { stability: 0.7, similarity_boost: 0.75, style: 0.1 },
  balanced: { stability: 0.5, similarity_boost: 0.75, style: 0.3 },
  hype: { stability: 0.3, similarity_boost: 0.8, style: 0.65 },
} as const;

export async function elevenTts(text: string, voiceId: string, energy: Energy): Promise<ArrayBuffer> {
  if (!elevenEnabled()) throw new TtsError("elevenlabs", "not_configured", "ElevenLabs key not set");
  let res: Response | null = null;
  for (let attempt = 0; attempt < 3; attempt++) {
    res = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${encodeURIComponent(voiceId)}?output_format=mp3_44100_128`, {
      method: "POST",
      headers: { "xi-api-key": process.env.ELEVENLABS_API_KEY!, "Content-Type": "application/json", Accept: "audio/mpeg" },
      body: JSON.stringify({ text, model_id: "eleven_multilingual_v2", voice_settings: { ...(EL_SETTINGS[energy] ?? EL_SETTINGS.balanced), use_speaker_boost: true } }),
    }).catch(() => null);
    if (res && (res.ok || (res.status < 500 && res.status !== 429))) break;
    await new Promise((r) => setTimeout(r, 800 * (attempt + 1)));
  }
  if (res?.ok) return res.arrayBuffer();
  const detail = res ? (await res.text()).slice(0, 400) : "";
  const code = detail.match(/"code":"([a-z_]+)"/)?.[1] ?? detail.match(/"status":"([a-z_]+)"/)?.[1] ?? (res ? `http_${res.status}` : "network");
  throw new TtsError("elevenlabs", code, code === "quota_exceeded" ? "ElevenLabs credits used up" : `ElevenLabs ${res?.status ?? "network error"}`);
}
