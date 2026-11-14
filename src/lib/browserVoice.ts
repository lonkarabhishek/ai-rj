"use client";
// The device's own voice (Web Speech API): the free, always-available fallback when no neural voice can speak.
// Voices load asynchronously and differ wildly per device, so we wait for the list, score every voice and keep the most natural one.

let cache: SpeechSynthesisVoice[] = [];
let waiting: Promise<SpeechSynthesisVoice[]> | null = null;

/** Resolves with the device's voices. Chrome and Safari fill the list late (voiceschanged); never waits longer than `timeoutMs`. */
export function loadVoices(timeoutMs = 1500): Promise<SpeechSynthesisVoice[]> {
  const synth = typeof window !== "undefined" ? window.speechSynthesis : undefined;
  if (!synth) return Promise.resolve([]);
  const now = synth.getVoices();
  if (now.length) { cache = now; return Promise.resolve(now); }
  if (waiting) return waiting;
  waiting = new Promise<SpeechSynthesisVoice[]>((resolve) => {
    let done = false;
    const finish = () => { if (done) return; done = true; synth.removeEventListener?.("voiceschanged", finish); waiting = null; cache = synth.getVoices(); resolve(cache); };
    synth.addEventListener?.("voiceschanged", finish);
    setTimeout(finish, timeoutMs);
  });
  return waiting;
}

// Apple's novelty voices (and the robotic "Eloquence" set) must never host a radio show.
const NOVELTY = /^(albert|bad news|bahh|bells|boing|bubbles|cellos|good news|jester|organ|superstar|trinoids|whisper|wobble|zarvox|fred|junior|kathy|ralph|deranged|hysterical|pipe organ)\b/i;
const ELOQUENCE = /^(eddy|flo|grandma|grandpa|reed|rocko|sandy|shelley)\b/i;
const GOOD = /premium|enhanced|natural|neural|siri|online/i;
const REGION: Record<string, string[]> = { es: ["es-MX", "es-US", "es-419", "es-ES"], en: ["en-US", "en-GB", "en-AU", "en-IN"], hi: ["hi-IN"], mr: ["mr-IN", "hi-IN"] };

export function scoreVoice(v: Pick<SpeechSynthesisVoice, "name" | "lang" | "localService" | "voiceURI">, want: string): number {
  const lang = (v.lang || "").replace("_", "-"), base = want.slice(0, 2).toLowerCase();
  if (lang.slice(0, 2).toLowerCase() !== base) return -1;
  let s = lang.toLowerCase() === want.toLowerCase() ? 100 : 60;
  const order = REGION[base] ?? [];
  const i = order.findIndex((r) => r.toLowerCase() === lang.toLowerCase());
  if (i >= 0) s += 12 - i * 3; // nearest regional sibling first (es-MX → es-US → es-419 → es-ES)
  const id = `${v.name} ${v.voiceURI ?? ""}`;
  if (GOOD.test(id)) s += 30;
  if (/google/i.test(v.name)) s += 15;
  if (/compact/i.test(id)) s -= 5;
  if (ELOQUENCE.test(v.name) || /eloquence/i.test(id)) s -= 40;
  if (NOVELTY.test(v.name) || /espeak/i.test(id)) s -= 100;
  return s;
}

/** The most natural installed voice for a BCP-47 tag, or undefined when the device has none for that language. */
export function pickVoice(voices: SpeechSynthesisVoice[], want: string): SpeechSynthesisVoice | undefined {
  let best: SpeechSynthesisVoice | undefined, top = 0;
  for (const v of voices) { const s = scoreVoice(v, want); if (s > top) { top = s; best = v; } }
  // Few devices ship a Marathi voice: a Hindi voice reads the same script far better than silence or an English voice would.
  if (!best && want.toLowerCase().startsWith("mr")) return pickVoice(voices, "hi-IN");
  return best;
}

export type SpeechMood = "hype" | "cheerful" | "warm" | "calm";
const DELIVERY: Record<SpeechMood, { rate: number; pitch: number }> = {
  hype: { rate: 1.08, pitch: 1.06 }, cheerful: { rate: 1.02, pitch: 1.02 }, warm: { rate: 0.98, pitch: 1 }, calm: { rate: 0.92, pitch: 0.96 },
};

/** Sentence-sized chunks: Chrome cuts utterances after ~15s, and short chunks give more natural pauses on every engine. */
export function chunks(text: string): string[] {
  const parts = text.match(/[^.!?।…]+[.!?।…]*["”']?/g)?.map((x) => x.trim()).filter(Boolean) ?? [];
  return parts.length ? parts : [text];
}

export interface Speaking { done: Promise<void>; cancel: () => void; estSeconds: number; voice?: string }

/**
 * Speaks `text` with the device voice. Always resolves (end, error, cancel or watchdog): a stuck speech engine can never stall the radio.
 * Only one utterance queue exists at a time: starting a new one cancels whatever was still speaking, so announcements never overlap.
 */
export async function speakText(text: string, lang: string, mood: SpeechMood = "cheerful", onError?: (m: string) => void): Promise<Speaking> {
  const synth = typeof window !== "undefined" ? window.speechSynthesis : undefined;
  const estSeconds = Math.max(2, [...text].length / 13);
  if (!synth || typeof SpeechSynthesisUtterance === "undefined") {
    onError?.("no browser voice available");
    let stop = () => {};
    return { done: new Promise<void>((r) => { const t = setTimeout(r, 1500); stop = () => { clearTimeout(t); r(); }; }), cancel: () => stop(), estSeconds };
  }
  const voices = cache.length ? cache : await loadVoices();
  // Hinglish is Hindi in Roman letters: with no Hindi voice installed, an Indian-English voice reads it acceptably (it could not read Devanagari).
  const latin = !/[\u0900-\u097F]/.test(text);
  const v = pickVoice(voices, lang) ?? (lang.startsWith("hi") && latin ? pickVoice(voices, "en-IN") ?? pickVoice(voices, "en-US") : undefined);
  if (synth.paused) synth.resume();
  synth.cancel();
  const d = DELIVERY[mood] ?? DELIVERY.cheerful;
  const parts = chunks(text);
  let finished = false, timer: ReturnType<typeof setTimeout> | undefined, resolveDone: () => void = () => {};
  const done = new Promise<void>((r) => { resolveDone = r; });
  const finish = (cancel = false) => { if (finished) return; finished = true; if (timer) clearTimeout(timer); if (cancel) { try { synth.cancel(); } catch { /* ignore */ } } resolveDone(); };
  // Watchdog: iOS sometimes never fires `end` (backgrounded tab, interrupted audio session). Paused time doesn't count.
  const arm = (ms: number) => { timer = setTimeout(() => { if (synth.paused) arm(1500); else finish(true); }, ms); };
  arm(Math.min(120000, estSeconds * 2500 + 6000));
  parts.forEach((t, i) => {
    const u = new SpeechSynthesisUtterance(t);
    u.lang = v?.lang || lang; if (v) u.voice = v;
    u.rate = d.rate; u.pitch = d.pitch; u.volume = 1;
    const last = i === parts.length - 1;
    u.onerror = (ev) => { if (ev.error !== "canceled" && ev.error !== "interrupted") onError?.(`browser voice error: ${ev.error}`); if (last || ev.error === "not-allowed" || ev.error === "synthesis-failed") finish(true); };
    if (last) u.onend = () => finish();
    synth.speak(u);
  });
  return { done, cancel: () => finish(true), estSeconds, voice: v?.name };
}
