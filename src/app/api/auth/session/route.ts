import { guard } from "@/lib/api";
import { getSession } from "@/lib/session";

export async function GET() {
  return guard(async () => {
    const s = await getSession();
    return Response.json({ signedIn: !!s, email: s?.email ?? null });
  });
}
