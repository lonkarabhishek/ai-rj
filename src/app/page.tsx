import Link from "next/link";

export default function Home() {
  return (
    <main className="flex flex-1 w-full max-w-2xl mx-auto flex-col items-center justify-center py-24 px-6 text-center gap-8">
      <h1 className="text-5xl font-bold tracking-tight">MyRJ</h1>
      <p className="text-xl text-zinc-400 max-w-md">Your own AI Radio Jockey. Speaks Hindi, English, Hinglish or Marathi. Plays your music. Knows your humor.</p>
      <div className="flex gap-3">
        <Link href="/live" className="rounded-full bg-fuchsia-600 px-6 py-3 font-semibold hover:bg-fuchsia-500">Go Live</Link>
        <Link href="/settings" className="rounded-full border border-zinc-700 px-6 py-3">Set up my RJ</Link>
      </div>
    </main>
  );
}
