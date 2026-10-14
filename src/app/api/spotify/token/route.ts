import { getAccessToken } from "@/lib/spotify";

export async function GET() {
  try {
    const token = await getAccessToken();
    if (!token) return Response.json({ connected: false }, { status: 401 });
    return Response.json({ connected: true, accessToken: token });
  } catch {
    return Response.json({ connected: false, error: "refresh_failed" }, { status: 401 });
  }
}
