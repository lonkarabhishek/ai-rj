// Server-only TTS providers: Azure Speech (primary), ElevenLabs (optional). Env is read per call.
import type { Energy, Language, ListenMode } from "./prefs";

export interface VoiceInfo {
  id: string;            // "azure:<ShortName>" or ElevenLabs voice id (no prefix, for backward compat)
  provider: "azure" | "elevenlabs";
  name: string;
  locale?: string;
  gender?: string;
  styles?: string[];
  labels: Record<string, string>;
  previewUrl?: string;
}

export const isAzureId = (id: string) => id.startsWith("azure:");
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
  ["en-US-AndrewMultilingualNeural", "Andrew (multilingual)", "en-US", "Male", []],
].map(([short, name, locale, gender, styles]) => ({
  id: `azure:${short}`, provider: "azure" as const, name: name as string, locale: locale as string, gender: gender as string,
  styles: styles as string[], labels: { gender: (gender as string).toLowerCase(), accent: localeLabel(locale as string) },
}));

function localeLabel(l: string) {
  return ({ "en-IN": "English (India)", "hi-IN": "Hindi", "mr-IN": "Marathi", "en-US": "Multilingual" } as Record<string, string>)[l] ?? l;
}

/** Best default Azure voice per RJ language (calm Indian female). */
export function defaultAzureVoice(lang: Language) {
  return lang === "hindi" ? "azure:hi-IN-SwaraNeural" : lang === "marathi" ? "azure:mr-IN-AarohiNeural" : "azure:en-IN-NeerjaNeural";
}

export async function listAzureVoices(): Promise<VoiceInfo[]> {
  if (!azureEnabled()) return [];
  try {
    const r = await fetch(`${azureBase()}/cognitiveservices/voices/list`, { headers: { "Ocp-Apim-Subscription-Key": azureKey()! } });
    if (!r.ok) throw new Error(String(r.status));
    const all = (await r.json()) as { ShortName: string; DisplayName: string; Locale: string; Gender: string; StyleList?: string[]; SecondaryLocaleList?: string[] }[];
    const live = all.filter((v) => ["hi-IN", "mr-IN", "en-IN"].includes(v.Locale) || (/Multilingual/.test(v.ShortName) && v.SecondaryLocaleList?.includes("hi-IN")) || (/Multilingual/.test(v.ShortName) && v.Locale === "en-US"))
      .map((v) => ({ id: `azure:${v.ShortName}`, provider: "azure" as const, name: v.DisplayName + (v.Locale === "hi-IN" ? " (Hindi)" : v.Locale === "mr-IN" ? " (Marathi)" : /Multilingual/.test(v.ShortName) ? " (multilingual)" : ""),
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
export const MODE_MOOD: Record<ListenMode, Mood> = { default: "cheerful", drive: "cheerful", gym: "hype", focus: "calm" };
const ENERGY_SHIFT: Record<Energy, number> = { chill: -5, balanced: 0, hype: 5 };
const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&apos;");

/** Mood (from the script writer, else the mode default) drives style/rate/pitch; energy nudges. Never slower than normal outside Focus/chill. */
export function buildSsml(text: string, shortName: string, energy: Energy = "balanced", mode: ListenMode = "default", styles: string[] = [], mood?: Mood) {
  const locale = shortName.split(/[-:]/).slice(0, 2).join("-");
  const m = MOOD[mood ?? MODE_MOOD[mode]] ?? MOOD.cheerful;
  let rate = m.rate + (ENERGY_SHIFT[energy] ?? 0);
  if (mode !== "focus" && energy !== "chill") rate = Math.max(rate, 4);
  if (mode === "gym") rate = Math.max(rate, 15);
  const style = m.styles.find((s) => styles.includes(s));
  const sign = (n: number) => (n >= 0 ? `+${n}%` : `${n}%`);
  const inner = `<prosody rate="${sign(rate)}" pitch="${sign(m.pitch)}">${esc(text)}</prosody>`;
  return `<speak version="1.0" xmlns="http://www.w3.org/2001/10/synthesis" xmlns:mstts="https://www.w3.org/2001/mstts" xml:lang="${locale}">` +
    `<voice name="${shortName}">${style ? `<mstts:express-as style="${style}" styledegree="${m.degree}">${inner}</mstts:express-as>` : inner}</voice></speak>`;
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

export class TtsError extends Error { constructor(public provider: string, public code: string, msg: string) { super(msg); } }

export async function azureTts(text: string, voiceId: string, energy: Energy, mode: ListenMode, mood?: Mood): Promise<ArrayBuffer> {
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
