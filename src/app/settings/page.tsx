"use client";
import Link from "next/link";
import { AllPrefs, usePrefs } from "@/components/prefs";

export default function Settings() {
  const [p, up, loaded] = usePrefs();
  return (
    <main className="ambient mx-auto w-full max-w-xl px-5 pb-[calc(8rem+env(safe-area-inset-bottom))] pt-[max(2rem,env(safe-area-inset-top))] sm:px-6">
      <header className="mb-10 flex items-center justify-between">
        <Link href="/live" className="text-sm text-zinc-500 hover:text-white">← Radio</Link>
        <span className="text-xs text-zinc-600">Saved automatically</span>
      </header>
      <h1 className="mb-8 text-3xl sm:mb-10 sm:text-4xl font-semibold tracking-tight">Settings</h1>
      {loaded && <div className="fade-up"><AllPrefs p={p} up={up} returnTo="/settings" /></div>}
      <div className="fixed inset-x-0 bottom-0 bg-gradient-to-t from-[#060607] via-[#060607]/90 to-transparent px-5 pb-[max(1.5rem,env(safe-area-inset-bottom))] pt-10 sm:px-6">
        <Link href="/live" className="mx-auto flex h-14 max-w-xl items-center justify-center rounded-full bg-white text-[15px] font-medium text-black active:scale-[0.98]">Go Live</Link>
      </div>
    </main>
  );
}
