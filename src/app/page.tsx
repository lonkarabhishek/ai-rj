"use client";
import { useRouter } from "next/navigation";
import { useEffect } from "react";
import { isOnboarded, loadPrefs } from "@/lib/prefs";

export default function Home() {
  const router = useRouter();
  useEffect(() => { router.replace(isOnboarded(loadPrefs()) ? "/live" : "/welcome"); }, [router]);
  return (
    <main className="ambient flex min-h-dvh items-center justify-center">
      <div className="breathe h-14 w-14 rounded-2xl orb-tile" />
    </main>
  );
}
