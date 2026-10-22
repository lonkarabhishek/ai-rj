<p align="center">
  <img src="docs/mascot.svg" alt="MyRJ mascot" width="96">
</p>

<h1 align="center">MyRJ</h1>
<p align="center"><b>Your own AI radio jockey for Spotify &amp; YouTube.</b><br>
An RJ with a calm, human voice talks between your songs: intros, jokes, headlines and song facts in Hindi, English, Hinglish or Marathi.</p>

<p align="center">
  <a href="LICENSE"><img alt="License: MIT" src="https://img.shields.io/badge/license-MIT-f3efe8?style=flat-square&labelColor=141210"></a>
  <img alt="Next.js" src="https://img.shields.io/badge/Next.js-16-f3efe8?style=flat-square&labelColor=141210&logo=nextdotjs">
  <img alt="Spotify" src="https://img.shields.io/badge/Spotify-supported-1DB954?style=flat-square&labelColor=141210&logo=spotify&logoColor=white">
  <img alt="YouTube" src="https://img.shields.io/badge/YouTube-supported-FF0033?style=flat-square&labelColor=141210&logo=youtube&logoColor=white">
  <img alt="Self-hosted" src="https://img.shields.io/badge/self--hosted-bring%20your%20own%20keys-f3efe8?style=flat-square&labelColor=141210">
</p>

<p align="center">
  <a href="docs/myrj-launch.mp4"><b>▶ Watch the HD demo (1080×1920 MP4)</b></a> ·
  <a href="#quickstart-about-10-minutes">Quickstart</a> ·
  <a href="#recommended-voices">Voices</a> ·
  <a href="AGENTS.md">AGENTS.md</a>
</p>

> 🤖 Using an AI coding agent? Point it at [AGENTS.md](AGENTS.md) and it can set this up for you.

<p align="center">
  <a href="docs/myrj-launch.mp4"><img src="docs/myrj-demo.gif" alt="MyRJ demo: pick a mode, Go Live, and the RJ talks between songs. Click for the HD video." width="320"></a>
</p>

MyRJ is a personal AI radio station. Pick a mode, tap **Go Live**, and your RJ talks between songs, then the music plays from **Spotify** or **YouTube**. It's built to be **self-hosted**: you run your own copy with your own keys and have fun.

<table align="center">
  <tr>
    <td align="center"><img src="docs/start-mobile.png" alt="Start screen" width="220"><br><sub>Pick a mode</sub></td>
    <td align="center"><img src="docs/live-mobile.png" alt="Live screen" width="220"><br><sub>RJ on air</sub></td>
    <td align="center"><img src="docs/settings-mobile.png" alt="Settings" width="220"><br><sub>Make it yours</sub></td>
  </tr>
  <tr><td colspan="3" align="center"><img src="docs/start-desktop.png" alt="MyRJ on desktop" width="660"><br><sub>Desktop</sub></td></tr>
</table>

## Features

- **Modes:** My Mix, Gym, Driving and Focus (Focus plays only non-lyrical music).
- **Romantic Hindi presets:** two extra session types under the mode row. **Romantic Hindi · Masculine** (deep, confident male voice) and **Romantic Hindi · Sultry** (warm, intimate female voice). Songs are strictly Hindi romantic (love songs, ballads, soft Bollywood, ghazal-lite) on both Spotify and YouTube; the RJ speaks Devanagari Hindi with shayari-style one-liners and dedications, no news or jokes, and only when it has something worth saying. The preset's voice applies to that session only; your saved voice and language are untouched.
- **Languages:** the RJ speaks Hindi, English, Hinglish or Marathi. You also choose which languages your *songs* are in, and YouTube picks are strictly filtered to them.
- **Music sources:** **Spotify** (Web Playback SDK on desktop, Spotify Connect on phones) and **YouTube** (embedded player, ad-free with YouTube Premium). YouTube mode skips albums, compilations, reactions and live streams.
- **Talks about what you want:** toggle news, jokes and song facts per session, or go "just music".
- **Voice:** Azure Speech (free tier friendly), optional ElevenLabs, browser speech as a fallback. Soft background intro/outro music and music ducking while the RJ talks.
- **Mascot:** a small animated pill-shaped robot that glances at you, reacts to taps and "speaks" along with the RJ.
- **Synced lyrics** display, lock-screen / headphone controls (MediaSession), and a single playback state machine so play/pause is dependable.
- **Your taste:** seeds from your Spotify and YouTube likes and playlists, or import links and screenshots (read with Claude).
- **Accounts are optional:** with Supabase you get Google / magic-link sign-in and sync across devices. Without it, everything stays in your browser.

## Quickstart (about 10 minutes)

You need Node 20+ and at least one voice or music key (see [setup guides](#setup-guides)).

```bash
git clone https://github.com/lonkarabhishek/ai-rj.git
cd ai-rj
npm install
cp .env.example .env.local   # fill in the keys you have
npm run dev -- -H 127.0.0.1
```

Open http://127.0.0.1:3000 (use `127.0.0.1`, not `localhost`, because Spotify login needs it).

Minimum useful setup: `ANTHROPIC_API_KEY` + `AZURE_SPEECH_KEY` + either Spotify or Google/YouTube keys. With no keys at all the app still opens and uses template lines plus browser speech, but you'll have no music.

### Deploy to Vercel

[![Deploy with Vercel](https://vercel.com/button)](https://vercel.com/new/clone?repository-url=https%3A%2F%2Fgithub.com%2Flonkarabhishek%2Fai-rj&env=ANTHROPIC_API_KEY,AZURE_SPEECH_KEY,AZURE_SPEECH_REGION,SPOTIFY_CLIENT_ID,SPOTIFY_CLIENT_SECRET,SPOTIFY_REDIRECT_URI,GOOGLE_CLIENT_ID,GOOGLE_CLIENT_SECRET,NEXT_PUBLIC_SUPABASE_URL,NEXT_PUBLIC_SUPABASE_ANON_KEY,SUPABASE_SERVICE_ROLE_KEY,TOKEN_ENCRYPTION_KEY&envDescription=Fill%20in%20what%20you%20need%2C%20leave%20the%20rest%20blank.%20See%20.env.example&envLink=https%3A%2F%2Fgithub.com%2Flonkarabhishek%2Fai-rj%2Fblob%2Fmain%2F.env.example&project-name=myrj&repository-name=myrj)

Vercel will ask for each variable; blank is fine for services you skip. After deploying, set `SPOTIFY_REDIRECT_URI` to `https://YOUR-APP.vercel.app/api/auth/callback/spotify` and add the same URLs in the Spotify, Google and Supabase dashboards (below), then redeploy.

## Setup guides

All variables are listed with comments in [`.env.example`](.env.example).

| Service | Needed for | Required? |
| --- | --- | --- |
| Anthropic (Claude) | RJ scripts, language labels, import | Recommended (templates otherwise) |
| Azure Speech | RJ voice | Recommended (browser voice otherwise) |
| Spotify | Spotify playback | One music source needed |
| Google / YouTube | YouTube playback | One music source needed |
| Supabase | Accounts and sync | Optional |

### Anthropic
1. Create a key at https://console.anthropic.com.
2. Set `ANTHROPIC_API_KEY`. Full breaks and show segments (stories, trivia, hot takes, callbacks, dedications) are written by Claude Sonnet 5.5 (`ANTHROPIC_MODEL_FULL` to change it), with Claude Haiku 5.5 as the fallback; short stingers and mode-switch lines use Haiku (`ANTHROPIC_MODEL` to change it). Romantic Hindi · Sensual uses Claude Opus 4.6 for every line (`ANTHROPIC_MODEL_SENSUAL`).

### Azure Speech (voice)
1. In the Azure Portal create a **Speech service** (the free F0 tier gives roughly 500k characters a month at the time of writing; check current pricing).
2. Copy **Key 1** and the **region** to `AZURE_SPEECH_KEY` and `AZURE_SPEECH_REGION`.
3. Optional: set `ELEVENLABS_API_KEY` to use ElevenLabs voices instead.

### Spotify
1. https://developer.spotify.com/dashboard → **Create app**. Tick *Web API* and *Web Playback SDK*.
2. Add Redirect URIs: `http://127.0.0.1:3000/api/auth/callback/spotify` and your deployed URL.
3. Copy the Client ID and Secret to `SPOTIFY_CLIENT_ID` / `SPOTIFY_CLIENT_SECRET`, and set `SPOTIFY_REDIRECT_URI`.
4. Add your own Spotify account under **Users and Access**.

> **Heads-up on Spotify's limits:** new apps run in *development mode*: at most **5 allow-listed users**, a request quota shared across all your apps, and playback needs **Premium**. If you hit a `429` with `QUOTA_EXCEEDED`, wait for the daily reset. This is exactly why MyRJ is meant to be **self-hosted for you and a few friends**, not run as one public service.

### Google / YouTube
1. https://console.cloud.google.com → new project → enable **YouTube Data API v3**.
2. **OAuth consent screen** → External. Scopes: `openid`, `email`, `profile`, `.../auth/youtube.readonly`. While the app is in *Testing*, **add yourself (and friends) as Test users**, otherwise Google blocks sign-in.
3. **Credentials → OAuth client ID → Web application.**
   - Origins: `http://127.0.0.1:3000` and your deployed URL.
   - Redirect URIs: `http://127.0.0.1:3000/api/auth/callback/youtube`, `https://YOUR-APP.vercel.app/api/auth/callback/youtube`, and, if you use Supabase Google sign-in, `https://YOUR-PROJECT.supabase.co/auth/v1/callback`.
4. Set `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET`.

> **YouTube quota:** the Data API gives **10,000 units a day** per project. A search costs 100 units, list calls cost 1. That's plenty for personal use and limits how many fresh sessions a day a shared deployment can serve. The video player must stay visible (YouTube's rule), and on phones playback stops when the screen locks. Sign in to YouTube Premium in the same browser for no ads.

### Supabase (optional)
1. Create a project at https://supabase.com.
2. Run the migration in [`supabase/migrations/20261014000000_accounts.sql`](supabase/migrations/20261014000000_accounts.sql) (SQL Editor, or `supabase db push`). It creates `profiles`, `taste_seeds` and `provider_tokens` with row level security. `provider_tokens` is server-only.
3. Set `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY` (publishable key), `SUPABASE_SERVICE_ROLE_KEY` (secret key, server only) and `TOKEN_ENCRYPTION_KEY` (`openssl rand -base64 32`, set once, never change).
4. Authentication → Providers → **Google**: paste your Google client ID and secret.
5. Authentication → URL Configuration: set **Site URL** to your deployed URL and add `…/auth/callback` (and `http://127.0.0.1:3000/auth/callback`) to Redirect URLs.
6. Magic-link emails use Supabase's built-in mailer, which is heavily rate limited. Add custom SMTP before inviting people.

## Recommended voices

MyRJ uses [Azure neural voices](https://learn.microsoft.com/azure/ai-services/speech-service/language-support?tabs=tts). These names were checked against Azure's live voice list (`/cognitiveservices/voices/list`) and all exist. Pick calm voices for a soothing RJ.

| Language | Female (calm, default first) | Male option |
| --- | --- | --- |
| Hindi | `hi-IN-SwaraNeural` (default), `hi-IN-AartiNeural` | `hi-IN-MadhurNeural`, `hi-IN-ArjunNeural` |
| English (India) | `en-IN-NeerjaNeural` (default), `en-IN-AartiNeural` | `en-IN-PrabhatNeural`, `en-IN-ArjunNeural` |
| Marathi | `mr-IN-AarohiNeural` (default) | `mr-IN-ManoharNeural` |
| English, multilingual | `en-US-AvaMultilingualNeural` | `en-US-AndrewMultilingualNeural` |

### Romantic Hindi presets

These two session presets bring their own voices (checked against Azure's live list in `centralindia`; all `hi-IN`). They need an Azure Speech key; with no key the browser's Hindi voice is used.

| Preset | Voice id | Why | SSML |
| --- | --- | --- | --- |
| Romantic Hindi · Masculine | `hi-IN-Dhruv:MAI-Voice-2.1-Flash` (fallback `hi-IN-KunalNeural`) | Deep, steady male voice (about 90 Hz median pitch in our samples, vs about 103 Hz for `hi-IN-MadhurNeural`) | pitch -5%, rate -8%, no style |
| Romantic Hindi · Sultry | `hi-IN-Priya:MAI-Voice-2.1-Flash` (fallback `hi-IN-AartiNeural`) | Lowest-pitched, warmest female `hi-IN` voice we tried, and its StyleList includes `softvoice` for the hushed, close-mic feel | `softvoice` style, pitch -3%, rate +8% (the style already slows delivery) |

The style is only added when the voice's live StyleList contains it. Other `hi-IN` voices worth trying in `ROMANTIC_MODES` (`src/lib/prefs.ts`): `hi-IN-KunalNeural` (deepest classic male), `hi-IN-Kavya:MAI-Voice-2.1-Flash` (female, supports `softvoice` and `whispering`), `hi-IN-AartiNeural`, `hi-IN-AnanyaNeural`. The `MAI-Voice` voices are newer Azure voices: check your region and pricing; if one fails MyRJ retries with the fallback voice.

`en-US-AvaNeural` and `en-US-JennyNeural` also exist in Azure and sound great, but MyRJ's picker only lists India-locale and multilingual voices. To add them, extend the filter in `listAzureVoices()` in `src/lib/tts.ts`.

**Switching voice:** there is no env var for it. Open **Settings → Voice** (tap ▶ to preview) and choose one; it's saved per browser, and per account if you sign in. The defaults per RJ language live in `defaultAzureVoice()` in `src/lib/tts.ts`. The region comes from `AZURE_SPEECH_REGION`. Setting `ELEVENLABS_API_KEY` adds ElevenLabs voices to the same picker.

## Cost notes

Designed to be free-tier friendly for one person: Vercel Hobby, Supabase free, Azure Speech free tier, and a small Claude Haiku model where one RJ line costs a fraction of a cent. Spotify and YouTube APIs are free but rate limited as described above. Check each provider's current pricing, since it changes.

## Testing

```bash
npm run build
npm run e2e        # builds, then runs Playwright against fake Spotify/YouTube/voice
```

First time: `npx playwright install chromium`. `npm run e2e:prod` runs a few checks against a deployed copy: `PROD_URL=https://your-app.vercel.app npm run e2e:prod`.

## Troubleshooting

- **RJ is silent / voice fails on iPhone:** iOS only allows audio after a tap. Use the **Go Live** button (it unlocks audio), don't reload mid-session, and make sure the phone isn't on silent mode.
- **Spotify says "not connected" or loops on 429:** open **Playback details** at the bottom of the live screen. `QUOTA_EXCEEDED` means Spotify's daily quota is used up; wait and retry. A 403 means your account isn't in **Users and Access**.
- **Spotify login redirect fails:** the redirect URI must match exactly and use `127.0.0.1` locally.
- **Google says "access blocked":** add your account as a **Test user** on the OAuth consent screen.
- **YouTube video won't play:** some uploads aren't embeddable; MyRJ skips them. Keep the player visible and on screen.
- **Mascot doesn't move with the voice:** voice-synced motion works on desktop Chrome/Edge; other browsers use a rhythm animation.
- **Anything else:** open **Playback details** and attach a screenshot to your issue.

## Contributing

Issues and PRs are welcome. See [CONTRIBUTING.md](CONTRIBUTING.md). Security reports: [SECURITY.md](SECURITY.md).

## Roadmap

- [ ] Apple Music source (MusicKit)
- [ ] More RJ voices and personalities
- [ ] More languages
- [ ] Installable PWA polish
- [ ] "Voice only" companion mode over your own music app
- [ ] Better offline / fallback behaviour

## License

[MIT](LICENSE). MyRJ doesn't host or redistribute any music. Playback goes through Spotify's and YouTube's official players under their terms; you're responsible for following those terms with your own accounts.
