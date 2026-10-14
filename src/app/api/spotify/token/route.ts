import { cookies } from "next/headers";
import { getAccessToken } from "@/lib/spotify";

export async function GET(req: Request) {
  try {
    const token = await getAccessToken(new URL(req.url).searchParams.has("force"));
    if (!token) return Response.json({ connected: false }, { status: 401 });
    const scope = (await cookies()).get("sp_scope")?.value ?? null;
    return Response.json({ connected: true, accessToken: token, scope, expiresAt: Date.now() + 50 * 60 * 1000 });
  } catch {
    return Response.json({ connected: false, error: "refresh_failed" }, { status: 401 });
  }
}
