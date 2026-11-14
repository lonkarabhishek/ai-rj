import { NextResponse, type NextRequest } from "next/server";
import { cookieOpts } from "@/lib/spotify";
import { currentUserId } from "@/lib/supabase/server";
import { saveProviderToken } from "@/lib/tokens";
import { googleToken, ytRedirect } from "@/lib/youtube";

export async function GET(req: NextRequest) {
  const u = new URL(req.url);
  const saved = req.cookies.get("yt_return")?.value ?? "";
  const back = /^\/(?!\/)[a-z0-9/_?=&%.-]*$/i.test(saved) ? saved : "/settings"; // same-site path only (never an open redirect)
  const sep = back.includes("?") ? "&" : "?";
  const code = u.searchParams.get("code");
  if (!code || u.searchParams.get("state") !== req.cookies.get("yt_state")?.value) return NextResponse.redirect(`${u.origin}${back}${sep}youtube=error`);
  try {
    const t = await googleToken({ grant_type: "authorization_code", code, redirect_uri: ytRedirect(u.origin) });
    const res = NextResponse.redirect(`${u.origin}${back}${sep}youtube=connected`);
    res.cookies.delete("yt_state"); res.cookies.delete("yt_return");
    res.cookies.set("yt_at", t.access_token, { ...cookieOpts(), maxAge: t.expires_in - 60 });
    if (t.refresh_token) {
      res.cookies.set("yt_rt", t.refresh_token, { ...cookieOpts(), maxAge: 60 * 60 * 24 * 180 });
      const uid = await currentUserId();
      if (uid) await saveProviderToken(uid, "google", t.refresh_token, t.scope);
    }
    return res;
  } catch (e) {
    console.error("youtube callback", e instanceof Error ? e.message : "error");
    return NextResponse.redirect(`${u.origin}${back}${sep}youtube=error`);
  }
}
