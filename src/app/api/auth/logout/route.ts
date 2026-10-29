import { guard } from "@/lib/api";
import { clearSession } from "@/lib/session";

export async function POST() {
  return guard(async () => {
    await clearSession();
    return Response.json({ ok: true });
  });
}
