"use client";
import Link from "next/link";
import { Suspense, useState } from "react";
import { useSearchParams } from "next/navigation";
import { supabaseBrowser } from "@/lib/supabase/browser";
import { Button, inputCls } from "@/components/ui";

function LoginInner() {
  const q = useSearchParams();
  const next = q.get("next") ?? "/live";
  const [email, setEmail] = useState("");
  const [state, setState] = useState<"" | "sending" | "sent">("");
  const [err, setErr] = useState(q.get("error") ?? "");
  const sb = supabaseBrowser();
  const redirectTo = () => `${location.origin}/auth/callback?next=${encodeURIComponent(next)}`;

  async function google() {
    setErr("");
    const { error } = await sb!.auth.signInWithOAuth({ provider: "google", options: { redirectTo: redirectTo() } });
    if (error) setErr(error.message);
  }
  async function magic(e: React.FormEvent) {
    e.preventDefault(); setErr(""); setState("sending");
    const { error } = await sb!.auth.signInWithOtp({ email: email.trim(), options: { emailRedirectTo: redirectTo() } });
    if (error) { setErr(error.message); setState(""); } else setState("sent");
  }

  return (
    <main className="ambient mx-auto flex min-h-dvh w-full max-w-sm flex-col justify-center px-6">
      <Link href="/live" className="absolute left-6 top-8 text-sm text-zinc-500 hover:text-white">← Radio</Link>
      <h1 className="fade-up text-4xl font-semibold tracking-tight">Sign in</h1>
      <p className="fade-up mt-3 text-zinc-400">Keep your RJ, voice and music in sync on every device. Your current setup comes with you.</p>
      {!sb ? <p className="mt-8 text-sm text-amber-300">Accounts aren&apos;t configured on this server yet.</p> : state === "sent" ? (
        <div className="glass fade-up mt-10 rounded-2xl p-5">
          <p className="text-white">Check your inbox</p>
          <p className="mt-1 text-sm text-zinc-400">We sent a sign-in link to {email}. Open it on this device.</p>
        </div>
      ) : (
        <div className="fade-up mt-10 space-y-6">
          <Button className="w-full" onClick={google}>
            <svg width="18" height="18" viewBox="0 0 48 48" aria-hidden><path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3C33.7 32.7 29.2 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3 0 5.8 1.1 7.9 3l5.7-5.7C34 6.1 29.3 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.4-.4-3.5z"/><path fill="#FF3D00" d="m6.3 14.7 6.6 4.8C14.7 15.1 19 12 24 12c3 0 5.8 1.1 7.9 3l5.7-5.7C34 6.1 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7z"/><path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.2 35.1 26.7 36 24 36c-5.2 0-9.6-3.3-11.3-8l-6.5 5C9.5 39.6 16.2 44 24 44z"/><path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.2-2.2 4.2-4.1 5.6l6.2 5.2C37 39.2 44 34 44 24c0-1.3-.1-2.4-.4-3.5z"/></svg>
            Continue with Google
          </Button>
          <div className="flex items-center gap-3 text-xs text-zinc-600"><span className="h-px flex-1 bg-white/10" />or<span className="h-px flex-1 bg-white/10" /></div>
          <form onSubmit={magic} className="space-y-3">
            <input type="email" required value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@email.com" className={inputCls} />
            <Button variant="ghost" type="submit" className="w-full border border-white/10" disabled={state === "sending"}>{state === "sending" ? "Sending…" : "Email me a magic link"}</Button>
          </form>
        </div>
      )}
      {err && <p className="mt-6 text-sm text-rose-300">{err}</p>}
      <Link href="/live" className="mt-10 text-center text-sm text-zinc-500 hover:text-white">Continue without an account</Link>
    </main>
  );
}
export default function Login() { return <Suspense><LoginInner /></Suspense>; }
