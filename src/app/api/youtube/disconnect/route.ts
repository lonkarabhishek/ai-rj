import { cookies } from "next/headers";
import { currentUserId } from "@/lib/supabase/server";
import { deleteProviderToken } from "@/lib/tokens";

export async function POST() {
  const jar = await cookies();
  jar.delete("yt_at"); jar.delete("yt_rt");
  const uid = await currentUserId();
  if (uid) await deleteProviderToken(uid, "google");
  return Response.json({ ok: true });
}
