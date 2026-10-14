"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import { DEFAULT_PREFS, ENERGIES, HUMORS, LANGUAGES, loadPrefs, savePrefs, type Prefs } from "@/lib/prefs";
import { getMe, getPlaylists } from "@/lib/spotifyClient";

type Voice = { id: string; name: string; labels: Record<string, string>; previewUrl?: string };

const card = "rounded-xl border border-zinc-800 bg-zinc-900/60 p-5 space-y-3";
const input = "w-full rounded-lg bg-zinc-950 border border-zinc-700 px-3 py-2 text-sm";
const chip = (on: boolean) => `px-3 py-1.5 rounded-full text-sm border capitalize ${on ? "bg-fuchsia-600 border-fuchsia-500 text-white" : "border-zinc-700 text-zinc-300 hover:border-zinc-500"}`;

export default function Settings() {
  const [p, setP] = useState<Prefs>(DEFAULT_PREFS);
  const [loaded, setLoaded] = useState(false);
  const [voices, setVoices] = useState<Voice[]>([]);
  const [me, setMe] = useState<{ display_name: string; product: string } | null>(null);
  const [playlists, setPlaylists] = useState<{ id: string; name: string }[]>([]);
  const [topic, setTopic] = useState("");
  const [ext, setExt] = useState("");
  const [testing, setTesting] = useState(false);
  const [msg, setMsg] = useState("");

  useEffect(() => {
    setP(loadPrefs());
    setLoaded(true);
    fetch("/api/voices").then((r) => r.json()).then((j) => setVoices(j.voices ?? []));
    getMe().then(setMe).then(() => getPlaylists().then(setPlaylists)).catch(() => setMe(null));
  }, []);
  useEffect(() => { if (loaded) savePrefs(p); }, [p, loaded]);
  useEffect(() => {
    if (loaded && !p.voiceId && voices[0]) setP((x) => ({ ...x, voiceId: voices[0].id, voiceName: voices[0].name }));
  }, [voices, loaded, p.voiceId]);

  const up = <K extends keyof Prefs>(k: K, v: Prefs[K]) => setP((x) => ({ ...x, [k]: v }));

  async function testVoice() {
    setTesting(true); setMsg("");
    try {
      const seg = await fetch("/api/segment", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ prefs: p, index: 0, next: { name: "your favourite song", artists: "your favourite artist" } }) }).then((r) => r.json());
      setMsg(seg.script);
      const r = await fetch("/api/tts", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ text: seg.script, voiceId: p.voiceId, energy: p.energy }) });
      if (!r.ok) throw new Error((await r.json()).error);
      new Audio(URL.createObjectURL(await r.blob())).play();
    } catch (e) { setMsg(`Error: ${(e as Error).message}`); }
    setTesting(false);
  }

  return (
    <main className="mx-auto w-full max-w-2xl px-5 py-10 space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-3xl font-bold">Your RJ</h1>
        <Link href="/live" className="rounded-full bg-fuchsia-600 px-5 py-2 font-semibold hover:bg-fuchsia-500">Go Live →</Link>
      </div>

      <section className={card}>
        <label className="block text-sm text-zinc-400">RJ name</label>
        <input className={input} value={p.rjName} onChange={(e) => up("rjName", e.target.value)} />
        <label className="block text-sm text-zinc-400">What should the RJ call you?</label>
        <input className={input} value={p.listenerName} onChange={(e) => up("listenerName", e.target.value)} />
      </section>

      <section className={card}>
        <h2 className="font-semibold">Voice</h2>
        <select className={input} value={p.voiceId} onChange={(e) => setP((x) => ({ ...x, voiceId: e.target.value, voiceName: voices.find((v) => v.id === e.target.value)?.name }))}>
          {voices.length === 0 && <option>Loading voices…</option>}
          {voices.map((v) => (
            <option key={v.id} value={v.id}>{v.name} {[v.labels.gender, v.labels.accent, v.labels.age].filter(Boolean).join(" · ")}</option>
          ))}
        </select>
        <h2 className="font-semibold pt-2">Energy</h2>
        <div className="flex gap-2">{ENERGIES.map((e) => <button key={e} className={chip(p.energy === e)} onClick={() => up("energy", e)}>{e}</button>)}</div>
        <h2 className="font-semibold pt-2">Language</h2>
        <div className="flex flex-wrap gap-2">{LANGUAGES.map((l) => <button key={l.id} className={chip(p.language === l.id)} onClick={() => up("language", l.id)}>{l.label}</button>)}</div>
        <h2 className="font-semibold pt-2">Humor</h2>
        <div className="flex flex-wrap gap-2">{HUMORS.map((h) => <button key={h} className={chip(p.humor === h)} onClick={() => up("humor", h)}>{h}</button>)}</div>
        <button onClick={testVoice} disabled={testing || !p.voiceId} className="mt-2 rounded-lg border border-fuchsia-500 px-4 py-2 text-sm hover:bg-fuchsia-950 disabled:opacity-50">{testing ? "Generating…" : "▶ Test my RJ"}</button>
        {msg && <p className="text-sm text-zinc-400 italic">{msg}</p>}
      </section>

      <section className={card}>
        <h2 className="font-semibold">News topics</h2>
        <div className="flex flex-wrap gap-2">
          {p.newsTopics.map((t) => <button key={t} className={chip(true)} onClick={() => up("newsTopics", p.newsTopics.filter((x) => x !== t))}>{t} ✕</button>)}
        </div>
        <form className="flex gap-2" onSubmit={(e) => { e.preventDefault(); if (topic.trim() && !p.newsTopics.includes(topic.trim())) up("newsTopics", [...p.newsTopics, topic.trim()]); setTopic(""); }}>
          <input className={input} placeholder="Add a topic, e.g. Cricket, Startups, Pune" value={topic} onChange={(e) => setTopic(e.target.value)} />
          <button className="rounded-lg bg-zinc-800 px-4 text-sm">Add</button>
        </form>
      </section>

      <section className={card}>
        <h2 className="font-semibold">Music (Spotify)</h2>
        {me ? (
          <>
            <p className="text-sm text-zinc-400">Connected as <b className="text-zinc-200">{me.display_name}</b> · {me.product === "premium" ? "Premium ✓ full songs play here" : "Free account: full playback needs Premium, so MyRJ falls back to previews / opening Spotify"}</p>
            <select className={input} value={p.source} onChange={(e) => up("source", e.target.value)}>
              <option value="top">Auto-curate everything (recommended)</option>
              {playlists.map((pl) => <option key={pl.id} value={pl.id}>{pl.name}</option>)}
            </select>
            <button className="text-xs text-zinc-500 underline" onClick={async () => { await fetch("/api/spotify/logout", { method: "POST" }); setMe(null); }}>Disconnect</button>
          </>
        ) : (
          <a href="/api/auth/spotify/login" className="inline-block rounded-full bg-green-600 px-5 py-2 text-sm font-semibold hover:bg-green-500">Connect Spotify</a>
        )}
        <h2 className="font-semibold pt-3">Other playlists (saved as reference)</h2>
        <form className="flex gap-2" onSubmit={(e) => { e.preventDefault(); if (ext.trim()) up("externalPlaylists", [...p.externalPlaylists, { url: ext.trim(), addedAt: new Date().toISOString() }]); setExt(""); }}>
          <input className={input} placeholder="YouTube Music / Apple Music / JioSaavn link" value={ext} onChange={(e) => setExt(e.target.value)} />
          <button className="rounded-lg bg-zinc-800 px-4 text-sm">Save</button>
        </form>
        <ul className="text-sm text-zinc-400 space-y-1">
          {p.externalPlaylists.map((x, i) => (
            <li key={i} className="flex justify-between gap-2"><a className="truncate underline" href={x.url} target="_blank" rel="noreferrer">{x.url}</a>
              <button onClick={() => up("externalPlaylists", p.externalPlaylists.filter((_, j) => j !== i))}>✕</button></li>
          ))}
        </ul>
      </section>
      <p className="text-xs text-zinc-600">Settings are saved in this browser automatically.</p>
    </main>
  );
}
