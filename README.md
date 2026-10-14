# MyRJ — Personalized AI Radio Jockey

Your own AI Radio Jockey that actually knows you.

**MyRJ** speaks in the voice and energy you want, plays music from your taste (Spotify + others), shares only the news you care about, and cracks jokes matching your humor style.

Supported languages: **Hindi, English, Hinglish, Marathi**

## Tech Stack
- **Frontend**: Next.js (App Router) + Tailwind
- **Auth & Database**: Supabase
- **Music**: Spotify Web API + Web Playback SDK (plus playlist links / screenshots for other services)
- **Voice**: ElevenLabs
- **Script Generation**: LLM
- **Deploy**: Vercel

## Getting Started

1. Clone the repo
2. Copy `.env.example` to `.env.local` and fill in keys
3. `npm install`
4. `npm run dev`

## Status
Early scaffolding. Waiting on API keys to wire up live features.

## Roadmap
- [ ] User auth + full profile (music, interests, humor, voice, language)
- [ ] Spotify connect
- [ ] ElevenLabs voice generation (Hindi / English / Hinglish / Marathi)
- [ ] RJ script engine
- [ ] Music + voice mixing player
- [ ] Public shareable version on Vercel

## Single-user MVP (no login)

- `/settings`: RJ name, ElevenLabs voice, energy, language, humor, news topics, Spotify connect, saved non-Spotify playlist links. Stored in localStorage.
- `/live`: Go Live. Before each song the RJ speaks a short segment (intro of next track, a joke, 1-2 Google News headlines on your topics) via ElevenLabs `eleven_multilingual_v2`, then the song plays via the Spotify Web Playback SDK (Premium) or a 30s preview / "Open in Spotify" fallback.
- Scripts: template-based by default; set `OPENAI_API_KEY` (+ optional `LLM_BASE_URL`, `LLM_MODEL`) to use an LLM.

Run locally: `npm install && npm run dev -- -H 127.0.0.1`, then open http://127.0.0.1:3000 (use 127.0.0.1, not localhost, for Spotify login).

## Roadmap: scale phase

- **Multi-user accounts** (Supabase Auth: Google + email magic link), per-user prefs, taste seeds and Spotify tokens.
- **YouTube sign-in** (Google OAuth, `youtube.readonly`): pull liked videos and playlists as taste seeds.
- **Apple Music sign-in** (MusicKit JS): read library and playlists. Needs an Apple Developer account ($99/yr) and a MusicKit key.
- **Mobile apps** after the web version is loved.

## Accounts & YouTube setup

Logged-out use keeps working: everything is in localStorage until you sign in. On first sign-in the device's prefs and taste seeds are copied to the account; later sign-ins pull them down (settings from the account, seeds merged).

Database (already applied, `supabase/migrations/20261014000000_accounts.sql`):
- `profiles` (prefs jsonb) and `taste_seeds`: RLS, each user reads and writes only their own rows.
- `provider_tokens` (Spotify and Google refresh tokens, AES-256-GCM encrypted): RLS with no policies and no grants, so only the server (service role) can use it.

### Environment variables
| Var | Where |
| --- | --- |
| `NEXT_PUBLIC_SUPABASE_URL` | `https://efdyoljmudolwxsyhtxm.supabase.co` |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Supabase → Project Settings → API Keys → publishable key |
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase → API Keys → secret key (server only, never public) |
| `TOKEN_ENCRYPTION_KEY` | any long random string (`openssl rand -base64 32`); don't change it later |
| `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` | Google Cloud OAuth client (below) |
| `GOOGLE_REDIRECT_URI` | optional; defaults to `<origin>/api/auth/callback/youtube` |

### Google Cloud (one OAuth client serves both Google sign-in and YouTube)
1. console.cloud.google.com → new project "MyRJ".
2. APIs & Services → Library → enable **YouTube Data API v3**.
3. OAuth consent screen → External; app name, support email; scopes: `email`, `profile`, `openid`, `.../auth/youtube.readonly`; add yourself as a test user.
4. Credentials → Create OAuth client ID → Web application.
   - Authorized JavaScript origins: `https://ai-rj.vercel.app`, `http://127.0.0.1:3000`
   - Authorized redirect URIs:
     - `https://efdyoljmudolwxsyhtxm.supabase.co/auth/v1/callback` (Google sign-in via Supabase)
     - `https://ai-rj.vercel.app/api/auth/callback/youtube`
     - `http://127.0.0.1:3000/api/auth/callback/youtube`
5. Copy the client ID and secret.

### Supabase dashboard
1. Authentication → Sign In / Providers → **Google**: enable, paste the client ID and secret.
2. Email is on by default (magic link). The built-in mailer is rate-limited (a few emails per hour). Add custom SMTP (for example Resend) before inviting people.
3. Authentication → URL Configuration: Site URL `https://ai-rj.vercel.app`; Redirect URLs `https://ai-rj.vercel.app/auth/callback`, `http://127.0.0.1:3000/auth/callback`.
