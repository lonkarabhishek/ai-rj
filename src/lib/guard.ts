// Small, dependency-free request guards for the public API routes: same-origin check, per-client rate limit, bounded JSON bodies.
// The limiter lives in memory, so on serverless it is per warm instance: it blunts bursts and scripted abuse, it is not a hard quota.

const buckets = new Map<string, { n: number; reset: number }>();
let lastSweep = 0;

export function clientIp(req: Request): string {
  const h = req.headers;
  return (h.get("x-real-ip") || h.get("x-forwarded-for")?.split(",")[0] || "local").trim().slice(0, 64);
}

/** Fixed-window counter. Returns seconds to wait when the caller is over the limit, else 0. */
export function rateLimit(req: Request, name: string, max: number, windowMs = 60_000): number {
  const now = Date.now();
  if (now - lastSweep > 60_000) { lastSweep = now; for (const [k, b] of buckets) if (b.reset <= now) buckets.delete(k); }
  const k = `${name}:${clientIp(req)}`;
  const b = buckets.get(k);
  if (!b || b.reset <= now) { buckets.set(k, { n: 1, reset: now + windowMs }); return 0; }
  if (++b.n > max) return Math.max(1, Math.ceil((b.reset - now) / 1000));
  return 0;
}

/** Browsers always send Origin on cross-site POSTs: reject those, so another website can't spend this server's API quota through a visitor. */
export function sameOrigin(req: Request): boolean {
  const origin = req.headers.get("origin");
  if (!origin) return req.headers.get("sec-fetch-site") !== "cross-site"; // non-browser clients (curl, tests) send neither
  try {
    const o = new URL(origin).host;
    const hosts = [req.headers.get("x-forwarded-host"), req.headers.get("host"), new URL(req.url).host].filter(Boolean);
    return hosts.includes(o);
  } catch { return false; }
}

const deny = (status: number, error: string, extra?: Record<string, string>) => Response.json({ error }, { status, headers: extra });

/** One call at the top of a route. Returns a Response to send back when the request must be refused, else null. */
export function guard(req: Request, name: string, max: number, windowMs = 60_000): Response | null {
  if (req.method !== "GET" && !sameOrigin(req)) return deny(403, "Cross-site requests are not allowed");
  const wait = rateLimit(req, name, max, windowMs);
  if (wait) return deny(429, "Too many requests, slow down", { "Retry-After": String(wait) });
  return null;
}

/** Reads a JSON object body with a size cap. Null when it is missing, too large or not an object. */
export async function readJson<T = Record<string, unknown>>(req: Request, maxBytes = 64_000): Promise<T | null> {
  const len = Number(req.headers.get("content-length") ?? 0);
  if (len > maxBytes) return null;
  try {
    const raw = await req.text();
    if (raw.length > maxBytes) return null;
    const j = JSON.parse(raw);
    return j && typeof j === "object" && !Array.isArray(j) ? (j as T) : null;
  } catch { return null; }
}

export const str = (v: unknown, max: number, fallback = ""): string => (typeof v === "string" ? v.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, "").slice(0, max) : fallback);
export const oneOf = <T extends string>(v: unknown, allowed: readonly T[], fallback: T): T => (allowed.includes(v as T) ? (v as T) : fallback);
export const int = (v: unknown, min: number, max: number, fallback: number): number => {
  const n = typeof v === "number" ? v : Number.NaN;
  return Number.isFinite(n) ? Math.min(max, Math.max(min, Math.round(n))) : fallback;
};

/** True for hosts a server-side fetch must never be sent to (loopback, private ranges, link-local, metadata). */
export function isPrivateHost(host: string): boolean {
  const h = host.toLowerCase().replace(/^\[|\]$/g, "");
  if (!h || h === "localhost" || h.endsWith(".localhost") || h.endsWith(".local") || h.endsWith(".internal")) return true;
  if (/^(127\.|10\.|0\.|169\.254\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\.)/.test(h)) return true;
  if (/^\d+$/.test(h) || /^0x/i.test(h)) return true; // decimal / hex IPv4 forms
  if (h.includes(":")) return h === "::1" || h === "::" || /^(fc|fd|fe80|::ffff:)/.test(h); // IPv6 loopback, ULA, link-local, v4-mapped
  return false;
}
