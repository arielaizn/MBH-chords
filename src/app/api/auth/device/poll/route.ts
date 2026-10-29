import { z } from "zod";
import { pollDeviceLogin } from "@/lib/chatgpt/auth";
import { guard } from "@/lib/api";
import { saveSession } from "@/lib/session";

const Body = z.object({ deviceAuthId: z.string(), userCode: z.string() });

export async function POST(req: Request) {
  return guard(async () => {
    const body = Body.safeParse(await req.json().catch(() => null));
    if (!body.success) {
      return Response.json({ error: "בקשה לא תקינה" }, { status: 400 });
    }
    const r = await pollDeviceLogin(body.data.deviceAuthId, body.data.userCode);
    if (r.status === "pending") return Response.json({ status: "pending" });
    await saveSession(r.tokens);
    return Response.json({ status: "ok", email: r.tokens.email });
  });
}
