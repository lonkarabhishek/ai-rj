# The RJ's voice: options compared, and what MyRJ does

Goal: a host that sounds like a person on a live mic, in English and Spanish (and the existing Hindi, Hinglish and Marathi),
on an iPhone, for $0 a month. No single free option does all of that without a catch, so MyRJ uses a chain and always has a
voice that works.

Checked November 2026. Free allowances are the providers' own and can change.

## Comparison

| Option | Naturalness / radio feel | English + Spanish | Other app languages | Latency | iPhone Safari | Free allowance | Server needed | Upkeep |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| **Gemini TTS** (`gemini-3.8-flash-lite-tts`, `-flash-tts`) | Excellent. Expressive, takes direction ("warm late-night host", "gym coach"), natural pauses, laughs and breaths via tags | Both, auto-detected, same voice | Hindi, Marathi and code-mixed Hinglish too (130 languages) | A few seconds per clip; returned whole (WAV), not streamed | Plays as a normal audio clip | Free tier exists but is small: about 3 requests/min and roughly 10 clips/day per model reported | No (called from the Vercel function) | None |
| **Kokoro** (82M, Apache-2.0) self-hosted | Very good for its size; clear and pleasant, less "performed" than Gemini | Both (Spanish voices fewer and plainer than English) | Hindi voices exist; no Marathi | About real time on CPU, faster on GPU | Plays as a normal audio clip | Unlimited, yours | Yes: a PC or mini-PC + a tunnel so Vercel can reach it | Low to medium |
| **Piper** (VITS) self-hosted | Good, a little flat; fine for short links | Both (several es-MX / es-ES voices) | Hindi; limited Marathi | Faster than real time on CPU | Plays as a normal audio clip | Unlimited, yours | Yes, very light (runs on a Raspberry Pi) | Low to medium |
| Kokoro / Piper **inside the browser** (WASM/WebGPU) | Same models | Same | Same | Slow on phones | Risky: 80 to 330 MB model downloads, reports of Safari running out of memory | Unlimited | No | High (per-device downloads, crashes) |
| **Browser speech** (Web Speech API) | Fair on desktop Chrome/Edge and macOS; on iPhone only the basic built-in voices are exposed to web pages (downloaded Enhanced/Premium/Siri voices are not) | Both, quality depends on the device | Hindi yes; Marathi usually read by a Hindi voice | Instant | Works, needs a tap first (handled) | Unlimited | No | None |
| **Azure Speech** neural (F0) | Very good, styles via SSML | Both (es-MX Dalia/Jorge, multilingual Ava/Andrew) | Hindi, Marathi, en-IN | Fast | Plays as a normal audio clip | 0.5M characters/month, free tier but the Azure account needs a card | No | None |
| Google Cloud TTS (Chirp/WaveNet) | Very good | Both | Hindi, Marathi | Fast | Fine | Monthly free characters, but billing must be enabled and overage is charged automatically | No | Billing risk |
| ElevenLabs | Excellent | Both | Hindi | Fast | Fine | Small monthly credit, then paid | No | Paid |
| Unofficial "Edge read-aloud" endpoints | Very good | Both | Many | Fast | Fine | Not a public API | No | Can break or be blocked at any time; against the service's terms. **Not used.** |

## Recommendation

**Gemini TTS first, the device voice as the always-on backup, and a home voice server if you want the studio sound all day.**

- Gemini TTS is the most natural, most "radio" voice available for free, speaks every language the app has with one voice,
  and needs no extra account: it uses the same `GEMINI_API_KEY`. Its free allowance is small, so it cannot carry a whole
  day of listening on its own.
- When the allowance is used up the RJ switches to the device's own voice without stopping the show, and tries the studio
  voice again later. On iPhone that backup voice is noticeably more robotic. That is a platform limit: Safari does not let
  web pages use the better voices you can download in Settings.
- To have a natural voice all day at no cost, run Kokoro or Piper on a computer you own and point `LOCAL_TTS_URL` at it.
  Vercel's Hobby plan cannot run these models itself (no GPU, short-lived functions, the model would reload on every cold
  start), and a server on your home network is only reachable from Vercel through a public HTTPS address such as a free
  Cloudflare Tunnel. Protect it with `LOCAL_TTS_API_KEY`.
- Azure's F0 tier is the easiest "more minutes" upgrade if you are comfortable creating an Azure account: it stays free
  up to 0.5M characters a month (roughly eight to ten hours of talking), and the app already supports it.

## What is implemented

Server (`/api/tts`, `src/lib/tts.ts`, `src/lib/gemini.ts`):

1. The voice you picked decides which provider is tried first. **Automatic** (the default) means: Gemini → your voice server →
   Azure → ElevenLabs, skipping any that are not configured.
2. Gemini: the script is sent as a verbatim transcript; delivery goes separately as a style direction built from the break's
   mood (`hype`, `cheerful`, `warm`, `calm`), the station mode (Gym is punchier, Focus is a murmur, Romantic Hindi is slow
   and close) and your energy setting. Both free voice models are tried; a model that answers 429 rests before it is asked again.
3. Any failure returns a small JSON error with a code (`quota_exceeded`, `not_configured`, `all_failed`); keys and upstream
   error bodies are never sent to the browser.

Client (`src/app/live/page.tsx`, `src/lib/browserVoice.ts`):

- One shared audio element plays every clip, unlocked inside the **Go Live** tap (required on iOS).
- Only one thing speaks at a time: a new clip takes over the element; the device voice cancels its own queue first; a break
  waits for a talk-over to finish. The RJ only talks over music where the song can be turned down (desktop Spotify player,
  YouTube off iOS); on iPhone she speaks in the gap between songs.
- Device voice: the voice list is loaded asynchronously, every voice is scored for the RJ's language (exact region first,
  then the nearest one, "Enhanced/Premium/Natural/Google" voices preferred, novelty voices excluded), text is spoken sentence
  by sentence, and a watchdog ends a stuck utterance so the show never stalls.
- **This device's voice** can be chosen outright in Settings: then no voice request leaves the phone at all.
- After a quota answer the studio voice rests for ten minutes instead of failing on every break.

## Running your own voice server (optional)

Any server that implements OpenAI's `POST /v1/audio/speech` works. Two common choices:

- **Kokoro-FastAPI** (Docker): English `af_heart`, `am_michael`; Spanish `ef_dora`, `em_alex`; Hindi `hf_alpha`.
- **Piper** behind an OpenAI-compatible wrapper: pick an `es_MX` and an `en_US` voice.

```bash
LOCAL_TTS_URL=https://voice.example.com      # public HTTPS address of your server (e.g. a Cloudflare Tunnel)
LOCAL_TTS_VOICE=af_heart                     # default voice
LOCAL_TTS_VOICE_ES=ef_dora                   # used when the RJ speaks Spanish
LOCAL_TTS_VOICES=af_heart,am_michael,ef_dora # shown in the voice picker
LOCAL_TTS_API_KEY=choose-a-long-random-string
```

Voice names above are the ones those projects publish; check your server's own voice list.

## Known limits

- Gemini's voices were verified here against a stand-in for Google's API (request and response shapes from Google's
  documentation), not with a live key. Listen to a few voices in **Settings → Voice** after adding your key; each preview
  uses one request of the free allowance.
- Gemini clips arrive whole rather than streamed, so a long break has a second or two of preparation. Breaks are prepared
  while the previous song plays, so you do not hear that delay.
- Word-by-word highlighting of the RJ's text is estimated from clip length, not from real timings.
