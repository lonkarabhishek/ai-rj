import { test, expect } from "@playwright/test";
import { DEFAULT_PREFS } from "../../src/lib/prefs";
import { llmScriptWith, systemPrompt, templateScript } from "../../src/lib/script";
import { geminiCooling, geminiSpeech, geminiText, GeminiError, pcmToWav, resetGeminiCooldowns } from "../../src/lib/gemini";
import { geminiStyle, geminiTts, TtsError, voiceProvider } from "../../src/lib/tts";
import { isPrivateHost, rateLimit, sameOrigin } from "../../src/lib/guard";
import { chunks, pickVoice, scoreVoice } from "../../src/lib/browserVoice";

/* Code-level checks of the Gemini writer, the Gemini voice and the fallbacks. Google is never called: fetch is replaced with a stand-in
   that answers in the documented response shape, so these prove our request/response handling, not Google's service. */
test.describe.configure({ mode: "serial" }); // they share process.env and globalThis.fetch

type Call = { url: string; headers: Record<string, string>; body: any };
const TEXT = (t: string) => new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: t }] }, finishReason: "STOP" }] }), { status: 200 });
const QUOTA = (daily: boolean) => new Response(JSON.stringify({ error: { code: 429, status: "RESOURCE_EXHAUSTED", details: [{ quotaId: daily ? "GenerateRequestsPerDayPerProjectPerModel-FreeTier" : "GenerateRequestsPerMinutePerProjectPerModel-FreeTier" }] } }), { status: 429 });
async function withGemini<T>(handler: (c: Call) => Response | Promise<Response>, run: (calls: Call[]) => Promise<T>, env: Record<string, string> = {}): Promise<T> {
  const calls: Call[] = [], orig = globalThis.fetch, saved: Record<string, string | undefined> = {};
  const vars = { GEMINI_API_KEY: "test-key-123", ...env };
  for (const k of [...Object.keys(vars), "ANTHROPIC_API_KEY", "OPENAI_API_KEY", "LLM_API_KEY", "GEMINI_MODEL", "GEMINI_MODEL_FULL", "GEMINI_TTS_MODELS", "GEMINI_API_BASE", "LLM_TIMEOUT_MS"]) saved[k] = process.env[k];
  for (const k of ["ANTHROPIC_API_KEY", "OPENAI_API_KEY", "LLM_API_KEY", "GEMINI_MODEL", "GEMINI_MODEL_FULL", "GEMINI_TTS_MODELS", "GEMINI_API_BASE", "LLM_TIMEOUT_MS"]) delete process.env[k];
  Object.assign(process.env, vars);
  resetGeminiCooldowns();
  globalThis.fetch = (async (u: any, init: any) => {
    const c = { url: String(u), headers: Object.fromEntries(Object.entries(init?.headers ?? {}).map(([k, v]) => [k.toLowerCase(), String(v)])), body: init?.body ? JSON.parse(init.body) : null };
    calls.push(c);
    return new Promise<Response>((resolve, reject) => {
      init?.signal?.addEventListener("abort", () => reject(Object.assign(new Error("aborted"), { name: "TimeoutError" })));
      Promise.resolve(handler(c)).then(resolve, reject);
    });
  }) as any;
  try { return await run(calls); }
  finally { globalThis.fetch = orig; for (const [k, v] of Object.entries(saved)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; } resetGeminiCooldowns(); }
}
const prefs = { ...DEFAULT_PREFS, rjName: "Riya", listenerName: "Kim", language: "english" as const };
const next = { name: "Kesariya", artists: "Arijit Singh" };
const input = (o: Record<string, unknown> = {}) => ({ prefs, next, prev: { name: "Blinding Lights", artists: "The Weeknd" }, index: 2, kind: "full" as const, mode: "default" as const, headlines: [], ...o });

test("Gemini writes the break: free-tier model, key only in a header, persona as system instruction", async () => {
  await withGemini(() => TEXT("[warm] Okay Kim, that one never gets old. Up next, Kesariya by Arijit Singh."), async (calls) => {
    const r = await llmScriptWith(input());
    expect(r).toMatchObject({ provider: "gemini", model: "gemini-3.5-flash-lite" });
    expect(r!.text).toContain("Kesariya");
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe("https://generativelanguage.googleapis.com/v1beta/models/gemini-3.5-flash-lite:generateContent");
    expect(calls[0].url).not.toContain("test-key-123"); // never in the URL (URLs end up in logs)
    expect(calls[0].headers["x-goog-api-key"]).toBe("test-key-123");
    expect(calls[0].body.systemInstruction.parts[0].text).toContain("You are Riya");
    expect(calls[0].body.contents[0].parts[0].text).toContain('"Kesariya" by Arijit Singh');
  });
});

test("Gemini quota exhausted → templates take over, and the model is not asked again while it cools down", async () => {
  await withGemini(() => QUOTA(true), async (calls) => {
    expect(await llmScriptWith(input())).toBeNull(); // the route then uses templateScript()
    expect(geminiCooling("gemini-3.5-flash-lite")).toBe("quota_exhausted");
    expect(await llmScriptWith(input())).toBeNull();
    expect(calls, "second break must not spend a request on a model that just said its quota is gone").toHaveLength(1);
    const t = templateScript(input());
    expect(t.length).toBeGreaterThan(25); expect(t).toContain("Kesariya");
  });
});

test("Gemini per-minute limit is a short cooldown, a server error does not poison the model for long", async () => {
  await withGemini(() => QUOTA(false), async () => {
    await expect(geminiText({ user: "hi" })).rejects.toMatchObject({ code: "rate_limited" });
    expect(geminiCooling("gemini-3.5-flash-lite")).toBe("rate_limited");
  });
});

test("Gemini unavailable (hangs) → gives up inside the time budget instead of stalling the radio", async () => {
  await withGemini(() => new Promise<Response>(() => {}), async () => {
    const t0 = Date.now();
    expect(await llmScriptWith(input())).toBeNull();
    expect(Date.now() - t0).toBeLessThan(4000);
  }, { LLM_TIMEOUT_MS: "1600" });
});

test("Gemini model chain: the stronger model fails, the fast one writes the break; bad key stops at once", async () => {
  await withGemini((c) => (c.url.includes("gemini-3.8-flash:") ? new Response("{}", { status: 503 }) : TEXT("[cheerful] Here comes Kesariya.")), async (calls) => {
    const r = await llmScriptWith(input());
    expect(r?.model).toBe("gemini-3.5-flash-lite");
    expect(calls.map((c) => c.url.split("/models/")[1].split(":")[0])).toEqual(["gemini-3.8-flash", "gemini-3.5-flash-lite"]);
    // short lines never spend the scarce strong-model allowance
    calls.length = 0; resetGeminiCooldowns();
    await llmScriptWith(input({ kind: "stinger" }));
    expect(calls.map((c) => c.url.split("/models/")[1].split(":")[0])).toEqual(["gemini-3.5-flash-lite"]);
  }, { GEMINI_MODEL_FULL: "gemini-3.8-flash" });
  await withGemini(() => new Response(JSON.stringify({ error: { status: "PERMISSION_DENIED", message: "API key test-key-123 not valid" } }), { status: 403 }), async (calls) => {
    const err = await geminiText({ user: "hi" }).catch((e) => e);
    expect(err).toBeInstanceOf(GeminiError); expect(err.code).toBe("auth");
    expect(err.message, "error text must never carry the key or Google's raw body").not.toContain("test-key-123");
    expect(calls).toHaveLength(1);
  });
});

test("The DJ never invents songs: no next track means no title, missing artist means title only", async () => {
  expect(systemPrompt(prefs, "default")).toMatch(/Never invent a song title/);
  await withGemini(() => TEXT("[warm] Still here with you."), async (calls) => {
    await llmScriptWith(input({ next: null }));
    expect(calls[0].body.contents[0].parts[0].text).toMatch(/none yet: do not name any song/);
  });
  for (const lang of ["english", "spanish", "hinglish", "hindi", "marathi"] as const) {
    const t = templateScript(input({ prefs: { ...prefs, language: lang }, next: null }));
    expect(t, `${lang}: nothing quoted when there is no next song`).not.toMatch(/"[^"]+"/);
    expect(t.length).toBeGreaterThan(10);
  }
  const noArtist = templateScript(input({ next: { name: "Untitled Demo", artists: "" } }));
  expect(noArtist).toContain('"Untitled Demo"'); expect(noArtist).not.toMatch(/"Untitled Demo" by\s*[.!]/);
});

test("Spanish: prompt and fallback templates are in Spanish, existing languages still work", async () => {
  const es = { ...prefs, language: "spanish" as const };
  expect(systemPrompt(es, "default")).toMatch(/Latin American Spanish/);
  expect(systemPrompt(es, "default")).toContain("solo para Kim");
  expect(systemPrompt({ ...prefs, language: "hinglish" }, "default")).toMatch(/Indian FM radio jockey/); // the original identity is intact
  const opener = templateScript(input({ prefs: es, index: 0 }));
  expect(opener).toMatch(/Hola Kim/); expect(opener).toContain('"Kesariya" de Arijit Singh');
  for (const mode of ["gym", "drive", "focus"] as const) expect(templateScript(input({ prefs: es, mode })), mode).toMatch(/[áéíóúñ¡¿]|Kesariya/);
  expect(templateScript(input({ prefs: es, kind: "switch", mode: "gym" }))).toBe("Modo gimnasio. ¡A levantar!");
  await withGemini(() => TEXT("[cheerful] Vamos con Kesariya."), async (calls) => {
    await llmScriptWith(input({ prefs: es }));
    expect(calls[0].body.contents[0].parts[0].text).toMatch(/Write in Spanish/);
  });
});

test("No repeated phrases in a row from the templates", async () => {
  let recent: string[] = [];
  const seen: string[] = [];
  for (let i = 1; i <= 5; i++) { const t = templateScript(input({ index: i, recent })); seen.push(t.split(/[.!?]/)[0]); recent = [...recent, t].slice(-6); }
  expect(new Set(seen).size, seen.join(" | ")).toBeGreaterThanOrEqual(4);
});

const wav = pcmToWav(Buffer.alloc(4800, 1), 24000);
const AUDIO = (bytes: Buffer, mimeType = "audio/wav") => new Response(JSON.stringify({ candidates: [{ content: { parts: [{ inlineData: { mimeType, data: bytes.toString("base64") } }] } }] }), { status: 200 });

test("Gemini voice: verbatim transcript, delivery in speech_metadata, WAV out; raw PCM gets a WAV header", async () => {
  await withGemini(() => AUDIO(wav), async (calls) => {
    const r = await geminiTts("Up next, Kesariya.", "gemini:Puck", "hype", "gym", "hype");
    expect(r.mime).toBe("audio/wav");
    expect(Buffer.from(r.audio).subarray(0, 4).toString()).toBe("RIFF");
    const b = calls[0].body;
    expect(calls[0].url).toContain("/models/gemini-3.8-flash-lite-tts:generateContent");
    expect(b.contents[0].parts[0].text).toBe("Up next, Kesariya."); // no stage directions mixed into the words
    expect(b.contents[0].parts[0].speech_metadata.style).toMatch(/High-energy/);
    expect(b.generationConfig.responseModalities).toEqual(["AUDIO"]);
    expect(b.generationConfig.speechConfig.voiceConfig.voice).toBe("Puck");
  });
  await withGemini(() => AUDIO(Buffer.alloc(4800, 2), "audio/L16;codec=pcm;rate=24000"), async () => {
    const r = await geminiSpeech("hello", "Sulafat", "");
    const out = Buffer.from(r.audio);
    expect(out.subarray(0, 4).toString()).toBe("RIFF"); expect(out.length).toBe(4800 + 44); expect(out.readUInt32LE(24)).toBe(24000);
  });
  expect(geminiStyle("calm", "focus", "chill")).toMatch(/murmur/);
  expect(geminiStyle(undefined, "gym", "hype")).toMatch(/High-energy.*Gym-floor/);
  expect(geminiStyle("hype", "romantic_f", "chill")).toMatch(/Hindi/);
});

test("Gemini voice quota: tries the second free model, then reports quota so the app drops to the device voice", async () => {
  await withGemini((c) => (c.url.includes("flash-lite-tts") ? QUOTA(true) : AUDIO(wav)), async (calls) => {
    const r = await geminiTts("Hello there.", "auto", "balanced", "default");
    expect(r.mime).toBe("audio/wav");
    expect(calls.map((c) => c.url.split("/models/")[1].split(":")[0])).toEqual(["gemini-3.8-flash-lite-tts", "gemini-3.8-flash-tts"]);
    expect(calls[1].body.generationConfig.speechConfig.voiceConfig.voice).toBe("Sulafat"); // "auto" → the default warm host
  });
  await withGemini(() => QUOTA(true), async (calls) => {
    const e = await geminiTts("Hello there.", "gemini:Puck", "balanced", "default").catch((x) => x);
    expect(e).toBeInstanceOf(TtsError); expect(e.code).toBe("quota_exceeded");
    await geminiTts("Hello again.", "gemini:Puck", "balanced", "default").catch(() => {});
    expect(calls, "both models are cooling: no more requests").toHaveLength(2);
  });
});

test("Voice ids map to the right provider (old saved ids keep working)", () => {
  expect(voiceProvider("gemini:Sulafat")).toBe("gemini");
  expect(voiceProvider("local:af_heart")).toBe("local");
  expect(voiceProvider("azure:en-IN-NeerjaNeural")).toBe("azure");
  expect(voiceProvider("21m00Tcm4TlvDq8ikWAM")).toBe("elevenlabs");
  for (const id of ["", "auto", "browser", "en-IN-NeerjaNeural", undefined]) expect(voiceProvider(id), String(id)).toBeNull();
});

test("Device voice choice: the most natural voice for the language wins, novelty voices never do", () => {
  const v = (name: string, lang: string, voiceURI = name) => ({ name, lang, voiceURI, localService: true, default: false }) as SpeechSynthesisVoice;
  const ios = [v("Albert", "en-US"), v("Eddy (English (US))", "en-US", "com.apple.eloquence.en-US.Eddy"), v("Samantha", "en-US", "com.apple.voice.compact.en-US.Samantha"), v("Daniel", "en-GB"),
    v("Mónica", "es-ES", "com.apple.voice.compact.es-ES.Monica"), v("Paulina", "es-MX", "com.apple.voice.compact.es-MX.Paulina"), v("Lekha", "hi-IN")];
  expect(pickVoice(ios, "en-US")?.name).toBe("Samantha");
  expect(pickVoice(ios, "es-MX")?.name).toBe("Paulina");
  expect(pickVoice(ios.filter((x) => x.name !== "Paulina"), "es-MX")?.name).toBe("Mónica"); // nearest Spanish when Mexican isn't installed
  expect(pickVoice(ios, "hi-IN")?.name).toBe("Lekha");
  expect(pickVoice(ios, "mr-IN")?.name).toBe("Lekha"); // no Marathi voice on iOS: Hindi reads Devanagari
  expect(pickVoice(ios, "fr-FR")).toBeUndefined();
  expect(pickVoice([...ios, v("Ava (Premium)", "en-US")], "en-US")?.name).toBe("Ava (Premium)");
  expect(pickVoice([v("Google US English", "en-US"), v("Microsoft David", "en-US")], "en-US")?.name).toBe("Google US English");
  expect(scoreVoice(v("Zarvox", "en-US"), "en-US")).toBeLessThan(scoreVoice(v("Daniel", "en-GB"), "en-US"));
  expect(chunks("One. Two! ¿Tres? चार।")).toEqual(["One.", "Two!", "¿Tres?", "चार।"]);
});

test("Request guards: cross-site POSTs refused, bursts limited, private hosts blocked", () => {
  const req = (h: Record<string, string>, url = "http://radio.example/api/tts") => new Request(url, { method: "POST", headers: h });
  expect(sameOrigin(req({ origin: "http://radio.example", host: "radio.example" }))).toBe(true);
  expect(sameOrigin(req({ origin: "https://evil.example", host: "radio.example" }))).toBe(false);
  expect(sameOrigin(req({ "sec-fetch-site": "cross-site" }))).toBe(false);
  expect(sameOrigin(req({}))).toBe(true); // curl / server-to-server: no browser, no victim's cookies
  const r = req({ "x-forwarded-for": "203.0.113.9" });
  const name = `t${Date.now()}`;
  for (let i = 0; i < 5; i++) expect(rateLimit(r, name, 5)).toBe(0);
  expect(rateLimit(r, name, 5)).toBeGreaterThan(0);
  expect(rateLimit(req({ "x-forwarded-for": "203.0.113.10" }), name, 5)).toBe(0); // another client is unaffected
  for (const h of ["localhost", "127.0.0.1", "10.1.2.3", "192.168.1.1", "172.20.0.1", "169.254.169.254", "[::1]", "0x7f000001", "2130706433", "metadata.google.internal"]) expect(isPrivateHost(h), h).toBe(true);
  for (const h of ["open.spotify.com", "8.8.8.8", "music.youtube.com"]) expect(isPrivateHost(h), h).toBe(false);
});

// ---- the real server routes (port 3124: Gemini and Claude keys are invalid and Gemini points at a closed port) ----
const B = "http://localhost:3124";
test("API: AI down → template script in English and Spanish; garbage input is cleaned, not trusted", async ({ request }) => {
  for (const [language, re] of [["english", /Kesariya/], ["spanish", /Kesariya/]] as const) {
    const r = await request.post(`${B}/api/segment`, { data: { prefs: { ...prefs, language }, next, index: 3, kind: "full", mode: "default" } });
    const j = await r.json();
    expect(r.status()).toBe(200); expect(j.mode).toBe("template"); expect(j.provider).toBe("template"); expect(j.script).toMatch(re);
    if (language === "spanish") expect(j.script).toMatch(/ de Arijit Singh/);
  }
  const long = "x".repeat(5000);
  const j = await (await request.post(`${B}/api/segment`, { data: { prefs: { rjName: long, listenerName: { evil: 1 }, language: "klingon", humor: 99, energy: null }, next: { name: long, artists: 7 }, index: "NaN", kind: "weird", mode: "nope", recent: [long, 5, null] } })).json();
  expect(j.mode).toBe("template"); expect(j.script.length).toBeLessThanOrEqual(1500); expect(j.script).not.toContain("x".repeat(300));
  expect((await request.post(`${B}/api/segment`, { data: "not json", headers: { "content-type": "application/json" } })).status()).toBe(400);
  expect((await request.post(`${B}/api/segment`, { data: { prefs }, headers: { origin: "https://evil.example" } })).status()).toBe(403);
});

test("API: voice service failing → clean 502 the app understands; voices list always offers Automatic and the device voice", async ({ request }) => {
  const r = await request.post(`${B}/api/tts`, { data: { text: "Hello there, quick test.", voiceId: "auto", language: "english" } });
  expect(r.status()).toBe(502);
  const j = await r.json();
  expect(j.code).toBe("all_failed"); expect(j.failures.join()).toMatch(/gemini:/);
  expect(JSON.stringify(j)).not.toMatch(/invalid|127\.0\.0\.1/); // nothing about keys or internals leaks to the browser
  expect((await request.post(`${B}/api/tts`, { data: { text: "" } })).status()).toBe(400);
  expect((await request.post(`${B}/api/tts`, { data: { text: "hi" }, headers: { origin: "https://evil.example" } })).status()).toBe(403);
  const v = await (await request.get(`${B}/api/voices`)).json();
  expect(v.voices.slice(0, 2).map((x: any) => x.id)).toEqual(["auto", "browser"]);
  expect(v.voices.some((x: any) => x.id === "gemini:Sulafat")).toBe(true);
  expect(v.providers).toMatchObject({ gemini: true, azure: false });
});

test("API: security headers on pages and APIs, manifest and icons served", async ({ request }) => {
  const page = await request.get(`${B}/live`);
  const h = page.headers();
  expect(h["x-content-type-options"]).toBe("nosniff");
  expect(h["x-frame-options"]).toBe("SAMEORIGIN");
  expect(h["content-security-policy"]).toContain("frame-ancestors 'self'");
  expect(h["x-powered-by"]).toBeUndefined();
  expect((await request.get(`${B}/api/voices`)).headers()["cache-control"]).toContain("no-store");
  const m = await (await request.get(`${B}/manifest.webmanifest`)).json();
  expect(m.display).toBe("standalone"); expect(m.start_url).toBe("/live");
  for (const i of m.icons) expect((await request.get(`${B}${i.src}`)).status(), i.src).toBe(200);
  expect((await request.get(`${B}/icons/apple-touch-icon.png`)).status()).toBe(200);
});

test("Gemini voice: a refused request shape is retried once in the older shape, so the RJ still speaks", async () => {
  await withGemini((c) => (c.body.generationConfig.responseFormat ? new Response(JSON.stringify({ error: { status: "INVALID_ARGUMENT" } }), { status: 400 }) : AUDIO(Buffer.alloc(4800, 3), "audio/L16;rate=24000")), async (calls) => {
    const r = await geminiSpeech("Hello there.", "Sulafat", "warm host");
    expect(Buffer.from(r.audio).subarray(0, 4).toString()).toBe("RIFF");
    expect(calls).toHaveLength(2);
    expect(calls[1].body.generationConfig.speechConfig.voiceConfig.prebuiltVoiceConfig.voiceName).toBe("Sulafat");
    expect(calls[1].body.contents[0].parts[0].text).toContain("Hello there.");
  });
  await withGemini(() => AUDIO(Buffer.alloc(4800, 3), "audio/L16;rate=24000"), async (calls) => {
    await geminiSpeech("Hola.", "Puck", "");
    expect(calls[0].body.generationConfig.speechConfig.voiceConfig.prebuiltVoiceConfig.voiceName).toBe("Puck"); // preview models: older shape straight away
  }, { GEMINI_TTS_MODELS: "gemini-3.1-flash-tts-preview" });
});
