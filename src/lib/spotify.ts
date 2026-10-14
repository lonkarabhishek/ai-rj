import { cookies } from "next/headers";
import { currentUserId } from "@/lib/supabase/server";
import { loadProviderToken, saveProviderToken } from "@/lib/tokens";

export const SCOPES = [
  "user-read-email", "user-read-private", "user-top-read", "user-library-read",
  "playlist-read-private", "playlist-read-collaborative",
  "streaming", "user-read-playback-state", "user-modify-playback-state",
].join(" ");

// Computed per request (never at module load) so builds work without env vars.
export function cookieOpts() {
  return { httpOnly: true, sameSite: "lax" as const, secure: (process.env.SPOTIFY_REDIRECT_URI ?? "").startsWith("https://"), path: "/" };
}

function basic() {
  return "Basic " + Buffer.from(`${process.env.SPOTIFY_CLIENT_ID}:${process.env.SPOTIFY_CLIENT_SECRET}`).toString("base64");
}

export async function tokenRequest(params: Record<string, string>) {
  const res = await fetch("https://accounts.spotify.com/api/token", {
    method: "POST",
    headers: { Authorization: basic(), "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(params),
  });
  if (!res.ok) throw new Error(`Spotify token error ${res.status}`);
  return (await res.json()) as { access_token: string; expires_in: number; refresh_token?: string };
}

/** Returns a valid access token, refreshing via the refresh-token cookie when needed. */
export async function getAccessToken(force = false): Promise<string | null> {
  const jar = await cookies();
  const at = jar.get("sp_at")?.value;
  if (at && !force) return at;
  let rt = jar.get("sp_rt")?.value;
  let uid: string | null = null;
  if (!rt) {
    // Signed in on a new device/browser: use the Spotify link stored on the account.
    uid = await currentUserId();
    const stored = uid ? await loadProviderToken(uid, "spotify") : null;
    if (!stored) return null;
    rt = stored.refreshToken;
    if (stored.scope) jar.set("sp_scope", stored.scope, { ...cookieOpts(), maxAge: 60 * 60 * 24 * 60 });
  }
  const t = await tokenRequest({ grant_type: "refresh_token", refresh_token: rt });
  jar.set("sp_at", t.access_token, { ...cookieOpts(), maxAge: t.expires_in - 60 });
  jar.set("sp_rt", t.refresh_token ?? rt, { ...cookieOpts(), maxAge: 60 * 60 * 24 * 60 });
  if (t.refresh_token && t.refresh_token !== rt) {
    uid ??= await currentUserId();
    if (uid) await saveProviderToken(uid, "spotify", t.refresh_token, jar.get("sp_scope")?.value);
  }
  return t.access_token;
}
