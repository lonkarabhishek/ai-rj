import { azureEnabled, azureTts, defaultAzureVoice, elevenEnabled, elevenTts, isAzureId, TtsError, type Mood } from "@/lib/tts";
import type { Energy, Language, ListenMode } from "@/lib/prefs";

const EL_DEFAULT = "21m00Tcm4TlvDq8ikWAM"; // ElevenLabs premade "Rachel", present on every account

/**
 * Provider chain: the chosen voice's provider first, then the other one, else 502 (client falls back to the browser voice).
 * Response header X-TTS-Provider says who spoke; X-TTS-Fallback lists failures along the way.
 */
export async function POST(req: Request) {
  const { text, voiceId, energy = "balanced", mode = "default", language = "english", mood } =
    (await req.json()) as { text: string; voiceId?: string; energy?: Energy; mode?: ListenMode; language?: Language; mood?: Mood };
  if (!text) return Response.json({ error: "text required" }, { status: 400 });
  const clean = String(text).slice(0, 1500);

  const attempts: { provider: string; run: () => Promise<ArrayBuffer> }[] = [];
  const azureVoice = voiceId && isAzureId(voiceId) ? voiceId : defaultAzureVoice(language);
  const elVoice = voiceId && !isAzureId(voiceId) ? voiceId : EL_DEFAULT;
  const azure = { provider: "azure", run: () => azureTts(clean, azureVoice, energy, mode, mood) };
  const eleven = { provider: "elevenlabs", run: () => elevenTts(clean, elVoice, energy) };
  if (voiceId && !isAzureId(voiceId)) attempts.push(eleven, azure); else attempts.push(azure, eleven);

  const failures: string[] = [];
  for (const a of attempts) {
    if (a.provider === "azure" && !azureEnabled()) { failures.push("azure:not_configured"); continue; }
    if (a.provider === "elevenlabs" && !elevenEnabled()) { failures.push("elevenlabs:not_configured"); continue; }
    try {
      const audio = await a.run();
      return new Response(audio, { headers: { "Content-Type": "audio/mpeg", "Cache-Control": "no-store", "X-TTS-Provider": a.provider, "X-TTS-Fallback": failures.join(",") } });
    } catch (e) {
      failures.push(e instanceof TtsError ? `${e.provider}:${e.code}` : `${a.provider}:error`);
    }
  }
  const quota = failures.some((f) => f.endsWith("quota_exceeded"));
  return Response.json({
    error: quota && !azureEnabled() ? "ElevenLabs credits used up and Azure Speech isn't set up" : "No voice provider could speak",
    code: quota ? "quota_exceeded" : "all_failed", failures,
  }, { status: 502 });
}
