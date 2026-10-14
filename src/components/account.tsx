"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import type { User } from "@supabase/supabase-js";
import { supabaseBrowser } from "@/lib/supabase/browser";
import { DEFAULT_PREFS, loadPrefs, savePrefs, type Prefs, type TrackInfo } from "@/lib/prefs";
import { Button } from "@/components/ui";

export function useUser() {
  const [user, setUser] = useState<User | null>(null);
  const [ready, setReady] = useState(false);
  useEffect(() => {
    const sb = supabaseBrowser();
    if (!sb) { setReady(true); return; }
    sb.auth.getUser().then(({ data }) => { setUser(data.user); setReady(true); });
    const { data } = sb.auth.onAuthStateChange((_e, s) => setUser(s?.user ?? null));
    return () => data.subscription.unsubscribe();
  }, []);
  return { user, ready, enabled: !!supabaseBrowser() };
}

const stripSeeds = (p: Prefs) => { const { tasteSeeds: _s, ...rest } = p; void _s; return rest; };

/**
 * Keeps localStorage prefs and the signed-in account in sync.
 * First login on a device with no account prefs yet: local prefs + seeds are migrated up.
 * Otherwise the account wins for settings; taste seeds are unioned. Logged-out use is untouched.
 */
export function AccountSync() {
  const { user } = useUser();
  useEffect(() => {
    const sb = supabaseBrowser();
    if (!sb || !user) return;
    let alive = true, ready = false, applying = false, timer: ReturnType<typeof setTimeout> | undefined;
    const uid = user.id;

    async function pushSeeds(seeds: TrackInfo[]) {
      const rows = seeds.filter((t) => t.uri).map((t) => ({ user_id: uid, uri: t.uri!, track: t }));
      if (rows.length) await sb!.from("taste_seeds").upsert(rows, { onConflict: "user_id,uri" });
      const keep = rows.map((r) => `"${r.uri.replace(/"/g, "")}"`).join(",");
      const del = sb!.from("taste_seeds").delete().eq("user_id", uid);
      await (keep ? del.not("uri", "in", `(${keep})`) : del);
    }
    async function push() {
      const p = loadPrefs();
      await sb!.from("profiles").upsert({ id: uid, display_name: p.listenerName || null, prefs: stripSeeds(p), updated_at: new Date().toISOString() });
      await pushSeeds(p.tasteSeeds);
    }
    (async () => {
      const [{ data: prof }, { data: seeds }] = await Promise.all([
        sb.from("profiles").select("prefs").eq("id", uid).maybeSingle(),
        sb.from("taste_seeds").select("track").eq("user_id", uid).order("created_at", { ascending: false }).limit(300),
      ]);
      if (!alive) return;
      const local = loadPrefs();
      if (!prof?.prefs) {
        await push(); // first login: migrate this device's setup to the account
      } else {
        const remoteSeeds = (seeds ?? []).map((r) => r.track as TrackInfo);
        const have = new Set(remoteSeeds.map((t) => t.uri));
        const merged: Prefs = { ...DEFAULT_PREFS, ...(prof.prefs as Partial<Prefs>), tasteSeeds: [...remoteSeeds, ...local.tasteSeeds.filter((t) => t.uri && !have.has(t.uri))].slice(0, 300) };
        applying = true; savePrefs(merged); applying = false;
        if (merged.tasteSeeds.length !== remoteSeeds.length) await pushSeeds(merged.tasteSeeds);
      }
      ready = true;
    })().catch((e) => console.warn("account sync failed", e));

    const onChange = () => {
      if (!ready || applying) return;
      clearTimeout(timer); timer = setTimeout(() => push().catch(() => {}), 1200);
    };
    window.addEventListener("myrj:prefs", onChange);
    return () => { alive = false; clearTimeout(timer); window.removeEventListener("myrj:prefs", onChange); };
  }, [user]);
  return null;
}

/** Settings/drawer block: who you're signed in as, or an invite to sign in. */
export function AccountPanel({ returnTo = "/settings" }: { returnTo?: string }) {
  const { user, ready, enabled } = useUser();
  if (!enabled || !ready) return null;
  if (!user) return (
    <div className="glass flex items-center justify-between gap-4 rounded-2xl p-4">
      <p className="text-sm text-zinc-400">Sign in to keep your RJ, voice and music on every device.</p>
      <Link href={`/login?next=${encodeURIComponent(returnTo)}`} className="shrink-0 rounded-full bg-white px-4 py-2 text-sm font-medium text-black">Sign in</Link>
    </div>
  );
  return (
    <div className="glass flex items-center justify-between gap-4 rounded-2xl p-4">
      <div className="min-w-0">
        <p className="truncate text-sm text-white">{user.user_metadata?.full_name ?? user.email}</p>
        <p className="truncate text-xs text-zinc-500">{user.email} · synced</p>
      </div>
      <Button variant="ghost" className="h-9 px-4 text-sm" onClick={async () => { await supabaseBrowser()?.auth.signOut(); }}>Sign out</Button>
    </div>
  );
}
