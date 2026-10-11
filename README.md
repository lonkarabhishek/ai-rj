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
