"use client";
/* eslint-disable @typescript-eslint/no-explicit-any, @next/next/no-img-element */
import Link from "next/link";
import { Suspense, useCallback, useEffect, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import { AUTO_VOICE, BROWSER_VOICE, vibeQueries, VIBE_TAGS, type Steer, effectiveSongLangs, isOnboarded, isRomantic, loadPrefs, modeInfo, MODES, ROMANTIC_MODES, romanticVoice, savePrefs, SPEECH_LANG, type ListenMode, type Prefs, type TrackInfo } from "@/lib/prefs";
import { clearSpotifyBackoff, Curator, getMe, limitedEndpoint, quotaExceeded, getToken, getTokenInfo, sp, spotifyBackoffMs, SpotifyError } from "@/lib/spotifyClient";
import { AllPrefs, MusicSourcePicker, SongLangPicker, TalkToggles, usePrefs } from "@/components/prefs";
import { YtCurator, YtPlayer, ytConnected, type YtState } from "@/lib/ytClient";
import { stripTags } from "@/lib/text";
import { cx } from "@/components/ui";
import { loadVoices, speakText, type SpeechMood } from "@/lib/browserVoice";
import { Visualizer } from "@/components/Visualizer";
import { ArtStage, FallbackArt, TrackTitle, type Dir } from "@/components/ArtStage";
import { LyricsView } from "@/components/LyricsView";
import { DiscoverPanel, LibraryPanel, MiniPlayer, Sheet } from "@/components/Sheets";
import { TastePanel, type ChartPick } from "@/components/Taste";
import type { YtVideo } from "@/lib/ytmusic";
import { getArt, trackKey, type Art } from "@/lib/artwork";
import { Lyrics } from "@/components/Lyrics";
import { Mascot } from "@/components/Mascot";

const SILENT_WAV = "data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEAESsAACJWAAACABAAZGF0YQAAAAA=";
declare global { interface Window { Spotify: any; onSpotifyWebPlaybackSDKReady: () => void } }

type Out = "sdk" | "connect" | "youtube" | "preview" | "none";
type ListSteer = Steer & { list?: YtVideo[] }; // a chart or trending list: plays as is, in order
type AnyCurator = { next(): Promise<TrackInfo | null>; peek(): TrackInfo | null; steer?(s: Steer): Promise<TrackInfo | null>; pushFront?(...t: TrackInfo[]): void; playList?(v: YtVideo[]): number; setTaste?(artists: string[], genreQueries: string[]): void; upcoming?(n?: number): TrackInfo[] };
type Phase = "idle" | "tuning" | "rj" | "song" | "waiting" | "recovering";
interface Diag { account?: string; product?: string; scopes?: string; sdk?: string; device?: string; output?: string; error?: string; timings?: string; breaks?: string; voice?: string; script?: string; audio?: string; log?: string[] }
type BreakKind = "none" | "stinger" | "full" | "switch";
type SegType = "vibe" | "story" | "trivia_q" | "trivia_a" | "hot_take" | "callback" | "dedication" | "sensual_story";
interface Plan { kind: BreakKind; withNews?: boolean; withJoke?: boolean; segment?: SegType; request?: string }
// Show bits for full breaks, rotated so the same one never runs twice in a row (trivia answers are scheduled, not drawn).
const SEG_BAG: SegType[] = ["story", "vibe", "hot_take", "trivia_q", "callback", "dedication", "story", "vibe"];
interface Segment { script: string; audioUrl: string | null; lang: string; kind: BreakKind; dur?: number; story?: boolean; mood?: SpeechMood } // dur: voice clip length in seconds; story: a 30-60s sensual story (gets the gap to itself)

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
  // Taste edits apply to the running mix right away (favourite artists and genres feed the next refill).
  const upTaste: typeof up = (k, v) => {
    up(k, v);
    const p = { ...loadPrefs(), [k]: v };
    curatorRef.current?.setTaste?.((p.favArtists ?? []).map((a) => a.name), vibeQueries(p.favGenres ?? []));
  };
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
  const [car, setCar] = useState(false); // Car mode: big controls, nothing else, screen kept awake
  const [wakeOk, setWakeOk] = useState<boolean | null>(null); // did the browser agree to keep the screen on?
  useEffect(() => { try { setCar(localStorage.getItem("myrj.car") === "1"); } catch { /* ignore */ } }, []);
  const toggleCar = (v: boolean) => { setCar(v); try { localStorage.setItem("myrj.car", v ? "1" : "0"); } catch { /* ignore */ } if (v) requestWake(); };
  const [needReconnect, setNeedReconnect] = useState(false);
  const [speaking, setSpeaking] = useState(false);
  // ---- Now Playing extras: cover art, swipe direction, lyrics, sheets, requests ----
  const [art, setArt] = useState<Art | null>(null);
  const [dir, setDir] = useState<Dir>(0);
  const dirRef = useRef<Dir>(1);
  const [lyricsOpen, setLyricsOpen] = useState(false);
  const lyricsOpenRef = useRef(false); useEffect(() => { lyricsOpenRef.current = lyricsOpen; }, [lyricsOpen]);
  const [sheet, setSheet] = useState<null | "discover" | "library" | "taste">(null);
  const [reqBusy, setReqBusy] = useState(false);
  const [reqMsg, setReqMsg] = useState<string | null>(null);
  const [upcoming, setUpcoming] = useState<TrackInfo[]>([]);
  const [vol, setVol] = useState(1);
  const volRef = useRef(1); // listener's own volume (desktop players we control); fades scale under it
  const injectRef = useRef<TrackInfo[]>([]); // play these next, ahead of the curator (requests, previous)
  const dropNextRef = useRef(false); // the queue was replaced (chart, artist mix): the song that was lined up doesn't come back
  const steerGenRef = useRef(0); // bumped by every new request/previous/station change, so each one is applied exactly once
  const refreshNextRef = useRef(false);      // the vibe changed: the already-picked next song is dropped
  const requestNoteRef = useRef<string | null>(null); // what the listener asked for, for the DJ to acknowledge once
  const pendingSteerRef = useRef<ListSteer | null>(null); // a request made before going live
  const playedRef = useRef<TrackInfo[]>([]);
  const nowRef = useRef<TrackInfo | null>(null);
  const songClockRef = useRef<(() => number | null) | null>(null); // the real playback position (seconds) of the current song
  const songClock = useCallback((): number | null => songClockRef.current?.() ?? null, []);
  const voiceClockRef = useRef<(() => [number, number]) | null>(null);
  const clock = useCallback((): [number, number] => voiceClockRef.current?.() ?? [0, 0], []);

  const sessionRef = useRef(0);
  const skipRef = useRef<() => void>(() => {});
  // ---- playback control: one source of truth. desired (optimistic, what the button shows) vs applied (what we told Spotify/audio) ----
  const [paused, setPaused] = useState(false);
  const [ytStalled, setYtStalled] = useState(false); // YouTube should be playing but the player isn't (iOS blocked the start): show Tap to play

  const [picker, setPicker] = useState(false);
  const [pickerMode, setPickerMode] = useState<ListenMode>("default");
  const [pickerLangs, setPickerLangs] = useState("");
  const pausedRef = useRef(false);
  const appliedPauseRef = useRef(false);
  const ctlBusyRef = useRef(false);
  const lastTapRef = useRef(0); // last play/pause tap, for the remote-device debounce
  const musicActiveRef = useRef(false); // a Spotify song is loaded and should resume on play
  const voicePausedRef = useRef(false);
  const playerRef = useRef<any>(null);
  const readyIdRef = useRef<string | null>(null);
  const sdkErrRef = useRef<string | null>(null);
  const deviceRef = useRef<string | null>(null);
  const connectDeviceRef = useRef<string | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const voiceElRef = useRef<HTMLAudioElement | null>(null); // ONE element, unlocked on a tap, reused for every clip (iOS autoplay)
  const clipIdRef = useRef(0);
  const clipLiveRef = useRef(false); // a voice clip is mid-play (so returning to the tab may resume it, but never replays a finished one)
  const blockedRef = useRef<(() => void) | null>(null); // a clip the browser blocked; retried on the next tap
  const modeRef = useRef<ListenMode>("default");
  const outRef = useRef<Out>("none");
  const curatorRef = useRef<AnyCurator | null>(null);
  const ytRef = useRef<YtPlayer | null>(null);
  const ytHostRef = useRef<HTMLDivElement | null>(null);
  const ytLoadAtRef = useRef(0), ytPlayAtRef = useRef(0), ytAutoRef = useRef(0); // when this song was loaded / first played, and how many times we auto-resumed it
  const ytSelfAtRef = useRef(0); // last time WE paused/stopped the YouTube player (to tell external pauses apart)
  const yt = () => (ytRef.current ??= new YtPlayer());
  // iOS/iPadOS ignore the YouTube iframe's setVolume (the song stays at full volume and drowns or fights the RJ voice), so there the RJ
  // never talks OVER a YouTube song: she speaks in the gap between songs while the video is paused/ended.
  const ytNoDuck = () => typeof window !== "undefined" && (!!(window as any).__noDuck || /iP(hone|ad|od)/.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1));
  const canDuck = () => outRef.current === "sdk" || (outRef.current === "youtube" && !ytNoDuck());
  const mkCurator = (m: ListenMode): AnyCurator => { const c = mkCurator0(m); const tp = loadPrefs(); c.setTaste?.((tp.favArtists ?? []).map((a) => a.name), vibeQueries(tp.favGenres ?? [])); return c; };
  const mkCurator0 = (m: ListenMode): AnyCurator => outRef.current === "youtube"
    ? new YtCurator(m, effectiveSongLangs(m, loadPrefs().songLangs), (loadPrefs().externalPlaylists ?? []).map((x) => x.url), loadPrefs().tasteSeeds ?? [], isRomantic(m) ? [] : vibeQueries(loadPrefs().vibeTags), loadPrefs().station ?? null)
    : new Curator(m, loadPrefs().tasteSeeds ?? [], effectiveSongLangs(m, loadPrefs().songLangs));
  const recentRef = useRef<string[]>([]);
  const ttsQuotaRef = useRef(0); // until when the neural voice is resting (free allowance used up): the device voice covers meanwhile
  const lastNewsRef = useRef(0);
  const sinceTalkRef = useRef(0);
  const sinceJokeRef = useRef(0);
  const switchRef = useRef<ListenMode | null>(null);
  // Show memory for the RJ: what played, a trivia answer still owed, which bits ran.
  const historyRef = useRef<{ name: string; artists: string }[]>([]);
  const triviaRef = useRef<{ q: string; a: string } | null>(null);
  const lastSegRef = useRef<SegType[]>([]);
  const onAirAtRef = useRef(0);
  const sinceStoryRef = useRef(0), storyGapRef = useRef(2); // Sensual: a short story every 2-3 songs
  const diagRef = useRef<Diag>({ log: [] });
  const wakeRef = useRef<any>(null);
  const chanRef = useRef<BroadcastChannel | null>(null);
  const tabId = useRef(Math.random().toString(36).slice(2));
  const speechUnlockedRef = useRef(false);
  const breaksRef = useRef<string[]>([]);
  const [boot, setBoot] = useState<{ step: string; label: string; since: number } | null>(null);
  const bootStep = (step: string, label: string) => setBoot((b) => (b?.label === label ? b : { step, label, since: b?.step === step ? b.since : Date.now() }));

  const setDiag = (d: Partial<Diag>) => { diagRef.current = { ...diagRef.current, ...d }; setDiagState(diagRef.current); };
  const log = (m: string) => {
    const line = `${new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" })} ${m}`;
    setDiag({ log: [...(diagRef.current.log ?? []).slice(-30), line] });
  };
  const alive = (sid: number) => sessionRef.current === sid;
  const md = () => modeInfo(modeRef.current);
  const effPrefs = (): Prefs => {
    const b = loadPrefs();
    // Romantic Hindi sessions: their own voice, Hindi RJ and soft energy for this session only (saved settings untouched).
    if (isRomantic(modeRef.current)) return { ...b, energy: "chill", language: "hindi", voiceId: romanticVoice(modeRef.current)! };
    return { ...b, energy: md().energy ?? b.energy };
  };

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
    let boTimer: ReturnType<typeof setInterval> | null = null;
    const onBackoff = () => {
      if (quotaExceeded) {
        log(`Spotify quota: ${limitedEndpoint}`); setDiag({ error: `Spotify 429 QUOTA_EXCEEDED on ${limitedEndpoint}` });
        setNotice("Spotify's daily developer quota is used up, try again later. The RJ can keep you company meanwhile.");
        return;
      }
      if (!spotifyBackoffMs()) { if (boTimer) clearInterval(boTimer); boTimer = null; setNotice((n) => (n?.startsWith("Spotify needs a breather") ? null : n)); return; }
      log(`Spotify rate limit on ${limitedEndpoint}: backing off ${Math.ceil(spotifyBackoffMs() / 1000)}s`);
      setDiag({ error: `Spotify 429 on ${limitedEndpoint}: backing off ${Math.ceil(spotifyBackoffMs() / 1000)}s` });
      if (boTimer) clearInterval(boTimer);
      const tick = () => {
        const s = Math.ceil(spotifyBackoffMs() / 1000);
        if (s <= 0) { clearInterval(boTimer!); boTimer = null; setNotice((n) => (n?.startsWith("Spotify needs a breather") ? null : n)); return; }
        const t = s > 90 ? `${Math.ceil(s / 60)} min` : `${s}s`;
        setNotice(`Spotify needs a breather, resuming in ${t}.${phaseRef.current === "song" ? " Your song keeps playing." : ""}`);
      };
      tick(); boTimer = setInterval(tick, 1000);
    };
    window.addEventListener("spotify-backoff", onBackoff);
    const onOnline = () => { setNotice(null); log("back online"); };
    const onVis = () => {
      if (document.visibilityState !== "visible" || phaseRef.current === "idle") return;
      requestWake(); // the wake lock is dropped whenever Safari goes to the background
      // iOS pauses the YouTube player when the app goes to the background: pick the song up again (or show "Tap to play").
      if (!pausedRef.current && phaseRef.current === "song" && outRef.current === "youtube" && yt().state === 2) {
        yt().play(); setTimeout(() => { if (!pausedRef.current && yt().state === 2) setYtStalled(true); }, 1200);
      }
      if (ctxRef.current && ctxRef.current.state !== "running" && !pausedRef.current) ctxRef.current.resume().catch(() => {});
      // iOS pauses the device voice and our voice clip when the tab is hidden: pick both up again unless the listener paused the show.
      if (!pausedRef.current) {
        try { if (window.speechSynthesis?.paused) window.speechSynthesis.resume(); } catch { /* ignore */ }
        const a = voiceElRef.current;
        if (a && clipLiveRef.current && a.paused && !a.ended && a.currentTime > 0 && !voicePausedRef.current) a.play().catch(() => {});
      }
    };
    const onShow = (e: PageTransitionEvent) => { if (e.persisted && phaseRef.current !== "idle") stop("Welcome back. Tap Go Live to tune in again."); }; // restored from the back/forward cache: the old session's timers are gone
    window.addEventListener("pageshow", onShow);
    loadVoices().catch(() => {}); // warm the device-voice list early: it loads asynchronously
    const onTap = () => unlockAudio(); // every tap re-unlocks (covers autostart after onboarding, and blocked clips)
    window.addEventListener("pointerdown", onTap); window.addEventListener("touchend", onTap);
    window.addEventListener("offline", onOffline); window.addEventListener("online", onOnline);
    document.addEventListener("visibilitychange", onVis);
    return () => {
      sessionRef.current++; playerRef.current?.disconnect(); audioRef.current?.pause(); chan?.close();
      window.removeEventListener("spotify-backoff", onBackoff); if (boTimer) clearInterval(boTimer);
      window.removeEventListener("offline", onOffline); window.removeEventListener("online", onOnline);
      document.removeEventListener("visibilitychange", onVis); window.removeEventListener("pageshow", onShow);
      window.removeEventListener("pointerdown", onTap); window.removeEventListener("touchend", onTap);
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Cover art for the current song (and a warm-up fetch for the next one), with the ambient colour for the background.
  useEffect(() => {
    if (!now) { setArt(null); return; }
    let off = false;
    getArt(now).then((a) => { if (!off) setArt(a); });
    return () => { off = true; };
  }, [now]);
  useEffect(() => { if (upNext) getArt(upNext).catch(() => {}); }, [upNext]);
  useEffect(() => { if (sheet === "library") setUpcoming(curatorRef.current?.upcoming?.(8) ?? []); }, [sheet, upNext]);

  // Lock-screen / headphone controls + space bar
  useEffect(() => {
    const ms = "mediaSession" in navigator ? navigator.mediaSession : null;
    if (ms) {
      try {
        const img = art?.url ?? now?.image;
        const artList = img ? [{ src: img, sizes: "600x600", type: "image/jpeg" }] : [];
        ms.metadata = new MediaMetadata(phase === "rj" ? { title: `${prefs.rjName || "Your RJ"} on air`, artist: "MyRJ", artwork: artList } : { title: now?.name ?? "MyRJ", artist: now?.artists ?? "", artwork: artList });
        ms.setActionHandler("play", () => togglePause(false));
        ms.setActionHandler("pause", () => togglePause(true));
        ms.setActionHandler("nexttrack", () => next());
        ms.setActionHandler("previoustrack", () => previous());
        ms.setActionHandler("stop", () => stop());
      } catch { /* partial support */ }
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.code === "MediaPlayPause") { e.preventDefault(); togglePause(); return; }
      if (e.code === "MediaTrackNext") { e.preventDefault(); next(); return; }
      if (e.code !== "Space" || (e.target as HTMLElement)?.closest("input,textarea,button,select")) return;
      e.preventDefault(); togglePause();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [now, phase, prefs.rjName, art]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (prefs.music !== "youtube" || !ytHostRef.current) return;
    yt().mount(ytHostRef.current).then(() => {
      try { const c = JSON.parse(localStorage.getItem("myrj.yt.pool2") ?? "null"); const v = c?.v?.[0]; if (v && !yt().current) yt().cue(v.id); } catch { /* ignore */ }
    }).catch(() => {});
  }, [prefs.music]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (prefs.music !== "youtube") return;
    const id = setInterval(() => {
      const y = ytRef.current;
      const should = !!y && outRef.current === "youtube" && musicActiveRef.current && !pausedRef.current && !talkingRef.current && phaseRef.current === "song";
      const stalled = should && y!.state !== 1 && y!.state !== 3 && Date.now() - ytLoadAtRef.current > 3000;
      setYtStalled((v) => (v === stalled ? v : stalled));
    }, 500);
    return () => clearInterval(id);
  }, [prefs.music]);
  /** Runs inside the user's tap: iOS only starts the video from a direct gesture. */
  function tapToPlay() {
    const y = yt(); setYtStalled(false); ytAutoRef.current = 0;
    if (pausedRef.current) setPausedState(false);
    y.play();
    setTimeout(() => { if (y.state !== 1 && y.state !== 3 && y.current) y.load(y.current); }, 1500);
  }

  const phaseRef = useRef<Phase>("idle");
  useEffect(() => { phaseRef.current = phase; if (phase !== "tuning") setBoot(null); }, [phase]);

  async function requestWake() {
    try {
      const w = (navigator as any).wakeLock;
      if (!w) { setWakeOk(false); return; }
      if (wakeRef.current && !wakeRef.current.released) { setWakeOk(true); return; }
      wakeRef.current = await w.request("screen"); setWakeOk(true);
      wakeRef.current.addEventListener?.("release", () => { if (document.visibilityState === "visible" && phaseRef.current !== "idle") requestWake(); });
    } catch { setWakeOk(false); }
  }

  const setPausedState = (v: boolean) => {
    pausedRef.current = v; setPaused(v);
    try { if ("mediaSession" in navigator) navigator.mediaSession.playbackState = v ? "paused" : "playing"; } catch { /* ignore */ }
  };
  async function waitIfPaused(sid: number) { while (pausedRef.current && alive(sid)) await sleep(200); }

  /** Apply pause/resume to everything: Spotify, RJ voice, browser voice, music bed + jingles (Web Audio). */
  async function applyPause(want: boolean) {
    const a = voiceElRef.current;
    if (want) {
      if (a && !a.paused) { a.pause(); voicePausedRef.current = true; }
      try { window.speechSynthesis?.pause(); } catch { /* ignore */ }
      await ctxRef.current?.suspend().catch(() => {});
    } else {
      if (a && voicePausedRef.current) { voicePausedRef.current = false; a.play().catch(() => {}); } // inside the tap's gesture (iOS)
      await ctxRef.current?.resume().catch(() => {});
      try { window.speechSynthesis?.resume(); } catch { /* ignore */ }
    }
    if (!musicActiveRef.current) return;
    const o = outRef.current;
    if (o === "sdk") { await (want ? playerRef.current?.pause() : playerRef.current?.resume()); return; }
    if (o === "youtube") { if (want) { ytSelfAtRef.current = Date.now(); ytRef.current?.pause(); } else ytRef.current?.play(); return; }
    if (o === "connect") {
      const call = (dev: string) => sp(`/me/player/${want ? "pause" : "play"}?device_id=${dev}`, { method: "PUT" });
      try { await call(connectDeviceRef.current!); }
      catch (e) {
        const st = e instanceof SpotifyError ? e.status : 0;
        if (want && st === 403) return; // already paused
        if (st === 404 || st === 502 || st === 503 || st === 0) { // device went away: re-acquire and retry once
          await sleep(600);
          const d = await findConnectDevice(); if (d) connectDeviceRef.current = d;
          await call(connectDeviceRef.current!);
        } else throw e;
      }
    }
  }
  /** Serialized, debounced worker: rapid taps only flip the desired state; this applies the final one, one call at a time. */
  async function runCtl() {
    if (ctlBusyRef.current) return;
    ctlBusyRef.current = true;
    try {
      while (appliedPauseRef.current !== pausedRef.current) {
        if (outRef.current === "connect" && musicActiveRef.current) { // a remote device: let a burst of taps settle into one network call
          const start = Date.now(); // (voice, YouTube and the in-page player were already handled inside the tap, see togglePause)
          while (Date.now() - lastTapRef.current < 300 && Date.now() - start < 1200) await sleep(60);
          if (appliedPauseRef.current === pausedRef.current) break; // tapped back to where we were: nothing to send
        }
        const want = pausedRef.current; // only the final state is applied
        try { await applyPause(want); }
        catch (e) {
          log(`${want ? "pause" : "resume"} failed: ${e}`);
          setNotice(`Couldn't ${want ? "pause" : "resume"} Spotify. ${want ? "Paused here anyway." : "Tap Next if it stays silent."}`);
          setTimeout(() => setNotice(null), 4000);
        }
        appliedPauseRef.current = want;
      }
    } finally { ctlBusyRef.current = false; }
  }
  function togglePause(force?: boolean) {
    if (phaseRef.current === "idle" || phaseRef.current === "tuning") return;
    const v = force ?? !pausedRef.current;
    if (v === pausedRef.current) return;
    setPausedState(v); navigator.vibrate?.(8); lastTapRef.current = Date.now();
    if (outRef.current === "connect") { applyPauseLocal(v); try { if (v) window.speechSynthesis?.pause(); else window.speechSynthesis?.resume(); } catch { /* ignore */ } } // inside the tap's gesture (iOS)
    runCtl();
  }
  /** External pause/resume (Spotify app, lock screen, headphones) observed while polling. */
  function syncExternal(isPlaying: boolean) {
    if (ctlBusyRef.current) return;
    if (!isPlaying && !pausedRef.current) { setPausedState(true); appliedPauseRef.current = true; applyPauseLocal(true); log("paused outside MyRJ"); }
    else if (isPlaying && pausedRef.current && appliedPauseRef.current) { setPausedState(false); appliedPauseRef.current = false; applyPauseLocal(false); log("resumed outside MyRJ"); }
  }
  function applyPauseLocal(want: boolean) { // only our own audio, Spotify already changed
    const a = voiceElRef.current;
    if (want) { if (a && !a.paused) { a.pause(); voicePausedRef.current = true; } ctxRef.current?.suspend().catch(() => {}); }
    else { ctxRef.current?.resume().catch(() => {}); if (a && voicePausedRef.current) { voicePausedRef.current = false; a.play().catch(() => {}); } }
  }
  function next() {
    if (pausedRef.current) { setPausedState(false); appliedPauseRef.current = false; applyPauseLocal(false); }
    dirRef.current = 1;
    skipRef.current();
  }
  /** Previous: the song before this one, then back to this one. Early in the first song it restarts it. */
  function previous() {
    if (phaseRef.current === "idle" || phaseRef.current === "tuning" || phaseRef.current === "recovering") return;
    const cur = nowRef.current, list = playedRef.current;
    const back = list.length >= 2 ? list[list.length - 2] : null;
    if (!cur && !back) return;
    playedRef.current = list.slice(0, back ? -2 : -1);
    injectRef.current = [back, cur].filter((x): x is TrackInfo => !!x); steerGenRef.current++;
    requestNoteRef.current = null;
    if (pausedRef.current) { setPausedState(false); appliedPauseRef.current = false; applyPauseLocal(false); }
    dirRef.current = -1;
    skipRef.current();
  }
  /** Swipe on the cover: left = next song, right = previous song. */
  function swipe(d: 1 | -1) { log(`swipe ${d === 1 ? "next" : "previous"}`); navigator.vibrate?.(6); if (d === 1) next(); else previous(); }
  const describe = (s: Steer) => (s.kind === "song" ? `Playing your request: ${s.label}` : s.kind === "artist" ? `More ${s.label} coming up` : `Vibe: ${s.label}`);
  /** A request (typed or a tag). Live: a named song plays next (now, if a song is on); a mood takes over from the next song. Idle: saved for Go Live. */
  /** Applies a request to the curator and returns the song to play right away, if any. */
  async function applySteer(st: ListSteer): Promise<TrackInfo | null> {
    const c = curatorRef.current; if (!c) return null;
    if (st.list) return (c.playList?.(st.list) ?? 0) ? c.next() : null;
    const song = await c.steer!(st);
    return song ?? (st.kind === "artist" ? c.next() : null); // an artist mix starts now, not after the current song
  }
  async function requestSteer(r: { text?: string; tag?: string; artist?: string; chart?: ChartPick }) {
    let st: ListSteer | null = null;
    if (r.artist) st = { kind: "artist", label: `${r.artist} mix`, queries: [`${r.artist} songs`, `${r.artist} best songs`], song: null };
    else if (r.chart) {
      const ch = r.chart;
      if ((outRef.current !== "none" ? outRef.current : loadPrefs().music === "youtube" ? "youtube" : "spotify") !== "youtube") { setReqMsg("Charts play from YouTube. Switch the music source to YouTube in settings."); return; }
      setReqBusy(true); setReqMsg(null);
      try {
        const res = await fetch(`/api/charts?kind=${ch.kind}${ch.region ? `&region=${ch.region}` : ""}${ch.chart ? `&chart=${ch.chart}` : ""}`);
        const j = await res.json().catch(() => null);
        if (!res.ok || !j?.videos?.length) { setReqMsg(res.status === 429 ? "YouTube's free daily limit is used up. Charts are back tomorrow." : j?.error ?? "Couldn't load that chart. Try again."); return; }
        st = { kind: "search", label: `${ch.label}${ch.sub ? ` · ${ch.sub}` : ""}`, queries: [], song: null, list: j.videos };
      } catch { setReqMsg("You're offline. Try again in a moment."); return; }
      finally { setReqBusy(false); }
    } else if (r.tag !== undefined) {
      const t = VIBE_TAGS.find((x) => x.id === r.tag);
      st = t ? { kind: "mood", label: t.label, queries: t.q, song: null } : null;
      if (!st) {
        savePrefs({ ...loadPrefs(), vibeTags: [] }); // tags cleared: back to the normal mix from the next song
        if (phaseRef.current !== "idle" && outRef.current !== "none") { curatorRef.current = mkCurator(modeRef.current); refreshNextRef.current = true; steerGenRef.current++; }
        setReqMsg("Back to your mix from the next song."); return;
      }
    } else if (r.text) {
      setReqBusy(true); setReqMsg(null);
      try {
        const res = await fetch("/api/request", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ text: r.text, tags: loadPrefs().vibeTags ?? [] }) });
        const j = await res.json().catch(() => null);
        if (!res.ok || !j?.queries) { setReqMsg(j?.error ?? "Couldn't take that request. Try again."); return; }
        st = j as Steer;
      } catch { setReqMsg("You're offline. Try again in a moment."); return; }
      finally { setReqBusy(false); }
    }
    if (!st) return;
    log(`request: ${st.kind} "${st.label}"`);
    if (phaseRef.current === "idle" || !curatorRef.current?.steer) { pendingSteerRef.current = st; setReqMsg(`Saved: ${st.label}. It plays when you go live.`); return; }
    setReqBusy(true);
    try {
      const song = await applySteer(st);
      if (st.song && !song) setReqMsg(`Couldn't find "${st.label}". Playing similar songs instead.`);
      else if (st.list && !song) { setReqMsg("Nothing in that chart could play here. Try another one."); return; }
      else setReqMsg(st.list ? `Playing ${st.label}.` : st.kind === "artist" ? `Playing the ${st.label}.` : describe(st));
      requestNoteRef.current = st.label;
      setUpcoming(curatorRef.current.upcoming?.(8) ?? []);
      steerGenRef.current++;
      if (song) {
        injectRef.current = [song]; dropNextRef.current = !!st.list || st.kind === "artist";
        if (phaseRef.current === "song" || phaseRef.current === "waiting") { dirRef.current = 1; if (pausedRef.current) { setPausedState(false); appliedPauseRef.current = false; applyPauseLocal(false); } skipRef.current(); }
      } else refreshNextRef.current = true;
    } finally { setReqBusy(false); }
  }
  function changeStation(id: string | null) {
    savePrefs({ ...loadPrefs(), station: id }); up("station", id);
    if (phaseRef.current !== "idle" && outRef.current !== "none") {
      curatorRef.current = mkCurator(modeRef.current); refreshNextRef.current = true; steerGenRef.current++; setReqMsg(null);
      setNotice(id ? "Switching station from the next song." : "Back to My Mix from the next song."); setTimeout(() => setNotice(null), 3500);
    }
  }

  /** Idle picker: mode is just the starting mode (remembered as default). */
  function pickMode(m: ListenMode) { setListenMode(m); modeRef.current = m; up("defaultMode", m); }
  /** "Change" sheet closed: apply mode (with the RJ switch line) and/or song languages (fresh queue from the next song). */
  function closePicker() {
    setPicker(false);
    const langsChanged = loadPrefs().songLangs.join() !== pickerLangs;
    if (pickerMode !== modeRef.current) { up("defaultMode", pickerMode); changeMode(pickerMode); return; }
    if (langsChanged && phaseRef.current !== "idle" && outRef.current !== "none") {
      curatorRef.current = mkCurator(modeRef.current);
      setNotice(`Songs in ${langSummary(loadPrefs().songLangs)} from the next track.`); setTimeout(() => setNotice(null), 3500);
    }
  }

  function changeMode(m: ListenMode) {
    if (m === modeRef.current) return;
    setListenMode(m); modeRef.current = m; triviaRef.current = null; sinceStoryRef.current = 0; // an owed answer doesn't survive a vibe change
    if (phaseRef.current !== "idle") {
      if (outRef.current !== "none") curatorRef.current = mkCurator(m);
      switchRef.current = m;
      setNotice(`Switching to ${modeInfo(m).label}…`);
      setTimeout(() => setNotice(null), 3000);
      if (phaseRef.current === "song" || phaseRef.current === "waiting") skipRef.current(); // fade out now, RJ announces the switch
    }
  }

  /** FM-style pacing: mostly music, randomized, mode-aware. */
  function planBreak(i: number): Plan {
    if (i === 0) { const tp = loadPrefs(), on = !tp.justMusic; return { kind: "full", withNews: on && tp.talk.news, withJoke: on && tp.talk.jokes }; }
    const m = modeRef.current, since = ++sinceTalkRef.current;
    // Romantic Hindi · Sensual: a 30-60s sensual story every 2 or 3 songs (randomly), told between songs.
    if (m === "romantic_s" && !loadPrefs().justMusic && ++sinceStoryRef.current >= storyGapRef.current) {
      sinceStoryRef.current = 0; storyGapRef.current = 2 + Math.floor(Math.random() * 2); sinceTalkRef.current = 0;
      return { kind: "full", segment: "sensual_story" };
    }
    const r = Math.random();
    // A real FM show talks at most junctions; silence is the exception (a trivia answer owed is never skipped).
    const cfg = {
      default: { none: 0.2, stinger: 0.3, maxGap: 2 },
      drive: { none: 0.2, stinger: 0.3, maxGap: 2 },
      gym: { none: 0.35, stinger: 0.55, maxGap: 2 },
      focus: { none: 0.8, stinger: 0.2, maxGap: 6 },
      romantic_m: { none: 0.55, stinger: 0.15, maxGap: 4 }, // softer, rarer: a late-night RJ speaks only when it's worth it
      romantic_f: { none: 0.55, stinger: 0.15, maxGap: 4 },
      romantic_s: { none: 0.55, stinger: 0.15, maxGap: 4 },
    }[m];
    if (loadPrefs().justMusic) { cfg.none = Math.max(cfg.none, 0.7); cfg.maxGap = Math.max(cfg.maxGap, 4); }
    let kind: BreakKind = r < cfg.none ? "none" : r < cfg.none + cfg.stinger ? "stinger" : "full";
    if (kind === "none" && since >= cfg.maxGap) kind = m === "gym" || m === "focus" ? "stinger" : "full";
    if (triviaRef.current && !loadPrefs().justMusic) kind = "full";
    if ((m === "gym" || m === "focus") && kind === "full" && canDuck()) kind = "stinger";
    // Talk-over stingers only work in the in-browser player (we can duck the song). On a phone / Spotify Connect a stinger
    // would be a lone "here's <song>" line before the track, so make it a real break instead (Focus stays quiet).
    if (kind === "stinger" && !canDuck()) kind = m === "focus" ? (since >= cfg.maxGap ? "stinger" : "none") : "full";
    if (kind === "none") return { kind };
    sinceTalkRef.current = 0;
    const newsDue = Date.now() - lastNewsRef.current > 22 * 60 * 1000;
    const tp = loadPrefs();
    const withNews = kind === "full" && newsDue && (m === "default" || m === "drive") && tp.talk.news && !tp.justMusic;
    const withJoke = kind === "full" && !isRomantic(m) && ++sinceJokeRef.current >= 2 && Math.random() < 0.6 && tp.talk.jokes && !tp.justMusic;
    if (withJoke) sinceJokeRef.current = 0;
    return { kind, withNews, withJoke, segment: kind === "full" ? nextSegment(withNews) : undefined };
  }
  function nextSegment(withNews: boolean): SegType {
    if (triviaRef.current) return "trivia_a";
    if (withNews) return "vibe"; // news is the bit this time
    const recent = lastSegRef.current.slice(-2), facts = loadPrefs().talk.facts;
    const ok = SEG_BAG.filter((s) => !recent.includes(s) && (facts || (s !== "story" && s !== "trivia_q")) && (s !== "callback" || historyRef.current.length >= 3));
    const s = ok[Math.floor(Math.random() * ok.length)] ?? "vibe";
    lastSegRef.current = [...lastSegRef.current, s].slice(-4);
    return s;
  }

  // ---------- audio ----------
  /** Voice fade. Stops on its own if another clip takes the element (a stale fade must never turn the next clip down). */
  function fadeEl(a: HTMLAudioElement, to: number, ms: number) {
    const clip = clipIdRef.current;
    return new Promise<void>((res) => {
      const from = a.volume, steps = 15; let i = 0;
      const t = setInterval(() => {
        if (clipIdRef.current !== clip) { clearInterval(t); res(); return; }
        i++; a.volume = Math.max(0, Math.min(1, from + (to - from) * (i / steps))); if (i >= steps) { clearInterval(t); res(); }
      }, ms / steps);
    });
  }
  /** Song volume fade. Only the newest fade runs: an older one (say, the fade-out of the last song) quits the moment a new one starts,
   *  so two loops can never fight and leave a fresh song stuck near zero. */
  const fadeIdRef = useRef(0);
  const songVolRef = useRef(SONG_VOL); // last volume we set, so fades don't need a slow getVolume round-trip
  async function setSongVol(v: number) {
    songVolRef.current = v;
    const y = ytRef.current, out = v * volRef.current;
    if (outRef.current === "youtube" && y) y.setVolume01(out); else await playerRef.current?.setVolume(Math.max(0.0001, out)).catch(() => {});
  }
  async function fadeSdk(to: number, ms: number) {
    const id = ++fadeIdRef.current;
    if (outRef.current !== "youtube" && !playerRef.current) return;
    const from = songVolRef.current, steps = Math.max(4, Math.round(ms / 80));
    for (let i = 1; i <= steps; i++) {
      if (fadeIdRef.current !== id) return;
      await setSongVol(from + (to - from) * (i / steps));
      await sleep(ms / steps);
    }
  }
  // Voice amplitude for the mascot. Skipped on iOS/Safari: routing the element through Web Audio there can mute it if the context suspends.
  const analyserRef = useRef<{ an: AnalyserNode; buf: Uint8Array<ArrayBuffer> } | null>(null);
  /** Mascot lip-sync. NEVER reroutes the element (createMediaElementSource can silence it): taps a captureStream() copy instead.
   *  Chrome/Edge only; anything else (or any error) means the mascot uses its rhythmic fallback. Re-created per clip. */
  function attachAnalyser() {
    analyserRef.current = null;
    const el = voiceElRef.current as (HTMLAudioElement & { captureStream?: () => MediaStream }) | null;
    if (!el || typeof el.captureStream !== "function" || !/Chrome|Chromium|Edg/.test(navigator.userAgent) || /iPhone|iPad|Android/.test(navigator.userAgent)) return;
    const c = ctxRef.current; if (!c || c.state !== "running") return;
    const hook = () => {
      try {
        const st = el.captureStream!(); if (!st.getAudioTracks().length) return;
        const src = c.createMediaStreamSource(st), an = c.createAnalyser(); // analyser is NOT connected to the destination
        an.fftSize = 512; an.smoothingTimeConstant = 0.5; src.connect(an);
        analyserRef.current = { an, buf: new Uint8Array(new ArrayBuffer(an.fftSize)) };
      } catch { analyserRef.current = null; }
    };
    el.addEventListener("playing", hook, { once: true });
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
    try { const as = (navigator as any).audioSession; if (as && as.type !== "playback") as.type = "playback"; } catch { /* Safari 17+ only */ }
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
      a.pause(); a.src = url; audioRef.current = a; a.volume = opts.fadeIn ? 0 : 1; clipLiveRef.current = true;
      if (opts.voice) attachAnalyser();
      if (opts.voice) voiceClockRef.current = () => [a.currentTime, Number.isFinite(a.duration) ? a.duration : 0];
      let done = false;
      const finish = async (fade = false) => {
        if (done) return; done = true; blockedRef.current = null;
        if (clipIdRef.current === id) clipLiveRef.current = false;
        if (clipIdRef.current === id) { if (fade) await fadeEl(a!, 0, 900); if (clipIdRef.current === id) a!.pause(); }
        resolve();
      };
      a.onended = () => finish();
      a.onerror = () => { const msg = `audio error ${a!.error?.code ?? "?"} ${a!.error?.message ?? ""}`.trim(); log(msg); setDiag({ audio: msg }); finish(); };
      if (opts.bindSkip !== false) a.ontimeupdate = () => { if (a.duration) setProgress(a.currentTime / a.duration); };
      if (opts.bindSkip !== false) skipRef.current = () => finish(true);
      const arm = (ms: number) => setTimeout(() => { if (pausedRef.current) arm(1000); else finish(true); }, ms);
      arm(opts.maxMs ?? 120000); // safety: never hang on a clip (paused time doesn't count)
      // A clip that begins while paused waits (resume plays it) instead of talking over a paused radio.
      const start = () => (pausedRef.current ? (voicePausedRef.current = true, Promise.resolve()) : a!.play()).then(() => { setDiag({ audio: "ok" }); if (opts.fadeIn) fadeEl(a!, 1, 1500); });
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

  /** The device's own voice (Web Speech API): free and always there, so the RJ still talks when no neural voice can. */
  async function speakBrowser(text: string, lang: string, mood?: SpeechMood) {
    const t0 = Date.now();
    const sp = await speakText(text, lang, mood ?? "cheerful", (m) => { log(m); setDiag({ voice: m }); });
    voiceClockRef.current = () => [(Date.now() - t0) / 1000, sp.estSeconds];
    if (sp.voice) log(`device voice: ${sp.voice}`);
    skipRef.current = sp.cancel;
    await sp.done;
  }

  /** Voice clip length, for timing talk-overs. Some MP3s report no duration until played: estimate from the text then. */
  function clipSeconds(url: string, text: string): Promise<number> {
    const est = Math.max(2, [...text].length / 14);
    return new Promise((res) => {
      const a = new Audio(); a.preload = "metadata";
      const done = (v?: number) => { a.onloadedmetadata = a.onerror = null; a.removeAttribute("src"); res(v && Number.isFinite(v) && v > 0.5 ? v : est); };
      a.onloadedmetadata = () => done(a.duration); a.onerror = () => done();
      setTimeout(() => done(), 1500);
      a.src = url;
    });
  }

  // ---------- RJ segments (never throw: a failed RJ just means more music) ----------
  async function buildSegment(p: Prefs, next: TrackInfo | null, prev: TrackInfo | null, index: number, plan: Plan = { kind: "full" }): Promise<Segment | null> {
    if (plan.kind === "none") return null;
    const trivia = plan.segment === "trivia_a" ? triviaRef.current : null;
    if (trivia) triviaRef.current = null; // one shot: owed answers never pile up, even if this break fails
    try {
      const seg = await withTimeout(fetch("/api/segment", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          prefs: p, next, prev, index, mode: modeRef.current, recent: recentRef.current.slice(-6), hour: new Date().getHours(), kind: plan.kind, withNews: !!plan.withNews, withJoke: !!plan.withJoke,
          segment: plan.segment, trivia, history: historyRef.current.slice(-8), request: plan.request,
          minutes: onAirAtRef.current ? Math.round((Date.now() - onAirAtRef.current) / 60000) : 0,
        }),
      }).then(async (r) => { if (!r.ok) throw new Error(`segment ${r.status} ${(await r.text().catch(() => "")).slice(0, 120)}`); return r.json(); }), 25000, "segment");
      setDiag({ script: `${seg.mode === "llm" ? (seg.provider ?? "ai") : (seg.mode ?? "?")} ok` });
      if (seg.trivia?.a && !isRomantic(modeRef.current)) triviaRef.current = { q: String(seg.trivia.q), a: String(seg.trivia.a) };
      breaksRef.current = [...breaksRef.current, `${plan.kind}${seg.segment && seg.segment !== "vibe" ? `/${seg.segment}` : ""}:${!seg.script ? "skip" : seg.mode === "llm" ? (seg.provider ?? "ai") : "template"}`].slice(-6);
      setDiag({ breaks: breaksRef.current.join(" · ") });
      seg.script = stripTags(String(seg.script ?? ""));
      if (!seg.script) { log(`RJ chose silence (${plan.kind})`); return null; }
      recentRef.current.push(seg.script);
      if (plan.withNews && seg.headlines?.length) lastNewsRef.current = Date.now();
      const lang = SPEECH_LANG[p.language] ?? "en-US";
      const mood: SpeechMood | undefined = ["hype", "cheerful", "warm", "calm"].includes(seg.mood) ? seg.mood : undefined;
      const device = (): Segment => ({ script: seg.script, audioUrl: null, lang, kind: plan.kind, story: plan.segment === "sensual_story", mood });
      if (p.voiceId === BROWSER_VOICE && !isRomantic(modeRef.current)) return device(); // the listener chose the device voice
      if (Date.now() < ttsQuotaRef.current) { log("neural voice resting (free allowance): device voice"); return device(); }
      try {
        const tts = () => withTimeout(fetch("/api/tts", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ text: seg.script, voiceId: p.voiceId, energy: p.energy, mode: modeRef.current, language: p.language, mood: seg.mood }) }), 20000, "voice");
        // One retry on a transient failure (network blip, 5xx) before dropping to the robotic browser voice.
        let r = await tts().catch(async (e) => { log(`voice failed once (${e}), retrying`); await sleep(800); return tts(); });
        if (!r.ok && r.status >= 500) { const j = await r.clone().json().catch(() => ({})); if (j.code !== "quota_exceeded") { log(`voice ${r.status}, retrying`); await sleep(800); r = await tts(); } }
        if (!r.ok) {
          const j = await r.json().catch(() => ({}));
          if (j.code === "quota_exceeded") { ttsQuotaRef.current = Date.now() + 10 * 60_000; setNotice("The free studio voice has hit its limit for now. Your device's voice is filling in."); setTimeout(() => setNotice(null), 6000); }
          if (j.code === "not_configured") ttsQuotaRef.current = Date.now() + 60 * 60_000; // no voice service on this server: don't ask again every break
          throw new Error(`${j.error ?? `tts ${r.status}`}${j.code ? ` (${j.code})` : ""}`);
        }
        const prov = r.headers.get("X-TTS-Provider"), fb = r.headers.get("X-TTS-Fallback");
        if (fb) log(`voice: ${prov} (fallback after ${fb})`);
        const blob = await r.blob();
        if (!blob.size || !/audio/.test(blob.type)) throw new Error(`voice returned ${blob.type || "nothing"} (${blob.size}B)`);
        setDiag({ voice: `${prov ?? "ok"} ${Math.round(blob.size / 1024)}KB${fb ? ` (fallback after ${fb})` : ""}` });
        const url = URL.createObjectURL(blob);
        return { ...device(), audioUrl: url, dur: await clipSeconds(url, seg.script) };
      } catch (e) { log(`RJ voice failed, using the device voice: ${e}`); setDiag({ voice: `failed: ${String(e).slice(0, 160)}` }); return device(); }
    } catch (e) { log(`RJ script failed: ${e}`); setDiag({ script: `failed: ${String(e).slice(0, 160)}` }); return null; }
  }

  // ---------- spotify outputs ----------
  async function findConnectDevice(): Promise<string | null> {
    try {
      const j = await sp<any>("/me/player/devices");
      const devs = (j.devices ?? []).filter((d: any) => !d.is_restricted && !/^MyRJ/i.test(d.name ?? ""));
      // Never auto-pick a random device (Alexa/speaker/TV): the phone's own Spotify app first; on a computer, this computer. Nothing else.
      const mobileUa = /iPhone|iPad|iPod|Android/i.test(navigator.userAgent) || (/Macintosh/.test(navigator.userAgent) && navigator.maxTouchPoints > 1);
      const ok = (x: any) => x.type === "Smartphone" || (!mobileUa && x.type === "Computer");
      const d = devs.find((x: any) => x.type === "Smartphone" && x.is_active) ?? devs.find((x: any) => x.type === "Smartphone") ?? devs.find((x: any) => ok(x) && x.is_active) ?? devs.find(ok);
      if (d) setDiag({ device: `${d.name} (${d.type})` });
      else if (devs.length) setDiag({ device: `ignored: ${devs.map((x: any) => x.name).join(", ")}` });
      return d?.id ?? null;
    } catch (e) { setDiag({ error: String(e) }); return null; }
  }

  async function setupSpotify(sid: number): Promise<Out> {
    let me, lastMeErr: unknown;
    for (let t = 0; ; t++) {
      try { me = await getMe(); break; } catch (e) {
        if (quotaExceeded) { setDiag({ account: "quota used up", output: "RJ only (Spotify daily quota used up)", error: `Spotify 429 QUOTA_EXCEEDED on ${limitedEndpoint}` }); return "none"; }
        if (e instanceof SpotifyError && e.status === 429 && t < 2 && alive(sid)) { await sleep(Math.min(61000, spotifyBackoffMs() + 300)); continue; }
        if (e instanceof SpotifyError && e.status === 403) {
          setDiag({ account: "not allowed (403)", output: "RJ only", error: String(e) });
          setNotice("This Spotify account isn't on the app's allowed users yet. Add it under Users in the Spotify Developer Dashboard (the app is in development mode), then reconnect.");
          return "none";
        }
        me = null; lastMeErr = e; break;
      }
    }
    if (!me) { const e = lastMeErr;
      setDiag({ account: "not connected", output: "RJ only (Spotify not connected)" });
      if (e instanceof SpotifyError && e.status !== 401) setDiag({ error: String(e) });
      return "none";
    }
    setDiag({ account: me.display_name, product: me.product });
    if (me.product !== "premium") { setDiag({ output: "previews (Spotify Free)" }); return "preview"; }

    // The Web Playback SDK doesn't run in mobile browsers: don't wait for it there, go straight to Spotify Connect.
    const mobile = /iPhone|iPad|iPod|Android/i.test(navigator.userAgent) || (/Macintosh/.test(navigator.userAgent) && navigator.maxTouchPoints > 1);
    // On desktop the SDK script may still be loading (autostart right after onboarding): give it a few seconds before falling back.
    for (let t = 0; t < 20 && !mobile && !playerRef.current && !sdkErrRef.current && alive(sid); t++) await sleep(250);
    const player = playerRef.current;
    if (mobile) setDiag({ sdk: "skipped (mobile browser)" });
    if (player && !sdkErrRef.current && !mobile) {
      setDiag({ sdk: "connecting", error: undefined });
      bootStep("player", "Starting the player…");
      if (!readyIdRef.current) {
        const ok = await player.connect();
        if (!ok) setDiag({ sdk: "player.connect() returned false" });
        for (let t = 0; t < 16 && !readyIdRef.current && !sdkErrRef.current && alive(sid); t++) await sleep(500);
      }
      const id = readyIdRef.current;
      if (id) {
        deviceRef.current = id;
        for (let attempt = 1; attempt <= 5 && alive(sid); attempt++) {
          try {
            const devs = await sp<any>("/me/player/devices").then((j) => j.devices ?? []).catch(() => []);
            if (!devs.some((d: any) => d.id === id)) throw new Error("device not registered yet");
            await sp("/me/player", { method: "PUT", body: JSON.stringify({ device_ids: [id], play: false }) });
            await sleep(250);
            setDiag({ sdk: "ready", device: "This browser", output: "full songs in this browser", error: undefined });
            return "sdk";
          } catch (e) {
            setDiag({ sdk: `registering (try ${attempt}/5)`, error: String(e) });
            bootStep("player", "Getting Spotify ready…");
            await sleep(attempt * 500);
          }
        }
        setDiag({ sdk: "device never registered" });
      } else setDiag({ sdk: sdkErrRef.current ?? "never became ready" });
      player.disconnect(); readyIdRef.current = null; deviceRef.current = null;
    }

    bootStep("device", "Looking for Spotify on your devices…");
    for (let t = 0; t < 10 && alive(sid); t++) {
      const d = await findConnectDevice();
      if (d) { connectDeviceRef.current = d; setDiag({ output: `full songs on ${diagRef.current.device}` }); return "connect"; }
      bootStep("device", "Open the Spotify app and press play once. Looking…");
      await sleep(t < 3 ? 1500 : 3000);
    }
    // No phone device: don't fall back to 30-second previews or someone else's speaker. YouTube if connected (caller), else a clear instruction.
    setDiag({ output: "no Spotify device on this phone" });
    setNotice("Open the Spotify app on your phone, play any song, then tap Retry.");
    return "none";
  }

  /** Starts a song. With `after`, the next song is queued behind it on the device, so playback carries on by itself if this page is frozen. */
  async function startOn(device: string, t: TrackInfo, after?: TrackInfo | null) {
    const body = JSON.stringify({ uris: [t.uri, ...(after?.uri && after.uri !== t.uri ? [after.uri] : [])] });
    try {
      await sp(`/me/player/play?device_id=${device}`, { method: "PUT", body });
    } catch (e) {
      log(`play failed, transferring + retry: ${e}`);
      await sp("/me/player", { method: "PUT", body: JSON.stringify({ device_ids: [device], play: false }) }).catch(() => {});
      await sleep(1200);
      await sp(`/me/player/play?device_id=${device}`, { method: "PUT", body });
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
      await Promise.all([fadeSdk(DUCK, 700), jingle()]); // duck under the sweeper, like a real desk
      await playClip(seg.audioUrl!, { maxMs: 90000, bindSkip: false, voice: true });
      setSpeaking(false);
      if (phaseRef.current === "song") await fadeSdk(SONG_VOL, 1600);
    })().finally(() => { talkingRef.current = null; });
  }
  /** When to start talking over a song's outro: about half the clip over the old song's ending, the rest over the next song's intro. */
  const outroLeadMs = (seg: Segment) => Math.min(18000, Math.max(7000, (seg.dur ?? 12) * 550 + 2000));
  /** A song that should be playing at full volume but was left ducked or faded (lost fade, interrupted talk-over): bring it back. */
  function volumeGuard(fading: boolean, since: number) {
    if (talkingRef.current || fading || Date.now() - since < 3500) return;
    if (songVolRef.current < SONG_VOL * 0.6) { log(`song was left at ${Math.round(songVolRef.current * 100)}% volume, restoring`); fadeSdk(SONG_VOL, 800); }
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
    fadeIdRef.current++; // cancel any fade still running from the last song
    await setSongVol(talking || over?.audioUrl ? DUCK : 0.12);
    await startOn(deviceRef.current!, t);
    if (over?.audioUrl) talkOver(over);
    else if (!talking) fadeSdk(SONG_VOL, 600); // quick swell in: the old song only just faded, so there's no dead air
    const tStart = Date.now();
    let ready: Segment | null | undefined;
    outro?.then((x) => { ready = x; }).catch(() => { ready = null; });
    let skipped = false, started = false, nullStates = 0, usedOutro = false, fading = false;
    skipRef.current = () => { skipped = true; };
    const t0 = Date.now(); let deadline = t0 + (t.durationMs ?? 240000) + 10000;
    while (alive(sid) && !skipped && Date.now() < deadline) {
      await sleep(400);
      const st = await playerRef.current.getCurrentState().catch(() => null);
      if (pausedRef.current) { deadline += 400; if (st && !st.paused && appliedPauseRef.current) syncExternal(true); continue; }
      if (!st) { if (++nullStates > 20) throw new Error("web player lost playback"); continue; }
      nullStates = 0;
      if (started && st.paused && st.position > 0 && st.duration - st.position > 3000 && !talkingRef.current) { syncExternal(false); continue; }
      if (!st.paused) started = true;
      if (!started && Date.now() - t0 > 10000) throw new Error("song never started");
      if (st.duration) setProgress(st.position / st.duration);
      { const pos = st.position / 1000, at = Date.now(), still = st.paused; songClockRef.current = () => (still || pausedRef.current ? pos : pos + (Date.now() - at) / 1000); }
      if (started && st.paused && st.position === 0) break;
      const left = st.duration ? st.duration - st.position : Infinity;
      if (!st.paused) volumeGuard(fading, tStart);
      // RJ over the outro, timed from the clip's length so the voice straddles both songs (switch lines wait for the gap)
      if (!usedOutro && !talkingRef.current && !injectRef.current.length && !refreshNextRef.current && ready?.audioUrl && ready.kind !== "switch" && !ready.story && left <= outroLeadMs(ready) && left > 3000) {
        usedOutro = true; talkOver(ready);
      }
      if (talkingRef.current) { if (left <= 700) break; continue; } // keep the bed of music under the voice until the very end
      if (!fading && left <= 1900) { fading = true; fadeSdk(0.12, 1500); if (!outro) jingle(); } // no break coming: short fade + station sweeper, straight into the next song
      if (left <= 350) break;
    }
    if (skipped) await fadeSdk(0.0001, 500);
    if (!talkingRef.current) await playerRef.current.pause().catch(() => {});
    return usedOutro;
  }

  /** YouTube source: one setup per session. Mounts the visible IFrame player; external pauses sync the UI. */
  async function setupYoutube(): Promise<Out> {
    if (!ytHostRef.current) return "none";
    try {
      await withTimeout(yt().mount(ytHostRef.current), 12000, "YouTube player");
      yt().onState = (st: YtState) => {
        if (st === 1 && !ytPlayAtRef.current) ytPlayAtRef.current = Date.now();
        if (!musicActiveRef.current || (Date.now() - ytSelfAtRef.current < 1500 && ytLoadAtRef.current <= ytSelfAtRef.current)) return; // our own pause (but not one that arrives after we loaded the next song)
        if (st === 2 && !pausedRef.current) {
          // A PAUSED right after load/first play is the browser or YouTube blocking autoplay, not the listener: resume (up to 3x) instead of flipping to "paused".
          const early = !ytPlayAtRef.current || Date.now() - ytPlayAtRef.current < 2500 || Date.now() - ytLoadAtRef.current < 3000;
          if (early && ytAutoRef.current < 3 && !document.hidden) { ytAutoRef.current++; log(`YouTube paused itself right after start, resuming (${ytAutoRef.current})`); setTimeout(() => { if (!pausedRef.current) yt().play(); }, 150); return; }
          syncExternal(false);
        }
        else if (st === 1 && pausedRef.current && appliedPauseRef.current) syncExternal(true);
      };
      setDiag({ output: "YouTube player (visible)", device: "This browser", error: undefined });
      return "youtube";
    } catch (e) { setDiag({ output: "YouTube player failed", error: String(e) }); return "none"; }
  }

  /** YouTube: same FM flow as the in-browser Spotify player (ducking via setVolume, RJ over the outro). */
  async function playYt(t: TrackInfo, sid: number, over?: Segment | null, outro?: Promise<Segment | null> | null): Promise<boolean> {
    const y = yt();
    const talking = !!talkingRef.current;
    fadeIdRef.current++; // cancel any fade still running from the last song
    await setSongVol(talking || over?.audioUrl ? DUCK : 0.12);
    ytLoadAtRef.current = Date.now(); ytPlayAtRef.current = 0; ytAutoRef.current = 0;
    y.load(t.ytId!);
    let skipped = false;
    skipRef.current = () => { skipped = true; };
    // Wait for real playback; skip videos that can't be embedded (101/150), were removed (100) or won't start.
    const t0 = Date.now(); let nudged = false, retried = 0;
    while (alive(sid) && !skipped && y.state !== 1 && y.error === null) {
      await sleep(200);
      if (!pausedRef.current && (y.state as YtState) !== 3 && (y.state as YtState) !== 1 && Math.floor((Date.now() - t0) / 2500) > retried) { retried = Math.floor((Date.now() - t0) / 2500); y.play(); } // stuck unstarted/cued/paused: nudge it
      if (!nudged && Date.now() - t0 > 4000) { nudged = true; setNotice("Tap ▶ on the video to start the music (your browser wants one tap)."); }
      if (Date.now() - t0 > 60000) break;
    }
    if (nudged) setNotice(null);
    if (y.error !== null || y.state !== 1) {
      log(`YouTube ${t.ytId}: ${y.error !== null ? `error ${y.error}` : "never started"}, skipping`);
      if (y.error !== null && curatorRef.current instanceof YtCurator) curatorRef.current.markBad(t.ytId!);
      return false;
    }
    if (over?.audioUrl) talkOver(over); else if (!talking) fadeSdk(SONG_VOL, 600);
    let ready: Segment | null | undefined;
    outro?.then((x) => { ready = x; }).catch(() => { ready = null; });
    let usedOutro = false, fading = false;
    const tStart = Date.now();
    while (alive(sid) && !skipped) {
      await sleep(400);
      if (pausedRef.current) continue;
      if (!talkingRef.current && !fading && Date.now() - tStart > 3000 && y.getVolume01() < 0.2) { songVolRef.current = y.getVolume01(); fadeSdk(SONG_VOL, 600); } // never leave a playing song at ~0 volume
      else volumeGuard(fading, tStart);
      if ((y.state as YtState) === 0) break;
      // Safety net for ads (Premium should be ad-free): another video id or a duration far off from the song's.
      const dur = y.duration(), pos = y.time();
      const adLike = (y.videoId() && y.videoId() !== t.ytId) || (!!t.durationMs && dur > 0 && dur < 120 && Math.abs(dur * 1000 - t.durationMs) > 15000);
      if (adLike) { setStatus("Ad playing, the RJ waits"); continue; }
      if ((y.state as YtState) !== 1) continue;
      setStatus("");
      if (dur) setProgress(pos / dur);
      if (!songClockRef.current) songClockRef.current = () => (y.current === t.ytId ? y.time() : null);
      const left = dur ? (dur - pos) * 1000 : Infinity;
      if (!usedOutro && !talkingRef.current && !injectRef.current.length && !refreshNextRef.current && ready?.audioUrl && ready.kind !== "switch" && !ready.story && canDuck() && left <= outroLeadMs(ready) && left > 3000) { usedOutro = true; talkOver(ready); }
      if (talkingRef.current) { if (left <= 700) break; continue; }
      if (!fading && left <= 1900 && canDuck()) { fading = true; fadeSdk(0.12, 1500); if (!outro) jingle(); }
      if (left <= 350) break;
    }
    if (skipped) await fadeSdk(0.0001, 500);
    if (!talkingRef.current) { ytSelfAtRef.current = Date.now(); y.pause(); }
    return usedOutro;
  }

  const connectFailRef = useRef(0);
  const volSetRef = useRef(false);
  /** The song Spotify moved on to by itself (the page was frozen or late at the end of the last one): adopted, not restarted. */
  const advancedToRef = useRef<string | null>(null);
  /** Spotify Connect (the phone's Spotify app). No volume control here, so transitions are tight cuts timed to the end of the song.
   *  Returns "advanced" when the device already moved on to the queued next song by itself (no RJ break at that junction). */
  async function playConnect(t: TrackInfo, sid: number, after?: Promise<TrackInfo | null> | null): Promise<"advanced" | void> {
    const dev = connectDeviceRef.current!;
    let adopted = false;
    if (advancedToRef.current && advancedToRef.current === t.uri) {
      const now = await sp<any>("/me/player").catch(() => null);
      adopted = !!now?.is_playing && now.item?.uri === t.uri;
      if (adopted) log("Spotify already moved on to this song: keeping it");
    }
    advancedToRef.current = null;
    const queued = adopted || !after ? null : await Promise.race([after.catch(() => null), sleep(1500).then(() => null)]);
    if (!adopted) await startOn(dev, t, queued);
    if (!volSetRef.current) { volSetRef.current = true; sp(`/me/player/volume?volume_percent=85&device_id=${dev}`, { method: "PUT" }).catch(() => {}); }
    let skipped = false, started = false;
    skipRef.current = () => { skipped = true; };
    const t0 = Date.now(); let deadline = t0 + (t.durationMs ?? 240000) + 15000;
    let endsAt = t0 + (t.durationMs ?? 240000), first = true;
    while (alive(sid) && !skipped && Date.now() < deadline) {
      // Poll gently: every 10s while visible, 15s while hidden, plus once right at the expected end of the song.
      // Lyrics open: re-read the position every 5s so a seek in the Spotify app is followed (costs a few more API calls only then).
      const gap = first ? 2500 : Math.min(document.hidden ? 60000 : lyricsOpenRef.current ? 5000 : 30000, Math.max(1200, endsAt - Date.now() - 2000));
      first = false;
      for (const until = Date.now() + gap; Date.now() < until && !skipped && alive(sid);) await sleep(250);
      if (skipped || !alive(sid)) break;
      const bo = spotifyBackoffMs();
      if (bo) { deadline += bo + 1000; endsAt = Math.max(endsAt, Date.now()); continue; } // rate-limited: the song keeps playing on the device
      const st = await sp<any>("/me/player").catch(() => null);
      if (pausedRef.current) { deadline += gap; endsAt += gap; if (st?.is_playing && st.item?.uri === t.uri && appliedPauseRef.current) syncExternal(true); continue; }
      if (started && st?.item?.uri === t.uri && !st.is_playing && st.progress_ms > 0 && st.item.duration_ms - st.progress_ms > 3000) { syncExternal(false); continue; }
      if (!st?.item) { if (!started && Date.now() - t0 > 10000 && !spotifyBackoffMs()) throw new Error("song never started on device"); continue; }
      if (!started && st.item.uri === t.uri && !st.is_playing && Date.now() - t0 > 6000 && !spotifyBackoffMs()) throw new Error("song paused itself on the device");
      if (st.item.uri !== t.uri) {
        // Only the song WE queued counts as moving on by itself; anything else was picked in the Spotify app (old behaviour: pause, carry on).
        // (Even if we never saw our own song playing: a page frozen right after the start first wakes up on the next song.)
        if (st.is_playing && queued?.uri === st.item.uri) { advancedToRef.current = st.item.uri; connectFailRef.current = 0; return "advanced"; }
        if (started || adopted) break;
        continue;
      }
      if (st.is_playing) started = true;
      const left = st.item.duration_ms - st.progress_ms;
      endsAt = Date.now() + left;
      deadline = Math.max(deadline, endsAt + 15000);
      setProgress(st.progress_ms / st.item.duration_ms);
      { const pos = st.progress_ms / 1000, at = Date.now(), playing = st.is_playing; songClockRef.current = () => (!playing || pausedRef.current ? pos : pos + (Date.now() - at) / 1000); }
      if (st.is_playing && left < 4500) { // near the end: wait it out locally and cut ~0.9s before the last note, not 2.5s early
        for (const until = Date.now() + Math.max(0, left - 900); Date.now() < until && !skipped && alive(sid);) await sleep(100);
        break;
      }
      if (started && !st.is_playing && st.progress_ms === 0) break;
    }
    await sp(`/me/player/pause?device_id=${dev}`, { method: "PUT" }).catch(() => {});
    connectFailRef.current = 0;
  }

  /** Returns true if the song played (or was skipped by the user), false on a playback failure. */
  async function playSong(t: TrackInfo, sid: number, over?: Segment | null, outro?: Promise<Segment | null> | null, after?: Promise<TrackInfo | null> | null): Promise<boolean | "outro"> {
    musicActiveRef.current = true; songClockRef.current = null;
    setDir(dirRef.current); dirRef.current = 1;
    nowRef.current = t; playedRef.current = [...playedRef.current, t].slice(-30);
    try { return await playSongInner(t, sid, over, outro, after); } finally { musicActiveRef.current = false; songClockRef.current = null; }
  }
  /** true = played (or skipped by the listener); "outro" = the next break is used up (spoken over the outro, or Spotify moved on by itself); false = failed. */
  async function playSongInner(t: TrackInfo, sid: number, over?: Segment | null, outro?: Promise<Segment | null> | null, after?: Promise<TrackInfo | null> | null): Promise<boolean | "outro"> {
    setNow(t); setProgress(0);
    const o = outRef.current;
    const t0 = Date.now();
    try {
      if (o === "youtube" && t.ytId) { setPhase("song"); setStatus(""); return (await playYt(t, sid, over, outro)) ? "outro" : true; }
      if ((o === "sdk" || o === "connect") && t.uri) {
        setPhase("song"); setStatus(o === "sdk" ? "" : `Playing on ${(diagRef.current.device ?? "your device").replace(/\s*\([^)]*\)$/, "")}`);
        if (o === "sdk") return (await playSdk(t, sid, over, outro)) ? "outro" : true;
        return (await playConnect(t, sid, after)) === "advanced" ? "outro" : true;
      }
      if (t.previewUrl) { setPhase("song"); setStatus("30-second preview"); await playClip(t.previewUrl, { maxMs: 29000, fadeIn: true }); return true; }
      setPhase("waiting");
      setStatus(diagRef.current.product !== "premium" ? "Full songs need Spotify Premium. Open in Spotify, or tap Next." : "Can't play this one here. Tap Next.");
      await new Promise<void>((r) => { skipRef.current = r; setTimeout(r, 30000); });
      return true;
    } catch (e) {
      const msg = String(e);
      if (spotifyBackoffMs() > 0) { log(`rate-limited: waiting ${Math.ceil(spotifyBackoffMs() / 1000)}s`); await sleep(spotifyBackoffMs() + 500); return true; } // not a failure: just wait it out
      setDiag({ error: msg }); log(`playback failed: ${msg}`);
      if (/401/.test(msg)) setNeedReconnect(true);
      if (o === "connect" && ++connectFailRef.current >= 2 && (await ytConnected())) {
        connectFailRef.current = 0; log("Spotify device keeps failing: switching to YouTube");
        setNotice("Spotify isn't playing on your phone, switching to YouTube."); setTimeout(() => setNotice(null), 7000);
        outRef.current = await setupYoutube();
        if (outRef.current === "youtube") curatorRef.current = mkCurator(modeRef.current);
        return false;
      }
      const elapsed = Date.now() - t0;
      if (elapsed < 4000) await sleep(4000 - elapsed); // never flash past a failure
      return false;
    }
  }

  async function recover(sid: number, why: string) {
    // YouTube failures are bad or blocked videos (already marked and skipped): reconnecting Spotify here used to strand YouTube listeners.
    if (outRef.current === "youtube") { log(`YouTube: ${why}, carrying on with the next video`); return; }
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
    if (!p.voiceId) { // skipped the voice step: use the default voice for their language instead of bouncing them back
      const v = AUTO_VOICE; // the server picks the best voice it has for their language
      savePrefs({ ...loadPrefs(), voiceId: v }); up("voiceId", v); p.voiceId = v;
    }
    const sid = ++sessionRef.current;
    chanRef.current?.postMessage({ type: "live", tab: tabId.current });
    requestWake();
    recentRef.current = []; ttsQuotaRef.current = 0; setNotice(null); setScript(""); setNow(null); setUpNext(null);
    setPhase("tuning"); setStatus("");
    // ---- start-up: Spotify output, first songs and the RJ intro all run in parallel; music never waits on the intro ----
    const t0 = performance.now(), times: string[] = [];
    const timed = <T,>(name: string, pr: Promise<T>) => pr.finally(() => { times.push(`${name} ${((performance.now() - t0) / 1000).toFixed(1)}s`); setDiag({ timings: times.join(" · ") }); });
    const wantYt = loadPrefs().music === "youtube";
    if (wantYt) { outRef.current = "youtube"; ytRef.current?.setVolume01(0); ytRef.current?.play(); } // inside the tap: unlocks the player on iOS (never stop it again: that cancelled the only user-gesture start iOS gives us)
    bootStep("spotify", wantYt ? "Starting YouTube…" : "Connecting to Spotify…");
    let curator: AnyCurator = wantYt ? mkCurator(modeRef.current) : new Curator(modeRef.current, loadPrefs().tasteSeeds ?? [], effectiveSongLangs(modeRef.current, loadPrefs().songLangs));
    const nextFrom = async (c: AnyCurator | null): Promise<TrackInfo | null> => {
      if (!c) return null;
      for (let i = 0; i < 3; i++) { const t = await c.next().catch(() => null); if (t) return t; await sleep(Math.max(1500, spotifyBackoffMs() + 500)); }
      return null;
    };
    const nextTrack = () => nextFrom(curatorRef.current);
    let firstP = wantYt ? timed("songs", nextFrom(curator)) : timed("songs", getToken().then((tk) => tk ? getMe().catch(async (e) => { if (!(e instanceof SpotifyError && e.status === 429)) throw e; await sleep(Math.min(61000, spotifyBackoffMs() + 400)); return getMe(); }).then(() => nextFrom(curator), () => null) : null));
    let firstDone = false;
    firstP.then((t) => { firstDone = true; if (alive(sid) && phaseRef.current === "tuning") setUpNext(t); });
    sinceTalkRef.current = 0; sinceJokeRef.current = 1; lastNewsRef.current = 0; switchRef.current = null;
    historyRef.current = []; triviaRef.current = null; lastSegRef.current = []; onAirAtRef.current = Date.now(); sinceStoryRef.current = 0; storyGapRef.current = 2;
    let introP = timed("rj intro", firstP.then((t) => buildSegment(effPrefs(), t, null, 0, planBreak(0))));
    const outP = timed(wantYt ? "youtube" : "spotify", wantYt ? setupYoutube() : setupSpotify(sid));
    outRef.current = await outP;
    if (!alive(sid)) return;
    // Spotify unavailable (quota used up / not connected): fall back to YouTube if it's connected.
    if (!wantYt && outRef.current === "none" && (await ytConnected())) {
      log("Spotify unavailable: switching to YouTube");
      setNotice(quotaExceeded ? "Spotify's daily quota is used up, playing from YouTube instead." : diagRef.current.output?.startsWith("no Spotify device") ? "No Spotify device on your phone, playing from YouTube instead." : "Spotify isn't connected, playing from YouTube instead.");
      setTimeout(() => setNotice(null), 6000);
      bootStep("spotify", "Starting YouTube…");
      outRef.current = await setupYoutube();
      if (outRef.current === "youtube") {
        curator = mkCurator(modeRef.current);
        firstP = timed("songs", nextFrom(curator)); firstDone = false; firstP.then(() => { firstDone = true; });
        introP = timed("rj intro", firstP.then((t) => buildSegment(effPrefs(), t, null, 0, planBreak(0))));
      }
    }
    if (phaseRef.current === "tuning" && !firstDone && outRef.current !== "none") bootStep("songs", "Picking your songs…");
    curatorRef.current = outRef.current !== "none" ? curator : null;
    let prev: TrackInfo | null = null;
    let next = outRef.current !== "none" ? await firstP : null;
    if (!alive(sid)) return;
    setUpNext(next);
    let pending: Promise<Segment | null> | null = introP;
    let openerDue = false;
    if (next) {
      // Music is ready: give the intro a short grace period, otherwise start the song and open the show at the next break.
      const ready = await Promise.race([introP.then(() => true), sleep(1000).then(() => false)]);
      if (!ready) { pending = null; openerDue = true; log("intro not ready: music first, opener at the next break"); }
    } else bootStep("rj", "Warming up the RJ…");
    times.push(`first sound ${((performance.now() - t0) / 1000).toFixed(1)}s`); setDiag({ timings: times.join(" · ") });
    let failures = 0;

    const speak = async (seg: Segment) => {
      if (talkingRef.current) await talkingRef.current;
      await waitIfPaused(sid);
      setScript(seg.script); setPhase("rj"); setStatus(""); setNow(null);
      await jingle();
      const bed = seg.kind === "full" && seg.script.length > 140;
      if (bed) startBed();
      const clip = (seg.audioUrl ? playClip(seg.audioUrl, { maxMs: 90000, voice: true }) : speakBrowser(seg.script, seg.lang, seg.mood)).finally(() => bedRef.current?.stop());
      // Phone Spotify takes ~0.5-1s to start a song: fire it just before the RJ's last word so there's no dead air.
      const lead = outRef.current === "connect" && seg.audioUrl && next ? 700 : 0;
      await (lead ? Promise.race([clip, voiceNearEnd(lead, sid)]) : clip);
    };
    /** Resolves when the RJ clip has `ms` left (never while paused). */
    const voiceNearEnd = async (ms: number, s: number) => {
      for (;;) {
        await sleep(100);
        if (!alive(s)) return;
        const [cur, dur] = clock();
        if (!pausedRef.current && cur > 0.5 && dur > 0 && (dur - cur) * 1000 <= ms) return;
      }
    };
    /** Waits for p, but Next ends the wait (the listener never has to sit through a slow RJ or a music search). */
    const skippable = <T,>(p: Promise<T>, onSkip: T) => new Promise<T>((res) => {
      let done = false;
      const end = (v: T) => { if (!done) { done = true; res(v); } };
      skipRef.current = () => { log("Next while waiting: moving on"); end(onSkip); };
      p.then(end, () => end(onSkip));
    });
    let loopErrors = 0;
    /** Listener steering: an injected track (request, previous) or a new vibe replaces the already-picked next song. */
    const steerNext = async (idx: number) => {
      if (injectRef.current.length) {
        const inj = injectRef.current.shift()!;
        if (next && next.uri !== inj.uri && !dropNextRef.current) curatorRef.current?.pushFront?.(next);
        dropNextRef.current = false;
        next = inj; setUpNext(inj);
      } else if (refreshNextRef.current) {
        refreshNextRef.current = false;
        next = await skippable(nextTrack(), null); setUpNext(next);
      } else return false;
      const note = requestNoteRef.current; requestNoteRef.current = null;
      pending = note && next ? buildSegment(effPrefs(), next, prev, idx, { kind: "full", request: note }) : null; // the DJ takes the request on air
      return true;
    };
    if (pendingSteerRef.current && curatorRef.current?.steer) {
      const st = pendingSteerRef.current; pendingSteerRef.current = null;
      const song = await applySteer(st).catch(() => null);
      if (song) { injectRef.current = [song]; dropNextRef.current = !!st.list || st.kind === "artist"; } else refreshNextRef.current = true;
      requestNoteRef.current = st.label;
    }

    for (let i = 0; alive(sid); i++) {
      try {
        // Mode switched mid-stream: fresh track from the new mode + a short transition line, right now.
        if (switchRef.current) {
          switchRef.current = null;
          next = await skippable(nextTrack(), null); setUpNext(next);
          const sw = await skippable(buildSegment(effPrefs(), next, prev, i, { kind: "switch" }), null);
          if (!alive(sid)) break;
          if (sw) await speak(sw);
          pending = null;
        }

        await steerNext(i === 0 && !prev ? 0 : i + 1);
        const gen = steerGenRef.current;
        if (!alive(sid)) break;
        let over: Segment | null = null;
        if (pending) {
          const seg = await skippable(pending, null);
          if (!alive(sid)) break;
          if (seg) {
            // When we control the volume, the RJ rides over the next song's intro (FM style) instead of stopping the music.
            // Show openers and mode-switch lines keep the stage to themselves.
            if ((seg.kind === "stinger" || (seg.kind === "full" && prev)) && !seg.story && seg.audioUrl && canDuck() && next) over = seg;
            else await speak(seg);
          }
        }
        if (!alive(sid)) break;
        if (switchRef.current) continue;

        if (!next) {
          setPhase("waiting");
          setStatus(outRef.current === "none" ? "Connect Spotify or YouTube for music. Your RJ will keep you company." : "Finding more music…");
          await skippable(sleep(outRef.current === "none" ? 45000 : 8000), undefined);
          if (outRef.current !== "none" && !curatorRef.current) curatorRef.current = mkCurator(modeRef.current);
          next = await skippable(nextTrack(), null); setUpNext(next);
          pending = outRef.current === "none" ? buildSegment(effPrefs(), null, prev, i + 1, { kind: "full", withJoke: true }) : null;
          continue;
        }

        // A request (or Previous) arrived while the RJ was talking: take it now, with its own short on-air line.
        if (steerGenRef.current !== gen && await steerNext(i + 1) && pending) { const seg = await skippable(pending, null); pending = null; if (seg && alive(sid)) await speak(seg); }
        if (!alive(sid)) break;
        if (!next) continue;
        const current = next;
        const following = nextTrack();
        const plan: Plan = openerDue ? planBreak(0) : planBreak(i + 1);
        const segIndex = openerDue ? 0 : i + 1; openerDue = false;
        const prefetch = following.then((t) => { setUpNext(t); return buildSegment(effPrefs(), t, current, segIndex, plan); }).catch(() => null);
        await waitIfPaused(sid);
        if (!alive(sid)) break;
        const res = await playSong(current, sid, over, plan.kind === "none" ? null : prefetch, following);
        const ok = res !== false;
        if (!alive(sid)) break;
        prev = current;
        if (ok) historyRef.current = [...historyRef.current, { name: current.name, artists: current.artists }].slice(-12);
        next = await following.catch(() => null);
        pending = plan.kind === "none" || res === "outro" ? null : prefetch;
        if (ok) failures = 0;
        else if (++failures >= 2) { await recover(sid, "two songs failed"); failures = 0; }
        loopErrors = 0;
      } catch (e) {
        log(`loop error: ${e}`);
        await sleep(3000);
        pending = null;
        if (++loopErrors >= 2) { loopErrors = 0; next = await nextTrack().catch(() => null); setUpNext(next); log("loop: moving past the song that keeps failing"); }
      }
    }
  }

  function stop(msg?: string) {
    setPausedState(false); appliedPauseRef.current = false; voicePausedRef.current = false; ctxRef.current?.resume().catch(() => {});
    sessionRef.current++; skipRef.current();
    audioRef.current?.pause(); playerRef.current?.pause().catch(() => {}); ytSelfAtRef.current = Date.now(); ytRef.current?.pause();
    bedRef.current?.stop(); setSpeaking(false); talkingRef.current = null; advancedToRef.current = null; fadeIdRef.current++;
    wakeRef.current?.release?.().catch(() => {});
    setPhase("idle"); setNow(null); setUpNext(null); setScript(""); setStatus("");
    setNotice(msg ?? null);
  }

  const live = phase !== "idle";
  const rjName = prefs.rjName || "Your RJ";
  const ytOn = live && outRef.current === "youtube" && (phase === "song" || phase === "waiting" || phase === "rj");
  const ytShow = ytOn && phase !== "rj";
  const talking = phase === "rj" || speaking;
  const showSong = (phase === "song" || phase === "waiting") && !!now;
  const nowKey = now ? trackKey(now) : "none";
  const stageKey = phase === "rj" ? "rj" : showSong ? nowKey : phase;
  const artUrl = showSong ? art?.url ?? null : null;
  const artRgb = showSong && art?.color ? art.color : "58 102 214";
  const durS = now?.durationMs ? now.durationMs / 1000 : 0;
  const fmt = (x: number) => `${Math.floor(x / 60)}:${String(Math.floor(x % 60)).padStart(2, "0")}`;
  const touchUi = typeof navigator !== "undefined" && /iP(hone|ad|od)|Android/.test(navigator.userAgent);
  const openPicker = () => { setPickerMode(listenMode); setPickerLangs(prefs.songLangs.join()); setPicker(true); };
  const mini = <MiniPlayer track={now} art={artUrl} paused={paused} speaking={talking} rjName={rjName} onToggle={() => togglePause()} onNext={next} onExpand={() => { setSheet(null); setDrawer(false); setPicker(false); }} />;
  const sheetOpen = !!sheet || drawer || picker;

  return (
    <main data-mode={listenMode} data-car={car && live ? "" : undefined} className="ambient now-playing relative min-h-dvh w-full overflow-x-clip" style={{ ["--art" as string]: `rgb(${artRgb})` }}
      onClick={() => notice?.startsWith("Tap anywhere") && setNotice(null)}>
      <div aria-hidden className={cx("aurora", live && "is-live", (paused || !live) && "is-paused")}><i /><i /></div>
      <div aria-hidden className="art-ambient" />
      {artUrl && <img key={artUrl} src={artUrl} alt="" aria-hidden className="art-backdrop pointer-events-none fixed inset-0 -z-10 h-full w-full object-cover" />}
      <div className={cx("player-shell mx-auto flex min-h-dvh w-full max-w-md flex-col px-5 pb-[max(0.75rem,env(safe-area-inset-bottom))] pt-[max(0.75rem,env(safe-area-inset-top))] sm:px-6", sheetOpen && "is-behind")}>
        {/* top bar */}
        <header className="flex h-11 items-center justify-between">
          <Link href="/settings" onClick={(e) => { if (live) { e.preventDefault(); setDrawer(true); } }} aria-label={live ? "MyRJ, open settings" : "MyRJ settings"} className="flex h-11 items-center gap-2 text-[17px] font-semibold tracking-tight">
            <span className={cx("onair-dot h-2 w-2 rounded-full", live && "is-live")} />MyRJ
          </Link>
          <div className="flex items-center gap-2">
            {live && <span className="live-badge flex items-center gap-1.5 rounded-full bg-[#ff4d6d]/15 px-2.5 py-1 text-[11px] font-semibold tracking-wider text-[#ff8fa3]"><span className="h-1.5 w-1.5 animate-pulse rounded-full bg-[#ff5c7a]" />LIVE</span>}
            {live && <button onClick={() => toggleCar(!car)} aria-pressed={car} data-testid="car-toggle" className={cx("glass flex h-11 items-center gap-1.5 rounded-full px-3.5 text-[13px] font-medium", car ? "text-[#06102a] !bg-[#e8efff]" : "text-white/80 hover:text-white")} aria-label={car ? "Exit car mode" : "Car mode"}>
              <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d="M5 16V11l2-5h10l2 5v5M5 16h14M5 16v2.5M19 16v2.5M3.5 10.5H5M19 10.5h1.5" /><circle cx="8" cy="13.5" r=".6" fill="currentColor" /><circle cx="16" cy="13.5" r=".6" fill="currentColor" /></svg>
              {car ? "Exit" : "Car"}
            </button>}
            <button onClick={() => setDrawer(true)} className="car-hide glass flex h-11 w-11 items-center justify-center rounded-full text-white/80 hover:text-white" aria-label="Edit RJ">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden><path d="M4 6h16M4 12h10M4 18h6" strokeLinecap="round" /></svg>
            </button>
          </div>
        </header>

        {live && (
          <div className="car-hide mt-1 flex items-center justify-center gap-2 text-[13px] text-white/55" data-testid="station-line">
            <span className="text-white/80">{modeInfo(listenMode).label}</span><span className="text-white/25">·</span>
            <span className="max-w-[40%] truncate">{prefs.station ? (prefs.station === "library" ? "My library" : "Playlist") : isRomantic(listenMode) ? "Hindi only" : (prefs.vibeTags?.length ? prefs.vibeTags.map((x) => VIBE_TAGS.find((y) => y.id === x)?.label).join(", ") : langSummary(prefs.songLangs))}</span>
            <span className="text-white/25">·</span><span className="truncate">with {rjName}</span>
            {prefs.justMusic && <><span className="text-white/25">·</span><span>Just music</span></>}
            <button onClick={openPicker} className="ml-1 font-medium text-[#9fc0ff] underline-offset-2 hover:underline">Change</button>
          </div>
        )}

        {/* stage */}
        <section className={cx("flex min-h-0 flex-1 flex-col items-center text-center", live ? "justify-start pt-4 [@media(max-height:700px)]:pt-2" : "justify-center py-2 sm:py-8")}>
          {live ? (
            <div data-testid="art-toggle" className={cx("art-wrap relative transition-[width] duration-500",
              ytShow ? "w-[min(76vw,320px,calc(100svh-600px))] [@media(max-height:760px)]:hidden" : talking && !showSong ? "w-[min(58vw,250px,30svh)]" : "w-[min(84vw,360px,44svh)] [@media(max-height:640px)]:w-[min(56vw,30svh)]")}>
              <ArtStage id={stageKey} src={artUrl} dir={phase === "rj" ? 0 : dir} playing={showSong && !paused && !ytStalled} dim={paused}
                label={showSong ? `Cover of ${now?.name}` : `${rjName}`}
                onSwipe={swipe} onTap={() => { if (live) togglePause(); }}
                fallback={showSong && now ? <FallbackArt title={now.name} seed={nowKey} /> : (
                  <div className="dj-card relative flex h-full w-full items-center justify-center">
                    <Mascot state={talking ? "talking" : phase === "tuning" || phase === "recovering" ? "tuning" : "live"} className="w-[62%]" getLevel={voiceLevel} />
                  </div>
                )} />
              {talking && (
                <div className="glass onair-pill absolute -bottom-4 left-1/2 z-10 flex -translate-x-1/2 items-end gap-[3px] rounded-full px-3.5 py-2" data-testid="dj-speaking">
                  {[0, 1, 2, 3, 4].map((b) => <span key={b} className="w-[3px] origin-bottom animate-[eq_0.9s_ease-in-out_infinite] rounded-full bg-[#cfe0ff]" style={{ animationDelay: `${b * 0.12}s`, height: 12 }} />)}
                  <span className="ml-2 whitespace-nowrap text-[11px] font-medium">{rjName}</span>
                </div>
              )}
            </div>
          ) : (
            <div className="idle-hero flex aspect-square w-[min(34vw,150px,12svh)] items-center justify-center rounded-[34px] [@media(max-height:700px)]:w-[min(34vw,150px,10svh)]">
              <Mascot state="idle" className="w-[78%]" getLevel={voiceLevel} />
            </div>
          )}

          <div className={cx("flex w-full items-start gap-3.5", live ? (ytShow ? "mt-5" : "mt-7 [@media(max-height:700px)]:mt-5") : "mt-4 min-h-[84px] sm:mt-6")}>
            {/* Visible YouTube player (official IFrame API). YouTube requires it on screen at 200×200 or more while it plays, so it sits
                beside the title as a "video window" and the cover stays the centrepiece. Always mounted (moving an iframe reloads it). */}
            <div className={cx("video-tile shrink-0 overflow-hidden rounded-[22px] bg-black transition-opacity duration-500", ytShow ? "relative h-[200px] w-[200px] opacity-100" : "pointer-events-none fixed left-0 top-0 h-[200px] w-[200px] opacity-0")} aria-hidden={!ytShow} data-testid="video-tile">
              <div ref={ytHostRef} className="h-full w-full" />
              {ytShow && ytStalled && <button data-testid="tap-to-play" onClick={tapToPlay} className="absolute inset-0 z-10 flex flex-col items-center justify-center gap-2 bg-black/70 text-white"><span className="flex h-14 w-14 items-center justify-center rounded-full bg-[#e8efff] text-[#06102a]"><svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor" aria-hidden><path d="M8 5.5v13a1 1 0 0 0 1.5.86l10.5-6.5a1 1 0 0 0 0-1.72L9.5 4.64A1 1 0 0 0 8 5.5Z" /></svg></span><span className="text-sm font-medium">Tap to play</span></button>}
            </div>
            <div className="min-w-0 flex-1">
            {talking && script && !ytShow ? (
              <Lyrics key={script} text={script} clock={clock} />
            ) : showSong && now ? (
              ytShow ? (
                <div className="flex h-[200px] flex-col text-left">
                  <p className="line-clamp-3 text-[19px] font-semibold leading-tight tracking-tight text-white" data-testid="now-title">{now.name}</p>
                  <p className="mt-1 line-clamp-2 text-[14px] text-white/60">{now.artists}</p>
                  <button onClick={() => setLyricsOpen(true)} className="glass mt-auto flex h-11 w-11 items-center justify-center rounded-full text-white/85" aria-label="Lyrics" data-testid="open-lyrics">
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d="M4 5h16v11H8l-4 4V5Z" /><path d="M8 9h8M8 12.5h5" /></svg>
                  </button>
                </div>
              ) : (
              <div className="flex items-center gap-3">
                <div className="min-w-0 flex-1"><TrackTitle id={nowKey} title={now.name} artist={now.artists} dir={dir} /></div>
                <button onClick={() => setLyricsOpen(true)} className="glass flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-white/85" aria-label="Lyrics" data-testid="open-lyrics">
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d="M4 5h16v11H8l-4 4V5Z" /><path d="M8 9h8M8 12.5h5" /></svg>
                </button>
              </div>
              )
            ) : talking && script ? (
              <Lyrics key={script} text={script} clock={clock} />
            ) : phase === "tuning" ? (
              <BootStatus boot={boot} onRetry={() => { stop(); setTimeout(goLive, 50); }} />
            ) : !live ? (
              <SessionPicker mode={listenMode} onMode={pickMode} p={prefs} up={up} />
            ) : (
              <div className="fade-up"><h1 className="text-[22px] font-semibold tracking-tight sm:text-[26px]">{rjName}</h1></div>
            )}
            </div>
          </div>

          {live && <>
            <div className="mt-3 w-full">
              <div className={cx("progress-track h-[5px] w-full overflow-hidden rounded-full transition-opacity", phase !== "song" && "opacity-0")}>
                <div className="progress-fill h-full rounded-full transition-[width] duration-700 ease-linear" style={{ width: `${progress * 100}%` }} />
              </div>
              <div className={cx("mt-1.5 flex justify-between text-[11px] tabular-nums text-white/45", (phase !== "song" || !durS) && "invisible")}>
                <span>{fmt(progress * durS)}</span><span>-{fmt(Math.max(0, durS - progress * durS))}</span>
              </div>
            </div>
            {!ytShow && !(talking && !showSong) && <div className="mt-1 w-full [@media(max-height:760px)]:hidden"><Visualizer active={phase === "song" || talking} paused={paused || ytStalled} getLevel={voiceLevel} className="w-full" /></div>}
            <p className="mt-1 h-4 text-xs text-white/50" aria-live="polite">{paused && live ? "Paused" : status}</p>
          </>}
          {now && (outRef.current === "preview" || phase === "waiting") && now.spotifyUrl && <a href={now.spotifyUrl} target="_blank" rel="noreferrer" className="mt-2 text-xs text-[#1DB954]">Open in Spotify ↗</a>}
        </section>

        {notice && <div className="fade-up glass mb-3 rounded-2xl px-4 py-3 text-center text-sm text-zinc-100">{notice}
          {notice.startsWith("Open the Spotify app") && <button onClick={() => { setNotice(null); stop(); setTimeout(goLive, 80); }} className="ml-2 font-medium text-[#9fc0ff] underline underline-offset-2">Retry</button>}
          {notice.startsWith("Spotify needs a breather") && <button onClick={() => { clearSpotifyBackoff(); setNotice(null); }} className="ml-2 font-medium text-[#9fc0ff] underline underline-offset-2">Try now</button>}</div>}
        {needReconnect && <a href="/api/auth/spotify/login?return=/live" className="mb-3 rounded-2xl bg-[#1DB954] px-4 py-3 text-center text-sm font-medium text-black">Reconnect Spotify to keep playing</a>}

        {phase === "tuning" && !upNext && (
          <div aria-hidden className="glass mb-4 flex items-center gap-3 rounded-2xl p-2.5">
            <div className="skeleton h-10 w-10 rounded-lg" />
            <div className="flex-1 space-y-1.5"><div className="skeleton h-2 w-14 rounded" /><div className="skeleton h-3 w-40 rounded" /></div>
          </div>
        )}

        {upNext && live && !ytShow && !talking && (
          <button onClick={() => setSheet("library")} className="car-hide glass mb-4 flex items-center gap-3 rounded-2xl p-2.5 text-left [@media(max-height:760px)]:hidden" aria-label={`Coming up: ${upNext.name}`}>
            {upNext.image ? <img src={upNext.image} alt="" className="h-10 w-10 rounded-lg object-cover" /> : <div className="h-10 w-10 rounded-lg bg-white/10" />}
            <div className="min-w-0 flex-1">
              <p className="text-[10px] font-medium uppercase tracking-[0.14em] text-white/45">Up next</p>
              <p className="truncate text-sm">{upNext.name} <span className="text-white/45">· {upNext.artists}</span></p>
            </div>
          </button>
        )}

        <div className="sticky bottom-[max(0.75rem,env(safe-area-inset-bottom))] z-20 space-y-3">
          {!live ? (
            <button aria-label="Go Live" onClick={goLive} className="go-live h-14 w-full rounded-full text-[17px] font-semibold sm:h-16 transition active:scale-[0.97]">Go Live</button>
          ) : (
            <>
              {/* transport */}
              <div className="flex items-center justify-center gap-7">
                <button onClick={previous} disabled={phase === "tuning" || phase === "recovering"} className="transport-btn flex h-14 w-14 items-center justify-center rounded-full disabled:opacity-35" aria-label="Previous">
                  <svg width="26" height="26" viewBox="0 0 24 24" fill="currentColor" aria-hidden><path d="M19 6.2v11.6a1 1 0 0 1-1.55.83L9 13v4.5a1 1 0 0 1-2 0v-11a1 1 0 0 1 2 0V11l8.45-5.63A1 1 0 0 1 19 6.2Z" /></svg>
                </button>
                <button onClick={() => { if (ytStalled) tapToPlay(); else togglePause(); }} disabled={phase === "tuning"} aria-label={paused || ytStalled ? "Play" : "Pause"} aria-pressed={paused || ytStalled} data-testid="playpause"
                  className={cx("play-btn flex h-[76px] w-[76px] select-none items-center justify-center rounded-full transition active:scale-[0.93] disabled:opacity-40", !(paused || ytStalled) && phase !== "tuning" && "is-playing")}>
                  <svg className="ico" data-on={paused || ytStalled} width="26" height="26" viewBox="0 0 24 24" fill="currentColor" aria-hidden><path d="M8 5.5v13a1 1 0 0 0 1.5.86l10.5-6.5a1 1 0 0 0 0-1.72L9.5 4.64A1 1 0 0 0 8 5.5Z" /></svg>
                  <svg className="ico" data-on={!(paused || ytStalled)} width="26" height="26" viewBox="0 0 24 24" fill="currentColor" aria-hidden><rect x="6" y="5" width="4" height="14" rx="1.3" /><rect x="14" y="5" width="4" height="14" rx="1.3" /></svg>
                </button>
                <button onClick={next} disabled={phase === "tuning" || phase === "recovering"} className="transport-btn flex h-14 w-14 items-center justify-center rounded-full disabled:opacity-35" aria-label="Next">
                  <svg width="26" height="26" viewBox="0 0 24 24" fill="currentColor" aria-hidden><path d="M5 6.2v11.6a1 1 0 0 0 1.55.83L15 13v4.5a1 1 0 0 0 2 0v-11a1 1 0 0 0-2 0V11L6.55 5.37A1 1 0 0 0 5 6.2Z" /></svg>
                </button>
              </div>
              {!touchUi && canDuck() && (
                <label className="flex items-center gap-3 px-2 text-white/50" aria-label="Volume">
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden><path d="M4 9h4l5-4v14l-5-4H4V9Z" /></svg>
                  <input type="range" min={0} max={1} step={0.01} value={vol} onChange={(e) => { const v = Number(e.target.value); setVol(v); volRef.current = v; setSongVol(songVolRef.current); }} className="vol-slider h-1 flex-1" />
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden><path d="M4 9h4l5-4v14l-5-4H4V9Z" fill="currentColor" /><path d="M16 8.5a5 5 0 0 1 0 7M18.5 6a8.5 8.5 0 0 1 0 12" strokeLinecap="round" /></svg>
                </label>
              )}
              {/* dock: everything else, thumb-reachable */}
              {car && wakeOk === false && <p className="text-center text-[13px] leading-snug text-[#ffd479]" data-testid="car-wake-tip">This phone won&apos;t keep the screen on by itself. Set Settings → Display &amp; Brightness → Auto-Lock → Never while you drive, and keep MyRJ on screen.</p>}
              {car && wakeOk !== false && <p className="text-center text-[12px] text-white/45" data-testid="car-tip">Screen stays on. Keep MyRJ on screen: if you lock the phone or switch apps, the radio waits until you come back.</p>}
              <div className="car-hide liquid-glass dock flex w-full items-center justify-between" data-testid="dock">
                <DockBtn label="Request a song or mood" text="Request" onClick={() => setSheet("discover")} icon={<path d="M12 3.5 13.9 8l4.6.4-3.5 3 1.1 4.5L12 13.5 7.9 15.9 9 11.4l-3.5-3L10.1 8 12 3.5ZM5 19.5h14" />} />
                <DockBtn label="Library and playlists" text="Library" onClick={() => setSheet("library")} icon={<path d="M5 4.5v15M9.5 4.5v15M14 5l4.5 14" />} />
                <DockBtn label="Station and songs" text="Station" onClick={openPicker} icon={DOCK_ICONS[listenMode]} />
                <DockBtn label="Host and voice settings" text="Host" onClick={() => setDrawer(true)} icon={<><rect x="9" y="3" width="6" height="11" rx="3" /><path d="M5.5 11a6.5 6.5 0 0 0 13 0M12 17.5V21M8.5 21h7" /></>} />
                <button onClick={() => stop("Off air. Tap Go Live to tune back in.")} className="dock-btn" aria-label="Stop, go off air">
                  <span className="mt-[3px] h-[14px] w-[14px] rounded-[3px] bg-current" /><span aria-hidden className="mt-[3px]">Stop</span>
                </button>
              </div>
            </>
          )}
        </div>

        <button aria-expanded={showDiag} onClick={() => setShowDiag((v) => !v)} className="car-hide mt-3 text-[10px] uppercase tracking-[0.14em] text-white/40 hover:text-white/70">
          {diag.error && live ? "● " : ""}Playback details
        </button>
        {showDiag && (
          <div className="glass fade-up mt-2 rounded-2xl p-3 text-left font-mono text-[11px] text-zinc-300">
            <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1">
              <dt>output</dt><dd>{diag.output ?? "-"}</dd>
              <dt>account</dt><dd className="truncate">{diag.account ?? "-"} {diag.product && `(${diag.product})`}</dd>
              <dt>scopes</dt><dd>{diag.scopes ?? "-"}</dd>
              <dt>web player</dt><dd>{diag.sdk ?? "-"}</dd>
              <dt>device</dt><dd>{diag.device ?? "-"}</dd>
              <dt>breaks</dt><dd className="break-words">{diag.breaks ?? "-"}</dd>
              <dt>rj script</dt><dd className={cx("break-words", diag.script?.startsWith("failed") && "text-red-300")}>{diag.script ?? "-"}</dd>
              <dt>rj voice</dt><dd className={cx("break-words", diag.voice?.startsWith("failed") && "text-red-300")}>{diag.voice ?? "-"}</dd>
              <dt>audio</dt><dd className={cx("break-words", diag.audio && diag.audio !== "ok" && "text-red-300")}>{diag.audio ?? "-"}</dd>
              <dt>cover art</dt><dd>{showSong ? (art?.kind === "album" ? "album cover" : art?.kind === "thumb" ? "video thumbnail" : art ? "generated" : "loading") : "-"}</dd>
              {diag.error && <><dt className="text-red-400">error</dt><dd className="break-words text-red-300">{diag.error}</dd></>}
            </dl>
            {!!diag.log?.length && <pre className="mt-2 max-h-32 overflow-y-auto whitespace-pre-wrap text-zinc-400">{diag.log.slice(-10).join("\n")}</pre>}
            <a href="/api/auth/spotify/login?return=/live" className="mt-2 inline-block text-[#1DB954]">Reconnect Spotify</a>
          </div>
        )}
      </div>

      <Sheet open={picker} onClose={closePicker} label="Station and songs" footer={live ? mini : undefined}>
        <SessionPicker mode={pickerMode} onMode={setPickerMode} p={prefs} up={up} />
        <button onClick={closePicker} className="go-live mt-5 h-12 w-full rounded-full text-[15px] font-semibold active:scale-[0.98]">Done</button>
      </Sheet>

      <Sheet open={sheet === "discover"} onClose={() => setSheet(null)} label="Request" footer={live ? mini : undefined}>
        <DiscoverPanel p={prefs} up={up} busy={reqBusy} last={reqMsg} live={live} onRequest={requestSteer} onOpenTaste={() => setSheet("taste")} />
      </Sheet>
      <Sheet open={sheet === "taste"} onClose={() => setSheet(null)} label="Your taste" footer={live ? mini : undefined}>
        <TastePanel p={prefs} up={upTaste} onRequest={(r) => { setSheet("discover"); requestSteer(r); }} />
      </Sheet>
      <Sheet open={sheet === "library"} onClose={() => setSheet(null)} label="Library" footer={live ? mini : undefined}>
        <LibraryPanel p={prefs} up={up} upcoming={upcoming} source={prefs.music} onStation={changeStation} />
      </Sheet>

      <Sheet open={drawer} onClose={() => setDrawer(false)} label="Your RJ" footer={live ? mini : undefined}>
        <div className="flex items-center justify-between pb-2">
          <div><h2 className="text-[28px] font-bold tracking-tight">Your RJ</h2><p className="text-[13px] text-white/50">Changes apply from the next break.</p></div>
          <button onClick={() => setDrawer(false)} className="glass h-10 rounded-full px-4 text-sm">Done</button>
        </div>
        <div className="pt-4"><AllPrefs p={prefs} up={up} compact returnTo="/live" /></div>
      </Sheet>

      <LyricsView open={lyricsOpen} onClose={() => setLyricsOpen(false)} trackId={showSong ? nowKey : null} title={now?.name ?? ""} artist={now?.artists ?? ""}
        durationS={durS || undefined} clock={songClock} art={artUrl} color={showSong ? art?.color : null} />
    </main>
  );
}

function DockBtn({ label, text, onClick, icon }: { label: string; text: string; onClick: () => void; icon: React.ReactNode }) {
  return (
    <button onClick={onClick} className="dock-btn" aria-label={label}>
      <svg width="21" height="21" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden>{icon}</svg>
      <span aria-hidden>{text}</span>
    </button>
  );
}

export default function Live() {
  return <Suspense><LiveInner /></Suspense>;
}

const DOCK_ICONS: Record<ListenMode, React.ReactNode> = {
  default: <path d="M4 10h16v9a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1v-9Zm3-4 10-3M8 15h.01M14 13.5h3M14 16.5h3" />,
  gym: <path d="M6.5 6.5v11M17.5 6.5v11M3.5 9v6M20.5 9v6M6.5 12h11" />,
  drive: <path d="M5 16V11l2-5h10l2 5v5M5 16h14M5 16v2M19 16v2M7.5 13h.01M16.5 13h.01" />,
  romantic_m: <path d="M12 20s-7-4.4-7-10a4 4 0 0 1 7-2.5A4 4 0 0 1 19 10c0 5.6-7 10-7 10Z" />,
  romantic_f: <path d="M12 20s-7-4.4-7-10a4 4 0 0 1 7-2.5A4 4 0 0 1 19 10c0 5.6-7 10-7 10Z" />,
  romantic_s: <path d="M12 21c-3.9 0-7-2.9-7-6.6 0-3.2 2.4-5 3.6-7.9.4 1.8 1.4 3 2.6 3.6C11.6 6.7 13 4.4 15.3 3c-.4 2.6.7 4.6 2 6.2 1.1 1.4 1.7 3 1.7 4.8C19 18 15.9 21 12 21Z" />,
  focus: <path d="M4 15v-3a8 8 0 0 1 16 0v3M4 15a2 2 0 0 0 2 2h1v-5H6a2 2 0 0 0-2 2Zm16 0a2 2 0 0 1-2 2h-1v-5h1a2 2 0 0 1 2 2Z" />,
};

/** Honest start-up progress: hidden for the first 300ms, each step shown at least 600ms, cross-faded, and a nudge + retry after 8s. */
function BootStatus({ boot, onRetry }: { boot: { step: string; label: string; since: number } | null; onRetry: () => void }) {
  const [shown, setShown] = useState<{ label: string; at: number } | null>(null);
  const [now, setNow] = useState(Date.now());
  const [visible, setVisible] = useState(false);
  useEffect(() => { const t = setTimeout(() => setVisible(true), 300); const i = setInterval(() => setNow(Date.now()), 500); return () => { clearTimeout(t); clearInterval(i); }; }, []);
  useEffect(() => {
    if (!boot) return;
    const wait = shown ? Math.max(0, 600 - (Date.now() - shown.at)) : 0;
    const t = setTimeout(() => setShown({ label: boot.label, at: Date.now() }), wait);
    return () => clearTimeout(t);
  }, [boot?.label]); // eslint-disable-line react-hooks/exhaustive-deps
  const slow = boot && now - boot.since > 8000;
  return (
    <div className="w-full" role="status" aria-live="polite">
      <div aria-hidden className="mx-auto flex flex-col items-center gap-2">
        <div className="skeleton h-6 w-48 rounded-lg" /><div className="skeleton h-3.5 w-32 rounded" />
      </div>
      <div className={cx("mt-4 transition-opacity duration-300", !visible && "opacity-0")}><p key={shown?.label} className="fade-up text-[13px] text-zinc-400">{shown?.label ?? "Tuning in…"}</p></div>
      {slow && (
        <p className="fade-up mt-1 text-xs text-zinc-500">
          Taking a bit longer than usual{boot?.step === "device" ? ", is Spotify open somewhere?" : boot?.step === "rj" ? ", the RJ is still writing" : ""}. <button onClick={onRetry} className="text-[#f3efe8] underline-offset-2 hover:underline">Retry</button>
        </p>
      )}
    </div>
  );
}

function langSummary(l: Prefs["songLangs"]) {
  if (!l?.length || l.includes("any")) return "Any language";
  const names = l.map((x) => x[0].toUpperCase() + x.slice(1));
  return names.length > 2 ? `${names.slice(0, 2).join(", ")} +${names.length - 2}` : names.join(", ");
}

/** Pre-live picker: mode (single), song languages (multi), what the RJ talks about. Compact enough for a phone without scrolling. */
function SessionPicker({ mode, onMode, p, up }: { mode: ListenMode; onMode: (m: ListenMode) => void; p: Prefs; up: <K extends keyof Prefs>(k: K, v: Prefs[K]) => void }) {
  const label = "mb-1.5 text-left text-[11px] font-medium uppercase tracking-[0.14em] text-zinc-500";
  return (
    <div className="fade-up w-full space-y-3 text-left">
      <div>
        <p className={label}>Mode</p>
        <div className="grid grid-cols-4 gap-1.5" role="radiogroup" aria-label="Mode">
          {MODES.map((m) => (
            <button key={m.id} role="radio" aria-checked={mode === m.id} onClick={() => onMode(m.id)}
              className={cx("flex h-[54px] [@media(max-height:700px)]:h-12 flex-col items-center justify-center gap-0.5 rounded-2xl border text-[12px] font-medium transition active:scale-95", mode === m.id ? "chip-pop border-[#f3efe8] bg-[#f3efe8] text-[#141210]" : "border-white/10 text-zinc-300 hover:border-white/25")}>
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden>{DOCK_ICONS[m.id]}</svg>
              {m.label}
            </button>
          ))}
        </div>
      </div>
      <div>
        <p className={label}>Romantic Hindi</p>
        <div className="grid grid-cols-3 gap-1.5" role="radiogroup" aria-label="Romantic Hindi voice">
          {ROMANTIC_MODES.map((m) => (
            <button key={m.id} role="radio" aria-checked={mode === m.id} aria-label={`${m.label} · ${m.sub}`} onClick={() => onMode(m.id)}
              className={cx("flex h-10 [@media(max-height:700px)]:h-9 items-center justify-center gap-2 rounded-2xl border px-2 text-[12px] font-medium transition active:scale-95", mode === m.id ? "chip-pop border-[#f3efe8] bg-[#f3efe8] text-[#141210]" : "border-white/10 text-zinc-300 hover:border-white/25")}>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden className="shrink-0">{DOCK_ICONS[m.id]}</svg>
              <span className="leading-tight">{m.sub}<span className="block text-[10px] font-normal opacity-70">हिन्दी · {m.id === "romantic_s" ? "sensual" : "romantic"}</span></span>
            </button>
          ))}
        </div>
      </div>
      <div><p className={label}>Music from</p><MusicSourcePicker p={p} up={up} small /></div>
      <div><p className={label}>Songs in</p>{isRomantic(mode) ? <p className="flex h-8 items-center text-[13px] text-zinc-400" data-testid="songs-hindi-only">{mode === "romantic_s" ? "Hindi sensual only" : "Hindi romantic only"} for this session</p> : <SongLangPicker p={p} up={up} small />}</div>
      <div><p className={label}>RJ talks about</p><TalkToggles p={p} up={up} small /></div>
    </div>
  );
}
