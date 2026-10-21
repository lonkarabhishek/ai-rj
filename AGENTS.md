# AGENTS.md: set up and run MyRJ (for AI coding agents)

You are an AI coding agent (Claude Code, Cursor, Codex, ...) helping a human run **MyRJ**, a self-hosted AI radio jockey (Next.js 16, React 19, Tailwind 4) that talks between songs played from Spotify or YouTube.

## Rules (read first)

1. **Never invent, guess or hard-code API keys, secrets or IDs.** Every key comes from the human. If a key is missing, say which one, where to get it (table below), and wait.
2. **Never commit secrets.** Keys live only in `.env.local` (git-ignored). Never print them in logs or paste them in issues. Never edit `.env.example` to hold real values.
3. Don't create cloud accounts, apps or paid resources on the human's behalf. Give them the exact steps instead.
4. Nothing is required to boot. With no keys the app opens, uses template RJ lines and browser speech, and plays no music. Get that working first, then add services one at a time.
5. Use `127.0.0.1`, not `localhost`, for local URLs (Spotify rejects `localhost` redirects).
6. Don't force-push, and don't rewrite git history.

## Prerequisites

- Node.js **20+** (`node -v`) and npm. Git.
- A modern Chromium for tests: `npx playwright install chromium`.
- Optional: a Supabase project (accounts/sync), Spotify Premium (full songs), YouTube account.

## Setup commands

```bash
git clone https://github.com/lonkarabhishek/ai-rj.git && cd ai-rj
npm install
cp .env.example .env.local      # then ask the human for keys; fill only what they give you
npm run dev -- -H 127.0.0.1     # http://127.0.0.1:3000
```

Other commands:

| Task | Command |
| --- | --- |
| Production build (type-checks) | `npm run build` |
| Lint | `npm run lint` |
| E2E (builds, then Playwright against fake Spotify/YouTube/voice) | `npm run e2e` |
| One E2E file / project | `npx playwright test tests/e2e/rj.spec.ts --project=mobile` |
| Smoke-test a deployed copy | `PROD_URL=https://YOUR-APP.vercel.app npm run e2e:prod` |

E2E needs `npm run build` first (the config runs `next start` on ports 3123 and 3124). A few timing-sensitive tests can flake under load: rerun that file alone before assuming a regression.

## Environment variable checklist

Copy `.env.example` to `.env.local`. Ask the human for each value.

| Variable | Required? | Where to get it |
| --- | --- | --- |
| `ANTHROPIC_API_KEY` | Recommended (templates otherwise) | https://console.anthropic.com → API Keys |
| `ANTHROPIC_MODEL` | Optional | Fast model for stingers, switch lines and the fallback; default `claude-haiku-5-5` |
| `ANTHROPIC_MODEL_FULL` | Optional | Writer for full breaks and show segments; default `claude-sonnet-5-5` (costs more than Haiku; set it to the Haiku id to keep costs down) |
| `AZURE_SPEECH_KEY` | Recommended (browser voice otherwise) | Azure Portal → Speech service → Keys and Endpoint |
| `AZURE_SPEECH_REGION` | With the Azure key (default `centralindia`) | Same page, "Location/Region" |
| `AZURE_TTS_BASE` | Optional | Custom TTS base URL |
| `ELEVENLABS_API_KEY` | Optional | https://elevenlabs.io → Profile → API key |
| `SPOTIFY_CLIENT_ID`, `SPOTIFY_CLIENT_SECRET` | Only for Spotify | https://developer.spotify.com/dashboard → Create app (Web API + Web Playback SDK) |
| `SPOTIFY_REDIRECT_URI` | With Spotify | Must exactly match a Redirect URI in the Spotify dashboard |
| `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` | Only for YouTube | Google Cloud Console → OAuth client ID (Web application) |
| `GOOGLE_REDIRECT_URI` | Optional | Defaults to `<origin>/api/auth/callback/youtube` |
| `YOUTUBE_API_KEY` | Optional | Google Cloud → Credentials → API key (YouTube Data API v3) |
| `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Only for accounts/sync | Supabase → Project Settings → API (publishable key) |
| `SUPABASE_SERVICE_ROLE_KEY` | With Supabase; **server only** | Supabase → Project Settings → API (secret key) |
| `TOKEN_ENCRYPTION_KEY` | With Supabase | Generate: `openssl rand -base64 32`. Set once and never change it |
| `OPENAI_API_KEY` / `LLM_API_KEY`, `LLM_BASE_URL`, `LLM_MODEL`, `LLM_TIMEOUT_MS` | Optional alternative to Claude | Any OpenAI-compatible provider |

Minimum useful setup: Anthropic + Azure Speech + one music source (Spotify **or** Google/YouTube). Restart the dev server after editing `.env.local`.

## Supabase (optional)

1. Human creates a project at https://supabase.com and gives you the three Supabase variables above.
2. Apply the one migration: [`supabase/migrations/20261014000000_accounts.sql`](supabase/migrations/20261014000000_accounts.sql). Either paste it into the Supabase **SQL Editor** and run it, or run `supabase link` then `supabase db push`. It creates `profiles`, `taste_seeds` and `provider_tokens` with row level security (`provider_tokens` is server only).
3. Authentication → Providers → **Google**: the human pastes the Google client ID/secret.
4. Authentication → URL Configuration: Site URL = deployed URL; Redirect URLs include `http://127.0.0.1:3000/auth/callback` and `https://YOUR-APP.vercel.app/auth/callback`.

## Spotify setup

- Redirect URIs to add in the Spotify dashboard (exact match): `http://127.0.0.1:3000/api/auth/callback/spotify` and `https://YOUR-APP.vercel.app/api/auth/callback/spotify`.
- Add the human's Spotify account under **Users and Access** (dev mode allows 5 users). Full songs need Premium.
- `SPOTIFY_REDIRECT_URI` must equal one of the URIs above.

## Google / YouTube setup

1. Google Cloud project → enable **YouTube Data API v3**.
2. OAuth consent screen → External. Scopes: `openid`, `email`, `profile`, `https://www.googleapis.com/auth/youtube.readonly`.
3. While the app is in *Testing*, **add every user as a Test user** (otherwise "access blocked").
4. OAuth client ID → Web application. Origins: `http://127.0.0.1:3000` and the deployed URL. Redirect URIs: `http://127.0.0.1:3000/api/auth/callback/youtube`, `https://YOUR-APP.vercel.app/api/auth/callback/youtube`, plus `https://YOUR-PROJECT.supabase.co/auth/v1/callback` if Supabase Google sign-in is used.
5. Quota is 10,000 units/day: a search costs 100, list calls cost 1.

## Verify it works

1. `npm run build` passes, then `npm run dev -- -H 127.0.0.1` and open http://127.0.0.1:3000/live.
2. Status routes (all safe, no side effects):
   - `curl -s http://127.0.0.1:3000/api/youtube/songs?status` → `{"configured":true/false,"connected":...}` (configured means Google keys are set; connected means the human signed in).
   - `curl -s http://127.0.0.1:3000/api/spotify/token` → `401 {"connected":false}` until Spotify is connected; `200` with a token once connected.
   - `curl -s http://127.0.0.1:3000/api/voices` → list of voices (non-empty when Azure/ElevenLabs keys work).
   - `curl -s -X POST http://127.0.0.1:3000/api/segment -H 'content-type: application/json' -d '{"prefs":{"rjName":"Riya","language":"english","newsTopics":[]},"next":{"name":"Song","artists":"Artist"},"index":1,"kind":"full","mode":"default"}'` → JSON whose `mode` is `llm` (Claude works) or `template` (no/invalid Claude key).
3. In the browser: sign in/connect a source, tap **Go Live**. Open **Playback details** (bottom of the live screen) to see `output`, `account`, `device`, `rj script` and `rj voice`. A red `●` marks an error.

## Project map

```
src/app/                 Next.js App Router
  page.tsx, welcome/     redirect + onboarding flow
  live/page.tsx          the radio screen and the playback state machine (big file)
  settings/              settings page (uses components/prefs.tsx)
  login/, auth/callback/ Supabase sign-in
  api/segment            RJ script (Claude, else templates); strips [tags]
  api/tts, api/voices    Azure / ElevenLabs speech and voice list
  api/news               headlines
  api/import             screenshot / link import (Claude vision)
  api/auth/{spotify,youtube}, api/spotify/*, api/youtube/*   OAuth + data routes
src/lib/
  prefs.ts               Prefs type, defaults, localStorage load/save, modes
  script.ts              RJ prompt, llmScript(), templateScript(), splitMood()
  text.ts                stripTags(): removes [NEWS]/[hype]-style tags from RJ text
  tts.ts                 Azure/ElevenLabs synthesis, curated voices, defaultAzureVoice()
  spotifyClient.ts       browser-side Spotify: token refresh, Curator, 429 backoff
  spotify.ts             server-side Spotify token helpers
  ytClient.ts            YouTube curator (YtCurator), language rules, NOT_A_SONG filter, YtPlayer (IFrame API)
  ytmusic.ts             server-side YouTube Data API: pool, search, video details filters
  youtube.ts, linkimport.ts, news.ts, tokens.ts, supabase/*
src/components/          ui.tsx, prefs.tsx, Lyrics.tsx, Mascot.tsx, account.tsx
supabase/migrations/     SQL for accounts
tests/e2e/               Playwright specs + fakes (fake.ts, fakeYt.ts)
```

Key behaviours to know before editing:

- **Romantic Hindi presets:** `ListenMode` also has `romantic_m` and `romantic_f` (`ROMANTIC_MODES` in `src/lib/prefs.ts`: label, voice id, fallback voice). They are not in `MODES`; the picker shows them in their own row. For that session only they force Hindi songs (`effectiveSongLangs()`), Hindi RJ, soft energy and their own voice (`effPrefs()` in `live/page.tsx`, and `/api/tts` enforces it server-side via `romanticVoice()`). Songs: `ROMANTIC_QUERIES` / `NOT_ROMANTIC_RE` in both `Curator` and `YtCurator`. Script rules: `MODE_RULES` in `script.ts`; `/api/segment` forces Hindi and no jokes/news. SSML prosody and style (only if the voice's StyleList has it) are in `buildSsml()`. Tests: `tests/e2e/romantic.spec.ts`. Verify new voice ids against the live Azure list; never invent keys.
- **Playback state machine:** `src/app/live/page.tsx` (`phase`: idle, tuning, song, rj, waiting, recovering). Play/pause goes through one path. Don't add parallel timers.
- **RJ script generation:** `llmScript()` in `src/lib/script.ts`, called by `/api/segment`. All text shown or spoken must pass `stripTags()`. Full breaks run a show segment (`SegmentType`: story, trivia_q/trivia_a, hot_take, callback, dedication, vibe) chosen by `nextSegment()` in `live/page.tsx` and checked by `segmentFor()`; a trivia question's answer comes back on a hidden `ANSWER:` line (`splitAnswer()`), is held client-side and revealed at the next break. Breaks get the session's played songs (`history`).
- **Transitions:** where we control song volume (desktop Spotify SDK, YouTube off iOS) the RJ talks over the outro and the next intro (`outroLeadMs()`), fades go through `fadeSdk()` (newest fade wins; never set volume directly) and `volumeGuard()` restores a song left ducked. Phone Spotify (Connect) and iOS YouTube can't duck: tight cuts, the next song is queued on the device (`startOn(..., after)`) and adopted if Spotify moved on by itself while the page was frozen.
- **TTS:** `/api/tts` tries the chosen provider then the other, else the client falls back to browser `speechSynthesis`.
- **YouTube:** `YtCurator.ok()` filters candidates (language, length, `looksLikeSong`); server `details()` drops non-embeddable, age-restricted, live and compilation videos.

## Common failure modes

| Symptom | Cause / fix |
| --- | --- |
| Spotify `429` with `QUOTA_EXCEEDED` (Playback details) | Dev-mode daily quota used up. Wait for reset; the app falls back to YouTube if connected. Don't loop retries |
| Spotify 403 / "not on allowed users" | Add the account in the Spotify dashboard → Users and Access, reconnect |
| Spotify login redirect error | Redirect URI mismatch, or used `localhost` instead of `127.0.0.1` |
| RJ silent on iPhone | iOS only allows audio after a user tap. Audio is unlocked inside the **Go Live** tap; don't move audio setup out of that handler. Silent switch must be off |
| YouTube video "plays" but is blank / skipped | The embed must stay **visible and at least 200×200** (YouTube policy); don't hide or shrink the player below that |
| Google "access blocked" | User isn't a Test user on the OAuth consent screen |
| YouTube quota errors | 10,000 units/day; searches cost 100. Client caps searches per session |
| Raw `[NEWS]`/`[JOKE]` text on screen | Claude echoed a tag. `stripTags()` in `src/lib/text.ts` handles it; keep it on every path |
| Supabase tokens stop working | `TOKEN_ENCRYPTION_KEY` changed. Restore it or reconnect providers |

## When you change code

- Run `npm run build` and `npm run e2e`; add or update a spec in `tests/e2e/` for behaviour changes.
- Keep the visual style minimal and dark (warm off-white `#f3efe8` on `#0a0908`), respect `prefers-reduced-motion`, and keep the live screen usable at 360×740.
- Small, clean commits; normal pushes only.
