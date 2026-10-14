const SETTINGS = {
  chill: { stability: 0.7, similarity_boost: 0.75, style: 0.1 },
  balanced: { stability: 0.5, similarity_boost: 0.75, style: 0.3 },
  hype: { stability: 0.3, similarity_boost: 0.8, style: 0.65 },
} as const;

export async function POST(req: Request) {
  const { text, voiceId, energy = "balanced" } = await req.json();
  if (!text || !voiceId) return Response.json({ error: "text and voiceId required" }, { status: 400 });
  const res = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${encodeURIComponent(voiceId)}?output_format=mp3_44100_128`, {
    method: "POST",
    headers: { "xi-api-key": process.env.ELEVENLABS_API_KEY ?? "", "Content-Type": "application/json", Accept: "audio/mpeg" },
    body: JSON.stringify({
      text: String(text).slice(0, 1500),
      model_id: "eleven_multilingual_v2",
      voice_settings: { ...(SETTINGS[energy as keyof typeof SETTINGS] ?? SETTINGS.balanced), use_speaker_boost: true },
    }),
  });
  if (!res.ok) return Response.json({ error: `ElevenLabs ${res.status}`, detail: (await res.text()).slice(0, 300) }, { status: 502 });
  return new Response(res.body, { headers: { "Content-Type": "audio/mpeg", "Cache-Control": "no-store" } });
}
