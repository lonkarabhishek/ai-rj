import { cookies } from "next/headers";
import { currentUserId } from "@/lib/supabase/server";
import { deleteProviderToken } from "@/lib/tokens";

export async function POST() {
  const jar = await cookies();
  jar.delete("sp_at");
  jar.delete("sp_rt");
  jar.delete("sp_scope");
  const uid = await currentUserId();
  if (uid) await deleteProviderToken(uid, "spotify");
  return Response.json({ ok: true });
}
