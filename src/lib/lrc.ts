// LRC parser. Line timestamps [mm:ss.xx]; word timestamps only when the file really has them (enhanced LRC: <mm:ss.xx>word).
// Never invents word timings: a line without them is highlighted as a whole.

export interface LrcWord { t: number; text: string }
export interface LrcLine { t: number; text: string; words?: LrcWord[] }

const TIME = /\[(\d{1,3}):(\d{1,2})(?:[.:](\d{1,3}))?\]/g;
const WORD = /<(\d{1,3}):(\d{1,2})(?:[.:](\d{1,3}))?>/g;
const sec = (m: string, s: string, f?: string) => Number(m) * 60 + Number(s) + (f ? Number(f) / 10 ** f.length : 0);

export function parseLrc(src: string): LrcLine[] {
  let offset = 0;
  const out: LrcLine[] = [];
  for (const raw of (src || "").split(/\r?\n/)) {
    const off = raw.match(/^\[offset:\s*([+-]?\d+)\]/i);
    if (off) { offset = Number(off[1]) / 1000; continue; }
    const stamps = [...raw.matchAll(TIME)];
    if (!stamps.length) continue;
    const body = raw.replace(TIME, "").trim();
    const wordStamps = [...body.matchAll(WORD)];
    let words: LrcWord[] | undefined;
    if (wordStamps.length) {
      words = [];
      for (let i = 0; i < wordStamps.length; i++) {
        const w = wordStamps[i], next = wordStamps[i + 1];
        const text = body.slice(w.index! + w[0].length, next ? next.index : undefined).replace(/\s+$/, " ");
        if (text.trim()) words.push({ t: sec(w[1], w[2], w[3]) - offset, text });
      }
    }
    const text = body.replace(WORD, "").replace(/\s{2,}/g, " ").trim();
    for (const s of stamps) out.push({ t: sec(s[1], s[2], s[3]) - offset, text, words: words?.length ? words : undefined });
  }
  return out.sort((a, b) => a.t - b.t);
}

/** Index of the line being sung at time t (seconds), or -1 before the first line. */
export function activeLine(lines: LrcLine[], t: number): number {
  let lo = 0, hi = lines.length - 1, ans = -1;
  while (lo <= hi) { const mid = (lo + hi) >> 1; if (lines[mid].t <= t + 0.05) { ans = mid; lo = mid + 1; } else hi = mid - 1; }
  return ans;
}
