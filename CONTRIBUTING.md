# Contributing to MyRJ

Thanks for helping! MyRJ is a small, friendly side project.

## Getting set up
1. Fork and clone, then `npm install`.
2. `cp .env.example .env.local` and add the keys you have (see the README).
3. `npm run dev -- -H 127.0.0.1`

## Before you open a PR
- `npm run lint`, `npm run build` and `npm run e2e` should pass (`npx playwright install chromium` the first time). The e2e tests use fake Spotify/YouTube/voice, so they need no real keys.
- Keep PRs focused, with a short description and a screenshot for UI changes.
- Add or update an e2e test for behaviour changes where it's practical.

## Ground rules
- **Never commit secrets** (`.env*` is git-ignored). Never paste real keys in issues.
- Don't add anything that downloads, rips or redistributes music. Playback must go through official players.
- Be kind. Assume good intent.

## Ideas
See the roadmap in the README, or open an issue to chat first.
