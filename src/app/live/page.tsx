"use client";
/* eslint-disable @typescript-eslint/no-explicit-any */
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { loadPrefs, type Prefs, type TrackInfo } from "@/lib/prefs";
import { getMe, getToken, getTracks, sp } from "@/lib/spotifyClient";

declare global { interface Window { Spotify: any; onSpotifyWebPlaybackSDKReady: () => void } }

type Mode = "sdk" | "preview" | "external" | "none";
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function loadSdk(): Promise<void> {
  return new Promise((resolve) => {
    if (window.Spotify) return resolve();
    window.onSpotifyWebPlaybackSDKReady = () => resolve();
    const s = document.createElement("script");
    s.src = "https://sdk.scdn.co/spotify-player.js";
    document.body.appendChild(s);
  });
}

export default function Live() {
  const [prefs, setPrefs] = useState<Prefs | null>(null);
  const [status, setStatus] = useState("Ready when you are.");
  const [script, setScript] = useState("");
  const [now, setNow] = useState<TrackInfo | null>(null);
  const [mode, setMode] = useState<Mode>("none");
  const [live, setLive] = useState(false);
  const stopRef = useRef(false);
  const skipRef = useRef<() => void>(() => {});
  const playerRef = useRef<any>(null);
  const deviceRef = useRef<string | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  useEffect(() => { setPrefs(loadPrefs()); return () => { stopRef.current = true; playerRef.current?.disconnect(); audioRef.current?.pause(); }; }, []);

  async function speak(text: string, p: Prefs) {
    const r = await fetch("/api/tts", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ text, voiceId: p.voiceId, energy: p.energy }) });
    if (!r.ok) throw new Error("TTS failed: " + (await r.json()).error);
    await playUrl(URL.createObjectURL(await r.blob()));
  }

  function playUrl(url: string, maxMs?: number) {
    return new Promise<void>((resolve) => {
      const a = new Audio(url);
      audioRef.current = a;
      const done = () => { a.pause(); resolve(); };
      a.onended = done; a.onerror = done;
      skipRef.current = done;
      if (maxMs) setTimeout(done, maxMs);
      a.play().catch(done);
    });
  }

  async function setupSpotify(): Promise<Mode> {
    try {
      const me = await getMe();
      if (me.product !== "premium") return "preview";
      await loadSdk();
      const player = new window.Spotify.Player({ name: "MyRJ", getOAuthToken: async (cb: (t: string) => void) => cb((await getToken()) ?? ""), volume: 0.9 });
      playerRef.current = player;
      const id = await new Promise<string | null>((res) => {
        player.addListener("ready", ({ device_id }: any) => res(device_id));
        player.addListener("account_error", () => res(null));
        player.addListener("authentication_error", () => res(null));
        player.addListener("initialization_error", () => res(null));
        player.connect();
        setTimeout(() => res(null), 15000);
      });
      deviceRef.current = id;
      return id ? "sdk" : "preview";
    } catch { return "none"; }
  }

  async function playSdk(t: TrackInfo) {
    await playerRef.current.activateElement?.();
    await sp(`/me/player/play?device_id=${deviceRef.current}`, { method: "PUT", body: JSON.stringify({ uris: [t.uri] }) });
    let skipped = false;
    skipRef.current = () => { skipped = true; };
    let started = false;
    const deadline = Date.now() + (t.durationMs ?? 240000) + 10000;
    while (!stopRef.current && !skipped && Date.now() < deadline) {
      await sleep(1000);
      const st = await playerRef.current.getCurrentState();
      if (!st) continue;
      if (!st.paused) started = true;
      if (started && (st.paused && st.position === 0 || st.track_window?.current_track?.uri !== t.uri)) break;
      if (st.duration && st.position >= st.duration - 1200) break;
    }
    await playerRef.current.pause().catch(() => {});
  }

  async function playTrack(t: TrackInfo, m: Mode) {
    setNow(t);
    if (m === "sdk" && t.uri) { setStatus("Playing on Spotify"); return playSdk(t); }
    if (t.previewUrl) { setStatus("Playing 30s preview (full songs need Spotify Premium)"); return playUrl(t.previewUrl, 31000); }
    setStatus("No preview for this one. Open it in Spotify, or hit Next.");
    return new Promise<void>((resolve) => { skipRef.current = resolve; setTimeout(resolve, 30000); });
  }

  async function goLive() {
    const p = loadPrefs(); setPrefs(p);
    if (!p.voiceId) { setStatus("Pick a voice in Settings first."); return; }
    stopRef.current = false; setLive(true);
    setStatus("Tuning in…");
    // unlock audio on this user gesture
    new Audio().play().catch(() => {});
    const m = await setupSpotify(); setMode(m);
    let tracks: TrackInfo[] = [];
    if (m !== "none") { try { tracks = await getTracks(p.source); } catch (e) { setStatus(String(e)); } }
    let prev: TrackInfo | null = null;
    for (let i = 0; !stopRef.current; i++) {
      const next = tracks.length ? tracks[i % tracks.length] : null;
      setStatus(`${p.rjName} is warming up the mic…`);
      try {
        const seg = await fetch("/api/segment", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ prefs: p, next, prev, index: i }) }).then((r) => r.json());
        setScript(seg.script); setNow(null);
        setStatus(`${p.rjName} on air`);
        await speak(seg.script, p);
      } catch (e) { setStatus(String(e)); await sleep(3000); }
      if (stopRef.current) break;
      if (!next) { setStatus("Connect Spotify in Settings for music. RJ talks again in a bit."); await sleep(20000); continue; }
      await playTrack(next, m);
      prev = next;
    }
  }

  function stop() {
    stopRef.current = true; setLive(false); skipRef.current();
    audioRef.current?.pause(); playerRef.current?.pause().catch(() => {});
    setStatus("Off air.");
  }

  return (
    <main className="mx-auto w-full max-w-xl px-5 py-10 flex flex-col items-center text-center gap-6">
      <div className="w-full flex justify-between text-sm text-zinc-500"><Link href="/">MyRJ</Link><Link href="/settings">Settings</Link></div>
      <div className={`h-40 w-40 rounded-full flex items-center justify-center text-5xl bg-gradient-to-br from-fuchsia-600 to-indigo-700 ${live ? "animate-pulse" : ""}`}>📻</div>
      <h1 className="text-3xl font-bold">{prefs?.rjName ?? "MyRJ"}</h1>
      <p className="text-zinc-400 text-sm">{status}</p>
      {script && <p className="rounded-xl border border-zinc-800 bg-zinc-900/60 p-4 text-zinc-200 italic">“{script}”</p>}
      {now && (
        <div className="flex items-center gap-3 rounded-xl border border-zinc-800 p-3 w-full text-left">
          {now.image && <img src={now.image} alt="" className="h-14 w-14 rounded" />}
          <div className="flex-1 min-w-0"><p className="font-semibold truncate">{now.name}</p><p className="text-sm text-zinc-400 truncate">{now.artists}</p></div>
          {mode !== "sdk" && now.spotifyUrl && <a href={now.spotifyUrl} target="_blank" rel="noreferrer" className="text-xs text-green-400 underline">Open in Spotify</a>}
        </div>
      )}
      <div className="flex gap-3">
        {!live ? <button onClick={goLive} className="rounded-full bg-fuchsia-600 px-8 py-3 text-lg font-semibold hover:bg-fuchsia-500">Go Live</button>
          : <><button onClick={() => skipRef.current()} className="rounded-full border border-zinc-600 px-6 py-3">Next ⏭</button>
            <button onClick={stop} className="rounded-full bg-zinc-800 px-6 py-3">Stop</button></>}
      </div>
    </main>
  );
}
