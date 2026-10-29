import { z } from "zod";
import { guard } from "@/lib/api";
import { getFreshTokens } from "@/lib/session";
import { findSong } from "@/lib/song/pipelines";

export const maxDuration = 300;

const Body = z.object({ query: z.string().trim().min(1).max(200) });

// שלב 1 של הצ'אט: חיפוש אקורדים קיימים ברשת.
export async function POST(req: Request) {
  return guard(async () => {
    const body = Body.safeParse(await req.json().catch(() => null));
    if (!body.success) {
      return Response.json({ error: "חסר שם שיר" }, { status: 400 });
    }
    const tokens = await getFreshTokens();
    return Response.json(await findSong(tokens, body.data.query, req.signal));
  });
}
