"use client";
import { Mascot } from "@/components/Mascot";
import { useRouter } from "next/navigation";
import { useEffect } from "react";
import { isOnboarded, loadPrefs } from "@/lib/prefs";

export default function Home() {
  const router = useRouter();
  useEffect(() => { router.replace(isOnboarded(loadPrefs()) ? "/live" : "/welcome"); }, [router]);
  return (
    <main className="ambient flex min-h-dvh items-center justify-center">
      <Mascot className="h-16 w-16" />
    </main>
  );
}
