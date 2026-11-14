// Small server-side LLM helper for the labelling / import jobs: Gemini first (free tier), then Claude if a key is set.
import { geminiEnabled, geminiTextChain, geminiFastModel } from "./gemini";

export interface LlmImage { mimeType: string; data: string } // base64
export const llmAvailable = () => geminiEnabled() || !!process.env.ANTHROPIC_API_KEY;

/** Returns the model's text, or null when no provider is configured or all of them failed. Never throws. */
export async function llmTask(prompt: string, o: { images?: LlmImage[]; maxTokens?: number; timeoutMs?: number; json?: boolean } = {}): Promise<{ text: string; provider: "gemini" | "claude" } | null> {
  const timeoutMs = o.timeoutMs ?? 14000;
  if (geminiEnabled()) {
    const r = await geminiTextChain({ user: prompt, images: o.images, maxOutputTokens: o.maxTokens ?? 2048, temperature: 0.2, json: o.json }, [geminiFastModel()], timeoutMs,
      (e) => console.error("gemini task:", e.code, e.model));
    if (r) return { text: r.text, provider: "gemini" };
  }
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) return null;
  try {
    const content = [...(o.images ?? []).map((i) => ({ type: "image", source: { type: "base64", media_type: i.mimeType, data: i.data } })), { type: "text", text: prompt }];
    const r = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST", signal: AbortSignal.timeout(timeoutMs),
      headers: { "x-api-key": key, "anthropic-version": "2023-06-01", "content-type": "application/json" },
      body: JSON.stringify({ model: process.env.ANTHROPIC_MODEL || "claude-haiku-5-5", max_tokens: o.maxTokens ?? 2048, thinking: { type: "disabled" }, messages: [{ role: "user", content }] }),
    });
    if (!r.ok) { console.error("claude task:", r.status); return null; }
    const j = await r.json();
    const text = (j.content ?? []).filter((c: { type: string }) => c.type === "text").map((c: { text: string }) => c.text).join("");
    return text ? { text, provider: "claude" } : null;
  } catch { return null; }
}

/** Pulls the first JSON object or array out of a model reply (models sometimes wrap it in prose or a code fence). */
export function extractJson<T>(text: string, kind: "object" | "array", fallback: T): T {
  const [a, b] = kind === "object" ? ["{", "}"] : ["[", "]"];
  const i = text.indexOf(a), j = text.lastIndexOf(b);
  if (i < 0 || j <= i) return fallback;
  try { return JSON.parse(text.slice(i, j + 1)) as T; } catch { return fallback; }
}
