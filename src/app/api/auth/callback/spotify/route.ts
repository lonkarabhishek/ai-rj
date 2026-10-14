import { NextResponse, type NextRequest } from "next/server";
import { cookieOpts, tokenRequest } from "@/lib/spotify";

export async function GET(req: NextRequest) {
  const u = new URL(req.url);
  const origin = new URL(process.env.SPOTIFY_REDIRECT_URI ?? req.url).origin;
  const code = u.searchParams.get("code");
  const state = u.searchParams.get("state");
  if (!code || !state || state !== req.cookies.get("sp_state")?.value) {
    return NextResponse.redirect(`${origin}/settings?spotify=error`);
  }
  try {
    const t = await tokenRequest({ grant_type: "authorization_code", code, redirect_uri: process.env.SPOTIFY_REDIRECT_URI! });
    const res = NextResponse.redirect(`${origin}/settings?spotify=connected`);
    res.cookies.delete("sp_state");
    res.cookies.set("sp_at", t.access_token, { ...cookieOpts(), maxAge: t.expires_in - 60 });
    res.cookies.set("sp_scope", (t as { scope?: string }).scope ?? "", { ...cookieOpts(), maxAge: 60 * 60 * 24 * 60 });
    if (t.refresh_token) res.cookies.set("sp_rt", t.refresh_token, { ...cookieOpts(), maxAge: 60 * 60 * 24 * 60 });
    return res;
  } catch {
    return NextResponse.redirect(`${origin}/settings?spotify=error`);
  }
}
