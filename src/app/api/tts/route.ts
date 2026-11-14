import { guard, oneOf, readJson, str } from "@/lib/guard";
import { azureEnabled, azureTts, defaultAzureVoice, elevenEnabled, elevenTts, geminiTts, isAzureId, localEnabled, localTts, TtsError, voiceProvider, type Mood, type TtsProvider } from "@/lib/tts";
import { geminiTtsEnabled } from "@/lib/gemini";
import { ENERGIES, LANGUAGES, MODES, ROMANTIC_MODES, romanticVoice, type ListenMode } from "@/lib/prefs";

export const maxDuration = 30;
const EL_DEFAULT = "21m00Tcm4TlvDq8ikWAM"; // ElevenLabs premade "Rachel", present on every account
const ALL_MODES = [...MODES.map((m) => m.id), ...ROMANTIC_MODES.map((m) => m.id)] as ListenMode[];
/** Free first: Gemini's neural voice, then your own voice server, then the optional paid-capable providers. */
const ORDER: TtsProvider[] = ["gemini", "local", "azure", "elevenlabs"];

/**
 * Provider chain: the chosen voice's provider first, then the rest in ORDER, else 502 (the client falls back to the device's own voice).
 * Response header X-TTS-Provider says who spoke; X-TTS-Fallback lists failures along the way.
 */
export async function POST(req: Request) {
  const no = guard(req, "tts", 60); if (no) return no;
  const b = await readJson(req, 20_000);
  const clean = str(b?.text, 1500).trim();
  if (!b || !clean) return Response.json({ error: "text required" }, { status: 400 });
  const energy = oneOf(b.energy, ENERGIES, "balanced");
  const mode = oneOf(b.mode, ALL_MODES, "default");
  const language = oneOf(b.language, LANGUAGES.map((l) => l.id), "english");
  const mood = oneOf<Mood | "">(b.mood, ["hype", "cheerful", "warm", "calm"], "") || undefined;
  const voiceId = romanticVoice(mode) ?? str(b.voiceId, 120); // Romantic Hindi sessions always use their own voice (this session only)
  const chosen = voiceProvider(voiceId);

  const azureVoice = voiceId && isAzureId(voiceId) ? voiceId : defaultAzureVoice(romanticVoice(mode) ? "hindi" : language);
  const run: Record<TtsProvider, { on: boolean; go: () => Promise<{ audio: ArrayBuffer; mime: string }> }> = {
    gemini: { on: geminiTtsEnabled(), go: () => geminiTts(clean, voiceId, energy, mode, mood) },
    local: { on: localEnabled(), go: () => localTts(clean, voiceId, romanticVoice(mode) ? "hindi" : language, mood) },
    azure: { on: azureEnabled(), go: async () => ({ audio: await azureTts(clean, azureVoice, energy, mode, mood), mime: "audio/mpeg" }) },
    elevenlabs: { on: elevenEnabled(), go: async () => ({ audio: await elevenTts(clean, chosen === "elevenlabs" ? voiceId : EL_DEFAULT, energy), mime: "audio/mpeg" }) },
  };
  const order = chosen ? [chosen, ...ORDER.filter((p) => p !== chosen)] : ORDER;

  const failures: string[] = [];
  for (const p of order) {
    if (!run[p].on) { failures.push(`${p}:not_configured`); continue; }
    try {
      const { audio, mime } = await run[p].go();
      return new Response(audio, { headers: { "Content-Type": mime, "Cache-Control": "no-store", "X-TTS-Provider": p, "X-TTS-Fallback": failures.filter((f) => !f.endsWith("not_configured")).join(",") } });
    } catch (e) {
      failures.push(e instanceof TtsError ? `${e.provider}:${e.code}` : `${p}:error`);
    }
  }
  const configured = order.some((p) => run[p].on);
  const quota = failures.some((f) => f.endsWith("quota_exceeded"));
  return Response.json({
    error: !configured ? "No voice service is set up on this server" : quota ? "The free voice allowance is used up for now" : "No voice provider could speak",
    code: !configured ? "not_configured" : quota ? "quota_exceeded" : "all_failed", failures,
  }, { status: 502 });
}
