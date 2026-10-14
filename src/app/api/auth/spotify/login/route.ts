import { NextResponse } from "next/server";
import { randomBytes } from "crypto";
import { SCOPES, cookieOpts } from "@/lib/spotify";

export async function GET(req: Request) {
  const redirectUri = process.env.SPOTIFY_REDIRECT_URI;
  if (!redirectUri || !process.env.SPOTIFY_CLIENT_ID) return Response.json({ error: "Spotify env vars not set" }, { status: 500 });
  const target = new URL(redirectUri);
  const host = req.headers.get("host") ?? new URL(req.url).host;
  // Cookies are per-host: keep the whole flow on the redirect URI's host (e.g. 127.0.0.1 vs localhost).
  if (host !== target.host) return NextResponse.redirect(`${target.origin}/api/auth/spotify/login`);
  const state = randomBytes(16).toString("hex");
  const q = new URLSearchParams({ response_type: "code", client_id: process.env.SPOTIFY_CLIENT_ID, scope: SCOPES, redirect_uri: redirectUri, state });
  const res = NextResponse.redirect(`https://accounts.spotify.com/authorize?${q}`);
  res.cookies.set("sp_state", state, { ...cookieOpts(), maxAge: 600 });
  return res;
}
