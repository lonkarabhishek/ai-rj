// Server-only Google Gemini client (free-tier friendly). The key never leaves the server: it is sent in a header, never in a URL or a log line.
// Docs: https://ai.google.dev/gemini-api/docs  ·  Free-tier limits are per project and shown in AI Studio (they are not guaranteed).

/** Default text model: Flash-Lite has the roomiest free allowance (a radio makes one request per break). */
export const GEMINI_TEXT_DEFAULT = "gemini-3.5-flash-lite";
/** Default voice models, tried in order (each has its own small free daily allowance). */
export const GEMINI_TTS_DEFAULT = ["gemini-3.8-flash-lite-tts", "gemini-3.8-flash-tts"];

const key = () => process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY || "";
// Test hook (like AZURE_TTS_BASE): lets the tests point at a mock server. Not needed in production.
const base = () => (process.env.GEMINI_API_BASE || "https://generativelanguage.googleapis.com").replace(/\/+$/, "");
export const geminiEnabled = () => !!key();
export const geminiTextModels = () => [...new Set([process.env.GEMINI_MODEL_FULL, process.env.GEMINI_MODEL || GEMINI_TEXT_DEFAULT].filter((x): x is string => !!x))];
export const geminiFastModel = () => process.env.GEMINI_MODEL || GEMINI_TEXT_DEFAULT;
export const geminiTtsModels = () => {
  const list = (process.env.GEMINI_TTS_MODELS ?? "").split(",").map((s) => s.trim()).filter(Boolean);
  return list.length ? list : GEMINI_TTS_DEFAULT;
};
export const geminiTtsEnabled = () => geminiEnabled() && process.env.GEMINI_TTS !== "off";

export type GeminiErrorCode = "not_configured" | "rate_limited" | "quota_exhausted" | "timeout" | "network" | "blocked" | "bad_request" | "auth" | "server" | "empty";
export class GeminiError extends Error {
  constructor(public code: GeminiErrorCode, public model: string, msg: string, public status = 0) { super(msg); }
}

// ---- cooldowns: a model that answered 429 is skipped until its limit can have reset (per server instance; best effort on serverless) ----
const cool = new Map<string, { until: number; code: GeminiErrorCode }>();
export function geminiCooling(model: string): GeminiErrorCode | null {
  const c = cool.get(model);
  if (!c) return null;
  if (Date.now() >= c.until) { cool.delete(model); return null; }
  return c.code;
}
export function resetGeminiCooldowns() { cool.clear(); }

type Part = { text?: string; inlineData?: { mimeType?: string; data?: string }; speech_metadata?: { style?: string } };
type Body = { candidates?: { content?: { parts?: Part[] }; finishReason?: string }[]; promptFeedback?: { blockReason?: string }; error?: { message?: string; status?: string; details?: unknown[] } };

/** Per-day limits wait for the daily reset (we re-probe hourly); per-minute limits clear in about a minute. */
function classify429(model: string, raw: string, retryAfter: string | null): GeminiError {
  const daily = /PerDay|per day|daily/i.test(raw);
  const hinted = Number(retryAfter) || Number(raw.match(/"retryDelay"\s*:\s*"(\d+)/)?.[1]) || 0;
  const code: GeminiErrorCode = daily ? "quota_exhausted" : "rate_limited";
  const ms = daily ? 60 * 60_000 : Math.min(10 * 60_000, Math.max(20_000, hinted * 1000 + 2000 || 65_000));
  cool.set(model, { until: Date.now() + ms, code });
  return new GeminiError(code, model, daily ? `Gemini free daily quota used up for ${model}` : `Gemini rate limit hit for ${model}`, 429);
}

async function call(model: string, body: unknown, timeoutMs: number): Promise<Body> {
  const k = key();
  if (!k) throw new GeminiError("not_configured", model, "GEMINI_API_KEY is not set");
  if (!/^[\w.-]{3,80}$/.test(model)) throw new GeminiError("bad_request", model, "invalid Gemini model id");
  const cooling = geminiCooling(model);
  if (cooling) throw new GeminiError(cooling, model, `Gemini ${model} is cooling down after a 429`, 429);
  let res: Response;
  try {
    res = await fetch(`${base()}/v1beta/models/${model}:generateContent`, {
      method: "POST", signal: AbortSignal.timeout(Math.max(1000, timeoutMs)),
      headers: { "x-goog-api-key": k, "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
  } catch (e) {
    const name = (e as Error)?.name ?? "";
    throw new GeminiError(/Timeout|Abort/i.test(name) ? "timeout" : "network", model, /Timeout|Abort/i.test(name) ? `Gemini ${model} timed out` : `Gemini ${model} network error`);
  }
  if (res.ok) return (await res.json().catch(() => ({}))) as Body;
  const raw = (await res.text().catch(() => "")).slice(0, 2000);
  if (res.status === 429) throw classify429(model, raw, res.headers.get("retry-after"));
  if (res.status === 401 || res.status === 403) throw new GeminiError("auth", model, `Gemini rejected the API key or the model isn't available to this project (${res.status})`, res.status);
  if (res.status >= 500) { cool.set(model, { until: Date.now() + 15_000, code: "rate_limited" }); throw new GeminiError("server", model, `Gemini ${model} server error ${res.status}`, res.status); }
  // 400/404: bad request or unknown model. Only the status and Google's short status word are kept (never the request, never the key).
  const status = raw.match(/"status"\s*:\s*"([A-Z_]+)"/)?.[1] ?? "";
  throw new GeminiError("bad_request", model, `Gemini ${model} refused the request (${res.status}${status ? ` ${status}` : ""})`, res.status);
}

export interface GeminiTextOpts {
  system?: string;
  user: string;
  images?: { mimeType: string; data: string }[]; // base64
  model?: string;
  timeoutMs?: number;
  maxOutputTokens?: number;
  temperature?: number;
  json?: boolean;
}

/** One text answer from one model. Throws GeminiError (with a code the caller can act on). */
export async function geminiText(o: GeminiTextOpts): Promise<string> {
  const model = o.model || geminiFastModel();
  const parts: Record<string, unknown>[] = [...(o.images ?? []).map((i) => ({ inlineData: { mimeType: i.mimeType, data: i.data } })), { text: o.user }];
  const j = await call(model, {
    ...(o.system ? { systemInstruction: { parts: [{ text: o.system }] } } : {}),
    contents: [{ role: "user", parts }],
    generationConfig: { temperature: o.temperature ?? 1, maxOutputTokens: o.maxOutputTokens ?? 2048, ...(o.json ? { responseMimeType: "application/json" } : {}) },
  }, o.timeoutMs ?? 8000);
  if (j.promptFeedback?.blockReason) throw new GeminiError("blocked", model, `Gemini blocked the prompt (${j.promptFeedback.blockReason})`);
  const c = j.candidates?.[0];
  const text = (c?.content?.parts ?? []).map((p) => p.text ?? "").join("").trim();
  if (!text) throw new GeminiError(c?.finishReason === "SAFETY" || c?.finishReason === "PROHIBITED_CONTENT" ? "blocked" : "empty", model, `Gemini returned no text (${c?.finishReason ?? "no candidate"})`);
  return text;
}

/** Tries each model in order within one time budget. Null when none answered (the caller falls back). `onError` sees every failure. */
export async function geminiTextChain(o: Omit<GeminiTextOpts, "model" | "timeoutMs">, models = geminiTextModels(), budgetMs = 9000, onError?: (e: GeminiError) => void): Promise<{ text: string; model: string } | null> {
  const t0 = Date.now();
  for (const [i, model] of models.entries()) {
    const left = budgetMs - (Date.now() - t0);
    if (left < 1500) break;
    try {
      const last = i === models.length - 1;
      return { text: await geminiText({ ...o, model, timeoutMs: last ? left : Math.max(1500, Math.min(left - 2500, left * 0.65)) }), model };
    } catch (e) {
      const ge = e instanceof GeminiError ? e : new GeminiError("network", model, "Gemini call failed");
      onError?.(ge);
      if (ge.code === "not_configured" || ge.code === "auth") break; // the next model would fail the same way
    }
  }
  return null;
}

export interface GeminiSpeech { audio: ArrayBuffer; mime: string; model: string }

/** Prebuilt Gemini voices used as radio-host personas (name → character, from Google's voice list). */
export const GEMINI_VOICES: { name: string; gender: "female" | "male"; tone: string }[] = [
  { name: "Sulafat", gender: "female", tone: "warm" },
  { name: "Achird", gender: "male", tone: "friendly" },
  { name: "Aoede", gender: "female", tone: "breezy" },
  { name: "Puck", gender: "male", tone: "upbeat" },
  { name: "Laomedeia", gender: "female", tone: "upbeat" },
  { name: "Algieba", gender: "male", tone: "smooth" },
  { name: "Despina", gender: "female", tone: "smooth" },
  { name: "Fenrir", gender: "male", tone: "excitable" },
  { name: "Vindemiatrix", gender: "female", tone: "gentle" },
  { name: "Gacrux", gender: "female", tone: "mature" },
  { name: "Charon", gender: "male", tone: "informative" },
  { name: "Enceladus", gender: "male", tone: "breathy" },
];

/**
 * Text to speech with a Gemini TTS model. The transcript is spoken verbatim; delivery (warmth, pace, energy) goes in `style`.
 * Returns WAV (24 kHz mono by default; 16 kHz for long clips so the response stays well under serverless size limits).
 */
export async function geminiSpeech(text: string, voice: string, style: string, timeoutMs = 20000): Promise<GeminiSpeech> {
  const models = geminiTtsModels();
  const t0 = Date.now();
  let last: GeminiError | null = null;
  for (const model of models) {
    const left = timeoutMs - (Date.now() - t0);
    if (left < 3000) break;
    try {
      // Gemini 3.8 TTS takes the delivery direction as structured metadata. The earlier preview models (2.5, 3.1) use the older
      // request shape, where the direction is a short lead-in before the transcript. If the newer shape is refused (400), the
      // older one is tried once, so a schema change on Google's side degrades to "still speaks" instead of "silent".
      const modern = {
        contents: [{ role: "user", parts: [{ text, ...(style ? { speech_metadata: { style: style.slice(0, 300) } } : {}) }] }],
        generationConfig: {
          responseModalities: ["AUDIO"],
          speechConfig: { voiceConfig: { voice } },
          responseFormat: { audio: { mimeType: "AUDIO_WAV", sampleRate: text.length > 600 ? 16000 : 24000 } },
        },
      };
      const legacy = {
        contents: [{ role: "user", parts: [{ text: style ? `Say this as: ${style.slice(0, 200)}\n\n${text}` : text }] }],
        generationConfig: { responseModalities: ["AUDIO"], speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: voice } } } },
      };
      const old = /-(2\.5|3\.1)-/.test(model);
      let j: Body;
      try { j = await call(model, old ? legacy : modern, left); }
      catch (e) {
        if (old || !(e instanceof GeminiError) || e.code !== "bad_request" || e.status !== 400) throw e;
        j = await call(model, legacy, Math.max(3000, timeoutMs - (Date.now() - t0)));
      }
      const part = (j.candidates?.[0]?.content?.parts ?? []).find((p) => p.inlineData?.data);
      const b64 = part?.inlineData?.data;
      if (!b64) throw new GeminiError("empty", model, `Gemini TTS returned no audio (${j.candidates?.[0]?.finishReason ?? "no candidate"})`);
      const bytes = Buffer.from(b64, "base64");
      if (bytes.length < 100) throw new GeminiError("empty", model, "Gemini TTS returned an empty clip");
      const mime = (part?.inlineData?.mimeType ?? "audio/wav").toLowerCase();
      // Older TTS models answer with headerless PCM (audio/L16): wrap it so every browser can play it.
      const isWav = bytes.subarray(0, 4).toString("latin1") === "RIFF";
      const rate = Number(mime.match(/rate=(\d+)/)?.[1]) || 24000;
      const out = isWav ? bytes : pcmToWav(bytes, rate);
      return { audio: out.buffer.slice(out.byteOffset, out.byteOffset + out.byteLength) as ArrayBuffer, mime: "audio/wav", model };
    } catch (e) {
      last = e instanceof GeminiError ? e : new GeminiError("network", model, "Gemini TTS call failed");
      if (last.code === "not_configured" || last.code === "auth") break;
    }
  }
  throw last ?? new GeminiError("timeout", models[0] ?? "gemini-tts", "Gemini TTS ran out of time");
}

/** Wraps 16-bit mono little-endian PCM in a RIFF/WAV header. */
export function pcmToWav(pcm: Buffer, sampleRate = 24000): Buffer {
  const h = Buffer.alloc(44);
  h.write("RIFF", 0); h.writeUInt32LE(36 + pcm.length, 4); h.write("WAVE", 8); h.write("fmt ", 12);
  h.writeUInt32LE(16, 16); h.writeUInt16LE(1, 20); h.writeUInt16LE(1, 22); h.writeUInt32LE(sampleRate, 24);
  h.writeUInt32LE(sampleRate * 2, 28); h.writeUInt16LE(2, 32); h.writeUInt16LE(16, 34); h.write("data", 36); h.writeUInt32LE(pcm.length, 40);
  return Buffer.concat([h, pcm]);
}
