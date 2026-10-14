import { cookies } from "next/headers";
import { getAccessToken } from "@/lib/spotify";

export async function GET() {
  try {
    const token = await getAccessToken();
    if (!token) return Response.json({ connected: false }, { status: 401 });
    const scope = (await cookies()).get("sp_scope")?.value ?? null;
    return Response.json({ connected: true, accessToken: token, scope });
  } catch {
    return Response.json({ connected: false, error: "refresh_failed" }, { status: 401 });
  }
}
