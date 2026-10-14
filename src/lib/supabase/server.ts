import { createServerClient } from "@supabase/ssr";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { cookies } from "next/headers";

export const accountsEnabled = () => !!(process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY);

/** Request-scoped client acting as the signed-in user (RLS applies). */
export async function supabaseServer(): Promise<SupabaseClient | null> {
  if (!accountsEnabled()) return null;
  const jar = await cookies();
  return createServerClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, {
    cookies: {
      getAll: () => jar.getAll(),
      setAll: (list) => { try { list.forEach(({ name, value, options }) => jar.set(name, value, options)); } catch { /* read-only context */ } },
    },
  });
}

export async function currentUserId(): Promise<string | null> {
  try {
    const sb = await supabaseServer();
    const { data } = (await sb?.auth.getUser()) ?? { data: null };
    return data?.user?.id ?? null;
  } catch { return null; }
}

/** Service-role client for server-only tables (provider_tokens). Null if the secret key isn't set. */
export function supabaseAdmin(): SupabaseClient | null {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL, key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  return url && key ? createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } }) : null;
}
