import { guard } from "@/lib/api";
import { getFreshTokens } from "@/lib/session";
import { imageToSong } from "@/lib/song/pipelines";

export const maxDuration = 300;

const MAX_FILES = 4;
const MAX_TOTAL_BYTES = 4.4 * 1024 * 1024; // מתחת לתקרת גוף הבקשה בפונקציות של Vercel

// קריאת שיר בכתב יד מתמונה אחת או כמה (עמודים של אותו שיר). הלקוח מקטין לפני ההעלאה.
export async function POST(req: Request) {
  return guard(async () => {
    const form = await req.formData().catch(() => null);
    const files = (form?.getAll("file") ?? []).filter(
      (f): f is File => f instanceof File && f.type.startsWith("image/"),
    );
    if (files.length === 0) {
      return Response.json({ error: "צריך לצרף קובץ תמונה" }, { status: 400 });
    }
    if (files.length > MAX_FILES) {
      return Response.json({ error: `עד ${MAX_FILES} תמונות לשיר אחד` }, { status: 400 });
    }
    if (files.reduce((n, f) => n + f.size, 0) > MAX_TOTAL_BYTES) {
      return Response.json({ error: "התמונות גדולות מדי, נסה פחות תמונות או קטנות יותר" }, { status: 413 });
    }
    const hint = form?.get("hint");
    const dataUrls = await Promise.all(
      files.map(
        async (f) => `data:${f.type};base64,${Buffer.from(await f.arrayBuffer()).toString("base64")}`,
      ),
    );
    const tokens = await getFreshTokens();
    const song = await imageToSong(
      tokens,
      dataUrls,
      typeof hint === "string" ? hint : undefined,
      req.signal,
    );
    return Response.json({ song });
  });
}
