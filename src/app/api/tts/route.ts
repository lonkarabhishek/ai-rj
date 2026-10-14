const SETTINGS = {
  chill: { stability: 0.7, similarity_boost: 0.75, style: 0.1 },
  balanced: { stability: 0.5, similarity_boost: 0.75, style: 0.3 },
  hype: { stability: 0.3, similarity_boost: 0.8, style: 0.65 },
} as const;

export async function POST(req: Request) {
  const { text, voiceId, energy = "balanced" } = await req.json();
  if (!text || !voiceId) return Response.json({ error: "text and voiceId required" }, { status: 400 });
  let res: Response | null = null;
  for (let attempt = 0; attempt < 3; attempt++) {
    res = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${encodeURIComponent(voiceId)}?output_format=mp3_44100_128`, {
    method: "POST",
    headers: { "xi-api-key": process.env.ELEVENLABS_API_KEY ?? "", "Content-Type": "application/json", Accept: "audio/mpeg" },
    body: JSON.stringify({
      text: String(text).slice(0, 1500),
      model_id: "eleven_multilingual_v2",
      voice_settings: { ...(SETTINGS[energy as keyof typeof SETTINGS] ?? SETTINGS.balanced), use_speaker_boost: true },
    }),
    }).catch(() => null as unknown as Response);
    if (res && (res.ok || (res.status < 500 && res.status !== 429))) break;
    await new Promise((r) => setTimeout(r, 800 * (attempt + 1)));
  }
  if (!res) return Response.json({ error: "ElevenLabs unreachable" }, { status: 502 });
  if (!res.ok) {
    const detail = (await res.text()).slice(0, 400);
    const code = detail.match(/"code":"([a-z_]+)"/)?.[1] ?? detail.match(/"status":"([a-z_]+)"/)?.[1] ?? `http_${res.status}`;
    return Response.json({ error: code === "quota_exceeded" ? "ElevenLabs credits used up" : `ElevenLabs ${res.status}`, code, detail }, { status: 502 });
  }
  return new Response(res.body, { headers: { "Content-Type": "audio/mpeg", "Cache-Control": "no-store" } });
}
