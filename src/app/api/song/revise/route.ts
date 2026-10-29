import { z } from "zod";
import { guard } from "@/lib/api";
import { getFreshTokens } from "@/lib/session";
import { DesignSchema } from "@/lib/song/design";
import { reviseSong } from "@/lib/song/pipelines";
import { SongSchema } from "@/lib/song/types";

export const maxDuration = 300;

const Body = z.object({
  song: SongSchema,
  design: DesignSchema,
  instruction: z.string().trim().min(1).max(800),
});

// שינוי לפי בקשה חופשית בצ'אט: אקורדים, מילים, מטא-דאטה או עיצוב.
export async function POST(req: Request) {
  return guard(async () => {
    const body = Body.safeParse(await req.json().catch(() => null));
    if (!body.success) {
      return Response.json({ error: "בקשה לא תקינה" }, { status: 400 });
    }
    const tokens = await getFreshTokens();
    return Response.json(await reviseSong(tokens, body.data, req.signal));
  });
}
