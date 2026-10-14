"use client";
/* eslint-disable @typescript-eslint/no-explicit-any, @next/next/no-img-element */
import Link from "next/link";
import { Suspense, useCallback, useEffect, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import { isOnboarded, loadPrefs, MODES, VIBE_MAX, type ListenMode, type Prefs, type TrackInfo } from "@/lib/prefs";
import { Curator, getMe, getToken, getTokenInfo, sp, SpotifyError } from "@/lib/spotifyClient";
import { AllPrefs, usePrefs } from "@/components/prefs";
import { cx, Spinner } from "@/components/ui";
import { Lyrics } from "@/components/Lyrics";
import { Mascot } from "@/components/Mascot";

const SILENT_WAV = "data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEAESsAACJWAAACABAAZGF0YQAAAAA=";
declare global { interface Window { Spotify: any; onSpotifyWebPlaybackSDKReady: () => void } }

type Out = "sdk" | "connect" | "preview" | "none";
type Phase = "idle" | "tuning" | "rj" | "song" | "waiting" | "recovering";
interface Diag { account?: string; product?: string; scopes?: string; sdk?: string; device?: string; output?: string; error?: string; voice?: string; script?: string; audio?: string; log?: string[] }
type BreakKind = "none" | "stinger" | "full" | "switch";
interface Plan { kind: BreakKind; withNews?: boolean; withJoke?: boolean; vibeChanged?: boolean }
interface Segment { script: string; audioUrl: string | null; lang: string; kind: BreakKind }

const NEEDED = ["streaming", "user-modify-playback-state", "user-read-playback-state"];
const SONG_VOL = 0.85;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const withTimeout = <T,>(p: Promise<T>, ms: number, label: string) =>
  Promise.race([p, sleep(ms).then(() => { throw new Error(`${label} timed out`); })]) as Promise<T>;

function loadSdk(): Promise<void> {
  return new Promise((resolve) => {
    if (window.Spotify) return resolve();
    window.onSpotifyWebPlaybackSDKReady = () => resolve();
    if (!document.querySelector('script[src*="spotify-player"]')) {
      const s = document.createElement("script");
      s.src = "https://sdk.scdn.co/spotify-player.js";
      document.body.appendChild(s);
    }
  });
}

function LiveInner() {
  const search = useSearchParams();
  const [prefs, up, loaded] = usePrefs();
  const [listenMode, setListenMode] = useState<ListenMode>("default");
  const [phase, setPhase] = useState<Phase>("idle");
  const [status, setStatus] = useState("");
  const [notice, setNotice] = useState<string | null>(null);
  const [script, setScript] = useState("");
  const [now, setNow] = useState<TrackInfo | null>(null);
  const [upNext, setUpNext] = useState<TrackInfo | null>(null);
  const [progress, setProgress] = useState(0);
  const [diag, setDiagState] = useState<Diag>({ log: [] });
  const [showDiag, setShowDiag] = useState(false);
  const [drawer, setDrawer] = useState(false);
  const [needReconnect, setNeedReconnect] = useState(false);
  const [speaking, setSpeaking] = useState(false);
  const voiceClockRef = useRef<(() => [number, number]) | null>(null);
  const clock = useCallback((): [number, number] => voiceClockRef.current?.() ?? [0, 0], []);

  const sessionRef = useRef(0);
  const skipRef = useRef<() => void>(() => {});
  const playerRef = useRef<any>(null);
  const readyIdRef = useRef<string | null>(null);
  const sdkErrRef = useRef<string | null>(null);
  const deviceRef = useRef<string | null>(null);
  const connectDeviceRef = useRef<string | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const voiceElRef = useRef<HTMLAudioElement | null>(null); // ONE element, unlocked on a tap, reused for every clip (iOS autoplay)
  const clipIdRef = useRef(0);
  const blockedRef = useRef<(() => void) | null>(null); // a clip the browser blocked; retried on the next tap
  const modeRef = useRef<ListenMode>("default");
  const outRef = useRef<Out>("none");
  const curatorRef = useRef<Curator | null>(null);
  const recentRef = useRef<string[]>([]);
  const ttsQuotaRef = useRef(false);
  const lastNewsRef = useRef(0);
  const sinceTalkRef = useRef(0);
  const sinceJokeRef = useRef(0);
  const switchRef = useRef<ListenMode | null>(null);
  const vibeAckRef = useRef(false);
  const diagRef = useRef<Diag>({ log: [] });
  const wakeRef = useRef<any>(null);
  const chanRef = useRef<BroadcastChannel | null>(null);
  const tabId = useRef(Math.random().toString(36).slice(2));
  const speechUnlockedRef = useRef(false);

  const setDiag = (d: Partial<Diag>) => { diagRef.current = { ...diagRef.current, ...d }; setDiagState(diagRef.current); };
  const log = (m: string) => {
    const line = `${new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" })} ${m}`;
    setDiag({ log: [...(diagRef.current.log ?? []).slice(-30), line] });
  };
  const alive = (sid: number) => sessionRef.current === sid;
  const md = () => MODES.find((x) => x.id === modeRef.current)!;
  const effPrefs = (): Prefs => { const b = loadPrefs(); return { ...b, energy: md().energy ?? b.energy }; };

  // ---------- mount: mode, SDK preload, tab coordination, network + visibility ----------
  useEffect(() => {
    if (!loaded) return;
    modeRef.current = prefs.defaultMode ?? "default"; setListenMode(modeRef.current);
    if (!isOnboarded(prefs)) { window.location.replace("/welcome"); return; }
    if (search.get("autostart")) setTimeout(() => goLive(), 300);
  }, [loaded]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    getTokenInfo().then(async (ti) => {
      if (!ti) { setDiag({ account: "not connected" }); return; }
      const sc = ti.scope;
      setDiag({ scopes: sc === null ? "unknown (reconnect to verify)" : "ok" });
      if (sc !== null && NEEDED.some((n) => !sc.split(" ").includes(n))) { setNeedReconnect(true); setDiag({ scopes: "missing: " + NEEDED.filter((n) => !sc.split(" ").includes(n)).join(", ") }); }
      try {
        setDiag({ sdk: "loading" });
        await withTimeout(loadSdk(), 12000, "Spotify player script");
        const player = new window.Spotify.Player({
          name: "MyRJ Web Player", volume: SONG_VOL,
          getOAuthToken: async (cb: (t: string) => void) => { const tk = await getToken(); if (!tk) setDiag({ error: "No Spotify token, reconnect Spotify" }); cb(tk ?? ""); },
        });
        player.addListener("ready", ({ device_id }: any) => { readyIdRef.current = device_id; log("web player ready"); });
        player.addListener("not_ready", () => { readyIdRef.current = null; setDiag({ sdk: "went offline" }); log("web player went offline"); });
        player.addListener("autoplay_failed", () => setNotice("Your browser blocked autoplay. Tap Next to continue."));
        ["account_error", "authentication_error", "initialization_error", "playback_error"].forEach((e) =>
          player.addListener(e, ({ message }: any) => {
            if (e !== "playback_error") sdkErrRef.current = `${e}: ${message}`;
            setDiag({ sdk: `${e}: ${message}` }); log(`${e}: ${message}`);
          }));
        playerRef.current = player;
        setDiag({ sdk: "loaded" });
      } catch (e) { sdkErrRef.current = String(e); setDiag({ sdk: String(e) }); }
    });

    const chan = "BroadcastChannel" in window ? new BroadcastChannel("myrj") : null;
    chanRef.current = chan;
    if (chan) chan.onmessage = (ev) => {
      if (ev.data?.type === "live" && ev.data.tab !== tabId.current && sessionRef.current > 0 && phaseRef.current !== "idle") {
        stop("Now playing in another tab."); 
      }
    };
    const onOffline = () => setNotice("You're offline. MyRJ will pick up where it left off.");
    const onOnline = () => { setNotice(null); log("back online"); };
    const onVis = () => { if (document.visibilityState === "visible" && phaseRef.current !== "idle") { requestWake(); if (ctxRef.current && ctxRef.current.state !== "running") ctxRef.current.resume().catch(() => {}); } };
    const onTap = () => unlockAudio(); // every tap re-unlocks (covers autostart after onboarding, and blocked clips)
    window.addEventListener("pointerdown", onTap); window.addEventListener("touchend", onTap);
    window.addEventListener("offline", onOffline); window.addEventListener("online", onOnline);
    document.addEventListener("visibilitychange", onVis);
    return () => {
      sessionRef.current++; playerRef.current?.disconnect(); audioRef.current?.pause(); chan?.close();
      window.removeEventListener("offline", onOffline); window.removeEventListener("online", onOnline);
      document.removeEventListener("visibilitychange", onVis);
      window.removeEventListener("pointerdown", onTap); window.removeEventListener("touchend", onTap);
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const phaseRef = useRef<Phase>("idle");
  useEffect(() => { phaseRef.current = phase; }, [phase]);

  async function requestWake() {
    try { wakeRef.current = await (navigator as any).wakeLock?.request("screen"); } catch { /* not supported */ }
  }

  /** Vibe request committed (Enter/blur). Live: re-steer the stream after this song and let the RJ nod to it. */
  function commitVibe(v: string) {
    v = v.replace(/\s+/g, " ").trim().slice(0, VIBE_MAX);
    if (v === (loadPrefs().vibe ?? "").trim()) return;
    up("vibe", v);
    if (phaseRef.current !== "idle" && outRef.current !== "none") {
      curatorRef.current = new Curator(modeRef.current, loadPrefs().tasteSeeds ?? [], v);
      vibeAckRef.current = true; switchRef.current = modeRef.current;
      setNotice(v ? `Vibe set: ${v}. Kicks in after this song.` : "Vibe cleared. Back to your mix after this song.");
      setTimeout(() => setNotice(null), 3500);
    }
  }

  function changeMode(m: ListenMode) {
    if (m === modeRef.current) return;
    setListenMode(m); modeRef.current = m;
    if (phaseRef.current !== "idle") {
      if (outRef.current !== "none") curatorRef.current = new Curator(m, loadPrefs().tasteSeeds ?? [], loadPrefs().vibe ?? "");
      switchRef.current = m;
      setNotice(`Switching to ${MODES.find((x) => x.id === m)!.label}…`);
      setTimeout(() => setNotice(null), 3000);
      if (phaseRef.current === "song" || phaseRef.current === "waiting") skipRef.current(); // fade out now, RJ announces the switch
    }
  }

  /** FM-style pacing: mostly music, randomized, mode-aware. */
  function planBreak(i: number): Plan {
    if (i === 0) return { kind: "full", withNews: true, withJoke: true };
    const m = modeRef.current, since = ++sinceTalkRef.current;
    const r = Math.random();
    const cfg = {
      default: { none: 0.45, stinger: 0.3, maxGap: 3 },
      drive: { none: 0.4, stinger: 0.3, maxGap: 3 },
      gym: { none: 0.5, stinger: 0.5, maxGap: 3 },
      focus: { none: 0.8, stinger: 0.2, maxGap: 6 },
    }[m];
    let kind: BreakKind = r < cfg.none ? "none" : r < cfg.none + cfg.stinger ? "stinger" : "full";
    if (kind === "none" && since >= cfg.maxGap) kind = m === "gym" || m === "focus" ? "stinger" : "full";
    if ((m === "gym" || m === "focus") && kind === "full") kind = "stinger";
    if (kind === "none") return { kind };
    sinceTalkRef.current = 0;
    const newsDue = Date.now() - lastNewsRef.current > 22 * 60 * 1000;
    const withNews = kind === "full" && newsDue && (m === "default" || m === "drive");
    const withJoke = kind === "full" && ++sinceJokeRef.current >= 2 && Math.random() < 0.6;
    if (withJoke) sinceJokeRef.current = 0;
    return { kind, withNews, withJoke };
  }

  // ---------- audio ----------
  function fadeEl(a: HTMLAudioElement, to: number, ms: number) {
    return new Promise<void>((res) => {
      const from = a.volume, steps = 15; let i = 0;
      const t = setInterval(() => { i++; a.volume = Math.max(0, Math.min(1, from + (to - from) * (i / steps))); if (i >= steps) { clearInterval(t); res(); } }, ms / steps);
    });
  }
  async function fadeSdk(to: number, ms: number) {
    const pl = playerRef.current; if (!pl) return;
    const from = (await pl.getVolume().catch(() => SONG_VOL)) as number, steps = 10;
    for (let i = 1; i <= steps; i++) { await pl.setVolume(Math.max(0.0001, from + (to - from) * (i / steps))).catch(() => {}); await sleep(ms / steps); }
  }
  // Voice amplitude for the mascot. Skipped on iOS/Safari: routing the element through Web Audio there can mute it if the context suspends.
  const analyserRef = useRef<{ an: AnalyserNode; buf: Uint8Array<ArrayBuffer> } | null>(null);
  const analyserTriedRef = useRef(false);
  function attachAnalyser() {
    if (analyserTriedRef.current || !voiceElRef.current) return;
    const ua = navigator.userAgent;
    if (/iPhone|iPad|iPod/.test(ua) || (/Safari/.test(ua) && !/Chrome|Chromium|Edg|Firefox/.test(ua)) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1)) { analyserTriedRef.current = true; return; }
    try {
      const c = ac(); if (c.state !== "running") return; // try again on a later clip
      analyserTriedRef.current = true;
      const src = c.createMediaElementSource(voiceElRef.current), an = c.createAnalyser();
      an.fftSize = 512; an.smoothingTimeConstant = 0.5; src.connect(an); an.connect(c.destination);
      analyserRef.current = { an, buf: new Uint8Array(new ArrayBuffer(an.fftSize)) };
    } catch (e) { log(`voice analyser unavailable: ${e}`); }
  }
  const voiceLevel = useCallback((): number | null => {
    const x = analyserRef.current, el = voiceElRef.current;
    if (!x || !el || el.paused) return null; // browser TTS or no analyser: mascot uses its rhythmic fallback
    x.an.getByteTimeDomainData(x.buf);
    let sum = 0; for (let i = 0; i < x.buf.length; i++) { const v = (x.buf[i] - 128) / 128; sum += v * v; }
    return Math.min(1, Math.sqrt(sum / x.buf.length) * 6);
  }, []);

  /** Must run inside a user tap: unlocks the shared audio element, Web Audio and speech synthesis (iOS/Safari). */
  function unlockAudio() {
    try {
      let a = voiceElRef.current;
      if (!a) {
        a = new Audio(); a.preload = "auto"; (a as any).playsInline = true; a.setAttribute("playsinline", ""); a.setAttribute("webkit-playsinline", "");
        voiceElRef.current = a;
      }
      if (a.paused && !a.src.startsWith("blob:") && !a.src.startsWith("http")) { a.src = SILENT_WAV; a.play().catch(() => {}); }
    } catch { /* ignore */ }
    try {
      const c = ac();
      const b = c.createBuffer(1, 1, 22050), src = c.createBufferSource(); src.buffer = b; src.connect(c.destination); src.start(0);
    } catch { /* no web audio */ }
    try {
      const synth = window.speechSynthesis;
      if (synth && !speechUnlockedRef.current) { const u = new SpeechSynthesisUtterance(" "); u.volume = 0; synth.speak(u); speechUnlockedRef.current = true; }
    } catch { /* ignore */ }
    const retry = blockedRef.current; blockedRef.current = null; retry?.();
  }

  function playClip(url: string, opts: { maxMs?: number; fadeIn?: boolean; bindSkip?: boolean; voice?: boolean } = {}) {
    return new Promise<void>((resolve) => {
      const id = ++clipIdRef.current;
      let a = voiceElRef.current;
      if (!a) { a = new Audio(); (a as any).playsInline = true; a.setAttribute("playsinline", ""); voiceElRef.current = a; }
      a.onended = a.onerror = a.ontimeupdate = null;
      a.pause(); a.src = url; audioRef.current = a; a.volume = opts.fadeIn ? 0 : 1;
      if (opts.voice) attachAnalyser();
      if (opts.voice) voiceClockRef.current = () => [a.currentTime, Number.isFinite(a.duration) ? a.duration : 0];
      let done = false;
      const finish = async (fade = false) => {
        if (done) return; done = true; blockedRef.current = null;
        if (clipIdRef.current === id) { if (fade) await fadeEl(a!, 0, 900); if (clipIdRef.current === id) a!.pause(); }
        resolve();
      };
      a.onended = () => finish();
      a.onerror = () => { const msg = `audio error ${a!.error?.code ?? "?"} ${a!.error?.message ?? ""}`.trim(); log(msg); setDiag({ audio: msg }); finish(); };
      if (opts.bindSkip !== false) a.ontimeupdate = () => { if (a.duration) setProgress(a.currentTime / a.duration); };
      if (opts.bindSkip !== false) skipRef.current = () => finish(true);
      setTimeout(() => finish(true), opts.maxMs ?? 120000); // safety: never hang on a clip
      const start = () => a!.play().then(() => { setDiag({ audio: "ok" }); if (opts.fadeIn) fadeEl(a!, 1, 1500); });
      start().catch((e) => {
        if (done) return;
        const msg = `audio blocked: ${e?.name ?? e}`; log(msg); setDiag({ audio: msg });
        if (e?.name === "NotAllowedError") {
          // iOS: wait for one tap, then play this same clip (don't drop the RJ line)
          setNotice("Tap anywhere to allow audio.");
          blockedRef.current = () => { setNotice(null); start().catch(() => finish()); };
          setTimeout(() => { if (blockedRef.current) finish(); }, 20000);
        } else finish();
      });
    });
  }

  // ---------- station sound: Web Audio jingles + soft music bed ----------
  const ctxRef = useRef<AudioContext | null>(null);
  const bedRef = useRef<{ stop: () => void } | null>(null);
  function ac() {
    if (!ctxRef.current) {
      const c: AudioContext = new (window.AudioContext || (window as any).webkitAudioContext)();
      c.onstatechange = () => { if ((c.state as string) === "interrupted" || (c.state === "suspended" && phaseRef.current !== "idle")) c.resume().catch(() => {}); };
      ctxRef.current = c;
    }
    if (ctxRef.current.state !== "running") ctxRef.current.resume().catch(() => {});
    return ctxRef.current;
  }
  /** Short whoosh + chime sweeper, flavored by mode. ~0.9s. */
  function jingle(): Promise<void> {
    try {
      const c = ac(), t = c.currentTime, m = modeRef.current;
      const out = c.createGain(); out.gain.value = m === "focus" ? 0.12 : 0.22; out.connect(c.destination);
      // whoosh: filtered noise sweep
      const len = 0.8, buf = c.createBuffer(1, c.sampleRate * len, c.sampleRate), d = buf.getChannelData(0);
      for (let i = 0; i < d.length; i++) d[i] = (Math.random() * 2 - 1) * Math.sin((i / d.length) * Math.PI);
      const n = c.createBufferSource(); n.buffer = buf;
      const bp = c.createBiquadFilter(); bp.type = "bandpass"; bp.Q.value = 1.2;
      const [f0, f1] = m === "gym" ? [500, 6000] : m === "focus" ? [200, 1200] : [300, 3500];
      bp.frequency.setValueAtTime(f0, t); bp.frequency.exponentialRampToValueAtTime(f1, t + len);
      const ng = c.createGain(); ng.gain.value = m === "focus" ? 0.25 : 0.5;
      n.connect(bp).connect(ng).connect(out); n.start(t);
      // chime: two notes
      const notes = m === "gym" ? [880, 1318.5] : m === "drive" ? [659.3, 987.8] : m === "focus" ? [523.3] : [784, 1174.7];
      notes.forEach((f, i) => {
        const o = c.createOscillator(), g = c.createGain(); o.type = "sine"; o.frequency.value = f;
        const st = t + 0.35 + i * 0.12;
        g.gain.setValueAtTime(0, st); g.gain.linearRampToValueAtTime(0.35, st + 0.02); g.gain.exponentialRampToValueAtTime(0.001, st + 0.6);
        o.connect(g).connect(out); o.start(st); o.stop(st + 0.65);
      });
      return sleep(m === "focus" ? 600 : 850).then(() => {});
    } catch { return Promise.resolve(); }
  }
  /** Soft ambient pad under longer RJ breaks (only when no song is playing underneath). */
  function startBed() {
    try {
      const c = ac(), t = c.currentTime;
      const g = c.createGain(); g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(0.035, t + 1.2);
      const lp = c.createBiquadFilter(); lp.type = "lowpass"; lp.frequency.value = 900;
      lp.connect(g).connect(c.destination);
      const chord = modeRef.current === "focus" ? [130.8, 196, 246.9] : [146.8, 220, 277.2, 329.6];
      const oscs = chord.flatMap((f) => [0, 4].map((det) => { const o = c.createOscillator(); o.type = "triangle"; o.frequency.value = f; o.detune.value = det; o.connect(lp); o.start(t); return o; }));
      bedRef.current = { stop: () => { const n = c.currentTime; g.gain.cancelScheduledValues(n); g.gain.setValueAtTime(g.gain.value, n); g.gain.linearRampToValueAtTime(0, n + 1); oscs.forEach((o) => o.stop(n + 1.1)); bedRef.current = null; } };
    } catch { /* no web audio */ }
  }

  /** Free fallback voice (Web Speech API) so the RJ still talks when ElevenLabs fails. */
  function speakBrowser(text: string, lang: string) {
    return new Promise<void>((resolve) => {
      const synth = window.speechSynthesis;
      if (!synth) { log("no browser voice available"); setTimeout(resolve, 3000); return; }
      if (synth.paused) synth.resume();
      synth.cancel();
      const t0 = Date.now(), est = Math.max(2, [...text].length / 13);
      voiceClockRef.current = () => [(Date.now() - t0) / 1000, est];
      const vs = synth.getVoices();
      const v = vs.find((x) => x.lang === lang) ?? vs.find((x) => x.lang.startsWith(lang.slice(0, 2)));
      // Chrome cuts long utterances (~15s), so speak sentence by sentence.
      const parts = text.match(/[^.!?।]+[.!?।]*/g)?.map((x) => x.trim()).filter(Boolean) ?? [text];
      let done = false;
      const finish = () => { if (!done) { done = true; synth.cancel(); resolve(); } };
      skipRef.current = finish;
      setTimeout(finish, 90000);
      parts.forEach((t, i) => {
        const u = new SpeechSynthesisUtterance(t);
        u.lang = lang; if (v) u.voice = v; u.rate = 1.05;
        u.onerror = (ev) => { log(`browser voice error: ${ev.error}`); setDiag({ voice: `browser voice: ${ev.error}` }); if (i === parts.length - 1) finish(); };
        if (i === parts.length - 1) u.onend = finish;
        synth.speak(u);
      });
    });
  }

  // ---------- RJ segments (never throw: a failed RJ just means more music) ----------
  async function buildSegment(p: Prefs, next: TrackInfo | null, prev: TrackInfo | null, index: number, plan: Plan = { kind: "full" }): Promise<Segment | null> {
    if (plan.kind === "none") return null;
    try {
      const seg = await withTimeout(fetch("/api/segment", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prefs: p, next, prev, index, mode: modeRef.current, recent: recentRef.current.slice(-4), hour: new Date().getHours(), kind: plan.kind, withNews: !!plan.withNews, withJoke: !!plan.withJoke, vibeChanged: !!plan.vibeChanged }),
      }).then(async (r) => { if (!r.ok) throw new Error(`segment ${r.status} ${(await r.text().catch(() => "")).slice(0, 120)}`); return r.json(); }), 20000, "segment");
      setDiag({ script: `${seg.mode ?? "?"} ok` });
      if (!seg.script) { log(`RJ chose silence (${plan.kind})`); return null; }
      recentRef.current.push(seg.script);
      if (plan.withNews && seg.headlines?.length) lastNewsRef.current = Date.now();
      const lang = { english: "en-IN", hinglish: "hi-IN", hindi: "hi-IN", marathi: "mr-IN" }[p.language];
      if (ttsQuotaRef.current) { log("ElevenLabs credits used up: browser voice"); return { script: seg.script, audioUrl: null, lang, kind: plan.kind }; }
      try {
        const r = await withTimeout(fetch("/api/tts", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ text: seg.script, voiceId: p.voiceId, energy: p.energy, mode: modeRef.current, language: p.language, mood: seg.mood }) }), 30000, "voice");
        if (!r.ok) {
          const j = await r.json().catch(() => ({}));
          if (j.code === "quota_exceeded") { ttsQuotaRef.current = true; setNotice("Voice service unavailable (ElevenLabs credits used up, Azure not set up). Using the browser voice for now."); setTimeout(() => setNotice(null), 6000); }
          throw new Error(`${j.error ?? `tts ${r.status}`}${j.code ? ` (${j.code})` : ""}`);
        }
        const prov = r.headers.get("X-TTS-Provider"), fb = r.headers.get("X-TTS-Fallback");
        if (fb) log(`voice: ${prov} (fallback after ${fb})`);
        const blob = await r.blob();
        if (!blob.size || !/audio/.test(blob.type)) throw new Error(`voice returned ${blob.type || "nothing"} (${blob.size}B)`);
        setDiag({ voice: `${prov ?? "ok"} ${Math.round(blob.size / 1024)}KB${fb ? ` (fallback after ${fb})` : ""}` });
        return { script: seg.script, audioUrl: URL.createObjectURL(blob), lang, kind: plan.kind };
      } catch (e) { log(`RJ voice failed, using browser voice: ${e}`); setDiag({ voice: `failed: ${String(e).slice(0, 160)}` }); return { script: seg.script, audioUrl: null, lang, kind: plan.kind }; }
    } catch (e) { log(`RJ script failed: ${e}`); setDiag({ script: `failed: ${String(e).slice(0, 160)}` }); return null; }
  }

  // ---------- spotify outputs ----------
  async function findConnectDevice(): Promise<string | null> {
    try {
      const j = await sp<any>("/me/player/devices");
      const devs = (j.devices ?? []).filter((d: any) => !d.is_restricted && !/^MyRJ/i.test(d.name ?? ""));
      const d = devs.find((x: any) => x.type === "Smartphone" && x.is_active) ?? devs.find((x: any) => x.is_active) ?? devs.find((x: any) => x.type === "Smartphone") ?? devs[0];
      if (d) setDiag({ device: `${d.name} (${d.type})` });
      return d?.id ?? null;
    } catch (e) { setDiag({ error: String(e) }); return null; }
  }

  async function setupSpotify(sid: number): Promise<Out> {
    let me;
    try { me = await getMe(); } catch (e) {
      setDiag({ account: "not connected", output: "RJ only (Spotify not connected)" });
      if (e instanceof SpotifyError && e.status !== 401) setDiag({ error: String(e) });
      return "none";
    }
    setDiag({ account: me.display_name, product: me.product });
    if (me.product !== "premium") { setDiag({ output: "previews (Spotify Free)" }); return "preview"; }

    const player = playerRef.current;
    if (player && !sdkErrRef.current) {
      setDiag({ sdk: "connecting", error: undefined });
      setStatus("Starting the player…");
      if (!readyIdRef.current) {
        const ok = await player.connect();
        if (!ok) setDiag({ sdk: "player.connect() returned false" });
        for (let t = 0; t < 30 && !readyIdRef.current && !sdkErrRef.current && alive(sid); t++) await sleep(500);
      }
      const id = readyIdRef.current;
      if (id) {
        deviceRef.current = id;
        for (let attempt = 1; attempt <= 6 && alive(sid); attempt++) {
          try {
            const devs = await sp<any>("/me/player/devices").then((j) => j.devices ?? []).catch(() => []);
            if (!devs.some((d: any) => d.id === id)) throw new Error("device not registered yet");
            await sp("/me/player", { method: "PUT", body: JSON.stringify({ device_ids: [id], play: false }) });
            await sleep(600);
            setDiag({ sdk: "ready", device: "This browser", output: "full songs in this browser", error: undefined });
            return "sdk";
          } catch (e) {
            setDiag({ sdk: `registering (try ${attempt}/6)`, error: String(e) });
            setStatus("Getting Spotify ready…");
            await sleep(attempt * 1000);
          }
        }
        setDiag({ sdk: "device never registered" });
      } else setDiag({ sdk: sdkErrRef.current ?? "never became ready" });
      player.disconnect(); readyIdRef.current = null; deviceRef.current = null;
    }

    for (let t = 0; t < 20 && alive(sid); t++) {
      const d = await findConnectDevice();
      if (d) { connectDeviceRef.current = d; setDiag({ output: `full songs on ${diagRef.current.device}` }); return "connect"; }
      setStatus("Open Spotify on your phone or computer and press play once. Looking…");
      await sleep(3000);
    }
    setDiag({ output: "previews (no Spotify device found)" });
    return "preview";
  }

  async function startOn(device: string, t: TrackInfo) {
    try {
      await sp(`/me/player/play?device_id=${device}`, { method: "PUT", body: JSON.stringify({ uris: [t.uri] }) });
    } catch (e) {
      log(`play failed, transferring + retry: ${e}`);
      await sp("/me/player", { method: "PUT", body: JSON.stringify({ device_ids: [device], play: false }) }).catch(() => {});
      await sleep(1200);
      await sp(`/me/player/play?device_id=${device}`, { method: "PUT", body: JSON.stringify({ uris: [t.uri] }) });
    }
  }

  /** RJ voice over music: duck the song to ~25%, jingle, talk, then swell back. Non-blocking. */
  const talkingRef = useRef<Promise<void> | null>(null);
  const DUCK = 0.22;
  function talkOver(seg: Segment) {
    if (!seg.audioUrl) return;
    setScript(seg.script); setSpeaking(true);
    log(`talk-over (${seg.kind})`);
    talkingRef.current = (async () => {
      await fadeSdk(DUCK, 700);
      await jingle();
      await playClip(seg.audioUrl!, { maxMs: 60000, bindSkip: false, voice: true });
      setSpeaking(false);
      if (phaseRef.current === "song") await fadeSdk(SONG_VOL, 1600);
    })().finally(() => { talkingRef.current = null; });
  }

  /**
   * In-browser playback with pro-FM transitions:
   * - starts ducked if the RJ is still talking (outro of the last song bleeds into this intro), else quick fade-in
   * - when ~10s remain and the next break is ready, the RJ talks over the outro (ducked)
   * - otherwise fades out over the last ~3s and hands over with no gap
   * Returns true if the prefetched break was already spoken over the outro.
   */
  async function playSdk(t: TrackInfo, sid: number, over?: Segment | null, outro?: Promise<Segment | null> | null): Promise<boolean> {
    const talking = !!talkingRef.current;
    await playerRef.current.setVolume(talking ? DUCK : 0.0001).catch(() => {});
    await startOn(deviceRef.current!, t);
    if (over?.audioUrl) talkOver(over);
    else if (!talking) fadeSdk(SONG_VOL, 1200);
    let ready: Segment | null | undefined;
    outro?.then((x) => { ready = x; }).catch(() => { ready = null; });
    let skipped = false, started = false, nullStates = 0, usedOutro = false, fading = false;
    skipRef.current = () => { skipped = true; };
    const t0 = Date.now(), deadline = t0 + (t.durationMs ?? 240000) + 10000;
    while (alive(sid) && !skipped && Date.now() < deadline) {
      await sleep(400);
      const st = await playerRef.current.getCurrentState().catch(() => null);
      if (!st) { if (++nullStates > 20) throw new Error("web player lost playback"); continue; }
      nullStates = 0;
      if (!st.paused) started = true;
      if (!started && Date.now() - t0 > 10000) throw new Error("song never started");
      if (st.duration) setProgress(st.position / st.duration);
      if (started && st.paused && st.position === 0) break;
      const left = st.duration ? st.duration - st.position : Infinity;
      // RJ over the outro: start ~10s before the end (only for clips; switch lines wait for the gap)
      if (!usedOutro && !talkingRef.current && left <= 10000 && left > 4000 && ready?.audioUrl && ready.kind !== "switch") {
        usedOutro = true; talkOver(ready);
      }
      if (talkingRef.current) { if (left <= 700) break; continue; } // keep the bed of music under the voice until the very end
      if (!fading && left <= 3200) { fading = true; fadeSdk(0.0001, 2600); }
      if (left <= 500) break;
    }
    if (skipped) await fadeSdk(0.0001, 600);
    if (!talkingRef.current) await playerRef.current.pause().catch(() => {});
    return usedOutro;
  }

  async function playConnect(t: TrackInfo, sid: number) {
    const dev = connectDeviceRef.current!;
    await startOn(dev, t);
    sp(`/me/player/volume?volume_percent=85&device_id=${dev}`, { method: "PUT" }).catch(() => {});
    let skipped = false, started = false;
    skipRef.current = () => { skipped = true; };
    const t0 = Date.now(), deadline = t0 + (t.durationMs ?? 240000) + 15000;
    while (alive(sid) && !skipped && Date.now() < deadline) {
      await sleep(1500);
      const st = await sp<any>("/me/player").catch(() => null);
      if (!st?.item) { if (!started && Date.now() - t0 > 15000) throw new Error("song never started on device"); continue; }
      if (st.item.uri !== t.uri) { if (started) break; continue; }
      if (st.is_playing) started = true;
      setProgress(st.progress_ms / st.item.duration_ms);
      if (st.item.duration_ms - st.progress_ms < 2500) break;
      if (started && !st.is_playing && st.progress_ms === 0) break;
    }
    await sp(`/me/player/pause?device_id=${dev}`, { method: "PUT" }).catch(() => {});
  }

  /** Returns true if the song played (or was skipped by the user), false on a playback failure. */
  async function playSong(t: TrackInfo, sid: number, over?: Segment | null, outro?: Promise<Segment | null> | null): Promise<boolean | "outro"> {
    setNow(t); setProgress(0);
    const o = outRef.current;
    const t0 = Date.now();
    try {
      if ((o === "sdk" || o === "connect") && t.uri) {
        setPhase("song"); setStatus(o === "sdk" ? "" : `On ${diagRef.current.device}`);
        if (o === "sdk") return (await playSdk(t, sid, over, outro)) ? "outro" : true;
        await playConnect(t, sid);
        return true;
      }
      if (t.previewUrl) { setPhase("song"); setStatus("30-second preview"); await playClip(t.previewUrl, { maxMs: 29000, fadeIn: true }); return true; }
      setPhase("waiting");
      setStatus(diagRef.current.product !== "premium" ? "Full songs need Spotify Premium. Open in Spotify, or tap Next." : "Can't play this one here. Tap Next.");
      await new Promise<void>((r) => { skipRef.current = r; setTimeout(r, 30000); });
      return true;
    } catch (e) {
      const msg = String(e);
      setDiag({ error: msg }); log(`playback failed: ${msg}`);
      if (/401/.test(msg)) setNeedReconnect(true);
      const elapsed = Date.now() - t0;
      if (elapsed < 4000) await sleep(4000 - elapsed); // never flash past a failure
      return false;
    }
  }

  async function recover(sid: number, why: string) {
    setPhase("recovering"); setNotice(`Reconnecting to Spotify… (${why})`); log(`recovering: ${why}`);
    connectDeviceRef.current = null;
    outRef.current = await setupSpotify(sid);
    const ok = outRef.current === "sdk" || outRef.current === "connect";
    setNotice(ok ? "Reconnected." : "Couldn't reconnect playback. Playing what we can.");
    setTimeout(() => setNotice(null), 4000);
  }

  // ---------- main loop: one iteration per song; every failure is caught and recovered ----------
  async function goLive() {
    playerRef.current?.activateElement?.(); // must happen inside the tap
    unlockAudio();
    const p = effPrefs();
    if (!p.voiceId) { window.location.href = "/welcome?step=voice"; return; }
    const sid = ++sessionRef.current;
    chanRef.current?.postMessage({ type: "live", tab: tabId.current });
    requestWake();
    recentRef.current = []; setNotice(null); setScript(""); setNow(null); setUpNext(null);
    setPhase("tuning"); setStatus("Tuning in…");
    outRef.current = await setupSpotify(sid);
    if (!alive(sid)) return;
    curatorRef.current = outRef.current !== "none" ? new Curator(modeRef.current, loadPrefs().tasteSeeds ?? [], loadPrefs().vibe ?? "") : null;
    const nextTrack = async (): Promise<TrackInfo | null> => {
      const c = curatorRef.current; if (!c) return null;
      for (let i = 0; i < 3; i++) { const t = await c.next().catch(() => null); if (t) return t; await sleep(3000); }
      return null;
    };

    let prev: TrackInfo | null = null;
    let next = await nextTrack();
    setUpNext(next);
    sinceTalkRef.current = 0; sinceJokeRef.current = 1; lastNewsRef.current = 0; switchRef.current = null;
    let pending: Promise<Segment | null> | null = buildSegment(effPrefs(), next, prev, 0, planBreak(0));
    let failures = 0;

    const speak = async (seg: Segment) => {
      if (talkingRef.current) await talkingRef.current;
      setScript(seg.script); setPhase("rj"); setStatus(""); setNow(null);
      await jingle();
      const bed = seg.kind === "full" && seg.script.length > 140;
      if (bed) startBed();
      try { if (seg.audioUrl) await playClip(seg.audioUrl, { maxMs: 90000, voice: true }); else await speakBrowser(seg.script, seg.lang); }
      finally { bedRef.current?.stop(); }
    };

    for (let i = 0; alive(sid); i++) {
      try {
        // Mode switched mid-stream: fresh track from the new mode + a short transition line, right now.
        if (switchRef.current) {
          switchRef.current = null;
          const vibeChanged = vibeAckRef.current; vibeAckRef.current = false;
          next = await nextTrack(); setUpNext(next);
          const sw = await buildSegment(effPrefs(), next, prev, i, { kind: "switch", vibeChanged });
          if (!alive(sid)) break;
          if (sw) await speak(sw);
          pending = null;
        }

        let over: Segment | null = null;
        if (pending) {
          const seg = await pending;
          if (!alive(sid)) break;
          if (seg) {
            // stingers ride over the song intro when we control the volume (in-browser player)
            if (seg.kind === "stinger" && seg.audioUrl && outRef.current === "sdk" && next) over = seg;
            else await speak(seg);
          }
        }
        if (!alive(sid)) break;
        if (switchRef.current) continue;

        if (!next) {
          setPhase("waiting");
          setStatus(outRef.current === "none" ? "Connect Spotify for music. Your RJ will keep you company." : "Finding more music…");
          await sleep(outRef.current === "none" ? 45000 : 8000);
          if (outRef.current !== "none" && !curatorRef.current) curatorRef.current = new Curator(modeRef.current, loadPrefs().tasteSeeds ?? [], loadPrefs().vibe ?? "");
          next = await nextTrack(); setUpNext(next);
          pending = outRef.current === "none" ? buildSegment(effPrefs(), null, prev, i + 1, { kind: "full", withJoke: true }) : null;
          continue;
        }

        const current = next;
        const following = nextTrack();
        const plan = planBreak(i + 1);
        const prefetch = following.then((t) => { setUpNext(t); return buildSegment(effPrefs(), t, current, i + 1, plan); }).catch(() => null);
        const res = await playSong(current, sid, over, plan.kind === "none" ? null : prefetch);
        const ok = res !== false;
        if (!alive(sid)) break;
        prev = current;
        next = await following.catch(() => null);
        pending = plan.kind === "none" || res === "outro" ? null : prefetch;
        if (ok) failures = 0;
        else if (++failures >= 2) { await recover(sid, "two songs failed"); failures = 0; }
      } catch (e) {
        log(`loop error: ${e}`);
        await sleep(3000);
        pending = null;
      }
    }
  }

  function stop(msg?: string) {
    sessionRef.current++; skipRef.current();
    audioRef.current?.pause(); playerRef.current?.pause().catch(() => {});
    bedRef.current?.stop(); setSpeaking(false); talkingRef.current = null;
    wakeRef.current?.release?.().catch(() => {});
    setPhase("idle"); setNow(null); setUpNext(null); setScript(""); setStatus("");
    setNotice(msg ?? null);
  }

  const live = phase !== "idle";
  const rjName = prefs.rjName || "Your RJ";
  const art = phase === "song" || phase === "waiting" ? now?.image : null;

  return (
    <main className="ambient relative min-h-dvh w-full overflow-x-hidden" onClick={() => notice?.startsWith("Tap anywhere") && setNotice(null)}>
      {art && <img src={art} alt="" className="pointer-events-none fixed inset-0 -z-10 h-full w-full scale-150 object-cover opacity-30 blur-[80px] transition-opacity duration-1000" />}
      <div className="mx-auto flex min-h-dvh w-full max-w-md flex-col px-5 pb-[calc(max(0.75rem,env(safe-area-inset-bottom))+5.75rem)] pt-[max(1rem,env(safe-area-inset-top))] sm:px-6">
        {/* top bar */}
        <header className="flex h-10 items-center justify-between">
          <Link href="/settings" className="flex items-center gap-2 text-[15px] font-semibold tracking-tight">
            <span className={cx("onair-dot h-2 w-2 rounded-full", live && "is-live")} />MyRJ
          </Link>
          <div className="flex items-center gap-3">
            {live && <span className="flex items-center gap-1.5 rounded-full bg-red-500/15 px-2.5 py-1 text-[11px] font-semibold tracking-wider text-red-300"><span className="h-1.5 w-1.5 animate-pulse rounded-full bg-red-400" />LIVE</span>}
            <button onClick={() => setDrawer(true)} className="glass flex h-9 w-9 items-center justify-center rounded-full text-zinc-300 hover:text-white" aria-label="Edit RJ">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M4 6h16M4 12h10M4 18h6" strokeLinecap="round" /></svg>
            </button>
          </div>
        </header>

        <VibeInput value={prefs.vibe ?? ""} focus={listenMode === "focus"} onCommit={commitVibe} />
        <ModeDock value={listenMode} onChange={changeMode} />

        {/* stage */}
        <section className="flex min-h-0 flex-1 flex-col items-center justify-center py-4 text-center sm:py-8">
          <div className="relative">
            <div className={cx("aspect-square w-[min(64vw,280px,30svh)] transition-transform", art && "overflow-hidden rounded-[28px] shadow-[0_30px_80px_-20px_rgba(0,0,0,0.8)]", " duration-700", speaking || phase === "rj" ? "scale-[0.72]" : phase === "song" ? "scale-100" : "scale-[0.94]")}>
              {art ? <img key={art} src={art} alt="" className="fade-up h-full w-full object-cover" /> : (
                <div className="relative flex h-full w-full items-center justify-center">
                  <Mascot state={phase === "rj" || speaking ? "talking" : live ? "live" : "idle"} className="w-[78%]" getLevel={voiceLevel} />
                  <span className="absolute bottom-1 text-[10px] font-medium uppercase tracking-[0.28em] text-[#f3efe8]/45">{phase === "rj" ? "On air" : live ? "Live" : "MyRJ FM"}</span>
                  {(phase === "tuning" || phase === "recovering") && <Spinner className="absolute h-6 w-6" />}
                </div>
              )}
            </div>
            {(phase === "rj" || speaking) && (
              <div className="glass absolute -bottom-4 left-1/2 flex -translate-x-1/2 items-end gap-[3px] rounded-full px-3.5 py-2">
                {[0, 1, 2, 3, 4].map((b) => <span key={b} className="w-[3px] origin-bottom animate-[eq_0.9s_ease-in-out_infinite] rounded-full bg-[#f3efe8]" style={{ animationDelay: `${b * 0.12}s`, height: 12 }} />)}
                <span className="ml-2 whitespace-nowrap text-[11px] font-medium">{rjName}</span>
              </div>
            )}
          </div>

          <div className="mt-6 min-h-[84px] w-full sm:mt-10">
            {(phase === "rj" || speaking) && script ? (
              <Lyrics key={script} text={script} clock={clock} />
            ) : phase === "song" || (phase === "waiting" && now) ? (
              <div key={now?.uri} className="fade-up">
                <h1 className="truncate text-[22px] font-semibold tracking-tight sm:text-[26px]">{now?.name}</h1>
                <p className="mt-1 truncate text-[15px] text-zinc-400">{now?.artists}</p>
              </div>
            ) : (
              <div className="fade-up">
                <h1 className="text-[22px] font-semibold tracking-tight sm:text-[26px]">{live ? rjName : `${rjName} is ready`}</h1>
                <p className="mt-1 text-[14px] text-zinc-500 sm:text-[15px]">{live ? "" : `${MODES.find((m) => m.id === listenMode)!.blurb}. One tap and it never stops.`}</p>
              </div>
            )}
          </div>

          <div className={cx("mt-4 h-1 w-full overflow-hidden rounded-full bg-white/10 transition-opacity", phase !== "song" && "opacity-0")}>
            <div className={cx("h-full rounded-full bg-white transition-[width] duration-700 ease-linear", phase !== "song" && "opacity-0")} style={{ width: `${progress * 100}%` }} />
          </div>
          <p className="mt-3 h-4 text-xs text-zinc-500">{status}</p>
          {now && (outRef.current === "preview" || phase === "waiting") && now.spotifyUrl && <a href={now.spotifyUrl} target="_blank" rel="noreferrer" className="mt-2 text-xs text-[#1DB954]">Open in Spotify ↗</a>}
        </section>

        {notice && <div className="fade-up glass mb-3 rounded-2xl px-4 py-3 text-center text-sm text-zinc-200">{notice}</div>}
        {needReconnect && <a href="/api/auth/spotify/login?return=/live" className="mb-3 rounded-2xl bg-[#1DB954] px-4 py-3 text-center text-sm font-medium text-black">Reconnect Spotify to keep playing</a>}

        {upNext && live && (
          <div className="glass mb-4 flex items-center gap-3 rounded-2xl p-2.5">
            {upNext.image ? <img src={upNext.image} alt="" className="h-10 w-10 rounded-lg" /> : <div className="h-10 w-10 rounded-lg bg-white/10" />}
            <div className="min-w-0 flex-1 text-left">
              <p className="text-[10px] font-medium uppercase tracking-[0.14em] text-zinc-500">Up next</p>
              <p className="truncate text-sm">{upNext.name} <span className="text-zinc-500">· {upNext.artists}</span></p>
            </div>
          </div>
        )}

        <div className="flex items-center gap-3">
          {!live ? (
            <button onClick={goLive} className="h-14 w-full rounded-full bg-[#f3efe8] text-[17px] sm:h-16 font-semibold text-black shadow-[0_12px_44px_-14px_rgba(243,239,232,0.18)] transition active:scale-[0.97]">Go Live</button>
          ) : (
            <>
              <button onClick={() => stop("Off air. Tap Go Live to tune back in.")} className="glass flex h-14 w-14 shrink-0 items-center sm:h-16 sm:w-16 justify-center rounded-full active:scale-95" aria-label="Stop">
                <span className="h-4 w-4 rounded-[3px] bg-white" />
              </button>
              <button onClick={() => skipRef.current()} disabled={phase === "tuning" || phase === "recovering"} className="h-14 flex-1 rounded-full bg-[#f3efe8] text-[16px] sm:h-16 font-semibold text-black transition active:scale-[0.97] disabled:opacity-40">Next</button>
            </>
          )}
        </div>

        <button onClick={() => setShowDiag((v) => !v)} className="mt-3 text-[11px] text-zinc-600 hover:text-zinc-400">
          {diag.error && live ? "● " : ""}Playback details
        </button>
        {showDiag && (
          <div className="glass fade-up mt-2 rounded-2xl p-3 text-left font-mono text-[11px] text-zinc-400">
            <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1">
              <dt>output</dt><dd>{diag.output ?? "-"}</dd>
              <dt>account</dt><dd className="truncate">{diag.account ?? "-"} {diag.product && `(${diag.product})`}</dd>
              <dt>scopes</dt><dd>{diag.scopes ?? "-"}</dd>
              <dt>web player</dt><dd>{diag.sdk ?? "-"}</dd>
              <dt>device</dt><dd>{diag.device ?? "-"}</dd>
              <dt>rj script</dt><dd className={cx("break-words", diag.script?.startsWith("failed") && "text-red-300")}>{diag.script ?? "-"}</dd>
              <dt>rj voice</dt><dd className={cx("break-words", diag.voice?.startsWith("failed") && "text-red-300")}>{diag.voice ?? "-"}</dd>
              <dt>audio</dt><dd className={cx("break-words", diag.audio && diag.audio !== "ok" && "text-red-300")}>{diag.audio ?? "-"}</dd>
              {diag.error && <><dt className="text-red-400">error</dt><dd className="break-words text-red-300">{diag.error}</dd></>}
            </dl>
            {!!diag.log?.length && <pre className="mt-2 max-h-32 overflow-y-auto whitespace-pre-wrap text-zinc-500">{diag.log.slice(-10).join("\n")}</pre>}
            <a href="/api/auth/spotify/login?return=/live" className="mt-2 inline-block text-[#1DB954]">Reconnect Spotify</a>
          </div>
        )}
      </div>

      {/* edit drawer */}
      {drawer && (
        <div className="fixed inset-0 z-50">
          <div className="absolute inset-0 bg-black/60 backdrop-blur-sm fade-up" onClick={() => setDrawer(false)} />
          <div className="sheet-up absolute inset-x-0 bottom-0 mx-auto flex max-h-[88dvh] max-w-xl flex-col pb-[env(safe-area-inset-bottom)] rounded-t-[28px] border-t border-white/10 bg-[#0d0d10]/95 backdrop-blur-xl">
            <div className="flex items-center justify-between px-6 pb-2 pt-4">
              <div><div className="mx-auto mb-3 h-1 w-10 rounded-full bg-white/15" /><h2 className="text-lg font-semibold">Your RJ</h2><p className="text-xs text-zinc-500">Changes apply from the next break.</p></div>
              <button onClick={() => setDrawer(false)} className="glass h-9 rounded-full px-4 text-sm">Done</button>
            </div>
            <div className="overflow-y-auto px-6 pb-10 pt-4"><AllPrefs p={prefs} up={up} compact returnTo="/live" /></div>
          </div>
        </div>
      )}
    </main>
  );
}

export default function Live() {
  return <Suspense><LiveInner /></Suspense>;
}

/** One-line, 100-char "what are you in the mood for" box. Commits on Enter / blur. */
function VibeInput({ value, focus, onCommit }: { value: string; focus: boolean; onCommit: (v: string) => void }) {
  const [v, setV] = useState(value);
  useEffect(() => setV(value), [value]);
  return (
    <form onSubmit={(e) => { e.preventDefault(); (e.currentTarget.elements.namedItem("vibe") as HTMLInputElement)?.blur(); }}
      className="glass mt-4 flex items-center gap-2 rounded-2xl px-4">
      <span className="text-xs text-zinc-500">✦</span>
      <input name="vibe" value={v} maxLength={VIBE_MAX} onChange={(e) => setV(e.target.value)} onBlur={() => onCommit(v)}
        placeholder={focus ? "lofi bollywood, rainy piano…" : "90s bollywood pls"} aria-label="Vibe request"
        className="h-11 min-w-0 flex-1 bg-transparent text-base sm:text-sm text-white placeholder:text-zinc-600 focus:outline-none" />
      {v && <button type="button" onMouseDown={(e) => e.preventDefault()} onClick={() => { setV(""); onCommit(""); }} className="text-xs text-zinc-500 hover:text-white" aria-label="Clear vibe">✕</button>}
      {v.length > 70 && <span className="text-[10px] tabular-nums text-zinc-600">{VIBE_MAX - v.length}</span>}
    </form>
  );
}

const DOCK_ICONS: Record<ListenMode, React.ReactNode> = {
  default: <path d="M4 10h16v9a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1v-9Zm3-4 10-3M8 15h.01M14 13.5h3M14 16.5h3" />,
  gym: <path d="M6.5 6.5v11M17.5 6.5v11M3.5 9v6M20.5 9v6M6.5 12h11" />,
  drive: <path d="M5 16V11l2-5h10l2 5v5M5 16h14M5 16v2M19 16v2M7.5 13h.01M16.5 13h.01" />,
  focus: <path d="M4 15v-3a8 8 0 0 1 16 0v3M4 15a2 2 0 0 0 2 2h1v-5H6a2 2 0 0 0-2 2Zm16 0a2 2 0 0 1-2 2h-1v-5h1a2 2 0 0 1 2 2Z" />,
};
/** Floating liquid-glass mode dock (iOS 26 tab bar style) with a sliding lens. */
function ModeDock({ value, onChange }: { value: ListenMode; onChange: (m: ListenMode) => void }) {
  const idx = Math.max(0, MODES.findIndex((m) => m.id === value));
  return (
    <nav aria-label="Listening mode" className="pointer-events-none fixed inset-x-0 bottom-0 z-40 flex justify-center px-4 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
      <div className="liquid-glass pointer-events-auto relative grid w-full max-w-[380px] grid-cols-4 rounded-full p-1.5">
        <span aria-hidden className="liquid-lens absolute bottom-1.5 left-1.5 top-1.5 rounded-full"
          style={{ width: "calc((100% - 0.75rem) / 4)", transform: `translateX(${idx * 100}%)` }} />
        {MODES.map((m) => (
          <button key={m.id} onClick={() => { onChange(m.id); navigator.vibrate?.(8); }} aria-pressed={value === m.id}
            className={cx("relative z-10 flex h-[52px] flex-col items-center justify-center gap-0.5 rounded-full text-[10.5px] font-medium transition-[color,transform] duration-200 active:scale-[0.9]", value === m.id ? "text-white" : "text-zinc-400 hover:text-zinc-200")}>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden>{DOCK_ICONS[m.id]}</svg>
            {m.label}
          </button>
        ))}
      </div>
    </nav>
  );
}
