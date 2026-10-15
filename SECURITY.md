# Security

MyRJ is self-hosted: you run it with your own keys.

- Keep `.env.local` and your Vercel environment variables private. `SUPABASE_SERVICE_ROLE_KEY`, `*_CLIENT_SECRET`, `ANTHROPIC_API_KEY`, `AZURE_SPEECH_KEY` and `TOKEN_ENCRYPTION_KEY` are server-only.
- Stored Spotify/Google refresh tokens are AES-256-GCM encrypted with `TOKEN_ENCRYPTION_KEY` and sit in a table with no client access.
- If a key leaks, rotate it at the provider right away.

## Reporting a vulnerability
Please don't open a public issue. Use GitHub's **Security → Report a vulnerability** (private advisory) on this repo. Include steps to reproduce and we'll respond as soon as we can.
