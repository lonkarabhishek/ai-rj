// Per-user provider refresh tokens, AES-256-GCM encrypted, stored in a service-role-only table.
import { createCipheriv, createDecipheriv, createHash, randomBytes } from "crypto";
import { supabaseAdmin } from "@/lib/supabase/server";

type Provider = "spotify" | "google";
function key() {
  const secret = process.env.TOKEN_ENCRYPTION_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;
  return secret ? createHash("sha256").update(secret).digest() : null;
}
export function encrypt(plain: string) {
  const k = key(); if (!k) throw new Error("no encryption key");
  const iv = randomBytes(12), c = createCipheriv("aes-256-gcm", k, iv);
  const body = Buffer.concat([c.update(plain, "utf8"), c.final()]);
  return [iv, c.getAuthTag(), body].map((b) => b.toString("base64url")).join(".");
}
export function decrypt(enc: string) {
  const k = key(); if (!k) throw new Error("no encryption key");
  const [iv, tag, body] = enc.split(".").map((s) => Buffer.from(s, "base64url"));
  const d = createDecipheriv("aes-256-gcm", k, iv); d.setAuthTag(tag);
  return Buffer.concat([d.update(body), d.final()]).toString("utf8");
}

export async function saveProviderToken(userId: string, provider: Provider, refreshToken: string, scope?: string) {
  const sb = supabaseAdmin(); if (!sb) return false;
  const { error } = await sb.from("provider_tokens").upsert({ user_id: userId, provider, refresh_token_enc: encrypt(refreshToken), scope: scope ?? null, updated_at: new Date().toISOString() });
  if (error) console.error("saveProviderToken", error.message);
  return !error;
}
export async function loadProviderToken(userId: string, provider: Provider): Promise<{ refreshToken: string; scope: string | null } | null> {
  const sb = supabaseAdmin(); if (!sb) return null;
  const { data } = await sb.from("provider_tokens").select("refresh_token_enc, scope").eq("user_id", userId).eq("provider", provider).maybeSingle();
  if (!data) return null;
  try { return { refreshToken: decrypt(data.refresh_token_enc), scope: data.scope }; } catch { return null; }
}
export async function deleteProviderToken(userId: string, provider: Provider) {
  await supabaseAdmin()?.from("provider_tokens").delete().eq("user_id", userId).eq("provider", provider);
}
