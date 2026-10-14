import { NextResponse, type NextRequest } from "next/server";
import { randomBytes } from "crypto";
import { cookieOpts } from "@/lib/spotify";
import { YT_SCOPE, youtubeEnabled, ytRedirect } from "@/lib/youtube";

export async function GET(req: NextRequest) {
  const origin = new URL(req.url).origin;
  if (!youtubeEnabled()) return NextResponse.redirect(`${origin}/settings?youtube=unconfigured`);
  const back = req.nextUrl.searchParams.get("return") ?? "/settings";
  const state = randomBytes(16).toString("hex");
  const q = new URLSearchParams({
    client_id: process.env.GOOGLE_CLIENT_ID!, redirect_uri: ytRedirect(origin), response_type: "code",
    scope: YT_SCOPE, access_type: "offline", prompt: "consent", include_granted_scopes: "true", state,
  });
  const res = NextResponse.redirect(`https://accounts.google.com/o/oauth2/v2/auth?${q}`);
  res.cookies.set("yt_state", state, { ...cookieOpts(), maxAge: 600 });
  res.cookies.set("yt_return", back.startsWith("/") && !back.startsWith("//") ? back : "/settings", { ...cookieOpts(), maxAge: 600 });
  return res;
}
