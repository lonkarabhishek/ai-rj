"use client";
/* eslint-disable @typescript-eslint/no-explicit-any, @next/next/no-img-element */
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { loadPrefs, MODES, type ListenMode, type Prefs, type TrackInfo } from "@/lib/prefs";
import { Curator, getMe, getToken, sp } from "@/lib/spotifyClient";

declare global { interface Window { Spotify: any; onSpotifyWebPlaybackSDKReady: () => void } }

type Out = "sdk" | "preview" | "none";
type Phase = "idle" | "tuning" | "rj" | "song" | "waiting";
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const SONG_VOL = 0.85;

function loadSdk(): Promise<void> {
  return new Promise((resolve) => {
    if (window.Spotify) return resolve();
    window.onSpotifyWebPlaybackSDKReady = () => resolve();
    const s = document.createElement("script");
    s.src = "https://sdk.scdn.co/spotify-player.js";
    document.body.appendChild(s);
  });
}

interface Segment { script: string; audioUrl: string | null; track: TrackInfo | null }

export default function Live() {
  const [prefs, setPrefs] = useState<Prefs | null>(null);
  const [listenMode, setListenMode] = useState<ListenMode>("default");
  const [phase, setPhase] = useState<Phase>("idle");
  const [status, setStatus] = useState("Pick a vibe and tap Go Live.");
  const [script, setScript] = useState("");
  const [now, setNow] = useState<TrackInfo | null>(null);
  const [upNext, setUpNext] = useState<TrackInfo | null>(null);
  const [progress, setProgress] = useState(0);
  const [out, setOut] = useState<Out>("none");

  const stopRef = useRef(false);
  const skipRef = useRef<() => void>(() => {});
  const playerRef = useRef<any>(null);
  const deviceRef = useRef<string | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const modeRef = useRef<ListenMode>("default");
  const curatorRef = useRef<Curator | null>(null);
  const recentRef = useRef<string[]>([]);

  useEffect(() => {
    setPrefs(loadPrefs());
    return () => { stopRef.current = true; playerRef.current?.disconnect(); audioRef.current?.pause(); };
  }, []);

  const md = () => MODES.find((x) => x.id === modeRef.current)!;
  const effPrefs = (): Prefs => { const b = loadPrefs(); return { ...b, energy: md().energy ?? b.energy }; };

  function changeMode(m: ListenMode) {
    setListenMode(m); modeRef.current = m;
    if (phase !== "idle" && out !== "none") {
      curatorRef.current = new Curator(m); // new vibe from the next song on
      setStatus(`Switching to ${MODES.find((x) => x.id === m)!.label}. Next song follows the new vibe.`);
    }
  }

  // ---------- audio helpers ----------
  function fadeEl(a: HTMLAudioElement, to: number, ms: number) {
    return new Promise<void>((res) => {
      const from = a.volume, steps = 15;
      let i = 0;
      const t = setInterval(() => { i++; a.volume = Math.max(0, Math.min(1, from + (to - from) * (i / steps))); if (i >= steps) { clearInterval(t); res(); } }, ms / steps);
    });
  }
  async function fadeSdk(to: number, ms: number) {
    const pl = playerRef.current; if (!pl) return;
    const from = (await pl.getVolume().catch(() => SONG_VOL)) as number, steps = 10;
    for (let i = 1; i <= steps; i++) { await pl.setVolume(Math.max(0.0001, from + (to - from) * (i / steps))).catch(() => {}); await sleep(ms / steps); }
  }
  function playClip(url: string, opts: { maxMs?: number; fadeIn?: boolean } = {}) {
    return new Promise<void>((resolve) => {
      const a = new Audio(url);
      audioRef.current = a;
      a.volume = opts.fadeIn ? 0 : 1;
      let done = false;
      const finish = async (fade = false) => { if (done) return; done = true; if (fade) await fadeEl(a, 0, 1200); a.pause(); resolve(); };
      a.onended = () => finish(); a.onerror = () => finish();
      a.ontimeupdate = () => { if (a.duration) setProgress(a.currentTime / a.duration); };
      skipRef.current = () => finish(true);
      if (opts.maxMs) setTimeout(() => finish(true), opts.maxMs);
      a.play().then(() => { if (opts.fadeIn) fadeEl(a, 1, 1500); }).catch(() => finish());
    });
  }

  // ---------- segment prefetch ----------
  async function buildSegment(p: Prefs, next: TrackInfo | null, prev: TrackInfo | null, index: number): Promise<Segment> {
    const seg = await fetch("/api/segment", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ prefs: p, next, prev, index, mode: modeRef.current, recent: recentRef.current.slice(-4) }),
    }).then((r) => r.json());
    recentRef.current.push(seg.script);
    let audioUrl: string | null = null;
    const r = await fetch("/api/tts", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ text: seg.script, voiceId: p.voiceId, energy: p.energy }) });
    if (r.ok) audioUrl = URL.createObjectURL(await r.blob());
    return { script: seg.script, audioUrl, track: next };
  }

  // ---------- spotify ----------
  async function setupSpotify(): Promise<Out> {
    try {
      const me = await getMe();
      if (me.product !== "premium") return "preview";
      await loadSdk();
      const player = new window.Spotify.Player({ name: "MyRJ", getOAuthToken: async (cb: (t: string) => void) => cb((await getToken()) ?? ""), volume: SONG_VOL });
      playerRef.current = player;
      const id = await new Promise<string | null>((res) => {
        player.addListener("ready", ({ device_id }: any) => res(device_id));
        ["account_error", "authentication_error", "initialization_error"].forEach((e) => player.addListener(e, () => res(null)));
        player.connect();
        setTimeout(() => res(null), 15000);
      });
      deviceRef.current = id;
      return id ? "sdk" : "preview";
    } catch { return "none"; }
  }

  /** Plays a song; resolves ~3s before the end (after a fade) so the RJ can come in with no gap. */
  async function playSong(t: TrackInfo, o: Out) {
    setNow(t); setProgress(0);
    if (o === "sdk" && t.uri) {
      setPhase("song"); setStatus("Now playing");
      await playerRef.current.activateElement?.();
      await playerRef.current.setVolume(0.0001).catch(() => {});
      await sp(`/me/player/play?device_id=${deviceRef.current}`, { method: "PUT", body: JSON.stringify({ uris: [t.uri] }) });
      fadeSdk(SONG_VOL, 1500);
      let skipped = false, started = false;
      skipRef.current = () => { skipped = true; };
      const deadline = Date.now() + (t.durationMs ?? 240000) + 10000;
      while (!stopRef.current && !skipped && Date.now() < deadline) {
        await sleep(700);
        const st = await playerRef.current.getCurrentState();
        if (!st) continue;
        if (!st.paused) started = true;
        if (st.duration) setProgress(st.position / st.duration);
        if (started && st.paused && st.position === 0) break;
        if (st.duration && st.position >= st.duration - 3500) break;
      }
      await fadeSdk(0.0001, skipped ? 800 : 2500);
      await playerRef.current.pause().catch(() => {});
      return;
    }
    if (t.previewUrl) { setPhase("song"); setStatus("30s preview (full songs need Spotify Premium)"); return playClip(t.previewUrl, { maxMs: 29000, fadeIn: true }); }
    setPhase("waiting"); setStatus("No preview for this track. Open it in Spotify or tap Next.");
    return new Promise<void>((resolve) => { skipRef.current = resolve; setTimeout(resolve, 25000); });
  }

  // ---------- main loop ----------
  async function goLive() {
    const p = effPrefs(); setPrefs(p);
    if (!p.voiceId) { setStatus("Pick a voice in Settings first."); return; }
    stopRef.current = false; recentRef.current = [];
    setPhase("tuning"); setStatus("Tuning in…");
    new Audio().play().catch(() => {}); // unlock audio on this tap
    const o = await setupSpotify(); setOut(o);
    curatorRef.current = o !== "none" ? new Curator(modeRef.current) : null;
    const nextTrack = async () => (curatorRef.current ? curatorRef.current.next() : null);

    let prev: TrackInfo | null = null;
    let next = await nextTrack();
    let pending: Promise<Segment> | null = buildSegment(p, next, prev, 0);

    for (let i = 0; !stopRef.current; i++) {
      // RJ segment (already prefetched)
      if (pending) {
        try {
          const seg = await pending;
          if (stopRef.current) break;
          setScript(seg.script); setNow(null); setPhase("rj"); setStatus(`${p.rjName} on air`);
          if (seg.audioUrl) await playClip(seg.audioUrl); else await sleep(1500);
        } catch (e) { setStatus(String(e)); await sleep(2000); }
      }
      if (stopRef.current) break;
      if (!next) { setPhase("waiting"); setStatus("Connect Spotify in Settings for music."); await sleep(20000); pending = buildSegment(effPrefs(), null, prev, i + 1); continue; }

      // While the song plays: pick the following track and prefetch its RJ segment.
      const current = next;
      const following = nextTrack();
      const talkEvery = md().talkEvery;
      const willTalk = (i + 1) % talkEvery === 0;
      pending = null;
      const prefetch = following.then((t) => { setUpNext(t); return willTalk ? buildSegment(effPrefs(), t, current, i + 1) : null; });
      await playSong(current, o);
      prev = current;
      next = await following;
      pending = (await prefetch.catch(() => null)) ? prefetch.then((s) => s!) : null;
    }
  }

  function stop() {
    stopRef.current = true; skipRef.current();
    audioRef.current?.pause(); playerRef.current?.pause().catch(() => {});
    setPhase("idle"); setStatus("Off air. Tap Go Live to tune back in."); setNow(null);
  }

  const live = phase !== "idle";
  const mode = MODES.find((x) => x.id === listenMode)!;

  return (
    <main className="relative min-h-dvh w-full overflow-hidden">
      {now?.image && <img src={now.image} alt="" className="pointer-events-none absolute inset-0 h-full w-full scale-125 object-cover opacity-25 blur-3xl transition-opacity duration-1000" />}
      <div className="absolute inset-0 bg-gradient-to-b from-zinc-950/40 via-zinc-950/80 to-zinc-950" />
      <div className="relative mx-auto flex min-h-dvh w-full max-w-md flex-col gap-5 px-5 pb-8 pt-6">
        <header className="flex items-center justify-between text-sm">
          <Link href="/" className="font-bold tracking-tight">MyRJ</Link>
          <div className="flex items-center gap-2">
            {live && <span className="flex items-center gap-1.5 rounded-full bg-red-600/90 px-2.5 py-0.5 text-xs font-bold"><span className="h-1.5 w-1.5 animate-pulse rounded-full bg-white" />LIVE</span>}
            <Link href="/settings" className="text-zinc-400">Settings</Link>
          </div>
        </header>

        {/* mode switch */}
        <div className="grid grid-cols-4 gap-1 rounded-2xl bg-zinc-900/70 p-1 backdrop-blur">
          {MODES.map((x) => (
            <button key={x.id} onClick={() => changeMode(x.id)}
              className={`flex flex-col items-center gap-0.5 rounded-xl px-1 py-2 text-xs transition ${listenMode === x.id ? "bg-fuchsia-600 font-semibold text-white shadow" : "text-zinc-400 hover:text-zinc-200"}`}>
              <span className="text-lg">{x.emoji}</span>{x.label}
            </button>
          ))}
        </div>
        <p className="-mt-3 text-center text-xs text-zinc-500">{mode.blurb}</p>

        {/* stage */}
        <section className="flex flex-1 flex-col items-center justify-center gap-5 text-center">
          <div className="relative">
            <div className={`aspect-square w-64 max-w-[70vw] overflow-hidden rounded-3xl shadow-2xl transition-all duration-700 ${phase === "song" ? "scale-100" : "scale-95"}`}>
              {now?.image && phase !== "rj"
                ? <img src={now.image} alt="" className="h-full w-full object-cover" />
                : <div className={`flex h-full w-full items-center justify-center bg-gradient-to-br from-fuchsia-600 via-purple-700 to-indigo-800 ${phase === "rj" ? "animate-pulse" : ""}`}>
                    <span className="text-7xl">{phase === "rj" ? "🎙️" : "📻"}</span>
                  </div>}
            </div>
            {phase === "rj" && (
              <div className="absolute -bottom-3 left-1/2 flex -translate-x-1/2 items-end gap-1 rounded-full bg-zinc-950/90 px-3 py-1.5">
                {[0, 1, 2, 3, 4].map((b) => <span key={b} className="w-1 animate-[eq_0.9s_ease-in-out_infinite] rounded bg-fuchsia-400" style={{ animationDelay: `${b * 0.12}s`, height: 14 }} />)}
                <span className="ml-1.5 text-xs font-semibold">{prefs?.rjName} speaking</span>
              </div>
            )}
          </div>

          <div className="min-h-16 w-full">
            {phase === "rj" || !now ? (
              <>
                <h1 className="text-2xl font-bold">{prefs?.rjName ?? "MyRJ"}</h1>
                {script && live && <p className="mt-2 line-clamp-4 text-sm italic text-zinc-300">“{script}”</p>}
              </>
            ) : (
              <>
                <h1 className="truncate text-2xl font-bold">{now.name}</h1>
                <p className="truncate text-zinc-400">{now.artists}</p>
              </>
            )}
          </div>

          {phase === "song" && <div className="h-1 w-full overflow-hidden rounded-full bg-zinc-800"><div className="h-full bg-fuchsia-500 transition-[width] duration-700" style={{ width: `${progress * 100}%` }} /></div>}
          <p className="text-xs text-zinc-500">{status}</p>
          {now && out !== "sdk" && now.spotifyUrl && <a href={now.spotifyUrl} target="_blank" rel="noreferrer" className="text-xs text-green-400 underline">Open in Spotify</a>}
        </section>

        {upNext && live && (
          <div className="flex items-center gap-3 rounded-2xl bg-zinc-900/70 p-2.5 backdrop-blur">
            {upNext.image && <img src={upNext.image} alt="" className="h-10 w-10 rounded-lg" />}
            <div className="min-w-0 flex-1 text-left"><p className="text-[10px] uppercase tracking-widest text-zinc-500">Up next</p><p className="truncate text-sm">{upNext.name} · <span className="text-zinc-400">{upNext.artists}</span></p></div>
          </div>
        )}

        <div className="flex items-center justify-center gap-4">
          {!live ? (
            <button onClick={goLive} className="w-full rounded-full bg-fuchsia-600 py-4 text-lg font-bold shadow-lg shadow-fuchsia-900/50 active:scale-95 hover:bg-fuchsia-500">Go Live</button>
          ) : (
            <>
              <button onClick={stop} className="h-14 w-14 rounded-full bg-zinc-800 text-xl active:scale-95" aria-label="Stop">■</button>
              <button onClick={() => skipRef.current()} className="h-16 flex-1 rounded-full bg-white text-lg font-bold text-zinc-950 active:scale-95">Next ⏭</button>
            </>
          )}
        </div>
      </div>
    </main>
  );
}
