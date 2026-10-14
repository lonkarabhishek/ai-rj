"use client";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useState } from "react";
import { EnergyPicker, HumorPicker, LanguagePicker, ModePicker, NameFields, SpotifyConnect, TopicsEditor, VoicePicker, usePrefs } from "@/components/prefs";
import { Button, cx } from "@/components/ui";

const STEPS = ["welcome", "names", "language", "voice", "energy", "humor", "news", "spotify", "mode"] as const;
const COPY: Record<(typeof STEPS)[number], { title: string; sub: string }> = {
  welcome: { title: "Your own radio.\nHosted by your own RJ.", sub: "Music you love, news you care about, jokes in your humor. Takes a minute to set up." },
  names: { title: "First, introductions.", sub: "Name your RJ, and tell them what to call you." },
  language: { title: "Which language feels like home?", sub: "Your RJ will talk to you in this." },
  voice: { title: "Pick a voice.", sub: "Tap ▶ to preview. You can change it anytime." },
  energy: { title: "How much energy?", sub: "Morning chai or full stadium." },
  humor: { title: "What's your humor?", sub: "Your RJ drops a joke between songs." },
  news: { title: "What should you never miss?", sub: "One or two headlines between songs, only on these." },
  spotify: { title: "Bring your music.", sub: "MyRJ curates from your Spotify: top tracks, likes, playlists and new finds. Premium plays full songs." },
  mode: { title: "Your usual vibe?", sub: "You can switch modes anytime while live." },
};

function Flow() {
  const router = useRouter();
  const sp = useSearchParams();
  const [p, up, loaded] = usePrefs();
  const [i, setI] = useState(() => Math.max(0, STEPS.indexOf((sp.get("step") ?? "welcome") as (typeof STEPS)[number])));
  const step = STEPS[i];
  useEffect(() => { if (loaded) window.history.replaceState(null, "", `/welcome?step=${step}`); }, [step, loaded]);

  const next = () => {
    if (i < STEPS.length - 1) return setI(i + 1);
    up("onboarded", true);
    router.push("/live?autostart=1");
  };
  const canNext = step !== "names" || (p.rjName.trim() && p.listenerName.trim());
  if (!loaded) return null;

  return (
    <main className="ambient mx-auto flex min-h-dvh w-full max-w-lg flex-col px-6 pb-8 pt-6">
      <div className="flex items-center gap-1.5">
        {STEPS.map((s, j) => <span key={s} className={cx("h-1 flex-1 rounded-full transition-colors duration-500", j <= i ? "bg-white" : "bg-white/10")} />)}
      </div>
      <div className="flex h-12 items-center justify-between">
        {i > 0 ? <button onClick={() => setI(i - 1)} className="text-sm text-zinc-500 hover:text-white">← Back</button> : <span />}
        {i > 0 && i < STEPS.length - 1 && <button onClick={next} className="text-sm text-zinc-600 hover:text-white">Skip</button>}
      </div>

      <div key={step} className="fade-up flex flex-1 flex-col">
        <div className={cx(step === "welcome" ? "mt-[18vh]" : "mt-6", "mb-8")}>
          {step === "welcome" && <div className="breathe mb-8 h-16 w-16 rounded-2xl bg-gradient-to-br from-fuchsia-500 to-violet-600 shadow-[0_10px_40px_-10px] shadow-fuchsia-500/60" />}
          <h1 className="whitespace-pre-line text-[32px] font-semibold leading-[1.1] tracking-tight">{COPY[step].title}</h1>
          <p className="mt-3 text-[15px] leading-relaxed text-zinc-400">{COPY[step].sub}</p>
        </div>
        <div className="flex-1">
          {step === "names" && <NameFields p={p} up={up} />}
          {step === "language" && <LanguagePicker p={p} up={up} />}
          {step === "voice" && <VoicePicker p={p} up={up} />}
          {step === "energy" && <EnergyPicker p={p} up={up} />}
          {step === "humor" && <HumorPicker p={p} up={up} />}
          {step === "news" && <TopicsEditor p={p} up={up} />}
          {step === "spotify" && <SpotifyConnect returnTo="/welcome?step=spotify" />}
          {step === "mode" && <ModePicker value={p.defaultMode} onChange={(m) => up("defaultMode", m)} />}
        </div>
      </div>

      <Button variant={step === "mode" ? "light" : "primary"} className="mt-8 h-14 w-full" onClick={next} disabled={!canNext}>
        {step === "welcome" ? "Let's go" : step === "mode" ? "Go Live" : "Continue"}
      </Button>
    </main>
  );
}

export default function Welcome() {
  return <Suspense><Flow /></Suspense>;
}
