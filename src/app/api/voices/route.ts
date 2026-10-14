export async function GET() {
  const res = await fetch("https://api.elevenlabs.io/v2/voices?page_size=100", {
    headers: { "xi-api-key": process.env.ELEVENLABS_API_KEY ?? "" },
  });
  if (!res.ok) return Response.json({ error: `ElevenLabs ${res.status}` }, { status: 502 });
  const j = await res.json();
  const voices = (j.voices ?? []).map((v: { voice_id: string; name: string; category?: string; labels?: Record<string, string>; preview_url?: string }) => ({
    id: v.voice_id, name: v.name, category: v.category, labels: v.labels ?? {}, previewUrl: v.preview_url,
  }));
  return Response.json({ voices });
}
