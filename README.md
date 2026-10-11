# AI RJ — Personalized AI Radio Jockey

A web app where every user gets their own AI Radio Jockey.

The RJ:
- Speaks in a voice and energy you choose (via ElevenLabs)
- Plays music from your Spotify playlists and history
- Shares only the news and topics you care about
- Cracks jokes matching your sense of humor

## Tech Stack
- **Frontend**: Next.js (App Router) + Tailwind
- **Auth & Database**: Supabase
- **Music**: Spotify Web API + Web Playback SDK
- **Voice**: ElevenLabs
- **Script Generation**: LLM (Grok preferred)

## Getting Started

1. Clone the repo
2. Copy `.env.example` to `.env.local` and fill in keys
3. `npm install`
4. `npm run dev`

## Status
Early scaffolding. Building the core personalization + radio experience.

## Roadmap
- [ ] User auth + profile
- [ ] Spotify connect
- [ ] ElevenLabs voice generation
- [ ] RJ script engine
- [ ] Music + voice mixing player
- [ ] Shareable public version
