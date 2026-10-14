"use client";
/* eslint-disable @next/next/no-img-element */
import { useEffect, useRef, useState } from "react";
import { SONG_LANGS, toggleSongLang, DEFAULT_PREFS, ENERGIES, HUMORS, LANGUAGES, MODES, loadPrefs, savePrefs, type Prefs, type TrackInfo } from "@/lib/prefs";
import { getMe } from "@/lib/spotifyClient";
import { Button, Chip, Section, Spinner, cx, inputCls } from "./ui";
import { AccountPanel } from "./account";

export type Up = <K extends keyof Prefs>(k: K, v: Prefs[K]) => void;

/** Prefs from localStorage, auto-saved on change, synced across components/tabs. */
export function usePrefs(): [Prefs, Up, boolean, (p: Prefs) => void] {
  const [p, setP] = useState<Prefs>(DEFAULT_PREFS);
  const [loaded, setLoaded] = useState(false);
  useEffect(() => {
    setP(loadPrefs()); setLoaded(true);
    const sync = () => setP(loadPrefs());
    window.addEventListener("storage", sync);
    return () => window.removeEventListener("storage", sync);
  }, []);
  const set = (np: Prefs) => { setP(np); savePrefs(np); };
  const up: Up = (k, v) => setP((x) => { const n = { ...x, [k]: v }; savePrefs(n); return n; });
  return [p, up, loaded, set];
}

type Voice = { id: string; provider: "azure" | "elevenlabs"; name: string; locale?: string; labels: Record<string, string>; previewUrl?: string };
let voiceCache: Voice[] | null = null;
export function useVoices() {
  const [voices, setVoices] = useState<Voice[]>(voiceCache ?? []);
  const [error, setError] = useState("");
  useEffect(() => {
    if (voiceCache) return;
    fetch("/api/voices").then((r) => r.json()).then((j) => {
      if (j.voices) { voiceCache = j.voices; setVoices(j.voices); } else setError(j.error ?? "Couldn't load voices");
    }).catch(() => setError("Couldn't load voices"));
  }, []);
  return { voices, error };
}

export function NameFields({ p, up }: { p: Prefs; up: Up }) {
  return (
    <div className="space-y-3">
      <label className="block space-y-1.5"><span className="text-sm text-zinc-400">Your RJ&apos;s name</span>
        <input className={inputCls} value={p.rjName} onChange={(e) => up("rjName", e.target.value)} placeholder="RJ Jockey" /></label>
      <label className="block space-y-1.5"><span className="text-sm text-zinc-400">What should your RJ call you?</span>
        <input className={inputCls} value={p.listenerName} onChange={(e) => up("listenerName", e.target.value)} placeholder="Abhishek" /></label>
    </div>
  );
}

export function LanguagePicker({ p, up }: { p: Prefs; up: Up }) {
  return <div className="flex flex-wrap gap-2">{LANGUAGES.map((l) => <Chip key={l.id} on={p.language === l.id} onClick={() => up("language", l.id)}>{l.label}</Chip>)}</div>;
}
export function EnergyPicker({ p, up }: { p: Prefs; up: Up }) {
  const desc = { chill: "Calm, warm, easy", balanced: "Friendly, upbeat", hype: "Loud, fast, full energy" };
  return (
    <div className="grid grid-cols-3 gap-2">
      {ENERGIES.map((e) => (
        <button key={e} onClick={() => up("energy", e)} className={cx("rounded-2xl border p-3 text-left transition", p.energy === e ? "border-white bg-white text-black" : "border-white/10 hover:border-white/25")}>
          <div className="text-sm font-medium capitalize">{e}</div><div className={cx("mt-0.5 text-xs", p.energy === e ? "text-zinc-600" : "text-zinc-500")}>{desc[e]}</div>
        </button>
      ))}
    </div>
  );
}
export function HumorPicker({ p, up }: { p: Prefs; up: Up }) {
  const i = HUMORS.indexOf(p.humor);
  return (
    <div className="space-y-3">
      <input type="range" min={0} max={HUMORS.length - 1} value={i} onChange={(e) => up("humor", HUMORS[Number(e.target.value)])} className="w-full accent-[#f3efe8]" />
      <div className="flex justify-between text-xs text-zinc-500">{HUMORS.map((h) => <span key={h} className={cx("capitalize", h === p.humor && "text-white font-medium")}>{h}</span>)}</div>
    </div>
  );
}
export function ModePicker({ value, onChange }: { value: Prefs["defaultMode"]; onChange: (m: Prefs["defaultMode"]) => void }) {
  return (
    <div className="grid grid-cols-2 gap-2">
      {MODES.map((m) => (
        <button key={m.id} onClick={() => onChange(m.id)} className={cx("rounded-2xl border p-4 text-left transition", value === m.id ? "border-white bg-white text-black" : "border-white/10 hover:border-white/25")}>
          <div className="text-xl">{m.emoji}</div><div className="mt-2 text-sm font-medium">{m.label}</div>
          <div className={cx("text-xs", value === m.id ? "text-zinc-600" : "text-zinc-500")}>{m.blurb}</div>
        </button>
      ))}
    </div>
  );
}

export function TopicsEditor({ p, up }: { p: Prefs; up: Up }) {
  const [t, setT] = useState("");
  const SUGGEST = ["AI", "Startups", "Cricket", "Tech", "Bollywood", "Markets", "Pune", "Science", "F1", "Space"];
  const add = (x: string) => { x = x.trim(); if (x && !p.newsTopics.some((y) => y.toLowerCase() === x.toLowerCase())) up("newsTopics", [...p.newsTopics, x]); };
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-2">
        {SUGGEST.map((s) => { const on = p.newsTopics.some((y) => y.toLowerCase() === s.toLowerCase());
          return <Chip key={s} on={on} onClick={() => on ? up("newsTopics", p.newsTopics.filter((y) => y.toLowerCase() !== s.toLowerCase())) : add(s)}>{s}</Chip>; })}
        {p.newsTopics.filter((y) => !SUGGEST.some((s) => s.toLowerCase() === y.toLowerCase())).map((y) =>
          <Chip key={y} on onClick={() => up("newsTopics", p.newsTopics.filter((z) => z !== y))}>{y} ✕</Chip>)}
      </div>
      <form onSubmit={(e) => { e.preventDefault(); add(t); setT(""); }}>
        <input className={inputCls} placeholder="Add your own topic and press enter" value={t} onChange={(e) => setT(e.target.value)} />
      </form>
    </div>
  );
}

export function VoicePicker({ p, up, compact }: { p: Prefs; up: Up; compact?: boolean }) {
  const { voices, error } = useVoices();
  const [playing, setPlaying] = useState<string | null>(null);
  const [rjBusy, setRjBusy] = useState(false);
  const audio = useRef<HTMLAudioElement | null>(null);
  useEffect(() => {
    if (!p.voiceId && voices[0]) {
      const want = p.language === "hindi" ? "azure:hi-IN-SwaraNeural" : p.language === "marathi" ? "azure:mr-IN-AarohiNeural" : "azure:en-IN-NeerjaNeural";
      const v = voices.find((x) => x.id === want) ?? voices[0];
      up("voiceId", v.id); up("voiceName", v.name);
    }
  }, [voices]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => () => audio.current?.pause(), []);

  function play(url: string, id: string) {
    audio.current?.pause();
    const a = new Audio(url); audio.current = a; setPlaying(id);
    a.onended = () => setPlaying(null); a.onerror = () => setPlaying(null);
    a.play().catch(() => setPlaying(null));
  }
  async function preview(v: Voice) {
    if (v.previewUrl) return play(v.previewUrl, v.id);
    setPlaying(v.id);
    const sample = v.locale === "hi-IN" ? `नमस्ते ${p.listenerName}, मैं हूँ आपकी RJ।` : v.locale === "mr-IN" ? `नमस्कार ${p.listenerName}, मी तुमचा RJ.` : `Hey ${p.listenerName}, this is your RJ. Ready when you are.`;
    const r = await fetch("/api/tts", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ text: sample, voiceId: v.id, energy: p.energy, language: p.language }) }).catch(() => null);
    if (r?.ok) play(URL.createObjectURL(await r.blob()), v.id); else setPlaying(null);
  }
  async function hearAsRj() {
    setRjBusy(true);
    try {
      const lines = { english: `Hey ${p.listenerName}, this is ${p.rjName}. Ready when you are.`, hinglish: `Hello ${p.listenerName}, main hoon ${p.rjName}. Chalo shuru karte hain!`, hindi: `नमस्ते ${p.listenerName}, मैं हूँ ${p.rjName}। चलिए शुरू करते हैं!`, marathi: `नमस्कार ${p.listenerName}, मी ${p.rjName}. चला सुरू करूया!` };
      const r = await fetch("/api/tts", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ text: lines[p.language], voiceId: p.voiceId, energy: p.energy, language: p.language, mode: p.defaultMode }) });
      if (r.ok) play(URL.createObjectURL(await r.blob()), "rj");
    } finally { setRjBusy(false); }
  }

  const groups: [string, Voice[]][] = [];
  const add = (label: string, list: Voice[]) => { if (list.length) groups.push([label, list]); };
  const az = voices.filter((v) => v.provider === "azure");
  add("Azure · English (India)", az.filter((v) => v.locale === "en-IN"));
  add("Azure · Hindi", az.filter((v) => v.locale === "hi-IN"));
  add("Azure · Marathi", az.filter((v) => v.locale === "mr-IN"));
  add("Azure · Multilingual", az.filter((v) => !["en-IN", "hi-IN", "mr-IN"].includes(v.locale ?? "")));
  add("ElevenLabs", voices.filter((v) => v.provider === "elevenlabs"));
  if (error) return <p className="text-sm text-red-300">{error}. Add an Azure Speech or ElevenLabs key.</p>;
  if (!voices.length) return <div className="flex items-center gap-2 text-sm text-zinc-500"><Spinner /> Loading voices…</div>;
  return (
    <div className="space-y-3">
      <div className={cx("space-y-5 overflow-y-auto no-scrollbar pr-1", compact ? "max-h-72" : "max-h-[50vh]")}>
        {groups.map(([label, list]) => (
          <div key={label} className="space-y-2">
            <div className="text-[11px] uppercase tracking-[0.14em] text-zinc-500">{label}</div>
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        {list.map((v) => {
          const on = p.voiceId === v.id;
          return (
            <div key={v.id} onClick={() => { up("voiceId", v.id); up("voiceName", v.name); }}
              className={cx("flex cursor-pointer items-center gap-3 rounded-2xl border px-3 py-2.5 transition", on ? "border-white bg-white/10" : "border-white/10 hover:border-white/25")}>
              <button onClick={(e) => { e.stopPropagation(); if (playing === v.id) { audio.current?.pause(); setPlaying(null); } else preview(v); }}
                className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-white/10 text-xs hover:bg-white/20" aria-label="Preview">{playing === v.id ? "❚❚" : "▶"}</button>
              <div className="min-w-0">
                <div className="truncate text-sm font-medium">{v.name.split(" - ")[0]}</div>
                <div className="truncate text-xs text-zinc-500 capitalize">{[v.labels.gender, v.labels.accent, v.labels.age].filter(Boolean).join(" · ").replace(/_/g, " ")}</div>
              </div>
              {on && <span className="ml-auto text-xs">✓</span>}
            </div>
          );
        })}
            </div>
          </div>
        ))}
      </div>
      <button onClick={hearAsRj} disabled={rjBusy || !p.voiceId} className="flex items-center gap-2 text-sm text-[#f3efe8] hover:text-[#ffffff] disabled:opacity-50">
        {rjBusy ? <Spinner /> : "▶"} Hear it as your RJ, in {LANGUAGES.find((l) => l.id === p.language)?.label}
      </button>
    </div>
  );
}

export function SpotifyConnect({ returnTo = "/settings" }: { returnTo?: string }) {
  const [me, setMe] = useState<{ display_name: string; product: string } | null | undefined>(undefined);
  useEffect(() => { getMe().then(setMe).catch(() => setMe(null)); }, []);
  if (me === undefined) return <div className="flex items-center gap-2 text-sm text-zinc-500"><Spinner /> Checking Spotify…</div>;
  if (!me) return (
    <a href={`/api/auth/spotify/login?return=${encodeURIComponent(returnTo)}`} className="inline-flex h-12 items-center gap-2 rounded-full bg-[#1DB954] px-6 text-[15px] font-medium text-black transition hover:brightness-110 active:scale-[0.97]">
      Connect Spotify
    </a>
  );
  return (
    <div className="flex items-center justify-between rounded-2xl border border-white/10 px-4 py-3">
      <div>
        <div className="text-sm font-medium">{me.display_name} <span className="ml-1 text-xs text-[#1DB954]">● connected</span></div>
        <div className="text-xs text-zinc-500">{me.product === "premium" ? "Premium: full songs play in MyRJ" : "Free: full songs need Premium"}</div>
      </div>
      <button className="text-xs text-zinc-500 hover:text-white" onClick={async () => { await fetch("/api/spotify/logout", { method: "POST" }); setMe(null); }}>Disconnect</button>
    </div>
  );
}

export function ExternalPlaylists({ p, up }: { p: Prefs; up: Up }) {
  const [v, setV] = useState("");
  return (
    <div className="space-y-2">
      <form onSubmit={(e) => { e.preventDefault(); if (v.trim()) up("externalPlaylists", [...p.externalPlaylists, { url: v.trim(), addedAt: new Date().toISOString() }]); setV(""); }}>
        <input className={inputCls} placeholder="Paste a YouTube Music, Apple Music or JioSaavn link" value={v} onChange={(e) => setV(e.target.value)} />
      </form>
      {p.externalPlaylists.map((x, i) => (
        <div key={i} className="flex items-center justify-between gap-2 text-sm text-zinc-400">
          <a className="truncate hover:text-white" href={x.url} target="_blank" rel="noreferrer">{x.url}</a>
          <button className="text-zinc-600 hover:text-white" onClick={() => up("externalPlaylists", p.externalPlaylists.filter((_, j) => j !== i))}>✕</button>
        </div>
      ))}
    </div>
  );
}

/** Every preference in one scrollable column. Used by /settings and the /live drawer. */
export function AllPrefs({ p, up, compact, returnTo }: { p: Prefs; up: Up; compact?: boolean; returnTo?: string }) {
  return (
    <div className="space-y-10">
      <AccountPanel returnTo={returnTo} />
      <Section title="You & your RJ"><NameFields p={p} up={up} /></Section>
      <Section title="Language"><LanguagePicker p={p} up={up} /></Section>
      <Section title="Voice" hint="Tap ▶ to preview."><VoicePicker p={p} up={up} compact={compact} /></Section>
      <Section title="Energy"><EnergyPicker p={p} up={up} /></Section>
      <Section title="Humor" hint="From squeaky clean to pitch dark."><HumorPicker p={p} up={up} /></Section>
      <Section title="News" hint="Only these topics make it on air."><TopicsEditor p={p} up={up} /></Section>
      <Section title="Song language" hint="Which songs to play. Your RJ's speaking language is set above."><SongLangPicker p={p} up={up} /></Section>
      <Section title="Your RJ talks about"><TalkToggles p={p} up={up} /></Section>
      <Section title="Default mode"><ModePicker value={p.defaultMode} onChange={(m) => up("defaultMode", m)} /></Section>
      <Section title="Spotify"><SpotifyConnect returnTo={returnTo} /></Section>
      <Section title="Add your music from anywhere" hint="Screenshots from YouTube Music, Apple Music, JioSaavn, a playlist link, or a typed list. MyRJ finds them on Spotify and leans your radio towards them."><MusicImport p={p} up={up} /></Section>
      <Section title="YouTube" hint="Pull your liked music and playlists from YouTube / YouTube Music."><YouTubeConnect p={p} up={up} returnTo={returnTo} /></Section>
    </div>
  );
}

async function shrink(file: File): Promise<string> {
  const url = URL.createObjectURL(file);
  const img = await new Promise<HTMLImageElement>((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = url; });
  const scale = Math.min(1, 1600 / Math.max(img.width, img.height));
  const c = document.createElement("canvas");
  c.width = Math.round(img.width * scale); c.height = Math.round(img.height * scale);
  c.getContext("2d")!.drawImage(img, 0, 0, c.width, c.height);
  URL.revokeObjectURL(url);
  return c.toDataURL("image/jpeg", 0.8);
}

/** Match songs on Spotify and add new ones to taste seeds. Returns a human summary. */
async function addSongs(songs: { title: string; artist: string }[], p: Prefs, up: Up, setBusy: (s: string) => void) {
  setBusy(`Found ${songs.length} songs. Matching on Spotify…`);
  const { matchTrack } = await import("@/lib/spotifyClient");
  const matched: TrackInfo[] = [];
  for (let i = 0; i < songs.length; i += 5) {
    const batch = await Promise.all(songs.slice(i, i + 5).map((s) => matchTrack(s.title, s.artist)));
    matched.push(...(batch.filter(Boolean) as TrackInfo[]));
    setBusy(`Matching on Spotify… ${Math.min(i + 5, songs.length)}/${songs.length}`);
  }
  const have = new Set(p.tasteSeeds.map((t) => t.uri));
  const fresh = matched.filter((t) => t.uri && !have.has(t.uri) && (have.add(t.uri!), true));
  up("tasteSeeds", [...fresh, ...p.tasteSeeds].slice(0, 300));
  return matched.length ? `Added ${fresh.length} song${fresh.length === 1 ? "" : "s"}${matched.length - fresh.length ? ` (${matched.length - fresh.length} already there)` : ""}. Your radio will lean into these.` : "Found songs, but couldn't match them on Spotify. Is Spotify connected?";
}

/** YouTube connect: liked music videos + your playlists -> Spotify matches -> taste seeds. */
export function YouTubeConnect({ p, up, returnTo = "/settings" }: { p: Prefs; up: Up; returnTo?: string }) {
  const [st, setSt] = useState<{ configured: boolean; connected: boolean } | null>(null);
  const [busy, setBusy] = useState("");
  const [msg, setMsg] = useState("");
  useEffect(() => { fetch("/api/youtube/songs?status").then((r) => r.json()).then(setSt).catch(() => setSt({ configured: false, connected: false })); }, []);
  async function pull() {
    setMsg(""); setBusy("Reading your YouTube likes & playlists…");
    try {
      const r = await fetch("/api/youtube/songs"); const j = await r.json();
      if (!r.ok) throw new Error(j.error ?? "YouTube import failed");
      if (!j.songs.length) { setMsg("No music found in your YouTube likes or playlists yet."); return; }
      setMsg(await addSongs(j.songs, p, up, setBusy));
    } catch (e) { setMsg(String(e instanceof Error ? e.message : e)); } finally { setBusy(""); }
  }
  if (!st) return <Spinner />;
  if (!st.configured) return <p className="text-sm text-zinc-500">YouTube sign-in isn&apos;t set up on this server yet.</p>;
  return (
    <div className="space-y-3">
      {st.connected ? (
        <div className="flex flex-wrap gap-2">
          <Button variant="light" className="h-11" onClick={pull} disabled={!!busy}>{busy ? <><Spinner /> {busy}</> : "Import likes & playlists"}</Button>
          <Button variant="ghost" className="h-11" onClick={async () => { await fetch("/api/youtube/disconnect", { method: "POST" }); setSt({ ...st, connected: false }); }}>Disconnect</Button>
        </div>
      ) : (
        <a href={`/api/auth/youtube/login?return=${encodeURIComponent(returnTo)}`} className="inline-flex h-11 items-center gap-2 rounded-full border border-white/10 px-5 text-sm text-white hover:border-white/25">
          <span className="text-red-500">▶</span> Connect YouTube
        </a>
      )}
      {msg && <p className="text-sm text-zinc-400">{msg}</p>}
    </div>
  );
}

/** "Add your music from anywhere": screenshots, links or a typed list -> Claude -> Spotify matches -> taste seeds. */
export function MusicImport({ p, up }: { p: Prefs; up: Up }) {
  const [text, setText] = useState("");
  const [busy, setBusy] = useState("");
  const [msg, setMsg] = useState("");
  const fileRef = useRef<HTMLInputElement>(null);

  async function run(files: File[] = []) {
    if (!files.length && !text.trim()) { fileRef.current?.click(); return; }
    setMsg(""); setBusy(files.length ? "Reading your screenshots…" : "Reading…");
    try {
      const images = await Promise.all(files.slice(0, 6).map(shrink));
      const r = await fetch("/api/import", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ images, text }) });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error ?? "Import failed");
      const songs = j.songs as { title: string; artist: string }[];
      if (!songs.length) { setMsg("Couldn't spot any songs there. Try a clearer screenshot or a list."); return; }
      const res = await addSongs(songs, p, up, setBusy);
      setMsg(res);
      setText("");
    } catch (e) { setMsg(String(e instanceof Error ? e.message : e)); }
    finally { setBusy(""); }
  }

  return (
    <div className="space-y-3">
      <div
        onDragOver={(e) => e.preventDefault()}
        onDrop={(e) => { e.preventDefault(); run([...e.dataTransfer.files].filter((f) => f.type.startsWith("image/"))); }}
        onPaste={(e) => { const f = [...e.clipboardData.files].filter((x) => x.type.startsWith("image/")); if (f.length) { e.preventDefault(); run(f); } }}
        className="rounded-2xl border border-dashed border-white/15 p-4">
        <textarea value={text} onChange={(e) => setText(e.target.value)} rows={2}
          placeholder="Paste a playlist link, or type songs (one per line). Or drop/paste screenshots here."
          className="w-full resize-none bg-transparent text-[15px] placeholder:text-zinc-600 outline-none" />
        <div className="mt-2 flex items-center gap-2">
          <button onClick={() => fileRef.current?.click()} disabled={!!busy} className="h-10 rounded-full border border-white/10 px-4 text-sm text-zinc-300 hover:border-white/25 disabled:opacity-40">📷 Screenshots</button>
          <button onClick={() => run()} disabled={!!busy || !text.trim()} className="h-10 rounded-full bg-white px-5 text-sm font-medium text-black disabled:opacity-30">Add songs</button>
          <input ref={fileRef} type="file" accept="image/*" multiple hidden onChange={(e) => { run([...(e.target.files ?? [])]); e.target.value = ""; }} />
        </div>
      </div>
      {busy && <div className="flex items-center gap-2 text-sm text-zinc-400"><Spinner /> {busy}</div>}
      {msg && !busy && <p className="text-sm text-zinc-400">{msg}</p>}
      {p.tasteSeeds.length > 0 && (
        <div className="space-y-1.5">
          <div className="flex items-center justify-between text-xs text-zinc-500">
            <span>{p.tasteSeeds.length} songs shaping your radio</span>
            <button className="hover:text-white" onClick={() => up("tasteSeeds", [])}>Clear all</button>
          </div>
          <div className="max-h-64 space-y-1 overflow-y-auto no-scrollbar">
            {p.tasteSeeds.map((t) => (
              <div key={t.uri} className="flex items-center gap-3 rounded-xl px-1 py-1">
                {t.image ? <img src={t.image} alt="" className="h-9 w-9 rounded-md" /> : <div className="h-9 w-9 rounded-md bg-white/10" />}
                <div className="min-w-0 flex-1"><div className="truncate text-sm">{t.name}</div><div className="truncate text-xs text-zinc-500">{t.artists}</div></div>
                <button className="px-2 text-zinc-600 hover:text-white" aria-label="Remove" onClick={() => up("tasteSeeds", p.tasteSeeds.filter((x) => x.uri !== t.uri))}>✕</button>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}


export function SongLangPicker({ p, up, small }: { p: Prefs; up: Up; small?: boolean }) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {SONG_LANGS.map((l) => {
        const on = p.songLangs.includes(l.id);
        return <button key={l.id} type="button" aria-pressed={on} onClick={() => up("songLangs", toggleSongLang(p.songLangs, l.id))}
          className={cx("rounded-full border px-3.5 transition active:scale-95", small ? "h-8 text-[13px]" : "h-9 text-sm", on ? "border-[#f3efe8] bg-[#f3efe8] text-[#141210]" : "border-white/10 text-zinc-300 hover:border-white/25")}>{l.label}</button>;
      })}
    </div>
  );
}
export function TalkToggles({ p, up, small }: { p: Prefs; up: Up; small?: boolean }) {
  const pill = (on: boolean) => cx("rounded-full border px-3.5 transition active:scale-95 disabled:opacity-35", small ? "h-8 text-[13px]" : "h-9 text-sm", on ? "border-[#f3efe8] bg-[#f3efe8] text-[#141210]" : "border-white/10 text-zinc-300 hover:border-white/25");
  const t = p.talk;
  return (
    <div className="flex flex-wrap gap-1.5">
      {(["news", "jokes", "facts"] as const).map((k) => (
        <button key={k} type="button" aria-pressed={t[k] && !p.justMusic} disabled={p.justMusic} onClick={() => up("talk", { ...t, [k]: !t[k] })} className={pill(t[k] && !p.justMusic)}>
          {k === "news" ? "News" : k === "jokes" ? "Jokes" : "Song facts"}
        </button>
      ))}
      <button type="button" aria-pressed={p.justMusic} onClick={() => up("justMusic", !p.justMusic)} className={pill(p.justMusic)}>Just music</button>
    </div>
  );
}
