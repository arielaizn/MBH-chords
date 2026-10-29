import { z } from "zod";
import { guard } from "@/lib/api";
import { getFreshTokens } from "@/lib/session";
import { composeSong } from "@/lib/song/pipelines";

export const maxDuration = 300;

const Body = z.object({
  query: z.string().trim().min(1).max(200),
  lyrics: z.string().max(12000).optional(),
  chart: z.string().max(6000).optional(),
  hint: z.string().max(400).optional(),
});

// שלב 2: כשלא נמצאו אקורדים (או כשהמשתמש בחר), ה-AI מרכיב אקורדים בעצמו.
export async function POST(req: Request) {
  return guard(async () => {
    const body = Body.safeParse(await req.json().catch(() => null));
    if (!body.success) {
      return Response.json({ error: "בקשה לא תקינה" }, { status: 400 });
    }
    const tokens = await getFreshTokens();
    return Response.json(await composeSong(tokens, body.data, req.signal));
  });
}
