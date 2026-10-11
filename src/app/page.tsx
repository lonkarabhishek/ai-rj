export default function Home() {
  return (
    <div className="flex flex-col flex-1 items-center justify-center bg-zinc-950 text-zinc-100 font-sans">
      <main className="flex flex-1 w-full max-w-2xl flex-col items-center justify-center py-24 px-6 text-center gap-8">
        <div className="space-y-4">
          <p className="text-sm uppercase tracking-widest text-zinc-500">Coming soon</p>
          <h1 className="text-5xl font-bold tracking-tight">MyRJ</h1>
          <p className="text-xl text-zinc-400 max-w-md mx-auto">
            Your own AI Radio Jockey. Speaks Hindi, English, Hinglish or Marathi. Plays your music. Knows your humor.
          </p>
        </div>

        <div className="grid grid-cols-2 gap-4 text-sm text-zinc-500 max-w-md">
          <div className="rounded-lg border border-zinc-800 p-4">Personalized voice</div>
          <div className="rounded-lg border border-zinc-800 p-4">Your playlists</div>
          <div className="rounded-lg border border-zinc-800 p-4">Only news you care about</div>
          <div className="rounded-lg border border-zinc-800 p-4">Jokes in your style</div>
        </div>

        <p className="text-sm text-zinc-600">
          Building in public. Repo: github.com/lonkarabhishek/ai-rj
        </p>
      </main>
    </div>
  );
}
