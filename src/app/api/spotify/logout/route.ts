import { cookies } from "next/headers";

export async function POST() {
  const jar = await cookies();
  jar.delete("sp_at");
  jar.delete("sp_rt");
  jar.delete("sp_scope");
  return Response.json({ ok: true });
}
