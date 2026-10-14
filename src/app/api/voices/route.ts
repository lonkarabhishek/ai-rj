import { azureEnabled, elevenEnabled, listAzureVoices, listElevenVoices } from "@/lib/tts";

export async function GET() {
  const [azure, eleven] = await Promise.all([listAzureVoices(), listElevenVoices()]);
  const voices = [...azure, ...eleven];
  if (!voices.length) return Response.json({ voices: [], providers: { azure: azureEnabled(), elevenlabs: elevenEnabled() }, error: "No voice provider available" }, { status: 502 });
  return Response.json({ voices, providers: { azure: azureEnabled(), elevenlabs: elevenEnabled() } });
}
