# Running MyRJ for $0 a month

This is the personal, free setup: Google Gemini's free tier writes the RJ's lines and gives it a studio voice, your phone's own
voice covers when the free voice allowance runs out, and Vercel's Hobby plan hosts it. Nothing here needs a subscription.

Free tiers have limits and can change. The numbers below were checked in November 2026; the limits that apply to **your**
project are shown in [Google AI Studio](https://aistudio.google.com/) and your Vercel dashboard. Staying inside them is what
keeps the bill at zero; nothing in this app turns billing on for you.

## 1. Environment variables

| Variable | Needed? | What it does | Where to get it |
| --- | --- | --- | --- |
| `GEMINI_API_KEY` | **Recommended** | RJ scripts, song-language labels, screenshot/playlist import, studio voice | [aistudio.google.com/apikey](https://aistudio.google.com/apikey) (no card) |
| `SPOTIFY_CLIENT_ID`, `SPOTIFY_CLIENT_SECRET`, `SPOTIFY_REDIRECT_URI` | For Spotify | Sign-in, search, playback | [Spotify Developer Dashboard](https://developer.spotify.com/dashboard) |
| `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` | For YouTube | Sign-in, likes/playlists, search | Google Cloud Console → Credentials |
| `GOOGLE_REDIRECT_URI` | Optional | Only if the default `<origin>/api/auth/callback/youtube` is wrong for you | |
| `YOUTUBE_API_KEY` | Optional | YouTube search without signing in | Google Cloud Console → Credentials |
| `GEMINI_MODEL` | Optional | Script model. Default `gemini-3.5-flash-lite` | |
| `GEMINI_MODEL_FULL` | Optional | Stronger model tried first for full breaks (e.g. `gemini-3.8-flash`) | |
| `GEMINI_TTS_MODELS`, `GEMINI_TTS` | Optional | Voice models in order; `GEMINI_TTS=off` disables the Gemini voice | |
| `LOCAL_TTS_URL` and friends | Optional | Your own voice server (unlimited, free). See [VOICES.md](VOICES.md) | |
| `AZURE_SPEECH_KEY`, `AZURE_SPEECH_REGION` | Optional | Azure neural voices (free F0 tier, card on file) | Azure Portal |
| `ELEVENLABS_API_KEY` | Optional | ElevenLabs voices (paid beyond a small credit) | |
| `LLM_TIMEOUT_MS` | Optional | Script writer time budget before templates step in | |

**Not needed for the free personal setup:** `ANTHROPIC_API_KEY` and the `ANTHROPIC_MODEL*` variables, `OPENAI_API_KEY`,
`LLM_API_KEY`, `LLM_BASE_URL`, `LLM_MODEL` (paid LLM APIs, used only if you set them), and all four Supabase variables
(`NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `TOKEN_ENCRYPTION_KEY`).
Without Supabase the app runs logged-out: settings live in your browser, and the Spotify/Google refresh tokens live in
`HttpOnly` cookies that page scripts cannot read. Nothing sensitive is put in `localStorage`.

Only variables starting with `NEXT_PUBLIC_` ever reach the browser. Do not add that prefix to any key above.

## 2. OAuth redirect URLs

Register these exactly (scheme, host, path, no trailing slash):

| Provider | Local | Deployed |
| --- | --- | --- |
| Spotify | `http://127.0.0.1:3000/api/auth/callback/spotify` | `https://YOUR-APP.vercel.app/api/auth/callback/spotify` |
| Google (YouTube) | `http://127.0.0.1:3000/api/auth/callback/youtube` | `https://YOUR-APP.vercel.app/api/auth/callback/youtube` |

- `SPOTIFY_REDIRECT_URI` must equal the one you are using (set the deployed one in Vercel, the local one in `.env.local`).
- Spotify rejects `localhost`: use `127.0.0.1` locally.
- Spotify: add your own account under **Users and Access** (development mode allows 5 users).
- Google: OAuth consent screen → External → add yourself as a **Test user**; scope `youtube.readonly`; enable **YouTube Data API v3**.

## 3. Vercel (Hobby)

1. Import the repository in Vercel. Framework preset: Next.js. No build settings to change.
2. Project → Settings → Environment Variables: add the variables from section 1 for **Production** (and Preview if you use it).
3. Deploy, then put the deployed callback URLs into the Spotify and Google dashboards and into `SPOTIFY_REDIRECT_URI`.
4. On the iPhone: open the site in Safari → Share → **Add to Home Screen**. It opens full screen like an app.

The API routes are sized for Hobby: each declares a `maxDuration` of 30 to 60 seconds (Hobby allows up to 300), request bodies stay
under Vercel's 4.5 MB cap, and voice clips are kept to a size that fits a function response.

## 4. Free-tier limits you will actually meet

| Service | Limit | What happens in the app |
| --- | --- | --- |
| Gemini text (`gemini-3.5-flash-lite`) | Google does not publish fixed numbers. Developers measuring free projects in autumn 2026 reported about 500 requests a day and 10 to 15 a minute for Flash-Lite, and about 20 a day for the full Flash models. | One request per RJ break. On a 429 that model rests (an hour for a daily limit, about a minute for a per-minute one) and the RJ uses its built-in template lines meanwhile. |
| Gemini voice (`gemini-3.8-flash-lite-tts`, `gemini-3.8-flash-tts`) | Small. Reports put it near 3 requests a minute and roughly 10 clips a day per voice model. | The app tries both voice models, then your device's voice takes over for ten minutes at a time and the neural voice is retried later. Expect the studio voice for the first part of a long session, the device voice after. |
| Gemini free tier in general | Prompts may be used by Google to improve its products; limits are per project and "not guaranteed". | Song titles, your RJ name and the name you gave are in the prompts. |
| Vercel Hobby | Personal, non-commercial use only. 300 s max per function, 4.5 MB request/response bodies, monthly caps on transfer and invocations; if you exceed a cap the feature pauses until the window resets. | A personal radio is far below these. |
| Spotify | Full songs need **Spotify Premium** (Web Playback SDK on desktop, Spotify Connect to the Spotify app on phones). Dev-mode apps: 5 users, shared daily quota. | Free accounts get a clear message; YouTube takes over if connected. |
| YouTube Data API | 10,000 units a day; a search costs 100, list calls cost 1. Videos carry YouTube's own ads unless you have YouTube Premium. | The client caches searches for a day and caps searches per session; a quota error is shown plainly. |
| Azure Speech F0 (optional) | 0.5 million neural characters a month; HD and "MAI" voices are not in the free allowance. | Used only if you add a key. |

Things that **can** cost money, all opt-in: adding a billing account to your Gemini project (you would then be charged past the
free tier), an Anthropic/OpenAI/ElevenLabs key, Azure on a paid tier, Vercel Pro, Spotify Premium, YouTube Premium.
The app never enables billing and has no paid dependency that is required.

## 5. Manual steps only you can do

1. Create the Gemini API key (Google account, no card).
2. Create the Spotify app and/or the Google OAuth client and register the redirect URLs above.
3. Add yourself as a Spotify dev-mode user and a Google OAuth test user.
4. Put the values in `.env.local` (local) and in Vercel's environment settings (deployed).
5. Optional, for the best free voice at volume: run a voice server at home ([VOICES.md](VOICES.md)).
