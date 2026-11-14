import { geminiTtsEnabled } from "@/lib/gemini";
import { guard } from "@/lib/guard";
import { azureEnabled, elevenEnabled, geminiVoiceList, listAzureVoices, listElevenVoices, localEnabled, localVoiceList, type VoiceInfo } from "@/lib/tts";

/** Always answers 200 with at least the two built-in choices, so the picker works with no voice service at all. */
export async function GET(req: Request) {
  const no = guard(req, "voices", 120); if (no) return no;
  const [azure, eleven] = await Promise.all([listAzureVoices(), listElevenVoices()]);
  const system: VoiceInfo[] = [
    { id: "auto", provider: "system", name: "Automatic", labels: { accent: "best voice available, your device's voice as backup" } },
    { id: "browser", provider: "system", name: "This device's voice", labels: { accent: "free, works offline, less natural" } },
  ];
  const voices = [...system, ...geminiVoiceList(), ...localVoiceList(), ...azure, ...eleven];
  return Response.json({ voices, providers: { gemini: geminiTtsEnabled(), local: localEnabled(), azure: azureEnabled(), elevenlabs: elevenEnabled() } });
}
