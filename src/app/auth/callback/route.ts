import { NextResponse, type NextRequest } from "next/server";
import { supabaseServer } from "@/lib/supabase/server";

/** Supabase Auth redirect target for Google sign-in and email magic links (PKCE code exchange). */
export async function GET(req: NextRequest) {
  const u = new URL(req.url);
  const next = u.searchParams.get("next");
  const dest = next && next.startsWith("/") && !next.startsWith("//") ? next : "/live";
  const code = u.searchParams.get("code");
  const sb = await supabaseServer();
  if (code && sb) {
    const { error } = await sb.auth.exchangeCodeForSession(code);
    if (!error) return NextResponse.redirect(`${u.origin}${dest}${dest.includes("?") ? "&" : "?"}signedin=1`);
  }
  return NextResponse.redirect(`${u.origin}/login?error=${encodeURIComponent(u.searchParams.get("error_description") ?? "Sign-in link expired or invalid")}`);
}
